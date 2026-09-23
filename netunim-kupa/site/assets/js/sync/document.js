import {beginMeasure} from '../shared/runtime-performance.js';
import {structuredSyncConflict} from '../shared/cloud-sync.js';
import {normalizeSharedChecks} from '../domains/checks/model.js';
import {assertValidCloudState} from '../state/validation.js';
import {jsonEq} from './merge-records.js';
import {SUPA_AUTO_KEY, STORAGE_PREF_KEY} from '../state/constants.js';
import {CLOUD_WRITE_POLICY,cloudWriteError,contentionDelay,createOutboxRetryScheduler,normalizeCloudError,operationAuditMetadata,runBusyCloudWriteWithPolicy} from '../shared/cloud-sync.js';

function revisionConflict(res){return !res?.r?.ok&&normalizeCloudError(res).kind==='revision_conflict'}
function saveBusy(res){return !res?.r?.ok&&normalizeCloudError(res).kind==='busy'}
function contentionBackoff(attempt=0){return new Promise(resolve=>setTimeout(resolve,contentionDelay(attempt)))}
function normalizeDeleteIntents(value){const out={};if(!value||typeof value!=='object'||Array.isArray(value))return out;for(const [key,ids] of Object.entries(value)){const clean=[...new Set((Array.isArray(ids)?ids:[]).map(x=>String(x||'').trim()).filter(Boolean))].sort();if(clean.length)out[key]=clean}return out}
function collectionRows(state,key){if(key==='notesSheet.sheets')return state?.notesSheet?.sheets||[];if(key==='notesSheet.rows')return state?.notesSheet?.rows||[];if(key==='notesSheet.columns')return state?.notesSheet?.columns||[];return state?.[key]||[]}
function effectiveDeleteIntents(base,candidate,intents){const out={},declared=normalizeDeleteIntents(intents);for(const [key,ids] of Object.entries(declared)){const before=Array.isArray(collectionRows(base,key))?collectionRows(base,key):[],after=Array.isArray(collectionRows(candidate,key))?collectionRows(candidate,key):[],kept=new Set(after.map(x=>String(x?.id||''))),removed=before.map(x=>String(x?.id||'')).filter(id=>id&&ids.includes(id)&&!kept.has(id)).sort();if(removed.length)out[key]=removed}return out}

