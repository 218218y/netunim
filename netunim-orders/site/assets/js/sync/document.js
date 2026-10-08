import {structuredSyncConflict} from '../shared/cloud-sync.js';
import {clone} from '../core/values.js';
import {commitCloudCheckpoint} from '../shared/cloud-checkpoint-publication.js';
import {cloudHeadIsSynced} from '../shared/storage-cloud-status.js';
import {CLOUD_WRITE_POLICY,cloudWriteError,contentionDelay,createOutboxRetryScheduler,documentWriteAckRevision,normalizeCloudError,operationAuditMetadata,runBusyCloudWriteWithPolicy} from '../shared/cloud-sync.js';

function revisionConflict(res){return !res?.r?.ok&&normalizeCloudError(res).kind==='revision_conflict'}
function saveBusy(res){return !res?.r?.ok&&normalizeCloudError(res).kind==='busy'}
function contentionBackoff(attempt=0){return new Promise(resolve=>setTimeout(resolve,contentionDelay(attempt)))}
function normalizeDeleteIntents(value){const out={};if(!value||typeof value!=='object'||Array.isArray(value))return out;for(const [key,ids] of Object.entries(value)){const clean=[...new Set((Array.isArray(ids)?ids:[]).map(x=>String(x||'').trim()).filter(Boolean))].sort();if(clean.length)out[key]=clean}return out}
function collectionRows(state,key){const value=key.split('.').reduce((obj,part)=>obj?.[part],state);return Array.isArray(value)?value:[]}
function effectiveDeleteIntents(base,candidate,intents){const out={},declared=normalizeDeleteIntents(intents);for(const [key,ids] of Object.entries(declared)){const before=collectionRows(base,key),after=collectionRows(candidate,key),keyField=key==='cards'?'name':'id',kept=new Set(after.map(x=>String(x?.[keyField]??'')));const removed=before.map(x=>String(x?.[keyField]??'')).filter(id=>id&&ids.includes(id)&&!kept.has(id)).sort();if(removed.length)out[key]=removed}return out}

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createSyncDocument({model,files,session,tab,toast,setCloud,prepareCloudState,writeStateToFolder,readCloud,rpcSaveV2,merge3,applyOrderCloudState,composeOrderCloudState=(cloud,current)=>({...clone(cloud),checks:clone(current.checks||[])}),cloudEnabled,sameOrderCloudData,cloudHasLocalWork,render,readCloudMeta,refreshKupaReadout,pollSharedChecks,refreshCloudTimestamp,refreshStorageV2CloudState=async()=>null,materializeStorageV2CloudFlight=async()=>null,acknowledgeStorageV2CloudFlight=async()=>null,rejectStorageV2CloudFlight=async()=>null,setStorageV2CloudControl=async()=>null,adoptStorageV2CloudHead=async()=>null,storageV2CommitPromise=()=>Promise.resolve(),storageV2PreparationActive=()=>false}){
const outboxRetryScheduler=createOutboxRetryScheduler();
let cloudPollPromise=null,morningRefreshPromise=null;

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
    if(cloudPollPromise)await cloudPollPromise;
    if(session.cloudSavePromise)await session.cloudSavePromise;
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
      if(Number(session.localGeneration||0)!==generation||session.cloudSavePromise||cloudHasLocalWork()||!sameOrderCloudData(model.state,local))return false;
      if(!await adoptRemoteRow(row,generation,head))return false;
      render();refreshCloudTimestamp();return true;
    }finally{session.cloudBusy=false}
  })().catch(error=>{console.error('Morning recovery cloud refresh',error);return false}).finally(()=>{morningRefreshPromise=null});
  return morningRefreshPromise;
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
  const authoritative=prepareCloudState(res.row?.state||serverSnapshot),newRevision=documentWriteAckRevision(res.row,{baseRevision:flight.baseRevision,authoritativeState:authoritative,sentState:serverSnapshot,equalState:sameOrderCloudData,errorCode:'orders_v2_ack_revision_invalid'}).revision;
  // Reconcile edits that arrived while this immutable flight was in progress
  // before ACK.  ACK + current checkpoint are then committed in one IDB
  // transaction, so a crash cannot advance the cloud cursor without persisting
  // the corresponding rebased local head.
  state=await refreshStorageV2CloudState();
  if(!state?.flight||state.flight.operationId!==flight.operationId)throw new Error('orders_v2_flight_changed_before_ack');
  let currentCloud=authoritative;
  if(state.afterFlightPending){
    const local=prepareCloudState(model.state),rebased=merge3(serverSnapshot,local,authoritative,{deleteIntents:state.afterFlightDeleteIntents||{}});
    if(rebased.conflicts.length){
      const conflict=structuredSyncConflict({domain:'orders',conflicts:rebased.conflicts,base:serverSnapshot,local,remote:authoritative,generation:state.afterFlightGeneration,baseRevision:flight.baseRevision,currentRemoteRevision:newRevision});
      await acknowledgeStorageV2CloudFlight(flight.operationId,newRevision,authoritative,{currentState:model.state,control:{conflict}});
      session.cloudRevision=newRevision;session.cloudUpdatedAt=res.row?.updated_at||session.cloudUpdatedAt;session.lastCloudState=clone(authoritative);session.cloudConflictBlocked=true;session.cloudSaveRequested=false;
      setCloud('ענן: התנגשות','error');return false
    }
    currentCloud=rebased.state;
  }
  const expectedGeneration=Number(session.localGeneration||0),expectedSeq=state.seq,currentState=composeOrderCloudState(currentCloud,model.state);
  const publication=await commitCloudCheckpoint({
    commit:()=>acknowledgeStorageV2CloudFlight(flight.operationId,newRevision,authoritative,{currentState}),
    isCurrent:committed=>tab.primaryTab&&Number(session.localGeneration||0)===expectedGeneration&&committed?.seq===expectedSeq,
    publish:()=>{if(!sameOrderCloudData(model.state,currentCloud))applyOrderCloudState(currentCloud)},
  });
  const committedState=publication.committed;
  session.cloudRevision=newRevision;session.cloudUpdatedAt=res.row?.updated_at||session.cloudUpdatedAt;session.lastCloudState=clone(authoritative);session.cloudConflictBlocked=false;
  if(!publication.published){
    // The sent flight is durably acknowledged, but a newer visible/journal head
    // must not be overwritten or sent with an earlier reconciliation snapshot.
    session.cloudConflictBlocked=true;session.cloudSaveRequested=false;
    if(!tab.primaryTab)return false;
    if(publication.reason==='publication-error')console.error('post-ACK model publication',publication.error);
    await setStorageV2CloudControl({conflict:{kind:publication.reason==='publication-error'?'ack-publication-failed':'concurrent-ack',domain:'orders',baseRevision:flight.baseRevision,currentRemoteRevision:newRevision}});
    setCloud('ענן: הסנכרון נעצר לשמירת שינוי מקביל','error');
    toast(publication.reason==='publication-error'?'אישור הענן נשמר, אבל עדכון הנתונים לתצוגה נכשל. הסנכרון נעצר לבדיקה; הנתונים נשמרו באחסון המקומי.':'שינוי בוצע בזמן שמירת אישור הענן. הנתונים נשמרו מקומית; ייצא גיבוי ובדוק את המצב לפני חידוש הסנכרון.');
    return false;
  }
  try{if(files.dirHandle)await writeStateToFolder()}catch(localError){console.error('local backup/mirror',localError)}
  return {committed:true,state:committedState,generation:expectedGeneration}
}

