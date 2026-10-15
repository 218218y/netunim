import {captureCloudWriteScope,cloudWriteScopeIsCurrent,cloudWriteScopeHasIdentity} from '../shared/cloud-write-scope.js';
import {createOutboxRetryScheduler,normalizeCloudError} from '../shared/cloud-sync.js';
import {createRuntimeTaskOwner} from '../shared/runtime-task-owner.js';

// Main save admission, joined flight and retry/follow-up lifetime. ACK, RPC,
// conflict/rebase and authoritative publication remain separate owners.
export function createMainSaveOperation({session,tab,access,journal,write,confirmation,view}){
const {getCloudWriteScope,writeScopeCurrent,setWriteControl,isOnline,storageV2CloudOutboxActive}=access;
const {refreshStorageV2CloudState,materializeStorageV2CloudFlight,storageV2CommitPromise}=journal;
const {saveStorageV2CloudFlight,wake}=write;
const {cloudScopeAccess,cloudConfirmationAccess,confirmCloudSynced}=confirmation;
const {setSaveStatus,setCloudHeaderStatus,showSecondaryTabGuard,toast}=view;
const outboxRetryScheduler=createOutboxRetryScheduler();
let savingScope=null,cloudSavePromise=null,wakeEpoch=0;
const saveWork=createRuntimeTaskOwner();
function v2RetryRecord(state,flight=null){return {domain:'kupa',documentName:`${session.cloudDocumentName||'main'}-v2`,generation:Number(flight?.generation??state?.pendingGeneration??0),operationId:String(flight?.operationId||'kupa-v2'),retry:state?.control?.retry||null}}

function requestStorageV2CloudSave(...args){
  return saveWork.run(()=>runStorageV2CloudSave(...args));
}
async function runStorageV2CloudSave(message='הקופה סונכרנה לענן',{force=false}={}){
  const wakeGeneration=wakeEpoch;
  const liveScope=getCloudWriteScope();if(!tab.primaryTab){showSecondaryTabGuard();return false}if(!force&&(session.connectionMode!=='supabase'||!session.backendReady))return false;let state=await refreshStorageV2CloudState();const scope=captureCloudWriteScope(liveScope,state);if(!writeScopeCurrent(scope,state))return false;if(!state?.base)return false;if(state.control?.conflict){session.cloudConflictPending=true;setSaveStatus('התנגשות שמורה מקומית','error');setCloudHeaderStatus('conflict','ענן: התנגשות');return false}
  if(!isOnline()){try{await storageV2CommitPromise()}catch(error){console.error('kupa V2 journal offline commit',error)}if(!writeScopeCurrent(scope))return false;setSaveStatus('אופליין — שינוי שמור מקומית וממתין','saving');setCloudHeaderStatus('offline','ענן: אופליין');return false}
  if(cloudSavePromise&&cloudWriteScopeHasIdentity(scope,savingScope))return cloudSavePromise;
  savingScope=scope;
  let followup=false;
  const saving=(async()=>{
    while(writeScopeCurrent(scope)&&cloudConfirmationAccess(force)&&!session.cloudConflictPending){
      const generation=Number(session.localGeneration||0);
      state=await refreshStorageV2CloudState();
      if(!cloudConfirmationAccess(force)||!writeScopeCurrent(scope,state))return false;
      if(state.control?.conflict){session.cloudConflictPending=true;return false}
      const currentFlight=state.flight||null,retryDelay=outboxRetryScheduler.schedule(v2RetryRecord(state,currentFlight),()=>writeScopeCurrent(scope)?requestStorageV2CloudSave(message,{force}):false);
      if(retryDelay>0){setSaveStatus('ממתין למועד הסנכרון שהשרת קבע','saving');setCloudHeaderStatus('syncing','ענן: ממתין לסנכרון');return false}
      const flight=currentFlight||await materializeStorageV2CloudFlight();
      if(!writeScopeCurrent(scope))return false;
      if(!flight){
        const confirmation=await confirmCloudSynced(generation,state,{force,scope});
        followup=confirmation.advanced&&writeScopeCurrent(scope,confirmation.head);
        if(confirmation.synced&&message)toast(message);
        return confirmation.synced;
      }
      if(!cloudConfirmationAccess(force)||!cloudWriteScopeIsCurrent(scope,getCloudWriteScope(),{base:flight}))return false;
      session.cloudSyncBusy=true;setSaveStatus('מסנכרן…','saving');setCloudHeaderStatus('syncing','ענן: מסנכרן…');
      try{
        const saved=await saveStorageV2CloudFlight(flight,scope);if(!saved||!writeScopeCurrent(scope,saved.state))return false;
        outboxRetryScheduler.cancel();
        const confirmation=await confirmCloudSynced(generation,saved.state,{force,scope});
        if(confirmation.synced){if(message)toast(message);return true}
        // Continue the existing drain only for work represented in the ACK
        // receipt. A later edit/backup completion belongs to the next wakeup.
        if(saved.state?.pending&&cloudConfirmationAccess(force)&&writeScopeCurrent(scope,confirmation.head)&&!confirmation.head?.control)continue;
        followup=confirmation.advanced&&writeScopeCurrent(scope,confirmation.head);
        return false;
      }catch(error){
        console.error('kupa cloud save V2',error);
        if(!writeScopeCurrent(scope)||!cloudScopeAccess(force))return false;
        state=await refreshStorageV2CloudState();if(!cloudScopeAccess(force)||!writeScopeCurrent(scope,state))return false;
        const normalized=normalizeCloudError(error),attempts=Number(state?.control?.retry?.attempts||0)+1,nextAttemptAt=normalized.retryAfterMs?new Date(Date.now()+normalized.retryAfterMs).toISOString():null,retry={attempts,lastErrorCode:normalized.code||normalized.kind,lastAttemptAt:new Date().toISOString(),nextAttemptAt};
        await setWriteControl(scope,{retry});state=await refreshStorageV2CloudState();
        if(!cloudScopeAccess(force)||!writeScopeCurrent(scope,state))return false;
        outboxRetryScheduler.schedule(v2RetryRecord(state,state?.flight),()=>writeScopeCurrent(scope)?requestStorageV2CloudSave(message,{force}):false);
        setSaveStatus(isOnline()?'ממתין לסנכרון':'אופליין — שינוי שמור מקומית','saving');setCloudHeaderStatus(isOnline()?'syncing':'offline',isOnline()?'ענן: ממתין לסנכרון':'ענן: אופליין');return false;
      }finally{if(cloudWriteScopeHasIdentity(scope,getCloudWriteScope())){session.cloudSyncBusy=false;session.cloudWriteBusy=false}}
    }
    return false;
  })().finally(()=>{
    if(cloudSavePromise===saving){cloudSavePromise=null;savingScope=null}
    // Consume a newer generation through the existing owner, after clearing the
    // joined promise. Explicitly stopped/denied owners cannot be restarted here.
    if(wakeGeneration===wakeEpoch&&writeScopeCurrent(scope)&&followup&&session.cloudPollingEnabled&&cloudConfirmationAccess(force))void wake();
  });cloudSavePromise=saving;return saving
}

async function persistSupabaseState(_snapshot,msg){
  if(!tab.primaryTab){showSecondaryTabGuard();return false}
  if(!storageV2CloudOutboxActive())throw new Error('kupa_v2_account_head_required');
  try{await storageV2CommitPromise()}
  catch(error){console.error('kupa V2 journal commit before cloud save',error);setSaveStatus('השינוי לא נשמר באחסון המקומי — אין לסגור את החלון','error');setCloudHeaderStatus('conflict','ענן: נדרש שחזור אחסון מקומי');return false}
  return requestStorageV2CloudSave(msg);
}

return {
    request:requestStorageV2CloudSave,
    runtime:{isPending:saveWork.isPending,drain:saveWork.drain},
    isSaving:()=>!!cloudSavePromise,
    cancelRetry:()=>outboxRetryScheduler.cancel(),
    stop(){wakeEpoch++},
    persistSupabaseState,
};
}
