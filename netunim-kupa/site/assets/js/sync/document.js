import {beginMeasure} from '../shared/runtime-performance.js';
import {commitCloudCheckpoint} from '../shared/cloud-checkpoint-publication.js';
import {cloudHeadIsSynced} from '../shared/storage-cloud-status.js';
import {createPollingTask} from '../shared/runtime-polling.js';
import {structuredSyncConflict} from '../shared/cloud-sync.js';
import {normalizeSharedChecks} from '../shared/shared-checks-contract.js';
import {assertValidCloudState} from '../state/validation.js';
import {jsonEq} from './merge-records.js';
import {SUPA_AUTO_KEY, STORAGE_PREF_KEY} from '../state/constants.js';
import {CLOUD_WRITE_POLICY,cloudWriteError,contentionDelay,createOutboxRetryScheduler,documentWriteAckRevision,normalizeCloudError,operationAuditMetadata,runBusyCloudWriteWithPolicy} from '../shared/cloud-sync.js';

function revisionConflict(res){return !res?.r?.ok&&normalizeCloudError(res).kind==='revision_conflict'}
function saveBusy(res){return !res?.r?.ok&&normalizeCloudError(res).kind==='busy'}
function contentionBackoff(attempt=0){return new Promise(resolve=>setTimeout(resolve,contentionDelay(attempt)))}
function normalizeDeleteIntents(value){const out={};if(!value||typeof value!=='object'||Array.isArray(value))return out;for(const [key,ids] of Object.entries(value)){const clean=[...new Set((Array.isArray(ids)?ids:[]).map(x=>String(x||'').trim()).filter(Boolean))].sort();if(clean.length)out[key]=clean}return out}
function collectionRows(state,key){if(key==='notesSheet.sheets')return state?.notesSheet?.sheets||[];if(key==='notesSheet.rows')return state?.notesSheet?.rows||[];if(key==='notesSheet.columns')return state?.notesSheet?.columns||[];return state?.[key]||[]}
function canonicalCloudSyncBase(raw,project){
  const base=project(raw);
  // The visible model drops expired credits, but the cloud base must retain
  // their server IDs until a flight with explicit delete intents is ACKed.
  base.credits=structuredClone(raw.credits);
  return base;
}
function effectiveDeleteIntents(base,candidate,intents){const out={},declared=normalizeDeleteIntents(intents);for(const [key,ids] of Object.entries(declared)){const before=Array.isArray(collectionRows(base,key))?collectionRows(base,key):[],after=Array.isArray(collectionRows(candidate,key))?collectionRows(candidate,key):[],kept=new Set(after.map(x=>String(x?.id||''))),removed=before.map(x=>String(x?.id||'')).filter(id=>id&&ids.includes(id)&&!kept.has(id)).sort();if(removed.length)out[key]=removed}return out}

