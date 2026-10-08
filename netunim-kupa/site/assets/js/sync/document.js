import {beginMeasure} from '../shared/runtime-performance.js';
import {commitCloudCheckpoint} from '../shared/cloud-checkpoint-publication.js';
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
export function createSyncDocument({hideConnectScreen, reportError, model, session, checksSession, tab, prepareKupaCloudState, applyKupaCloudState, setSaveStatus, setConnectedStatus, setCloudHeaderStatus, listBackups, backupSnapshotToComputer, syncSharedChecksFromCloud, render, readSupabaseDocument, supaRest, mergeKupaCloudState3Way, showSecondaryTabGuard, toast, pollSharedChecks, refreshOrdersFinanceSummary=async()=>false, storageV2CloudOutboxActive=()=>false, refreshStorageV2CloudState=async()=>null, materializeStorageV2CloudFlight=async()=>null, acknowledgeStorageV2CloudFlight=async()=>null, rejectStorageV2CloudFlight=async()=>null, setStorageV2CloudControl=async()=>null, replaceStorageV2CurrentState=async()=>null, queueStorageV2CloudNormalization=async()=>null, adoptStorageV2CloudHead=async()=>null, resetStorageV2CloudHead=async()=>null, storageV2CommitPromise=()=>Promise.resolve(), storageV2PreparationActive=()=>false, assertAccountOwner=()=>{throw new Error('storage_owner_account_required')}, domainRevisions}){
const outboxRetryScheduler=createOutboxRetryScheduler();
let cloudPollPromise=null;
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
async function persistCurrentCheckpoint(){
  const cloud=await refreshStorageV2CloudState();
  if(!cloud)throw new Error('kupa_v2_checkpoint_required');
  await replaceStorageV2CurrentState(model.state);
  return true;
}
async function persistAuthoritativeCloudHead(revision,cloudState=null){
  const cloud=await refreshStorageV2CloudState();
  if(!cloud?.base||!storageV2CloudOutboxActive())throw new Error('kupa_v2_account_head_required');
  if(cloud.pending||cloud.flight||cloud.control)throw new Error('kupa_v2_cloud_pending_during_authoritative_apply');
  await adoptStorageV2CloudHead(Number(revision),model.state,{cloudState});
  return true;
}
async function applyFinanceOnlyRow(row){
  const localCloud=prepareKupaCloudState(model.state),remote=row?.state&&typeof row.state==='object'?row.state:{},localBank=localCloud.bank&&typeof localCloud.bank==='object'?localCloud.bank:{};
  if(remote.bank&&typeof remote.bank==='object')localCloud.bank={...localBank,...structuredClone(remote.bank),adjustments:Array.isArray(localBank.adjustments)?structuredClone(localBank.adjustments):[],snapshotToken:localBank.snapshotToken??null,snapshotSeq:localBank.snapshotSeq??null};
  if(remote.creditSync&&typeof remote.creditSync==='object')localCloud.creditSync=structuredClone(remote.creditSync);
  replaceVisibleState(applyKupaCloudState(localCloud,normalizeSharedChecks(model.state.checks)));
  session.financeRevision=Number(row?.financeRevision||0);session.financeUpdatedAt=row?.financeUpdatedAt||session.financeUpdatedAt||null;
  await persistCurrentCheckpoint();render();return model.state
}
async function applyCloudRow(row,{renderNow=true}={}){
  const currentV2=await refreshStorageV2CloudState();
  if(!currentV2?.base)throw new Error('kupa_v2_account_head_initialization_required');
  if(!storageV2CloudOutboxActive())throw new Error('kupa_v2_account_head_not_ready');
  assertAccountOwner();
  const legacyCards=Array.isArray(row?.state?.cards)&&row.state.cards.some(card=>typeof card?.id!=='string'||!card.id.trim()),localChecks=normalizeSharedChecks(model.state.checks),financeAvailable=row?.financeAvailable!==false;
  replaceVisibleState(financeAvailable?applyKupaCloudState(row.state,localChecks):applyKupaCoreState(row.state,localChecks,model.state));const removed=model.lastNormalizeRemovedCredits,normalizationBase=canonicalCloudSyncBase(row.state,prepareKupaCloudState);session.dbRevision=Number(row.revision||0);if(financeAvailable){session.financeRevision=Number(row.financeRevision||0);session.financeUpdatedAt=row.financeUpdatedAt||session.financeUpdatedAt||null}session.connectionMode='supabase';session.backendReady=true;session.lastSavedSnapshot=JSON.stringify(normalizationBase);session.serverInfo={schemaVersion:6,lastSavedAt:row.coreUpdatedAt||session.serverInfo?.lastSavedAt||null,databaseFile:'Supabase',backups:await listBackups()};await syncSharedChecksFromCloud({quiet:true,required:true});await refreshOrdersFinanceSummary({force:true,renderIfChanged:false});await persistAuthoritativeCloudHead(session.dbRevision,normalizationBase);const v2Normalization=storageV2CloudOutboxActive()&&(removed>0||legacyCards);if(v2Normalization)await queueStorageV2CloudNormalization(model.state,session.dbRevision);await backupSnapshotToComputer(model.state,session.dbRevision);localStorage.setItem(STORAGE_PREF_KEY,'supabase');setConnectedStatus('Supabase מחובר');setSaveStatus('מסונכרן לענן','ok');setCloudHeaderStatus('synced','ענן: מסונכרן');session.cloudAuthNoDocument=false;localStorage.setItem(SUPA_AUTO_KEY,'1');hideConnectScreen();session.cloudConflictPending=false;if(renderNow)render();if(v2Normalization)void requestStorageV2CloudSave().catch(error=>console.error('Kupa cloud normalization sync',error));startCloudPolling();return model.state
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
  session.storageV2CloudSavePromise=(async()=>{let allOk=true;while(tab.primaryTab&&navigator.onLine&&!session.cloudConflictPending){state=await refreshStorageV2CloudState();if(!state?.base){allOk=false;break}if(state.control?.conflict){session.cloudConflictPending=true;allOk=false;break}const currentFlight=state.flight||null,retryDelay=outboxRetryScheduler.schedule(v2RetryRecord(state,currentFlight),()=>requestStorageV2CloudSave(message,{force}));if(retryDelay>0){setSaveStatus('ממתין למועד הסנכרון שהשרת קבע','saving');setCloudHeaderStatus('syncing','ענן: ממתין לסנכרון');allOk=false;break}const flight=currentFlight||await materializeStorageV2CloudFlight();if(!flight){setSaveStatus('מסונכרן לענן','ok');setCloudHeaderStatus('synced','ענן: מסונכרן');if(message)toast(message);break}session.cloudSyncBusy=true;setSaveStatus('מסנכרן…','saving');setCloudHeaderStatus('syncing','ענן: מסנכרן…');try{const saved=await saveStorageV2CloudFlight(flight);if(!saved){allOk=false;break}outboxRetryScheduler.cancel();state=saved.state||state;if(!state?.pending&&!state?.flight){setSaveStatus('מסונכרן לענן','ok');setCloudHeaderStatus('synced','ענן: מסונכרן');if(message)toast(message);break}}catch(error){console.error('kupa cloud save V2',error);state=await refreshStorageV2CloudState();const normalized=normalizeCloudError(error),attempts=Number(state?.control?.retry?.attempts||0)+1,nextAttemptAt=normalized.retryAfterMs?new Date(Date.now()+normalized.retryAfterMs).toISOString():null,retry={attempts,lastErrorCode:normalized.code||normalized.kind,lastAttemptAt:new Date().toISOString(),nextAttemptAt};await setStorageV2CloudControl({retry});state=await refreshStorageV2CloudState();outboxRetryScheduler.schedule(v2RetryRecord(state,state?.flight),()=>requestStorageV2CloudSave(message,{force}));setSaveStatus(navigator.onLine?'ממתין לסנכרון':'אופליין — שינוי שמור מקומית','saving');setCloudHeaderStatus(navigator.onLine?'syncing':'offline',navigator.onLine?'ענן: ממתין לסנכרון':'ענן: אופליין');allOk=false;break}finally{session.cloudSyncBusy=false;session.cloudWriteBusy=false}}
  return allOk&&!state?.pending&&!state?.flight&&!state?.control?.conflict})().finally(()=>{session.storageV2CloudSavePromise=null});return session.storageV2CloudSavePromise
}

async function persistSupabaseState(_snapshot,msg){
  if(!tab.primaryTab){showSecondaryTabGuard();return false}
  if(!storageV2CloudOutboxActive())throw new Error('kupa_v2_account_head_required');
  try{await storageV2CommitPromise()}
  catch(error){console.error('kupa V2 journal commit before cloud save',error);setSaveStatus('השינוי לא נשמר באחסון המקומי — אין לסגור את החלון','error');setCloudHeaderStatus('conflict','ענן: נדרש שחזור אחסון מקומי');return false}
  return requestStorageV2CloudSave(msg);
}

function markCloudPollSynced(){setSaveStatus?.('מסונכרן לענן','ok');setCloudHeaderStatus?.('synced','ענן: מסונכרן');return true}
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
  if(v2?.control?.conflict){session.cloudConflictPending=true;setCloudHeaderStatus('conflict','ענן: התנגשות');await pollSharedChecks();return false}
  if(v2?.pending||v2?.flight){const saved=await requestStorageV2CloudSave();await pollSharedChecks();return saved}
  if(session.cloudConflictPending){await pollSharedChecks();return false}
  const pollGeneration=Number(session.localGeneration||0),localBefore=prepareKupaCloudState(model.state);
  try{
    session.cloudSyncBusy=true;const row=await readSupabaseDocument();
    if(!row){setSaveStatus('מסמך הענן אינו זמין','error');setCloudHeaderStatus('auth','ענן: מסמך לא נמצא');return false}
    v2=await refreshStorageV2CloudState();const localAdvanced=Number(session.localGeneration||0)!==pollGeneration||!!(v2?.pending||v2?.flight)||!jsonEq(localBefore,prepareKupaCloudState(model.state));
    if(localAdvanced){session.cloudSyncBusy=false;await requestStorageV2CloudSave();return false}
    const kupaChanged=Number(row.revision||0)>Number(session.dbRevision||0),financeChanged=!!row&&Number(row.financeRevision||0)>Number(session.financeRevision||0);if(!(kupaChanged||financeChanged))return markCloudPollSynced();
    if(!kupaChanged){await applyFinanceOnlyRow(row);return markCloudPollSynced()}
    const base=v2?.base?.state,clean=!!base&&jsonEq(prepareKupaCloudState(model.state),base);
    if(clean){await applyCloudRow(row);toast(kupaChanged?'התקבל עדכון ממחשב אחר':'התקבל עדכון פיננסי ממקור אחר');return true}
    if(kupaChanged){
      const conflict={kind:'storage-v2-dirty-head',domain:'kupa',message:'Local state differs from its cloud base without a pending journal operation',baseRevision:Number(v2?.base?.revision||session.dbRevision||0),currentRemoteRevision:Number(row.revision||0),at:new Date().toISOString()};
      await setStorageV2CloudControl({conflict});session.cloudConflictPending=true;
      setSaveStatus('התנגשות באחסון המקומי','error');setCloudHeaderStatus('conflict','ענן: התנגשות');return false;
    }
    return markCloudPollSynced()
  }catch(error){return markCloudPollFailure(error)}finally{session.cloudSyncBusy=false;await Promise.all([pollSharedChecks(),refreshOrdersFinanceSummary({renderIfChanged:true})])}
}

