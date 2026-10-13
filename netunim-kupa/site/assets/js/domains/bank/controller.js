import {createBridgePairingScope} from '../../shared/bridge-pairing-scope.js';
import {createRuntimeTaskOwner} from '../../shared/runtime-task-owner.js';
import {readBankBalanceResult,bankSnapshotFinancials} from '../../shared/bank-balance-result.js';
import {bankRecurringDebitHistoryData} from '../../shared/bank-recurring-debits.js';
import {BANK_READOUT_WARNING} from './snapshot-commands.js';
import {startFinanceLeaseHeartbeat} from '../../shared/finance-lease-heartbeat.js';
import {createPollingTask} from '../../shared/runtime-polling.js';
import {uid} from '../../core/values.js';
import {wholeMoney} from '../../core/money.js';
import {todayISO} from '../../core/dates.js';
import {BANK_AUTO_INTERVAL_MS,bankAutoRefreshDue} from '../../shared/finance-refresh-policy.js';
import {normalizeBankFeed} from './feed.js';
import {projectBankArchiveFeed} from './archive-model.js';

const BANK_BRIDGE_VERSION=74;

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
    const detailsOk=!!row&&canonicalJson(tx.checkDetails??null)===canonicalJson(row.checkDetails??null)&&canonicalJson(tx.creditSettlementDetails??null)===canonicalJson(row.creditSettlementDetails??null)&&Boolean(tx.cheque)===Boolean(row.cheque);
    if(!coreOk||!detailsOk)throw new Error(`אימות ארכיון הבנק נכשל (${role||'חשבון'}): תנועת מקור לא נקראה חזרה בשלמותה (${tx.mergeKey||'ללא מזהה'})`);
  }
  const total=Number(mergeResult?.result?.total_count);
  if(requireExactCount&&(!Number.isSafeInteger(total)||total!==source.length))throw new Error(`אימות backfill נכשל (${role||'חשבון'}): הבנק החזיר ${source.length} תנועות אך הארכיון מכיל ${Number.isFinite(total)?total:'מספר לא תקין'}`);
  return {sourceCount:source.length,archiveCount:Number.isSafeInteger(total)?total:rows.length,insertedCount:Number(mergeResult?.result?.inserted_count)||0,updatedCount:Number(mergeResult?.result?.updated_count)||0,verifiedAt:new Date().toISOString(),exactCount:!!requireExactCount};
}