function cloudAudit(pending,before,after,baseRevision,intents){const deletes=Object.values(intents).reduce((sum,ids)=>sum+ids.length,0);return operationAuditMetadata({site:'kupa',mutationType:intents['notesSheet.sheets']?.length||pending?.mutationType==='cloud-normalization'&&deletes?'bulk-delete':pending?.mutationType||'autosave',surface:pending?.surface||'kupa',baseRevision,beforeState:before,afterState:after,collections:['credits','cash','rights','notes','expenses','cards','notesSheet.rows','notesSheet.columns','notesSheet.sheets'],deleteCount:deletes,restoreGroupId:pending?.restoreGroupId})}

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createSyncDocument({hideConnectScreen, reportError, model, session, checksSession, tab, prepareKupaCloudState, applyKupaCloudState, setSaveStatus, setConnectedStatus, setCloudHeaderStatus, listBackups, backupSnapshotToComputer, syncSharedChecksFromCloud, render, readSupabaseDocument, readFinanceSyncDocument=async()=>null, supaRest, mergeKupaCloudState3Way, showSecondaryTabGuard, toast, pollSharedChecks, refreshOrdersFinanceSummary=async()=>false, storageV2CloudOutboxActive=()=>false, refreshStorageV2CloudState=async()=>null, materializeStorageV2CloudFlight=async()=>null, acknowledgeStorageV2CloudFlight=async()=>null, rejectStorageV2CloudFlight=async()=>null, setStorageV2CloudControl=async()=>null, clearStorageV2CloudControl=async()=>false, replaceStorageV2CurrentState=async()=>null, queueStorageV2CloudNormalization=async()=>null, adoptStorageV2CloudHead=async()=>null, resetStorageV2CloudHead=async()=>null, storageV2CommitPromise=()=>Promise.resolve(), storageV2PreparationActive=()=>false, assertAccountOwner=()=>{throw new Error('storage_owner_account_required')}, domainRevisions}){
const outboxRetryScheduler=createOutboxRetryScheduler();
let cloudPollPromise=null;
const cloudPoller=createPollingTask({run:()=>trackedCloudPoll(),delay:()=>12_000+Math.floor(Math.random()*2_000),
  canRun:()=>session.cloudPollingEnabled&&!storageV2PreparationActive(),
  onError:error=>console.error('kupa background cloud poll',error),
  onState:({enabled,timer})=>{session.cloudPollingEnabled=enabled;session.cloudPollTimer=timer}});
function replaceVisibleState(next,{forceAll=false}={}){const previous=model.state;model.state=next;domainRevisions?.reconcile(previous,model.state,{forceAll});return model.state}
function applyKupaCoreState(coreState,checks=model.state.checks,financeSource=model.state){
  const next=structuredClone(coreState&&typeof coreState==='object'?coreState:{}),finance=financeSource&&typeof financeSource==='object'?financeSource:{},coreBank=next.bank&&typeof next.bank==='object'?next.bank:{},financeBank=finance.bank&&typeof finance.bank==='object'?structuredClone(finance.bank):null;
  if(financeBank){
    delete financeBank.adjustments;delete financeBank.snapshotToken;delete financeBank.snapshotSeq;
    if(financeBank.source!=='hapoalim'){delete financeBank.currentBalance;delete financeBank.updatedAt;delete financeBank.asOfDate;delete financeBank.source;delete financeBank.sourceAccount}
    next.bank={...coreBank,...financeBank,adjustments:Array.isArray(coreBank.adjustments)?structuredClone(coreBank.adjustments):[],snapshotToken:coreBank.snapshotToken??null,snapshotSeq:coreBank.snapshotSeq??null};
  }
  if(finance.creditSync&&typeof finance.creditSync==='object')next.creditSync=structuredClone(finance.creditSync);
  return applyKupaCloudState(next,checks)
}
// Compare the full applied state: a canonical cloud projection can hide local
// normalization changes (for example expired legacy rows or numeric strings).
function applyAcknowledgedCoreState(snapshot){
  const next=applyKupaCoreState(snapshot,model.state.checks),changed=!jsonEq(model.state,next);
  if(changed)replaceVisibleState(next);
  return changed;
}
async function applyFinanceOnlyRow(row){
  if(row?.financeAvailable===false)return false;
  const revision=Number(row?.financeRevision);
  if(!Number.isSafeInteger(revision)||revision<1)throw new Error('finance_read_revision_invalid');
  if(revision<=Number(session.financeRevision||0))return false;
  const cloud=await refreshStorageV2CloudState();if(!cloud?.base)throw new Error('kupa_v2_checkpoint_required');
  const generation=Number(session.localGeneration||0),previousRevision=Number(session.financeRevision||0),current=structuredClone(model.state),remote=row.state||{},bank=current.bank||{};
  const financeBank=remote.bank?{...bank,...structuredClone(remote.bank),adjustments:structuredClone(bank.adjustments||[]),snapshotToken:bank.snapshotToken??null,snapshotSeq:bank.snapshotSeq??null}:bank;
  if(bank.source==='manual')for(const key of ['currentBalance','updatedAt','asOfDate','source','sourceAccount'])financeBank[key]=bank[key];
  const normalized=applyKupaCloudState({...current,bank:financeBank,creditSync:remote.creditSync||current.creditSync},current.checks);
  const next={...current,bank:normalized.bank,creditSync:normalized.creditSync};
  if(!jsonEq(prepareKupaCloudState(current),prepareKupaCloudState(next)))throw new Error('finance_hydration_main_changed');
  const publication=await commitCloudCheckpoint({
    commit:()=>replaceStorageV2CurrentState(next,{expectedSeq:cloud.seq}),
    isCurrent:committed=>committed===cloud.seq&&tab.primaryTab&&Number(session.localGeneration||0)===generation&&Number(session.financeRevision||0)===previousRevision,
    publish:()=>{replaceVisibleState(next)},
  });
  if(!publication.published){if(publication.reason==='publication-error')throw publication.error;return false}
  session.financeRevision=revision;session.financeUpdatedAt=row.financeUpdatedAt||session.financeUpdatedAt||null;
  render();return true;
}

async function pollIndependentFinance(){
  try{
    const row=await readFinanceSyncDocument();if(!row)return false;
    return await applyFinanceOnlyRow({state:row.state,financeRevision:row.revision,financeUpdatedAt:row.updated_at});
  }catch(error){console.warn('Independent Finance hydration deferred; Kupa local work retained',error);return false}
}

async function reviewCleanConflict(cloud){
  const conflict=cloud.control?.conflict;
  // This fence records a dirty projection, not a server rejection or an ACK
  // failure. Only its disproved condition can be retired automatically.
  if(conflict?.kind!=='storage-v2-dirty-head'||conflict.domain!=='kupa'||cloud.pending||cloud.flight||!cloud.base||!jsonEq(prepareKupaCloudState(model.state),cloud.base.state))return cloud;
  try{
    const cleared=await clearStorageV2CloudControl({onlyIfClean:{kind:conflict.kind,seq:cloud.seq,baseRevision:cloud.base.revision}});
    if(!cleared)return cloud;
    const current=await refreshStorageV2CloudState();session.cloudConflictPending=!!current?.control?.conflict;return current;
  }catch(error){console.warn('Kupa conflict review deferred; local journal retained',error);return cloud}
}
async function applyCloudRow(row,{renderNow=true}={}){
  const currentV2=await refreshStorageV2CloudState();
  if(!currentV2?.base)throw new Error('kupa_v2_account_head_initialization_required');
  if(!storageV2CloudOutboxActive())throw new Error('kupa_v2_account_head_not_ready');
  assertAccountOwner();
  if(currentV2.pending||currentV2.flight||currentV2.control)throw new Error('kupa_v2_cloud_pending_during_authoritative_apply');
  const revision=Number(row?.revision),generation=Number(session.localGeneration||0),financeRevision=Number(session.financeRevision||0);
  if(!Number.isSafeInteger(revision)||revision<1||revision<currentV2.base.revision)throw new Error('kupa_v2_remote_revision_invalid');
  const legacyCards=Array.isArray(row?.state?.cards)&&row.state.cards.some(card=>typeof card?.id!=='string'||!card.id.trim()),financeAvailable=row?.financeAvailable!==false&&Number(row.financeRevision||0)>=financeRevision;
  const next=financeAvailable?applyKupaCloudState(row.state,model.state.checks):applyKupaCoreState(row.state,model.state.checks,model.state);
  const removed=model.lastNormalizeRemovedCredits,normalizationBase=canonicalCloudSyncBase(row.state,prepareKupaCloudState);
  const publication=await commitCloudCheckpoint({
    commit:()=>adoptStorageV2CloudHead(revision,next,{cloudState:normalizationBase,expectedHead:{seq:currentV2.seq,baseRevision:currentV2.base.revision}}),
    isCurrent:committed=>{assertAccountOwner();return committed?.seq===currentV2.seq&&committed?.revision===revision&&!committed.pending&&!committed.control&&tab.primaryTab&&storageV2CloudOutboxActive()&&Number(session.localGeneration||0)===generation},
    // Shared Checks owns its own journal and can advance while Main commits.
    publish:()=>{next.checks=normalizeSharedChecks(model.state.checks);replaceVisibleState(Number(session.financeRevision||0)===financeRevision?next:applyKupaCoreState(next,model.state.checks,model.state))},
  });
  if(!publication.published){
    if(tab.primaryTab&&storageV2CloudOutboxActive()){
      session.cloudConflictPending=true;
      if(!publication.committed?.control?.conflict)await setStorageV2CloudControl({conflict:{kind:publication.reason==='publication-error'?'cloud-publication-failed':'concurrent-hydration',domain:'kupa',baseRevision:currentV2.base.revision,currentRemoteRevision:revision}});
      setSaveStatus('הנתונים נשמרו מקומית; נדרשת בדיקת סנכרון','error');setCloudHeaderStatus('conflict','ענן: נדרשת בדיקה');
    }
    if(publication.reason==='publication-error')throw publication.error;
    throw new Error('cloud_hydration_publication_stale');
  }
  session.dbRevision=revision;session.lastSavedSnapshot=JSON.stringify(normalizationBase);
  if(financeAvailable&&Number(session.financeRevision||0)===financeRevision){session.financeRevision=Number(row.financeRevision||0);session.financeUpdatedAt=row.financeUpdatedAt||session.financeUpdatedAt||null}
  session.connectionMode='supabase';session.backendReady=true;session.cloudConflictPending=false;
  session.serverInfo={...session.serverInfo,schemaVersion:6,lastSavedAt:row.coreUpdatedAt||session.serverInfo?.lastSavedAt||null,databaseFile:'Supabase'};
  const v2Normalization=removed>0||legacyCards;
  if(v2Normalization)await queueStorageV2CloudNormalization(model.state,revision);
  localStorage.setItem(STORAGE_PREF_KEY,'supabase');localStorage.setItem(SUPA_AUTO_KEY,'1');session.cloudAuthNoDocument=false;hideConnectScreen();
  if(renderNow)render();
  // Secondary hydration must not prevent Main's checkpoint from committing.
  // Its failure remains visible to the caller and is retried by the next poll.
  startCloudPolling();
  await syncSharedChecksFromCloud({quiet:true,required:true});
  await refreshOrdersFinanceSummary({force:true,renderIfChanged:false});
  try{session.serverInfo.backups=await listBackups();await backupSnapshotToComputer(model.state,revision)}catch(error){console.error('post-hydration local backup',error)}
  assertAccountOwner();
  setConnectedStatus('Supabase מחובר');
  if(Number(session.localGeneration||0)!==generation||v2Normalization){setSaveStatus('שינוי שמור מקומית וממתין לסנכרון','saving');setCloudHeaderStatus('syncing','ענן: מסנכרן…')}
  else{setSaveStatus('מסונכרן לענן','ok');setCloudHeaderStatus('synced','ענן: מסונכרן')}
  if(v2Normalization)void requestStorageV2CloudSave().catch(error=>console.error('Kupa cloud normalization sync',error));
  return model.state;
}

async function loadSupabaseState({discardLocalV2=false}={}){
  let v2=await refreshStorageV2CloudState();
  if(discardLocalV2&&v2?.base&&(v2.pending||v2.flight||v2.control)){const row=await readSupabaseDocument();if(!row)throw new Error('מסמך הענן לא נמצא');const next=applyKupaCoreState(row.state,model.state.checks,model.state);replaceVisibleState(next,{forceAll:true});await resetStorageV2CloudHead(Number(row.revision||0),model.state);session.dbRevision=Number(row.revision||0);session.lastSavedSnapshot=JSON.stringify(prepareKupaCloudState(row.state));session.cloudConflictPending=false;v2=await refreshStorageV2CloudState();return applyCloudRow(row)}
  if(storageV2CloudOutboxActive()&&(v2?.pending||v2?.flight||v2?.control)){session.connectionMode='supabase';session.backendReady=true;hideConnectScreen();await requestStorageV2CloudSave('שינויים מקומיים שוחזרו וסונכרנו');return model.state}
  const row=await readSupabaseDocument();
  if(!row)throw new Error('מסמך הענן לא נמצא');
  return applyCloudRow(row)
}

async function rpcSaveCloudV2(snapshot,expectedRevision,operationId,deleteIntents={},audit={}){
  const ackDone=beginMeasure('kupa:cloud-ack');
  assertValidCloudState(snapshot,'Kupa V2 cloud state');
  const expected=Number(expectedRevision||0),op=String(operationId||'').trim();
  if(!Number.isSafeInteger(expected)||expected<0)throw new Error('kupa_v2_revision_invalid');
  if(!op)throw new Error('kupa_v2_operation_id_missing');
  const rpc=audit?.mutationType==='bulk-delete'?'bulk_delete_save_kupa_document_v6':'save_kupa_document_v6';
  const r=await supaRest('/rest/v1/rpc/'+rpc,{method:'POST',networkRetry:true,dataPriority:'high',body:JSON.stringify({p_document_name:session.cloudDocumentName,p_expected_revision:expected,p_state:snapshot,p_operation_id:op,p_delete_intents:deleteIntents,p_audit:audit})});
  const body=await r.text();let j;try{j=body?JSON.parse(body):null}catch{j=null}
  if(r.ok)ackDone();
  return {r,j,body,row:Array.isArray(j)?j[0]:j};
}

function v2RetryRecord(state,flight=null){return {domain:'kupa',documentName:`${session.cloudDocumentName||'main'}-v2`,generation:Number(flight?.generation??state?.pendingGeneration??0),operationId:String(flight?.operationId||'kupa-v2'),retry:state?.control?.retry||null}}

async function saveStorageV2CloudFlight(initialFlight){
  let state=await refreshStorageV2CloudState(),flight=initialFlight||state?.flight;if(!state?.base||!flight)throw new Error('kupa_v2_flight_missing');
  // Keep the exact adopted cloud base here. Re-normalizing it would drop
  // expired legacy credit IDs before effectiveDeleteIntents can send them to
  // the server's delete-intent guard.
  let base=structuredClone(state.base.state),serverSnapshot=prepareKupaCloudState(flight.snapshot),expected=Number(flight.baseRevision),res=null;
  for(let attempt=0;attempt<CLOUD_WRITE_POLICY.conflictAttempts;attempt++){
    const deleteIntents=normalizeDeleteIntents(flight.deleteIntents),exactIntents=effectiveDeleteIntents(base,serverSnapshot,deleteIntents);session.cloudWriteBusy=true;res=await runBusyCloudWriteWithPolicy(()=>rpcSaveCloudV2(serverSnapshot,expected,flight.operationId,exactIntents,cloudAudit(flight,base,serverSnapshot,expected,exactIntents)));session.cloudWriteBusy=false;
    if(saveBusy(res))throw new Error('save_busy');if(!revisionConflict(res))break;
    await contentionBackoff(attempt);const remote=await readSupabaseDocument();if(!remote?.state)throw new Error('מסמך הענן לא נמצא בזמן פתרון התנגשות');const remoteRevision=Number(remote.revision||0);if(!Number.isSafeInteger(remoteRevision)||remoteRevision<=expected)throw new Error('kupa_v2_rebase_revision_invalid');const remoteState=canonicalCloudSyncBase(remote.state,prepareKupaCloudState),merged=mergeKupaCloudState3Way(base,serverSnapshot,remoteState,{deleteIntents});
    state=await refreshStorageV2CloudState();if(!state?.flight||state.flight.operationId!==flight.operationId)throw new Error('kupa_v2_flight_changed_before_rebase');const expectedSeq=state.seq;
    if(merged.conflicts.length){const conflict=structuredSyncConflict({domain:'kupa',conflicts:merged.conflicts,base,local:serverSnapshot,remote:remoteState,generation:flight.generation,baseRevision:expected,currentRemoteRevision:remoteRevision});await rejectStorageV2CloudFlight(flight.operationId,remoteRevision,remoteState,{currentState:model.state,expectedSeq,control:{conflict}});session.dbRevision=remoteRevision;session.lastSavedSnapshot=JSON.stringify(remoteState);session.serverInfo.lastSavedAt=remote.coreUpdatedAt||session.serverInfo.lastSavedAt||null;session.cloudConflictPending=true;setSaveStatus('התנגשות שמורה מקומית','error');setCloudHeaderStatus('conflict','ענן: התנגשות');reportError('הסנכרון נעצר: אותה רשומה שונתה במקביל בשני מקומות. השינוי המקומי נשמר ולא נדרס.');return false}
    const throughSeq=Number(flight.endSeq),previousOperationId=flight.operationId;let currentCore=merged.state;
    if(state.afterFlightPending){const localCore=prepareKupaCloudState(model.state),rebased=mergeKupaCloudState3Way(serverSnapshot,localCore,merged.state,{deleteIntents:state.afterFlightDeleteIntents||{}});if(rebased.conflicts.length){const conflict=structuredSyncConflict({domain:'kupa',conflicts:rebased.conflicts,base:serverSnapshot,local:localCore,remote:merged.state,generation:state.afterFlightGeneration,baseRevision:expected,currentRemoteRevision:remoteRevision});await rejectStorageV2CloudFlight(previousOperationId,remoteRevision,remoteState,{currentState:model.state,expectedSeq,control:{conflict}});session.cloudConflictPending=true;setSaveStatus('התנגשות שמורה מקומית','error');setCloudHeaderStatus('conflict','ענן: התנגשות');return false}currentCore=rebased.state}
    const expectedGeneration=Number(session.localGeneration||0),rebasedCurrent=applyKupaCoreState(currentCore,model.state.checks,model.state);
    await rejectStorageV2CloudFlight(previousOperationId,remoteRevision,remoteState,{currentState:rebasedCurrent,expectedSeq});
    // A user edit may commit while the rebase transaction is in flight.
    // Keep the visible edit and block another send until the recovered head is
    // inspected, rather than replacing it with an older merged snapshot.
    const postRebase=await refreshStorageV2CloudState();
    if(postRebase?.seq!==expectedSeq||Number(session.localGeneration||0)!==expectedGeneration){
      await setStorageV2CloudControl({conflict:{kind:'concurrent-rebase',domain:'kupa',baseRevision:expected,currentRemoteRevision:remoteRevision}});
      session.cloudConflictPending=true;setSaveStatus('שינוי מקביל נשמר מקומית; הסנכרון נעצר לבדיקה','error');setCloudHeaderStatus('conflict','ענן: נדרשת בדיקה');
      reportError('שינוי בוצע בזמן מיזוג הענן. הנתונים נשמרו מקומית; ייצא גיבוי JSON ובדוק את המצב לפני חידוש הסנכרון.');
      return false;
    }
    if(!jsonEq(model.state,rebasedCurrent)){replaceVisibleState(rebasedCurrent);render()}
    base=remoteState;serverSnapshot=prepareKupaCloudState(merged.state);expected=remoteRevision;flight=await materializeStorageV2CloudFlight({throughSeq,snapshot:serverSnapshot});if(!flight||flight.operationId===previousOperationId)throw new Error('kupa_v2_rebase_flight_not_rotated')
  }
  if(!res?.r?.ok)throw cloudWriteError(res,'שמירה לענן נכשלה');const authoritative=prepareKupaCloudState(res.row?.state||serverSnapshot),newRevision=documentWriteAckRevision(res.row,{baseRevision:flight.baseRevision,authoritativeState:authoritative,sentState:serverSnapshot,equalState:jsonEq,errorCode:'kupa_v2_ack_revision_invalid'}).revision;
  state=await refreshStorageV2CloudState();if(!state?.flight||state.flight.operationId!==flight.operationId)throw new Error('kupa_v2_flight_changed_before_ack');
  let currentCore=authoritative;
  if(state.afterFlightPending){
    const local=prepareKupaCloudState(model.state),rebased=mergeKupaCloudState3Way(serverSnapshot,local,authoritative,{deleteIntents:state.afterFlightDeleteIntents||{}});
    if(rebased.conflicts.length){const conflict=structuredSyncConflict({domain:'kupa',conflicts:rebased.conflicts,base:serverSnapshot,local,remote:authoritative,generation:state.afterFlightGeneration,baseRevision:flight.baseRevision,currentRemoteRevision:newRevision});await acknowledgeStorageV2CloudFlight(flight.operationId,newRevision,authoritative,{currentState:model.state,control:{conflict}});session.dbRevision=newRevision;session.lastSavedSnapshot=JSON.stringify(authoritative);session.cloudConflictPending=true;setSaveStatus('התנגשות שמורה מקומית','error');setCloudHeaderStatus('conflict','ענן: התנגשות');return false}
    currentCore=rebased.state;
  }
  const reconcile=state.afterFlightPending||!jsonEq(prepareKupaCloudState(model.state),authoritative);
  const expectedGeneration=Number(session.localGeneration||0),expectedSeq=state.seq,currentState=reconcile?applyKupaCoreState(currentCore,model.state.checks,model.state):structuredClone(model.state);
  let businessChanged=false;
  const publication=await commitCloudCheckpoint({
    commit:()=>acknowledgeStorageV2CloudFlight(flight.operationId,newRevision,authoritative,{currentState}),
    isCurrent:committed=>tab.primaryTab&&Number(session.localGeneration||0)===expectedGeneration&&committed?.seq===expectedSeq,
    publish:()=>{if(reconcile)businessChanged=applyAcknowledgedCoreState(currentCore)},
  });
  const committedState=publication.committed;
  session.dbRevision=newRevision;session.lastSavedSnapshot=JSON.stringify(authoritative);session.serverInfo.lastSavedAt=res.row?.updated_at||res.row?.coreUpdatedAt||session.serverInfo.lastSavedAt||null;session.cloudConflictPending=false;
  if(!publication.published){
    session.cloudConflictPending=true;
    if(!tab.primaryTab)return false;
    if(publication.reason==='publication-error')console.error('post-ACK model publication',publication.error);
    await setStorageV2CloudControl({conflict:{kind:publication.reason==='publication-error'?'ack-publication-failed':'concurrent-ack',domain:'kupa',baseRevision:flight.baseRevision,currentRemoteRevision:newRevision}});
    setSaveStatus('שינוי מקביל נשמר מקומית; הסנכרון נעצר לבדיקה','error');setCloudHeaderStatus('conflict','ענן: נדרשת בדיקה');
    reportError(publication.reason==='publication-error'?'אישור הענן נשמר, אבל עדכון הנתונים לתצוגה נכשל. הסנכרון נעצר לבדיקה; הנתונים נשמרו באחסון המקומי.':'שינוי בוצע בזמן שמירת אישור הענן. הנתונים נשמרו מקומית; ייצא גיבוי JSON ובדוק את המצב לפני חידוש הסנכרון.');
    return false;
  }
  if(businessChanged)try{render()}catch(error){console.error('post-ACK render',error)}
  try{await backupSnapshotToComputer(model.state,session.dbRevision)}catch(error){console.error('post-ACK local backup',error)}
  return {committed:true,state:committedState};
}

async function requestStorageV2CloudSave(message='הקופה סונכרנה לענן',{force=false}={}){
  if(!tab.primaryTab){showSecondaryTabGuard();return false}if(!force&&(session.connectionMode!=='supabase'||!session.backendReady))return false;let state=await refreshStorageV2CloudState();if(!state?.base)return false;if(state.control?.conflict){session.cloudConflictPending=true;setSaveStatus('התנגשות שמורה מקומית','error');setCloudHeaderStatus('conflict','ענן: התנגשות');return false}
  if(!navigator.onLine){try{await storageV2CommitPromise()}catch(error){console.error('kupa V2 journal offline commit',error)}setSaveStatus('אופליין — שינוי שמור מקומית וממתין','saving');setCloudHeaderStatus('offline','ענן: אופליין');return false}
  if(session.storageV2CloudSavePromise)return session.storageV2CloudSavePromise;
  const scope=state;let followup=false;
  session.storageV2CloudSavePromise=(async()=>{
    while(cloudConfirmationAccess(force)&&!session.cloudConflictPending){
      const generation=Number(session.localGeneration||0);
      state=await refreshStorageV2CloudState();
      if(!cloudConfirmationAccess(force)||!sameCloudScope(state,scope))return false;
      if(state.control?.conflict){session.cloudConflictPending=true;return false}
      const currentFlight=state.flight||null,retryDelay=outboxRetryScheduler.schedule(v2RetryRecord(state,currentFlight),()=>requestStorageV2CloudSave(message,{force}));
      if(retryDelay>0){setSaveStatus('ממתין למועד הסנכרון שהשרת קבע','saving');setCloudHeaderStatus('syncing','ענן: ממתין לסנכרון');return false}
      const flight=currentFlight||await materializeStorageV2CloudFlight();
      if(!flight){
        const confirmation=await confirmCloudSynced(generation,state,{force});
        followup=confirmation.advanced&&sameCloudScope(confirmation.head,scope);
        if(confirmation.synced&&message)toast(message);
        return confirmation.synced;
      }
      if(!cloudConfirmationAccess(force)||!sameCloudScope({base:flight},scope))return false;
      session.cloudSyncBusy=true;setSaveStatus('מסנכרן…','saving');setCloudHeaderStatus('syncing','ענן: מסנכרן…');
      try{
        const saved=await saveStorageV2CloudFlight(flight);if(!saved)return false;
        outboxRetryScheduler.cancel();
        const confirmation=await confirmCloudSynced(generation,saved.state,{force});
        if(confirmation.synced){if(message)toast(message);return true}
        // Continue the existing drain only for work represented in the ACK
        // receipt. A later edit/backup completion belongs to the next wakeup.
        if(saved.state?.pending&&cloudConfirmationAccess(force)&&sameCloudScope(confirmation.head,scope)&&!confirmation.head?.control)continue;
        followup=confirmation.advanced&&sameCloudScope(confirmation.head,scope);
        return false;
      }catch(error){
        console.error('kupa cloud save V2',error);
        if(!cloudScopeAccess(force))return false;
        state=await refreshStorageV2CloudState();if(!cloudScopeAccess(force)||!sameCloudScope(state,scope))return false;
        const normalized=normalizeCloudError(error),attempts=Number(state?.control?.retry?.attempts||0)+1,nextAttemptAt=normalized.retryAfterMs?new Date(Date.now()+normalized.retryAfterMs).toISOString():null,retry={attempts,lastErrorCode:normalized.code||normalized.kind,lastAttemptAt:new Date().toISOString(),nextAttemptAt};
        await setStorageV2CloudControl({retry});state=await refreshStorageV2CloudState();
        if(!cloudScopeAccess(force)||!sameCloudScope(state,scope))return false;
        outboxRetryScheduler.schedule(v2RetryRecord(state,state?.flight),()=>requestStorageV2CloudSave(message,{force}));
        setSaveStatus(navigator.onLine?'ממתין לסנכרון':'אופליין — שינוי שמור מקומית','saving');setCloudHeaderStatus(navigator.onLine?'syncing':'offline',navigator.onLine?'ענן: ממתין לסנכרון':'ענן: אופליין');return false;
      }finally{session.cloudSyncBusy=false;session.cloudWriteBusy=false}
    }
    return false;
  })().finally(()=>{
    session.storageV2CloudSavePromise=null;
    // Consume a newer generation through the existing owner, after clearing the
    // joined promise. Explicitly stopped/denied owners cannot be restarted here.
    if(followup&&session.cloudPollingEnabled&&cloudConfirmationAccess(force))void cloudPoller.wake();
  });return session.storageV2CloudSavePromise
}

async function persistSupabaseState(_snapshot,msg){
  if(!tab.primaryTab){showSecondaryTabGuard();return false}
  if(!storageV2CloudOutboxActive())throw new Error('kupa_v2_account_head_required');
  try{await storageV2CommitPromise()}
  catch(error){console.error('kupa V2 journal commit before cloud save',error);setSaveStatus('השינוי לא נשמר באחסון המקומי — אין לסגור את החלון','error');setCloudHeaderStatus('conflict','ענן: נדרש שחזור אחסון מקומי');return false}
  return requestStorageV2CloudSave(msg);
}

function pollAccessCurrent(){return !storageV2PreparationActive()&&tab.primaryTab&&navigator.onLine&&session.connectionMode==='supabase'&&session.backendReady&&storageV2CloudOutboxActive()&&!session.syncCapabilitiesError&&!session.syncCapabilitiesChecking}
function cloudScopeAccess(force=false){
  if(storageV2PreparationActive()||session.storageProtocolBlocked||!tab.primaryTab||!storageV2CloudOutboxActive()||session.syncCapabilitiesError||session.syncCapabilitiesChecking||(!force&&(session.connectionMode!=='supabase'||!session.backendReady)))return false;
  try{assertAccountOwner();return true}catch(error){console.warn('Kupa cloud confirmation denied by account fence',error);return false}
}
function cloudConfirmationAccess(force=false){return navigator.onLine&&cloudScopeAccess(force)}
function sameCloudScope(head,observedHead){return !!head?.base&&!!observedHead?.base&&head.base.owner===observedHead.base.owner&&head.base.epoch===observedHead.base.epoch}
async function confirmCloudSynced(generation,observedHead,{force=false}={}){
  let head;
  try{head=await refreshStorageV2CloudState()}catch(error){
    if(cloudScopeAccess(force))markCloudPollFailure(error);else console.warn('Kupa cloud confirmation read deferred after access loss',error);
    return {synced:false,head:null,advanced:false};
  }
  if(!cloudConfirmationAccess(force)||!sameCloudScope(head,observedHead)){
    if(!navigator.onLine&&cloudScopeAccess(force)&&sameCloudScope(head,observedHead)){setSaveStatus('אופליין — שינוי שמור מקומית וממתין','saving');setCloudHeaderStatus('offline','ענן: אופליין')}
    return {synced:false,head,advanced:false};
  }
  const advanced=Number(session.localGeneration||0)!==generation||head.seq!==observedHead.seq;
  if(advanced||session.cloudConflictPending||!cloudHeadIsSynced(head,{revision:Number(session.dbRevision||0),observedHead})||!jsonEq(prepareKupaCloudState(model.state),head.base.state)){
    if(head?.control?.conflict||session.cloudConflictPending)setCloudHeaderStatus('conflict','ענן: התנגשות');
    else{setSaveStatus('שינוי שמור מקומית וממתין לסנכרון','saving');setCloudHeaderStatus('syncing','ענן: ממתין לסנכרון')}
    return {synced:false,head,advanced};
  }
  setSaveStatus?.('מסונכרן לענן','ok');setCloudHeaderStatus?.('synced','ענן: מסונכרן');return {synced:true,head,advanced:false};
}
async function markCloudPollSynced(generation,observedHead){return (await confirmCloudSynced(generation,observedHead)).synced}
function markCloudPollFailure(error){
  const normalized=normalizeCloudError(error),transient=['network','timeout','service_unavailable','rate_limited'].includes(normalized.kind);
  if(!navigator.onLine){setSaveStatus?.('אופליין — שינויים יישמרו מקומית','saving');setCloudHeaderStatus?.('offline','ענן: אופליין')}
  else if(transient){setSaveStatus?.('ממתין לחידוש חיבור הענן','saving');setCloudHeaderStatus?.('syncing','ענן: ממתין להתאוששות')}
  else{setSaveStatus?.('בדיקת הענן נכשלה','error');setCloudHeaderStatus?.('conflict','ענן: שגיאת סנכרון')}
  if(transient)console.warn('cloud poll deferred',error?.message||error);else console.error('cloud poll',error);
  return false
}

async function cloudPoll(){
  if(storageV2PreparationActive()||!tab.primaryTab||session.connectionMode!=='supabase'||!session.backendReady||!navigator.onLine)return false;
  if(session.cloudSyncBusy||session.cloudWriteBusy){await pollSharedChecks();return false}
  let v2=await refreshStorageV2CloudState();
  if(!storageV2CloudOutboxActive()){setSaveStatus('ראש ענן V2 חסר — הסנכרון נעצר','error');setCloudHeaderStatus('conflict','ענן: נדרש שחזור אחסון מקומי');return false}
  if(v2?.control?.conflict)v2=await reviewCleanConflict(v2);
  if(!tab.primaryTab||!v2?.base||!storageV2CloudOutboxActive())return false;
  if(v2?.control?.conflict){session.cloudConflictPending=true;setCloudHeaderStatus('conflict','ענן: התנגשות');await pollIndependentFinance();await pollSharedChecks();return false}
  if(v2?.pending||v2?.flight){const generation=Number(session.localGeneration||0),saved=await requestStorageV2CloudSave();await pollIndependentFinance();await pollSharedChecks();return saved&&await markCloudPollSynced(generation,v2)}
  if(session.cloudConflictPending){await pollIndependentFinance();await pollSharedChecks();return false}
  const pollGeneration=Number(session.localGeneration||0),pollHead=v2,localBefore=prepareKupaCloudState(model.state);
  try{
    session.cloudSyncBusy=true;const row=await readSupabaseDocument();
    if(!pollAccessCurrent())return false;
    assertAccountOwner();
    if(!row){setSaveStatus('מסמך הענן אינו זמין','error');setCloudHeaderStatus('auth','ענן: מסמך לא נמצא');return false}
    v2=await refreshStorageV2CloudState();const localAdvanced=Number(session.localGeneration||0)!==pollGeneration||!!(v2?.pending||v2?.flight)||!jsonEq(localBefore,prepareKupaCloudState(model.state));
    if(!pollAccessCurrent())return false;
    if(v2?.control){if(v2.control.conflict)setCloudHeaderStatus('conflict','ענן: התנגשות');return false}
    if(localAdvanced){session.cloudSyncBusy=false;await requestStorageV2CloudSave();return false}
    const kupaChanged=Number(row.revision||0)>Number(session.dbRevision||0),financeChanged=!!row&&Number(row.financeRevision||0)>Number(session.financeRevision||0);
    if(!kupaChanged&&financeChanged){if(!await applyFinanceOnlyRow(row))return false}
    if(kupaChanged){
      const base=v2?.base?.state,clean=!!base&&jsonEq(prepareKupaCloudState(model.state),base);
      if(clean){await applyCloudRow(row);toast('התקבל עדכון ממחשב אחר')}
      else{
      const conflict={kind:'storage-v2-dirty-head',domain:'kupa',message:'Local state differs from its cloud base without a pending journal operation',baseRevision:Number(v2?.base?.revision||session.dbRevision||0),currentRemoteRevision:Number(row.revision||0),at:new Date().toISOString()};
      await setStorageV2CloudControl({conflict});session.cloudConflictPending=true;
      setSaveStatus('התנגשות באחסון המקומי','error');setCloudHeaderStatus('conflict','ענן: התנגשות');return false;
      }
    }
  }catch(error){return markCloudPollFailure(error)}finally{session.cloudSyncBusy=false;await Promise.all([pollSharedChecks(),refreshOrdersFinanceSummary({renderIfChanged:true})])}
  try{return await markCloudPollSynced(pollGeneration,pollHead)}catch(error){return markCloudPollFailure(error)}
}

async function resumeAfterReconnect(){
  if(storageV2PreparationActive()||!tab.primaryTab||session.connectionMode!=='supabase'||!session.backendReady||!navigator.onLine)return false;
  if(session.cloudSyncBusy||session.cloudWriteBusy)return trackedCloudPoll();
  setSaveStatus('חזרה רשת — מסנכרן…','saving');setCloudHeaderStatus('syncing','ענן: חזרה רשת…');
  try{return await trackedCloudPoll()}catch(error){return markCloudPollFailure(error)}
}

function trackedCloudPoll(){if(cloudPollPromise)return cloudPollPromise;cloudPollPromise=cloudPoll().finally(()=>{cloudPollPromise=null});return cloudPollPromise}
function startCloudPolling(){return cloudPoller.start()}
function stopCloudPolling(){return cloudPoller.stop()}
async function quiesceForStorageCutover(){
  stopCloudPolling();
  if(session.cloudRecoveryTimer){clearTimeout(session.cloudRecoveryTimer);session.cloudRecoveryTimer=null}
  outboxRetryScheduler.cancel();
  if(cloudPollPromise)await Promise.allSettled([cloudPollPromise]);
  const deadline=Date.now()+30_000;
  while(session.cloudWriteBusy||session.cloudSyncBusy){if(Date.now()>=deadline)throw new Error('storage_cutover_cloud_busy');await new Promise(resolve=>setTimeout(resolve,25))}
  outboxRetryScheduler.cancel();return true;
}

return { applyCloudRow, loadSupabaseState, rpcSaveCloudV2, persistSupabaseState, requestStorageV2CloudSave, cloudPoll:trackedCloudPoll, resumeAfterReconnect, startCloudPolling,stopCloudPolling,quiesceForStorageCutover };
}
