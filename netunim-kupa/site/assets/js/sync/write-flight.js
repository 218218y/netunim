import {normalizeCloudError,contentionDelay,operationAuditMetadata,CLOUD_WRITE_POLICY,runBusyCloudWriteWithPolicy,structuredSyncConflict,cloudWriteError} from '../shared/cloud-sync.js';
import {cloudWriteScopeIsCurrent} from '../shared/cloud-write-scope.js';
import {canonicalCloudSyncBase} from './state-projection.js';
import {jsonEq} from './merge-records.js';

// Owns one immutable send and conflict rebase.
export function createCloudWriteFlight({model,session,access,journal,projection,transport,view,publication}){
  const {writeScopeCurrent,getCloudWriteScope=()=>null}=access;
  const {refreshStorageV2CloudState=async()=>null,materializeStorageV2CloudFlight=async()=>null,rejectStorageV2CloudFlight=async()=>null,setWriteControl}=journal;
  const {prepareKupaCloudState,mergeKupaCloudState3Way,applyKupaCoreState,replaceVisibleState}=projection;
  const {rpcSaveCloudV2,readSupabaseDocument}=transport;
  const {setSaveStatus,setCloudHeaderStatus,reportError,render}=view;
  const {publishAcknowledgedFlight}=publication;

function revisionConflict(res){return !res?.r?.ok&&normalizeCloudError(res).kind==='revision_conflict'}

function saveBusy(res){return !res?.r?.ok&&normalizeCloudError(res).kind==='busy'}

function contentionBackoff(attempt=0){return new Promise(resolve=>setTimeout(resolve,contentionDelay(attempt)))}

function normalizeDeleteIntents(value){const out={};if(!value||typeof value!=='object'||Array.isArray(value))return out;for(const [key,ids] of Object.entries(value)){const clean=[...new Set((Array.isArray(ids)?ids:[]).map(x=>String(x||'').trim()).filter(Boolean))].sort();if(clean.length)out[key]=clean}return out}

function collectionRows(state,key){if(key==='notesSheet.sheets')return state?.notesSheet?.sheets||[];if(key==='notesSheet.rows')return state?.notesSheet?.rows||[];if(key==='notesSheet.columns')return state?.notesSheet?.columns||[];return state?.[key]||[]}

function effectiveDeleteIntents(base,candidate,intents){const out={},declared=normalizeDeleteIntents(intents);for(const [key,ids] of Object.entries(declared)){const before=Array.isArray(collectionRows(base,key))?collectionRows(base,key):[],after=Array.isArray(collectionRows(candidate,key))?collectionRows(candidate,key):[],kept=new Set(after.map(x=>String(x?.id||''))),removed=before.map(x=>String(x?.id||'')).filter(id=>id&&ids.includes(id)&&!kept.has(id)).sort();if(removed.length)out[key]=removed}return out}

function cloudAudit(pending,before,after,baseRevision,intents){const deletes=Object.values(intents).reduce((sum,ids)=>sum+ids.length,0);return operationAuditMetadata({site:'kupa',mutationType:intents['notesSheet.sheets']?.length||pending?.mutationType==='cloud-normalization'&&deletes?'bulk-delete':pending?.mutationType||'autosave',surface:pending?.surface||'kupa',baseRevision,beforeState:before,afterState:after,collections:['credits','cash','rights','notes','expenses','cards','notesSheet.rows','notesSheet.columns','notesSheet.sheets'],deleteCount:deletes,restoreGroupId:pending?.restoreGroupId})}

async function saveStorageV2CloudFlight(initialFlight,scope){
  let state=await refreshStorageV2CloudState(),flight=initialFlight||state?.flight;if(!state?.base||!flight)throw new Error('kupa_v2_flight_missing');
  if(!writeScopeCurrent(scope,state)||!cloudWriteScopeIsCurrent(scope,getCloudWriteScope(),{base:flight}))return false;
  // Keep the exact adopted cloud base here. Re-normalizing it would drop
  // expired legacy credit IDs before effectiveDeleteIntents can send them to
  // the server's delete-intent guard.
  let base=structuredClone(state.base.state),serverSnapshot=prepareKupaCloudState(flight.snapshot),expected=Number(flight.baseRevision),res=null;
  for(let attempt=0;attempt<CLOUD_WRITE_POLICY.conflictAttempts;attempt++){
    const deleteIntents=normalizeDeleteIntents(flight.deleteIntents),exactIntents=effectiveDeleteIntents(base,serverSnapshot,deleteIntents);session.cloudWriteBusy=true;res=await runBusyCloudWriteWithPolicy(()=>{if(!writeScopeCurrent(scope))throw Object.assign(new Error('cloud_sync_scope_changed'),{code:'cloud_sync_scope_changed'});return rpcSaveCloudV2(serverSnapshot,expected,flight.operationId,exactIntents,cloudAudit(flight,base,serverSnapshot,expected,exactIntents))});if(!writeScopeCurrent(scope))return false;session.cloudWriteBusy=false;
    if(saveBusy(res))throw new Error('save_busy');if(!revisionConflict(res))break;
    await contentionBackoff(attempt);if(!writeScopeCurrent(scope))return false;const remote=await readSupabaseDocument();if(!writeScopeCurrent(scope))return false;if(!remote?.state)throw new Error('מסמך הענן לא נמצא בזמן פתרון התנגשות');const remoteRevision=Number(remote.revision||0);if(!Number.isSafeInteger(remoteRevision)||remoteRevision<=expected)throw new Error('kupa_v2_rebase_revision_invalid');const remoteState=canonicalCloudSyncBase(remote.state,prepareKupaCloudState),merged=mergeKupaCloudState3Way(base,serverSnapshot,remoteState,{deleteIntents});
    state=await refreshStorageV2CloudState();if(!writeScopeCurrent(scope,state))return false;if(!state?.flight||state.flight.operationId!==flight.operationId)throw new Error('kupa_v2_flight_changed_before_rebase');const expectedSeq=state.seq;
    if(merged.conflicts.length){const conflict=structuredSyncConflict({domain:'kupa',conflicts:merged.conflicts,base,local:serverSnapshot,remote:remoteState,generation:flight.generation,baseRevision:expected,currentRemoteRevision:remoteRevision});const conflictCommit=await rejectStorageV2CloudFlight(flight.operationId,remoteRevision,remoteState,{currentState:model.state,expectedSeq,control:{conflict}});if(!writeScopeCurrent(scope,conflictCommit?.cloudState||conflictCommit))return false;session.dbRevision=remoteRevision;session.lastSavedSnapshot=JSON.stringify(remoteState);session.serverInfo.lastSavedAt=remote.coreUpdatedAt||session.serverInfo.lastSavedAt||null;session.cloudConflictPending=true;setSaveStatus('התנגשות שמורה מקומית','error');setCloudHeaderStatus('conflict','ענן: התנגשות');reportError('הסנכרון נעצר: אותה רשומה שונתה במקביל בשני מקומות. השינוי המקומי נשמר ולא נדרס.');return false}
    const throughSeq=Number(flight.endSeq),previousOperationId=flight.operationId;let currentCore=merged.state;
    if(state.afterFlightPending){const localCore=prepareKupaCloudState(model.state),rebased=mergeKupaCloudState3Way(serverSnapshot,localCore,merged.state,{deleteIntents:state.afterFlightDeleteIntents||{}});if(rebased.conflicts.length){const conflict=structuredSyncConflict({domain:'kupa',conflicts:rebased.conflicts,base:serverSnapshot,local:localCore,remote:merged.state,generation:state.afterFlightGeneration,baseRevision:expected,currentRemoteRevision:remoteRevision});const conflictCommit=await rejectStorageV2CloudFlight(previousOperationId,remoteRevision,remoteState,{currentState:model.state,expectedSeq,control:{conflict}});if(!writeScopeCurrent(scope,conflictCommit?.cloudState||conflictCommit))return false;session.cloudConflictPending=true;setSaveStatus('התנגשות שמורה מקומית','error');setCloudHeaderStatus('conflict','ענן: התנגשות');return false}currentCore=rebased.state}
    const expectedGeneration=Number(session.localGeneration||0),rebasedCurrent=applyKupaCoreState(currentCore,model.state.checks,model.state);
    await rejectStorageV2CloudFlight(previousOperationId,remoteRevision,remoteState,{currentState:rebasedCurrent,expectedSeq});
    // A user edit may commit while the rebase transaction is in flight.
    // Keep the visible edit and block another send until the recovered head is
    // inspected, rather than replacing it with an older merged snapshot.
    const postRebase=await refreshStorageV2CloudState();
    if(!writeScopeCurrent(scope,postRebase))return false;
    if(postRebase?.seq!==expectedSeq||Number(session.localGeneration||0)!==expectedGeneration){
      await setWriteControl(scope,{conflict:{kind:'concurrent-rebase',domain:'kupa',baseRevision:expected,currentRemoteRevision:remoteRevision}});
      if(!writeScopeCurrent(scope))return false;
      session.cloudConflictPending=true;setSaveStatus('שינוי מקביל נשמר מקומית; הסנכרון נעצר לבדיקה','error');setCloudHeaderStatus('conflict','ענן: נדרשת בדיקה');
      reportError('שינוי בוצע בזמן מיזוג הענן. הנתונים נשמרו מקומית; ייצא גיבוי JSON ובדוק את המצב לפני חידוש הסנכרון.');
      return false;
    }
    if(!jsonEq(model.state,rebasedCurrent)){replaceVisibleState(rebasedCurrent);render()}
    if(!writeScopeCurrent(scope))return false;
    base=remoteState;serverSnapshot=prepareKupaCloudState(merged.state);expected=remoteRevision;flight=await materializeStorageV2CloudFlight({throughSeq,snapshot:serverSnapshot});if(!writeScopeCurrent(scope)||!cloudWriteScopeIsCurrent(scope,getCloudWriteScope(),{base:flight}))return false;if(!flight||flight.operationId===previousOperationId)throw new Error('kupa_v2_rebase_flight_not_rotated')
  }
  if(!res?.r?.ok)throw cloudWriteError(res,'שמירה לענן נכשלה');
  return publishAcknowledgedFlight({res,flight,serverSnapshot,scope});
}

return {saveStorageV2CloudFlight};
}
