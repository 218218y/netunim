import {readDocumentWriteAck} from '../shared/document-write-ack.js';
import {jsonEq} from './merge-records.js';
import {structuredSyncConflict} from '../shared/cloud-sync.js';
import {commitCloudCheckpoint} from '../shared/cloud-checkpoint-publication.js';
import {recoverPostAckPublication} from '../shared/cloud-post-ack-recovery.js';
import {cloudAckPublicationDiagnostic} from '../shared/cloud-ack-diagnostic.js';

// Owns durable ACK publication and post-ACK recovery.
export function createCloudAckPublication({model,session,tab,access,journal,projection,view,mirror,recovery}){
  const {writeScopeCurrent}=access;
  const {refreshStorageV2CloudState=async()=>null,acknowledgeStorageV2CloudFlight=async()=>null,setWriteControl}=journal;
  const {prepareKupaCloudState,mergeKupaCloudState3Way,applyKupaCoreState,applyAcknowledgedCoreState}=projection;
  const {setSaveStatus,setCloudHeaderStatus,reportError,render}=view;
  const {backupSnapshotToComputer}=mirror;
  const {readStorageV2CloudRecovery=null,commitStorageV2CloudRecovery=null}=recovery;

async function publishAcknowledgedFlight({res,flight,serverSnapshot,scope}){
  let state;
  const {state:authoritative,revision:newRevision}=readDocumentWriteAck(res.row,{baseRevision:flight.baseRevision,sentState:serverSnapshot,prepareState:prepareKupaCloudState,equalState:jsonEq,errorCode:'kupa_v2_ack_revision_invalid',stateErrorCode:'kupa_v2_ack_state_invalid'});
  state=await refreshStorageV2CloudState();if(!writeScopeCurrent(scope,state))return false;if(!state?.flight||state.flight.operationId!==flight.operationId)throw new Error('kupa_v2_flight_changed_before_ack');
  const expectedSeq=state.seq;
  let currentCore=authoritative;
  if(state.afterFlightPending){
    const local=prepareKupaCloudState(model.state),rebased=mergeKupaCloudState3Way(serverSnapshot,local,authoritative,{deleteIntents:state.afterFlightDeleteIntents||{}});
    if(rebased.conflicts.length){const conflict=structuredSyncConflict({domain:'kupa',conflicts:rebased.conflicts,base:serverSnapshot,local,remote:authoritative,generation:state.afterFlightGeneration,baseRevision:flight.baseRevision,currentRemoteRevision:newRevision});const conflictCommit=await acknowledgeStorageV2CloudFlight(flight.operationId,newRevision,authoritative,{currentState:model.state,expectedSeq,control:{conflict}});if(!writeScopeCurrent(scope,conflictCommit?.cloudState||conflictCommit))return false;session.dbRevision=newRevision;session.lastSavedSnapshot=JSON.stringify(authoritative);session.cloudConflictPending=true;setSaveStatus('התנגשות שמורה מקומית','error');setCloudHeaderStatus('conflict','ענן: התנגשות');return false}
    currentCore=rebased.state;
  }
  const reconcile=state.afterFlightPending||!jsonEq(prepareKupaCloudState(model.state),authoritative);
  const previousState=structuredClone(model.state),expectedGeneration=Number(session.localGeneration||0),currentState=reconcile?applyKupaCoreState(currentCore,model.state.checks,model.state):structuredClone(model.state);
  let businessChanged=false;
  let publication=await commitCloudCheckpoint({
    commit:()=>acknowledgeStorageV2CloudFlight(flight.operationId,newRevision,authoritative,{currentState,expectedSeq}),
    isCurrent:committed=>writeScopeCurrent(scope,committed)&&Number(session.localGeneration||0)===expectedGeneration&&committed?.seq===expectedSeq,
    publish:()=>{if(reconcile)businessChanged=applyAcknowledgedCoreState(currentCore)},
  });
  if(!publication.published&&publication.reason==='stale'&&writeScopeCurrent(scope,publication.committed)&&readStorageV2CloudRecovery&&commitStorageV2CloudRecovery){
    try{
      const recovered=await recoverPostAckPublication({isCurrent:head=>writeScopeCurrent(scope,head),generation:()=>Number(session.localGeneration||0),visible:()=>model.state,
        equal:(a,b)=>jsonEq(prepareKupaCloudState(a),prepareKupaCloudState(b)),merge:(before,local,candidate,deleteIntents)=>mergeKupaCloudState3Way(prepareKupaCloudState(before),prepareKupaCloudState(local),prepareKupaCloudState(candidate),{deleteIntents}),
        read:readStorageV2CloudRecovery,commit:(state,options)=>commitStorageV2CloudRecovery(applyKupaCoreState(state,model.state.checks,model.state),options),publish:state=>{businessChanged=applyAcknowledgedCoreState(state)}},
        {previousState,candidateState:currentState,candidateSeq:expectedSeq,baseState:authoritative,ackRevision:newRevision,ackSeq:flight.endSeq});
      if(recovered)publication={committed:recovered.state,published:true};
    }catch(error){console.error('post-ACK recovery retained for review',error)}
  }
  const committedState=publication.committed;
  if(!writeScopeCurrent(scope,committedState)){console.warn('Main cloud ACK',cloudAckPublicationDiagnostic('SCOPE_CHANGED_AFTER_COMMIT',{baseRevision:flight.baseRevision,ackRevision:newRevision,endSeq:flight.endSeq,candidateSeq:expectedSeq,observedSeq:committedState?.seq}));return false}
  session.dbRevision=newRevision;session.lastSavedSnapshot=JSON.stringify(authoritative);session.serverInfo.lastSavedAt=res.row?.updated_at||res.row?.coreUpdatedAt||session.serverInfo.lastSavedAt||null;session.cloudConflictPending=false;
  if(!publication.published){
    console.warn('Main cloud ACK',cloudAckPublicationDiagnostic(publication.reason==='publication-error'?'ACK_PUBLICATION_EXCEPTION':'ACK_COMMITTED_PUBLICATION_STALE',{baseRevision:flight.baseRevision,ackRevision:newRevision,endSeq:flight.endSeq,candidateSeq:expectedSeq,observedSeq:committedState?.seq}));
    session.cloudConflictPending=true;
    if(!tab.primaryTab)return false;
    if(publication.reason==='publication-error')console.error('post-ACK model publication',publication.error);
    await setWriteControl(scope,{conflict:{kind:publication.reason==='publication-error'?'ack-publication-failed':'concurrent-ack',domain:'kupa',baseRevision:flight.baseRevision,currentRemoteRevision:newRevision}});
    if(!writeScopeCurrent(scope))return false;
    setSaveStatus('שינוי מקביל נשמר מקומית; הסנכרון נעצר לבדיקה','error');setCloudHeaderStatus('conflict','ענן: נדרשת בדיקה');
    reportError(publication.reason==='publication-error'?'אישור הענן נשמר, אבל עדכון הנתונים לתצוגה נכשל. הסנכרון נעצר לבדיקה; הנתונים נשמרו באחסון המקומי.':'שינוי בוצע בזמן שמירת אישור הענן. הנתונים נשמרו מקומית; ייצא גיבוי JSON ובדוק את המצב לפני חידוש הסנכרון.');
    return false;
  }
  if(businessChanged)try{render()}catch(error){console.error('post-ACK render',error)}
  if(!writeScopeCurrent(scope))return false;
  try{void Promise.resolve(backupSnapshotToComputer(structuredClone(model.state),newRevision)).catch(error=>console.error('post-ACK local backup',error))}catch(error){console.error('post-ACK local backup',error)}
  if(!writeScopeCurrent(scope,committedState))return false;
  return {committed:true,state:committedState};
}

return {publishAcknowledgedFlight};
}