async function requestStorageV2CloudSave(message='השינויים סונכרנו',{force=false}={}){
  if(!tab.primaryTab)return false;if(message)session.cloudSaveMessage=message;session.cloudSaveRequested=true;if(!force&&!cloudEnabled())return false;
  let state=await refreshStorageV2CloudState();
  if(!state?.base)return false;
  if(state.control?.conflict){session.cloudConflictBlocked=true;session.cloudSaveRequested=false;setCloud('ענן: התנגשות','error');return false}
  if(session.cloudConflictBlocked){setCloud('ענן: התנגשות','error');return false}
  if(!navigator.onLine){try{await storageV2CommitPromise()}catch(error){console.error('orders V2 journal offline commit',error)}setCloud('ענן: אופליין','offline');return false}
  if(session.cloudSavePromise)return session.cloudSavePromise;
  session.cloudSavePromise=(async()=>{let allOk=true;while(tab.primaryTab&&session.cloudSaveRequested&&(force||cloudEnabled())&&navigator.onLine&&!session.cloudConflictBlocked){
    session.cloudSaveRequested=false;const msg=session.cloudSaveMessage||'השינויים סונכרנו';session.cloudSaveMessage='';state=await refreshStorageV2CloudState();
    if(!state?.base){allOk=false;break}
    if(state.control?.conflict){session.cloudConflictBlocked=true;session.cloudSaveRequested=false;setCloud('ענן: התנגשות','error');return false}
    const currentFlight=state.flight||null,retryRecord=v2RetryRecord(state,currentFlight),retryDelay=outboxRetryScheduler.schedule(retryRecord,()=>requestStorageV2CloudSave(msg,{force}));
    if(retryDelay>0){setCloud('ענן: ממתין למועד הסנכרון');allOk=false;break}
    const generation=Number(session.localGeneration||0),flight=currentFlight||await materializeStorageV2CloudFlight();
    if(!flight){if(await confirmCloudPollSynced({generation})){if(msg)toast(msg)}else allOk=false;continue}
    session.cloudBusy=true;setCloud('ענן: מסנכרן…');
    try{
      const saved=await saveStorageV2CloudFlight(flight);if(!saved){allOk=false;break}
      outboxRetryScheduler.cancel();state=saved.state||state;if(state?.pending||state?.flight)session.cloudSaveRequested=true;
      if(markCloudSynced(state,{generation:saved.generation})){if(msg)toast(msg)}else if(state?.pending||state?.flight||session.cloudSaveRequested)setCloud('ענן: מסנכרן…');else allOk=false
    }catch(error){
      console.error('cloud save V2',error);state=await refreshStorageV2CloudState();const normalized=normalizeCloudError(error),attempts=Number(state?.control?.retry?.attempts||0)+1,nextAttemptAt=normalized.retryAfterMs?new Date(Date.now()+normalized.retryAfterMs).toISOString():null,retry={attempts,lastErrorCode:normalized.code||normalized.kind,lastAttemptAt:new Date().toISOString(),nextAttemptAt};
      await setStorageV2CloudControl({retry});state=await refreshStorageV2CloudState();outboxRetryScheduler.schedule(v2RetryRecord(state,state?.flight),()=>requestStorageV2CloudSave(msg,{force}));setCloud(navigator.onLine?'ענן: ממתין לסנכרון':'ענן: אופליין',navigator.onLine?'':'offline');allOk=false;break
    }finally{session.cloudBusy=false}
  }return allOk&&!state?.pending&&!state?.flight})().finally(()=>{session.cloudSavePromise=null;if(session.cloudSaveRequested&&navigator.onLine&&!session.cloudConflictBlocked)setTimeout(()=>requestStorageV2CloudSave(session.cloudSaveMessage||'השינויים סונכרנו',{force}),0)});
  return session.cloudSavePromise
}

