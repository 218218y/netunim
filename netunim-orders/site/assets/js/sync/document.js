import {createCloudWriteFlight} from './write-flight.js';
import {createCloudAckPublication} from './ack-publication.js';
import {createCloudConfirmation} from './confirmation.js';
import {createCloudPolling} from './polling.js';
import {createDebouncedTask} from '../shared/debounced-task.js';
import {createRuntimeTaskOwner} from '../shared/runtime-task-owner.js';

import {captureCloudWriteScope,cloudWriteScopeIsCurrent,cloudWriteScopeHasIdentity} from '../shared/cloud-write-scope.js';

import {clone} from '../core/values.js';
import {commitCloudCheckpoint} from '../shared/cloud-checkpoint-publication.js';
import {createOutboxRetryScheduler,normalizeCloudError} from '../shared/cloud-sync.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createSyncDocument({readStorageV2CloudRecovery=null,commitStorageV2CloudRecovery=null,getCloudWriteScope=()=>null,cancelCloudRecovery=()=>{},model,files,session,tab,toast,setCloud,prepareCloudState,writeStateToFolder,readCloud,rpcSaveV2,merge3,applyOrderCloudState,composeOrderCloudState=(cloud,current)=>({...clone(cloud),checks:clone(current.checks||[])}),cloudEnabled,sameOrderCloudData,cloudHasLocalWork,render,readCloudMeta,refreshKupaReadout,pollSharedChecks,refreshCloudTimestamp,refreshStorageV2CloudState=async()=>null,materializeStorageV2CloudFlight=async()=>null,acknowledgeStorageV2CloudFlight=async()=>null,rejectStorageV2CloudFlight=async()=>null,setStorageV2CloudControl=async()=>null,adoptStorageV2CloudHead=async()=>null,storageV2CommitPromise=()=>Promise.resolve(),storageV2PreparationActive=()=>false}){
const outboxRetryScheduler=createOutboxRetryScheduler();
let savingScope=null,cloudSavePromise=null,wakeEpoch=0;
const saveWork=createRuntimeTaskOwner();
let concurrentAckReview=null;
const writeScopeCurrent=(scope,head=null)=>tab.primaryTab&&!storageV2PreparationActive()&&cloudWriteScopeIsCurrent(scope,getCloudWriteScope(),head);
async function setWriteControl(scope,control){
  try{return await setStorageV2CloudControl(control,{expectedScope:scope,isCurrent:()=>writeScopeCurrent(scope)})}
  catch(error){if(!writeScopeCurrent(scope))return false;throw error}
}
let morningRefreshPromise=null;

const followup=createDebouncedTask({delay:0,onError:error=>console.error('orders cloud follow-up',error)});

async function adoptRemoteRow(row,generation,head,{applyState=true}={}){
  if(!head?.base)throw new Error('orders_v2_account_head_required');
  const revision=Number(row.revision),next=composeOrderCloudState(row.state,model.state);
  const publication=await commitCloudCheckpoint({
    commit:()=>adoptStorageV2CloudHead(revision,next,{expectedHead:{seq:head.seq,baseRevision:head.base.revision}}),
    isCurrent:committed=>committed?.seq===head.seq&&committed?.revision===revision&&!committed.pending&&!committed.control&&tab.primaryTab&&cloudEnabled()&&Number(session.localGeneration||0)===generation,
    publish:()=>{if(applyState)applyOrderCloudState(row.state);session.cloudRevision=revision;session.cloudUpdatedAt=row.updated_at||session.cloudUpdatedAt;session.lastCloudState=prepareCloudState(model.state)},
  });
  if(!publication.published&&tab.primaryTab&&cloudEnabled()){
    session.cloudConflictBlocked=true;session.cloudSaveRequested=false;
    if(!publication.committed?.control?.conflict)await setStorageV2CloudControl({conflict:{kind:publication.reason==='publication-error'?'cloud-publication-failed':'concurrent-hydration',domain:'orders',baseRevision:head.base.revision,currentRemoteRevision:revision}});
    setCloud('ענן: נדרשת בדיקת סנכרון','error');
  }
  if(publication.reason==='publication-error')throw publication.error;
  return publication.published;
}

