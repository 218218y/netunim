import {clone,uid} from '../../core/values.js';
import {checkTodayISO} from '../../core/dates.js';
import {kupaWholeMoney} from '../../core/money.js';
import {normalizeSharedBankEvents} from '../checks/model.js';
import {normalizeBankFeed} from './bank-feed.js';
import {CREDIT_CONNECTOR_CONTRACT_VERSION,creditCardMappingKey,creditSyncScrapeSelection,mergeCreditSyncResult,normalizeCreditSync} from './credit-feed.js';
import {BANK_AUTO_INTERVAL_MS,CREDIT_AUTO_INTERVAL_MS,bankRefreshDue,creditRefreshDue} from './bridge.js';
import {normalizeCashflowSettings} from '../../shared/cashflow.js';
import {CLOUD_WRITE_POLICY,contentionDelay,createOperationId,normalizeCloudError,runBusyCloudWriteWithPolicy} from '../../shared/cloud-sync.js';

const BANK_BRIDGE_VERSION=25;
const CREDIT_BRIDGE_VERSION=32;
function supportedCreditBridge(status){const version=Number(status?.bridgeVersion||0),contract=Number(status?.contractVersion||0);return version>=CREDIT_BRIDGE_VERSION&&contract>=CREDIT_CONNECTOR_CONTRACT_VERSION}

function accountIdOf(snapshot){return snapshot?.accountId||[snapshot?.branchNumber,snapshot?.accountNumber].filter(Boolean).join('-')||snapshot?.accountNumber||''}
function bankFeedFromSnapshot(snapshot,fetchedAt){if(!snapshot||!Number.isFinite(Number(snapshot.balance)))return null;return normalizeBankFeed({provider:'hapoalim',accountNumber:accountIdOf(snapshot),balance:Number(snapshot.balance),availableBalance:snapshot.availableBalance,creditLimit:snapshot.creditLimit,creditLimitUsed:snapshot.creditLimitUsed,creditLimitUsedPercent:snapshot.creditLimitUsedPercent,syncedAt:fetchedAt,transactions:snapshot.transactions||[],transactionWarning:snapshot.transactionWarning||''})}
function contentionBackoff(attempt){return new Promise(resolve=>setTimeout(resolve,contentionDelay(attempt)))}
function cleanDigits(value){return String(value||'').replace(/\D/g,'')}
function financeBankPayload(bank){const out={...bank};delete out.adjustments;delete out.snapshotToken;delete out.snapshotSeq;return out}
function prepareKupaWriteState(kupa){const out=clone(kupa||{});delete out.creditSync;const bank=out.bank&&typeof out.bank==='object'?out.bank:{};out.bank={currentBalance:bank.source==='manual'?bank.currentBalance:null,updatedAt:bank.source==='manual'?bank.updatedAt:null,asOfDate:bank.source==='manual'?bank.asOfDate:null,adjustments:Array.isArray(bank.adjustments)?bank.adjustments.filter(x=>x?.type!=='check_deposit'):[],source:bank.source==='manual'?'manual':null,sourceAccount:null,snapshotToken:bank.snapshotToken??null,snapshotSeq:bank.snapshotSeq??null};return out}

function bankLastSyncAt(kupa){const feed=normalizeBankFeed(kupa?.bank?.feed);return feed?.syncedAt||kupa?.bank?.bankSyncAt||(kupa?.bank?.source==='hapoalim'?kupa?.bank?.updatedAt:null)||null}
function creditLastSyncAt(kupa){return normalizeCreditSync(kupa?.creditSync).syncedAt}

