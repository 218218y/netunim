import {structuredSyncConflict} from '../shared/cloud-sync.js';
import {clone} from '../core/values.js';
import {CLOUD_BASE_KEY} from '../state/constants.js';
import {CLOUD_WRITE_POLICY,cloudWriteError,contentionDelay,createOutboxRetryScheduler,normalizeCloudError,operationAuditMetadata,runBusyCloudWriteWithPolicy} from '../shared/cloud-sync.js';

function revisionConflict(res){return !res?.r?.ok&&normalizeCloudError(res).kind==='revision_conflict'}
function saveBusy(res){return !res?.r?.ok&&normalizeCloudError(res).kind==='busy'}
function contentionBackoff(attempt=0){return new Promise(resolve=>setTimeout(resolve,contentionDelay(attempt)))}
function normalizeDeleteIntents(value){const out={};if(!value||typeof value!=='object'||Array.isArray(value))return out;for(const [key,ids] of Object.entries(value)){const clean=[...new Set((Array.isArray(ids)?ids:[]).map(x=>String(x||'').trim()).filter(Boolean))].sort();if(clean.length)out[key]=clean}return out}
function effectiveDeleteIntents(base,candidate,intents){const out={},declared=normalizeDeleteIntents(intents);for(const [key,ids] of Object.entries(declared)){const before=Array.isArray(base?.[key])?base[key]:[],after=Array.isArray(candidate?.[key])?candidate[key]:[],keyField=key==='cards'?'name':'id',kept=new Set(after.map(x=>String(x?.[keyField]??'')));const removed=before.map(x=>String(x?.[keyField]??'')).filter(id=>id&&ids.includes(id)&&!kept.has(id)).sort();if(removed.length)out[key]=removed}return out}

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createSyncDocument({model, files, session, ui, tab, normalizeState, localSnapshot, markCloudPending, getCloudPending, clearCloudPending, toast, setCloud, prepareCloudState, writeStateToFolder, readCloud, rpcSave, merge3, applyOrderCloudState, cloudPendingExists, setSave, cloudEnabled, loadCloudPendingState, sameOrderCloudData, cloudHasLocalWork, render, readCloudMeta, refreshKupaReadout, pollSharedChecks, refreshCloudTimestamp}){
const outboxRetryScheduler=createOutboxRetryScheduler();
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
      localStorage.setItem(CLOUD_BASE_KEY,JSON.stringify(session.lastCloudState));
      if(localSnapshot()===false)return false;
      render();refreshCloudTimestamp();return true;
    }finally{session.cloudBusy=false}
  })().catch(error=>{console.error('Morning recovery cloud refresh',error);return false}).finally(()=>{morningRefreshPromise=null});
  return morningRefreshPromise;
}
async function saveCloudSnapshot(snapshot,startGeneration,pendingRecord=null){
  let base=clone(pendingRecord?.baseState||session.lastCloudState||snapshot),deleteIntents=normalizeDeleteIntents(pendingRecord?.deleteIntents),expected=Number(pendingRecord?.baseRevision??session.cloudRevision??0),res=null,serverSnapshot=clone(snapshot),mergedRemote=false;
  const operationId=String(pendingRecord?.operationId||'').trim();
  if(!operationId)throw new Error('orders_operation_id_missing');
  for(let conflictAttempt=0;conflictAttempt<CLOUD_WRITE_POLICY.conflictAttempts;conflictAttempt++){
    const exactIntents=effectiveDeleteIntents(base,serverSnapshot,deleteIntents),deleteCount=Object.values(exactIntents).reduce((sum,ids)=>sum+ids.length,0),audit=operationAuditMetadata({site:'orders',mutationType:pendingRecord?.mutationType||'autosave',surface:pendingRecord?.surface||'orders',baseRevision:expected,beforeState:base,afterState:serverSnapshot,collections:['suppliers','transactions','customerDebts','customerOrders','serviceCalls','notes','inventoryItems','inventoryEvents','warehouseOrders'],deleteCount,restoreGroupId:pendingRecord?.restoreGroupId});
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
    const sharedChecks=clone(model.state.checks||[]);model.state=normalizeState(rebased.state);model.state.checks=sharedChecks;
    session.localGeneration=Math.max(Number(session.localGeneration||0),Number(pendingNow?.generation||0))+1;
    localSnapshot();markCloudPending(prepareCloudState(model.state),'',{baseRevision:session.cloudRevision,baseState:authoritative,conflict:null,deleteIntents:pendingNow?.deleteIntents||deleteIntents});await session.ordersOutboxCommitPromise;session.cloudSaveRequested=true
  }
  localSnapshot();try{if(files.dirHandle)await writeStateToFolder()}catch(localError){console.error('local backup/mirror',localError)}return true
}

