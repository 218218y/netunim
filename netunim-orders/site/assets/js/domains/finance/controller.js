import {clone,uid} from '../../core/values.js';
import {checkTodayISO} from '../../core/dates.js';
import {kupaWholeMoney} from '../../core/money.js';
import {normalizeSharedBankEvents} from '../checks/model.js';
import {normalizeBankFeed} from './bank-feed.js';
import {creditCardMappingKey,mergeCreditSyncResult,normalizeCreditSync} from './credit-feed.js';
import {BANK_AUTO_INTERVAL_MS,CREDIT_AUTO_INTERVAL_MS,bankRefreshDue,creditRefreshDue} from './bridge.js';

const BANK_BRIDGE_VERSION=21;
const CREDIT_BRIDGE_VERSION=20;

function accountIdOf(snapshot){return snapshot?.accountId||[snapshot?.branchNumber,snapshot?.accountNumber].filter(Boolean).join('-')||snapshot?.accountNumber||''}
function bankFeedFromSnapshot(snapshot,fetchedAt){if(!snapshot||!Number.isFinite(Number(snapshot.balance)))return null;return normalizeBankFeed({provider:'hapoalim',accountNumber:accountIdOf(snapshot),balance:Number(snapshot.balance),syncedAt:fetchedAt,transactions:snapshot.transactions||[],transactionWarning:snapshot.transactionWarning||''})}
function bankLastSyncAt(kupa){const feed=normalizeBankFeed(kupa?.bank?.feed);return feed?.syncedAt||kupa?.bank?.bankSyncAt||(kupa?.bank?.source==='hapoalim'?kupa?.bank?.updatedAt:null)||null}
function creditLastSyncAt(kupa){return normalizeCreditSync(kupa?.creditSync).syncedAt}
function revisionConflict(result){return !result?.r?.ok&&String(result?.j?.message||result?.txt||'').includes('revision_conflict')}
function cleanDigits(value){return String(value||'').replace(/\D/g,'')}

