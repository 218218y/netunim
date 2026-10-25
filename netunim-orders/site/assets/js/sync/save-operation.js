import {captureCloudWriteScope,cloudWriteScopeIsCurrent,cloudWriteScopeHasIdentity} from '../shared/cloud-write-scope.js';
import {createOutboxRetryScheduler,createCloudRetryControl} from '../shared/cloud-sync.js';
import {createRuntimeTaskOwner} from '../shared/runtime-task-owner.js';
import {createDebouncedTask} from '../shared/debounced-task.js';
import {hasFailedLocalMutation} from '../shared/local-mutation-admission.js';

// Main save admission, joined flight and retry/follow-up lifetime. ACK, RPC,
// conflict/rebase and authoritative publication remain separate owners.
/** @param {import('../shared/sync-document-contracts.js').OrdersSaveOperationPorts} ports */
export function createMainSaveOperation({session,tab,access,journal,write,confirmation,view}){
const {cloudEnabled,getCloudWriteScope,writeScopeCurrent,setWriteControl,isOnline}=access;
const {refreshStorageV2CloudState,materializeStorageV2CloudFlight,storageV2CommitPromise}=journal;
const {saveStorageV2CloudFlight}=write;
const {markCloudSynced,confirmCloudPollSynced}=confirmation;
const {setCloud,toast}=view;
const followup=createDebouncedTask({delay:0,onError:error=>console.error('orders cloud follow-up',error)});
const recoveryWake=createDebouncedTask({delay:250,onError:error=>console.error('orders ACK recovery wake',error)});
/** @type {((awake:boolean)=>void)|null} */
let recoveryWait=null;
const outboxRetryScheduler=createOutboxRetryScheduler();
/** @type {import('../shared/sync-document-contracts.js').Scope} */
let savingScope=null;
/** @type {Promise<boolean>|null} */
let cloudSavePromise=null;let wakeEpoch=0;
const saveWork=createRuntimeTaskOwner();
// Remain inside the joined save lifetime. Cancellation settles the waiter so
// account cutover/drain cannot strand a sleeping save or wake a replacement.
/** @param {import('../shared/sync-document-contracts.js').Scope} scope */
async function waitForPostAckQuiet(scope){
  const epoch=wakeEpoch,current=()=>epoch===wakeEpoch&&writeScopeCurrent(scope);
  for(let sample=0;sample<24&&current();sample++){
    const generation=Number(session.localGeneration||0);
    const awake=await new Promise(resolve=>{
      recoveryWait?.(false);
      recoveryWait=resolve;
      if(!recoveryWake.schedule(()=>{recoveryWait=null;resolve(true)})){recoveryWait=null;resolve(false)}
    });
    if(!awake||!current())return false;
    if(Number(session.localGeneration||0)===generation)return true;
  }
  return false;
}
/** @param {import('../shared/sync-document-contracts.js').Head} state @param {import('../shared/storage-cloud-records.js').StoredCloudFlight|null} [flight] */
function v2RetryRecord(state,flight=null){return {domain:'orders',documentName:'suppliers-v2',generation:Number(flight?.generation??state?.pendingGeneration??0),operationId:String(flight?.operationId||'orders-v2'),retry:state?.control?.retry||null}}

/** @param {Parameters<import('../shared/sync-document-contracts.js').SaveRequest>} args @returns {Promise<boolean>} */
function requestStorageV2CloudSave(...args){
  return saveWork.run(()=>runStorageV2CloudSave(...args));
}
/** @type {import('../shared/sync-document-contracts.js').SaveRequest} */
async function runStorageV2CloudSave(message='השינויים סונכרנו',{force=false}={}){
  if(hasFailedLocalMutation(session)){setCloud('ענן: שינוי לא נשמר מקומית','error');return false}
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
  const saving=(async()=>{let allOk=true;while(writeScopeCurrent(scope)&&session.cloudSaveRequested&&(force||cloudEnabled())&&isOnline()&&!session.cloudConflictBlocked&&!hasFailedLocalMutation(session)){
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
      const retry=createCloudRetryControl(error,state?.control?.retry);
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
    waitForPostAckQuiet,
    stop(){wakeEpoch++;followup.cancel();recoveryWake.cancel();recoveryWait?.(false);recoveryWait=null},
    joinFlight:()=>cloudSavePromise,
    drainFollowup:()=>followup.drain(),
};
}
