import {captureCloudWriteScope,cloudWriteScopeIsCurrent,cloudWriteScopeHasIdentity} from '../shared/cloud-write-scope.js';
import {createOutboxRetryScheduler,normalizeCloudError} from '../shared/cloud-sync.js';
import {createRuntimeTaskOwner} from '../shared/runtime-task-owner.js';
import {createDebouncedTask} from '../shared/debounced-task.js';

// Main save admission, joined flight and retry/follow-up lifetime. ACK, RPC,
// conflict/rebase and authoritative publication remain separate owners.
export function createMainSaveOperation({session,tab,access,journal,write,confirmation,view}){
const {cloudEnabled,getCloudWriteScope,writeScopeCurrent,setWriteControl,isOnline}=access;
const {refreshStorageV2CloudState,materializeStorageV2CloudFlight,storageV2CommitPromise}=journal;
const {saveStorageV2CloudFlight}=write;
const {markCloudSynced,confirmCloudPollSynced}=confirmation;
const {setCloud,toast}=view;
const followup=createDebouncedTask({delay:0,onError:error=>console.error('orders cloud follow-up',error)});
const outboxRetryScheduler=createOutboxRetryScheduler();
let savingScope=null,cloudSavePromise=null,wakeEpoch=0;
const saveWork=createRuntimeTaskOwner();
function v2RetryRecord(state,flight=null){return {domain:'orders',documentName:'suppliers-v2',generation:Number(flight?.generation??state?.pendingGeneration??0),operationId:String(flight?.operationId||'orders-v2'),retry:state?.control?.retry||null}}

function requestStorageV2CloudSave(...args){
  return saveWork.run(()=>runStorageV2CloudSave(...args));
}
async function runStorageV2CloudSave(message='השינויים סונכרנו',{force=false}={}){
  const wakeGeneration=wakeEpoch;
  if(!tab.primaryTab)return false;if(message)session.cloudSaveMessage=message;session.cloudSaveRequested=true;if(!force&&!cloudEnabled())return false;
  const liveScope=getCloudWriteScope();
  let state=await refreshStorageV2CloudState();
  const scope=captureCloudWriteScope(liveScope,state);if(!writeScopeCurrent(scope,state))return false;
  if(!state?.base)return false;
  if(state.control?.conflict){session.cloudConflictBlocked=true;session.cloudSaveRequested=false;setCloud('ענן: התנגשות','error');return false}
  if(session.cloudConflictBlocked){setCloud('ענן: התנגשות','error');return false}
  if(!isOnline()){try{await storageV2CommitPromise()}catch(error){console.error('orders V2 journal offline commit',error)}if(!writeScopeCurrent(scope))return false;setCloud('ענן: אופליין','offline');return false}
  if(cloudSavePromise&&cloudWriteScopeHasIdentity(scope,savingScope))return cloudSavePromise;
  savingScope=scope;
  const saving=(async()=>{let allOk=true;while(writeScopeCurrent(scope)&&session.cloudSaveRequested&&(force||cloudEnabled())&&isOnline()&&!session.cloudConflictBlocked){
    session.cloudSaveRequested=false;const msg=session.cloudSaveMessage||'השינויים סונכרנו';session.cloudSaveMessage='';state=await refreshStorageV2CloudState();
    if(!writeScopeCurrent(scope,state))return false;
    if(!state?.base){allOk=false;break}
    if(state.control?.conflict){session.cloudConflictBlocked=true;session.cloudSaveRequested=false;setCloud('ענן: התנגשות','error');return false}
    const currentFlight=state.flight||null,retryRecord=v2RetryRecord(state,currentFlight),retryDelay=outboxRetryScheduler.schedule(retryRecord,()=>writeScopeCurrent(scope)?requestStorageV2CloudSave(msg,{force}):false);
    if(retryDelay>0){setCloud('ענן: ממתין למועד הסנכרון');allOk=false;break}
    const generation=Number(session.localGeneration||0),flight=currentFlight||await materializeStorageV2CloudFlight();
    if(!writeScopeCurrent(scope)||flight&&!cloudWriteScopeIsCurrent(scope,getCloudWriteScope(),{base:flight}))return false;
    if(!flight){if(await confirmCloudPollSynced({generation},{scope})){if(msg)toast(msg)}else allOk=false;continue}
    session.cloudBusy=true;setCloud('ענן: מסנכרן…');
    try{
      const saved=await saveStorageV2CloudFlight(flight,scope);if(!saved||!writeScopeCurrent(scope,saved.state)){allOk=false;break}
      outboxRetryScheduler.cancel();state=saved.state||state;if(state?.pending||state?.flight)session.cloudSaveRequested=true;
      if(markCloudSynced(state,{generation:saved.generation})){if(msg)toast(msg)}else if(state?.pending||state?.flight||session.cloudSaveRequested)setCloud('ענן: מסנכרן…');else allOk=false
    }catch(error){
      console.error('cloud save V2',error);
      if(!writeScopeCurrent(scope)||(!force&&!cloudEnabled()))return false;
      state=await refreshStorageV2CloudState();
      if(!tab.primaryTab||(!force&&!cloudEnabled())||!writeScopeCurrent(scope,state))return false;
      const normalized=normalizeCloudError(error),attempts=Number(state?.control?.retry?.attempts||0)+1,nextAttemptAt=normalized.retryAfterMs?new Date(Date.now()+normalized.retryAfterMs).toISOString():null,retry={attempts,lastErrorCode:normalized.code||normalized.kind,lastAttemptAt:new Date().toISOString(),nextAttemptAt};
      await setWriteControl(scope,{retry});state=await refreshStorageV2CloudState();if(!writeScopeCurrent(scope,state))return false;
      if(!tab.primaryTab||(!force&&!cloudEnabled())||!writeScopeCurrent(scope,state))return false;
      outboxRetryScheduler.schedule(v2RetryRecord(state,state?.flight),()=>writeScopeCurrent(scope)?requestStorageV2CloudSave(msg,{force}):false);setCloud(isOnline()?'ענן: ממתין לסנכרון':'ענן: אופליין',isOnline()?'':'offline');allOk=false;break
    }finally{if(cloudWriteScopeHasIdentity(scope,getCloudWriteScope()))session.cloudBusy=false}
  }return writeScopeCurrent(scope,state)&&allOk&&!state?.pending&&!state?.flight})().finally(()=>{if(cloudSavePromise===saving){cloudSavePromise=null;savingScope=null}if(wakeGeneration===wakeEpoch&&writeScopeCurrent(scope)&&session.cloudSaveRequested&&isOnline()&&!session.cloudConflictBlocked)followup.schedule(()=>wakeGeneration===wakeEpoch&&writeScopeCurrent(scope)&&requestStorageV2CloudSave(session.cloudSaveMessage||'השינויים סונכרנו',{force}))});
  cloudSavePromise=saving;return saving
}

return {
    request:requestStorageV2CloudSave,
    runtime:{isPending:saveWork.isPending,drain:saveWork.drain},
    isSaving:()=>!!cloudSavePromise,
    cancelRetry:()=>outboxRetryScheduler.cancel(),
    stop(){wakeEpoch++;followup.cancel()},
    joinFlight:()=>cloudSavePromise,
    drainFollowup:()=>followup.drain(),
};
}