async function resumeAfterReconnect(){
  if(storageV2PreparationActive()||!tab.primaryTab||session.connectionMode!=='supabase'||!session.backendReady||!navigator.onLine)return false;
  if(session.cloudSyncBusy||session.cloudWriteBusy)return trackedCloudPoll();
  setSaveStatus('חזרה רשת — מסנכרן…','saving');setCloudHeaderStatus('syncing','ענן: חזרה רשת…');
  try{return await trackedCloudPoll()}catch(error){return markCloudPollFailure(error)}
}

function trackedCloudPoll(){if(cloudPollPromise)return cloudPollPromise;cloudPollPromise=cloudPoll().finally(()=>{cloudPollPromise=null});return cloudPollPromise}
function startCloudPolling(){if(session.cloudPollTimer)clearTimeout(session.cloudPollTimer);if(storageV2PreparationActive()){session.cloudPollingEnabled=false;session.cloudPollTimer=null;return}session.cloudPollingEnabled=true;const schedule=()=>{if(!session.cloudPollingEnabled||storageV2PreparationActive())return;session.cloudPollTimer=setTimeout(async()=>{try{await trackedCloudPoll()}finally{schedule()}},12_000+Math.floor(Math.random()*2_000))};schedule()}
async function quiesceForStorageCutover(){
  session.cloudPollingEnabled=false;if(session.cloudPollTimer){clearTimeout(session.cloudPollTimer);session.cloudPollTimer=null}
  if(session.cloudRecoveryTimer){clearTimeout(session.cloudRecoveryTimer);session.cloudRecoveryTimer=null}
  outboxRetryScheduler.cancel();
  if(cloudPollPromise)await Promise.allSettled([cloudPollPromise]);
  const deadline=Date.now()+30_000;
  while(session.cloudWriteBusy||session.cloudSyncBusy){if(Date.now()>=deadline)throw new Error('storage_cutover_cloud_busy');await new Promise(resolve=>setTimeout(resolve,25))}
  outboxRetryScheduler.cancel();return true;
}

return { applyCloudRow, loadSupabaseState, rpcSaveCloudV2, persistSupabaseState, requestStorageV2CloudSave, cloudPoll:trackedCloudPoll, resumeAfterReconnect, startCloudPolling,quiesceForStorageCutover };
}
