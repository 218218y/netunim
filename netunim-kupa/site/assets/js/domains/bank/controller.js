import {uid} from '../../core/values.js';
import {wholeMoney} from '../../core/money.js';
import {todayISO} from '../../core/dates.js';
import {BANK_AUTO_INTERVAL_MS,bankAutoRefreshDue} from './bridge.js';
import {normalizeBankFeed} from './feed.js';

const BANK_BRIDGE_VERSION=25;

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


export function createDomainsBankController({model,session,checksSession,sharedChecksHaveLocalWork,saveState,syncSharedChecksFromCloud,sharedChecksObservedSequence,toast,render,bridge,refreshFinanceCloudSnapshot=async()=>({verified:true,state:model.state}),saveFinancePatch=async()=>({saved:false}),claimFinanceSyncLease=async()=>({acquired:true}),releaseFinanceSyncLease=async()=>true,saveBankSyncSnapshot=null,mergeBankTransactions=async()=>null,readBankTransactions=async()=>[]}){
const bridgeState={checked:false,available:null,configured:false,busy:false,upgradeRequired:false,bridgeVersion:0,branchNumber:'',accountNumber:'',businessBranchNumber:'',businessAccountNumber:'',homeBranchNumber:'',homeAccountNumber:'',availableAccounts:[],accountSelectionRole:'',lastScrapeAt:null,lastError:'',lastErrorAt:null,lastErrorCode:'',lastErrorStage:'',lastErrorHttpStatus:0,lastWarning:'',lastWarningCode:'',lastWarningStage:'',lastWarningHttpStatus:0,availabilityError:'',availabilityErrorAt:null,message:''};
let autoTimer=null;

function accountIdOf(snapshot){return snapshot?.accountId||[snapshot?.branchNumber,snapshot?.accountNumber].filter(Boolean).join('-')||snapshot?.accountNumber||''}
function sharedBankLastSyncAt(state=model.state){const feed=normalizeBankFeed(state?.bank?.feed);return feed?.syncedAt||state?.bank?.bankSyncAt||(state?.bank?.source==='hapoalim'?state?.bank?.updatedAt:null)||null}
function feedFromSnapshot(snapshot,fetchedAt){
  if(!snapshot||!Number.isFinite(Number(snapshot.balance)))return null;
  return normalizeBankFeed({provider:'hapoalim',accountNumber:accountIdOf(snapshot),balance:Number(snapshot.balance),availableBalance:snapshot.availableBalance,creditLimit:snapshot.creditLimit,creditLimitUsed:snapshot.creditLimitUsed,creditLimitUsedPercent:snapshot.creditLimitUsedPercent,syncedAt:fetchedAt,transactions:snapshot.transactions||[],transactionWarning:snapshot.transactionWarning||''});
}
function financeBankPayload(bank){const out={...bank};delete out.adjustments;delete out.snapshotToken;delete out.snapshotSeq;return out}
function applyBridgeAccountFields(target,source={}){
  const businessBranchNumber=source.businessBranchNumber||source.branchNumber||target.businessBranchNumber||target.branchNumber||'';
  const businessAccountNumber=source.businessAccountNumber||source.accountNumber||target.businessAccountNumber||target.accountNumber||'';
  Object.assign(target,{branchNumber:businessBranchNumber,accountNumber:businessAccountNumber,businessBranchNumber,businessAccountNumber,homeBranchNumber:source.homeBranchNumber??target.homeBranchNumber??'',homeAccountNumber:source.homeAccountNumber??target.homeAccountNumber??''});
}

async function commitBankSnapshot(balance,{source='manual',accountNumber=null,bankSyncAt=undefined,bankFeed=undefined,homeBankFeed=undefined,message='יתרת העו״ש נשמרה כצילום מצב חדש'}={}){
  const numeric=Number(balance);
  if(!Number.isFinite(numeric))throw new Error('התקבלה יתרת בנק לא תקינה');
  if(session.connectionMode==='supabase'){
    if(checksSession.sharedChecksBusy||sharedChecksHaveLocalWork())throw new Error('יש להמתין לסנכרון הצקים לפני צילום יתרת עו״ש חדש');
    const synced=await syncSharedChecksFromCloud({quiet:true,required:true});
    if(!synced||checksSession.sharedChecksBusy||sharedChecksHaveLocalWork())throw new Error('צילום היתרה נעצר: לא ניתן לאמת שהצקים מסונכרנים כרגע. נסה שוב לאחר שהענן מסונכרן.');
  }
  const observedSeq=sharedChecksObservedSequence();
  const previousSyncAt=model.state.bank?.bankSyncAt||null;
  const nextSyncAt=bankSyncAt===undefined?previousSyncAt:(bankSyncAt||null);
  const previousFeed=model.state.bank?.feed||null;
  const nextFeed=bankFeed===undefined?previousFeed:normalizeBankFeed(bankFeed);
  const previousHomeFeed=model.state.bank?.homeFeed||null;
  const nextHomeFeed=homeBankFeed===undefined?previousHomeFeed:normalizeBankFeed(homeBankFeed);
  model.state.bank={...model.state.bank,currentBalance:wholeMoney(numeric),updatedAt:new Date().toISOString(),asOfDate:todayISO(),snapshotToken:uid('BANK'),snapshotSeq:observedSeq,adjustments:[],source,sourceAccount:accountNumber||null,bankSyncAt:nextSyncAt,feed:nextFeed,homeFeed:nextHomeFeed};
  return saveState(message);
}

async function saveBankBalance(){
  const el=document.getElementById('bankBalanceInput');
  if(!el||el.value==='')return toast('יש להזין יתרת עו״ש');
  try{await commitBankSnapshot(el.value,{source:'manual'})}catch(e){toast(e.message||String(e))}
}

function bankBridgeUiState(){
  const feed=normalizeBankFeed(model.state.bank?.feed),homeFeed=normalizeBankFeed(model.state.bank?.homeFeed);
  const sharedLastSyncAt=sharedBankLastSyncAt();
  const homeLastSyncAt=homeFeed?.syncedAt||null;
  return {...bridgeState,tokenConfigured:!!bridge.getBridgeToken(),autoEnabled:bridge.autoEnabled(),sharedLastSyncAt,homeLastSyncAt,feed,homeFeed};
}

async function refreshBankBridgeStatus(){
  if(!bridge.getBridgeToken()){
    Object.assign(bridgeState,{checked:true,available:null,configured:false,branchNumber:'',accountNumber:'',businessBranchNumber:'',businessAccountNumber:'',homeBranchNumber:'',homeAccountNumber:'',availableAccounts:[],accountSelectionRole:'',lastError:'',lastErrorAt:null,lastErrorCode:'',lastErrorStage:'',lastErrorHttpStatus:0,lastWarning:'',lastWarningCode:'',lastWarningStage:'',lastWarningHttpStatus:0,availabilityError:'',availabilityErrorAt:null,message:'יש להזין מפתח Bridge כדי לחבר את הקופה לתוכנה המקומית.'});
    return bankBridgeUiState();
  }
  try{
    const s=await bridge.status(),bridgeVersion=Number(s.bridgeVersion||0),upgradeRequired=bridgeVersion<BANK_BRIDGE_VERSION;
    const common={checked:true,available:true,configured:!!s.configured,upgradeRequired,bridgeVersion,availableAccounts:Array.isArray(s.availableAccounts)?s.availableAccounts:[],accountSelectionRole:s.accountRole||'',lastScrapeAt:s.lastScrapeAt||null,lastError:s.lastError||'',lastErrorAt:s.lastErrorAt||null,lastErrorCode:s.lastErrorCode||'',lastErrorStage:s.lastErrorStage||'',lastErrorHttpStatus:Number(s.lastErrorHttpStatus)||0,lastWarning:s.lastWarning||'',lastWarningCode:s.lastWarningCode||'',lastWarningStage:s.lastWarningStage||'',lastWarningHttpStatus:Number(s.lastWarningHttpStatus)||0,availabilityError:'',availabilityErrorAt:null};
    Object.assign(bridgeState,common);applyBridgeAccountFields(bridgeState,s);
    bridgeState.message=upgradeRequired?'מותקנת במחשב גרסת Bank Bridge ישנה. יש להריץ מחדש install_bank_bridge.bat כדי להפעיל סנכרון בטוח של החשבון העסקי והביתי יחד.':s.configured?'החיבור המקומי מוכן.':'Bank Bridge פעיל, אך עדיין לא נשמרו בו פרטי בנק הפועלים.';
  }catch(e){const availabilityError=e.message||String(e);Object.assign(bridgeState,{checked:true,available:false,upgradeRequired:false,availableAccounts:Array.isArray(e.availableAccounts)?e.availableAccounts:[],accountSelectionRole:e.accountRole||'',availabilityError,availabilityErrorAt:new Date().toISOString(),message:availabilityError})}
  return bankBridgeUiState();
}

async function saveBankBridgeToken(){
  const token=document.getElementById('bankBridgeTokenInput')?.value?.trim()||'';
  if(!token)return toast('יש להדביק את מפתח ה-Bridge של המחשב הנוכחי');
  bridge.setBridgeToken(token);
  const input=document.getElementById('bankBridgeTokenInput');if(input)input.value='';
  Object.assign(bridgeState,{checked:false,available:null,availableAccounts:[],accountSelectionRole:'',lastError:'',lastErrorAt:null,lastErrorCode:'',lastErrorStage:'',lastErrorHttpStatus:0,availabilityError:'',availabilityErrorAt:null,message:'מפתח המחשב נשמר בדפדפן זה. בודק את ה-Bridge…'});
  render();
  await refreshBankBridgeStatus();render();
  if(bridgeState.available)toast('מפתח ה-Bridge נשמר והמחשב מחובר');
}

async function configureBankBridge(){
  const typedToken=document.getElementById('bankBridgeTokenInput')?.value?.trim()||'';
  if(typedToken)bridge.setBridgeToken(typedToken);
  const token=bridge.getBridgeToken();
  const userCode=document.getElementById('bankUserCodeInput')?.value?.trim()||'';
  const password=document.getElementById('bankPasswordInput')?.value||'';
  const businessBranchNumber=document.getElementById('bankBusinessBranchNumberInput')?.value?.trim()||'';
  const businessAccountNumber=document.getElementById('bankBusinessAccountNumberInput')?.value?.trim()||'';
  const homeBranchNumber=document.getElementById('bankHomeBranchNumberInput')?.value?.trim()||'';
  const homeAccountNumber=document.getElementById('bankHomeAccountNumberInput')?.value?.trim()||'';
  if(!token)return toast('יש לשמור קודם את מפתח ה-Bridge של המחשב הנוכחי');
  if(!userCode||!password)return toast('יש להזין קוד משתמש וסיסמה של בנק הפועלים');
  if((businessBranchNumber&&!businessAccountNumber)||(!businessBranchNumber&&businessAccountNumber))return toast('לחשבון העסקי יש להזין גם סניף וגם מספר חשבון');
  if((homeBranchNumber&&!homeAccountNumber)||(!homeBranchNumber&&homeAccountNumber))return toast('לחשבון הביתי יש להזין גם סניף וגם מספר חשבון');
  if(businessBranchNumber&&homeBranchNumber&&businessBranchNumber.replace(/\D/g,'')===homeBranchNumber.replace(/\D/g,'')&&businessAccountNumber.replace(/\D/g,'')===homeAccountNumber.replace(/\D/g,''))return toast('החשבון העסקי והחשבון הביתי חייבים להיות שני חשבונות שונים');
  bridgeState.busy=true;render();
  try{
    const r=await bridge.configureCredentials({token,userCode,password,businessBranchNumber,businessAccountNumber,homeBranchNumber,homeAccountNumber});
    Object.assign(bridgeState,{available:true,configured:true,upgradeRequired:false,bridgeVersion:Math.max(BANK_BRIDGE_VERSION,bridgeState.bridgeVersion||0),availableAccounts:[],accountSelectionRole:'',lastError:'',lastErrorAt:null,lastErrorCode:'',lastErrorStage:'',lastErrorHttpStatus:0,lastWarning:'',lastWarningCode:'',lastWarningStage:'',lastWarningHttpStatus:0,message:'פרטי ההתחברות ושני החשבונות נשמרו מוצפנים במחשב המקומי.'});applyBridgeAccountFields(bridgeState,r);
    toast(homeAccountNumber?'החיבור לבנק הפועלים נשמר. רענון יעדכן יחד את החשבון העסקי והביתי.':'החיבור לבנק הפועלים נשמר. אפשר להוסיף גם את החשבון הביתי בהגדרות.');
  }catch(e){bridgeState.lastError=e.message||String(e);bridgeState.lastErrorAt=new Date().toISOString();bridgeState.lastErrorCode=e.code||'';bridgeState.lastErrorStage=e.stage||'';bridgeState.lastErrorHttpStatus=Number(e.httpStatus)||0;bridgeState.availableAccounts=Array.isArray(e.availableAccounts)?e.availableAccounts:[];bridgeState.accountSelectionRole=e.accountRole||'';toast(bridgeState.lastError)}
  finally{bridgeState.busy=false;render()}
}

async function selectBankBridgeAccount(role,branchNumber,accountNumber){
  const targetRole=role==='home'?'home':'business',branch=String(branchNumber||'').replace(/\D/g,''),account=String(accountNumber||'').replace(/\D/g,'');
  if(!branch||!account)return toast('לא התקבל סניף/חשבון תקין לבחירה');
  if(bridgeState.busy)return false;
  bridgeState.busy=true;render();
  try{
    const r=await bridge.selectAccount({role:targetRole,branchNumber:branch,accountNumber:account});
    Object.assign(bridgeState,{configured:true,availableAccounts:[],accountSelectionRole:'',lastError:'',lastErrorAt:null,lastErrorCode:'',lastErrorStage:'',lastErrorHttpStatus:0,lastWarning:'',lastWarningCode:'',lastWarningStage:'',lastWarningHttpStatus:0,message:`נבחר חשבון ${targetRole==='home'?'ביתי':'עסקי'}: סניף ${branch}, חשבון ${account}. אפשר לרענן כעת.`});applyBridgeAccountFields(bridgeState,r);
    toast(`נבחר חשבון ${targetRole==='home'?'ביתי':'עסקי'} ${branch}-${account}`);
    return true;
  }catch(e){
    bridgeState.lastError=e.message||String(e);bridgeState.lastErrorAt=new Date().toISOString();bridgeState.lastErrorCode=e.code||'';bridgeState.lastErrorStage=e.stage||'';bridgeState.lastErrorHttpStatus=Number(e.httpStatus)||0;bridgeState.availableAccounts=Array.isArray(e.availableAccounts)?e.availableAccounts:bridgeState.availableAccounts;bridgeState.accountSelectionRole=e.accountRole||targetRole;toast(bridgeState.lastError);return false;
  }finally{bridgeState.busy=false;render()}
}

async function deleteBankBridgeCredentials(){
  bridgeState.busy=true;render();
  try{await bridge.deleteCredentials();Object.assign(bridgeState,{configured:false,branchNumber:'',accountNumber:'',businessBranchNumber:'',businessAccountNumber:'',homeBranchNumber:'',homeAccountNumber:'',availableAccounts:[],accountSelectionRole:'',lastError:'',lastErrorAt:null,lastErrorCode:'',lastErrorStage:'',lastErrorHttpStatus:0,lastWarning:'',lastWarningCode:'',lastWarningStage:'',lastWarningHttpStatus:0,message:'פרטי ההתחברות נמחקו מהמחשב המקומי.'});toast('פרטי בנק הפועלים נמחקו מה-Bank Bridge')}
  catch(e){bridgeState.lastError=e.message||String(e);bridgeState.lastErrorAt=new Date().toISOString();bridgeState.lastErrorCode=e.code||'';bridgeState.lastErrorStage=e.stage||'';toast(bridgeState.lastError)}
  finally{bridgeState.busy=false;render()}
}

function setBankAutoRefresh(enabled){bridge.setAutoEnabled(!!enabled);toast(enabled?'עדכון אוטומטי כל 4 שעות הופעל':'עדכון אוטומטי כובה');maybeAutoRefreshBankBalance()}

async function refreshBankBalance({interactive=false,auto=false}={}){
  if(bridgeState.busy)return false;
  if(!bridge.getBridgeToken()){if(!auto)toast('החיבור לבנק עדיין לא הוגדר');return false}
  if(bridgeState.upgradeRequired){if(!auto)toast('יש להריץ מחדש install_bank_bridge.bat במחשב זה לפני עדכון מול הבנק');return false}
  bridgeState.busy=true;bridgeState.lastError='';bridgeState.lastErrorAt=null;bridgeState.lastErrorCode='';bridgeState.lastErrorStage='';bridgeState.lastErrorHttpStatus=0;bridgeState.lastWarning='';bridgeState.lastWarningCode='';bridgeState.lastWarningStage='';bridgeState.lastWarningHttpStatus=0;bridgeState.accountSelectionRole='';
  bridgeState.message=interactive?'חלון האימות בבנק פתוח. לאחר האימות ה-Bridge יעדכן באותו סשן את החשבון העסקי ואת החשבון הביתי.':auto?'מעדכן אוטומטית את שני חשבונות בנק הפועלים…':'מעדכן יתרות ותנועות בשני חשבונות בנק הפועלים…';
  render();
  let leaseToken='',leaseHeld=false;
  try{
    if(auto){
      const latest=await refreshFinanceCloudSnapshot();
      if(!latest?.verified){bridge.markAutoAttempt();throw new Error('לא ניתן לאמת את זמן סנכרון הבנק המשותף בענן');}
      if(!bankAutoRefreshDue(sharedBankLastSyncAt(latest.state||model.state))){bridge.markAutoAttempt();return true}
      bridge.markAutoAttempt();
    }
    leaseToken=uid('FINLEASE');
    const lease=await claimFinanceSyncLease('bank',leaseToken);leaseHeld=lease?.acquired===true;
    if(!leaseHeld){bridgeState.message='סינכרון הבנק כבר מתבצע ממחשב או חלון אחר; לא נפתחה כניסה נוספת לבנק.';if(!auto)toast(bridgeState.message);return false}
    const finance=await refreshFinanceCloudSnapshot();
    if(auto){if(!finance?.verified)throw new Error('לא ניתן לאמת מחדש את זמן סנכרון הבנק לאחר תפיסת הנעילה');if(!bankAutoRefreshDue(sharedBankLastSyncAt(finance.state||model.state)))return true}
    const archiveInitialized=finance?.state?.bank?.archiveInitialized===true,archiveVersion=Number(finance?.state?.bank?.archiveVersion||0),archiveReady=archiveInitialized&&archiveVersion>=2;
    const cloudArchive=session.connectionMode==='supabase',historyDays=cloudArchive&&!auto&&!archiveReady?365:30;
    const result=await bridge.fetchBalance({interactive,historyDays}),business=result.accounts?.business||result,home=result.accounts?.home??null,homeFailure=result.accountFailures?.home||null;
    if(!Number.isFinite(Number(business?.balance)))throw new Error('Bank Bridge לא החזיר יתרה עסקית תקינה');
    if(home&&!Number.isFinite(Number(home.balance)))throw new Error('Bank Bridge לא החזיר יתרה ביתית תקינה');
    const fetchedAt=result.fetchedAt||new Date().toISOString(),businessAccount=accountIdOf(business),homeAccount=home?accountIdOf(home):'';
    let businessArchive=Array.isArray(business.transactions)?business.transactions:[],homeArchive=home&&Array.isArray(home.transactions)?home.transactions:[],archiveAudit=null;
    if(cloudArchive){
      const businessMerge=await mergeBankTransactions(businessAccount,'business',business.transactions||[]),homeMerge=home&&homeAccount?await mergeBankTransactions(homeAccount,'home',home.transactions||[]):null;
      businessArchive=await readBankTransactions(businessAccount,'business',{days:370});homeArchive=homeAccount?await readBankTransactions(homeAccount,'home',{days:370}):[];
      const requireExactArchive=historyDays>=365,businessAudit=assertBankArchiveCoverage(businessMerge,businessArchive,{role:'עסקי',requireExactCount:requireExactArchive}),homeAudit=home&&homeAccount?assertBankArchiveCoverage(homeMerge,homeArchive,{role:'ביתי',requireExactCount:requireExactArchive}):null;
      archiveAudit={version:2,verifiedAt:fetchedAt,historyDays,business:{...businessAudit,accountKey:businessAccount},home:homeAudit?{...homeAudit,accountKey:homeAccount}:null};
    }
    const businessFeed=feedFromSnapshot({...business,transactions:businessArchive},fetchedAt),homeFeed=home?feedFromSnapshot({...home,transactions:homeArchive},fetchedAt):null;
    const warnings=[business?.transactionWarning?`עסקי: ${business.transactionWarning}`:'',home?.transactionWarning?`ביתי: ${home.transactionWarning}`:'',homeFailure?.message?`ביתי: ${homeFailure.message}`:''].filter(Boolean);
    const previousBank=model.state.bank&&typeof model.state.bank==='object'?model.state.bank:{};
    const exactBackfillVerified=cloudArchive&&historyDays>=365&&!business.transactionWarning&&!homeFailure&&(!home||!home.transactionWarning),archiveBaselineAudit=exactBackfillVerified?archiveAudit:(previousBank.archiveBaselineAudit||null);
    const nextBank={...previousBank,currentBalance:wholeMoney(business.balance),availableBalance:Number.isFinite(Number(business.availableBalance))?Number(business.availableBalance):null,creditLimit:Number.isFinite(Number(business.creditLimit))?Number(business.creditLimit):null,creditLimitUsed:Number.isFinite(Number(business.creditLimitUsed))?Number(business.creditLimitUsed):null,creditLimitUsedPercent:Number.isFinite(Number(business.creditLimitUsedPercent))?Number(business.creditLimitUsedPercent):null,updatedAt:new Date().toISOString(),asOfDate:todayISO(),snapshotToken:uid('BANK'),snapshotSeq:sharedChecksObservedSequence(),adjustments:[],source:'hapoalim',sourceAccount:businessAccount||null,bankSyncAt:fetchedAt,feed:businessFeed,homeFeed:home?homeFeed:(homeFailure?previousBank.homeFeed??null:null),archiveInitialized:cloudArchive?(archiveReady||exactBackfillVerified):previousBank.archiveInitialized===true,archiveVersion:exactBackfillVerified?2:archiveVersion,archiveInitializedAt:cloudArchive?(archiveReady?previousBank.archiveInitializedAt||null:(exactBackfillVerified?fetchedAt:null)):(previousBank.archiveInitializedAt||null),archiveAudit:cloudArchive?archiveAudit:(previousBank.archiveAudit||null),archiveBaselineAudit:cloudArchive?archiveBaselineAudit:(previousBank.archiveBaselineAudit||null)};
    if(session.connectionMode==='supabase'&&typeof saveBankSyncSnapshot==='function'){
      await saveBankSyncSnapshot(financeBankPayload(nextBank),nextBank.snapshotToken,nextBank.snapshotSeq);
      model.state.bank=nextBank;
      const refreshed=await refreshFinanceCloudSnapshot();
      if(!refreshed?.verified)bridgeState.lastWarning='הנתונים נשמרו בענן בשלמותם, אך הרענון המקומי לאחר השמירה לא אומת. פתיחה מחדש תטען את העותק בענן.';
      toast(historyDays>=365?'ארכיון הבנק אומת ואותחל בכתיבה אטומית':auto?'נתוני הבנק עודכנו':'נתוני הבנק עודכנו ונשמרו בארכיון נפרד');
    }else{
      await saveFinancePatch(state=>({...state,bank:financeBankPayload(nextBank)}));
      model.state.bank=nextBank;
      await saveState(historyDays>=365?'ארכיון הבנק אותחל והופרד מגיבויי הקופה':auto?'נתוני הבנק עודכנו':'נתוני הבנק עודכנו ונשמרו בארכיון נפרד');
    }
    Object.assign(bridgeState,{available:true,configured:true,upgradeRequired:false,bridgeVersion:Math.max(BANK_BRIDGE_VERSION,bridgeState.bridgeVersion||0),availableAccounts:Array.isArray(homeFailure?.availableAccounts)?homeFailure.availableAccounts:[],accountSelectionRole:homeFailure?'home':'',lastScrapeAt:fetchedAt,lastError:'',lastErrorAt:null,lastErrorCode:'',lastErrorStage:'',lastErrorHttpStatus:0,lastWarning:warnings.join(' | '),lastWarningCode:homeFailure?.code||'',lastWarningStage:homeFailure?.stage||'',lastWarningHttpStatus:Number(homeFailure?.httpStatus)||0,message:homeFailure?'החשבון העסקי עודכן בהצלחה; החשבון הביתי לא עודכן ונשמר הנתון הביתי האחרון.':warnings.length?'היתרות עודכנו בהצלחה; קיימת אזהרה לגבי חלק מהתנועות.':home?'שני החשבונות והפעילות האחרונה התקבלו בהצלחה מבנק הפועלים.':'החשבון העסקי והתנועות האחרונות התקבלו בהצלחה מבנק הפועלים.'});
    applyBridgeAccountFields(bridgeState,{businessBranchNumber:business.branchNumber,businessAccountNumber:business.accountNumber,homeBranchNumber:home?.branchNumber??bridgeState.homeBranchNumber,homeAccountNumber:home?.accountNumber??bridgeState.homeAccountNumber});
    if(homeFailure&&!auto)toast('החשבון העסקי עודכן. החשבון הביתי לא עודכן; הנתון הביתי הקודם נשמר ופרטי התקלה מוצגים במסך הבנק.');
    else if(warnings.length&&!auto)toast('היתרות עודכנו. חלק מהתנועות לא נטענו במלואן; פרטי האזהרה מוצגים במסך הבנק.');
    return true;
  }catch(e){
    bridgeState.lastError=e.message||String(e);bridgeState.lastErrorAt=new Date().toISOString();bridgeState.lastErrorCode=e.code||'';bridgeState.lastErrorStage=e.stage||'';bridgeState.lastErrorHttpStatus=Number(e.httpStatus)||0;bridgeState.availableAccounts=Array.isArray(e.availableAccounts)?e.availableAccounts:[];bridgeState.accountSelectionRole=e.accountRole||'';bridgeState.message=bridgeState.lastError;
    if(!auto)toast(bridgeState.lastError);
    return false;
  }finally{if(leaseHeld)try{await releaseFinanceSyncLease('bank',leaseToken)}catch(error){console.error('bank sync lease release',error)}bridgeState.busy=false;render()}
}

function maybeAutoRefreshBankBalance(){
  if(autoTimer){clearTimeout(autoTimer);autoTimer=null}
  if(!session.backendReady||!bridge.autoEnabled()||!bridge.getBridgeToken()||bridgeState.busy)return;
  const now=Date.now(),lastSyncAt=sharedBankLastSyncAt(),lastSyncMs=lastSyncAt?Date.parse(lastSyncAt):NaN;
  if(!bankAutoRefreshDue(lastSyncAt,now)){
    const dueIn=Math.max(1000,lastSyncMs+BANK_AUTO_INTERVAL_MS-now+250);autoTimer=setTimeout(maybeAutoRefreshBankBalance,dueIn);return;
  }
  const retryIn=bridge.autoAttemptDelayMs(now);
  if(retryIn>0){autoTimer=setTimeout(maybeAutoRefreshBankBalance,Math.max(1000,retryIn+250));return}
  autoTimer=setTimeout(()=>{autoTimer=null;refreshBankBalance({interactive:false,auto:true}).catch(e=>console.error('bank auto refresh',e))},300);
}

return {saveBankBalance,bankBridgeUiState,refreshBankBridgeStatus,saveBankBridgeToken,configureBankBridge,selectBankBridgeAccount,deleteBankBridgeCredentials,setBankAutoRefresh,refreshBankBalance,maybeAutoRefreshBankBalance,commitBankSnapshot};
}