const requestCloudSave=requestStorageV2CloudSave;

function pollAccessCurrent(){return !storageV2PreparationActive()&&tab.primaryTab&&cloudEnabled()&&navigator.onLine&&!session.syncCapabilitiesError&&!session.syncCapabilitiesChecking}
function pollViewCurrent({generation,local}={}){return pollAccessCurrent()&&!session.cloudConflictBlocked&&Number(session.localGeneration||0)===generation&&!session.cloudSaveRequested&&!cloudHasLocalWork()&&(!local||sameOrderCloudData(model.state,local))}
function markCloudPollDeferred(head){
  if(storageV2PreparationActive()||!tab.primaryTab||!cloudEnabled())return false;
  if(!navigator.onLine)setCloud('ענן: אופליין','offline');
  else if(head?.control?.conflict||session.cloudConflictBlocked)setCloud('ענן: התנגשות','error');
  else setCloud('ענן: ממתין לסנכרון');
  return false;
}
function markCloudSynced(head,observation){
  if(!pollViewCurrent(observation)||!cloudHeadIsSynced(head,{revision:Number(session.cloudRevision||0),observedHead:observation.head}))return markCloudPollDeferred(head);
  setCloud('ענן: מסונכרן','synced');return true;
}
async function confirmCloudPollSynced(observation,{refreshTimestamp=false}={}){
  const synced=markCloudSynced(await refreshStorageV2CloudState(),observation);
  if(synced&&refreshTimestamp)refreshCloudTimestamp();return synced;
}
function markCloudPollFailure(error){
  const normalized=normalizeCloudError(error),transient=['network','timeout','service_unavailable','rate_limited'].includes(normalized.kind);
  if(!navigator.onLine)setCloud('ענן: אופליין','offline');
  else if(transient)setCloud('ענן: ממתין להתאוששות');
  else setCloud('ענן: שגיאת סנכרון','error');
  if(transient)console.warn('orders cloud poll deferred',error?.message||error);else console.error(error);
  return false
}