export function createDomainsFinanceController({tab,checksSession,bridge,loadSession,refreshKupaReadout,readKupaReadOnlyCloud,rpcSaveKupaDocument,acceptKupaCloudRow,syncSharedChecksFromCloud,saveSharedChecksToCloud,checksHaveLocalWork,toast}){
  const local={bankBusy:false,creditBusy:false,bankTimer:null,creditTimer:null,bankError:'',creditError:'',bankErrorAt:null,creditErrorAt:null,bankStatus:null,creditStatus:null,bankStatusChecked:false,creditStatusChecked:false,bankBridgeError:'',creditBridgeError:''};

  function snapshot(){const kupa=checksSession.kupaCloudReadState&&typeof checksSession.kupaCloudReadState==='object'?clone(checksSession.kupaCloudReadState):null;return {kupa,bank:kupa?.bank?clone(kupa.bank):null,creditSync:normalizeCreditSync(kupa?.creditSync),cards:Array.isArray(kupa?.cards)?clone(kupa.cards):[],credits:Array.isArray(kupa?.credits)?clone(kupa.credits):[],bankLastSyncAt:bankLastSyncAt(kupa),creditLastSyncAt:creditLastSyncAt(kupa),bankAutoEnabled:bridge.bankAutoEnabled(),creditAutoEnabled:bridge.creditAutoEnabled(),bridgeTokenConfigured:!!bridge.getBridgeToken(),bankBusy:local.bankBusy,creditBusy:local.creditBusy,bankError:local.bankError,creditError:local.creditError,bankErrorAt:local.bankErrorAt,creditErrorAt:local.creditErrorAt,bankStatus:local.bankStatus?clone(local.bankStatus):null,creditStatus:local.creditStatus?clone(local.creditStatus):null,bankStatusChecked:local.bankStatusChecked,creditStatusChecked:local.creditStatusChecked,bankBridgeError:local.bankBridgeError,creditBridgeError:local.creditBridgeError}}

  async function refreshFinanceData({force=true,renderIfChanged=true}={}){if(!loadSession()||!navigator.onLine)return snapshot();await refreshKupaReadout({force,renderIfChanged});return snapshot()}

  function observedChecksSequence(kupa){const floor=Number(kupa?.bank?.snapshotSeq),start=Number.isSafeInteger(floor)&&floor>=0?floor:0;return normalizeSharedBankEvents(checksSession.checksBankEvents).reduce((max,event)=>Math.max(max,event.seq),start)}

  async function mutateKupaCloud(mutator){
    for(let attempt=0;attempt<3;attempt++){
      const row=await readKupaReadOnlyCloud();
      if(!row?.state)throw new Error('מסמך הקופה בענן לא נמצא');
      const candidate=mutator(clone(row.state));
      if(!candidate){acceptKupaCloudRow(row,{renderIfChanged:true});return {saved:false,skipped:true,row}}
      const result=await rpcSaveKupaDocument(candidate,Number(row.revision||0));
      if(result.r.ok){const savedRow={revision:Number(result.row?.revision||Number(row.revision||0)+1),updated_at:result.row?.updated_at||row.updated_at,state:result.row?.state||candidate};acceptKupaCloudRow(savedRow,{renderIfChanged:true});return {saved:true,skipped:false,row:savedRow}}
      if(revisionConflict(result))continue;
      throw new Error(result.j?.message||result.txt||'שמירת נתוני הקופה המשותפים נכשלה');
    }
    throw new Error('מסמך הקופה השתנה שוב בזמן עדכון פיננסי; לא נדרס שום נתון')
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
    try{const status=await bridge.creditStatus();local.creditStatus=status;local.creditBridgeError=Number(status.bridgeVersion||0)<CREDIT_BRIDGE_VERSION?'Bank Bridge ישן. יש להריץ מחדש install_bank_bridge.bat במחשב זה.':'';return status}
    catch(error){local.creditStatus=null;local.creditBridgeError=error?.message||String(error);if(!quiet)toast(local.creditBridgeError);return null}
  }

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
    try{
      const cloudFresh=await refreshKupaReadout({force:true,renderIfChanged:true});
      if(auto&&!cloudFresh)throw new Error('לא ניתן לאמת את זמן סנכרון הבנק המשותף בענן');
      if(auto&&!bankRefreshDue(bankLastSyncAt(checksSession.kupaCloudReadState)))return true;
      const status=await bridge.status();local.bankStatus=status;local.bankStatusChecked=true;local.bankBridgeError='';
      if(Number(status.bridgeVersion||0)<BANK_BRIDGE_VERSION)throw new Error('יש לשדרג את Bank Bridge לפני סנכרון הבנק');
      if(!status.configured)throw new Error('Bank Bridge פעיל אך פרטי בנק הפועלים עדיין לא הוגדרו');
      await prepareBankSnapshot();
      const result=await bridge.fetchBalance({interactive}),business=result.accounts?.business||result,home=result.accounts?.home??null,homeFailure=result.accountFailures?.home||null;
      if(!Number.isFinite(Number(business?.balance)))throw new Error('Bank Bridge לא החזיר יתרה עסקית תקינה');
      if(home&&!Number.isFinite(Number(home.balance)))throw new Error('Bank Bridge לא החזיר יתרה ביתית תקינה');
      const fetchedAt=result.fetchedAt||new Date().toISOString(),businessFeed=bankFeedFromSnapshot(business,fetchedAt),homeFeed=home?bankFeedFromSnapshot(home,fetchedAt):null,businessAccount=accountIdOf(business);
      const saved=await mutateKupaCloud(kupa=>{
        if(auto&&!bankRefreshDue(bankLastSyncAt(kupa)))return null;
        const previousBank=kupa.bank&&typeof kupa.bank==='object'?kupa.bank:{},nextHomeFeed=home?homeFeed:(homeFailure?previousBank.homeFeed??null:null);
        kupa.bank={...previousBank,currentBalance:kupaWholeMoney(business.balance),updatedAt:new Date().toISOString(),asOfDate:checkTodayISO(),snapshotToken:uid('BANK'),snapshotSeq:observedChecksSequence(kupa),adjustments:[],source:'hapoalim',sourceAccount:businessAccount||null,bankSyncAt:fetchedAt,feed:businessFeed,homeFeed:nextHomeFeed};
        return kupa;
      });
      local.bankStatus={...status,lastScrapeAt:fetchedAt,lastError:'',lastErrorAt:null,lastWarning:[business?.transactionWarning?`עסקי: ${business.transactionWarning}`:'',home?.transactionWarning?`ביתי: ${home.transactionWarning}`:'',homeFailure?.message?`ביתי: ${homeFailure.message}`:''].filter(Boolean).join(' | '),availableAccounts:Array.isArray(homeFailure?.availableAccounts)?homeFailure.availableAccounts:[],accountRole:homeFailure?'home':''};
      if(!auto&&!saved.skipped)toast(homeFailure?'החשבון העסקי עודכן; החשבון הביתי נשאר בנתון האחרון':'נתוני הבנק העסקי והביתי עודכנו וזמינים בשתי המערכות');
      return true;
    }catch(error){local.bankError=error?.message||String(error);local.bankErrorAt=new Date().toISOString();if(error?.code==='BRIDGE_UNAVAILABLE'||error?.code==='BRIDGE_TIMEOUT')local.bankBridgeError=local.bankError;if(error?.availableAccounts?.length)local.bankStatus={...(local.bankStatus||{}),availableAccounts:error.availableAccounts,accountRole:error.accountRole||''};if(!auto)toast(local.bankError);return false}
    finally{local.bankBusy=false;scheduleBankAuto()}
  }

  async function refreshCredit({interactive=false,auto=false}={}){
    if(local.creditBusy||local.bankBusy)return false;
    if(!tab.primaryTab||!loadSession()||!navigator.onLine)return false;
    if(!bridge.getBridgeToken()){if(!auto)toast('יש לצמד את ניהול ההזמנות ל-Bank Bridge במחשב זה');return false}
    local.creditBusy=true;local.creditError='';local.creditErrorAt=null;if(auto)bridge.markCreditAttempt();
    try{
      const cloudFresh=await refreshKupaReadout({force:true,renderIfChanged:true});
      if(auto&&!cloudFresh)throw new Error('לא ניתן לאמת את זמן סנכרון האשראי המשותף בענן');
      if(auto&&!creditRefreshDue(creditLastSyncAt(checksSession.kupaCloudReadState)))return true;
      const status=await bridge.creditStatus();local.creditStatus=status;local.creditStatusChecked=true;local.creditBridgeError='';
      if(Number(status.bridgeVersion||0)<CREDIT_BRIDGE_VERSION)throw new Error('יש לשדרג את Bank Bridge לפני סנכרון האשראי');
      if(!(status.profiles||[]).length)throw new Error('לא הוגדר עדיין חיבור לחברת אשראי במחשב זה');
      const result=await bridge.syncCreditCards({interactive});
      const saved=await mutateKupaCloud(kupa=>{if(auto&&!creditRefreshDue(creditLastSyncAt(kupa)))return null;kupa.creditSync=mergeCreditSyncResult(kupa.creditSync,result);return kupa});
      await refreshCreditBridgeStatus({quiet:true});
      if(!auto&&!saved.skipped)toast(result.errors?.length?`האשראי עודכן עם ${result.errors.length} אזהרות והנתונים זמינים בשתי המערכות`:'נתוני האשראי עודכנו וזמינים בשתי המערכות');
      return true;
    }catch(error){
      local.creditError=error?.message||String(error);local.creditErrorAt=new Date().toISOString();if(error?.code==='BRIDGE_UNAVAILABLE'||error?.code==='BRIDGE_TIMEOUT')local.creditBridgeError=local.creditError;
      if(Array.isArray(error?.creditErrors)&&error.creditErrors.length){try{await mutateKupaCloud(kupa=>{kupa.creditSync=mergeCreditSyncResult(kupa.creditSync,{profiles:[],errors:error.creditErrors});return kupa})}catch(persistError){console.error('credit diagnostics save',persistError)}}
      if(!auto)toast(local.creditError);return false;
    }finally{local.creditBusy=false;scheduleCreditAuto()}
  }

  async function saveCreditProfile(profile){if(local.creditBusy)return false;local.creditBusy=true;local.creditError='';local.creditErrorAt=null;try{await bridge.saveCreditProfile(profile);await refreshCreditBridgeStatus({quiet:true});toast('חיבור האשראי נשמר במחשב זה');return true}catch(error){local.creditError=error?.message||String(error);local.creditErrorAt=new Date().toISOString();toast(local.creditError);return false}finally{local.creditBusy=false}}
  async function deleteCreditProfile(profileId){if(local.creditBusy)return false;local.creditBusy=true;try{await bridge.deleteCreditProfile(profileId);await refreshCreditBridgeStatus({quiet:true});toast('חיבור האשראי המקומי נמחק');return true}catch(error){local.creditError=error?.message||String(error);local.creditErrorAt=new Date().toISOString();toast(local.creditError);return false}finally{local.creditBusy=false}}
  async function resetCreditSync(){if(local.creditBusy)return false;local.creditBusy=true;try{const status=local.creditStatus||await refreshCreditBridgeStatus({quiet:true});if(!status)throw new Error(local.creditBridgeError||'Bank Bridge אינו זמין');if(Number(status.bridgeVersion||0)<CREDIT_BRIDGE_VERSION)throw new Error('יש לשדרג את Bank Bridge לפני איפוס מלא של סנכרון האשראי');await bridge.resetCreditProfiles();await mutateKupaCloud(kupa=>{kupa.creditSync=normalizeCreditSync({});return kupa});bridge.setCreditAutoEnabled(false);local.creditStatus={...status,profiles:[],lastErrors:[]};local.creditError='';local.creditErrorAt=null;toast('סנכרון האשראי אופס והחיבורים המקומיים נמחקו');return true}catch(error){local.creditError=error?.message||String(error);local.creditErrorAt=new Date().toISOString();toast(local.creditError);return false}finally{local.creditBusy=false;scheduleCreditAuto()}}

  async function setCreditCardMapping(profileId,accountNumber,field,value){try{await mutateKupaCloud(kupa=>{const sync=normalizeCreditSync(kupa.creditSync),profile=sync.profiles.find(p=>p.profileId===profileId),key=creditCardMappingKey(profileId,accountNumber),current=sync.cardMappings[key]||{included:false,hidden:false,account:profile?.defaultAccount==='ביתי'?'ביתי':'עסקי',cardName:''};if(field==='included')current.included=!!value;else if(field==='hidden')current.hidden=!!value;else if(field==='account')current.account=value==='ביתי'?'ביתי':'עסקי';else if(field==='cardName')current.cardName=String(value||'').trim().slice(0,100);else return null;sync.cardMappings[key]=current;kupa.creditSync=sync;return kupa});toast('שיוך כרטיס האשראי עודכן');return true}catch(error){local.creditError=error?.message||String(error);local.creditErrorAt=new Date().toISOString();toast(local.creditError);return false}}

  function clearTimer(name){if(local[name]){clearTimeout(local[name]);local[name]=null}}
  function autoWait(lastSyncAt,intervalMs){const time=lastSyncAt?Date.parse(lastSyncAt):NaN;return Number.isFinite(time)?Math.max(1000,time+intervalMs-Date.now()+250):1000}
  function scheduleBankAuto(){clearTimer('bankTimer');if(!loadSession()||!bridge.bankAutoEnabled()||!bridge.getBridgeToken())return;const retryWait=typeof bridge.bankAttemptDelayMs==='function'?bridge.bankAttemptDelayMs():0,wait=Math.max(autoWait(bankLastSyncAt(checksSession.kupaCloudReadState),BANK_AUTO_INTERVAL_MS),retryWait+250);local.bankTimer=setTimeout(()=>{local.bankTimer=null;maybeAutoRefreshBank().catch(error=>console.error('orders bank auto refresh',error))},wait)}
  function scheduleCreditAuto(){clearTimer('creditTimer');if(!loadSession()||!bridge.creditAutoEnabled()||!bridge.getBridgeToken())return;const retryWait=typeof bridge.creditAttemptDelayMs==='function'?bridge.creditAttemptDelayMs():0,wait=Math.max(autoWait(creditLastSyncAt(checksSession.kupaCloudReadState),CREDIT_AUTO_INTERVAL_MS),retryWait+250);local.creditTimer=setTimeout(()=>{local.creditTimer=null;maybeAutoRefreshCredit().catch(error=>console.error('orders credit auto refresh',error))},wait)}
  async function maybeAutoRefreshBank(){scheduleBankAuto();if(!tab.primaryTab||!loadSession()||!navigator.onLine||local.bankBusy||local.creditBusy||!bridge.bankAutoEnabled()||!bridge.getBridgeToken()||!bridge.bankAttemptReady())return false;return refreshBank({interactive:false,auto:true})}
  async function maybeAutoRefreshCredit(){scheduleCreditAuto();if(!tab.primaryTab||!loadSession()||!navigator.onLine||local.bankBusy||local.creditBusy||!bridge.creditAutoEnabled()||!bridge.getBridgeToken()||!bridge.creditAttemptReady())return false;return refreshCredit({interactive:false,auto:true})}
  function startAutoSync(){scheduleBankAuto();scheduleCreditAuto()}
  function setBankAutoEnabled(value){bridge.setBankAutoEnabled(value);scheduleBankAuto()}
  function setCreditAutoEnabled(value){bridge.setCreditAutoEnabled(value);scheduleCreditAuto()}

  return {snapshot,refreshFinanceData,refreshBankBridgeStatus,refreshCreditBridgeStatus,saveBridgeToken,configureBankBridge,selectBankBridgeAccount,deleteBankBridgeCredentials,refreshBank,refreshCredit,saveCreditProfile,deleteCreditProfile,resetCreditSync,setCreditCardMapping,maybeAutoRefreshBank,maybeAutoRefreshCredit,startAutoSync,setBankAutoEnabled,setCreditAutoEnabled,mutateKupaCloud};
}