function cloudAudit(pending,before,after,baseRevision,intents){return operationAuditMetadata({site:'kupa',mutationType:intents['notesSheet.sheets']?.length?'bulk-delete':pending?.mutationType||'autosave',surface:pending?.surface||'kupa',baseRevision,beforeState:before,afterState:after,collections:['credits','cash','rights','notes','expenses','cards','notesSheet.rows','notesSheet.columns','notesSheet.sheets'],deleteCount:Object.values(intents).reduce((sum,ids)=>sum+ids.length,0),restoreGroupId:pending?.restoreGroupId})}

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createSyncDocument({hideConnectScreen, reportError, model, session, checksSession, tab, prepareKupaCloudState, applyKupaCloudState, setSaveStatus, setConnectedStatus, setCloudHeaderStatus, persistImmediateBrowserSnapshot:writeBrowserSnapshot, loadSharedChecksBase, loadSharedChecksBankEvents, listBackups, backupSnapshotToComputer, saveState, syncSharedChecksFromCloud, render, getCloudPending, readSupabaseDocument, supaRest, putCloudPending, clearCloudPending, mergeKupaCloudState3Way, rebaseNewerPending, lastSavedCloudState, showSecondaryTabGuard, stageCloudPendingLocal, toast, pollSharedChecks, refreshOrdersFinanceSummary=async()=>false, storageV2CloudOutboxActive=()=>false, refreshStorageV2CloudState=async()=>null, initializeStorageV2CloudCursor=async()=>false, materializeStorageV2CloudFlight=async()=>null, acknowledgeStorageV2CloudFlight=async()=>null, rejectStorageV2CloudFlight=async()=>null, setStorageV2CloudControl=async()=>null, replaceStorageV2CurrentState=async()=>null, adoptStorageV2CloudHead=async()=>null, resetStorageV2CloudHead=async()=>null, storageV2CommitPromise=()=>Promise.resolve(), domainRevisions}){
const outboxRetryScheduler=createOutboxRetryScheduler();
const persistImmediateBrowserSnapshot=(state,revision,options)=>writeBrowserSnapshot(state,revision,options||{storageBoundary:'cloud-system-state'});
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
  const v2=await refreshStorageV2CloudState();if(v2){await replaceStorageV2CurrentState(model.state);return true}
  return persistImmediateBrowserSnapshot(model.state,session.dbRevision,{storageBoundary:'remote-secondary-domain-mirror'})!==false
}
async function persistAuthoritativeCloudHead(revision){
  const v2=await refreshStorageV2CloudState();
  if(v2?.base){if(v2.pending||v2.flight)throw new Error('kupa_v2_cloud_pending_during_authoritative_apply');await adoptStorageV2CloudHead(Number(revision),model.state);return true}
  if(persistImmediateBrowserSnapshot(model.state,revision,{storageBoundary:'remote-authoritative-load'})===false)return false;
  try{await storageV2CommitPromise();await initializeStorageV2CloudCursor(Number(revision))}catch(error){console.error('kupa V2 cloud cursor initialization',error)}return true
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
  const legacyCards=Array.isArray(row?.state?.cards)&&row.state.cards.some(card=>typeof card?.id!=='string'||!card.id.trim()),localChecks=normalizeSharedChecks(model.state.checks),financeAvailable=row?.financeAvailable!==false;
  replaceVisibleState(financeAvailable?applyKupaCloudState(row.state,localChecks):applyKupaCoreState(row.state,localChecks,model.state));const removed=model.lastNormalizeRemovedCredits,removedCreditIds=[...(model.lastNormalizeRemovedCreditIds||[])];session.dbRevision=Number(row.revision||0);if(financeAvailable){session.financeRevision=Number(row.financeRevision||0);session.financeUpdatedAt=row.financeUpdatedAt||session.financeUpdatedAt||null}session.connectionMode='supabase';session.backendReady=true;session.lastSavedSnapshot=JSON.stringify(prepareKupaCloudState(row.state));session.serverInfo={schemaVersion:6,lastSavedAt:row.coreUpdatedAt||session.serverInfo?.lastSavedAt||null,databaseFile:'Supabase',backups:await listBackups()};checksSession.sharedChecksBase=loadSharedChecksBase();checksSession.sharedChecksBankEvents=loadSharedChecksBankEvents();await syncSharedChecksFromCloud({quiet:true,required:true});await refreshOrdersFinanceSummary({force:true,renderIfChanged:false});await persistAuthoritativeCloudHead(session.dbRevision);await backupSnapshotToComputer(model.state,session.dbRevision);localStorage.setItem(STORAGE_PREF_KEY,'supabase');setConnectedStatus('Supabase מחובר');setSaveStatus('מסונכרן לענן','ok');setCloudHeaderStatus('synced','ענן: מסונכרן');session.cloudAuthNoDocument=false;localStorage.setItem(SUPA_AUTO_KEY,'1');hideConnectScreen();session.cloudConflictPending=false;if(renderNow)render();if(removed>0)setTimeout(()=>saveState(`נוקו אוטומטית ${removed} רשומות אשראי ישנות במסגרת ניקוי/מעבר למודל הסנכרון החדש`,{deleteIntents:{credits:removedCreditIds},operations:removedCreditIds.map(id=>({type:'delete',collection:'credits',id}))}),0);if(legacyCards)setTimeout(()=>saveState('נשמרו מזהים יציבים לכרטיסים קיימים',{mutationType:'migration',surface:'kupa.cards-id-migration',storageBoundary:'card-id-migration'}),0);startCloudPolling();return model.state
}

async function loadSupabaseState({discardLocalV2=false}={}){
  let v2=await refreshStorageV2CloudState();
  if(discardLocalV2&&v2?.base&&(v2.pending||v2.flight||v2.control)){const row=await readSupabaseDocument();if(!row)throw new Error('מסמך הענן לא נמצא');const next=applyKupaCoreState(row.state,model.state.checks,model.state);replaceVisibleState(next,{forceAll:true});await resetStorageV2CloudHead(Number(row.revision||0),model.state);session.dbRevision=Number(row.revision||0);session.lastSavedSnapshot=JSON.stringify(prepareKupaCloudState(row.state));session.cloudConflictPending=false;v2=await refreshStorageV2CloudState();return applyCloudRow(row)}
  if(storageV2CloudOutboxActive()&&(v2?.pending||v2?.flight||v2?.control)){session.connectionMode='supabase';session.backendReady=true;hideConnectScreen();await requestStorageV2CloudSave('שינויים מקומיים שוחזרו וסונכרנו');return model.state}
  const deferred=await getCloudPending();if(deferred&&outboxRetryScheduler.schedule(deferred,()=>reconcileCloudPending())>0){await reconcileCloudPending();return model.state}
  const row=await readSupabaseDocument();if(!row)throw new Error('עדיין לא קיימת קופה בענן. פתח את הקופה המקומית והעלה אותה לענן מתוך הגדרות.');
  const pending=await getCloudPending();
  if(pending){session.connectionMode='supabase';session.backendReady=true;hideConnectScreen();session.dbRevision=Number(row.revision||0);session.lastSavedSnapshot=JSON.stringify(prepareKupaCloudState(row.state));await reconcileCloudPending(row);return model.state}
  return applyCloudRow(row)
}