async function cloudPoll(){
  if(storageV2PreparationActive()||!tab.primaryTab||!cloudEnabled()||session.cloudBusy||!navigator.onLine)return false;
  if(cloudHasLocalWork()){const saved=await requestCloudSave('סונכרנו שינויים מקומיים ועדכון מרחוק');await pollSharedChecks();return saved}
  let dataApiReadOk=false;
  const observation={generation:Number(session.localGeneration||0),local:prepareCloudState(model.state),head:null};
  let ready=false;
  async function readMain(){
    const head=await refreshStorageV2CloudState();observation.head=head;
    if(!pollViewCurrent(observation)||!cloudHeadIsSynced(head,{revision:Number(session.cloudRevision||0)}))return markCloudPollDeferred(head);
    const meta=await readCloudMeta();dataApiReadOk=true;
    if(!pollViewCurrent(observation))return markCloudPollDeferred();
    if(!meta){setCloud('ענן: מסמך לא נמצא','error');return false}
    const metaRevision=Number(meta.revision||0);
    if(!Number.isSafeInteger(metaRevision)||metaRevision<1)throw new Error('orders_v2_remote_revision_invalid');
    if(metaRevision<=session.cloudRevision){session.cloudUpdatedAt=meta.updated_at||session.cloudUpdatedAt;return true}
    const row=await readCloud();
    if(!pollViewCurrent(observation))return markCloudPollDeferred();
    if(!row){setCloud('ענן: מסמך לא נמצא','error');return false}
    const rowRevision=Number(row.revision||0);
    if(!Number.isSafeInteger(rowRevision)||rowRevision<1)throw new Error('orders_v2_remote_revision_invalid');
    if(rowRevision<=session.cloudRevision){session.cloudUpdatedAt=row.updated_at||meta.updated_at||session.cloudUpdatedAt;return true}
    const meaningful=!sameOrderCloudData(model.state,row.state);
    if(!await adoptRemoteRow(row,observation.generation,head,{applyState:meaningful}))return false;
    // The adopted projection replaces the earlier comparison candidate. Shared
    // checks remain independent; only Main's projection is compared here.
    observation.local=prepareCloudState(model.state);
    if(!meaningful){session.lastCloudState=prepareCloudState(row.state||model.state);return true}
    try{if(files.dirHandle)await writeStateToFolder()}catch(localError){console.error('local backup/mirror',localError)}
    render();toast('התקבל עדכון מהענן');return true;
  }
  try{
    session.cloudBusy=true;
    ready=await readMain();
  }catch(error){return markCloudPollFailure(error)}
  finally{session.cloudBusy=false;if(dataApiReadOk){await pollSharedChecks();await refreshKupaReadout({renderIfChanged:true})}}
  // The final authoritative read occurs after independent hydration too. An edit
  // during any of those awaits cannot publish a stale "synced" assertion.
  if(!ready)return false;
  try{return await confirmCloudPollSynced(observation,{refreshTimestamp:true})}catch(error){return markCloudPollFailure(error)}
}

async function resumeAfterReconnect(){
  if(storageV2PreparationActive()||!tab.primaryTab||!cloudEnabled()||!navigator.onLine)return false;
  if(session.cloudBusy)return trackedCloudPoll();
  setCloud('ענן: חזרה רשת…');
  try{
    if(cloudHasLocalWork()){
      const saved=await requestCloudSave('שינויים ממתינים סונכרנו');
      if(!saved&&cloudHasLocalWork())return false;
    }
    return await trackedCloudPoll()
  }catch(error){return markCloudPollFailure(error)}
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

return { requestCloudSave, requestStorageV2CloudSave, cloudPoll:trackedCloudPoll, resumeAfterReconnect, startPolling,quiesceForStorageCutover,refreshForMorningRecovery };
}
