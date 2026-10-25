import {assertStorageJsonObject} from '../shared/storage-json-codec.js';
import {responseProperty} from '../shared/response-evidence.js';
import {normalizeCloudError,contentionDelay,CLOUD_WRITE_POLICY,operationAuditMetadata,runBusyCloudWriteWithPolicy,structuredSyncConflict,cloudWriteError} from '../shared/cloud-sync.js';
import {cloudWriteScopeIsCurrent} from '../shared/cloud-write-scope.js';
import {equalSyncJson} from '../shared/sync-json.js';
import {clone} from '../core/values.js';

// Owns one immutable send and conflict rebase.
/** @param {import('../shared/sync-document-contracts.js').OrdersWriteFlightPorts} ports */
export function createCloudWriteFlight({model,session,access,journal,projection,transport,view,publication,recovery={}}){
  const {writeScopeCurrent,getCloudWriteScope=()=>null}=access;
  const {refreshStorageV2CloudState=async()=>null,materializeStorageV2CloudFlight=async()=>null,rejectStorageV2CloudFlight=async()=>null,setWriteControl}=journal;
  const {prepareCloudState,merge3,composeOrderCloudState=(cloud,current)=>({...clone(cloud),checks:clone(current.checks||[])}),applyOrderCloudState}=projection;
  const {rpcSaveV2,readCloud}=transport;
  const {setCloud,toast}=view;
  const {publishAcknowledgedFlight}=publication;
  const {readStorageV2CloudRecovery,commitStorageV2CloudRecovery}=recovery;

/** @param {import('../shared/sync-document-contracts.js').RpcResult|null} res */
function revisionConflict(res){return !res?.r?.ok&&normalizeCloudError(res).kind==='revision_conflict'}

/** @param {import('../shared/sync-document-contracts.js').RpcResult|null} res */
function saveBusy(res){return !res?.r?.ok&&normalizeCloudError(res).kind==='busy'}

function contentionBackoff(attempt=0){return new Promise(resolve=>setTimeout(resolve,contentionDelay(attempt)))}

/** @param {unknown} value @returns {import('../shared/storage-records.js').StorageDeleteIntents} */
function normalizeDeleteIntents(value){
  /** @type {import('../shared/storage-records.js').StorageDeleteIntents} */
  const out={};if(!value||typeof value!=='object'||Array.isArray(value))return out;for(const [key,ids] of Object.entries(value)){/** @type {unknown[]} */ const entries=Array.isArray(ids)?ids:[];const clean=[...new Set(entries.map(x=>String(x||'').trim()).filter(Boolean))].sort();if(clean.length)out[key]=clean}return out}

/** @param {import('../shared/storage-json.js').StorageJsonObject} state @param {string} key @returns {unknown[]} */
function collectionRows(state,key){let value=/** @type {unknown} */(state);for(const part of key.split('.'))value=responseProperty(value,part);return Array.isArray(value)?value:[]}

/** @param {import('../shared/storage-json.js').StorageJsonObject} base @param {import('../shared/storage-json.js').StorageJsonObject} candidate @param {unknown} intents @returns {import('../shared/storage-records.js').StorageDeleteIntents} */
function effectiveDeleteIntents(base,candidate,intents){
  /** @type {import('../shared/storage-records.js').StorageDeleteIntents} */
  const out={};
  const declared=normalizeDeleteIntents(intents);for(const [key,ids] of Object.entries(declared)){const before=collectionRows(base,key),after=collectionRows(candidate,key),keyField=key==='cards'?'name':'id',kept=new Set(after.map(x=>String(responseProperty(x,keyField)??'')));const removed=before.map(x=>String(responseProperty(x,keyField)??'')).filter(id=>id&&ids.includes(id)&&!kept.has(id)).sort();if(removed.length)out[key]=removed}return out}

/** @param {import('../shared/storage-cloud-records.js').StoredCloudFlight|null} initialFlight @param {import('../shared/sync-document-contracts.js').Scope} scope */
async function saveStorageV2CloudFlight(initialFlight,scope){
  let state=await refreshStorageV2CloudState(),flight=initialFlight||state?.flight;
  if(!state?.base||!flight)throw new Error('orders_v2_flight_missing');
  if(!writeScopeCurrent(scope,state)||!cloudWriteScopeIsCurrent(scope,getCloudWriteScope(),{base:flight}))return false;
  let base=prepareCloudState(state.base.state),serverSnapshot=prepareCloudState(flight.snapshot),expected=Number(flight.baseRevision),res=null;
  for(let conflictAttempt=0;conflictAttempt<CLOUD_WRITE_POLICY.conflictAttempts;conflictAttempt++){
    const deleteIntents=normalizeDeleteIntents(flight.deleteIntents),exactIntents=effectiveDeleteIntents(base,serverSnapshot,deleteIntents),deleteCount=Object.values(exactIntents).reduce((sum,ids)=>sum+ids.length,0),audit=operationAuditMetadata({site:'orders',mutationType:exactIntents['notesSheet.sheets']?.length?'bulk-delete':flight.mutationType||'autosave',surface:flight.surface||'orders',baseRevision:expected,beforeState:base,afterState:serverSnapshot,collections:['suppliers','transactions','customerDebts','customerOrders','serviceCalls','notes','inventoryItems','inventoryEvents','warehouseOrders','notesSheet.sheets','notesSheet.columns','notesSheet.rows'],deleteCount});
    const sendingFlight=flight;res=await runBusyCloudWriteWithPolicy(()=>{if(!writeScopeCurrent(scope))throw Object.assign(new Error('cloud_sync_scope_changed'),{code:'cloud_sync_scope_changed'});return rpcSaveV2(serverSnapshot,expected,sendingFlight.operationId,exactIntents,audit)});
    if(!writeScopeCurrent(scope))return false;
    if(saveBusy(res))throw new Error('save_busy');
    if(!revisionConflict(res))break;
    await contentionBackoff(conflictAttempt);
    if(!writeScopeCurrent(scope))return false;
    const remote=await readCloud();if(!writeScopeCurrent(scope))return false;if(!remote?.state)throw new Error('מסמך הענן לא נמצא בזמן פתרון התנגשות');
    const remoteRevision=Number(remote.revision||0);if(!Number.isSafeInteger(remoteRevision)||remoteRevision<=expected)throw new Error('orders_v2_rebase_revision_invalid');
    const remoteState=prepareCloudState(remote.state),merged=merge3(base,serverSnapshot,remoteState,{deleteIntents});
    state=await refreshStorageV2CloudState();
    if(!writeScopeCurrent(scope,state))return false;
    if(!state?.flight||state.flight.operationId!==flight.operationId)throw new Error('orders_v2_flight_changed_before_rebase');
    const expectedSeq=state.seq;
    if(merged.conflicts.length){
      const conflict=assertStorageJsonObject(structuredSyncConflict({domain:'orders',conflicts:merged.conflicts,base,local:serverSnapshot,remote:remoteState,generation:Number(flight.generation||0),baseRevision:expected,currentRemoteRevision:remoteRevision}));
      const conflictCommit=await rejectStorageV2CloudFlight(flight.operationId,remoteRevision,remoteState,{currentState:model.state,expectedSeq,control:{conflict}});
      if(!writeScopeCurrent(scope,conflictCommit?.cloudState||conflictCommit))return false;
      session.lastCloudState=clone(remoteState);session.cloudRevision=remoteRevision;session.cloudUpdatedAt=remote.updated_at||session.cloudUpdatedAt;session.cloudConflictBlocked=true;session.cloudSaveRequested=false;
      setCloud('ענן: התנגשות','error');toast('יש התנגשות בענן באותה רשומה. הנתונים המקומיים נשמרו ולא נדרסו.');return false
    }
    const throughSeq=Number(flight.endSeq),previousOperationId=flight.operationId;
    let currentCloud=merged.state;
    if(state.afterFlightPending){
      const rebased=merge3(serverSnapshot,prepareCloudState(model.state),merged.state,{deleteIntents:state.afterFlightDeleteIntents||{}});
      if(rebased.conflicts.length){
        const conflict=assertStorageJsonObject(structuredSyncConflict({domain:'orders',conflicts:rebased.conflicts,base:serverSnapshot,local:prepareCloudState(model.state),remote:merged.state,generation:state.afterFlightGeneration,baseRevision:expected,currentRemoteRevision:remoteRevision}));
        const conflictCommit=await rejectStorageV2CloudFlight(previousOperationId,remoteRevision,remoteState,{currentState:model.state,expectedSeq,control:{conflict}});
      if(!writeScopeCurrent(scope,conflictCommit?.cloudState||conflictCommit))return false;
        session.cloudConflictBlocked=true;session.cloudSaveRequested=false;setCloud('ענן: התנגשות','error');return false;
      }
      currentCloud=rebased.state;
    }
    const previousState=clone(model.state),expectedGeneration=Number(session.localGeneration||0),rebasedCurrent=composeOrderCloudState(currentCloud,model.state);
    await rejectStorageV2CloudFlight(previousOperationId,remoteRevision,remoteState,{currentState:rebasedCurrent,expectedSeq});
    // The IDB rebase is atomic, but a new edit may be journaled while its
    // transaction is committing. Never overwrite that edit with the earlier
    // merged view or construct a flight from a stale visible model.
    const postRebase=await refreshStorageV2CloudState();
    if(!writeScopeCurrent(scope,postRebase))return false;
    let recoveredPublication=false;
    if((postRebase?.seq!==expectedSeq||Number(session.localGeneration||0)!==expectedGeneration)&&readStorageV2CloudRecovery&&commitStorageV2CloudRecovery){
      try{
        const {recoverPostAckPublication}=await import('../shared/cloud-post-ack-recovery.js');
        const recovered=await recoverPostAckPublication({isCurrent:head=>writeScopeCurrent(scope,head),generation:()=>Number(session.localGeneration||0),visible:()=>model.state,
          equal:(a,b)=>equalSyncJson(prepareCloudState(a),prepareCloudState(b)),merge:(before,local,candidate,deleteIntents)=>merge3(prepareCloudState(before),prepareCloudState(local),prepareCloudState(candidate),{deleteIntents}),
          read:readStorageV2CloudRecovery,commit:(value,options)=>commitStorageV2CloudRecovery(composeOrderCloudState(value,model.state),options),publish:applyOrderCloudState},
          {previousState,candidateState:rebasedCurrent,candidateSeq:expectedSeq,baseState:remoteState,ackRevision:remoteRevision,ackSeq:state.base?.ackSeq||0});
        recoveredPublication=!!recovered;
      }catch(error){console.error('rebase recovery retained for review',error)}
    }
    if(!writeScopeCurrent(scope))return false;
    if(!recoveredPublication&&(postRebase?.seq!==expectedSeq||Number(session.localGeneration||0)!==expectedGeneration)){
      await setWriteControl(scope,{conflict:{kind:'concurrent-rebase',domain:'orders',baseRevision:expected,currentRemoteRevision:remoteRevision}});
      if(!writeScopeCurrent(scope))return false;
      session.cloudConflictBlocked=true;session.cloudSaveRequested=false;setCloud('ענן: הסנכרון נעצר לשמירת שינוי מקביל','error');
      toast('שינוי בוצע בזמן מיזוג הענן. הנתונים נשמרו מקומית; ייצא גיבוי ובדוק את המצב לפני חידוש הסנכרון.');
      return false;
    }
    if(!recoveredPublication)applyOrderCloudState(currentCloud);
    if(!writeScopeCurrent(scope))return false;
    base=remoteState;serverSnapshot=prepareCloudState(merged.state);expected=remoteRevision;
    flight=await materializeStorageV2CloudFlight({throughSeq,snapshot:serverSnapshot});if(!writeScopeCurrent(scope)||!cloudWriteScopeIsCurrent(scope,getCloudWriteScope(),{base:flight}))return false;
    if(!flight||flight.operationId===previousOperationId)throw new Error('orders_v2_rebase_flight_not_rotated');
  }
  if(!res?.r?.ok)throw cloudWriteError(res,'שמירה לענן נכשלה');
  return publishAcknowledgedFlight({res,flight,serverSnapshot,scope});
}

return {saveStorageV2CloudFlight};
}
