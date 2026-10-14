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
  connections,
  timers=globalThis,
  syncBankTransactionsSnapshot=async()=>null,
  acknowledgeBankTransactionMissing=async()=>null,
  syncBankChequeImages=async()=>({ok:true,warnings:[]}),
  archive,
  readFinance,
  syncLeases,
  snapshots,
}){
// Financial feedback is independent of passive device status. A new pairing
// or local connection command retires feedback from the former operation.
const financialFeedback = {busy:false, resultReady:false};
let feedbackGeneration = -1, feedbackCommandRevision = -1;
function resetFeedback() {
  for (const key of Object.keys(financialFeedback))
    if (key !== 'busy' && key !== 'resultReady') delete financialFeedback[key];
}
function connectionState() {
  const value = connections.queries.snapshot();
  if (value.generation !== feedbackGeneration || value.commandRevision !== feedbackCommandRevision) {
    feedbackGeneration = value.generation;
    feedbackCommandRevision = value.commandRevision;
    resetFeedback();
  }
  return value;
}
function connectionCommand(method, ...args) {
  if (financialFeedback.busy) return false;
  return connections.commands[method](...args);
}
if(typeof autoScope!=='function')throw new Error('bank_auto_scope_required');
if(typeof operationScope?.capture!=='function'||typeof operationScope?.captureRead!=='function')throw new Error('bank_operation_scope_required');
for(const [group,methods] of Object.entries({commands:['saveToken','configure','selectAccount','deleteCredentials','exportDiagnostics','recordScan'],queries:['snapshot','capture','isCurrent','readStatus','refreshStatus','supported']}))
  for(const method of methods)if(typeof connections?.[group]?.[method]!=='function')throw new TypeError('kupa_bank_connection_'+group+'_'+method+'_required');

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
const workOwner=createRuntimeTaskOwner();
function track(work){return disposed?Promise.resolve(false):workOwner.run(work)}
let automaticActive=true,automaticOwner=null;
const automaticAllowed=()=>{
  const scope=autoScope();if(disposed||!automaticActive||localSnapshot.state()||typeof scope!=='string'||!scope.length)return false;
  if(automaticOwner===null)automaticOwner=scope;
  return scope===automaticOwner&&session.backendReady&&!connectionState().upgradeRequired&&connectionState().tokenConfigured&&bridge.autoEnabled();
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

async function retryLocalBankSnapshot(){
  try{const saved=await localSnapshot.retry();if(saved&&automaticActive)autoTask.start();return saved}
  catch(error){toast(error?.code==='FINANCE_OPERATION_SCOPE_CHANGED'?error.message:'לא ניתן לאשר את הצילום הקיים. יש לבדוק את מצב האחסון; לא בוצעה סריקה נוספת מהבנק.');return false}
}

function bankBridgeUiState(){
  const connection=connectionState();
  const feed=displayArchiveFeed('business',model.state.bank?.feed),homeFeed=displayArchiveFeed('home',model.state.bank?.homeFeed);
  const sharedLastSyncAt=sharedBankLastSyncAt();
  const homeLastSyncAt=homeFeed?.syncedAt||null;
  const local=localSnapshot.state();
  return {...connection,...financialFeedback,busy:financialFeedback.busy||connection.busy,...(local&&local.phase!=='saving'?{lastError:local.message}:{}),localSnapshot:local,autoEnabled:bridge.autoEnabled(),sharedLastSyncAt,homeLastSyncAt,feed,homeFeed};
}

function setBankAutoRefresh(enabled){bridge.setAutoEnabled(!!enabled);toast(enabled?'עדכון אוטומטי כל 4 שעות הופעל':'עדכון אוטומטי כובה');if(enabled)startAutoSync();else stopAutoSync()}

async function refreshBankBalance({interactive=false,auto=false,isCurrent=()=>true}={}){
  const pending=localSnapshot.state();if(pending){if(!auto)toast(pending.message);return false}
  const scope=auto?autoScope():null,allowed=()=>isCurrent()&&automaticAllowed()&&autoScope()===scope;
  if(auto&&!allowed())return false;
  if(bankBridgeUiState().busy)return false;
  if(!connectionState().tokenConfigured){if(!auto)toast('החיבור לבנק עדיין לא הוגדר');return false}
  if(connectionState().upgradeRequired){if(!auto)toast('יש להריץ מחדש install_bank_bridge.bat במחשב זה לפני עדכון מול הבנק');return false}
  archive.runtime.pause();
  financialFeedback.busy=true;financialFeedback.resultReady=false;financialFeedback.lastError='';financialFeedback.lastErrorAt=null;financialFeedback.lastErrorCode='';financialFeedback.lastErrorStage='';financialFeedback.lastErrorHttpStatus=0;financialFeedback.lastWarning='';financialFeedback.lastWarningCode='';financialFeedback.lastWarningStage='';financialFeedback.lastWarningHttpStatus=0;financialFeedback.accountSelectionRole='';
  financialFeedback.message=interactive?'חלון האימות בבנק פתוח. לאחר האימות ה-Bridge יעדכן באותו סשן את החשבון העסקי ואת החשבון הביתי.':auto?'מעדכן אוטומטית את שני חשבונות בנק הפועלים…':'מעדכן יתרות ותנועות בשני חשבונות בנק הפועלים…';
  let leaseToken='',leaseHeld=false,lease=null,heartbeat=null,assertOwner,assertConnection;
  const assertCurrent=()=>{assertOwner();assertConnection();heartbeat?.assertCurrent()};
  try{
    assertOwner=operationScope.capture();assertConnection=connections.queries.capture();render();
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
    if(!leaseHeld){financialFeedback.message='סינכרון הבנק כבר מתבצע ממחשב או חלון אחר; לא נפתחה כניסה נוספת לבנק.';if(!auto)toast(financialFeedback.message);return false}
    heartbeat=startFinanceLeaseHeartbeat({...lease,assertCurrent:assertOwner},claimFinanceSyncLease,{setTimer:timers.setTimeout.bind(timers),clearTimer:timers.clearTimeout.bind(timers)});
    const finance=await refreshFinanceCloudSnapshot({assertCurrent});assertCurrent();
    if(auto){if(!allowed())return false;if(!finance?.verified)throw new Error('לא ניתן לאמת מחדש את זמן סנכרון הבנק לאחר תפיסת הנעילה');if(!bankAutoRefreshDue(sharedBankLastSyncAt(finance.state||model.state)))return true}
    const archiveInitialized=finance?.state?.bank?.archiveInitialized===true,archiveVersion=Number(finance?.state?.bank?.archiveVersion||0),archiveReady=archiveInitialized&&archiveVersion>=2;
    const cloudArchive=session.connectionMode==='supabase',historyDays=cloudArchive&&!auto&&!archiveReady?365:30;
    await prepareBankSnapshot(assertCurrent);
    assertCurrent();
    if(auto&&!allowed())return false;
    const bridgeStatus=await connections.queries.readStatus();assertCurrent();
    if(!connections.queries.supported(bridgeStatus))throw new Error('יש להריץ מחדש install_bank_bridge.bat במחשב זה לפני עדכון מול הבנק');
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
    Object.assign(financialFeedback,{availableAccounts:Array.isArray(homeFailure?.availableAccounts)?homeFailure.availableAccounts:[],accountSelectionRole:homeFailure?'home':'',lastError:'',lastErrorAt:null,lastErrorCode:'',lastErrorStage:'',lastErrorHttpStatus:0,lastWarning:warnings.join(' | '),lastWarningCode:homeFailure?.code||'',lastWarningStage:homeFailure?.stage||'',lastWarningHttpStatus:Number(homeFailure?.httpStatus)||0,message:homeFailure?'החשבון העסקי עודכן בהצלחה; החשבון הביתי לא עודכן ונשמר הנתון הביתי האחרון.':warnings.length?'היתרות עודכנו בהצלחה; קיימת אזהרה לגבי חלק מהתנועות.':home?'שני החשבונות והפעילות האחרונה התקבלו בהצלחה מבנק הפועלים.':'החשבון העסקי והתנועות האחרונות התקבלו בהצלחה מבנק הפועלים.'});
    connections.commands.recordScan({
      bridgeVersion:bridgeStatus.bridgeVersion, lastScrapeAt:fetchedAt,
      availableAccounts:Array.isArray(homeFailure?.availableAccounts)?homeFailure.availableAccounts:[],
      accountSelectionRole:homeFailure?'home':'',
      businessBranchNumber:business.branchNumber, businessAccountNumber:business.accountNumber,
      homeBranchNumber:home?.branchNumber??connectionState().homeBranchNumber,
      homeAccountNumber:home?.accountNumber??connectionState().homeAccountNumber,
    },assertConnection);
    if(homeFailure&&!auto)toast('החשבון העסקי עודכן. החשבון הביתי לא עודכן; הנתון הביתי הקודם נשמר ופרטי התקלה מוצגים במסך הבנק.');
    else if(warnings.length&&!auto)toast('היתרות עודכנו. חלק מהתנועות לא נטענו במלואן; פרטי האזהרה מוצגים במסך הבנק.');
    financialFeedback.resultReady=true;render();
    return true;
  }catch(e){
    // A rejected financial operation still needs a local explanation. Retire
    // former-device fields before publishing the canonical scope error; never
    // copy the old Bridge response/error into the replacement device readout.
    if(assertConnection&&!connections.queries.isCurrent(assertConnection))connectionState();
    try{assertOwner?.();assertConnection?.()}catch(scopeError){e=scopeError}
    if(!localSnapshot.state()){financialFeedback.lastError=e.message||String(e);financialFeedback.lastErrorAt=new Date().toISOString();financialFeedback.lastErrorCode=e.code||'';financialFeedback.lastErrorStage=e.stage||'';financialFeedback.lastErrorHttpStatus=Number(e.httpStatus)||0;financialFeedback.availableAccounts=Array.isArray(e.availableAccounts)?e.availableAccounts:[];financialFeedback.accountSelectionRole=e.accountRole||'';financialFeedback.message=financialFeedback.lastError}
    if(!auto)toast(bankBridgeUiState().lastError);
    financialFeedback.resultReady=true;render();
    return false;
  }finally{
    await heartbeat?.stop();
    if(leaseHeld)try{
      await releaseFinanceSyncLease('bank',leaseToken,{assertCurrent:assertOwner});
    }catch(error){
      if(!scopeChanged(error))console.error('bank sync lease release',error);
    }
    financialFeedback.busy=false;
    archive.runtime.resume();
    financialFeedback.resultReady=false;
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
  isPending:workOwner.isPending,
  drain:workOwner.drain,
  dispose(){if(disposed)return false;disposed=true;workOwner.close();stopAutoSync();return true},
};
return {
  bankBridgeUiState,bankLocalSnapshotState:localSnapshot.state,
  retryLocalBankSnapshot:(...args)=>track(()=>retryLocalBankSnapshot(...args)),
  ensureBankDisplayArchive:(...args)=>track(()=>ensureBankDisplayArchive(...args)),
  refreshBankBridgeStatus:(...args)=>track(()=>connections.queries.refreshStatus(...args)),
  saveBankBridgeToken:(...args)=>track(()=>connectionCommand('saveToken',...args)),
  configureBankBridge:(...args)=>track(()=>connectionCommand('configure',...args)),
  selectBankBridgeAccount:(...args)=>track(()=>connectionCommand('selectAccount',...args)),
  deleteBankBridgeCredentials:(...args)=>track(()=>connectionCommand('deleteCredentials',...args)),
  exportBankChequeDiagnostics:(...args)=>track(()=>connectionCommand('exportDiagnostics',...args)),
  refreshBankBalance:(...args)=>track(()=>refreshBankBalance(...args)),
  acknowledgeMissingBankTransaction:(...args)=>track(()=>acknowledgeMissingBankTransaction(...args)),
  commitBankSnapshot:(...args)=>track(()=>commitBankSnapshot(...args)),
  setBankAutoRefresh,maybeAutoRefreshBankBalance,startAutoSync,stopAutoSync,runtime,
};
}
