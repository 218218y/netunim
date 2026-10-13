import {readBankBalanceResult,bankSnapshotFinancials} from '../../shared/bank-balance-result.js';
import {createRuntimeTaskOwner} from '../../shared/runtime-task-owner.js';
import {createOrdersFinanceAutomation} from './automation.js';
import {createRevisionSelector} from '../../shared/revision-selector.js';
import {applyCreditCardOrderData} from '../../shared/credit-card-order.js';
import {bankRecurringDebitHistoryData} from '../../shared/bank-recurring-debits.js';
import {startFinanceLeaseHeartbeat} from '../../shared/finance-lease-heartbeat.js';
import {normalizeCreditFetchMode,resolveCreditAutoSyncMode} from '../../shared/credit-sync-policy.js';
import {clone,uid} from '../../core/values.js';
import {checkTodayISO} from '../../core/dates.js';
import {kupaWholeMoney} from '../../core/money.js';
import {normalizeSharedBankEvents} from '../checks/model.js';
import {normalizeBankFeed} from './bank-feed.js';
import {creditCardMappingKey,creditSyncScrapeSelection,mergeCreditSyncResult,normalizeCreditSync} from './credit-feed.js';
import {bankAutoRefreshDue as bankRefreshDue,creditRefreshDue} from '../../shared/finance-refresh-policy.js';
import {normalizeCashflowSettings} from '../../shared/cashflow.js';
import {FINANCE_PUBLICATION_WARNING} from './document-publication.js';
import {projectBankArchiveFeed} from './bank-archive-model.js';


function accountIdOf(snapshot){return snapshot?.accountId||[snapshot?.branchNumber,snapshot?.accountNumber].filter(Boolean).join('-')||snapshot?.accountNumber||''}
function completeTransactionCoverage(snapshot){const coverage=snapshot?.transactionCoverage&&typeof snapshot.transactionCoverage==='object'?snapshot.transactionCoverage:{},from=String(coverage.from||''),to=String(coverage.to||''),valid=/^\d{4}-\d{2}-\d{2}$/.test(from)&&/^\d{4}-\d{2}-\d{2}$/.test(to)&&from<=to,warning=String(snapshot?.transactionWarning||'');return {complete:coverage.complete===true&&!warning&&valid,from:valid?from:null,to:valid?to:null,days:Number(coverage.days)||null,warning}}
function bankFeedFromSnapshot(snapshot,fetchedAt){if(!snapshot||!Number.isFinite(Number(snapshot.balance)))return null;return normalizeBankFeed({provider:'hapoalim',accountNumber:accountIdOf(snapshot),balance:Number(snapshot.balance),availableBalance:snapshot.availableBalance,creditLimit:snapshot.creditLimit,creditLimitUsed:snapshot.creditLimitUsed,creditLimitUsedPercent:snapshot.creditLimitUsedPercent,syncedAt:fetchedAt,transactions:snapshot.transactions||[],transactionWarning:snapshot.transactionWarning||''})}
function financeBankPayload(bank){const out={...bank};delete out.adjustments;delete out.snapshotToken;delete out.snapshotSeq;return out}

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
    const detailsOk=!!row&&canonicalJson(tx.checkDetails??null)===canonicalJson(row.checkDetails??null)&&canonicalJson(tx.creditSettlementDetails??null)===canonicalJson(row.creditSettlementDetails??null)&&Boolean(tx.cheque)===Boolean(row.cheque);
    if(!coreOk||!detailsOk)throw new Error(`אימות ארכיון הבנק נכשל (${role||'חשבון'}): תנועת מקור לא נקראה חזרה בשלמותה (${tx.mergeKey||'ללא מזהה'})`);
  }
  const total=Number(mergeResult?.result?.total_count);
  if(requireExactCount&&(!Number.isSafeInteger(total)||total!==source.length))throw new Error(`אימות backfill נכשל (${role||'חשבון'}): הבנק החזיר ${source.length} תנועות אך הארכיון מכיל ${Number.isFinite(total)?total:'מספר לא תקין'}`);
  return {sourceCount:source.length,archiveCount:Number.isSafeInteger(total)?total:rows.length,insertedCount:Number(mergeResult?.result?.inserted_count)||0,updatedCount:Number(mergeResult?.result?.updated_count)||0,verifiedAt:new Date().toISOString(),exactCount:!!requireExactCount};
}