function canonicalJson(value){
  if(Array.isArray(value))return `[${value.map(canonicalJson).join(',')}]`;
  if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value??null);
}
function sameInstant(a,b){if(!a&&!b)return true;const x=Date.parse(a||''),y=Date.parse(b||'');return Number.isFinite(x)&&Number.isFinite(y)&&x===y}
function sameNumber(a,b){if(a===null||a===undefined||a==='')return b===null||b===undefined||b==='';return Number(a)===Number(b)}
function assertBankArchiveCoverage(mergeResult,archive,{role,requireExactCount=false}={}){
  const source=Array.isArray(mergeResult?.sourcePayload)?mergeResult.sourcePayload:[],rows=Array.isArray(archive)?archive:[],byKey=new Map();
  for(const row of rows){const key=String(row?.id||'');if(!key||byKey.has(key))throw new Error(`אימות ארכיון הבנק נכשל (${role||'חשבון'}): מזהה ארכיון כפול או חסר`);byKey.set(key,row)}
  for(const tx of source){
    const row=byKey.get(String(tx.mergeKey||'')),statusOk=String(tx.status||'completed')==='pending'?(row?.status==='pending'||row?.status==='completed'):row?.status==='completed';
    const coreOk=!!row&&sameInstant(tx.date,row.date)&&sameInstant(tx.processedDate,row.processedDate)&&sameNumber(tx.amount,row.amount)&&String(tx.currency||'ILS')===String(row.currency||'ILS')&&String(tx.description||'')===String(row.description||'')&&String(tx.memo||'')===String(row.memo||'')&&String(tx.partyName||'')===String(row.partyName||'')&&String(tx.partyHeadline||'')===String(row.partyHeadline||'')&&String(tx.messageHeadline||'')===String(row.messageHeadline||'')&&String(tx.messageDetail||'')===String(row.messageDetail||'')&&sameNumber(tx.balanceAfter,row.balanceAfter)&&String(tx.bankReference||'')===String(row.bankReference||'')&&String(tx.bankSerial||'')===String(row.bankSerial||'')&&sameNumber(tx.activityTypeCode,row.activityTypeCode)&&statusOk;
    const detailsOk=!!row&&canonicalJson(tx.checkDetails??null)===canonicalJson(row.checkDetails??null)&&Boolean(tx.cheque)===Boolean(row.cheque);
    if(!coreOk||!detailsOk)throw new Error(`אימות ארכיון הבנק נכשל (${role||'חשבון'}): תנועת מקור לא נקראה חזרה בשלמותה (${tx.mergeKey||'ללא מזהה'})`);
  }
  const total=Number(mergeResult?.result?.total_count);
  if(requireExactCount&&(!Number.isSafeInteger(total)||total!==source.length))throw new Error(`אימות backfill נכשל (${role||'חשבון'}): הבנק החזיר ${source.length} תנועות אך הארכיון מכיל ${Number.isFinite(total)?total:'מספר לא תקין'}`);
  return {sourceCount:source.length,archiveCount:Number.isSafeInteger(total)?total:rows.length,insertedCount:Number(mergeResult?.result?.inserted_count)||0,updatedCount:Number(mergeResult?.result?.updated_count)||0,verifiedAt:new Date().toISOString(),exactCount:!!requireExactCount};
}