function refreshForMorningRecovery(){
  if(morningRefreshPromise)return morningRefreshPromise;
  morningRefreshPromise=(async()=>{
    const available=()=>tab.primaryTab&&cloudEnabled()&&navigator.onLine&&!session.cloudConflictBlocked&&!session.syncCapabilitiesError;
    if(!available())return false;
    // Await actual completion, including a poll already reading the remote head.
    await polling.runtime.drain();
    if(cloudSavePromise)await cloudSavePromise;
    if(!available())return false;
    if(cloudHasLocalWork()){
      if(!await requestCloudSave('סנכרון החוב לפני התאוששות Morning'))return false;
    }
    if(!available()||session.cloudBusy)return false;
    session.cloudBusy=true;
    try{
      const head=await refreshStorageV2CloudState(),generation=Number(session.localGeneration||0),local=prepareCloudState(model.state),row=await readCloud();
      if(!available()||!row?.state||!Number.isSafeInteger(Number(row.revision))||Number(row.revision)<Number(session.cloudRevision||0))return false;
      // A local edit/save during the GET invalidates this refresh; never apply a stale head.
      if(Number(session.localGeneration||0)!==generation||cloudSavePromise||cloudHasLocalWork()||!sameOrderCloudData(model.state,local))return false;
      if(!await adoptRemoteRow(row,generation,head))return false;
      render();refreshCloudTimestamp();return true;
    }finally{session.cloudBusy=false}
  })().catch(error=>{console.error('Morning recovery cloud refresh',error);return false}).finally(()=>{morningRefreshPromise=null});
  return morningRefreshPromise;
}
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
  if(!navigator.onLine){try{await storageV2CommitPromise()}catch(error){console.error('orders V2 journal offline commit',error)}if(!writeScopeCurrent(scope))return false;setCloud('ענן: אופליין','offline');return false}
  if(cloudSavePromise&&cloudWriteScopeHasIdentity(scope,savingScope))return cloudSavePromise;
  savingScope=scope;
  const saving=(async()=>{let allOk=true;while(writeScopeCurrent(scope)&&session.cloudSaveRequested&&(force||cloudEnabled())&&navigator.onLine&&!session.cloudConflictBlocked){
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
      outboxRetryScheduler.schedule(v2RetryRecord(state,state?.flight),()=>writeScopeCurrent(scope)?requestStorageV2CloudSave(msg,{force}):false);setCloud(navigator.onLine?'ענן: ממתין לסנכרון':'ענן: אופליין',navigator.onLine?'':'offline');allOk=false;break
    }finally{if(cloudWriteScopeHasIdentity(scope,getCloudWriteScope()))session.cloudBusy=false}
  }return writeScopeCurrent(scope,state)&&allOk&&!state?.pending&&!state?.flight})().finally(()=>{if(cloudSavePromise===saving){cloudSavePromise=null;savingScope=null}if(wakeGeneration===wakeEpoch&&writeScopeCurrent(scope)&&session.cloudSaveRequested&&navigator.onLine&&!session.cloudConflictBlocked)followup.schedule(()=>wakeGeneration===wakeEpoch&&writeScopeCurrent(scope)&&requestStorageV2CloudSave(session.cloudSaveMessage||'השינויים סונכרנו',{force}))});
  cloudSavePromise=saving;return saving
}

const requestCloudSave=requestStorageV2CloudSave;

// Review only the committed-ACK fence, never business conflicts or retries.
// The remote must still equal the retained authoritative base. An advanced
// remote head requires ordinary three-way conflict review, not an overwrite.
async function prepareConcurrentAckRecovery(){
  concurrentAckReview=null;
  if(session.cloudBusy||cloudSavePromise||!readStorageV2CloudRecovery||!commitStorageV2CloudRecovery)throw new Error('orders_recovery_unavailable');
  const generation=Number(session.localGeneration||0),visible=clone(model.state),live=getCloudWriteScope();
  let evidence=await readStorageV2CloudRecovery();
  const scope=captureCloudWriteScope(live,evidence.head),head=evidence.head;
  if(!writeScopeCurrent(scope,head)||Number(session.localGeneration||0)!==generation)throw new Error('orders_recovery_scope_changed');
  if(head.flight||head.control?.retry||head.control?.conflict?.kind!=='concurrent-ack'||head.control.conflict.currentRemoteRevision!==head.base.revision)throw new Error('orders_recovery_not_concurrent_ack');
  if(!sameOrderCloudData(evidence.state,visible))throw new Error('orders_recovery_unsaved_view');
  const expected=evidence.expectedHead;
  evidence=await readStorageV2CloudRecovery({afterSeq:head.base.ackSeq,previousState:composeOrderCloudState(head.base.state,evidence.state)});
  if(Object.keys(expected).some(key=>expected[key]!==evidence.expectedHead[key]))throw new Error('storage_cloud_recovery_stale');
  if(!sameOrderCloudData(evidence.replayedPrevious,evidence.state))throw new Error('orders_recovery_journal_mismatch');
  const remote=await readCloud();
  if(!writeScopeCurrent(scope,head)||Number(session.localGeneration||0)!==generation||!sameOrderCloudData(model.state,visible))throw new Error('orders_recovery_view_changed');
  if(!remote?.state||Number(remote.revision)!==head.base.revision||!sameOrderCloudData(remote.state,head.base.state))throw new Error('orders_recovery_remote_changed');
  const review={scope,generation,visible,evidence,remote};concurrentAckReview=review;
  return {revision:head.base.revision,ackSeq:head.base.ackSeq,pendingCount:head.seq-head.base.ackSeq,
    backup:{kind:'orders-concurrent-ack-review',version:1,capturedAt:new Date().toISOString(),localState:visible,remote:clone(remote),storage:clone(evidence.backup)},
    resume:()=>resumeConcurrentAckRecovery(review)};
}
async function resumeConcurrentAckRecovery(review){
  if(!review||review!==concurrentAckReview)throw new Error('orders_recovery_review_required');
  concurrentAckReview=null;
  const {scope,generation,visible,evidence,remote}=review;
  const current=()=>writeScopeCurrent(scope)&&!session.cloudBusy&&!cloudSavePromise&&Number(session.localGeneration||0)===generation&&sameOrderCloudData(model.state,visible);
  if(!current())throw new Error('orders_recovery_view_changed');
  const freshRemote=await readCloud();
  if(!current())throw new Error('orders_recovery_scope_changed');
  if(Number(freshRemote?.revision)!==Number(remote.revision)||!freshRemote?.state||!sameOrderCloudData(freshRemote.state,remote.state))throw new Error('orders_recovery_remote_changed');
  const committed=await commitStorageV2CloudRecovery(evidence.state,{expectedHead:evidence.expectedHead,conflictKind:'concurrent-ack',isCurrent:current});
  if(!writeScopeCurrent(scope,committed))return false;
  // No model replacement: it was proven identical to the durable recovered
  // state. A later edit remains live and will use the ordinary pending flight.
  session.cloudConflictBlocked=false;session.cloudRevision=committed.base.revision;session.cloudUpdatedAt=freshRemote.updated_at||session.cloudUpdatedAt;session.lastCloudState=clone(committed.base.state);
  setCloud('ענן: שינוי מקומי ממתין לסנכרון');
  const saved=await requestCloudSave('השינויים המקומיים אומתו וסונכרנו');
  if(!writeScopeCurrent(scope))return false;
  startPolling();return saved;
}