async function rpcSaveCloud(snapshot,expectedRevision,operationId,deleteIntents={},audit={}){
  const ackDone=beginMeasure('kupa:cloud-ack');
  assertValidCloudState(snapshot,'הנתונים המקומיים');
  const expected=Number(expectedRevision||0),op=String(operationId||'').trim();
  if(!Number.isSafeInteger(expected)||expected<0)throw new Error('Revision מקומי אינו תקין. השמירה לענן נעצרה.');
  if(!op)throw new Error('מזהה פעולת הקופה חסר');
  const rpc=audit?.mutationType==='bulk-delete'?'bulk_delete_save_kupa_document_v5':'save_kupa_document_v5',r=await supaRest(`/rest/v1/rpc/${rpc}`,{method:'POST',networkRetry:true,dataPriority:'high',body:JSON.stringify({p_document_name:session.cloudDocumentName,p_expected_revision:expected,p_state:snapshot,p_operation_id:op,p_delete_intents:deleteIntents,p_audit:audit})});
  const body=await r.text();let j;try{j=body?JSON.parse(body):null}catch(e){j=null}
  if(r.ok)ackDone();
  return {r,j,body,row:Array.isArray(j)?j[0]:j};
}

// Recheck lineage when a mutation arrives while ACK cleanup is awaiting IndexedDB.
async function completePendingGeneration(generation,authoritative,revision,snapshot,operationRevision){
  let newer=await rebaseNewerPending(generation,authoritative,revision,snapshot,operationRevision);
  if(newer)return {newer:true,cleared:false};
  const cleared=await clearCloudPending(generation);
  if(cleared)session.cloudAcknowledgedGeneration=Math.max(Number(session.cloudAcknowledgedGeneration||0),Number(generation));
  if(!cleared)newer=await rebaseNewerPending(generation,authoritative,revision,snapshot,operationRevision);
  return {newer,cleared};
}

function v2RetryRecord(state,flight=null){return {domain:'kupa',documentName:`${session.cloudDocumentName||'main'}-v2`,generation:Number(flight?.generation??state?.pendingGeneration??0),operationId:String(flight?.operationId||'kupa-v2'),retry:state?.control?.retry||null}}