export function createDomainsFinanceController({tab,checksSession,bridge,loadSession,refreshKupaReadout,readKupaReadOnlyCloud,rpcSaveKupaDocument,acceptKupaCloudRow,syncSharedChecksFromCloud,saveSharedChecksToCloud,checksHaveLocalWork,toast,readFinanceSyncDocument=null,rpcSaveFinanceSync=null,claimFinanceSyncLease=async()=>({acquired:true}),releaseFinanceSyncLease=async()=>true,saveBankSyncSnapshot=null,mergeBankTransactions=async()=>null,readBankTransactions=async()=>[]}){
  const local={bankBusy:false,creditBusy:false,bankTimer:null,creditTimer:null,bankError:'',creditError:'',bankErrorAt:null,creditErrorAt:null,bankStatus:null,creditStatus:null,bankStatusChecked:false,creditStatusChecked:false,bankBridgeError:'',creditBridgeError:''};

  function snapshot(){const kupa=checksSession.kupaCloudReadState&&typeof checksSession.kupaCloudReadState==='object'?clone(checksSession.kupaCloudReadState):null;return {kupa,bank:kupa?.bank?clone(kupa.bank):null,creditSync:normalizeCreditSync(kupa?.creditSync),cards:Array.isArray(kupa?.cards)?clone(kupa.cards):[],credits:Array.isArray(kupa?.credits)?clone(kupa.credits):[],bankLastSyncAt:bankLastSyncAt(kupa),creditLastSyncAt:creditLastSyncAt(kupa),bankAutoEnabled:bridge.bankAutoEnabled(),creditAutoEnabled:bridge.creditAutoEnabled(),creditAutoMode:bridge.creditAutoMode(),bridgeTokenConfigured:!!bridge.getBridgeToken(),bankBusy:local.bankBusy,creditBusy:local.creditBusy,bankError:local.bankError,creditError:local.creditError,bankErrorAt:local.bankErrorAt,creditErrorAt:local.creditErrorAt,bankStatus:local.bankStatus?clone(local.bankStatus):null,creditStatus:local.creditStatus?clone(local.creditStatus):null,bankStatusChecked:local.bankStatusChecked,creditStatusChecked:local.creditStatusChecked,bankBridgeError:local.bankBridgeError,creditBridgeError:local.creditBridgeError}}

  async function refreshFinanceData({force=true,renderIfChanged=true}={}){if(!loadSession()||!navigator.onLine)return snapshot();await refreshKupaReadout({force,renderIfChanged});return snapshot()}

  function observedChecksSequence(kupa){const floor=Number(kupa?.bank?.snapshotSeq),start=Number.isSafeInteger(floor)&&floor>=0?floor:0;return normalizeSharedBankEvents(checksSession.checksBankEvents).reduce((max,event)=>Math.max(max,event.seq),start)}

  async function mutateKupaCloud(mutator){
    const operationId=createOperationId('kupa-finance');
    let row=await readKupaReadOnlyCloud();
    for(let conflictAttempt=0;conflictAttempt<CLOUD_WRITE_POLICY.conflictAttempts;conflictAttempt++){
      if(!row?.state)throw new Error('מסמך הקופה בענן לא נמצא');
      const candidate=mutator(clone(row.state));
      if(!candidate){acceptKupaCloudRow(row,{renderIfChanged:true});return {saved:false,skipped:true,row}}
      const result=await runBusyCloudWriteWithPolicy(()=>rpcSaveKupaDocument(prepareKupaWriteState(candidate),Number(row.revision||0),operationId));
      if(result.r.ok){const savedRow={revision:Number(result.row?.revision||Number(row.revision||0)+1),updated_at:result.row?.updated_at||row.updated_at,state:result.row?.state||candidate};await refreshKupaReadout({force:true,renderIfChanged:true});return {saved:true,skipped:false,row:savedRow}}
      if(normalizeCloudError(result).kind==='revision_conflict'){await contentionBackoff(conflictAttempt);row=await readKupaReadOnlyCloud();continue}
      throw new Error(result.j?.message||result.txt||'שמירת נתוני הקופה המשותפים נכשלה');
    }
    throw new Error('מסמך הקופה השתנה שוב בזמן עדכון פיננסי; לא נדרס שום נתון')
  }

  async function saveCashflowMinimum(account,value){
    const raw=String(value??'').trim(),parsed=raw===''?null:Number(raw);
    if(parsed!==null&&!Number.isFinite(parsed)){toast('סכום המינימום אינו תקין');return false}
    if(!loadSession()){toast('יש להתחבר לענן כדי לשמור את ההגדרה המשותפת');return false}
    try{
      await mutateKupaCloud(kupa=>{const settings=normalizeCashflowSettings(kupa.cashflowSettings);if(account==='home')settings.homeMinimum=parsed;else settings.businessMinimum=parsed;kupa.cashflowSettings=normalizeCashflowSettings(settings);return kupa});
      toast('סף ההתראה התזרימי נשמר ומשותף לשתי המערכות');
      return true;
    }catch(error){toast(error?.message||String(error));return false}
  }

  async function mutateFinanceCloud(mutator){
    if(typeof readFinanceSyncDocument!=='function'||typeof rpcSaveFinanceSync!=='function')return mutateKupaCloud(kupa=>{const finance={bank:clone(kupa.bank||{}),creditSync:clone(kupa.creditSync||{})},next=mutator(finance);if(!next)return null;if(next.bank)kupa.bank=next.bank;if(next.creditSync)kupa.creditSync=next.creditSync;return kupa});
    const operationId=createOperationId('finance');
    let row=await readFinanceSyncDocument();
    for(let conflictAttempt=0;conflictAttempt<CLOUD_WRITE_POLICY.conflictAttempts;conflictAttempt++){
      const base=row?.state&&typeof row.state==='object'?clone(row.state):{};
      const candidate=mutator(base);if(!candidate)return {saved:false,skipped:true,row};
      const result=await runBusyCloudWriteWithPolicy(()=>rpcSaveFinanceSync(candidate,Number(row?.revision||0),operationId));
      if(result.r.ok){await refreshKupaReadout({force:true,renderIfChanged:true});return {saved:true,skipped:false,row:result.row}}
      if(normalizeCloudError(result).kind==='revision_conflict'){await contentionBackoff(conflictAttempt);row=await readFinanceSyncDocument();continue}
      throw new Error(result.j?.message||result.txt||'שמירת נתוני הסינכרון הפיננסי נכשלה');
    }
    throw new Error('נתוני הסינכרון הפיננסי השתנו שוב בזמן השמירה; לא נדרס שום נתון')
  }

  async function refreshBankBridgeStatus({quiet=true}={}){
    local.bankStatusChecked=true;
    if(!bridge.getBridgeToken()){local.bankStatus=null;local.bankBridgeError='';return null}
    try{const status=await bridge.status();local.bankStatus=status;local.bankBridgeError=Number(status.bridgeVersion||0)<BANK_BRIDGE_VERSION?'Bank Bridge ישן. יש להריץ מחדש install_bank_bridge.bat במחשב זה.':'';return status}
    catch(error){local.bankStatus=null;local.bankBridgeError=error?.message||String(error);if(!quiet)toast(local.bankBridgeError);return null}
  }

  async function refreshCreditBridgeStatus({quiet=true}={}){
    local.creditStatusChecked=true;
    if(!bridge.getBridgeToken()){local.creditStatus=null;local.creditBridgeError='';return null}
    try{const status=await bridge.creditStatus();local.creditStatus=status;local.creditBridgeError=supportedCreditBridge(status)?'':'Bank Bridge ישן. יש להריץ מחדש install_bank_bridge.bat במחשב זה.';return status}
    catch(error){local.creditStatus=null;local.creditBridgeError=error?.message||String(error);if(!quiet)toast(local.creditBridgeError);return null}
  }
  async function copySafeCreditDiagnostics(){try{const result=await bridge.creditDiagnostics(),events=Array.isArray(result?.events)?result.events:[],content=JSON.stringify({contractVersion:result?.contractVersion||CREDIT_CONNECTOR_CONTRACT_VERSION,events},null,2);if(!navigator?.clipboard?.writeText)throw new Error('הדפדפן אינו מאפשר העתקה מאובטחת ללוח');await navigator.clipboard.writeText(content);toast(`הועתק אבחון טכני בטוח (${events.length} אירועים מסוננים)`);return true}catch(error){toast(error?.message||'העתקת האבחון נכשלה');return false}}

  async function saveBridgeToken(value){const token=bridge.setBridgeToken(value);local.bankError='';local.creditError='';local.bankErrorAt=null;local.creditErrorAt=null;local.bankBridgeError='';local.creditBridgeError='';local.bankStatusChecked=false;local.creditStatusChecked=false;if(token){await Promise.all([refreshBankBridgeStatus({quiet:true}),refreshCreditBridgeStatus({quiet:true})]);toast('מפתח Bank Bridge נשמר במחשב זה')}else{local.bankStatus=null;local.creditStatus=null;toast('מפתח Bank Bridge הוסר מהמחשב הזה')}startAutoSync();return token}

  async function configureBankBridge({userCode,password,businessBranchNumber,businessAccountNumber,homeBranchNumber,homeAccountNumber}){
    if(local.bankBusy)return false;local.bankBusy=true;local.bankError='';local.bankErrorAt=null;
    try{const result=await bridge.configureCredentials({userCode:String(userCode||'').trim(),password:String(password||''),businessBranchNumber:cleanDigits(businessBranchNumber),businessAccountNumber:cleanDigits(businessAccountNumber),homeBranchNumber:cleanDigits(homeBranchNumber),homeAccountNumber:cleanDigits(homeAccountNumber)});local.bankStatus={...(local.bankStatus||{}),...result,configured:true,bridgeVersion:Math.max(BANK_BRIDGE_VERSION,Number(local.bankStatus?.bridgeVersion||0))};toast('פרטי בנק הפועלים נשמרו ב-Bank Bridge המקומי');return true}
    catch(error){local.bankError=error?.message||String(error);local.bankErrorAt=new Date().toISOString();toast(local.bankError);return false}
    finally{local.bankBusy=false}
  }

  async function selectBankBridgeAccount(role,branchNumber,accountNumber){if(local.bankBusy)return false;local.bankBusy=true;try{const targetRole=role==='home'?'home':'business',result=await bridge.selectAccount({role:targetRole,branchNumber:cleanDigits(branchNumber),accountNumber:cleanDigits(accountNumber)});local.bankStatus={...(local.bankStatus||{}),...result,configured:true,availableAccounts:[],accountRole:''};local.bankError='';local.bankErrorAt=null;toast(`נבחר החשבון ${targetRole==='home'?'הביתי':'העסקי'}`);return true}catch(error){local.bankError=error?.message||String(error);local.bankErrorAt=new Date().toISOString();toast(local.bankError);return false}finally{local.bankBusy=false}}

  async function deleteBankBridgeCredentials(){if(local.bankBusy)return false;local.bankBusy=true;try{await bridge.deleteCredentials();local.bankStatus={...(local.bankStatus||{}),configured:false,businessBranchNumber:'',businessAccountNumber:'',homeBranchNumber:'',homeAccountNumber:'',availableAccounts:[]};local.bankError='';local.bankErrorAt=null;toast('פרטי בנק הפועלים נמחקו מה-Bank Bridge המקומי');return true}catch(error){local.bankError=error?.message||String(error);local.bankErrorAt=new Date().toISOString();toast(local.bankError);return false}finally{local.bankBusy=false}}

  async function prepareBankSnapshot(){
    if(checksHaveLocalWork()){const saved=await saveSharedChecksToCloud('הצ׳קים סונכרנו לפני צילום יתרת הבנק');if(!saved||checksHaveLocalWork())throw new Error('יש להמתין לסנכרון הצ׳קים לפני צילום יתרת עו״ש חדש')}
    const synced=await syncSharedChecksFromCloud({quiet:true,required:true});
    if(!synced||checksHaveLocalWork())throw new Error('צילום היתרה נעצר: לא ניתן לאמת שהצ׳קים מסונכרנים כרגע')
  }

  async function refreshBank({interactive=false,auto=false}={}){
    if(local.bankBusy||local.creditBusy)return false;
    if(!tab.primaryTab||!loadSession()||!navigator.onLine)return false;
    if(!bridge.getBridgeToken()){if(!auto)toast('יש לצמד את ניהול ההזמנות ל-Bank Bridge במחשב זה');return false}
    local.bankBusy=true;local.bankError='';local.bankErrorAt=null;if(auto)bridge.markBankAttempt();
    let leaseToken='',leaseHeld=false;
    try{
      const cloudFresh=await refreshKupaReadout({force:true,renderIfChanged:true});
      if(auto&&!cloudFresh)throw new Error('לא ניתן לאמת את זמן סנכרון הבנק המשותף בענן');
      if(auto&&!bankRefreshDue(bankLastSyncAt(checksSession.kupaCloudReadState)))return true;
      leaseToken=uid('FINLEASE');const lease=await claimFinanceSyncLease('bank',leaseToken);leaseHeld=lease?.acquired===true;
      if(!leaseHeld){if(!auto)toast('סינכרון הבנק כבר מתבצע ממחשב או חלון אחר. לא נפתחה כניסה נוספת לבנק.');return false}
      if(auto){const confirmed=await refreshKupaReadout({force:true,renderIfChanged:true});if(!confirmed)throw new Error('לא ניתן לאמת מחדש את זמן סינכרון הבנק לאחר תפיסת הנעילה');if(!bankRefreshDue(bankLastSyncAt(checksSession.kupaCloudReadState)))return true}
      const status=await bridge.status();local.bankStatus=status;local.bankStatusChecked=true;local.bankBridgeError='';
      if(Number(status.bridgeVersion||0)<BANK_BRIDGE_VERSION)throw new Error('יש לשדרג את Bank Bridge לפני סנכרון הבנק');
      if(!status.configured)throw new Error('Bank Bridge פעיל אך פרטי בנק הפועלים עדיין לא הוגדרו');
      await prepareBankSnapshot();
      const financeRow=typeof readFinanceSyncDocument==='function'?await readFinanceSyncDocument():null,archiveInitialized=financeRow?.state?.bank?.archiveInitialized===true,archiveVersion=Number(financeRow?.state?.bank?.archiveVersion||0),archiveReady=archiveInitialized&&archiveVersion>=2,historyDays=!auto&&!archiveReady?365:30;
      const result=await bridge.fetchBalance({interactive,historyDays}),business=result.accounts?.business||result,home=result.accounts?.home??null,homeFailure=result.accountFailures?.home||null;
      if(!Number.isFinite(Number(business?.balance)))throw new Error('Bank Bridge לא החזיר יתרה עסקית תקינה');
      if(home&&!Number.isFinite(Number(home.balance)))throw new Error('Bank Bridge לא החזיר יתרה ביתית תקינה');
      const fetchedAt=result.fetchedAt||new Date().toISOString(),businessAccount=accountIdOf(business),homeAccount=home?accountIdOf(home):'';
      const businessMerge=await mergeBankTransactions(businessAccount,'business',business.transactions||[]),homeMerge=home&&homeAccount?await mergeBankTransactions(homeAccount,'home',home.transactions||[]):null;
      const businessArchive=await readBankTransactions(businessAccount,'business',{days:370}),homeArchive=home&&homeAccount?await readBankTransactions(homeAccount,'home',{days:370}):[];
      const requireExactArchive=historyDays>=365,businessAudit=assertBankArchiveCoverage(businessMerge,businessArchive,{role:'עסקי',requireExactCount:requireExactArchive}),homeAudit=home&&homeAccount?assertBankArchiveCoverage(homeMerge,homeArchive,{role:'ביתי',requireExactCount:requireExactArchive}):null,archiveAudit={version:2,verifiedAt:fetchedAt,historyDays,business:{...businessAudit,accountKey:businessAccount},home:homeAudit?{...homeAudit,accountKey:homeAccount}:null};
      const businessFeed=bankFeedFromSnapshot({...business,transactions:businessArchive},fetchedAt),homeFeed=home?bankFeedFromSnapshot({...home,transactions:homeArchive},fetchedAt):null,kupa=checksSession.kupaCloudReadState||{},snapshotToken=uid('BANK'),snapshotSeq=observedChecksSequence(kupa);
      const financeBase=financeRow?.state&&typeof financeRow.state==='object'?clone(financeRow.state):{},previousBank=financeBase.bank&&typeof financeBase.bank==='object'?financeBase.bank:{},nextHomeFeed=home?homeFeed:(homeFailure?previousBank.homeFeed??null:null);
      const exactBackfillVerified=historyDays>=365&&!business.transactionWarning&&!homeFailure&&(!home||!home.transactionWarning),archiveBaselineAudit=exactBackfillVerified?archiveAudit:(previousBank.archiveBaselineAudit||null);
      const nextBank={...previousBank,currentBalance:kupaWholeMoney(business.balance),availableBalance:Number.isFinite(Number(business.availableBalance))?Number(business.availableBalance):null,creditLimit:Number.isFinite(Number(business.creditLimit))?Number(business.creditLimit):null,creditLimitUsed:Number.isFinite(Number(business.creditLimitUsed))?Number(business.creditLimitUsed):null,creditLimitUsedPercent:Number.isFinite(Number(business.creditLimitUsedPercent))?Number(business.creditLimitUsedPercent):null,updatedAt:new Date().toISOString(),asOfDate:checkTodayISO(),source:'hapoalim',sourceAccount:businessAccount||null,bankSyncAt:fetchedAt,feed:businessFeed,homeFeed:nextHomeFeed,archiveInitialized:archiveReady||exactBackfillVerified,archiveVersion:exactBackfillVerified?2:archiveVersion,archiveInitializedAt:archiveReady?previousBank.archiveInitializedAt||null:(exactBackfillVerified?fetchedAt:null),archiveAudit,archiveBaselineAudit};
      let saved={saved:true,skipped:false};
      if(typeof saveBankSyncSnapshot==='function'){
        await saveBankSyncSnapshot(financeBankPayload(nextBank),snapshotToken,snapshotSeq);
        await refreshKupaReadout({force:true,renderIfChanged:true});
      }else{
        saved=await mutateFinanceCloud(finance=>{finance.bank=financeBankPayload(nextBank);return finance});
        await mutateKupaCloud(kupaState=>{const bank=kupaState.bank&&typeof kupaState.bank==='object'?kupaState.bank:{};kupaState.bank={...bank,adjustments:[],snapshotToken,snapshotSeq};return kupaState});
      }
      local.bankStatus={...status,lastScrapeAt:fetchedAt,lastError:'',lastErrorAt:null,lastWarning:[business?.transactionWarning?`עסקי: ${business.transactionWarning}`:'',home?.transactionWarning?`ביתי: ${home.transactionWarning}`:'',homeFailure?.message?`ביתי: ${homeFailure.message}`:''].filter(Boolean).join(' | '),availableAccounts:Array.isArray(homeFailure?.availableAccounts)?homeFailure.availableAccounts:[],accountRole:homeFailure?'home':''};
      if(!auto&&!saved.skipped)toast(homeFailure?'החשבון העסקי עודכן; החשבון הביתי נשאר בנתון האחרון':'נתוני הבנק העסקי והביתי עודכנו וזמינים בשתי המערכות');
      return true;
    }catch(error){local.bankError=error?.message||String(error);local.bankErrorAt=new Date().toISOString();if(error?.code==='BRIDGE_UNAVAILABLE'||error?.code==='BRIDGE_TIMEOUT')local.bankBridgeError=local.bankError;if(error?.availableAccounts?.length)local.bankStatus={...(local.bankStatus||{}),availableAccounts:error.availableAccounts,accountRole:error.accountRole||''};if(!auto)toast(local.bankError);return false}
    finally{if(leaseHeld)try{await releaseFinanceSyncLease('bank',leaseToken)}catch(error){console.error('orders bank sync lease release',error)}local.bankBusy=false;scheduleBankAuto()}
  }

  async function refreshCredit({interactive=false,auto=false,syncMode='full'}={}){
    if(local.creditBusy||local.bankBusy)return false;
    if(!tab.primaryTab||!loadSession()||!navigator.onLine)return false;
    if(!bridge.getBridgeToken()){if(!auto)toast('יש לצמד את ניהול ההזמנות ל-Bank Bridge במחשב זה');return false}
    local.creditBusy=true;local.creditError='';local.creditErrorAt=null;if(auto)bridge.markCreditAttempt();
    let leaseToken='',leaseHeld=false;
    try{
      const cloudFresh=await refreshKupaReadout({force:true,renderIfChanged:true});
      if(auto&&!cloudFresh)throw new Error('לא ניתן לאמת את זמן סנכרון האשראי המשותף בענן');
      if(auto&&!creditRefreshDue(creditLastSyncAt(checksSession.kupaCloudReadState)))return true;
      leaseToken=uid('FINLEASE');const lease=await claimFinanceSyncLease('credit',leaseToken);leaseHeld=lease?.acquired===true;
      if(!leaseHeld){if(!auto)toast('סינכרון אשראי כבר מתבצע ממחשב או חלון אחר. לא נפתחה כניסה נוספת לחברות האשראי.');return false}
      if(auto){const confirmed=await refreshKupaReadout({force:true,renderIfChanged:true});if(!confirmed)throw new Error('לא ניתן לאמת מחדש את זמן סנכרון האשראי לאחר תפיסת הנעילה');if(!creditRefreshDue(creditLastSyncAt(checksSession.kupaCloudReadState)))return true}
      const status=await bridge.creditStatus();local.creditStatus=status;local.creditStatusChecked=true;local.creditBridgeError='';
      if(!supportedCreditBridge(status))throw new Error('יש לשדרג את Bank Bridge לפני סנכרון האשראי');
      if(!(status.profiles||[]).length)throw new Error('לא הוגדר עדיין חיבור לחברת אשראי במחשב זה');
      const result=await bridge.syncCreditCards({interactive,syncMode:auto?bridge.creditAutoMode():syncMode==='full'?'full':'daily',selection:creditSyncScrapeSelection(checksSession.kupaCloudReadState?.creditSync)});
      if(Number(result.attemptedCount)===0&&Number(result.deferredCount)>0){await refreshCreditBridgeStatus({quiet:true});local.creditError='';local.creditErrorAt=null;if(!auto)toast('לא נשלחה בקשה חדשה: החיבור מושהה עד מועד ה־403/429 הקודם. גם רענון עם חלון אבחון מכבד את ההשהיה.');return true}
      const saved=await mutateFinanceCloud(finance=>{if(auto&&!creditRefreshDue(creditLastSyncAt({creditSync:finance.creditSync})))return null;finance.creditSync=mergeCreditSyncResult(finance.creditSync,result);return finance});
      await refreshCreditBridgeStatus({quiet:true});
      const deferredOnly=Array.isArray(result.errors)&&result.errors.length>0&&result.errors.every(error=>error?.severity==='deferred'||error?.deferred===true);if(!auto&&!saved.skipped)toast(deferredOnly?'החיבור מושהה עקב 403/429; לא יישלח ניסיון נוסף לפני המועד.':result.errors?.length?`האשראי עודכן עם ${result.errors.length} אזהרות והנתונים זמינים בשתי המערכות`:'נתוני האשראי עודכנו וזמינים בשתי המערכות');
      return true;
    }catch(error){
      const deferredOnly=Array.isArray(error?.creditErrors)&&error.creditErrors.length>0&&error.creditErrors.every(item=>item?.severity==='deferred'||item?.deferred===true);local.creditError=deferredOnly?'':error?.message||String(error);local.creditErrorAt=deferredOnly?null:new Date().toISOString();if(error?.code==='BRIDGE_UNAVAILABLE'||error?.code==='BRIDGE_TIMEOUT')local.creditBridgeError=local.creditError;
      if(Array.isArray(error?.creditErrors)&&error.creditErrors.length){try{await mutateFinanceCloud(finance=>{finance.creditSync=mergeCreditSyncResult(finance.creditSync,{profiles:[],errors:error.creditErrors});return finance})}catch(persistError){console.error('credit diagnostics save',persistError)}}
      if(!auto)toast(deferredOnly?'החיבור מושהה עד תום ה־cooldown; לא יישלח ניסיון חדש לפני המועד.':local.creditError);return deferredOnly;
    }finally{if(leaseHeld)try{await releaseFinanceSyncLease('credit',leaseToken)}catch(error){console.error('orders credit sync lease release',error)}local.creditBusy=false;scheduleCreditAuto()}
  }

  async function saveCreditProfile(profile){if(local.creditBusy)return false;local.creditBusy=true;local.creditError='';local.creditErrorAt=null;try{await bridge.saveCreditProfile(profile);await refreshCreditBridgeStatus({quiet:true});toast('חיבור האשראי נשמר במחשב זה');return true}catch(error){local.creditError=error?.message||String(error);local.creditErrorAt=new Date().toISOString();toast(local.creditError);return false}finally{local.creditBusy=false}}
  async function deleteCreditProfile(profileId){if(local.creditBusy)return false;local.creditBusy=true;try{await bridge.deleteCreditProfile(profileId);await refreshCreditBridgeStatus({quiet:true});toast('חיבור האשראי המקומי נמחק');return true}catch(error){local.creditError=error?.message||String(error);local.creditErrorAt=new Date().toISOString();toast(local.creditError);return false}finally{local.creditBusy=false}}
  async function resetCreditSync(){if(local.creditBusy)return false;local.creditBusy=true;try{const status=local.creditStatus||await refreshCreditBridgeStatus({quiet:true});if(!status)throw new Error(local.creditBridgeError||'Bank Bridge אינו זמין');if(!supportedCreditBridge(status))throw new Error('יש לשדרג את Bank Bridge לפני איפוס מלא של סנכרון האשראי');await bridge.resetCreditProfiles();await mutateFinanceCloud(finance=>{finance.creditSync=normalizeCreditSync({});return finance});bridge.setCreditAutoEnabled(false);bridge.setCreditAutoMode('daily');local.creditStatus={...status,profiles:[],lastErrors:[]};local.creditError='';local.creditErrorAt=null;toast('סנכרון האשראי אופס והחיבורים המקומיים נמחקו');return true}catch(error){local.creditError=error?.message||String(error);local.creditErrorAt=new Date().toISOString();toast(local.creditError);return false}finally{local.creditBusy=false;scheduleCreditAuto()}}

  async function setCreditCardMapping(profileId,accountNumber,field,value){try{await mutateFinanceCloud(kupa=>{const sync=normalizeCreditSync(kupa.creditSync),profile=sync.profiles.find(p=>p.profileId===profileId),key=creditCardMappingKey(profileId,accountNumber),current=sync.cardMappings[key]||{included:false,hidden:false,account:profile?.defaultAccount==='ביתי'?'ביתי':'עסקי',cardName:'',manualFrame:null};if(field==='included')current.included=!!value;else if(field==='hidden')current.hidden=!!value;else if(field==='account')current.account=value==='ביתי'?'ביתי':'עסקי';else if(field==='cardName')current.cardName=String(value||'').trim().slice(0,100);else if(field==='manualFrame'){const raw=String(value??'').trim(),amount=raw===''?null:Number(raw);if(amount!==null&&(!Number.isFinite(amount)||amount<0))throw new Error('מסגרת ידנית חייבת להיות מספר חיובי או אפס');current.manualFrame=amount===null?null:Math.round(amount*100)/100}else return null;sync.cardMappings[key]=current;kupa.creditSync=sync;return kupa});toast('שיוך כרטיס האשראי עודכן');return true}catch(error){local.creditError=error?.message||String(error);local.creditErrorAt=new Date().toISOString();toast(local.creditError);return false}}

  function clearTimer(name){if(local[name]){clearTimeout(local[name]);local[name]=null}}
  function autoWait(lastSyncAt,intervalMs){const time=lastSyncAt?Date.parse(lastSyncAt):NaN;return Number.isFinite(time)?Math.max(1000,time+intervalMs-Date.now()+250):1000}
  function scheduleBankAuto(){clearTimer('bankTimer');if(!loadSession()||!bridge.bankAutoEnabled()||!bridge.getBridgeToken())return;const retryWait=typeof bridge.bankAttemptDelayMs==='function'?bridge.bankAttemptDelayMs():0,wait=Math.max(autoWait(bankLastSyncAt(checksSession.kupaCloudReadState),BANK_AUTO_INTERVAL_MS),retryWait+250);local.bankTimer=setTimeout(()=>{local.bankTimer=null;maybeAutoRefreshBank().catch(error=>console.error('orders bank auto refresh',error))},wait)}
  function scheduleCreditAuto(){clearTimer('creditTimer');if(!loadSession()||!bridge.creditAutoEnabled()||!bridge.getBridgeToken())return;const retryWait=typeof bridge.creditAttemptDelayMs==='function'?bridge.creditAttemptDelayMs():0,wait=Math.max(autoWait(creditLastSyncAt(checksSession.kupaCloudReadState),CREDIT_AUTO_INTERVAL_MS),retryWait+250);local.creditTimer=setTimeout(()=>{local.creditTimer=null;maybeAutoRefreshCredit().catch(error=>console.error('orders credit auto refresh',error))},wait)}
  async function maybeAutoRefreshBank(){scheduleBankAuto();if(!tab.primaryTab||!loadSession()||!navigator.onLine||local.bankBusy||local.creditBusy||!bridge.bankAutoEnabled()||!bridge.getBridgeToken()||!bridge.bankAttemptReady())return false;return refreshBank({interactive:false,auto:true})}
  async function maybeAutoRefreshCredit(){scheduleCreditAuto();if(!tab.primaryTab||!loadSession()||!navigator.onLine||local.bankBusy||local.creditBusy||!bridge.creditAutoEnabled()||!bridge.getBridgeToken()||!bridge.creditAttemptReady())return false;return refreshCredit({interactive:false,auto:true})}
  function startAutoSync(){scheduleBankAuto();scheduleCreditAuto()}
  function setBankAutoEnabled(value){bridge.setBankAutoEnabled(value);scheduleBankAuto()}
  function setCreditAutoEnabled(value){bridge.setCreditAutoEnabled(value);scheduleCreditAuto()}
  function setCreditAutoMode(value){bridge.setCreditAutoMode(value);scheduleCreditAuto()}

  return {snapshot,refreshFinanceData,refreshBankBridgeStatus,refreshCreditBridgeStatus,copySafeCreditDiagnostics,saveBridgeToken,configureBankBridge,selectBankBridgeAccount,deleteBankBridgeCredentials,refreshBank,refreshCredit,saveCreditProfile,deleteCreditProfile,resetCreditSync,setCreditCardMapping,maybeAutoRefreshBank,maybeAutoRefreshCredit,startAutoSync,setBankAutoEnabled,setCreditAutoEnabled,setCreditAutoMode,saveCashflowMinimum,mutateKupaCloud};
}