function startPolling(){return polling.start()}
function stopPolling(){wakeEpoch++;followup.cancel();return polling.stop()}
const {publishAcknowledgedFlight}=createCloudAckPublication({
  model,
  session,
  tab,
  files,
  access:{writeScopeCurrent},
  journal:{refreshStorageV2CloudState,acknowledgeStorageV2CloudFlight,setWriteControl},
  projection:{prepareCloudState,sameOrderCloudData,merge3,composeOrderCloudState,applyOrderCloudState},
  view:{setCloud,toast},
  mirror:{writeStateToFolder},
  recovery:{readStorageV2CloudRecovery,commitStorageV2CloudRecovery},
});
const {saveStorageV2CloudFlight}=createCloudWriteFlight({
  model,
  session,
  access:{writeScopeCurrent,getCloudWriteScope},
  journal:{refreshStorageV2CloudState,materializeStorageV2CloudFlight,rejectStorageV2CloudFlight,setWriteControl},
  projection:{prepareCloudState,merge3,composeOrderCloudState,applyOrderCloudState},
  transport:{rpcSaveV2,readCloud},
  view:{setCloud,toast},
  publication:{publishAcknowledgedFlight},
});
const confirmation=createCloudConfirmation({
  model,
  session,
  tab,
  access:{storageV2PreparationActive,cloudEnabled,cloudHasLocalWork,writeScopeCurrent},
  state:{sameOrderCloudData,refreshStorageV2CloudState},
  view:{setCloud,refreshCloudTimestamp},
});
const {markCloudSynced,confirmCloudPollSynced}=confirmation;
const polling=createCloudPolling({
  model,
  session,
  tab,
  files,
  access:{storageV2PreparationActive,cloudEnabled,cloudHasLocalWork},
  state:{prepareCloudState,sameOrderCloudData,refreshStorageV2CloudState},
  view:{setCloud,render,toast},
  remote:{readCloudMeta,readCloud},
  adoption:{adoptRemoteRow,writeStateToFolder},
  secondary:{pollSharedChecks,refreshKupaReadout},
  write:{requestCloudSave},
  confirmation,
});
const trackedCloudPoll=polling.poll,resumeAfterReconnect=polling.resumeAfterReconnect;
const runtime={
  isPending:()=>saveWork.isPending()||polling.runtime.isPending()||!!morningRefreshPromise,
  async drain(){
    do{
      await saveWork.drain();await polling.runtime.drain();
      const pending=[morningRefreshPromise].filter(Boolean);
      if(pending.length)await Promise.allSettled(pending);
      await followup.drain();
    }while(saveWork.isPending()||polling.runtime.isPending()||morningRefreshPromise);
  },
};
async function quiesceForStorageCutover(){
  stopPolling();
  cancelCloudRecovery();
  outboxRetryScheduler.cancel();
  await runtime.drain();
  outboxRetryScheduler.cancel();return true;
}

return { requestCloudSave, requestStorageV2CloudSave, prepareConcurrentAckRecovery, cloudPoll:trackedCloudPoll, resumeAfterReconnect, startPolling,stopPolling,quiesceForStorageCutover,refreshForMorningRecovery,runtime };
}