async function saveStorageV2CloudFlight(initialFlight){
  let state=await refreshStorageV2CloudState(),flight=initialFlight||state?.flight;if(!state?.base||!flight)throw new Error('kupa_v2_flight_missing');
  let base=prepareKupaCloudState(state.base.state),serverSnapshot=prepareKupaCloudState(flight.snapshot),expected=Number(flight.baseRevision),res=null;
  for(let attempt=0;attempt<CLOUD_WRITE_POLICY.conflictAttempts;attempt++){
    const deleteIntents=normalizeDeleteIntents(flight.deleteIntents),exactIntents=effectiveDeleteIntents(base,serverSnapshot,deleteIntents);session.cloudWriteBusy=true;res=await runBusyCloudWriteWithPolicy(()=>rpcSaveCloud(serverSnapshot,expected,flight.operationId,exactIntents,cloudAudit(flight,base,serverSnapshot,expected,exactIntents)));session.cloudWriteBusy=false;
    if(saveBusy(res))throw new Error('save_busy');if(!revisionConflict(res))break;
    await contentionBackoff(attempt);const remote=await readSupabaseDocument();if(!remote?.state)throw new Error('מסמך הענן לא נמצא בזמן פתרון התנגשות');const remoteRevision=Number(remote.revision||0);if(!Number.isSafeInteger(remoteRevision)||remoteRevision<=expected)throw new Error('kupa_v2_rebase_revision_invalid');const remoteState=prepareKupaCloudState(remote.state),merged=mergeKupaCloudState3Way(base,serverSnapshot,remoteState,{deleteIntents});
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
  if(!res?.r?.ok)throw cloudWriteError(res,'שמירה לענן נכשלה');const authoritative=prepareKupaCloudState(res.row?.state||serverSnapshot),newRevision=Number(res.row?.revision||expected+1);if(!Number.isSafeInteger(newRevision)||newRevision<=Number(flight.baseRevision))throw new Error('kupa_v2_ack_revision_invalid');
  state=await refreshStorageV2CloudState();if(!state?.flight||state.flight.operationId!==flight.operationId)throw new Error('kupa_v2_flight_changed_before_ack');let businessChanged=false;
  if(state.afterFlightPending){const local=prepareKupaCloudState(model.state),rebased=mergeKupaCloudState3Way(serverSnapshot,local,authoritative,{deleteIntents:state.afterFlightDeleteIntents||{}});if(rebased.conflicts.length){const conflict=structuredSyncConflict({domain:'kupa',conflicts:rebased.conflicts,base:serverSnapshot,local,remote:authoritative,generation:state.afterFlightGeneration,baseRevision:flight.baseRevision,currentRemoteRevision:newRevision});await acknowledgeStorageV2CloudFlight(flight.operationId,newRevision,authoritative,{currentState:model.state,control:{conflict}});session.dbRevision=newRevision;session.lastSavedSnapshot=JSON.stringify(authoritative);session.cloudConflictPending=true;setSaveStatus('התנגשות שמורה מקומית','error');setCloudHeaderStatus('conflict','ענן: התנגשות');return false}businessChanged=applyAcknowledgedCoreState(rebased.state)}else if(!jsonEq(prepareKupaCloudState(model.state),authoritative))businessChanged=applyAcknowledgedCoreState(authoritative);
  const committedState=await acknowledgeStorageV2CloudFlight(flight.operationId,newRevision,authoritative,{currentState:model.state});session.dbRevision=newRevision;session.lastSavedSnapshot=JSON.stringify(authoritative);session.serverInfo.lastSavedAt=res.row?.updated_at||res.row?.coreUpdatedAt||session.serverInfo.lastSavedAt||null;session.cloudConflictPending=false;if(businessChanged)render();try{await backupSnapshotToComputer(model.state,session.dbRevision)}catch(error){console.error('post-ACK local backup',error)}return {committed:true,state:committedState}
}

async function requestStorageV2CloudSave(message='הקופה סונכרנה לענן'){
  if(!tab.primaryTab){showSecondaryTabGuard();return false}if(session.connectionMode!=='supabase'||!session.backendReady)return false;let state=await refreshStorageV2CloudState();if(!state?.base)return false;if(state.control?.conflict){session.cloudConflictPending=true;setSaveStatus('התנגשות שמורה מקומית','error');setCloudHeaderStatus('conflict','ענן: התנגשות');return false}
  if(!navigator.onLine){try{await storageV2CommitPromise()}catch(error){console.error('kupa V2 journal offline commit',error)}setSaveStatus('אופליין — שינוי שמור מקומית וממתין','saving');setCloudHeaderStatus('offline','ענן: אופליין');return false}
  if(session.storageV2CloudSavePromise)return session.storageV2CloudSavePromise;
  session.storageV2CloudSavePromise=(async()=>{let allOk=true;while(navigator.onLine&&!session.cloudConflictPending){state=await refreshStorageV2CloudState();if(!state?.base){allOk=false;break}if(state.control?.conflict){session.cloudConflictPending=true;allOk=false;break}const currentFlight=state.flight||null,retryDelay=outboxRetryScheduler.schedule(v2RetryRecord(state,currentFlight),()=>requestStorageV2CloudSave(message));if(retryDelay>0){setSaveStatus('ממתין למועד הסנכרון שהשרת קבע','saving');setCloudHeaderStatus('syncing','ענן: ממתין לסנכרון');allOk=false;break}const flight=currentFlight||await materializeStorageV2CloudFlight();if(!flight){setSaveStatus('מסונכרן לענן','ok');setCloudHeaderStatus('synced','ענן: מסונכרן');if(message)toast(message);break}session.cloudSyncBusy=true;setSaveStatus('מסנכרן…','saving');setCloudHeaderStatus('syncing','ענן: מסנכרן…');try{const saved=await saveStorageV2CloudFlight(flight);if(!saved){allOk=false;break}outboxRetryScheduler.cancel();state=saved.state||state;if(!state?.pending&&!state?.flight){setSaveStatus('מסונכרן לענן','ok');setCloudHeaderStatus('synced','ענן: מסונכרן');if(message)toast(message);break}}catch(error){console.error('kupa cloud save V2',error);state=await refreshStorageV2CloudState();const normalized=normalizeCloudError(error),attempts=Number(state?.control?.retry?.attempts||0)+1,nextAttemptAt=normalized.retryAfterMs?new Date(Date.now()+normalized.retryAfterMs).toISOString():null,retry={attempts,lastErrorCode:normalized.code||normalized.kind,lastAttemptAt:new Date().toISOString(),nextAttemptAt};await setStorageV2CloudControl({retry});state=await refreshStorageV2CloudState();outboxRetryScheduler.schedule(v2RetryRecord(state,state?.flight),()=>requestStorageV2CloudSave(message));setSaveStatus(navigator.onLine?'ממתין לסנכרון':'אופליין — שינוי שמור מקומית','saving');setCloudHeaderStatus(navigator.onLine?'syncing':'offline',navigator.onLine?'ענן: ממתין לסנכרון':'ענן: אופליין');allOk=false;break}finally{session.cloudSyncBusy=false;session.cloudWriteBusy=false}}
  return allOk&&!state?.pending&&!state?.flight&&!state?.control?.conflict})().finally(()=>{session.storageV2CloudSavePromise=null});return session.storageV2CloudSavePromise
}

async function reconcileCloudPending(remoteRow=null){
  if(storageV2CloudOutboxActive())return requestStorageV2CloudSave('שינויים מקומיים שוחזרו וסונכרנו');
  if(session.cloudSyncBusy||session.cloudWriteBusy)return false;session.cloudSyncBusy=true;
  try{
    const beforeReconcile=structuredClone(model.state);
    let pending=await getCloudPending();if(!pending){session.cloudConflictPending=false;return false}
    replaceVisibleState(applyKupaCoreState(pending.snapshot,model.state.checks));persistImmediateBrowserSnapshot(model.state,pending.baseRevision||session.dbRevision,{storageBoundary:'pending-recovery-apply'});
    if(pending.conflict){session.cloudConflictPending=true;setSaveStatus('התנגשות שמורה מקומית','error');setCloudHeaderStatus('conflict','ענן: התנגשות');render();return false}
    if(!navigator.onLine){session.cloudConflictPending=false;setSaveStatus(session.cloudDurabilityDegraded?'שמירה מקומית במצב מוגבל — נדרשת התאוששות':'אופליין — שינוי שמור מקומית וממתין',session.cloudDurabilityDegraded?'error':'saving');setCloudHeaderStatus(session.cloudDurabilityDegraded?'syncing':'offline',session.cloudDurabilityDegraded?'ענן: הגנה מקומית מופחתת':'ענן: אופליין');return false}
    const retryDelay=outboxRetryScheduler.schedule(pending,()=>reconcileCloudPending());if(retryDelay>0){session.cloudConflictPending=false;setSaveStatus('ממתין למועד הסנכרון שהשרת קבע','saving');setCloudHeaderStatus('syncing','ענן: ממתין לסנכרון');return false}
    let row=remoteRow||await readSupabaseDocument();if(!row)throw new Error('מסמך הענן לא נמצא');session.serverInfo.lastSavedAt=row.coreUpdatedAt||session.serverInfo.lastSavedAt||null;
    for(let attempt=0;attempt<CLOUD_WRITE_POLICY.conflictAttempts;attempt++){
      pending=await getCloudPending();if(!pending)return true;if(pending.conflict){session.cloudConflictPending=true;return false}
      let candidate=prepareKupaCloudState(pending.snapshot),expected=Number(row.revision||0);
      if(Number(row.revision||0)!==Number(pending.baseRevision||0)){
        const merged=mergeKupaCloudState3Way(pending.baseState,pending.snapshot,row.state,{deleteIntents:pending.deleteIntents||{}});
        if(merged.conflicts.length){const conflicted={...pending,conflict:structuredSyncConflict({domain:'kupa',conflicts:merged.conflicts,base:pending.baseState,local:pending.snapshot,remote:row.state,generation:pending.generation,baseRevision:pending.baseRevision,currentRemoteRevision:row.revision}),savedAt:new Date().toISOString()};await putCloudPending(conflicted);session.cloudConflictPending=true;replaceVisibleState(applyKupaCoreState(pending.snapshot,model.state.checks));session.dbRevision=Number(row.revision||0);session.lastSavedSnapshot=JSON.stringify(prepareKupaCloudState(row.state));persistImmediateBrowserSnapshot(model.state,session.dbRevision,{storageBoundary:'cloud-merge-conflict'});setConnectedStatus('Supabase — נדרשת הכרעה');setSaveStatus('התנגשות שמורה מקומית','error');setCloudHeaderStatus('conflict','ענן: התנגשות');render();reportError('יש התנגשות אמיתית: אותה רשומה שונתה גם במחשב הזה וגם במקור אחר. השינוי המקומי נשמר ולא נדרס. ייצא גיבוי JSON ובדוק את הרשומה לפני המשך הסנכרון.');return false}
        candidate=merged.state
      }
      const exactIntents=effectiveDeleteIntents(row.state,candidate,pending.deleteIntents);session.cloudWriteBusy=true;const res=await runBusyCloudWriteWithPolicy(()=>rpcSaveCloud(candidate,expected,pending.operationId,exactIntents,cloudAudit(pending,row.state,candidate,expected,exactIntents)));session.cloudWriteBusy=false;
      if(!res.r.ok){if(saveBusy(res))throw new Error('save_busy');if(revisionConflict(res)){await contentionBackoff(attempt);row=await readSupabaseDocument();if(!row)throw new Error('מסמך הענן נעלם בזמן הסנכרון');session.serverInfo.lastSavedAt=row.coreUpdatedAt||session.serverInfo.lastSavedAt||null;continue}throw cloudWriteError(res,'שמירה לענן נכשלה')}
      const completedGeneration=Number(pending.generation||0),newRev=Number(res.row?.revision||expected+1),authoritative=prepareKupaCloudState(res.row?.state||candidate);session.dbRevision=newRev;session.lastSavedSnapshot=JSON.stringify(authoritative);session.serverInfo.lastSavedAt=res.row?.updated_at||session.serverInfo.lastSavedAt||null;session.cloudConflictPending=false;
      outboxRetryScheduler.cancel();
      const {newer,cleared}=await completePendingGeneration(completedGeneration,authoritative,newRev,pending.snapshot,res.row?.operation_revision);
      if(!newer){if(!cleared){const newest=await getCloudPending();replaceVisibleState(applyKupaCoreState(newest?.snapshot||authoritative,model.state.checks));setSaveStatus('השינוי אושר; ניקוי מקומי ממתין להתאוששות','error');setCloudHeaderStatus('syncing','ענן: התאוששות אחסון מקומי');return false}replaceVisibleState(applyKupaCoreState(authoritative,model.state.checks));setSaveStatus('מסונכרן לענן','ok');setCloudHeaderStatus('synced','ענן: מסונכרן')}else{const newest=await getCloudPending();replaceVisibleState(applyKupaCoreState(newest?.snapshot||model.state,model.state.checks));setSaveStatus(newest?.conflict?'התנגשות שמורה מקומית':'ממתין לשינוי הבא…',newest?.conflict?'error':'saving');setCloudHeaderStatus(newest?.conflict?'conflict':'syncing',newest?.conflict?'ענן: התנגשות':'ענן: מסנכרן…')}
      persistImmediateBrowserSnapshot(model.state,session.dbRevision,{storageBoundary:'cloud-reconcile-ack'});if(!newer&&cleared){try{await initializeStorageV2CloudCursor(session.dbRevision)}catch(error){console.error('kupa V2 cursor after legacy reconcile',error)}}if(!jsonEq(beforeReconcile,model.state))render();await backupSnapshotToComputer(model.state,session.dbRevision);if(newer&&!session.cloudConflictPending)setTimeout(cloudPoll,0);return !session.cloudConflictPending
    }
    throw new Error('הענן השתנה שוב ושוב בזמן הסנכרון; השינוי המקומי נשמר וינוסה שוב')
  }catch(e){session.cloudWriteBusy=false;console.error(e);const current=await getCloudPending();session.cloudConflictPending=!!current?.conflict;if(current&&!current.conflict){const normalized=normalizeCloudError(e),attempts=Number(current.retry?.attempts||0)+1,nextAttemptAt=normalized.retryAfterMs?new Date(Date.now()+normalized.retryAfterMs).toISOString():null,retryRecord=stageCloudPendingLocal(current.snapshot,'התאוששות סנכרון',current.baseRevision,current.baseState,current.generation,false,{attempts,lastErrorCode:normalized.code||normalized.kind,lastAttemptAt:new Date().toISOString(),nextAttemptAt},current.deleteIntents||{});outboxRetryScheduler.schedule(retryRecord,()=>reconcileCloudPending())}setSaveStatus(session.cloudConflictPending?'התנגשות שמורה מקומית':navigator.onLine?'ממתין לסנכרון':'אופליין — שינוי שמור מקומית','saving');setCloudHeaderStatus(session.cloudConflictPending?'conflict':navigator.onLine?'syncing':'offline',session.cloudConflictPending?'ענן: התנגשות':navigator.onLine?'ענן: ממתין לסנכרון':'ענן: אופליין');return false}finally{session.cloudSyncBusy=false}
}

async function persistSupabaseState(snapshot,msg,generation=session.localGeneration){
  if(!tab.primaryTab){showSecondaryTabGuard();return false}
  if(storageV2CloudOutboxActive()){
    try{await storageV2CommitPromise()}catch(error){console.error('kupa V2 journal commit before cloud save',error);setSaveStatus('שגיאת אחסון מקומי — הסנכרון נעצר','error');setCloudHeaderStatus('conflict','ענן: נדרשת התאוששות');return false}
    return requestStorageV2CloudSave(msg)
  }
  let pending=await getCloudPending();
  if(pending&&Number(pending.generation||0)>=Number(generation||0)){snapshot=pending.snapshot;generation=Number(pending.generation)}
  if(pending?.conflict||session.cloudConflictPending){stageCloudPendingLocal(snapshot,msg,pending?.baseRevision??session.dbRevision,pending?.baseState||lastSavedCloudState()||snapshot,Math.max(generation,Number(pending?.generation||0)),true);persistImmediateBrowserSnapshot(model.state,session.dbRevision,{storageBoundary:'cloud-conflict-preserve'});setSaveStatus('התנגשות שמורה מקומית','error');setCloudHeaderStatus('conflict','ענן: התנגשות');return false}
  if(!pending||Number(pending.generation||0)<Number(generation||0)){
    stageCloudPendingLocal(snapshot,msg,session.dbRevision,lastSavedCloudState()||snapshot,generation,false);
    pending=await getCloudPending();
  }
  if(!pending)throw new Error('kupa_outbox_persistence_failed');
  // Snapshot, operation ID, generation and merge base must belong to one durable record.
  // Recovery records may predate the current schema; normalize once at the send boundary.
  snapshot=prepareKupaCloudState(pending.snapshot);generation=Number(pending.generation);
  if(!navigator.onLine){session.cloudConflictPending=false;persistImmediateBrowserSnapshot(model.state,session.dbRevision,{storageBoundary:'cloud-offline-preserve'});setSaveStatus(session.cloudDurabilityDegraded?'שמירה מקומית במצב מוגבל — נדרשת התאוששות':'אופליין — שינוי שמור מקומית וממתין',session.cloudDurabilityDegraded?'error':'saving');setCloudHeaderStatus(session.cloudDurabilityDegraded?'syncing':'offline',session.cloudDurabilityDegraded?'ענן: הגנה מקומית מופחתת':'ענן: אופליין');toast(session.cloudDurabilityDegraded?'IndexedDB אינו זמין; נשמר עותק תאימות מקומי ונדרשת התאוששות':'אין רשת — השינוי נשמר מקומית ויעלה אוטומטית בחיבור הבא');return false}
  const retryDelay=outboxRetryScheduler.schedule(pending,()=>persistSupabaseState(prepareKupaCloudState(model.state),msg,session.localGeneration));if(retryDelay>0){setSaveStatus('ממתין למועד הסנכרון שהשרת קבע','saving');setCloudHeaderStatus('syncing','ענן: ממתין לסנכרון');return false}
  if(session.cloudSyncBusy){setSaveStatus('ממתין למחזור סנכרון פעיל…','saving');setCloudHeaderStatus('syncing','ענן: ממתין לסנכרון');return false}
  session.cloudSyncBusy=true;
  setSaveStatus('מסנכרן…','saving');setCloudHeaderStatus('syncing','ענן: מסנכרן…');
  try{
    let baseRevision=Number(pending.baseRevision),baseState=pending.baseState,candidate=snapshot,res=null;
    for(let attempt=0;attempt<CLOUD_WRITE_POLICY.conflictAttempts;attempt++){
      const exactIntents=effectiveDeleteIntents(baseState,candidate,pending.deleteIntents);session.cloudWriteBusy=true;res=await runBusyCloudWriteWithPolicy(()=>rpcSaveCloud(candidate,baseRevision,pending.operationId,exactIntents,cloudAudit(pending,baseState,candidate,baseRevision,exactIntents)));session.cloudWriteBusy=false;
      if(res.r.ok)break;
      const em=res.j?.message||res.body||'שמירה לענן נכשלה';
      if(saveBusy(res))throw new Error('save_busy')
      if(!revisionConflict(res))throw cloudWriteError(res,em);
      await contentionBackoff(attempt);
      const remote=await readSupabaseDocument();if(!remote)throw new Error('מסמך הענן לא נמצא בזמן פתרון התנגשות');const merged=mergeKupaCloudState3Way(baseState,candidate,remote.state,{deleteIntents:pending.deleteIntents||{}});
      if(merged.conflicts.length){stageCloudPendingLocal(snapshot,msg,pending.baseRevision,pending.baseState,generation,structuredSyncConflict({domain:'kupa',conflicts:merged.conflicts,base:baseState,local:candidate,remote:remote.state,generation,baseRevision,currentRemoteRevision:remote.revision}),undefined,pending.deleteIntents||{});session.cloudConflictPending=true;setSaveStatus('התנגשות שמורה מקומית','error');setCloudHeaderStatus('conflict','ענן: התנגשות');reportError('הסנכרון נעצר: אותה רשומה שונתה במקביל בשני מקומות. השינוי המקומי נשמר ולא נדרס.');return false}
      candidate=merged.state;baseRevision=Number(remote.revision||0);baseState=prepareKupaCloudState(remote.state);res=null
    }
    if(!res?.r?.ok)throw new Error('הענן השתנה שוב בזמן השמירה; השינוי נשמר מקומית וינוסה שוב');
    outboxRetryScheduler.cancel();const row=res.row,newRev=Number(row?.revision||baseRevision+1),authoritative=prepareKupaCloudState(row?.state||candidate);session.dbRevision=newRev;session.lastSavedSnapshot=JSON.stringify(authoritative);session.serverInfo.lastSavedAt=row?.updated_at||session.serverInfo.lastSavedAt||null;session.cloudConflictPending=false;
    const {newer,cleared}=await completePendingGeneration(generation,authoritative,newRev,pending.snapshot,row?.operation_revision);
    let businessChanged=false;
    if(!newer){if(generation===session.localGeneration){businessChanged=applyAcknowledgedCoreState(authoritative)}if(!cleared){setSaveStatus('השינוי אושר; ניקוי מקומי ממתין להתאוששות','error');setCloudHeaderStatus('syncing','ענן: התאוששות אחסון מקומי');return false}setSaveStatus('מסונכרן לענן','ok');setCloudHeaderStatus('synced','ענן: מסונכרן');toast(msg)}else{const newest=await getCloudPending();if(newest){businessChanged=applyAcknowledgedCoreState(newest.snapshot);session.cloudConflictPending=!!newest.conflict}setSaveStatus(session.cloudConflictPending?'התנגשות שמורה מקומית':'שומר שינוי נוסף…',session.cloudConflictPending?'error':'saving');setCloudHeaderStatus(session.cloudConflictPending?'conflict':'syncing',session.cloudConflictPending?'ענן: התנגשות':'ענן: מסנכרן…')}
    persistImmediateBrowserSnapshot(model.state,session.dbRevision,{storageBoundary:'cloud-write-ack'});if(!newer&&cleared){try{await initializeStorageV2CloudCursor(session.dbRevision)}catch(error){console.error('kupa V2 cursor after legacy ACK',error)}}if(businessChanged)render();await backupSnapshotToComputer(model.state,session.dbRevision);if(newer&&!session.cloudConflictPending)setTimeout(cloudPoll,0);return !session.cloudConflictPending
  }catch(e){session.cloudWriteBusy=false;console.error(e);const current=await getCloudPending(),normalized=normalizeCloudError(e),attempts=Number(current?.retry?.attempts||0)+1,nextAttemptAt=normalized.retryAfterMs?new Date(Date.now()+normalized.retryAfterMs).toISOString():null,retryRecord=stageCloudPendingLocal(prepareKupaCloudState(model.state),msg,session.dbRevision,lastSavedCloudState()||pending.baseState||snapshot,session.localGeneration,false,{attempts,lastErrorCode:normalized.code||normalized.kind,lastAttemptAt:new Date().toISOString(),nextAttemptAt},current?.deleteIntents||pending?.deleteIntents||{});outboxRetryScheduler.schedule(retryRecord,()=>persistSupabaseState(prepareKupaCloudState(model.state),msg,session.localGeneration));persistImmediateBrowserSnapshot(model.state,session.dbRevision);setSaveStatus(navigator.onLine?'ממתין לסנכרון':'אופליין — שינוי שמור מקומית','saving');setCloudHeaderStatus(navigator.onLine?'syncing':'offline',navigator.onLine?'ענן: ממתין לסנכרון':'ענן: אופליין');toast('השינוי נשמר מקומית וממתין לסנכרון לענן');return false}
  finally{session.cloudWriteBusy=false;session.cloudSyncBusy=false}
}

async function cloudPoll(){
  if(!tab.primaryTab||session.connectionMode!=='supabase'||!session.backendReady||!navigator.onLine)return;
  if(session.cloudSyncBusy||session.cloudWriteBusy){await pollSharedChecks();return}
  let v2=await refreshStorageV2CloudState();
  if(storageV2CloudOutboxActive()){
    if(v2?.control?.conflict){session.cloudConflictPending=true;setCloudHeaderStatus('conflict','ענן: התנגשות');await pollSharedChecks();return}
    if(v2?.pending||v2?.flight){await requestStorageV2CloudSave();await pollSharedChecks();return}
  }
  const pending=await getCloudPending();if(pending){if(pending.conflict){session.cloudConflictPending=true;setCloudHeaderStatus('conflict','ענן: התנגשות');await pollSharedChecks();return}await reconcileCloudPending();await pollSharedChecks();return}
  if(session.cloudConflictPending){await pollSharedChecks();return}
  const pollGeneration=Number(session.localGeneration||0),localBefore=prepareKupaCloudState(model.state);
  try{
    session.cloudSyncBusy=true;const row=await readSupabaseDocument();if(!row)return;
    v2=await refreshStorageV2CloudState();const pendingAfterRead=await getCloudPending(),localAdvanced=Number(session.localGeneration||0)!==pollGeneration||!!pendingAfterRead||!!(v2?.pending||v2?.flight)||!jsonEq(localBefore,prepareKupaCloudState(model.state));
    if(localAdvanced){session.cloudSyncBusy=false;if(storageV2CloudOutboxActive())await requestStorageV2CloudSave();else if(pendingAfterRead)await reconcileCloudPending(row);return}
    const kupaChanged=Number(row.revision||0)>Number(session.dbRevision||0),financeChanged=!!row&&Number(row.financeRevision||0)>Number(session.financeRevision||0);if(!(kupaChanged||financeChanged))return;
    const base=v2?.base?.state||lastSavedCloudState(),clean=!!base&&jsonEq(prepareKupaCloudState(model.state),base);
    if(clean){await applyCloudRow(row);toast(kupaChanged?'התקבל עדכון ממחשב אחר':'התקבל עדכון פיננסי ממקור אחר');return}
    if(kupaChanged){
      if(storageV2CloudOutboxActive()){const conflict={kind:'storage-v2-dirty-head',domain:'kupa',message:'המצב המקומי שונה מבסיס הענן ללא journal ממתין',baseRevision:Number(v2?.base?.revision||session.dbRevision||0),currentRemoteRevision:Number(row.revision||0),at:new Date().toISOString()};await setStorageV2CloudControl({conflict});session.cloudConflictPending=true;setSaveStatus('התנגשות אחסון מקומי — הסנכרון נעצר','error');setCloudHeaderStatus('conflict','ענן: התנגשות');return}
      stageCloudPendingLocal(prepareKupaCloudState(model.state),'שינוי מקומי ממתין',session.dbRevision,base||prepareKupaCloudState(model.state),session.localGeneration,false);session.cloudSyncBusy=false;await reconcileCloudPending(row);return
    }
    await applyFinanceOnlyRow(row)
  }catch(e){console.error('cloud poll',e)}finally{session.cloudSyncBusy=false;await Promise.all([pollSharedChecks(),refreshOrdersFinanceSummary({renderIfChanged:true})])}
}

function startCloudPolling(){if(session.cloudPollTimer)clearTimeout(session.cloudPollTimer);session.cloudPollingEnabled=true;const schedule=()=>{if(!session.cloudPollingEnabled)return;session.cloudPollTimer=setTimeout(async()=>{try{await cloudPoll()}finally{schedule()}},12_000+Math.floor(Math.random()*2_000))};schedule()}

return { applyCloudRow, loadSupabaseState, rpcSaveCloud, reconcileCloudPending, persistSupabaseState, cloudPoll, startCloudPolling };
}
