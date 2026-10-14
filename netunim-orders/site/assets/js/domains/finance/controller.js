import {createRuntimeTaskOwner} from '../../shared/runtime-task-owner.js';
import {createOrdersFinanceAutomation} from './automation.js';
import {createRevisionSelector} from '../../shared/revision-selector.js';
import {applyCreditCardOrderData} from '../../shared/credit-card-order.js';
import {applyCreditCardAccountTransitionData} from '../../shared/credit-card-account.js';
import {clone} from '../../core/values.js';
import {checkTodayISO} from '../../core/dates.js';
import {normalizeBankFeed} from './bank-feed.js';
import {creditCardMappingKey,normalizeCreditSync} from './credit-feed.js';
import {normalizeCashflowSettings} from '../../shared/cashflow.js';
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
    let assertConnection;
    try{
      assertConnection=captureBankConnection();
      const result=await command();
      assertConnection();
      if(result.ok){local.bankError='';local.bankErrorAt=null}
      else if(result.failure){local.bankError=result.failure;local.bankErrorAt=new Date().toISOString();toast(result.failure)}
      return result.ok;
    }catch(error){
      try{assertConnection?.()}catch{return false}
      if(scopeChanged(error))return false;
      local.bankError=error?.message||String(error);local.bankErrorAt=new Date().toISOString();toast(local.bankError);
      return false;
    }finally{local.bankBusy=false}
  }
  function configureBankBridge(input){return bankConnectionWrite(()=>bankConnections.commands.configure(input),{clearBefore:true})}
  function selectBankBridgeAccount(role,branchNumber,accountNumber){return bankConnectionWrite(()=>bankConnections.commands.selectAccount(role,branchNumber,accountNumber))}
  function deleteBankBridgeCredentials(){return bankConnectionWrite(bankConnections.commands.deleteCredentials)}
  function exportBankChequeDiagnostics(){return local.bankBusy||local.creditBusy?Promise.resolve(false):bankConnections.commands.exportDiagnostics()}

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

  async function setCreditCardMapping(profileId,accountNumber,field,value){try{const saved=await mutateFinanceCloud(kupa=>{const sync=normalizeCreditSync(kupa.creditSync),profile=sync.profiles.find(p=>p.profileId===profileId),key=creditCardMappingKey(profileId,accountNumber);let current=sync.cardMappings[key]||{included:false,hidden:false,account:profile?.defaultAccount==='ביתי'?'ביתי':'עסקי',cardName:'',manualFrame:null};if(field==='included')current.included=!!value;else if(field==='hidden')current.hidden=!!value;else if(field==='account')current=applyCreditCardAccountTransitionData(current,value,checkTodayISO());else if(field==='cardName')current.cardName=String(value||'').trim().slice(0,100);else if(field==='sortOrder'){const raw=String(value??'').trim(),order=raw===''?null:Number(raw);if(order!==null&&(!Number.isSafeInteger(order)||order<1))throw new Error('סדר הכרטיס חייב להיות מספר שלם חיובי');current.sortOrder=order}else if(field==='manualFrame'){const raw=String(value??'').trim(),amount=raw===''?null:Number(raw);if(amount!==null&&(!Number.isFinite(amount)||amount<0))throw new Error('מסגרת ידנית חייבת להיות מספר חיובי או אפס');current.manualFrame=amount===null?null:Math.round(amount*100)/100}else return null;sync.cardMappings[key]=current;kupa.creditSync=sync;return kupa});if(local.creditError==='finance_sync_lease_busy'){local.creditError='';local.creditErrorAt=null}toast(saved.publicationWarning||'שיוך כרטיס האשראי עודכן');return true}catch(error){toast(error?.message||'שמירת הגדרת הכרטיס נכשלה');return false}}

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
  return {...api,creditRefreshAutomation:{allowed:()=>financeAutomation.allowed('credit'),currentEpoch:()=>financeAutomation.currentEpoch(),mode:()=>financeAutomation.preferenceState().creditAutoMode},bankRefreshAutomation:{allowed:()=>financeAutomation.allowed('bank'),currentEpoch:()=>financeAutomation.currentEpoch(),lastSyncAt:()=>bankLastSyncAt(checksSession.kupaCloudReadState)},runtime:{
    isPending:()=>work.isPending()||creditRefresh.runtime.isPending()||bankRefresh.runtime.isPending(),
    async drain(){await Promise.all([work.drain(),creditRefresh.runtime.drain(),bankRefresh.runtime.drain()])},
    dispose(){
      if(!work.close())return false;
      stopAutoSync();creditRefresh.runtime.dispose();bankRefresh.runtime.dispose();financeStatusListener=()=>{};
      return true;
    },
  }};
}
