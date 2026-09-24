import {structuredSyncConflict} from '../shared/cloud-sync.js';
import {clone} from '../core/values.js';
import {CLOUD_BASE_KEY} from '../state/constants.js';
import {CLOUD_WRITE_POLICY,cloudWriteError,contentionDelay,createOutboxRetryScheduler,getOutboxRetryDelay,normalizeCloudError,operationAuditMetadata,runBusyCloudWriteWithPolicy} from '../shared/cloud-sync.js';

function revisionConflict(res){return !res?.r?.ok&&normalizeCloudError(res).kind==='revision_conflict'}
function saveBusy(res){return !res?.r?.ok&&normalizeCloudError(res).kind==='busy'}
function contentionBackoff(attempt=0){return new Promise(resolve=>setTimeout(resolve,contentionDelay(attempt)))}
function normalizeDeleteIntents(value){const out={};if(!value||typeof value!=='object'||Array.isArray(value))return out;for(const [key,ids] of Object.entries(value)){const clean=[...new Set((Array.isArray(ids)?ids:[]).map(x=>String(x||'').trim()).filter(Boolean))].sort();if(clean.length)out[key]=clean}return out}
function collectionRows(state,key){const value=key.split('.').reduce((obj,part)=>obj?.[part],state);return Array.isArray(value)?value:[]}
function effectiveDeleteIntents(base,candidate,intents){const out={},declared=normalizeDeleteIntents(intents);for(const [key,ids] of Object.entries(declared)){const before=collectionRows(base,key),after=collectionRows(candidate,key),keyField=key==='cards'?'name':'id',kept=new Set(after.map(x=>String(x?.[keyField]??'')));const removed=before.map(x=>String(x?.[keyField]??'')).filter(id=>id&&ids.includes(id)&&!kept.has(id)).sort();if(removed.length)out[key]=removed}return out}

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createSyncDocument({model, files, session, ui, tab, normalizeState, localSnapshot:writeLocalSnapshot, markCloudPending, getCloudPending, clearCloudPending, toast, setCloud, prepareCloudState, writeStateToFolder, readCloud, rpcSave, rpcSaveV2=rpcSave, merge3, applyOrderCloudState, composeOrderCloudState=(cloud,current)=>({...clone(cloud),checks:clone(current.checks||[])}), cloudPendingExists, setSave, cloudEnabled, loadCloudPendingState, sameOrderCloudData, cloudHasLocalWork, render, readCloudMeta, refreshKupaReadout, pollSharedChecks, refreshCloudTimestamp, storageV2CloudOutboxActive=()=>false, refreshStorageV2CloudState=async()=>null, initializeStorageV2CloudCursor=async()=>false, materializeStorageV2CloudFlight=async()=>null, acknowledgeStorageV2CloudFlight=async()=>null, rejectStorageV2CloudFlight=async()=>null, setStorageV2CloudControl=async()=>null, adoptStorageV2CloudHead=async()=>null, storageV2CommitPromise=()=>Promise.resolve(), storageV2PreparationActive=()=>false}){
const outboxRetryScheduler=createOutboxRetryScheduler();
const localSnapshot=(source,options)=>writeLocalSnapshot(source,options||{storageBoundary:'cloud-system-state'});
let cloudPollPromise=null,morningRefreshPromise=null;

function refreshForMorningRecovery(){
  if(morningRefreshPromise)return morningRefreshPromise;
  morningRefreshPromise=(async()=>{
    const available=()=>tab.primaryTab&&cloudEnabled()&&navigator.onLine&&!session.cloudConflictBlocked&&!session.syncCapabilitiesError;
    if(!available())return false;
    // Await actual completion, including a poll already reading the remote head.
    if(cloudPollPromise)await cloudPollPromise;
    if(session.cloudSavePromise)await session.cloudSavePromise;
    if(!available())return false;
    if(cloudHasLocalWork()||await getCloudPending()){
      if(!await requestCloudSave('סנכרון החוב לפני התאוששות Morning'))return false;
    }
    if(!available()||session.cloudBusy)return false;
    session.cloudBusy=true;
    try{
      const generation=session.localGeneration,local=prepareCloudState(model.state),row=await readCloud();
      if(!available()||!row?.state||!Number.isSafeInteger(Number(row.revision))||Number(row.revision)<Number(session.cloudRevision||0))return false;
      // A local edit/save during the GET invalidates this refresh; never apply a stale head.
      if(session.localGeneration!==generation||session.cloudSavePromise||cloudHasLocalWork()||!sameOrderCloudData(model.state,local))return false;
      applyOrderCloudState(row.state);session.cloudRevision=Number(row.revision);session.cloudUpdatedAt=row.updated_at||session.cloudUpdatedAt;session.lastCloudState=prepareCloudState(model.state);
      if(storageV2CloudOutboxActive())await adoptStorageV2CloudHead(session.cloudRevision,model.state);else{localStorage.setItem(CLOUD_BASE_KEY,JSON.stringify(session.lastCloudState));if(localSnapshot(undefined,{storageBoundary:'morning-cloud-refresh'})===false)return false}
      render();refreshCloudTimestamp();return true;
    }finally{session.cloudBusy=false}
  })().catch(error=>{console.error('Morning recovery cloud refresh',error);return false}).finally(()=>{morningRefreshPromise=null});
  return morningRefreshPromise;
}
async function saveCloudSnapshot(snapshot,startGeneration,pendingRecord=null){
  let localSnapshotWritten=false;
  let base=clone(pendingRecord?.baseState||session.lastCloudState||snapshot),deleteIntents=normalizeDeleteIntents(pendingRecord?.deleteIntents),expected=Number(pendingRecord?.baseRevision??session.cloudRevision??0),res=null,serverSnapshot=clone(snapshot),mergedRemote=false;
  const operationId=String(pendingRecord?.operationId||'').trim();
  if(!operationId)throw new Error('orders_operation_id_missing');
  for(let conflictAttempt=0;conflictAttempt<CLOUD_WRITE_POLICY.conflictAttempts;conflictAttempt++){
    const exactIntents=effectiveDeleteIntents(base,serverSnapshot,deleteIntents),deleteCount=Object.values(exactIntents).reduce((sum,ids)=>sum+ids.length,0),audit=operationAuditMetadata({site:'orders',mutationType:exactIntents['notesSheet.sheets']?.length?'bulk-delete':pendingRecord?.mutationType||'autosave',surface:pendingRecord?.surface||'orders',baseRevision:expected,beforeState:base,afterState:serverSnapshot,collections:['suppliers','transactions','customerDebts','customerOrders','serviceCalls','notes','inventoryItems','inventoryEvents','warehouseOrders','notesSheet.sheets','notesSheet.columns','notesSheet.rows'],deleteCount,restoreGroupId:pendingRecord?.restoreGroupId});
    res=await runBusyCloudWriteWithPolicy(()=>rpcSave(serverSnapshot,expected,operationId,exactIntents,audit));
    if(saveBusy(res))throw new Error('save_busy');
    if(!revisionConflict(res))break;
    await contentionBackoff(conflictAttempt);
    const remote=await readCloud();if(!remote)throw new Error('מסמך הענן לא נמצא בזמן פתרון התנגשות');
    const merged=merge3(base,serverSnapshot,remote.state||{},{deleteIntents});
    if(merged.conflicts.length){session.cloudConflictBlocked=true;markCloudPending(prepareCloudState(model.state),'',{conflict:structuredSyncConflict({domain:'orders',conflicts:merged.conflicts,base,local:serverSnapshot,remote:remote.state,generation:session.localGeneration,baseRevision:expected,currentRemoteRevision:remote.revision})});await session.ordersOutboxCommitPromise;setCloud('ענן: התנגשות','error');toast('יש התנגשות בענן באותה רשומה. הנתונים המקומיים נשמרו ולא נדרסו.');return false}
    base=prepareCloudState(remote.state||{});serverSnapshot=prepareCloudState(merged.state);expected=Number(remote.revision||0);mergedRemote=true
  }
  if(!res?.r?.ok)throw cloudWriteError(res,'שמירה לענן נכשלה');
  const replayed=res.row?.operation_replayed===true,authoritative=prepareCloudState(res.row?.state||serverSnapshot);
  session.cloudRevision=Number(res.row?.revision||expected+1);session.cloudUpdatedAt=res.row?.updated_at||session.cloudUpdatedAt;session.lastCloudState=clone(authoritative);try{localStorage.setItem(CLOUD_BASE_KEY,JSON.stringify(session.lastCloudState))}catch(error){console.error('cloud base mirror',error)};session.cloudConflictBlocked=false;
  let pendingNow=await getCloudPending();
  if(Number(pendingNow?.generation||0)===Number(startGeneration)){
    const cleared=await clearCloudPending(startGeneration);
    pendingNow=await getCloudPending();
    if(!cleared&&Number(pendingNow?.generation||0)<=Number(startGeneration)){
      setCloud('השינוי אושר; ניקוי מקומי ממתין להתאוששות','error');return false;
    }
    // A mutation can arrive while the acknowledged generation is being removed.
    // Apply the head only after cleanup confirms that there is no newer work.
    if(!pendingNow&&(mergedRemote||replayed||!sameOrderCloudData(model.state,authoritative)))applyOrderCloudState(authoritative);
  }
  if(pendingNow){
    const local=prepareCloudState(pendingNow?.snapshot||model.state),rebased=merge3(snapshot,local,authoritative,{deleteIntents:pendingNow?.deleteIntents||deleteIntents});
    if(rebased.conflicts.length){
      session.cloudConflictBlocked=true;session.cloudSaveRequested=false;
      markCloudPending(local,'',{baseRevision:pendingNow?.baseRevision,baseState:pendingNow?.baseState,conflict:structuredSyncConflict({domain:'orders',conflicts:rebased.conflicts,base:snapshot,local,remote:authoritative,generation:pendingNow?.generation,baseRevision:res.row?.operation_revision??session.cloudRevision,currentRemoteRevision:session.cloudRevision})});
      await session.ordersOutboxCommitPromise;setCloud('ענן: התנגשות','error');return false;
    }
    applyOrderCloudState(rebased.state);
    session.localGeneration=Math.max(Number(session.localGeneration||0),Number(pendingNow?.generation||0))+1;
    localSnapshotWritten=localSnapshot(undefined,{storageBoundary:'cloud-ack-rebase'})!==false;markCloudPending(prepareCloudState(model.state),'',{baseRevision:session.cloudRevision,baseState:authoritative,conflict:null,deleteIntents:pendingNow?.deleteIntents||deleteIntents});await session.ordersOutboxCommitPromise;session.cloudSaveRequested=true
  }
  if(!localSnapshotWritten)localSnapshot(undefined,{storageBoundary:'cloud-ack-mirror'});try{if(files.dirHandle)await writeStateToFolder()}catch(localError){console.error('local backup/mirror',localError)}
  // Drain legacy work completely before establishing the V2 cloud cursor.  The
  // cursor is captured only from the authoritative post-ACK state, never by
  // translating a V1 base/snapshot pair into journal operations.
  if(!await getCloudPending())try{await initializeStorageV2CloudCursor(session.cloudRevision)}catch(error){console.error('orders V2 cloud cursor initialization',error)}
  return true
}

function v2RetryRecord(state,flight=null){return {domain:'orders',documentName:'suppliers-v2',generation:Number(flight?.generation??state?.pendingGeneration??0),operationId:String(flight?.operationId||'orders-v2'),retry:state?.control?.retry||null}}

async function saveStorageV2CloudFlight(initialFlight){
  let state=await refreshStorageV2CloudState(),flight=initialFlight||state?.flight;
  if(!state?.base||!flight)throw new Error('orders_v2_flight_missing');
  let base=prepareCloudState(state.base.state),serverSnapshot=prepareCloudState(flight.snapshot),expected=Number(flight.baseRevision),res=null;
  for(let conflictAttempt=0;conflictAttempt<CLOUD_WRITE_POLICY.conflictAttempts;conflictAttempt++){
    const deleteIntents=normalizeDeleteIntents(flight.deleteIntents),exactIntents=effectiveDeleteIntents(base,serverSnapshot,deleteIntents),deleteCount=Object.values(exactIntents).reduce((sum,ids)=>sum+ids.length,0),audit=operationAuditMetadata({site:'orders',mutationType:exactIntents['notesSheet.sheets']?.length?'bulk-delete':flight.mutationType||'autosave',surface:flight.surface||'orders',baseRevision:expected,beforeState:base,afterState:serverSnapshot,collections:['suppliers','transactions','customerDebts','customerOrders','serviceCalls','notes','inventoryItems','inventoryEvents','warehouseOrders','notesSheet.sheets','notesSheet.columns','notesSheet.rows'],deleteCount});
    res=await runBusyCloudWriteWithPolicy(()=>rpcSaveV2(serverSnapshot,expected,flight.operationId,exactIntents,audit));
    if(saveBusy(res))throw new Error('save_busy');
    if(!revisionConflict(res))break;
    await contentionBackoff(conflictAttempt);
    const remote=await readCloud();if(!remote?.state)throw new Error('מסמך הענן לא נמצא בזמן פתרון התנגשות');
    const remoteRevision=Number(remote.revision||0);if(!Number.isSafeInteger(remoteRevision)||remoteRevision<=expected)throw new Error('orders_v2_rebase_revision_invalid');
    const remoteState=prepareCloudState(remote.state),merged=merge3(base,serverSnapshot,remoteState,{deleteIntents});
    state=await refreshStorageV2CloudState();
    if(!state?.flight||state.flight.operationId!==flight.operationId)throw new Error('orders_v2_flight_changed_before_rebase');
    const expectedSeq=state.seq;
    if(merged.conflicts.length){
      const conflict=structuredSyncConflict({domain:'orders',conflicts:merged.conflicts,base,local:serverSnapshot,remote:remoteState,generation:flight.generation,baseRevision:expected,currentRemoteRevision:remoteRevision});
      await rejectStorageV2CloudFlight(flight.operationId,remoteRevision,remoteState,{currentState:model.state,expectedSeq,control:{conflict}});
      session.lastCloudState=clone(remoteState);session.cloudRevision=remoteRevision;session.cloudUpdatedAt=remote.updated_at||session.cloudUpdatedAt;session.cloudConflictBlocked=true;session.cloudSaveRequested=false;
      setCloud('ענן: התנגשות','error');toast('יש התנגשות בענן באותה רשומה. הנתונים המקומיים נשמרו ולא נדרסו.');return false
    }
    const throughSeq=Number(flight.endSeq),previousOperationId=flight.operationId;
    let currentCloud=merged.state;
    if(state.afterFlightPending){
      const rebased=merge3(serverSnapshot,prepareCloudState(model.state),merged.state,{deleteIntents:state.afterFlightDeleteIntents||{}});
      if(rebased.conflicts.length){
        const conflict=structuredSyncConflict({domain:'orders',conflicts:rebased.conflicts,base:serverSnapshot,local:prepareCloudState(model.state),remote:merged.state,generation:state.afterFlightGeneration,baseRevision:expected,currentRemoteRevision:remoteRevision});
        await rejectStorageV2CloudFlight(previousOperationId,remoteRevision,remoteState,{currentState:model.state,expectedSeq,control:{conflict}});
        session.cloudConflictBlocked=true;session.cloudSaveRequested=false;setCloud('ענן: התנגשות','error');return false;
      }
      currentCloud=rebased.state;
    }
    const expectedGeneration=Number(session.localGeneration||0),rebasedCurrent=composeOrderCloudState(currentCloud,model.state);
    await rejectStorageV2CloudFlight(previousOperationId,remoteRevision,remoteState,{currentState:rebasedCurrent,expectedSeq});
    // The IDB rebase is atomic, but a new edit may be journaled while its
    // transaction is committing. Never overwrite that edit with the earlier
    // merged view or construct a flight from a stale visible model.
    const postRebase=await refreshStorageV2CloudState();
    if(postRebase?.seq!==expectedSeq||Number(session.localGeneration||0)!==expectedGeneration){
      await setStorageV2CloudControl({conflict:{kind:'concurrent-rebase',domain:'orders',baseRevision:expected,currentRemoteRevision:remoteRevision}});
      session.cloudConflictBlocked=true;session.cloudSaveRequested=false;setCloud('ענן: הסנכרון נעצר לשמירת שינוי מקביל','error');
      toast('שינוי בוצע בזמן מיזוג הענן. הנתונים נשמרו מקומית; ייצא גיבוי ובדוק את המצב לפני חידוש הסנכרון.');
      return false;
    }
    applyOrderCloudState(currentCloud);
    base=remoteState;serverSnapshot=prepareCloudState(merged.state);expected=remoteRevision;
    flight=await materializeStorageV2CloudFlight({throughSeq,snapshot:serverSnapshot});
    if(!flight||flight.operationId===previousOperationId)throw new Error('orders_v2_rebase_flight_not_rotated');
  }
  if(!res?.r?.ok)throw cloudWriteError(res,'שמירה לענן נכשלה');
  const authoritative=prepareCloudState(res.row?.state||serverSnapshot),newRevision=Number(res.row?.revision||expected+1);
  if(!Number.isSafeInteger(newRevision)||newRevision<=Number(flight.baseRevision))throw new Error('orders_v2_ack_revision_invalid');
  // Reconcile edits that arrived while this immutable flight was in progress
  // before ACK.  ACK + current checkpoint are then committed in one IDB
  // transaction, so a crash cannot advance the cloud cursor without persisting
  // the corresponding rebased local head.
  state=await refreshStorageV2CloudState();
  if(!state?.flight||state.flight.operationId!==flight.operationId)throw new Error('orders_v2_flight_changed_before_ack');
  if(state.afterFlightPending){
    const local=prepareCloudState(model.state),rebased=merge3(serverSnapshot,local,authoritative,{deleteIntents:state.afterFlightDeleteIntents||{}});
    if(rebased.conflicts.length){
      const conflict=structuredSyncConflict({domain:'orders',conflicts:rebased.conflicts,base:serverSnapshot,local,remote:authoritative,generation:state.afterFlightGeneration,baseRevision:flight.baseRevision,currentRemoteRevision:newRevision});
      await acknowledgeStorageV2CloudFlight(flight.operationId,newRevision,authoritative,{currentState:model.state,control:{conflict}});
      session.cloudRevision=newRevision;session.cloudUpdatedAt=res.row?.updated_at||session.cloudUpdatedAt;session.lastCloudState=clone(authoritative);session.cloudConflictBlocked=true;session.cloudSaveRequested=false;
      setCloud('ענן: התנגשות','error');return false
    }
    applyOrderCloudState(rebased.state);session.cloudSaveRequested=true
  }else if(!sameOrderCloudData(model.state,authoritative))applyOrderCloudState(authoritative);
  const committedState=await acknowledgeStorageV2CloudFlight(flight.operationId,newRevision,authoritative,{currentState:model.state});
  session.cloudRevision=newRevision;session.cloudUpdatedAt=res.row?.updated_at||session.cloudUpdatedAt;session.lastCloudState=clone(authoritative);session.cloudConflictBlocked=false;
  try{if(files.dirHandle)await writeStateToFolder()}catch(localError){console.error('local backup/mirror',localError)}
  return {committed:true,state:committedState}
}

async function requestStorageV2CloudSave(message='השינויים סונכרנו',{force=false}={}){
  if(!tab.primaryTab)return false;if(message)session.cloudSaveMessage=message;session.cloudSaveRequested=true;if(!force&&!cloudEnabled())return false;
  let state=await refreshStorageV2CloudState();
  if(!state?.base)return false;
  if(state.control?.conflict){session.cloudConflictBlocked=true;session.cloudSaveRequested=false;setCloud('ענן: התנגשות','error');return false}
  if(session.cloudConflictBlocked){setCloud('ענן: התנגשות','error');return false}
  if(!navigator.onLine){try{await storageV2CommitPromise()}catch(error){console.error('orders V2 journal offline commit',error)}setCloud('ענן: אופליין','offline');return false}
  if(session.cloudSavePromise)return session.cloudSavePromise;
  session.cloudSavePromise=(async()=>{let allOk=true;while(session.cloudSaveRequested&&(force||cloudEnabled())&&navigator.onLine&&!session.cloudConflictBlocked){
    session.cloudSaveRequested=false;const msg=session.cloudSaveMessage||'השינויים סונכרנו';session.cloudSaveMessage='';state=await refreshStorageV2CloudState();
    if(!state?.base){allOk=false;break}
    if(state.control?.conflict){session.cloudConflictBlocked=true;session.cloudSaveRequested=false;setCloud('ענן: התנגשות','error');return false}
    const currentFlight=state.flight||null,retryRecord=v2RetryRecord(state,currentFlight),retryDelay=outboxRetryScheduler.schedule(retryRecord,()=>requestStorageV2CloudSave(msg,{force}));
    if(retryDelay>0){setCloud('ענן: ממתין למועד הסנכרון');allOk=false;break}
    const flight=currentFlight||await materializeStorageV2CloudFlight();
    if(!flight){setCloud('ענן: מסונכרן','synced');if(msg)toast(msg);continue}
    session.cloudBusy=true;setCloud('ענן: מסנכרן…');
    try{
      const saved=await saveStorageV2CloudFlight(flight);if(!saved){allOk=false;break}
      outboxRetryScheduler.cancel();state=saved.state||state;if(state?.pending||state?.flight)session.cloudSaveRequested=true;
      if(!session.cloudSaveRequested&&!state?.pending&&!state?.flight){setCloud('ענן: מסונכרן','synced');if(msg)toast(msg)}else setCloud('ענן: מסנכרן…')
    }catch(error){
      console.error('cloud save V2',error);state=await refreshStorageV2CloudState();const normalized=normalizeCloudError(error),attempts=Number(state?.control?.retry?.attempts||0)+1,nextAttemptAt=normalized.retryAfterMs?new Date(Date.now()+normalized.retryAfterMs).toISOString():null,retry={attempts,lastErrorCode:normalized.code||normalized.kind,lastAttemptAt:new Date().toISOString(),nextAttemptAt};
      await setStorageV2CloudControl({retry});state=await refreshStorageV2CloudState();outboxRetryScheduler.schedule(v2RetryRecord(state,state?.flight),()=>requestStorageV2CloudSave(msg,{force}));setCloud(navigator.onLine?'ענן: ממתין לסנכרון':'ענן: אופליין',navigator.onLine?'':'offline');allOk=false;break
    }finally{session.cloudBusy=false}
  }return allOk&&!state?.pending&&!state?.flight})().finally(()=>{session.cloudSavePromise=null;if(session.cloudSaveRequested&&navigator.onLine&&!session.cloudConflictBlocked)setTimeout(()=>requestStorageV2CloudSave(session.cloudSaveMessage||'השינויים סונכרנו',{force}),0)});
  return session.cloudSavePromise
}

async function requestCloudSave(message='השינויים סונכרנו',{legacyDrain=false}={}){if(storageV2CloudOutboxActive()&&!legacyDrain)return requestStorageV2CloudSave(message);if(!tab.primaryTab)return false;if(message)session.cloudSaveMessage=message;session.cloudSaveRequested=true;if(!cloudEnabled()&&!legacyDrain)return false;if(session.cloudConflictBlocked){setCloud('ענן: התנגשות','error');return false}if(!navigator.onLine){if(legacyDrain)return false;markCloudPending(prepareCloudState(),message);try{await session.ordersOutboxCommitPromise}catch(e){console.error('orders outbox offline commit',e)}setCloud(session.cloudDurabilityDegraded?'ענן: שמירה מקומית במצב מוגבל':'ענן: אופליין',session.cloudDurabilityDegraded?'error':'offline');return false}if(session.cloudSavePromise)return session.cloudSavePromise;session.cloudSavePromise=(async()=>{let allOk=true;while(session.cloudSaveRequested&&(legacyDrain||cloudEnabled())&&navigator.onLine&&!session.cloudConflictBlocked){session.cloudSaveRequested=false;const msg=session.cloudSaveMessage||'השינויים סונכרנו';session.cloudSaveMessage='';let pending=await getCloudPending();if(!pending){if(legacyDrain)break;if(!markCloudPending(prepareCloudState(),msg))setSave('מקומי: שגיאת pending','error');pending=await getCloudPending()}if(!pending)throw new Error('orders_outbox_persistence_failed');if(pending.conflict){session.cloudConflictBlocked=true;session.cloudSaveRequested=false;setCloud('ענן: התנגשות','error');return false}const retryDelay=legacyDrain?getOutboxRetryDelay(pending):outboxRetryScheduler.schedule(pending,()=>requestCloudSave(msg,{legacyDrain}));if(retryDelay>0){setCloud('ענן: ממתין למועד הסנכרון');allOk=false;break}const startGeneration=Number(pending.generation),snapshot=prepareCloudState(pending.snapshot);session.cloudBusy=true;setCloud(session.cloudDurabilityDegraded?'ענן: מצב התאוששות':'ענן: מסנכרן…',session.cloudDurabilityDegraded?'error':'');try{const ok=await saveCloudSnapshot(snapshot,startGeneration,pending);if(!ok){allOk=false;break}outboxRetryScheduler.cancel();const newer=await getCloudPending();if(newer&&Number(newer.generation)>startGeneration)session.cloudSaveRequested=true;if(!session.cloudSaveRequested&&!newer){setCloud('ענן: מסונכרן','synced');if(msg)toast(msg)}else setCloud('ענן: מסנכרן…')}catch(e){console.error('cloud save',e);const current=await getCloudPending(),normalized=normalizeCloudError(e),attempts=Number(current?.retry?.attempts||0)+1,nextAttemptAt=normalized.retryAfterMs?new Date(Date.now()+normalized.retryAfterMs).toISOString():null;markCloudPending(prepareCloudState(model.state),msg,{retry:{attempts,lastErrorCode:normalized.code||normalized.kind,lastAttemptAt:new Date().toISOString(),nextAttemptAt}});const retryPending=await getCloudPending();if(retryPending&&!legacyDrain)outboxRetryScheduler.schedule(retryPending,()=>requestCloudSave(msg,{legacyDrain}));setCloud(navigator.onLine?'ענן: ממתין לסנכרון':'ענן: אופליין',navigator.onLine?'':'offline');allOk=false;break}finally{session.cloudBusy=false}}return allOk&&!cloudPendingExists()})().finally(()=>{session.cloudSavePromise=null;if(!legacyDrain&&session.cloudSaveRequested&&navigator.onLine&&!session.cloudConflictBlocked)setTimeout(()=>requestCloudSave(session.cloudSaveMessage||'השינויים סונכרנו'),0)});return session.cloudSavePromise}


async function restorePendingAgainstCloud(row){const durable=await getCloudPending(),pendingRaw=durable?.snapshot||loadCloudPendingState()||((session.cloudSaveRequested||!!(session.lastCloudState&&!sameOrderCloudData(model.state,session.lastCloudState)))?clone(model.state):null);if(!pendingRaw)return false;const pending=normalizeState(clone(pendingRaw)),remote=normalizeState(clone(row.state||{})),base=durable?.baseState?normalizeState(clone(durable.baseState)):session.lastCloudState?normalizeState(clone(session.lastCloudState)):null;applyOrderCloudState(pending);if(durable?.conflict){session.cloudConflictBlocked=true;session.cloudSaveRequested=false;localSnapshot();setCloud('ענן: התנגשות — נדרשת הכרעה','error');return true}session.cloudRevision=Number(row.revision||0);session.cloudUpdatedAt=row.updated_at||session.cloudUpdatedAt;if(!base){session.cloudConflictBlocked=true;setCloud('ענן: נדרש שחזור','error');localSnapshot();toast('נמצאו שינויים מקומיים שלא סונכרנו, אך חסרה גרסת הבסיס. הנתונים המקומיים נשמרו ולא נדרסו.');return true}const merged=merge3(base,pending,remote,{deleteIntents:durable?.deleteIntents||{}});if(merged.conflicts.length){session.cloudConflictBlocked=true;session.cloudSaveRequested=false;markCloudPending(prepareCloudState(pending),'',{baseRevision:durable?.baseRevision,baseState:durable?.baseState,conflict:structuredSyncConflict({domain:'orders',conflicts:merged.conflicts,base,local:pending,remote,generation:durable?.generation,baseRevision:durable?.baseRevision,currentRemoteRevision:row.revision})});await session.ordersOutboxCommitPromise;setCloud('ענן: התנגשות','error');localSnapshot();toast('נמצאו שינויים מקומיים ועדכון ענן באותה רשומה. שום נתון לא נדרס.');return true}applyOrderCloudState(merged.state);session.lastCloudState=clone(remote);try{localStorage.setItem(CLOUD_BASE_KEY,JSON.stringify(session.lastCloudState))}catch(error){console.error('cloud base mirror',error)};localSnapshot();markCloudPending(prepareCloudState(model.state),'',{baseRevision:Number(row.revision),baseState:prepareCloudState(remote),deleteIntents:durable?.deleteIntents||{}});session.localGeneration=Math.max(session.localGeneration,1);session.cloudSaveRequested=true;await requestCloudSave('שינויים מקומיים שוחזרו וסונכרנו');return true}

async function cloudPoll(){
  if(storageV2PreparationActive())return;
  if(!tab.primaryTab)return;if(!cloudEnabled()||session.cloudBusy||!navigator.onLine)return;
  if(cloudHasLocalWork()){await requestCloudSave('סונכרנו שינויים מקומיים ועדכון מרחוק');await pollSharedChecks();return}
  let dataApiReadOk=false;
  try{
    session.cloudBusy=true;
    const pollGeneration=Number(session.localGeneration||0),localBefore=prepareCloudState(model.state),meta=await readCloudMeta();dataApiReadOk=true;if(!meta)return;
    const metaRevision=Number(meta.revision||0);
    if(metaRevision<=session.cloudRevision){session.cloudUpdatedAt=meta.updated_at||session.cloudUpdatedAt;refreshCloudTimestamp();return}
    const row=await readCloud();if(!row)return;if(Number(row.revision||0)<=session.cloudRevision)return;
    // A user edit may arrive while the GET is in flight. Never replace that
    // newer local head with a remote row fetched from the earlier generation.
    if(Number(session.localGeneration||0)!==pollGeneration||cloudHasLocalWork()||!sameOrderCloudData(model.state,localBefore)){session.cloudSaveRequested=true;return}
    const rowRevision=Number(row.revision||0),meaningful=!sameOrderCloudData(model.state,row.state);
    session.cloudRevision=rowRevision;session.cloudUpdatedAt=row.updated_at||meta.updated_at||session.cloudUpdatedAt;
    if(!meaningful){
      session.lastCloudState=prepareCloudState(row.state||model.state);
      if(storageV2CloudOutboxActive())await adoptStorageV2CloudHead(rowRevision,model.state);else try{localStorage.setItem(CLOUD_BASE_KEY,JSON.stringify(session.lastCloudState))}catch(error){console.error('cloud base mirror',error)}
      refreshCloudTimestamp();setCloud('ענן: מסונכרן','synced');return
    }
    applyOrderCloudState(row.state);session.lastCloudState=prepareCloudState(model.state);
    if(storageV2CloudOutboxActive())await adoptStorageV2CloudHead(rowRevision,model.state);else{try{localStorage.setItem(CLOUD_BASE_KEY,JSON.stringify(session.lastCloudState))}catch(error){console.error('cloud base mirror',error)}localSnapshot()}
    try{if(files.dirHandle)await writeStateToFolder()}catch(localError){console.error('local backup/mirror',localError)}
    setCloud('ענן: מסונכרן','synced');render();toast('התקבל עדכון מהענן')
  }catch(e){const normalized=normalizeCloudError(e);if(['network','timeout','service_unavailable','rate_limited'].includes(normalized.kind))console.warn('orders cloud poll deferred',e?.message||e);else console.error(e)}
  finally{session.cloudBusy=false;if(dataApiReadOk){await pollSharedChecks();await refreshKupaReadout({renderIfChanged:true})}}
}

function trackedCloudPoll(){if(cloudPollPromise)return cloudPollPromise;cloudPollPromise=cloudPoll().finally(()=>{cloudPollPromise=null});return cloudPollPromise}
function startPolling(){clearTimeout(session.cloudPollTimer);if(storageV2PreparationActive()){session.cloudPollingEnabled=false;session.cloudPollTimer=null;return}session.cloudPollingEnabled=true;const schedule=()=>{if(!session.cloudPollingEnabled||storageV2PreparationActive())return;session.cloudPollTimer=setTimeout(async()=>{try{await trackedCloudPoll()}finally{schedule()}},12_000+Math.floor(Math.random()*2_000))};schedule()}
async function quiesceForStorageCutover(){
  session.cloudPollingEnabled=false;clearTimeout(session.cloudPollTimer);session.cloudPollTimer=null;
  if(session.cloudRecoveryTimer){clearTimeout(session.cloudRecoveryTimer);session.cloudRecoveryTimer=null}
  outboxRetryScheduler.cancel();
  const pending=[cloudPollPromise,session.cloudSavePromise].filter(Boolean);if(pending.length)await Promise.allSettled(pending);
  outboxRetryScheduler.cancel();return true;
}

return { saveCloudSnapshot, requestCloudSave, requestStorageV2CloudSave, restorePendingAgainstCloud, cloudPoll:trackedCloudPoll, startPolling,quiesceForStorageCutover,refreshForMorningRecovery };
}