async function requestCloudSave(message='השינויים סונכרנו'){if(!tab.primaryTab)return false;if(message)session.cloudSaveMessage=message;session.cloudSaveRequested=true;if(!cloudEnabled())return false;if(session.cloudConflictBlocked){setCloud('ענן: התנגשות','error');return false}if(!navigator.onLine){markCloudPending(prepareCloudState(),message);try{await session.ordersOutboxCommitPromise}catch(e){console.error('orders outbox offline commit',e)}setCloud(session.cloudDurabilityDegraded?'ענן: שמירה מקומית במצב מוגבל':'ענן: אופליין',session.cloudDurabilityDegraded?'error':'offline');return false}if(session.cloudSavePromise)return session.cloudSavePromise;session.cloudSavePromise=(async()=>{let allOk=true;while(session.cloudSaveRequested&&cloudEnabled()&&navigator.onLine&&!session.cloudConflictBlocked){session.cloudSaveRequested=false;const msg=session.cloudSaveMessage||'השינויים סונכרנו';session.cloudSaveMessage='';let pending=await getCloudPending();if(!pending){if(!markCloudPending(prepareCloudState(),msg))setSave('מקומי: שגיאת pending','error');pending=await getCloudPending()}if(!pending)throw new Error('orders_outbox_persistence_failed');if(pending.conflict){session.cloudConflictBlocked=true;session.cloudSaveRequested=false;setCloud('ענן: התנגשות','error');return false}const retryDelay=outboxRetryScheduler.schedule(pending,()=>requestCloudSave(msg));if(retryDelay>0){setCloud('ענן: ממתין למועד הסנכרון');allOk=false;break}const startGeneration=Number(pending.generation),snapshot=prepareCloudState(pending.snapshot);session.cloudBusy=true;setCloud(session.cloudDurabilityDegraded?'ענן: מצב התאוששות':'ענן: מסנכרן…',session.cloudDurabilityDegraded?'error':'');try{const ok=await saveCloudSnapshot(snapshot,startGeneration,pending);if(!ok){allOk=false;break}outboxRetryScheduler.cancel();const newer=await getCloudPending();if(newer&&Number(newer.generation)>startGeneration)session.cloudSaveRequested=true;if(!session.cloudSaveRequested&&!newer){setCloud('ענן: מסונכרן','synced');if(msg)toast(msg)}else setCloud('ענן: מסנכרן…')}catch(e){console.error('cloud save',e);const current=await getCloudPending(),normalized=normalizeCloudError(e),attempts=Number(current?.retry?.attempts||0)+1,nextAttemptAt=normalized.retryAfterMs?new Date(Date.now()+normalized.retryAfterMs).toISOString():null;markCloudPending(prepareCloudState(model.state),msg,{retry:{attempts,lastErrorCode:normalized.code||normalized.kind,lastAttemptAt:new Date().toISOString(),nextAttemptAt}});const retryPending=await getCloudPending();if(retryPending)outboxRetryScheduler.schedule(retryPending,()=>requestCloudSave(msg));setCloud(navigator.onLine?'ענן: ממתין לסנכרון':'ענן: אופליין',navigator.onLine?'':'offline');allOk=false;break}finally{session.cloudBusy=false}}return allOk&&!cloudPendingExists()})().finally(()=>{session.cloudSavePromise=null;if(session.cloudSaveRequested&&navigator.onLine&&!session.cloudConflictBlocked)setTimeout(()=>requestCloudSave(session.cloudSaveMessage||'השינויים סונכרנו'),0)});return session.cloudSavePromise}