export function createDomainsFinanceController({
  tab,
  checksSession,
  bridge,
  operationScope,
  loadSession,
  refreshKupaReadout,
  syncSharedChecksFromCloud,
  saveSharedChecksToCloud,
  checksHaveLocalWork,
  getSharedChecks = () => [],
  toast,
  syncLeases,
  syncBankTransactionsSnapshot = async () => null,
  setBankTransactionHandled: saveBankTransactionHandled = async () => null,
  acknowledgeBankTransactionMissing = async () => null,
  acknowledgeBankTransactionAlert = async () => null,
  syncBankChequeImages = async () => ({ok:true,warnings:[]}),
  effects,
  documents,
  archive,
  connections,
  bankConnections,
}) {
  if(typeof operationScope?.capture!=='function'||typeof operationScope?.captureRead!=='function')throw new Error('orders_finance_operation_scope_required');
  for(const method of ['isOnline','delay'])if(typeof effects?.[method]!=='function')throw new TypeError(`orders_finance_effect_${method}_required`);
  const work=createRuntimeTaskOwner();
  const scopeChanged=error=>error?.code==='FINANCE_OPERATION_SCOPE_CHANGED'||error?.code==='CREDIT_CONNECTION_SCOPE_CHANGED'||error?.code==='BRIDGE_PAIRING_SCOPE_CHANGED';
  function currentOperationError(error,assertOwner){try{assertOwner?.();return error}catch(ownerError){return ownerError}}
  const local={bankBusy:false,bankResultReady:false,creditBusy:false,bankError:'',creditError:'',bankErrorAt:null,creditErrorAt:null};
  let financeStatusListener=()=>{};
  for (const method of ['mutateKupa','mutateFinance','publishBankSnapshot']) {
    if (typeof documents?.commands?.[method] !== 'function')
      throw new TypeError('orders_finance_document_command_'+method+'_required');
  }
  if (typeof documents?.queries?.readFinance !== 'function')
    throw new TypeError('orders_finance_document_query_required');
  for (const method of ['claim','release']) {
    if (typeof syncLeases?.[method] !== 'function')
      throw new TypeError('orders_finance_sync_lease_'+method+'_required');
  }
  const claimFinanceSyncLease = syncLeases.claim, releaseFinanceSyncLease = syncLeases.release;
  const mutateKupaCloud = documents.commands.mutateKupa, mutateFinanceCloud = documents.commands.mutateFinance;
  const readFinanceSyncDocument = documents.queries.readFinance;
  const publicationWarning = FINANCE_PUBLICATION_WARNING;
  for (const method of ['matching','ready','revision','readSnapshot'])
    if (typeof archive?.queries?.[method] !== 'function')
      throw new TypeError('orders_bank_archive_query_' + method + '_required');
  for (const method of ['publish','update'])
    if (typeof archive?.commands?.[method] !== 'function')
      throw new TypeError('orders_bank_archive_command_' + method + '_required');
  for (const method of ['ensure','pause','resume'])
    if (typeof archive?.runtime?.[method] !== 'function')
      throw new TypeError('orders_bank_archive_runtime_' + method + '_required');
  for(const method of ['snapshot','capture','supported','readStatus','refreshStatus'])if(typeof connections?.queries?.[method]!=='function')throw new TypeError('orders_credit_connection_query_'+method+'_required');
  for(const method of ['copyDiagnostics','exportData','saveProfile','deleteProfile','resetProfiles','reportFailure'])if(typeof connections?.commands?.[method]!=='function')throw new TypeError('orders_credit_connection_command_'+method+'_required');
  const projectionRevision = archive.queries.revision, bankAlertsReady = archive.queries.ready;
  const ensureBankDisplayArchive = archive.runtime.ensure;
  const publishDisplayArchive = archive.commands.publish;
  const updateLocalBankTransaction = archive.commands.update;
  const displayArchiveFeed = (role,feed) => projectBankArchiveFeed(archive,role,feed);

  for(const method of ['snapshot','capture','supported','readStatus','refreshStatus'])if(typeof bankConnections?.queries?.[method]!=='function')throw new TypeError('orders_bank_connection_query_'+method+'_required');
  for(const method of ['configure','selectAccount','deleteCredentials','exportDiagnostics','recordScan','reportFailure'])if(typeof bankConnections?.commands?.[method]!=='function')throw new TypeError('orders_bank_connection_command_'+method+'_required');
  function bankConnectionState(){const state=bankConnections.queries.snapshot();return {bankStatus:state.status?clone(state.status):null,bankStatusChecked:state.checked,bankBridgeError:state.bridgeError}}
  const refreshBankBridgeStatus=bankConnections.queries.refreshStatus,captureBankConnection=bankConnections.queries.capture;
  function creditConnectionState(){const state=connections.queries.snapshot();return {creditStatus:state.status?clone(state.status):null,creditStatusChecked:state.checked,creditBridgeError:state.bridgeError}}
  const supportedCreditBridge=connections.queries.supported,refreshCreditBridgeStatus=connections.queries.refreshStatus,copySafeCreditDiagnostics=connections.commands.copyDiagnostics;
  const captureCreditConnection=connections.queries.capture;
  function captureCreditReset(){try{const assertOwner=operationScope.capture(),assertConnection=captureCreditConnection();return ()=>{assertOwner();assertConnection()}}catch(error){toast(error?.message||String(error));return null}}
  function exportCreditDataDiagnostics(){return local.bankBusy||local.creditBusy?Promise.resolve(false):connections.commands.exportData()}
  function snapshot(){const kupa=checksSession.kupaCloudReadState&&typeof checksSession.kupaCloudReadState==='object'?clone(checksSession.kupaCloudReadState):null;if(kupa)kupa.checks=clone(getSharedChecks());const rawBank=kupa?.bank||null,bank=rawBank?{...rawBank,feed:displayArchiveFeed('business',rawBank.feed),homeFeed:displayArchiveFeed('home',rawBank.homeFeed)}:null;return {kupa,bank,bankAlertsReady:bankAlertsReady(),creditSync:normalizeCreditSync(kupa?.creditSync),cards:Array.isArray(kupa?.cards)?kupa.cards:[],credits:Array.isArray(kupa?.credits)?kupa.credits:[],bankLastSyncAt:bankLastSyncAt(kupa),creditLastSyncAt:creditLastSyncAt(kupa),...financeAutomation.preferenceState(),bankBusy:local.bankBusy,bankResultReady:local.bankResultReady,creditBusy:local.creditBusy,bankError:local.bankError,creditError:local.creditError,bankErrorAt:local.bankErrorAt,creditErrorAt:local.creditErrorAt,...bankConnectionState(),...creditConnectionState()}}
  const readProjection=createRevisionSelector({revision:projectionRevision,select:snapshot,name:'orders-finance'});
  function readSnapshot(){return {...readProjection(),...financeAutomation.preferenceState(),bankBusy:local.bankBusy,bankResultReady:local.bankResultReady,creditBusy:local.creditBusy,bankError:local.bankError,creditError:local.creditError,bankErrorAt:local.bankErrorAt,creditErrorAt:local.creditErrorAt,...bankConnectionState(),...creditConnectionState()}}

  async function refreshFinanceData({force=true,renderIfChanged=true}={}){if(!loadSession()||!effects.isOnline())return snapshot();const assertCurrent=operationScope.captureRead();await refreshKupaReadout({force,renderIfChanged,assertCurrent});assertCurrent();return snapshot()}

  function observedChecksSequence(kupa){const floor=Number(kupa?.bank?.snapshotSeq),start=Number.isSafeInteger(floor)&&floor>=0?floor:0;return normalizeSharedBankEvents(checksSession.checksBankEvents).reduce((max,event)=>Math.max(max,event.seq),start)}

  async function saveCashflowMinimum(account,value){
    const raw=String(value??'').trim(),parsed=raw===''?null:Number(raw);
    if(parsed!==null&&!Number.isFinite(parsed)){toast('סכום המינימום אינו תקין');return false}
    if(!loadSession()){toast('יש להתחבר לענן כדי לשמור את ההגדרה המשותפת');return false}
    try{
      const saved=await mutateKupaCloud(kupa=>{const settings=normalizeCashflowSettings(kupa.cashflowSettings);if(account==='home')settings.homeMinimum=parsed;else settings.businessMinimum=parsed;kupa.cashflowSettings=normalizeCashflowSettings(settings);return kupa});
      toast(saved.publicationWarning||'סף ההתראה התזרימי נשמר ומשותף לשתי המערכות');
      return true;
    }catch(error){toast(error?.message||String(error));return false}
  }

  async function saveCashflowCheckCutoff(account,value){
    const parsed=Number(value);
    if(!Number.isInteger(parsed)||parsed<1||parsed>31){toast('יום חישוב הצ׳קים חייב להיות מספר שלם בין 1 ל־31');return false}
    if(!loadSession()){toast('יש להתחבר לענן כדי לשמור את ההגדרה המשותפת');return false}
    try{
      const saved=await mutateKupaCloud(kupa=>{const settings=normalizeCashflowSettings(kupa.cashflowSettings);if(account==='home')settings.homeCheckCutoffDay=parsed;else settings.businessCheckCutoffDay=parsed;kupa.cashflowSettings=normalizeCashflowSettings(settings);return kupa});
      toast(saved.publicationWarning||'יום חישוב הצ׳קים בתזרים נשמר ומשותף לשתי המערכות');
      return true;
    }catch(error){toast(error?.message||String(error));return false}
  }

  async function saveBridgeToken(value){
    const token=bridge.setBridgeToken(value);
    local.bankError='';local.creditError='';local.bankErrorAt=null;local.creditErrorAt=null;
    bankConnections.queries.snapshot();connections.queries.snapshot();
    if(token){
      const assertConnection=bankConnections.queries.capture();
      await Promise.all([refreshBankBridgeStatus({quiet:true}),refreshCreditBridgeStatus({quiet:true})]);
      try{assertConnection()}catch{return token}
      toast('מפתח Bank Bridge נשמר במחשב זה');
    }else{toast('מפתח Bank Bridge הוסר מהמחשב הזה')}
    startAutoSync();return token;
  }

  async function bankConnectionWrite(command,{clearBefore=false}={}){
    if(local.bankBusy)return false;
    local.bankBusy=true;
    if(clearBefore){local.bankError='';local.bankErrorAt=null}
    try{
      const result=await command();
      if(result.ok){local.bankError='';local.bankErrorAt=null}
      else if(result.failure){local.bankError=result.failure;local.bankErrorAt=new Date().toISOString();toast(result.failure)}
      return result.ok;
    }finally{local.bankBusy=false}
  }
  function configureBankBridge(input){return bankConnectionWrite(()=>bankConnections.commands.configure(input),{clearBefore:true})}
  function selectBankBridgeAccount(role,branchNumber,accountNumber){return bankConnectionWrite(()=>bankConnections.commands.selectAccount(role,branchNumber,accountNumber))}
  function deleteBankBridgeCredentials(){return bankConnectionWrite(bankConnections.commands.deleteCredentials)}
  function exportBankChequeDiagnostics(){return local.bankBusy||local.creditBusy?Promise.resolve(false):bankConnections.commands.exportDiagnostics()}

  async function prepareBankSnapshot(assertCurrent){
    assertCurrent();
    if(checksHaveLocalWork()){const saved=await saveSharedChecksToCloud('הצ׳קים סונכרנו לפני צילום יתרת הבנק');assertCurrent();if(!saved||checksHaveLocalWork())throw new Error('יש להמתין לסנכרון הצ׳קים לפני צילום יתרת עו״ש חדש')}
    const synced=await syncSharedChecksFromCloud({quiet:true,required:true});assertCurrent();
    if(!synced)throw new Error('צילום היתרה נעצר: לא ניתן לאמת שהצ׳קים מסונכרנים כרגע');
    if(checksHaveLocalWork()){const saved=await saveSharedChecksToCloud('הצ׳קים סונכרנו לפני צילום יתרת הבנק');assertCurrent();if(!saved||checksHaveLocalWork())throw new Error('יש להמתין לסנכרון הצ׳קים לפני צילום יתרת עו״ש חדש')}
  }

  function setFinanceStatusListener(listener){financeStatusListener=typeof listener==='function'?listener:()=>{}}
  function notifyFinanceStatus(section){try{financeStatusListener(section)}catch(error){console.error('orders finance status listener',error)}}

  async function refreshBank({interactive=false,auto=false,isCurrent=()=>true}={}){
    if(local.bankBusy||local.creditBusy)return false;
    if(!tab.primaryTab||!loadSession()||!effects.isOnline())return false;
    if(!financeAutomation.tokenConfigured()){if(!auto)toast('יש לצמד את ניהול ההזמנות ל-Bank Bridge במחשב זה');return false}
    if(auto&&!financeAutomation.markAttempt('bank'))return false;
    archive.runtime.pause();
    local.bankBusy=true;local.bankResultReady=false;local.bankError='';local.bankErrorAt=null;
    let leaseToken='',leaseHeld=false,lease=null,heartbeat=null,assertOwner,assertConnection;const schedulerEpoch=financeAutomation.currentEpoch();
    const assertCurrent=()=>{assertOwner();assertConnection();heartbeat?.assertCurrent()};
    try{
      assertOwner=operationScope.capture();assertConnection=bankConnections.queries.capture();notifyFinanceStatus('bank');
      const cloudFresh=await refreshKupaReadout({force:true,renderIfChanged:true,assertCurrent});assertCurrent();
      if(auto&&!cloudFresh)throw new Error('לא ניתן לאמת את זמן סנכרון הבנק המשותף בענן');
      if(auto&&!bankRefreshDue(bankLastSyncAt(checksSession.kupaCloudReadState)))return true;
      if(auto&&(!isCurrent()||!financeAutomation.allowed('bank')))return false;
      leaseToken=uid('FINLEASE');lease=await claimFinanceSyncLease('bank',leaseToken,{assertCurrent:assertOwner});leaseHeld=lease?.acquired===true;assertCurrent();lease={...lease,assertCurrent};
      if(!leaseHeld){if(!auto)toast('סינכרון הבנק כבר מתבצע ממחשב או חלון אחר. לא נפתחה כניסה נוספת לבנק.');return false}
      heartbeat=startFinanceLeaseHeartbeat({...lease,assertCurrent:assertOwner},claimFinanceSyncLease);
      if(auto){const confirmed=await refreshKupaReadout({force:true,renderIfChanged:true,assertCurrent});assertCurrent();if(!confirmed)throw new Error('לא ניתן לאמת מחדש את זמן סינכרון הבנק לאחר תפיסת הנעילה');if(!bankRefreshDue(bankLastSyncAt(checksSession.kupaCloudReadState)))return true}
      const status=await bankConnections.queries.readStatus();assertCurrent();
      if(!bankConnections.queries.supported(status))throw new Error('יש לשדרג את Bank Bridge לפני סנכרון הבנק');
      if(!status.configured)throw new Error('Bank Bridge פעיל אך פרטי בנק הפועלים עדיין לא הוגדרו');
      await prepareBankSnapshot(assertCurrent);assertCurrent();
      const financeRow=await readFinanceSyncDocument({assertCurrent});assertCurrent();
      const archiveInitialized=financeRow?.state?.bank?.archiveInitialized===true,archiveVersion=Number(financeRow?.state?.bank?.archiveVersion||0),archiveReady=archiveInitialized&&archiveVersion>=2,historyDays=!auto&&!archiveReady?365:30;
      if(auto&&(!isCurrent()||!financeAutomation.allowed('bank')))return false;
      const result=await bridge.fetchBalance({interactive,historyDays});assertCurrent();
      const {business,home,homeFailure}=readBankBalanceResult(result);
      const fetchedAt=result.fetchedAt||new Date().toISOString(),businessAccount=accountIdOf(business),homeAccount=home?accountIdOf(home):'';
      const businessCoverage=completeTransactionCoverage(business),homeCoverage=home?completeTransactionCoverage(home):null;
      const businessMerge=await syncBankTransactionsSnapshot(businessAccount,'business',business.transactions||[],{lease,snapshotAt:fetchedAt,coverage:businessCoverage,complete:businessCoverage.complete});assertCurrent();
      const homeMerge=home&&homeAccount?await syncBankTransactionsSnapshot(homeAccount,'home',home.transactions||[],{lease,snapshotAt:fetchedAt,coverage:homeCoverage,complete:homeCoverage?.complete===true}):null;assertCurrent();
      let imageSyncWarning='';try{const imageSync=await syncBankChequeImages([...(business.transactions||[]),...(home?.transactions||[])],{assertCurrent});assertCurrent();if(imageSync?.warnings?.length)imageSyncWarning=`תמונות שיקים: ${imageSync.warnings.join(' | ')}`}catch(error){assertCurrent();if(scopeChanged(error))throw error;imageSyncWarning=`תמונות שיקים לא סונכרנו לענן: ${error?.message||error}`}
      const verified = await archive.queries.readSnapshot([
        {role:'business',accountKey:String(businessAccount||'')},
        ...(home&&homeAccount ? [{role:'home',accountKey:String(homeAccount)}] : []),
      ],{days:370,assertCurrent});
      const businessArchive = verified[0].rows, businessDirect = verified[0].directSnapshot;
      const homeArchive = verified[1]?.rows||[], homeDirect = verified[1]?.directSnapshot??null;
      assertCurrent();const assertReadable=operationScope.captureRead();
      const archiveCandidate={business:{accountKey:String(businessAccount||''),syncKey:String(fetchedAt),rows:businessArchive,directSnapshot:businessDirect,assertCurrent:assertReadable},...(homeAccount?{home:{accountKey:String(homeAccount),syncKey:String(fetchedAt),rows:homeArchive,directSnapshot:homeDirect,assertCurrent:assertReadable}}:{})};
      const requireExactArchive=historyDays>=365,businessAudit=assertBankArchiveCoverage(businessMerge,businessArchive,{role:'עסקי',requireExactCount:requireExactArchive}),homeAudit=home&&homeAccount?assertBankArchiveCoverage(homeMerge,homeArchive,{role:'ביתי',requireExactCount:requireExactArchive}):null,archiveAudit={version:3,verifiedAt:fetchedAt,historyDays,business:{...businessAudit,accountKey:businessAccount,reconciliation:businessMerge?.result||null,coverage:businessCoverage},home:homeAudit?{...homeAudit,accountKey:homeAccount,reconciliation:homeMerge?.result||null,coverage:homeCoverage}:null};
      await prepareBankSnapshot(assertCurrent);assertCurrent();
      if(checksHaveLocalWork())throw new Error('הצקים השתנו לפני השמירה. יש להמתין לסנכרון ולנסות שוב.');
      const businessFeed=bankFeedFromSnapshot({...business,transactions:businessArchive},fetchedAt),homeFeed=home?bankFeedFromSnapshot({...home,transactions:homeArchive},fetchedAt):null,kupa=checksSession.kupaCloudReadState||{},snapshotToken=uid('BANK'),snapshotSeq=observedChecksSequence(kupa);
      const financeBase=financeRow?.state&&typeof financeRow.state==='object'?clone(financeRow.state):{},previousBank=financeBase.bank&&typeof financeBase.bank==='object'?financeBase.bank:{},nextHomeFeed=home?homeFeed:(homeFailure?previousBank.homeFeed??null:null);
      businessFeed.recurringDebitHistory=bankRecurringDebitHistoryData(previousBank.feed,businessFeed,'business',businessCoverage);
      if(homeFeed)homeFeed.recurringDebitHistory=bankRecurringDebitHistoryData(previousBank.homeFeed,homeFeed,'home',homeCoverage);
      const exactBackfillVerified=historyDays>=365&&completeTransactionCoverage(business).complete&&!homeFailure&&(!home||completeTransactionCoverage(home).complete),archiveBaselineAudit=exactBackfillVerified?archiveAudit:(previousBank.archiveBaselineAudit||null);
      const nextBank={...previousBank,currentBalance:kupaWholeMoney(business.balance),...bankSnapshotFinancials(business),updatedAt:new Date().toISOString(),asOfDate:checkTodayISO(),source:'hapoalim',sourceAccount:businessAccount||null,bankSyncAt:fetchedAt,feed:businessFeed,homeFeed:nextHomeFeed,archiveInitialized:archiveReady||exactBackfillVerified,archiveVersion:exactBackfillVerified?2:archiveVersion,archiveInitializedAt:archiveReady?previousBank.archiveInitializedAt||null:(exactBackfillVerified?fetchedAt:null),archiveAudit,archiveBaselineAudit};
      const saved=await documents.commands.publishBankSnapshot(financeBankPayload(nextBank),snapshotToken,snapshotSeq,lease);assertCurrent();
      const readoutVerified=saved.published===true;
      if(readoutVerified)publishDisplayArchive(archiveCandidate);
      bankConnections.commands.recordScan({lastScrapeAt:fetchedAt,lastError:'',lastErrorAt:null,lastWarning:[business?.transactionWarning?`עסקי: ${business.transactionWarning}`:'',home?.transactionWarning?`ביתי: ${home.transactionWarning}`:'',homeFailure?.message?`ביתי: ${homeFailure.message}`:'',imageSyncWarning,!readoutVerified?publicationWarning:''].filter(Boolean).join(' | '),availableAccounts:Array.isArray(homeFailure?.availableAccounts)?homeFailure.availableAccounts:[],accountRole:homeFailure?'home':''},assertConnection);
      if(!auto)toast(!readoutVerified?publicationWarning:homeFailure?'החשבון העסקי עודכן; החשבון הביתי נשאר בנתון האחרון':'נתוני הבנק העסקי והביתי עודכנו וזמינים בשתי המערכות');
      local.bankResultReady=true;notifyFinanceStatus('bank');
      return true;
    }catch(error){
      error=currentOperationError(error,()=>{assertOwner?.();assertConnection?.()});
      if(scopeChanged(error)&&schedulerEpoch===financeAutomation.currentEpoch())stopAutoSync();
      local.bankError=error?.message||String(error);local.bankErrorAt=new Date().toISOString();
      if(assertConnection)bankConnections.commands.reportFailure(error,assertConnection);
      if(!auto)toast(local.bankError);local.bankResultReady=true;notifyFinanceStatus('bank');return false;
    }
    finally{
      await heartbeat?.stop();
      if(leaseHeld)try{
        await releaseFinanceSyncLease('bank',leaseToken,{assertCurrent:assertOwner});
      }catch(error){
        if(!scopeChanged(error))console.error('orders bank sync lease release',error);
      }
      local.bankBusy=false;
      archive.runtime.resume();
      local.bankResultReady=false;
      notifyFinanceStatus('bank');
      scheduleBankAuto();
    }
  }

  async function toggleBankTransactionHandled(transactionId,handled){
    const id=Number(transactionId);if(!Number.isSafeInteger(id)||id<=0){toast('לא ניתן לזהות את תנועת הבנק');return false}
    try{const assertCurrent=operationScope.capture(),result=await saveBankTransactionHandled(id,handled===true,{assertCurrent});assertCurrent();const at=result?.handled_at||result?.handledAt||null;updateLocalBankTransaction(id,row=>{row.handledAt=at});return true}catch(error){toast(error?.message||'עדכון מצב תנועת הבנק נכשל');return false}
  }
  function markBankMorningVerified(transactionId,bankLink={}){
    const id=Number(transactionId);if(!Number.isSafeInteger(id)||id<=0)return false;const link=bankLink&&typeof bankLink==='object'?bankLink:{handledAt:bankLink},changed=updateLocalBankTransaction(id,row=>{row.handledAt=row.handledAt||link.handledAt||null;const documentId=String(link.documentId||'').trim(),operationId=String(link.operationId||'').trim();if(documentId||operationId){const current=Array.isArray(row.documentLinks)?row.documentLinks:[],key=item=>String(item?.documentId||item?.operationId||'').trim(),needle=documentId||operationId,entry={linkId:Number(link.linkId)||null,operationId,documentId,documentNumber:String(link.documentNumber||''),documentType:Number(link.documentType)||0,documentAmount:Number(link.documentAmount)||0,verifiedAt:link.verifiedAt||new Date().toISOString()};row.documentLinks=[entry,...current.filter(item=>key(item)!==needle)].slice(0,50)}});return changed;
  }

  async function acknowledgeMissingBankTransaction(transactionId){
    const id=Number(transactionId);if(!Number.isSafeInteger(id)||id<=0){toast('לא ניתן לזהות את תנועת הבנק לסימון');return false}
    try{const assertCurrent=operationScope.capture(),result=await acknowledgeBankTransactionMissing(id,{assertCurrent});assertCurrent();const at=String(result?.acknowledged_at||result?.acknowledgedAt||new Date().toISOString());updateLocalBankTransaction(id,row=>{row.missingAcknowledgedAt=at});toast('התנועה סומנה כנבדקה. התיעוד נשמר בארכיון, והיא הוסרה מההיסטוריה החכמה ומהאזהרות.');return true}catch(error){toast(error?.message||'סימון התנועה כנבדקה נכשל');return false}
  }

  async function acknowledgePersistentBankAlert(transactionId,alertKind){
    const id=Number(transactionId),kind=String(alertKind||'').trim();
    if(!Number.isSafeInteger(id)||id<=0||kind!=='returned_cheque'){toast('לא ניתן לזהות את התראת הבנק להסרה');return false}
    try{const assertCurrent=operationScope.capture(),result=await acknowledgeBankTransactionAlert(id,kind,{assertCurrent});assertCurrent();const at=String(result?.acknowledged_at||result?.acknowledgedAt||new Date().toISOString());updateLocalBankTransaction(id,row=>{row.alertAcknowledgements={...(row.alertAcknowledgements&&typeof row.alertAcknowledgements==='object'?row.alertAcknowledgements:{}),[kind]:at}});toast('ההתראה הוסרה ולא תוצג שוב עבור אירוע הבנק הזה.');return true}catch(error){toast(error?.message||'הסרת התראת הבנק נכשלה');return false}
  }

  async function refreshCredit({interactive=false,auto=false,syncMode='forecast',isCurrent=()=>true}={}){
    if(local.creditBusy||local.bankBusy)return false;
    if(!tab.primaryTab||!loadSession()||!effects.isOnline())return false;
    if(!financeAutomation.tokenConfigured()){if(!auto)toast('יש לצמד את ניהול ההזמנות ל-Bank Bridge במחשב זה');return false}
    if(auto&&!financeAutomation.markAttempt('credit'))return false;
    local.creditBusy=true;local.creditError='';local.creditErrorAt=null;notifyFinanceStatus('credit');
    let leaseToken='',leaseHeld=false,lease=null,heartbeat=null,assertOwner,assertConnection;const schedulerEpoch=financeAutomation.currentEpoch();
    const assertCurrent=()=>{assertOwner();assertConnection();heartbeat?.assertCurrent()};
    try{
      assertOwner=operationScope.capture();assertConnection=connections.queries.capture();
      const cloudFresh=await refreshKupaReadout({force:true,renderIfChanged:true,assertCurrent});assertCurrent();
      if(auto&&!cloudFresh)throw new Error('לא ניתן לאמת את זמן סנכרון האשראי המשותף בענן');
      if(auto&&!creditRefreshDue(creditLastSyncAt(checksSession.kupaCloudReadState)))return true;
      if(auto&&(!isCurrent()||!financeAutomation.allowed('credit')))return false;
      leaseToken=uid('FINLEASE');lease=await claimFinanceSyncLease('credit',leaseToken,{assertCurrent:assertOwner});leaseHeld=lease?.acquired===true;assertCurrent();lease={...lease,assertCurrent};
      if(!leaseHeld){if(!auto)toast('סינכרון אשראי כבר מתבצע ממחשב או חלון אחר. לא נפתחה כניסה נוספת לחברות האשראי.');return false}
      heartbeat=startFinanceLeaseHeartbeat({...lease,assertCurrent:assertOwner},claimFinanceSyncLease);
      if(auto){const confirmed=await refreshKupaReadout({force:true,renderIfChanged:true,assertCurrent});assertCurrent();if(!confirmed)throw new Error('לא ניתן לאמת מחדש את זמן סנכרון האשראי לאחר תפיסת הנעילה');if(!creditRefreshDue(creditLastSyncAt(checksSession.kupaCloudReadState)))return true}
      const status=await connections.queries.readStatus();assertCurrent();
      if(!supportedCreditBridge(status))throw new Error('יש לשדרג את Bank Bridge לפני סנכרון האשראי');
      if(!(status.profiles||[]).length)throw new Error('לא הוגדר עדיין חיבור לחברת אשראי במחשב זה');
      const requestedMode=auto?resolveCreditAutoSyncMode(financeAutomation.preferenceState().creditAutoMode,checksSession.kupaCloudReadState?.creditSync,{profileIds:(status.profiles||[]).map(profile=>profile.profileId)}):normalizeCreditFetchMode(syncMode,'forecast');
      if(auto&&(!isCurrent()||!financeAutomation.allowed('credit')))return false;
      const result=await bridge.syncCreditCards({interactive,syncMode:requestedMode,selection:creditSyncScrapeSelection(checksSession.kupaCloudReadState?.creditSync)});assertCurrent();
      if(Number(result.attemptedCount)===0&&Number(result.deferredCount)>0){await refreshCreditBridgeStatus({quiet:true});assertCurrent();local.creditError='';local.creditErrorAt=null;if(!auto)toast('לא נשלחה בקשה חדשה: החיבור מושהה עד מועד ה־403/429 הקודם. גם רענון עם חלון אבחון מכבד את ההשהיה.');return true}
      const saved=await mutateFinanceCloud(finance=>{if(auto&&!creditRefreshDue(creditLastSyncAt({creditSync:finance.creditSync})))return null;finance.creditSync=mergeCreditSyncResult(finance.creditSync,result);return finance},lease);
      await refreshCreditBridgeStatus({quiet:true});assertCurrent();
      if(saved.publicationWarning){local.creditError=saved.publicationWarning;local.creditErrorAt=new Date().toISOString();if(!auto)toast(local.creditError);return true}
      const deferredOnly=Array.isArray(result.errors)&&result.errors.length>0&&result.errors.every(error=>error?.severity==='deferred'||error?.deferred===true);if(!auto&&!saved.skipped)toast(deferredOnly?'החיבור מושהה עקב 403/429; לא יישלח ניסיון נוסף לפני המועד.':result.errors?.length?`האשראי עודכן עם ${result.errors.length} אזהרות והנתונים זמינים בשתי המערכות`:'נתוני האשראי עודכנו וזמינים בשתי המערכות');
      return true;
    }catch(error){
      error=currentOperationError(error,()=>{assertOwner?.();assertConnection?.()});
      connections.commands.reportFailure(error);
      if(scopeChanged(error)&&schedulerEpoch===financeAutomation.currentEpoch())stopAutoSync();
      const deferredOnly=Array.isArray(error?.creditErrors)&&error.creditErrors.length>0&&error.creditErrors.every(item=>item?.severity==='deferred'||item?.deferred===true);local.creditError=deferredOnly?'':error?.message||String(error);local.creditErrorAt=deferredOnly?null:new Date().toISOString();
      if(Array.isArray(error?.creditErrors)&&error.creditErrors.length){
        try{
          assertCurrent();
          const diagnostics=await mutateFinanceCloud(finance=>{finance.creditSync=mergeCreditSyncResult(finance.creditSync,{profiles:[],errors:error.creditErrors});return finance},lease);
          if(diagnostics.publicationWarning){local.creditError=[local.creditError,diagnostics.publicationWarning].filter(Boolean).join(' | ');local.creditErrorAt=new Date().toISOString()}
        }catch(persistError){
          if(!scopeChanged(persistError))console.error('credit diagnostics save',persistError);
          local.creditError=persistError.message||String(persistError);local.creditErrorAt=new Date().toISOString();
          if(scopeChanged(persistError)&&schedulerEpoch===financeAutomation.currentEpoch())stopAutoSync();
          if(!auto)toast(local.creditError);return false;
        }
      }
      if(!auto)toast(local.creditError||(deferredOnly?'החיבור מושהה עד תום ה־cooldown; לא יישלח ניסיון חדש לפני המועד.':''));return deferredOnly;
    }finally{
      await heartbeat?.stop();
      if(leaseHeld)try{
        await releaseFinanceSyncLease('credit',leaseToken,{assertCurrent:assertOwner});
      }catch(error){
        if(!scopeChanged(error))console.error('orders credit sync lease release',error);
      }
      local.creditBusy=false;
      notifyFinanceStatus('credit');
      scheduleCreditAuto();
    }
  }

  async function connectionWrite(run,{clearError=false}={}){
    if(local.creditBusy)return false;local.creditBusy=true;
    if(clearError){local.creditError='';local.creditErrorAt=null}
    try{const assertConnection=connections.queries.capture(),result=await run();try{assertConnection()}catch{return false}if(result.failure){local.creditError=result.failure;local.creditErrorAt=new Date().toISOString();toast(local.creditError)}return result.ok}
    finally{local.creditBusy=false}
  }
  function saveCreditProfile(profile){return connectionWrite(()=>connections.commands.saveProfile(profile),{clearError:true})}
  function deleteCreditProfile(profileId){return connectionWrite(()=>connections.commands.deleteProfile(profileId))}
  async function resetCreditSync(){
    if(local.creditBusy)return false;local.creditBusy=true;
    try{
      const assertOwner=operationScope.capture(),assertConnection=connections.queries.capture(),assertCurrent=()=>{assertOwner();assertConnection()},status=connections.queries.snapshot().status||await refreshCreditBridgeStatus({quiet:true});
      assertCurrent();if(!status)throw new Error(connections.queries.snapshot().bridgeError||'Bank Bridge אינו זמין');
      if(!supportedCreditBridge(status))throw new Error('יש לשדרג את Bank Bridge לפני איפוס מלא של סנכרון האשראי');
      await connections.commands.resetProfiles();assertCurrent();
      const saved=await mutateFinanceCloud(finance=>{finance.creditSync=normalizeCreditSync({});return finance},null,{assertCurrent});assertCurrent();
      setCreditAutoEnabled(false);setCreditAutoMode('smart');
      local.creditError=saved.publicationWarning||'';local.creditErrorAt=local.creditError?new Date().toISOString():null;
      toast(local.creditError||financeAutomation.preferenceState().creditAutomationWarning||'סנכרון האשראי אופס והחיבורים המקומיים נמחקו');return true;
    }catch(error){local.creditError=error?.message||String(error);local.creditErrorAt=new Date().toISOString();toast(local.creditError);return false}
    finally{local.creditBusy=false;scheduleCreditAuto()}
  }

  async function saveCreditCardOrder(keys){const saved=await mutateFinanceCloud(finance=>({...finance,creditSync:applyCreditCardOrderData(normalizeCreditSync(finance.creditSync),keys)}));if(local.creditError==='finance_sync_lease_busy'){local.creditError='';local.creditErrorAt=null}toast(saved.publicationWarning||'סדר הכרטיסים נשמר');return true}

  async function setCreditCardMapping(profileId,accountNumber,field,value){try{const saved=await mutateFinanceCloud(kupa=>{const sync=normalizeCreditSync(kupa.creditSync),profile=sync.profiles.find(p=>p.profileId===profileId),key=creditCardMappingKey(profileId,accountNumber),current=sync.cardMappings[key]||{included:false,hidden:false,account:profile?.defaultAccount==='ביתי'?'ביתי':'עסקי',cardName:'',manualFrame:null};if(field==='included')current.included=!!value;else if(field==='hidden')current.hidden=!!value;else if(field==='account')current.account=value==='ביתי'?'ביתי':'עסקי';else if(field==='cardName')current.cardName=String(value||'').trim().slice(0,100);else if(field==='sortOrder'){const raw=String(value??'').trim(),order=raw===''?null:Number(raw);if(order!==null&&(!Number.isSafeInteger(order)||order<1))throw new Error('סדר הכרטיס חייב להיות מספר שלם חיובי');current.sortOrder=order}else if(field==='manualFrame'){const raw=String(value??'').trim(),amount=raw===''?null:Number(raw);if(amount!==null&&(!Number.isFinite(amount)||amount<0))throw new Error('מסגרת ידנית חייבת להיות מספר חיובי או אפס');current.manualFrame=amount===null?null:Math.round(amount*100)/100}else return null;sync.cardMappings[key]=current;kupa.creditSync=sync;return kupa});if(local.creditError==='finance_sync_lease_busy'){local.creditError='';local.creditErrorAt=null}toast(saved.publicationWarning||'שיוך כרטיס האשראי עודכן');return true}catch(error){toast(error?.message||'שמירת הגדרת הכרטיס נכשלה');return false}}

  async function acknowledgeCreditSettlementWarning(warningId){
    const id=String(warningId||'').trim();
    if(!id.startsWith('credit_settlement_unmatched:'))return false;
    try{
      const saved=await mutateFinanceCloud(finance=>{const sync=normalizeCreditSync(finance.creditSync);sync.settlementWarningAcks={...(sync.settlementWarningAcks||{}),[id]:new Date().toISOString()};finance.creditSync=normalizeCreditSync(sync);return finance});
      toast(saved.publicationWarning||'אזהרת התאמת האשראי סומנה כנבדקה');
      return true;
    }catch(error){toast(error?.message||'שמירת אישור האזהרה נכשלה');return false}
  }

  const financeAutomation=createOrdersFinanceAutomation({
    access:{primary:()=>tab.primaryTab,authenticated:()=>!!loadSession(),online:()=>effects.isOnline(),busy:()=>local.bankBusy||local.creditBusy,capture:()=>operationScope.capture()},
    preferences:bridge,readLastSyncAt:kind=>kind==='bank'?bankLastSyncAt(checksSession.kupaCloudReadState):creditLastSyncAt(checksSession.kupaCloudReadState),
    commands:{bank:owned(refreshBank),credit:owned(refreshCredit)},onPreferenceFailure:kind=>notifyFinanceStatus(kind),
  });
  const {startAutoSync,stopAutoSync,scheduleBankAuto,scheduleCreditAuto,maybeAutoRefreshBank,maybeAutoRefreshCredit,setBankAutoEnabled,setCreditAutoEnabled,setCreditAutoMode}=financeAutomation;

  function owned(command){return (...args)=>work.isActive()?work.run(()=>command(...args)):Promise.resolve(false)}
  const api={snapshot,readSnapshot,setFinanceStatusListener,ensureBankDisplayArchive,refreshFinanceData,refreshBankBridgeStatus,refreshCreditBridgeStatus,copySafeCreditDiagnostics,exportCreditDataDiagnostics,saveBridgeToken,configureBankBridge,selectBankBridgeAccount,deleteBankBridgeCredentials,exportBankChequeDiagnostics,refreshBank,toggleBankTransactionHandled,markBankMorningVerified,acknowledgeMissingBankTransaction,acknowledgePersistentBankAlert,refreshCredit,saveCreditProfile,deleteCreditProfile,resetCreditSync,saveCreditCardOrder,setCreditCardMapping,acknowledgeCreditSettlementWarning,maybeAutoRefreshBank,maybeAutoRefreshCredit,startAutoSync,stopAutoSync,setBankAutoEnabled,setCreditAutoEnabled,setCreditAutoMode,saveCashflowMinimum,saveCashflowCheckCutoff,mutateKupaCloud,captureCreditConnection,captureCreditReset,captureBankConnection};
  for(const name of ['ensureBankDisplayArchive', 'refreshFinanceData', 'refreshBankBridgeStatus', 'refreshCreditBridgeStatus', 'copySafeCreditDiagnostics', 'exportCreditDataDiagnostics', 'saveBridgeToken', 'configureBankBridge', 'selectBankBridgeAccount', 'deleteBankBridgeCredentials', 'exportBankChequeDiagnostics', 'refreshBank', 'toggleBankTransactionHandled', 'markBankMorningVerified', 'acknowledgeMissingBankTransaction', 'acknowledgePersistentBankAlert', 'refreshCredit', 'saveCreditProfile', 'deleteCreditProfile', 'resetCreditSync', 'saveCreditCardOrder', 'setCreditCardMapping', 'acknowledgeCreditSettlementWarning', 'maybeAutoRefreshBank', 'maybeAutoRefreshCredit', 'saveCashflowMinimum', 'saveCashflowCheckCutoff', 'mutateKupaCloud'])api[name]=owned(api[name]);
  return {...api,runtime:{isPending:work.isPending,drain:work.drain,dispose:()=>{if(!work.close())return false;stopAutoSync();financeStatusListener=()=>{};return true}}};
}
