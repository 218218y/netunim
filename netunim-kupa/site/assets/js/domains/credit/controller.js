import {createRuntimeTaskOwner} from '../../shared/runtime-task-owner.js';
import {CREDIT_AUTO_INTERVAL_MS,creditRefreshDue as due} from '../../shared/finance-refresh-policy.js';
import {applyCreditCardOrderData} from '../../shared/credit-card-order.js';
import {createPollingTask} from '../../shared/runtime-polling.js';
import {createCreditPublication} from './publication.js';
import {normalizeCreditAutoMode,normalizeCreditFetchMode,resolveCreditAutoSyncMode} from '../../shared/credit-sync-policy.js';
import {uid} from '../../core/values.js';
import {creditCardMappingKey,creditSyncScrapeSelection,mergeCreditSyncResult,normalizeCreditSync} from './sync-feed.js';

const CREDIT_AUTO_RETRY_MS=24*60*60*1000;

export function createDomainsCreditController({model,saveState,toast,render,renderStatus=render,bridge,preferences,connections,confirmDialog,autoScope,captureOperation:readOperation,timers=globalThis,refreshFinanceCloudSnapshot=async()=>({verified:true,state:model.state}),saveFinancePatch=async()=>({saved:false}),syncLeases}){
  if(typeof autoScope!=='function')throw new Error('credit_auto_scope_required');
  if(typeof readOperation!=='function')throw new Error('credit_operation_scope_required');
  if(!preferences||!['read','setEnabled','setMode','markAttempt','reset'].every(key=>typeof preferences[key]==='function'))throw new Error('credit_preferences_port_required');
  for(const method of ['snapshot','supported','connectionProfile','capture','tokenConfigured','refreshStatus'])if(typeof connections?.queries?.[method]!=='function')throw new TypeError(`credit_connection_query_${method}_required`);
  for(const method of ['copyDiagnostics','exportData','saveConnection','deleteConnection'])if(typeof connections?.commands?.[method]!=='function')throw new TypeError(`credit_connection_command_${method}_required`);
  if(typeof syncLeases?.commands?.acquire!=='function')throw new TypeError('credit_lease_acquire_required');
  for(const method of ['isPending','drain','dispose'])if(typeof syncLeases?.runtime?.[method]!=='function')throw new TypeError('credit_lease_runtime_'+method+'_required');
  const work=createRuntimeTaskOwner();let disposed=false;
  const captureOperation=()=>{
    const assertOwner=readOperation();
    return ()=>{if(disposed)throw Object.assign(new Error('credit_disposed'),{code:'FINANCE_OPERATION_SCOPE_CHANGED'});assertOwner()};
  };
  const local={busy:false,error:'',errorAt:null,autoScheduled:false,preferenceWarning:'',preferenceWarningCode:''};
  const publication=createCreditPublication({commit:saveFinancePatch,read:refreshFinanceCloudSnapshot,publish:state=>{model.state.creditSync=normalizeCreditSync(state.creditSync)},checkpoint:message=>saveState(message,{operations:[{type:'set',field:'creditSync',value:model.state.creditSync}]}),authority:{capture:()=>{const assertOwner=captureOperation(),assertConnection=connections.queries.capture();return ()=>{assertOwner();assertConnection()}}}});
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
  function autoAttemptDelayMs(){const settings=readPreferences();if(!settings)return Infinity;const n=settings.attemptAt;return n?Math.max(0,n+CREDIT_AUTO_RETRY_MS-Date.now()):0}
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
    if(!connections.queries.tokenConfigured()){toast('?? ???? ?? ????? ?-Bank Bridge ???? ????? ????? ?????');return false}
    const {status}=connections.queries.snapshot();
    if(status&&!supportedCreditBridge(status)){toast('?? ????? ???? install_bank_bridge.bat ???? ????? ????? ????? ?????');return false}
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
      await publishCreditSync(normalizeCreditSync({}),'סנכרון האשראי אופס והופרד מגיבויי הקופה',null,assertCurrent);
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
    let lease=null,leaseSession=null,autoCreditSync=model.state.creditSync,assertCurrent,assertOwner;
    try{
      const assertConnection=connections.queries.capture();
      assertOwner=captureOperation();assertCurrent=()=>{assertOwner();assertConnection();leaseSession?.assertCurrent()};
      if(auto){
        const latest=await refreshFinanceCloudSnapshot({assertCurrent});
        assertCurrent();
        if(!allowed())return false;
        if(!latest?.verified){if(!markAutoAttempt())return false;throw new Error('לא ניתן לאמת את זמן סנכרון האשראי המשותף בענן');}
        autoCreditSync=latest.state?.creditSync||autoCreditSync;
        if(!due(autoCreditSync?.syncedAt))return markAutoAttempt();
        if(!markAutoAttempt())return false;
      }
      leaseSession=syncLeases.commands.acquire('credit',uid('FINLEASE'),{assertCurrent:()=>{assertOwner();assertConnection()}});
      lease=await leaseSession.ready;
      assertCurrent();lease={...lease,assertCurrent};
      if(auto&&!allowed())return false;
      if(!lease.acquired){if(!auto)toast('סינכרון אשראי כבר מתבצע ממחשב או חלון אחר. לא נפתחה כניסה נוספת לחברות האשראי.');return false}
      if(auto){const latest=await refreshFinanceCloudSnapshot({assertCurrent});assertCurrent();if(!allowed())return false;if(!latest?.verified)throw new Error('לא ניתן לאמת מחדש את זמן סנכרון האשראי לאחר תפיסת הנעילה');autoCreditSync=latest.state?.creditSync||autoCreditSync;if(!due(autoCreditSync?.syncedAt))return true}
      const status=connections.queries.snapshot().status||await refreshCreditBridgeStatus();
      assertCurrent();
      if(auto&&!allowed())return false;
      if(!status)throw new Error(local.bridgeError||'Bank Bridge אינו זמין');
      if(!supportedCreditBridge(status))throw new Error('יש לשדרג את Bank Bridge לפני סנכרון אשראי');
      if(!(status.profiles||[]).length)throw new Error('לא הוגדר עדיין חיבור לחברת אשראי במחשב זה');
      const requestedMode=auto?resolveCreditAutoSyncMode(autoMode(),autoCreditSync,{profileIds:(status.profiles||[]).map(profile=>profile.profileId)}):normalizeCreditFetchMode(syncMode,'forecast');
      const selectionSource=auto?autoCreditSync:model.state.creditSync;
      if(auto&&!allowed())return false;
      const result=await bridge.syncCreditCards({interactive,syncMode:requestedMode,selection:creditSyncScrapeSelection(selectionSource)});
      assertCurrent();
      if(Number(result.attemptedCount)===0&&Number(result.deferredCount)>0){await refreshCreditBridgeStatus();assertCurrent();local.error='';local.errorAt=null;if(!auto)toast('לא נשלחה בקשה חדשה: החיבור מושהה עד מועד ה־403/429 הקודם. גם רענון עם חלון אבחון מכבד את ההשהיה.');return true}
      const candidate=mergeCreditSyncResult(model.state.creditSync,result);
      const deferredOnly=Array.isArray(result.errors)&&result.errors.length>0&&result.errors.every(error=>error?.severity==='deferred'||error?.deferred===true);
      await publishCreditSync(candidate,deferredOnly?'סנכרון האשראי הושהה ו־Last Known Good נשמר':result.errors?.length?'האשראי עודכן עם אזהרות ונשמר מחוץ לגיבויי הקופה':'האשראי עודכן ונשמר מחוץ לגיבויי הקופה',lease,assertCurrent);
      await refreshCreditBridgeStatus();
      assertCurrent();
      if(!auto)toast(publication.status().publicationWarning||(deferredOnly?'החיבור מושהה עקב 403/429; לא יישלח ניסיון נוסף לפני המועד.':result.errors?.length?`הסנכרון הושלם עם ${result.errors.length} אזהרות`:'נתוני האשראי עודכנו'));
    }catch(e){
      if(disposed)return false;
      try{assertCurrent?.()}catch(scopeError){e=scopeError}
      const deferredOnly=Array.isArray(e?.creditErrors)&&e.creditErrors.length>0&&e.creditErrors.every(error=>error?.severity==='deferred'||error?.deferred===true);local.error=deferredOnly?'':e?.message||String(e);local.errorAt=deferredOnly?null:new Date().toISOString();
      // If every local profile failed, the Bridge returns HTTP 400 with structured per-profile errors.
      // Persist those diagnostics without deleting the last successful profile data.
      if(Array.isArray(e?.creditErrors)&&e.creditErrors.length){
        try{
          const candidate=mergeCreditSyncResult(model.state.creditSync,{profiles:[],errors:e.creditErrors});
          await publishCreditSync(candidate,'אבחון סנכרון האשראי נשמר; הנתונים התקינים הקודמים נשמרו',lease,assertCurrent);
        }catch(error){local.error=error.message||String(error);local.errorAt=new Date().toISOString()}
      }
      if(!auto)toast(deferredOnly?'החיבור מושהה עד תום ה־cooldown; לא יישלח ניסיון חדש לפני המועד.':local.error)
    }
    // A former account's lease expires by TTL; never release it using a new login.
    finally{
      try{
        await leaseSession?.close();
      }catch(error){
        if(error.code!=='FINANCE_OPERATION_SCOPE_CHANGED')console.error('credit sync lease release',error);
      }
      local.busy=false;
      render();
      scheduleAuto();
    }
  }

  async function publishCreditSync(candidate,message,lease,assertCurrent){
    return publication.commit(state=>({...state,creditSync:candidate}),message,lease,assertCurrent);
  }

  async function persistCreditSettings(mutator,message){
    const assertCurrent=captureOperation();
    await publication.commit(state=>({...state,creditSync:mutator(normalizeCreditSync(state.creditSync))}),message,null,assertCurrent);return true;
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
    const sync=normalizedSync,profile=sync.profiles.find(p=>p.profileId===profileId),key=creditCardMappingKey(profileId,accountNumber),current=sync.cardMappings[key]||{included:false,hidden:false,account:profile?.defaultAccount==='ביתי'?'ביתי':'עסקי',cardName:'',manualFrame:null};
    if(field==='included')current.included=!!value;
    if(field==='hidden')current.hidden=!!value;
    if(field==='account')current.account=value==='ביתי'?'ביתי':'עסקי';
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
    const syncedAt=model.state.creditSync?.syncedAt,t=syncedAt?Date.parse(syncedAt):NaN;
    const wait=Number.isFinite(t)?Math.max(0,t+CREDIT_AUTO_INTERVAL_MS-Date.now()):0,retryWait=autoAttemptDelayMs();
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
    isPending:()=>work.isPending()||syncLeases.runtime.isPending(),
    async drain(){do{await Promise.all([work.drain(),autoTask.drain(),syncLeases.runtime.drain()])}while(runtime.isPending())},
    dispose(){
      if(disposed)return false;
      disposed=true;work.close();stopAutoSync();
      syncLeases.runtime.dispose();return true;
    },
  };
  const methods={refreshCreditBridgeStatus,copySafeCreditDiagnostics,exportCreditDataDiagnostics,saveCreditConnection,
    deleteCreditConnection,resetCreditSync,refreshCreditSync,retryCreditPublication,saveCreditCardOrder,setCreditCardMapping};
  const commands=Object.fromEntries(Object.entries(methods).map(([name,method])=>[name,(...args)=>tracked(method,...args)]));
  return {...commands,creditSyncUiState,connectionProfile,setCreditAutoRefresh,setCreditAutoMode,maybeAutoRefreshCreditSync,startAutoSync,stopAutoSync,runtime};
}