async function restorePendingAgainstCloud(row){const durable=await getCloudPending(),pendingRaw=durable?.snapshot||loadCloudPendingState()||((session.cloudSaveRequested||!!(session.lastCloudState&&!sameOrderCloudData(model.state,session.lastCloudState)))?clone(model.state):null);if(!pendingRaw)return false;const pending=normalizeState(clone(pendingRaw)),remote=normalizeState(clone(row.state||{})),base=durable?.baseState?normalizeState(clone(durable.baseState)):session.lastCloudState?normalizeState(clone(session.lastCloudState)):null;model.state=pending;if(durable?.conflict){session.cloudConflictBlocked=true;session.cloudSaveRequested=false;localSnapshot();setCloud('ענן: התנגשות — נדרשת הכרעה','error');return true}session.cloudRevision=Number(row.revision||0);session.cloudUpdatedAt=row.updated_at||session.cloudUpdatedAt;if(!base){session.cloudConflictBlocked=true;setCloud('ענן: נדרש שחזור','error');localSnapshot();toast('נמצאו שינויים מקומיים שלא סונכרנו, אך חסרה גרסת הבסיס. הנתונים המקומיים נשמרו ולא נדרסו.');return true}const merged=merge3(base,pending,remote,{deleteIntents:durable?.deleteIntents||{}});if(merged.conflicts.length){session.cloudConflictBlocked=true;session.cloudSaveRequested=false;markCloudPending(prepareCloudState(pending),'',{baseRevision:durable?.baseRevision,baseState:durable?.baseState,conflict:structuredSyncConflict({domain:'orders',conflicts:merged.conflicts,base,local:pending,remote,generation:durable?.generation,baseRevision:durable?.baseRevision,currentRemoteRevision:row.revision})});await session.ordersOutboxCommitPromise;setCloud('ענן: התנגשות','error');localSnapshot();toast('נמצאו שינויים מקומיים ועדכון ענן באותה רשומה. שום נתון לא נדרס.');return true}model.state=normalizeState(merged.state);session.lastCloudState=clone(remote);try{localStorage.setItem(CLOUD_BASE_KEY,JSON.stringify(session.lastCloudState))}catch(error){console.error('cloud base mirror',error)};localSnapshot();markCloudPending(prepareCloudState(model.state),'',{baseRevision:Number(row.revision),baseState:prepareCloudState(remote),deleteIntents:durable?.deleteIntents||{}});session.localGeneration=Math.max(session.localGeneration,1);session.cloudSaveRequested=true;await requestCloudSave('שינויים מקומיים שוחזרו וסונכרנו');return true}

async function cloudPoll(){if(!tab.primaryTab)return;if(!cloudEnabled()||session.cloudBusy||!navigator.onLine)return;if(cloudHasLocalWork()){await requestCloudSave('סונכרנו שינויים מקומיים ועדכון מרחוק');await pollSharedChecks();return}try{session.cloudBusy=true;const meta=await readCloudMeta();if(!meta)return;const metaRevision=Number(meta.revision||0);if(metaRevision<=session.cloudRevision){session.cloudUpdatedAt=meta.updated_at||session.cloudUpdatedAt;refreshCloudTimestamp();return}const row=await readCloud();if(!row)return;if(Number(row.revision||0)<=session.cloudRevision)return;const meaningful=!sameOrderCloudData(model.state,row.state);session.cloudRevision=Number(row.revision);session.cloudUpdatedAt=row.updated_at||meta.updated_at||session.cloudUpdatedAt;if(!meaningful){session.lastCloudState=prepareCloudState(row.state||model.state);try{localStorage.setItem(CLOUD_BASE_KEY,JSON.stringify(session.lastCloudState))}catch(error){console.error('cloud base mirror',error)};refreshCloudTimestamp();setCloud('ענן: מסונכרן','synced');return}applyOrderCloudState(row.state);session.lastCloudState=prepareCloudState(model.state);try{localStorage.setItem(CLOUD_BASE_KEY,JSON.stringify(session.lastCloudState))}catch(error){console.error('cloud base mirror',error)};localSnapshot();try{if(files.dirHandle)await writeStateToFolder()}catch(localError){console.error('local backup/mirror',localError)}setCloud('ענן: מסונכרן','synced');render();toast('התקבל עדכון מהענן')}catch(e){console.error(e)}finally{session.cloudBusy=false;await pollSharedChecks();await refreshKupaReadout({renderIfChanged:true})}}

function trackedCloudPoll(){if(cloudPollPromise)return cloudPollPromise;cloudPollPromise=cloudPoll().finally(()=>{cloudPollPromise=null});return cloudPollPromise}
function startPolling(){clearTimeout(session.cloudPollTimer);session.cloudPollingEnabled=true;const schedule=()=>{if(!session.cloudPollingEnabled)return;session.cloudPollTimer=setTimeout(async()=>{try{await trackedCloudPoll()}finally{schedule()}},12_000+Math.floor(Math.random()*2_000))};schedule()}

return { saveCloudSnapshot, requestCloudSave, restorePendingAgainstCloud, cloudPoll:trackedCloudPoll, startPolling,refreshForMorningRecovery };
}