export function createDomainsBankController({
  model,
  session,
  sharedChecksHaveLocalWork,
  sharedChecksObservedSequence,
  toast,
  render,
  bridge,
  autoScope,
  operationScope,
  effects,
  timers=globalThis,
  syncBankTransactionsSnapshot=async()=>null,
  acknowledgeBankTransactionMissing=async()=>null,
  syncBankChequeImages=async()=>({ok:true,warnings:[]}),
  archive,
  readFinance,
  syncLeases,
  snapshots,
}){
const bridgeState={checked:false,available:null,configured:false,busy:false,resultReady:false,upgradeRequired:false,bridgeVersion:0,branchNumber:'',accountNumber:'',businessBranchNumber:'',businessAccountNumber:'',homeBranchNumber:'',homeAccountNumber:'',availableAccounts:[],accountSelectionRole:'',lastScrapeAt:null,lastError:'',lastErrorAt:null,lastErrorCode:'',lastErrorStage:'',lastErrorHttpStatus:0,lastWarning:'',lastWarningCode:'',lastWarningStage:'',lastWarningHttpStatus:0,availabilityError:'',availabilityErrorAt:null,message:''};
if(typeof autoScope!=='function')throw new Error('bank_auto_scope_required');
if(typeof operationScope?.capture!=='function'||typeof operationScope?.captureRead!=='function')throw new Error('bank_operation_scope_required');
if(typeof effects?.saveJson!=='function')throw new TypeError('bank_effects_required');

for (const method of ['prepare','commitManual','publishCloud','publishLocal','retryLocal'])
  if (typeof snapshots?.commands?.[method] !== 'function')
    throw new TypeError('kupa_bank_snapshot_command_' + method + '_required');
if (typeof snapshots?.queries?.localState !== 'function')
  throw new TypeError('kupa_bank_snapshot_query_required');
if (typeof readFinance !== 'function') throw new TypeError('kupa_bank_finance_read_required');
for (const method of ['claim','release'])
  if (typeof syncLeases?.[method] !== 'function')
    throw new TypeError('kupa_bank_lease_' + method + '_required');
const prepareBankSnapshot = snapshots.commands.prepare, commitBankSnapshot = snapshots.commands.commitManual;
const localSnapshot = {state:snapshots.queries.localState,retry:snapshots.commands.retryLocal};
const refreshFinanceCloudSnapshot = readFinance;
const claimFinanceSyncLease = syncLeases.claim, releaseFinanceSyncLease = syncLeases.release;
let disposed=false;
const workOwner=createRuntimeTaskOwner(),pairingScope=createBridgePairingScope({readToken:()=>bridge.getBridgeToken()});
function track(work){return disposed?Promise.resolve(false):workOwner.run(work)}
let automaticActive=true,automaticOwner=null;
const automaticAllowed=()=>{
  const scope=autoScope();if(disposed||!automaticActive||localSnapshot.state()||typeof scope!=='string'||!scope.length)return false;
  if(automaticOwner===null)automaticOwner=scope;
  return scope===automaticOwner&&session.backendReady&&!bridgeState.upgradeRequired&&bridge.autoEnabled()&&!!bridge.getBridgeToken();
};
const autoTask=createPollingTask({timers,canRun:automaticAllowed,delay:autoDelay,run:({isCurrent})=>track(()=>refreshBankBalance({interactive:false,auto:true,isCurrent})),onError:error=>console.error('bank auto refresh',error)});

const scopeChanged=error=>error?.code==='FINANCE_OPERATION_SCOPE_CHANGED'||error?.code==='BRIDGE_PAIRING_SCOPE_CHANGED';
for (const [group,methods] of Object.entries({
  queries:['matching','readSnapshot'], commands:['publish','invalidate'], runtime:['ensure','pause','resume'],
}))
  for (const method of methods)
    if (typeof archive?.[group]?.[method] !== 'function')
      throw new TypeError('kupa_bank_archive_' + group + '_' + method + '_required');
const ensureBankDisplayArchive = archive.runtime.ensure;
const displayArchiveFeed = (role,feed) => projectBankArchiveFeed(archive,role,feed);

function accountIdOf(snapshot){return snapshot?.accountId||[snapshot?.branchNumber,snapshot?.accountNumber].filter(Boolean).join('-')||snapshot?.accountNumber||''}
function completeTransactionCoverage(snapshot){
  const coverage=snapshot?.transactionCoverage&&typeof snapshot.transactionCoverage==='object'?snapshot.transactionCoverage:{},from=String(coverage.from||''),to=String(coverage.to||''),valid=/^\d{4}-\d{2}-\d{2}$/.test(from)&&/^\d{4}-\d{2}-\d{2}$/.test(to)&&from<=to,warning=String(snapshot?.transactionWarning||'');
  return {complete:coverage.complete===true&&!warning&&valid,from:valid?from:null,to:valid?to:null,days:Number(coverage.days)||null,warning};
}
function sharedBankLastSyncAt(state=model.state){const feed=normalizeBankFeed(state?.bank?.feed);return feed?.syncedAt||state?.bank?.bankSyncAt||(state?.bank?.source==='hapoalim'?state?.bank?.updatedAt:null)||null}
function feedFromSnapshot(snapshot,fetchedAt,role){
  if(!snapshot||!Number.isFinite(Number(snapshot.balance)))return null;
  const feed=normalizeBankFeed({provider:'hapoalim',accountNumber:accountIdOf(snapshot),balance:Number(snapshot.balance),availableBalance:snapshot.availableBalance,creditLimit:snapshot.creditLimit,creditLimitUsed:snapshot.creditLimitUsed,creditLimitUsedPercent:snapshot.creditLimitUsedPercent,syncedAt:fetchedAt,transactions:snapshot.transactions||[],transactionWarning:snapshot.transactionWarning||''});
  const previous=role==='home'?model.state.bank?.homeFeed:model.state.bank?.feed;
  feed.recurringDebitHistory=bankRecurringDebitHistoryData(previous,feed,role,completeTransactionCoverage(snapshot));
  return feed;
}

function applyBridgeAccountFields(target,source={}){
  const businessBranchNumber=source.businessBranchNumber||source.branchNumber||target.businessBranchNumber||target.branchNumber||'';
  const businessAccountNumber=source.businessAccountNumber||source.accountNumber||target.businessAccountNumber||target.accountNumber||'';
  Object.assign(target,{branchNumber:businessBranchNumber,accountNumber:businessAccountNumber,businessBranchNumber,businessAccountNumber,homeBranchNumber:source.homeBranchNumber??target.homeBranchNumber??'',homeAccountNumber:source.homeAccountNumber??target.homeAccountNumber??''});
}



async function retryLocalBankSnapshot(){
  try{const saved=await localSnapshot.retry();if(saved&&automaticActive)autoTask.start();return saved}
  catch(error){toast(error?.code==='FINANCE_OPERATION_SCOPE_CHANGED'?error.message:'לא ניתן לאשר את הצילום הקיים. יש לבדוק את מצב האחסון; לא בוצעה סריקה נוספת מהבנק.');return false}
}

function bankBridgeUiState(){
  const feed=displayArchiveFeed('business',model.state.bank?.feed),homeFeed=displayArchiveFeed('home',model.state.bank?.homeFeed);
  const sharedLastSyncAt=sharedBankLastSyncAt();
  const homeLastSyncAt=homeFeed?.syncedAt||null;
  const local=localSnapshot.state();
  return {...bridgeState,...(local&&local.phase!=='saving'?{lastError:local.message}:{}),localSnapshot:local,tokenConfigured:!!bridge.getBridgeToken(),autoEnabled:bridge.autoEnabled(),sharedLastSyncAt,homeLastSyncAt,feed,homeFeed};
}

let bridgeStatusPromise=null,bridgeStatusToken=null,bridgeStatusCheckedAt=0;
async function refreshBankBridgeStatus({force=true}={}){
  const token=bridge.getBridgeToken(),now=Date.now();
  if(bridgeStatusPromise){await bridgeStatusPromise;if(token!==bridgeStatusToken)return refreshBankBridgeStatus({force});return bankBridgeUiState()}
  if(!force&&token===bridgeStatusToken&&now>=bridgeStatusCheckedAt&&now-bridgeStatusCheckedAt<15000)return bankBridgeUiState();
  bridgeStatusToken=token;
  bridgeStatusPromise=readBankBridgeStatus();
  try{return await bridgeStatusPromise}finally{bridgeStatusCheckedAt=Date.now();bridgeStatusPromise=null}
}
async function readBankBridgeStatus(){
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

async function saveBankBridgeToken(value){
  const token=String(value||'').trim();
  if(!token)return toast('יש להדביק את מפתח ה-Bridge של המחשב הנוכחי');
  bridge.setBridgeToken(token);
  Object.assign(bridgeState,{checked:false,available:null,availableAccounts:[],accountSelectionRole:'',lastError:'',lastErrorAt:null,lastErrorCode:'',lastErrorStage:'',lastErrorHttpStatus:0,availabilityError:'',availabilityErrorAt:null,message:'מפתח המחשב נשמר בדפדפן זה. בודק את ה-Bridge…'});
  render();
  await refreshBankBridgeStatus();render();
  if(bridgeState.available)toast('מפתח ה-Bridge נשמר והמחשב מחובר');
}

async function configureBankBridge(input={}){
  const typedToken=String(input.token||'').trim();
  if(typedToken)bridge.setBridgeToken(typedToken);
  const token=bridge.getBridgeToken();
  const userCode=String(input.userCode||'').trim(),password=String(input.password||'');
  const businessBranchNumber=String(input.businessBranchNumber||'').trim(),businessAccountNumber=String(input.businessAccountNumber||'').trim();
  const homeBranchNumber=String(input.homeBranchNumber||'').trim(),homeAccountNumber=String(input.homeAccountNumber||'').trim();
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

async function exportBankChequeDiagnostics(){
  if(bridgeState.busy)return false;
  if(!bridge.getBridgeToken()){toast('יש לצמד את הקופה ל-Bank Bridge לפני ייצוא אבחון');return false}
  try{
    const result=await bridge.bankDiagnostics();
    if(!result?.available||!result?.data)throw new Error(result?.message||'עדיין אין אבחון בנק מקומי. בצע רענון בנק ולאחריו נסה שוב.');
    effects.saveJson(result.filename,result.data,'netunim-bank-diagnostic.json');
    toast(`קובץ אבחון בנק JSON נוצר מהסנכרון האחרון (${Number(result.transactionCount)||0} תנועות)`);return true;
  }catch(error){toast(error?.message||'ייצוא אבחון הבנק נכשל');return false}
}

function setBankAutoRefresh(enabled){bridge.setAutoEnabled(!!enabled);toast(enabled?'עדכון אוטומטי כל 4 שעות הופעל':'עדכון אוטומטי כובה');if(enabled)startAutoSync();else stopAutoSync()}

async function refreshBankBalance({interactive=false,auto=false,isCurrent=()=>true}={}){
  const pending=localSnapshot.state();if(pending){if(!auto)toast(pending.message);return false}
  const scope=auto?autoScope():null,allowed=()=>isCurrent()&&automaticAllowed()&&autoScope()===scope;
  if(auto&&!allowed())return false;
  if(bridgeState.busy)return false;
  if(!bridge.getBridgeToken()){if(!auto)toast('החיבור לבנק עדיין לא הוגדר');return false}
  if(bridgeState.upgradeRequired){if(!auto)toast('יש להריץ מחדש install_bank_bridge.bat במחשב זה לפני עדכון מול הבנק');return false}
  archive.runtime.pause();
  bridgeState.busy=true;bridgeState.resultReady=false;bridgeState.lastError='';bridgeState.lastErrorAt=null;bridgeState.lastErrorCode='';bridgeState.lastErrorStage='';bridgeState.lastErrorHttpStatus=0;bridgeState.lastWarning='';bridgeState.lastWarningCode='';bridgeState.lastWarningStage='';bridgeState.lastWarningHttpStatus=0;bridgeState.accountSelectionRole='';
  bridgeState.message=interactive?'חלון האימות בבנק פתוח. לאחר האימות ה-Bridge יעדכן באותו סשן את החשבון העסקי ואת החשבון הביתי.':auto?'מעדכן אוטומטית את שני חשבונות בנק הפועלים…':'מעדכן יתרות ותנועות בשני חשבונות בנק הפועלים…';
  let leaseToken='',leaseHeld=false,lease=null,heartbeat=null,assertOwner,assertConnection;
  const assertCurrent=()=>{assertOwner();assertConnection();heartbeat?.assertCurrent()};
  try{
    assertOwner=operationScope.capture();assertConnection=pairingScope.capture();render();
    if(auto){
      const latest=await refreshFinanceCloudSnapshot({assertCurrent});assertCurrent();
      if(!allowed())return false;
      if(!latest?.verified){bridge.markAutoAttempt();throw new Error('לא ניתן לאמת את זמן סנכרון הבנק המשותף בענן');}
      if(!bankAutoRefreshDue(sharedBankLastSyncAt(latest.state||model.state))){bridge.markAutoAttempt();return true}
      bridge.markAutoAttempt();
    }
    leaseToken=uid('FINLEASE');
    lease=await claimFinanceSyncLease('bank',leaseToken,{assertCurrent:assertOwner});leaseHeld=lease?.acquired===true;assertCurrent();
    lease={...lease,assertCurrent};
    if(auto&&!allowed())return false;
    if(!leaseHeld){bridgeState.message='סינכרון הבנק כבר מתבצע ממחשב או חלון אחר; לא נפתחה כניסה נוספת לבנק.';if(!auto)toast(bridgeState.message);return false}
    heartbeat=startFinanceLeaseHeartbeat({...lease,assertCurrent:assertOwner},claimFinanceSyncLease,{setTimer:timers.setTimeout.bind(timers),clearTimer:timers.clearTimeout.bind(timers)});
    const finance=await refreshFinanceCloudSnapshot({assertCurrent});assertCurrent();
    if(auto){if(!allowed())return false;if(!finance?.verified)throw new Error('לא ניתן לאמת מחדש את זמן סנכרון הבנק לאחר תפיסת הנעילה');if(!bankAutoRefreshDue(sharedBankLastSyncAt(finance.state||model.state)))return true}
    const archiveInitialized=finance?.state?.bank?.archiveInitialized===true,archiveVersion=Number(finance?.state?.bank?.archiveVersion||0),archiveReady=archiveInitialized&&archiveVersion>=2;
    const cloudArchive=session.connectionMode==='supabase',historyDays=cloudArchive&&!auto&&!archiveReady?365:30;
    await prepareBankSnapshot(assertCurrent);
    assertCurrent();
    if(auto&&!allowed())return false;
    const bridgeStatus=await bridge.status();assertCurrent();
    bridgeState.bridgeVersion=Number(bridgeStatus?.bridgeVersion||0);bridgeState.upgradeRequired=bridgeState.bridgeVersion<BANK_BRIDGE_VERSION;
    if(bridgeState.upgradeRequired)throw new Error('יש להריץ מחדש install_bank_bridge.bat במחשב זה לפני עדכון מול הבנק');
    const result=await bridge.fetchBalance({interactive,historyDays});assertCurrent();
    const {business,home,homeFailure}=readBankBalanceResult(result);
    const fetchedAt=result.fetchedAt||new Date().toISOString(),businessAccount=accountIdOf(business),homeAccount=home?accountIdOf(home):'';
    let businessArchive=Array.isArray(business.transactions)?business.transactions:[],homeArchive=home&&Array.isArray(home.transactions)?home.transactions:[],archiveAudit=null,imageSyncWarning='',archiveCandidate=null;
    if(cloudArchive){
      const businessCoverage=completeTransactionCoverage(business),homeCoverage=home?completeTransactionCoverage(home):null;
      const businessMerge=await syncBankTransactionsSnapshot(businessAccount,'business',business.transactions||[],{lease,snapshotAt:fetchedAt,coverage:businessCoverage,complete:businessCoverage.complete});assertCurrent();
      const homeMerge=home&&homeAccount?await syncBankTransactionsSnapshot(homeAccount,'home',home.transactions||[],{lease,snapshotAt:fetchedAt,coverage:homeCoverage,complete:homeCoverage?.complete===true}):null;assertCurrent();
      try{const imageSync=await syncBankChequeImages([...(business.transactions||[]),...(home?.transactions||[])],{assertCurrent});assertCurrent();if(imageSync?.warnings?.length)imageSyncWarning=`תמונות שיקים: ${imageSync.warnings.join(' | ')}`}catch(error){assertCurrent();if(scopeChanged(error))throw error;imageSyncWarning=`תמונות שיקים לא סונכרנו לענן: ${error?.message||error}`}
      const verified = await archive.queries.readSnapshot([
        {role:'business',accountKey:String(businessAccount||'')},
        ...(homeAccount ? [{role:'home',accountKey:String(homeAccount)}] : []),
      ],{days:370,assertCurrent});
      const nextBusinessArchive=verified[0].rows,nextBusinessDirect=verified[0].directSnapshot;
      const nextHomeArchive=verified[1]?.rows||[],nextHomeDirect=verified[1]?.directSnapshot??null;
      assertCurrent();
      businessArchive=nextBusinessArchive;homeArchive=nextHomeArchive;
      const assertReadable=operationScope.captureRead();
      archiveCandidate={business:{accountKey:String(businessAccount||''),syncKey:String(fetchedAt),rows:businessArchive,directSnapshot:nextBusinessDirect,assertCurrent:assertReadable},...(homeAccount?{home:{accountKey:String(homeAccount),syncKey:String(fetchedAt),rows:homeArchive,directSnapshot:nextHomeDirect,assertCurrent:assertReadable}}:{})};
      const requireExactArchive=historyDays>=365,businessAudit=assertBankArchiveCoverage(businessMerge,businessArchive,{role:'עסקי',requireExactCount:requireExactArchive}),homeAudit=home&&homeAccount?assertBankArchiveCoverage(homeMerge,homeArchive,{role:'ביתי',requireExactCount:requireExactArchive}):null;
      archiveAudit={version:3,verifiedAt:fetchedAt,historyDays,business:{...businessAudit,accountKey:businessAccount,reconciliation:businessMerge?.result||null,coverage:businessCoverage},home:homeAudit?{...homeAudit,accountKey:homeAccount,reconciliation:homeMerge?.result||null,coverage:homeCoverage}:null};
    }
    const businessFeed=feedFromSnapshot({...business,transactions:businessArchive},fetchedAt,'business'),homeFeed=home?feedFromSnapshot({...home,transactions:homeArchive},fetchedAt,'home'):null;
    const warnings=[business?.transactionWarning?`עסקי: ${business.transactionWarning}`:'',home?.transactionWarning?`ביתי: ${home.transactionWarning}`:'',homeFailure?.message?`ביתי: ${homeFailure.message}`:'',imageSyncWarning].filter(Boolean);
    const previousBank=model.state.bank&&typeof model.state.bank==='object'?model.state.bank:{};
    const exactBackfillVerified=cloudArchive&&historyDays>=365&&completeTransactionCoverage(business).complete&&!homeFailure&&(!home||completeTransactionCoverage(home).complete),archiveBaselineAudit=exactBackfillVerified?archiveAudit:(previousBank.archiveBaselineAudit||null);
    await prepareBankSnapshot(assertCurrent);
    assertCurrent();
    if(session.connectionMode==='supabase'&&sharedChecksHaveLocalWork())throw new Error('הצקים השתנו לפני השמירה. יש להמתין לסנכרון ולנסות שוב.');
    const nextBank={...previousBank,currentBalance:wholeMoney(business.balance),...bankSnapshotFinancials(business),updatedAt:new Date().toISOString(),asOfDate:todayISO(),snapshotToken:uid('BANK'),snapshotSeq:sharedChecksObservedSequence(),adjustments:[],source:'hapoalim',sourceAccount:businessAccount||null,bankSyncAt:fetchedAt,feed:businessFeed,homeFeed:home?homeFeed:(homeFailure?previousBank.homeFeed??null:null),archiveInitialized:cloudArchive?(archiveReady||exactBackfillVerified):previousBank.archiveInitialized===true,archiveVersion:exactBackfillVerified?2:archiveVersion,archiveInitializedAt:cloudArchive?(archiveReady?previousBank.archiveInitializedAt||null:(exactBackfillVerified?fetchedAt:null)):(previousBank.archiveInitializedAt||null),archiveAudit:cloudArchive?archiveAudit:(previousBank.archiveAudit||null),archiveBaselineAudit:cloudArchive?archiveBaselineAudit:(previousBank.archiveBaselineAudit||null)};
    if(session.connectionMode==='supabase'){
      const published=await snapshots.commands.publishCloud(nextBank,archiveCandidate,lease);assertCurrent();
      if(!published.readoutVerified)warnings.push(BANK_READOUT_WARNING);
      toast(historyDays>=365?'ארכיון הבנק אומת ואותחל בכתיבה אטומית':auto?'נתוני הבנק עודכנו':'נתוני הבנק עודכנו ונשמרו בארכיון נפרד');
    }else{
      await snapshots.commands.publishLocal(nextBank,historyDays>=365?'ארכיון הבנק אותחל והופרד מגיבויי הקופה':auto?'נתוני הבנק עודכנו':'נתוני הבנק עודכנו ונשמרו בארכיון נפרד',assertCurrent);assertCurrent();
    }
    Object.assign(bridgeState,{available:true,configured:true,upgradeRequired:false,bridgeVersion:Math.max(BANK_BRIDGE_VERSION,bridgeState.bridgeVersion||0),availableAccounts:Array.isArray(homeFailure?.availableAccounts)?homeFailure.availableAccounts:[],accountSelectionRole:homeFailure?'home':'',lastScrapeAt:fetchedAt,lastError:'',lastErrorAt:null,lastErrorCode:'',lastErrorStage:'',lastErrorHttpStatus:0,lastWarning:warnings.join(' | '),lastWarningCode:homeFailure?.code||'',lastWarningStage:homeFailure?.stage||'',lastWarningHttpStatus:Number(homeFailure?.httpStatus)||0,message:homeFailure?'החשבון העסקי עודכן בהצלחה; החשבון הביתי לא עודכן ונשמר הנתון הביתי האחרון.':warnings.length?'היתרות עודכנו בהצלחה; קיימת אזהרה לגבי חלק מהתנועות.':home?'שני החשבונות והפעילות האחרונה התקבלו בהצלחה מבנק הפועלים.':'החשבון העסקי והתנועות האחרונות התקבלו בהצלחה מבנק הפועלים.'});
    applyBridgeAccountFields(bridgeState,{businessBranchNumber:business.branchNumber,businessAccountNumber:business.accountNumber,homeBranchNumber:home?.branchNumber??bridgeState.homeBranchNumber,homeAccountNumber:home?.accountNumber??bridgeState.homeAccountNumber});
    if(homeFailure&&!auto)toast('החשבון העסקי עודכן. החשבון הביתי לא עודכן; הנתון הביתי הקודם נשמר ופרטי התקלה מוצגים במסך הבנק.');
    else if(warnings.length&&!auto)toast('היתרות עודכנו. חלק מהתנועות לא נטענו במלואן; פרטי האזהרה מוצגים במסך הבנק.');
    bridgeState.resultReady=true;render();
    return true;
  }catch(e){
    try{assertOwner?.();assertConnection?.()}catch(scopeError){e=scopeError}
    if(!localSnapshot.state()){bridgeState.lastError=e.message||String(e);bridgeState.lastErrorAt=new Date().toISOString();bridgeState.lastErrorCode=e.code||'';bridgeState.lastErrorStage=e.stage||'';bridgeState.lastErrorHttpStatus=Number(e.httpStatus)||0;bridgeState.availableAccounts=Array.isArray(e.availableAccounts)?e.availableAccounts:[];bridgeState.accountSelectionRole=e.accountRole||'';bridgeState.message=bridgeState.lastError}
    if(!auto)toast(bankBridgeUiState().lastError);
    bridgeState.resultReady=true;render();
    return false;
  }finally{
    await heartbeat?.stop();
    if(leaseHeld)try{
      await releaseFinanceSyncLease('bank',leaseToken,{assertCurrent:assertOwner});
    }catch(error){
      if(!scopeChanged(error))console.error('bank sync lease release',error);
    }
    bridgeState.busy=false;
    archive.runtime.resume();
    bridgeState.resultReady=false;
    render();
  }
}

async function acknowledgeMissingBankTransaction(transactionId){
  if(session.connectionMode!=='supabase')return false;
  const id=Number(transactionId);if(!Number.isSafeInteger(id)||id<=0){toast('לא ניתן לזהות את תנועת הבנק לסימון');return false}
  try{
    const assertCurrent=operationScope.capture();
    await acknowledgeBankTransactionMissing(id,{assertCurrent});assertCurrent();
    archive.commands.invalidate(id);
    await ensureBankDisplayArchive();assertCurrent();
    toast('התנועה סומנה כנבדקה. התיעוד נשמר בארכיון, והיא הוסרה מההיסטוריה החכמה ומהאזהרות.');render();return true;
  }catch(error){toast(error?.message||'סימון התנועה כנבדקה נכשל');return false}
}

function autoDelay(){
  const now=Date.now(),lastSyncAt=sharedBankLastSyncAt(),lastSyncMs=lastSyncAt?Date.parse(lastSyncAt):NaN;
  if(!bankAutoRefreshDue(lastSyncAt,now))return Math.max(1000,lastSyncMs+BANK_AUTO_INTERVAL_MS-now+250);
  const retryIn=bridge.autoAttemptDelayMs(now);
  return retryIn>0?Math.max(1000,retryIn+250):300;
}
function maybeAutoRefreshBankBalance(){return automaticActive?autoTask.start():false}
function startAutoSync(){if(disposed)return false;automaticActive=true;automaticOwner=null;return autoTask.start()}
function stopAutoSync(){automaticActive=false;return autoTask.stop()}

const runtime={
  drain:workOwner.drain,
  dispose(){if(disposed)return false;disposed=true;workOwner.close();pairingScope.dispose();stopAutoSync();return true},
};
return {
  bankBridgeUiState,bankLocalSnapshotState:localSnapshot.state,
  retryLocalBankSnapshot:(...args)=>track(()=>retryLocalBankSnapshot(...args)),
  ensureBankDisplayArchive:(...args)=>track(()=>ensureBankDisplayArchive(...args)),
  refreshBankBridgeStatus:(...args)=>track(()=>refreshBankBridgeStatus(...args)),
  saveBankBridgeToken:(...args)=>track(()=>saveBankBridgeToken(...args)),
  configureBankBridge:(...args)=>track(()=>configureBankBridge(...args)),
  selectBankBridgeAccount:(...args)=>track(()=>selectBankBridgeAccount(...args)),
  deleteBankBridgeCredentials:(...args)=>track(()=>deleteBankBridgeCredentials(...args)),
  exportBankChequeDiagnostics:(...args)=>track(()=>exportBankChequeDiagnostics(...args)),
  refreshBankBalance:(...args)=>track(()=>refreshBankBalance(...args)),
  acknowledgeMissingBankTransaction:(...args)=>track(()=>acknowledgeMissingBankTransaction(...args)),
  commitBankSnapshot:(...args)=>track(()=>commitBankSnapshot(...args)),
  setBankAutoRefresh,maybeAutoRefreshBankBalance,startAutoSync,stopAutoSync,runtime,
};
}
