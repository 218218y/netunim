import {observeOptionalTask} from '../shared/runtime-task-owner.js';
import {readDocumentWriteAck} from '../shared/document-write-ack.js';
import {structuredSyncConflict} from '../shared/cloud-sync.js';
import {clone} from '../core/values.js';
import {commitCloudCheckpoint} from '../shared/cloud-checkpoint-publication.js';
import {cloudAckPublicationDiagnostic} from '../shared/cloud-ack-diagnostic.js';

// Owns durable ACK publication and post-ACK recovery.
export function createCloudAckPublication({model,session,tab,files,access,journal,projection,view,mirror,recovery}){
  const {writeScopeCurrent}=access;
  const {refreshStorageV2CloudState=async()=>null,acknowledgeStorageV2CloudFlight=async()=>null,setWriteControl}=journal;
  const {prepareCloudState,sameOrderCloudData,merge3,composeOrderCloudState=(cloud,current)=>({...clone(cloud),checks:clone(current.checks||[])}),applyOrderCloudState}=projection;
  const {setCloud,toast}=view;
  const {writeStateToFolder}=mirror;
  const {readStorageV2CloudRecovery=null,commitStorageV2CloudRecovery=null,waitForPostAckQuiet=null}=recovery;

async function publishAcknowledgedFlight({res,flight,serverSnapshot,scope}){
  let state;
  const {state:authoritative,revision:newRevision}=readDocumentWriteAck(res.row,{baseRevision:flight.baseRevision,sentState:serverSnapshot,prepareState:prepareCloudState,equalState:sameOrderCloudData,errorCode:'orders_v2_ack_revision_invalid',stateErrorCode:'orders_v2_ack_state_invalid'});
  // Reconcile edits that arrived while this immutable flight was in progress
  // before ACK.  ACK + current checkpoint are then committed in one IDB
  // transaction, so a crash cannot advance the cloud cursor without persisting
  // the corresponding rebased local head.
  state=await refreshStorageV2CloudState();
  if(!writeScopeCurrent(scope,state))return false;
  if(!state?.flight||state.flight.operationId!==flight.operationId)throw new Error('orders_v2_flight_changed_before_ack');
  const expectedSeq=state.seq;
  let currentCloud=authoritative;
  if(state.afterFlightPending){
    const local=prepareCloudState(model.state),rebased=merge3(serverSnapshot,local,authoritative,{deleteIntents:state.afterFlightDeleteIntents||{}});
    if(rebased.conflicts.length){
      const conflict=structuredSyncConflict({domain:'orders',conflicts:rebased.conflicts,base:serverSnapshot,local,remote:authoritative,generation:state.afterFlightGeneration,baseRevision:flight.baseRevision,currentRemoteRevision:newRevision});
      const conflictCommit=await acknowledgeStorageV2CloudFlight(flight.operationId,newRevision,authoritative,{currentState:model.state,expectedSeq,control:{conflict}});if(!writeScopeCurrent(scope,conflictCommit?.cloudState||conflictCommit))return false;
      session.cloudRevision=newRevision;session.cloudUpdatedAt=res.row?.updated_at||session.cloudUpdatedAt;session.lastCloudState=clone(authoritative);session.cloudConflictBlocked=true;session.cloudSaveRequested=false;
      setCloud('ענן: התנגשות','error');return false
    }
    currentCloud=rebased.state;
  }
  let expectedGeneration=Number(session.localGeneration||0);
  const previousState=clone(model.state),currentState=composeOrderCloudState(currentCloud,model.state);
  const recoveryTrace=[];
  let publication=await commitCloudCheckpoint({
    commit:()=>acknowledgeStorageV2CloudFlight(flight.operationId,newRevision,authoritative,{currentState,expectedSeq}),
    isCurrent:committed=>writeScopeCurrent(scope,committed)&&Number(session.localGeneration||0)===expectedGeneration&&committed?.seq===expectedSeq,
    publish:()=>{if(!sameOrderCloudData(model.state,currentCloud))applyOrderCloudState(currentCloud)},
  });
  if(!publication.published)recoveryTrace.push({reason:publication.reason==='publication-error'?'publication_exception':Number(session.localGeneration||0)!==expectedGeneration?'publication_stale_generation':publication.committed?.seq!==expectedSeq?'publication_stale_seq':'scope_lost',attempt:0});
  if(!publication.published&&publication.reason==='stale'&&writeScopeCurrent(scope,publication.committed)&&readStorageV2CloudRecovery&&commitStorageV2CloudRecovery){
    try{
      const {recoverPostAckPublication}=await import('../shared/cloud-post-ack-recovery.js');
      const recovered=await recoverPostAckPublication({isCurrent:head=>writeScopeCurrent(scope,head),generation:()=>Number(session.localGeneration||0),visible:()=>model.state,
        equal:sameOrderCloudData,merge:(before,local,candidate,deleteIntents)=>merge3(prepareCloudState(before),prepareCloudState(local),prepareCloudState(candidate),{deleteIntents}),
        read:readStorageV2CloudRecovery,commit:commitStorageV2CloudRecovery,publish:state=>{applyOrderCloudState(state)},
        diagnose:record=>{recoveryTrace.push(record)},waitForQuiet:waitForPostAckQuiet?()=>waitForPostAckQuiet(scope):null},
        {previousState,candidateState:currentState,candidateSeq:expectedSeq,baseState:authoritative,ackRevision:newRevision,ackSeq:flight.endSeq});
      if(recovered){publication={committed:recovered.state,published:true};expectedGeneration=recovered.generation}
    }catch(error){console.error('post-ACK recovery retained for review',error)}
  }
  const committedState=publication.committed;
  if(!writeScopeCurrent(scope,committedState)){console.warn('Main cloud ACK',cloudAckPublicationDiagnostic('SCOPE_CHANGED_AFTER_COMMIT',{baseRevision:flight.baseRevision,ackRevision:newRevision,endSeq:flight.endSeq,candidateSeq:expectedSeq,observedSeq:committedState?.seq}));return false}
  session.cloudRevision=newRevision;session.cloudUpdatedAt=res.row?.updated_at||session.cloudUpdatedAt;session.lastCloudState=clone(authoritative);session.cloudConflictBlocked=false;
  if(!publication.published){
    console.warn('Main cloud ACK',cloudAckPublicationDiagnostic(publication.reason==='publication-error'?'ACK_PUBLICATION_EXCEPTION':'ACK_COMMITTED_PUBLICATION_STALE',{baseRevision:flight.baseRevision,ackRevision:newRevision,endSeq:flight.endSeq,candidateSeq:expectedSeq,observedSeq:committedState?.seq}));
    // The sent flight is durably acknowledged, but a newer visible/journal head
    // must not be overwritten or sent with an earlier reconciliation snapshot.
    session.cloudConflictBlocked=true;session.cloudSaveRequested=false;
    if(!tab.primaryTab)return false;
    if(publication.reason==='publication-error')console.error('post-ACK model publication',publication.error);
    await setWriteControl(scope,{conflict:{kind:publication.reason==='publication-error'?'ack-publication-failed':'concurrent-ack',domain:'orders',baseRevision:flight.baseRevision,currentRemoteRevision:newRevision,...(recoveryTrace.length?{recoveryTrace}: {})}});
    if(!writeScopeCurrent(scope))return false;
    setCloud('ענן: הסנכרון נעצר לשמירת שינוי מקביל','error');
    toast(publication.reason==='publication-error'?'אישור הענן נשמר, אבל עדכון הנתונים לתצוגה נכשל. הסנכרון נעצר לבדיקה; הנתונים נשמרו באחסון המקומי.':'שינוי בוצע בזמן שמירת אישור הענן. הנתונים נשמרו מקומית; ייצא גיבוי ובדוק את המצב לפני חידוש הסנכרון.');
    return false;
  }
  if(files.dirHandle)observeOptionalTask(()=>writeStateToFolder());
  if(!writeScopeCurrent(scope,committedState))return false;
  return {committed:true,state:committedState,generation:expectedGeneration}
}

return {publishAcknowledgedFlight};
}
