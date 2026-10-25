import {createCashflowSettingsCommands} from './cashflow-commands.js';
import {createBankArchiveCommands} from './bank-archive-commands.js';
import {createCreditSettingsCommands} from './credit-settings-commands.js';
import {createFinanceConnectionCommands} from './connection-commands.js';
import {createRuntimeTaskOwner} from '../../shared/runtime-task-owner.js';
import {createOrdersFinanceAutomation} from './automation.js';
import {createRevisionSelector} from '../../shared/revision-selector.js';
import {clone} from '../../core/values.js';
import {normalizeBankFeed} from './bank-feed.js';
import {normalizeCreditSync} from './credit-feed.js';
import {FINANCE_PUBLICATION_WARNING} from './document-publication.js';
import {projectBankArchiveFeed} from './bank-archive-model.js';

function bankLastSyncAt(kupa){const feed=normalizeBankFeed(kupa?.bank?.feed);return feed?.syncedAt||kupa?.bank?.bankSyncAt||(kupa?.bank?.source==='hapoalim'?kupa?.bank?.updatedAt:null)||null}
function creditLastSyncAt(kupa){return normalizeCreditSync(kupa?.creditSync).syncedAt}

export function createDomainsFinanceController({
  tab,
  checksSession,
  bridge,
  operationScope,
  loadSession,
  refreshKupaReadout,
  getSharedChecks = () => [],
  toast,
  creditRefresh,
  setBankTransactionHandled: saveBankTransactionHandled = async () => null,
  acknowledgeBankTransactionMissing = async () => null,
  acknowledgeBankTransactionAlert = async () => null,
  effects,
  documents,
  archive,
  connections,
  bankConnections,
  bankRefresh,
}) {
  if(typeof operationScope?.capture!=='function'||typeof operationScope?.captureRead!=='function')throw new Error('orders_finance_operation_scope_required');
  for(const method of ['isOnline','delay'])if(typeof effects?.[method]!=='function')throw new TypeError(`orders_finance_effect_${method}_required`);
  const work=createRuntimeTaskOwner();
  const scopeChanged=error=>error?.code==='FINANCE_OPERATION_SCOPE_CHANGED'||error?.code==='CREDIT_CONNECTION_SCOPE_CHANGED'||error?.code==='BRIDGE_PAIRING_SCOPE_CHANGED';
  const local={bankBusy:false,bankResultReady:false,creditBusy:false,bankError:'',creditError:'',bankErrorAt:null,creditErrorAt:null};
  let financeStatusListener=()=>{};
  for (const method of ['mutateKupa','mutateFinance']) {
    if (typeof documents?.commands?.[method] !== 'function')
      throw new TypeError('orders_finance_document_command_'+method+'_required');
  }
  if (typeof documents?.queries?.readFinance !== 'function')
    throw new TypeError('orders_finance_document_query_required');
  if(typeof creditRefresh?.commands?.refresh!=='function')throw new TypeError('orders_credit_refresh_required');
  for(const method of ['isPending','drain','dispose'])if(typeof creditRefresh?.runtime?.[method]!=='function')throw new TypeError('orders_credit_refresh_runtime_'+method+'_required');
  const mutateKupaCloud = documents.commands.mutateKupa, mutateFinanceCloud = documents.commands.mutateFinance;
  if(typeof bankRefresh?.commands?.refresh!=='function')throw new TypeError('orders_bank_refresh_required');
  for(const method of ['isPending','drain','dispose'])if(typeof bankRefresh?.runtime?.[method]!=='function')throw new TypeError('orders_bank_refresh_runtime_'+method+'_required');
  const publicationWarning = FINANCE_PUBLICATION_WARNING;
  for (const method of ['matching','ready','revision'])
    if (typeof archive?.queries?.[method] !== 'function')
      throw new TypeError('orders_bank_archive_query_' + method + '_required');
  for (const method of ['update'])
    if (typeof archive?.commands?.[method] !== 'function')
      throw new TypeError('orders_bank_archive_command_' + method + '_required');
  for (const method of ['ensure','pause','resume'])
    if (typeof archive?.runtime?.[method] !== 'function')
      throw new TypeError('orders_bank_archive_runtime_' + method + '_required');
  for(const method of ['snapshot','capture','supported','readStatus','refreshStatus'])if(typeof connections?.queries?.[method]!=='function')throw new TypeError('orders_credit_connection_query_'+method+'_required');
  for(const method of ['copyDiagnostics','exportData','saveProfile','deleteProfile','resetProfiles','reportFailure'])if(typeof connections?.commands?.[method]!=='function')throw new TypeError('orders_credit_connection_command_'+method+'_required');
  const projectionRevision = archive.queries.revision, bankAlertsReady = archive.queries.ready;
  const ensureBankDisplayArchive = archive.runtime.ensure;
  const displayArchiveFeed = (role,feed) => projectBankArchiveFeed(archive,role,feed);

  for(const method of ['snapshot','capture','supported','readStatus','refreshStatus'])if(typeof bankConnections?.queries?.[method]!=='function')throw new TypeError('orders_bank_connection_query_'+method+'_required');
  for(const method of ['configure','selectAccount','deleteCredentials','exportDiagnostics','recordScan','reportFailure'])if(typeof bankConnections?.commands?.[method]!=='function')throw new TypeError('orders_bank_connection_command_'+method+'_required');
  function bankConnectionState(){const state=bankConnections.queries.snapshot();return {bankStatus:state.status?clone(state.status):null,bankStatusChecked:state.checked,bankBridgeError:state.bridgeError}}
  const refreshBankBridgeStatus=bankConnections.queries.refreshStatus,captureBankConnection=bankConnections.queries.capture;
  function creditConnectionState(){const state=connections.queries.snapshot();return {creditStatus:state.status?clone(state.status):null,creditStatusChecked:state.checked,creditBridgeError:state.bridgeError}}
  const refreshCreditBridgeStatus=connections.queries.refreshStatus,copySafeCreditDiagnostics=connections.commands.copyDiagnostics;
  const captureCreditConnection=connections.queries.capture;
  function captureCreditReset(){try{const assertOwner=operationScope.capture(),assertConnection=captureCreditConnection();return ()=>{assertOwner();assertConnection()}}catch(error){toast(error?.message||String(error));return null}}
  function exportCreditDataDiagnostics(){return local.bankBusy||local.creditBusy?Promise.resolve(false):connections.commands.exportData()}
  function snapshot(){const kupa=checksSession.kupaCloudReadState&&typeof checksSession.kupaCloudReadState==='object'?clone(checksSession.kupaCloudReadState):null;if(kupa)kupa.checks=clone(getSharedChecks());const rawBank=kupa?.bank||null,bank=rawBank?{...rawBank,feed:displayArchiveFeed('business',rawBank.feed),homeFeed:displayArchiveFeed('home',rawBank.homeFeed)}:null;return {kupa,bank,bankAlertsReady:bankAlertsReady(),creditSync:normalizeCreditSync(kupa?.creditSync),cards:Array.isArray(kupa?.cards)?kupa.cards:[],credits:Array.isArray(kupa?.credits)?kupa.credits:[],bankLastSyncAt:bankLastSyncAt(kupa),creditLastSyncAt:creditLastSyncAt(kupa),...financeAutomation.preferenceState(),bankBusy:local.bankBusy,bankResultReady:local.bankResultReady,creditBusy:local.creditBusy,bankError:local.bankError,creditError:local.creditError,bankErrorAt:local.bankErrorAt,creditErrorAt:local.creditErrorAt,...bankConnectionState(),...creditConnectionState()}}
  const readProjection=createRevisionSelector({revision:projectionRevision,select:snapshot,name:'orders-finance'});
  function readSnapshot(){return {...readProjection(),...financeAutomation.preferenceState(),bankBusy:local.bankBusy,bankResultReady:local.bankResultReady,creditBusy:local.creditBusy,bankError:local.bankError,creditError:local.creditError,bankErrorAt:local.bankErrorAt,creditErrorAt:local.creditErrorAt,...bankConnectionState(),...creditConnectionState()}}

  const {saveCashflowMinimum,saveCashflowCheckCutoff}=createCashflowSettingsCommands({mutateKupaCloud,loadSession,toast});
  const {toggleBankTransactionHandled,markBankMorningVerified,acknowledgeMissingBankTransaction,acknowledgePersistentBankAlert}=createBankArchiveCommands({
    operationScope,transport:{saveBankTransactionHandled,acknowledgeBankTransactionMissing,acknowledgeBankTransactionAlert},archive:{update:archive.commands.update},toast,
  });
  const {saveCreditProfile,deleteCreditProfile,resetCreditSync,saveCreditCardOrder,setCreditCardMapping,acknowledgeCreditSettlementWarning}=createCreditSettingsCommands({
    local,operationScope,connections,mutateFinanceCloud,automation:{
      setCreditAutoEnabled:(...args)=>setCreditAutoEnabled(...args),setCreditAutoMode:(...args)=>setCreditAutoMode(...args),
      scheduleCreditAuto:()=>scheduleCreditAuto(),preferenceState:()=>financeAutomation.preferenceState(),
    },toast,
  });
  const {saveBridgeToken,configureBankBridge,selectBankBridgeAccount,deleteBankBridgeCredentials,exportBankChequeDiagnostics}=createFinanceConnectionCommands({
    local,bridge,bankConnections,connections,policy:{scopeChanged,startAutoSync:()=>startAutoSync()},toast,
  });

  async function refreshFinanceData({force=true,renderIfChanged=true}={}){if(!loadSession()||!effects.isOnline())return snapshot();const assertCurrent=operationScope.captureRead();await refreshKupaReadout({force,renderIfChanged,assertCurrent});assertCurrent();return snapshot()}



  function setFinanceStatusListener(listener){financeStatusListener=typeof listener==='function'?listener:()=>{}}
  function notifyFinanceStatus(section){try{financeStatusListener(section)}catch(error){console.error('orders finance status listener',error)}}

  async function refreshBank({interactive=false,auto=false,isCurrent=()=>true}={}){
    if(local.bankBusy||local.creditBusy)return false;
    if(!tab.primaryTab||!loadSession()||!effects.isOnline())return false;
    if(!financeAutomation.tokenConfigured()){if(!auto)toast('יש לצמד את ניהול ההזמנות ל-Bank Bridge במחשב זה');return false}
    if(auto&&!financeAutomation.markAttempt('bank'))return false;
    archive.runtime.pause();
    local.bankBusy=true;local.bankResultReady=false;local.bankError='';local.bankErrorAt=null;
    try{
      return await bankRefresh.commands.refresh({interactive,auto,isCurrent,
        onStarted:()=>notifyFinanceStatus('bank'),
        onDenied:()=>{if(!auto)toast('סינכרון הבנק כבר מתבצע ממחשב או חלון אחר. לא נפתחה כניסה נוספת לבנק.');},
        onPublished:publication=>{
          const readoutVerified=publication.published,homeFailure=publication.homeFailed;
          if(!auto)toast(!readoutVerified?publicationWarning:homeFailure?'החשבון העסקי עודכן; החשבון הביתי נשאר בנתון האחרון':'נתוני הבנק העסקי והביתי עודכנו וזמינים בשתי המערכות');
          local.bankResultReady=true;notifyFinanceStatus('bank');
        },
        onFailed:(error,assertConnection,schedulerEpoch)=>{
          if(scopeChanged(error)&&schedulerEpoch===financeAutomation.currentEpoch())stopAutoSync();
          local.bankError=error?.message||String(error);local.bankErrorAt=new Date().toISOString();
          if(assertConnection)bankConnections.commands.reportFailure(error,assertConnection);
          if(!auto)toast(local.bankError);local.bankResultReady=true;notifyFinanceStatus('bank');
        },
      });
    }finally{
      local.bankBusy=false;
      archive.runtime.resume();
      local.bankResultReady=false;
      notifyFinanceStatus('bank');
      scheduleBankAuto();
    }
  }


  async function refreshCredit({interactive=false,auto=false,syncMode='forecast',isCurrent=()=>true}={}){
    if(local.creditBusy||local.bankBusy)return false;
    if(!tab.primaryTab||!loadSession()||!effects.isOnline())return false;
    if(!financeAutomation.tokenConfigured()){if(!auto)toast('יש לצמד את ניהול ההזמנות ל-Bank Bridge במחשב זה');return false}
    if(auto&&!financeAutomation.markAttempt('credit'))return false;
    local.creditBusy=true;local.creditError='';local.creditErrorAt=null;notifyFinanceStatus('credit');
    try{
      return await creditRefresh.commands.refresh({interactive,auto,syncMode,isCurrent,
        onDenied:()=>{if(!auto)toast('סינכרון אשראי כבר מתבצע ממחשב או חלון אחר. לא נפתחה כניסה נוספת לחברות האשראי.');},
        onDeferred:()=>{local.creditError='';local.creditErrorAt=null;if(!auto)toast('לא נשלחה בקשה חדשה: החיבור מושהה עד מועד ה־403/429 הקודם. גם רענון עם חלון אבחון מכבד את ההשהיה.');},
        onWarning:warning=>{local.creditError=warning;local.creditErrorAt=new Date().toISOString();if(!auto)toast(local.creditError);},
        onPublished:(saved,result,deferredOnly)=>{if(!auto&&!saved.skipped)toast(deferredOnly?'החיבור מושהה עקב 403/429; לא יישלח ניסיון נוסף לפני המועד.':result.errors?.length?`האשראי עודכן עם ${result.errors.length} אזהרות והנתונים זמינים בשתי המערכות`:'נתוני האשראי עודכנו וזמינים בשתי המערכות');},
        onFailed:(error,deferredOnly,schedulerEpoch)=>{
          if(scopeChanged(error)&&schedulerEpoch===financeAutomation.currentEpoch())stopAutoSync();
          local.creditError=deferredOnly?'':error?.message||String(error);local.creditErrorAt=deferredOnly?null:new Date().toISOString();
        },
        onDiagnosticsWarning:warning=>{local.creditError=[local.creditError,warning].filter(Boolean).join(' | ');local.creditErrorAt=new Date().toISOString();},
        onDiagnosticsFailed:(persistError,schedulerEpoch)=>{
          if(!scopeChanged(persistError))console.error('credit diagnostics save',persistError);
          local.creditError=persistError.message||String(persistError);local.creditErrorAt=new Date().toISOString();
          if(scopeChanged(persistError)&&schedulerEpoch===financeAutomation.currentEpoch())stopAutoSync();
          if(!auto)toast(local.creditError);
        },
        onFailureFinished:deferredOnly=>{if(!auto)toast(local.creditError||(deferredOnly?'החיבור מושהה עד תום ה־cooldown; לא יישלח ניסיון חדש לפני המועד.':''));},
      });
    }finally{
      local.creditBusy=false;notifyFinanceStatus('credit');scheduleCreditAuto();
    }
  }


  const financeAutomation=createOrdersFinanceAutomation({
    access:{primary:()=>tab.primaryTab,authenticated:()=>!!loadSession(),online:()=>effects.isOnline(),busy:()=>local.bankBusy||local.creditBusy,capture:()=>operationScope.capture()},
    preferences:bridge,readLastSyncAt:kind=>kind==='bank'?bankLastSyncAt(checksSession.kupaCloudReadState):creditLastSyncAt(checksSession.kupaCloudReadState),
    commands:{bank:owned(refreshBank),credit:owned(refreshCredit)},onPreferenceFailure:kind=>notifyFinanceStatus(kind),
  });
  const {startAutoSync,resumeAutoSync,stopAutoSync,scheduleBankAuto,scheduleCreditAuto,maybeAutoRefreshBank,maybeAutoRefreshCredit,setBankAutoEnabled,setCreditAutoEnabled,setCreditAutoMode}=financeAutomation;

  function owned(command){return (...args)=>work.isActive()?work.run(()=>command(...args)):Promise.resolve(false)}
  const api={snapshot,readSnapshot,setFinanceStatusListener,ensureBankDisplayArchive,refreshFinanceData,refreshBankBridgeStatus,refreshCreditBridgeStatus,copySafeCreditDiagnostics,exportCreditDataDiagnostics,saveBridgeToken,configureBankBridge,selectBankBridgeAccount,deleteBankBridgeCredentials,exportBankChequeDiagnostics,refreshBank,toggleBankTransactionHandled,markBankMorningVerified,acknowledgeMissingBankTransaction,acknowledgePersistentBankAlert,refreshCredit,saveCreditProfile,deleteCreditProfile,resetCreditSync,saveCreditCardOrder,setCreditCardMapping,acknowledgeCreditSettlementWarning,maybeAutoRefreshBank,maybeAutoRefreshCredit,startAutoSync,resumeAutoSync,stopAutoSync,setBankAutoEnabled,setCreditAutoEnabled,setCreditAutoMode,saveCashflowMinimum,saveCashflowCheckCutoff,mutateKupaCloud,captureCreditConnection,captureCreditReset,captureBankConnection};
  for(const name of ['ensureBankDisplayArchive', 'refreshFinanceData', 'refreshBankBridgeStatus', 'refreshCreditBridgeStatus', 'copySafeCreditDiagnostics', 'exportCreditDataDiagnostics', 'saveBridgeToken', 'configureBankBridge', 'selectBankBridgeAccount', 'deleteBankBridgeCredentials', 'exportBankChequeDiagnostics', 'refreshBank', 'toggleBankTransactionHandled', 'markBankMorningVerified', 'acknowledgeMissingBankTransaction', 'acknowledgePersistentBankAlert', 'refreshCredit', 'saveCreditProfile', 'deleteCreditProfile', 'resetCreditSync', 'saveCreditCardOrder', 'setCreditCardMapping', 'acknowledgeCreditSettlementWarning', 'maybeAutoRefreshBank', 'maybeAutoRefreshCredit', 'saveCashflowMinimum', 'saveCashflowCheckCutoff', 'mutateKupaCloud'])api[name]=owned(api[name]);
  return {...api,creditRefreshAutomation:{allowed:()=>financeAutomation.allowed('credit'),currentEpoch:()=>financeAutomation.currentEpoch(),mode:()=>financeAutomation.preferenceState().creditAutoMode},bankRefreshAutomation:{allowed:()=>financeAutomation.allowed('bank'),currentEpoch:()=>financeAutomation.currentEpoch(),lastSyncAt:()=>bankLastSyncAt(checksSession.kupaCloudReadState)},runtime:{
    isPending:()=>work.isPending()||creditRefresh.runtime.isPending()||bankRefresh.runtime.isPending(),
    async drain(){await Promise.all([work.drain(),creditRefresh.runtime.drain(),bankRefresh.runtime.drain()])},
    dispose(){
      if(!work.close())return false;
      financeAutomation.dispose();creditRefresh.runtime.dispose();bankRefresh.runtime.dispose();financeStatusListener=()=>{};
      return true;
    },
  }};
}
