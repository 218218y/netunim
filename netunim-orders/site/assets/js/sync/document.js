import {createMainSaveOperation} from './save-operation.js';
import {createRemoteAdoption} from './remote-adoption.js';
import {createCloudWriteAuthority} from '../shared/cloud-write-authority.js';
import {createCloudWriteFlight} from './write-flight.js';
import {createCloudAckPublication} from './ack-publication.js';
import {createCloudConfirmation} from './confirmation.js';
import {createCloudPolling} from './polling.js';

import {captureCloudWriteScope,cloudWriteScopeHasIdentity} from '../shared/cloud-write-scope.js';

import {clone} from '../core/values.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
/** @param {import('../shared/sync-document-contracts.js').OrdersDocumentPorts} ports */
export function createSyncDocument({model,session,tab,access,journal,checkpoint,recovery,projection,transport,view,mirror,secondary}){
const {getCloudWriteScope,storageV2PreparationActive,cloudEnabled,cloudHasLocalWork,isOnline}=access;
const {refreshStorageV2CloudState,materializeStorageV2CloudFlight,acknowledgeStorageV2CloudFlight,rejectStorageV2CloudFlight,setStorageV2CloudControl,storageV2CommitPromise}=journal;
const {adoptStorageV2CloudHead}=checkpoint;
const {readStorageV2CloudRecovery,commitStorageV2CloudRecovery,cancelCloudRecovery}=recovery;
const {prepareCloudState,sameOrderCloudData,merge3,composeOrderCloudState,applyOrderCloudState}=projection;
const {readCloud,readCloudMeta,rpcSaveV2}=transport;
const {setCloud,toast,render,refreshCloudTimestamp}=view;
const {files,writeStateToFolder}=mirror;
const {pollSharedChecks,refreshKupaReadout}=secondary;

/** @type {import('../shared/sync-document-contracts.js').ConcurrentReview|null} */
let concurrentAckReview=null;
const {isCurrent:writeScopeCurrent,setControl:setWriteControl}=createCloudWriteAuthority({
  scope:{read:getCloudWriteScope},
  leadership:{primary:()=>tab.primaryTab,preparing:storageV2PreparationActive},
  control:{write:setStorageV2CloudControl},
});

/** @type {Promise<boolean>|null} */
let morningRefreshPromise=null;



const {adoptRemoteRow}=createRemoteAdoption({model,session,tab,
  access:{cloudEnabled},journal:{adoptStorageV2CloudHead,setStorageV2CloudControl},
  projection:{composeOrderCloudState,applyOrderCloudState,prepareCloudState},view:{setCloud},
});
/** @param {Parameters<import('../shared/sync-document-contracts.js').SaveRequest>} args @returns {Promise<boolean>} */
function requestStorageV2CloudSave(...args){return saveOperation.request(...args)}

function refreshForMorningRecovery(){
  if(morningRefreshPromise)return morningRefreshPromise;
  const requestedScope=getCloudWriteScope();
  morningRefreshPromise=(async()=>{
    const available=()=>writeScopeCurrent(requestedScope)&&tab.primaryTab&&cloudEnabled()&&isOnline()&&!session.cloudConflictBlocked&&!session.syncCapabilitiesError;
    if(!available())return false;
    // Await actual completion, including a poll already reading the remote head.
    await polling.runtime.drain();
    if(saveOperation.isSaving())await saveOperation.joinFlight();
    if(!available())return false;
    if(cloudHasLocalWork()){
      if(!await requestCloudSave('סנכרון החוב לפני התאוששות Morning'))return false;
    }
    if(!available()||session.cloudBusy)return false;
    session.cloudBusy=true;
    try{
      const head=await refreshStorageV2CloudState();
      const scope=captureCloudWriteScope(requestedScope,head),current=()=>available()&&writeScopeCurrent(scope,head);
      if(!current())return false;
      const generation=Number(session.localGeneration||0),local=prepareCloudState(model.state),row=await readCloud();
      if(!available()||!row?.state||!Number.isSafeInteger(Number(row.revision))||Number(row.revision)<Number(session.cloudRevision||0))return false;
      // A local edit/save during the GET invalidates this refresh; never apply a stale head.
      if(Number(session.localGeneration||0)!==generation||saveOperation.isSaving()||cloudHasLocalWork()||!sameOrderCloudData(model.state,local))return false;
      if(!await adoptRemoteRow(row,generation,head,{isCurrent:current})||!current())return false;
      render();refreshCloudTimestamp();return true;
    }finally{if(cloudWriteScopeHasIdentity(requestedScope,getCloudWriteScope()))session.cloudBusy=false}
  })().catch(error=>{console.error('Morning recovery cloud refresh',error);return false}).finally(()=>{morningRefreshPromise=null});
  return morningRefreshPromise;
}

const requestCloudSave=requestStorageV2CloudSave;

// Review only the committed-ACK fence, never business conflicts or retries.
// The remote must still equal the retained authoritative base. An advanced
// remote head requires ordinary three-way conflict review, not an overwrite.
async function prepareConcurrentAckRecovery(){
  concurrentAckReview=null;
  if(session.cloudBusy||saveOperation.isSaving()||!readStorageV2CloudRecovery||!commitStorageV2CloudRecovery)throw new Error('orders_recovery_unavailable');
  const generation=Number(session.localGeneration||0),visible=clone(model.state),live=getCloudWriteScope();
  let evidence=await readStorageV2CloudRecovery();
  const scope=captureCloudWriteScope(live,evidence.head),head=evidence.head;
  if(!writeScopeCurrent(scope,head)||Number(session.localGeneration||0)!==generation)throw new Error('orders_recovery_scope_changed');
  if(!head.base||head.flight||head.control?.retry||head.control?.conflict?.kind!=='concurrent-ack'||head.control.conflict.currentRemoteRevision!==head.base.revision)throw new Error('orders_recovery_not_concurrent_ack');
  if(!sameOrderCloudData(evidence.state,visible))throw new Error('orders_recovery_unsaved_view');
  const expected=evidence.expectedHead;
  evidence=await readStorageV2CloudRecovery({afterSeq:head.base.ackSeq,previousState:composeOrderCloudState(head.base.state,evidence.state)});
  if((/** @type {(keyof typeof expected)[]} */(Object.keys(expected))).some(key=>expected[key]!==evidence.expectedHead[key]))throw new Error('storage_cloud_recovery_stale');
  if(!sameOrderCloudData(evidence.replayedPrevious,evidence.state))throw new Error('orders_recovery_journal_mismatch');
  const remote=await readCloud();
  if(!writeScopeCurrent(scope,head)||Number(session.localGeneration||0)!==generation||!sameOrderCloudData(model.state,visible))throw new Error('orders_recovery_view_changed');
  if(!remote?.state||Number(remote.revision)!==head.base.revision||!sameOrderCloudData(remote.state,head.base.state))throw new Error('orders_recovery_remote_changed');
  const review={scope,generation,visible,evidence,remote};concurrentAckReview=review;
  return {revision:head.base.revision,ackSeq:head.base.ackSeq,pendingCount:head.seq-head.base.ackSeq,
    backup:{kind:'orders-concurrent-ack-review',version:1,capturedAt:new Date().toISOString(),localState:visible,remote:clone(remote),storage:clone(evidence.backup)},
    resume:()=>resumeConcurrentAckRecovery(review)};
}
/** @param {import('../shared/sync-document-contracts.js').ConcurrentReview} review */
async function resumeConcurrentAckRecovery(review){
  if(!review||review!==concurrentAckReview)throw new Error('orders_recovery_review_required');
  concurrentAckReview=null;
  const {scope,generation,visible,evidence,remote}=review;
  const current=()=>writeScopeCurrent(scope)&&!session.cloudBusy&&!saveOperation.isSaving()&&Number(session.localGeneration||0)===generation&&sameOrderCloudData(model.state,visible);
  if(!current())throw new Error('orders_recovery_view_changed');
  const freshRemote=await readCloud();
  if(!current())throw new Error('orders_recovery_scope_changed');
  if(Number(freshRemote?.revision)!==Number(remote.revision)||!freshRemote?.state||!sameOrderCloudData(freshRemote.state,remote.state))throw new Error('orders_recovery_remote_changed');
  const committed=await commitStorageV2CloudRecovery(evidence.state,{expectedHead:evidence.expectedHead,conflictKind:'concurrent-ack',isCurrent:current});
  if(!committed.base||!writeScopeCurrent(scope,committed))return false;
  // No model replacement: it was proven identical to the durable recovered
  // state. A later edit remains live and will use the ordinary pending flight.
  session.cloudConflictBlocked=false;session.cloudRevision=committed.base.revision;session.cloudUpdatedAt=freshRemote.updated_at||session.cloudUpdatedAt;session.lastCloudState=clone(committed.base.state);
  setCloud('ענן: שינוי מקומי ממתין לסנכרון');
  const saved=await requestCloudSave('השינויים המקומיים אומתו וסונכרנו');
  if(!writeScopeCurrent(scope))return false;
  startPolling();return saved;
}

function startPolling(){return polling.start()}
function stopPolling(){saveOperation.stop();return polling.stop()}
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
  recovery:{readStorageV2CloudRecovery,commitStorageV2CloudRecovery,waitForPostAckQuiet:scope=>saveOperation.waitForPostAckQuiet(scope)},
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
  recovery:{readStorageV2CloudRecovery,commitStorageV2CloudRecovery},
});
const confirmation=createCloudConfirmation({
  model,
  session,
  tab,
  access:{isOnline,storageV2PreparationActive,cloudEnabled,cloudHasLocalWork,writeScopeCurrent},
  state:{sameOrderCloudData,refreshStorageV2CloudState},
  view:{setCloud,refreshCloudTimestamp},
});
const saveOperation=createMainSaveOperation({session,tab,
  access:{cloudEnabled,getCloudWriteScope,writeScopeCurrent,setWriteControl,isOnline},
  journal:{refreshStorageV2CloudState,materializeStorageV2CloudFlight,storageV2CommitPromise},
  write:{saveStorageV2CloudFlight},confirmation,view:{setCloud,toast},
});
const polling=createCloudPolling({
  model,
  session,
  tab,
  files,
  access:{isOnline,storageV2PreparationActive,cloudEnabled,cloudHasLocalWork},
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
  isPending:()=>saveOperation.runtime.isPending()||polling.runtime.isPending()||!!morningRefreshPromise,
  async drain(){
    do{
      await saveOperation.runtime.drain();await polling.runtime.drain();
      const pending=[morningRefreshPromise].filter(Boolean);
      if(pending.length)await Promise.allSettled(pending);
      await saveOperation.drainFollowup();
    }while(saveOperation.runtime.isPending()||polling.runtime.isPending()||morningRefreshPromise);
  },
};
async function quiesceForStorageCutover(){
  stopPolling();
  cancelCloudRecovery();
  saveOperation.cancelRetry();
  await runtime.drain();
  saveOperation.cancelRetry();return true;
}

return { requestCloudSave, requestStorageV2CloudSave, prepareConcurrentAckRecovery, cloudPoll:trackedCloudPoll, resumeAfterReconnect, startPolling,stopPolling,quiesceForStorageCutover,refreshForMorningRecovery,runtime };
}
