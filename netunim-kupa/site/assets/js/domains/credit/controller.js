import {createRuntimeTaskOwner} from '../../shared/runtime-task-owner.js';
import {CREDIT_AUTO_INTERVAL_MS,creditRefreshDue as due,financeRefreshDelayMs,financeAttemptDelayMs} from '../../shared/finance-refresh-policy.js';
import {applyCreditCardOrderData} from '../../shared/credit-card-order.js';
import {applyCreditCardAccountTransitionData} from '../../shared/credit-card-account.js';
import {createPollingTask} from '../../shared/runtime-polling.js';
import {normalizeCreditAutoMode} from '../../shared/credit-sync-policy.js';
import {todayISO} from '../../core/dates.js';
import {creditCardMappingKey,normalizeCreditSync} from './sync-feed.js';

const CREDIT_AUTO_RETRY_MS=24*60*60*1000;

export function createDomainsCreditController({model,toast,render,renderStatus=render,bridge,preferences,connections,confirmDialog,autoScope,captureOperation:readOperation,timers=globalThis,publication,creditRefresh}){
  if(typeof autoScope!=='function')throw new Error('credit_auto_scope_required');
  if(typeof readOperation!=='function')throw new Error('credit_operation_scope_required');
  if(!preferences||!['read','setEnabled','setMode','markAttempt','reset'].every(key=>typeof preferences[key]==='function'))throw new Error('credit_preferences_port_required');
  for(const method of ['snapshot','supported','connectionProfile','capture','tokenConfigured','refreshStatus'])if(typeof connections?.queries?.[method]!=='function')throw new TypeError(`credit_connection_query_${method}_required`);
  for(const method of ['copyDiagnostics','exportData','saveConnection','deleteConnection'])if(typeof connections?.commands?.[method]!=='function')throw new TypeError(`credit_connection_command_${method}_required`);
  if(typeof creditRefresh?.commands?.refresh!=='function')throw new TypeError('credit_refresh_required');
  for(const method of ['isPending','drain','dispose'])if(typeof creditRefresh?.runtime?.[method]!=='function')throw new TypeError('credit_refresh_runtime_'+method+'_required');
  for(const method of ['commit','retry','status'])if(typeof publication?.[method]!=='function')throw new TypeError('credit_publication_'+method+'_required');
  const work=createRuntimeTaskOwner();let disposed=false;
  const captureOperation=()=>{
    const assertOwner=readOperation();
    return ()=>{if(disposed)throw Object.assign(new Error('credit_disposed'),{code:'FINANCE_OPERATION_SCOPE_CHANGED'});assertOwner()};
  };
  const local={busy:false,error:'',errorAt:null,autoScheduled:false,preferenceWarning:'',preferenceWarningCode:''};
  let automaticActive=true,automaticOwner=null,preferencesPaused=false;
  const automaticAllowed=()=>{
    const scope=autoScope();if(disposed||!automaticActive||typeof scope!=='string'||!scope.length)return false;
    if(automaticOwner===null)automaticOwner=scope;
    return scope===automaticOwner&&autoEnabled()&&connections.queries.tokenConfigured();
  };
  const autoTask=createPollingTask({timers,canRun:automaticAllowed,delay:autoDelay,run:receipt=>tracked(runAutomaticCredit,receipt),onError:error=>console.error('credit auto refresh',error),onState:({timer})=>{local.autoScheduled=timer!==null}});
  function preferenceResult(result){
    if(result.ok)return true;
    const changed=!preferencesPaused||local.preferenceWarningCode!==result.error.code;
    preferencesPaused=true;autoTask.stop();
    local.preferenceWarningCode=result.error.code;
    local.preferenceWarning='לא ניתן לקרוא או לשמור את העדפות האשראי במחשב זה. העדכון האוטומטי הושהה בחלון זה; ניתן לרענן ידנית. לאחר תיקון האחסון הפעל מחדש עדכון אוטומטי. ההשהיה לא נשמרה בהכרח לפתיחה הבאה.';
    // A background gate may stop before entering the task's finally/render.
    // Publish the transition once; repeated reads during rendering stay quiet.
    if(changed)renderStatus();
    return false;
  }
  function readPreferences(){const result=preferences.read();return preferenceResult(result)?result.value:null}
  function clearPreferenceFailure(){preferencesPaused=false;local.preferenceWarning='';local.preferenceWarningCode=''}
  function autoEnabled(){const settings=readPreferences();return !preferencesPaused&&settings?.enabled===true}
  function autoMode(){return normalizeCreditAutoMode(readPreferences()?.mode)}
  function markAutoAttempt(){return preferenceResult(preferences.markAttempt())}
  function autoAttemptDelayMs(){const settings=readPreferences();if(!settings)return Infinity;return financeAttemptDelayMs(settings.attemptAt,CREDIT_AUTO_RETRY_MS)}
  function autoAttemptReady(){return autoAttemptDelayMs()===0}
  function creditSyncUiState(){const settings=readPreferences();return {...connections.queries.snapshot(),...local,...publication.status(),autoEnabled:!preferencesPaused&&settings?.enabled===true,autoMode:normalizeCreditAutoMode(settings?.mode),sync:normalizeCreditSync(model.state.creditSync)}}
  const refreshCreditBridgeStatus=connections.queries.refreshStatus;
  const supportedCreditBridge=connections.queries.supported;
  const connectionProfile=connections.queries.connectionProfile;
  const copySafeCreditDiagnostics=connections.commands.copyDiagnostics;
  const saveCreditConnection=connections.commands.saveConnection;
  const deleteCreditConnection=connections.commands.deleteConnection;
  async function exportCreditDataDiagnostics(){
    if(local.busy)return false;
    if(!connections.queries.tokenConfigured()){
      toast('יש להגדיר מפתח ל-Bank Bridge לפני ייצוא נתוני האשראי');
      return false;
    }
    const {status}=connections.queries.snapshot();
    if(status&&!supportedCreditBridge(status)){
      toast('יש להפעיל את install_bank_bridge.bat לשדרוג Bank Bridge לפני ייצוא נתוני האשראי');
      return false;
    }
    return connections.commands.exportData();
  }

  async function resetCreditSync(){
    if(local.busy)return toast('כבר מתבצע סנכרון אשראי');
    let assertCurrent;
    try{const assertOwner=captureOperation(),assertConnection=connections.queries.capture();assertCurrent=()=>{assertOwner();assertConnection()}}catch(error){toast(error.message);return false}
    if(!await confirmDialog('לאפס את כל סנכרון האשראי?','האיפוס ימחק את כל חיבורי חברות האשראי המוצפנים מהמחשב הזה וגם את נתוני הסנכרון, השיוכים והשגיאות השמורים בקופה/בענן. תוספות ידניות חדשות שנוצרו לאחר המעבר לסנכרון יישארו, משום שהן שכבה משלימה ולא מקור חלופי.',{confirmText:'אפס והתחל מחדש'}))return;
    if(disposed)return false;
    local.busy=true;local.error='';local.errorAt=null;render();
    try{
      assertCurrent();
      const status=connections.queries.snapshot().status||await refreshCreditBridgeStatus();
      assertCurrent();
      if(!status)throw new Error(local.bridgeError||'Bank Bridge אינו זמין');
      if(!supportedCreditBridge(status))throw new Error('יש לשדרג את Bank Bridge לפני איפוס מלא של סנכרון האשראי');
      await bridge.resetCreditProfiles();
      assertCurrent();
      automaticActive=false;autoTask.stop();if(preferenceResult(preferences.reset()))clearPreferenceFailure();
      await publishCreditSync(normalizeCreditSync({}),'סנכרון האשראי אופס והופרד מגיבויי הקופה',null,assertCurrent,assertCurrent);
      await refreshCreditBridgeStatus();
      assertCurrent();
      toast(publication.status().publicationWarning||'סנכרון האשראי אופס. אפשר להגדיר מחדש חיבור אחד לכל בעל חשבון וחברה.');
      if(local.preferenceWarning)toast(local.preferenceWarning);
    }catch(e){if(disposed)return false;local.error=e?.message||String(e);local.errorAt=new Date().toISOString();toast(local.error)}
    finally{local.busy=false;render();scheduleAuto()}
  }

  async function refreshCreditSync({interactive=false,auto=false,syncMode='forecast',isCurrent=()=>true}={}){
    const scope=auto?autoScope():null,allowed=()=>isCurrent()&&automaticAllowed()&&autoScope()===scope;
    if(auto&&!allowed())return false;
    if(local.busy)return;
    local.busy=true;local.error='';local.errorAt=null;if(auto)renderStatus();else render();
    try{
      return await creditRefresh.commands.refresh({interactive,auto,syncMode,allowed,
        onDenied:()=>{if(!auto)toast('סינכרון אשראי כבר מתבצע ממחשב או חלון אחר. לא נפתחה כניסה נוספת לחברות האשראי.');},
        onDeferred:()=>{local.error='';local.errorAt=null;if(!auto)toast('לא נשלחה בקשה חדשה: החיבור מושהה עד מועד ה־403/429 הקודם. גם רענון עם חלון אבחון מכבד את ההשהיה.');},
        onPublished:(result,deferredOnly)=>{if(!auto)toast(publication.status().publicationWarning||(deferredOnly?'החיבור מושהה עקב 403/429; לא יישלח ניסיון נוסף לפני המועד.':result.errors?.length?`הסנכרון הושלם עם ${result.errors.length} אזהרות`:'נתוני האשראי עודכנו'));},
        onFailed:(e,deferredOnly)=>{local.error=deferredOnly?'':e?.message||String(e);local.errorAt=deferredOnly?null:new Date().toISOString();},
        onDiagnosticsFailed:error=>{local.error=error.message||String(error);local.errorAt=new Date().toISOString();},
        onFailureFinished:deferredOnly=>{if(!auto)toast(deferredOnly?'החיבור מושהה עד תום ה־cooldown; לא יישלח ניסיון חדש לפני המועד.':local.error);},
      });
    }finally{
      local.busy=false;render();scheduleAuto();
    }
  }

  async function publishCreditSync(candidate,message,lease,assertCurrent,assertRetained){
    return publication.commit(state=>({...state,creditSync:candidate}),message,lease,assertCurrent,assertRetained);
  }

  async function persistCreditSettings(mutator,message){
    const assertCurrent=captureOperation();
    await publication.commit(state=>({...state,creditSync:mutator(normalizeCreditSync(state.creditSync))}),message,null,assertCurrent,assertCurrent);return true;
  }
  async function retryCreditPublication(){
    if(local.busy)return false;let assertCurrent;try{assertCurrent=captureOperation();assertCurrent()}catch(error){toast(error.message);return false}
    local.busy=true;render();
    try{const confirmed=await publication.retry(assertCurrent);assertCurrent();toast(publication.status().publicationWarning||(confirmed?'נתוני האשראי אומתו בענן והשמירה הנלווית הושלמה.':'לא נמצאה שמירה נלווית הממתינה לבדיקה.'));return confirmed}
    catch(error){toast(error.message||'בדיקת הנתונים בענן נכשלה');return false}
    finally{local.busy=false;render()}
  }
  async function saveCreditCardOrder(keys){return persistCreditSettings(sync=>applyCreditCardOrderData(sync,keys),'סדר הכרטיסים נשמר')}
  async function setCreditCardMapping(profileId,accountNumber,field,value){
    try{
      await persistCreditSettings(normalizedSync=>{
    const sync=normalizedSync,profile=sync.profiles.find(p=>p.profileId===profileId),key=creditCardMappingKey(profileId,accountNumber);let current=sync.cardMappings[key]||{included:false,hidden:false,account:profile?.defaultAccount==='ביתי'?'ביתי':'עסקי',cardName:'',manualFrame:null};
    if(field==='included')current.included=!!value;
    if(field==='hidden')current.hidden=!!value;
    if(field==='account')current=applyCreditCardAccountTransitionData(current,value,todayISO());
    if(field==='cardName')current.cardName=String(value||'').trim().slice(0,100);
    if(field==='sortOrder'){const raw=String(value??'').trim(),order=raw===''?null:Number(raw);if(order!==null&&(!Number.isSafeInteger(order)||order<1))throw new Error('סדר הכרטיס חייב להיות מספר שלם חיובי');current.sortOrder=order}
    if(field==='manualFrame'){const raw=String(value??'').trim(),amount=raw===''?null:Number(raw);if(amount!==null&&(!Number.isFinite(amount)||amount<0))throw new Error('מסגרת ידנית חייבת להיות מספר חיובי או אפס');current.manualFrame=amount===null?null:Math.round(amount*100)/100}
        sync.cardMappings[key]=current;return sync;
      },'שיוך כרטיס האשראי עודכן');render();return true;
    }catch(error){if(disposed)return false;toast(error?.message||'שמירת הגדרת הכרטיס נכשלה');render();return false}
  }

  function setCreditAutoRefresh(enabled){
    if(disposed)return false;
    if(!enabled)autoTask.stop();
    const readable=!enabled||!!readPreferences(),saved=readable&&preferenceResult(preferences.setEnabled(enabled));
    if(saved){clearPreferenceFailure();if(enabled){automaticActive=true;automaticOwner=null;autoTask.start()}}
    else toast(local.preferenceWarning);
    render();return !!saved;
  }
  function setCreditAutoMode(mode){if(disposed)return false;const saved=preferenceResult(preferences.setMode(normalizeCreditAutoMode(mode)));if(saved)scheduleAuto();else toast(local.preferenceWarning);render();return saved}
  function autoDelay(){
    const wait=financeRefreshDelayMs(model.state.creditSync?.syncedAt,CREDIT_AUTO_INTERVAL_MS),retryWait=autoAttemptDelayMs();
    return Math.max(1000,wait+250,retryWait+250);
  }
  function scheduleAuto(){if(!disposed&&automaticActive)autoTask.start()}
  async function runAutomaticCredit({isCurrent}){
    if(local.busy||!due(model.state.creditSync?.syncedAt)||!autoAttemptReady())return false;
    const scope=autoScope();
    const status=connections.queries.snapshot().status||await refreshCreditBridgeStatus();if(!(status?.profiles||[]).length)return;
    if(!isCurrent()||autoScope()!==scope||!automaticAllowed())return false;
    return refreshCreditSync({interactive:false,auto:true,isCurrent});
  }
  function maybeAutoRefreshCreditSync(){return !disposed&&automaticActive?autoTask.wake():Promise.resolve(false)}
  function startAutoSync(){if(disposed)return Promise.resolve(false);automaticActive=true;automaticOwner=null;return autoTask.wake()}
  function stopAutoSync(){automaticActive=false;return autoTask.stop()}

  function tracked(method,...args){return disposed?Promise.resolve(false):work.run(()=>method(...args))}
  const runtime={
    isPending:()=>work.isPending()||creditRefresh.runtime.isPending(),
    async drain(){do{await Promise.all([work.drain(),autoTask.drain(),creditRefresh.runtime.drain()])}while(runtime.isPending())},
    dispose(){
      if(disposed)return false;
      disposed=true;work.close();stopAutoSync();
      creditRefresh.runtime.dispose();return true;
    },
  };
  const methods={refreshCreditBridgeStatus,copySafeCreditDiagnostics,exportCreditDataDiagnostics,saveCreditConnection,
    deleteCreditConnection,resetCreditSync,refreshCreditSync,retryCreditPublication,saveCreditCardOrder,setCreditCardMapping};
  const commands=Object.fromEntries(Object.entries(methods).map(([name,method])=>[name,(...args)=>tracked(method,...args)]));
  return {...commands,refreshAutomation:{mode:autoMode,markAttempt:markAutoAttempt},creditSyncUiState,connectionProfile,setCreditAutoRefresh,setCreditAutoMode,maybeAutoRefreshCreditSync,startAutoSync,stopAutoSync,runtime};
}
