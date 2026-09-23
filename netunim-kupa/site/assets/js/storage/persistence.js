import {measureStorage} from '../shared/storage-metrics.js';
import {beginMeasure} from '../shared/runtime-performance.js';
import {clone} from '../core/values.js';
import {payloadFromState} from '../state/serialization.js';
import {assertKupaEntityInvariants} from '../state/validation.js';
import {jsonEq} from '../sync/merge-records.js';
import {inactiveCreditExpired} from '../domains/credit/model.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createStoragePersistence({captureLegacyWorkbook=async()=>{},storageV2Primary=()=>false,storageV2CloudOutboxActive=()=>false,storageV2CommitPromise=()=>Promise.resolve(),storageV2DurabilityAtRisk=()=>false,replaceStorageV2AuthoritativeState=async()=>false,replaceStorageV2CurrentState=async()=>false,observeSharedChecks=()=>false,reportError, model, session, files, tab, checksSession, domainRevisions, stateFromPayload, setSaveStatus, setConnectedStatus, persistImmediateBrowserSnapshot, readJsonHandle, listBackups, backupSnapshotToComputer, prepareKupaCloudState, normalizeState, lastSavedCloudState, showSecondaryTabGuard, stageCloudPendingLocal, markSharedChecksPending, saveSharedChecksToCloud, render, lastSavedState, writeJsonHandleVerified, mergeState3Way, persistSupabaseState, toast}){
let cloudSaveRequest=null;
function beginLocalRisk(token){(session.localUndurableGenerations??=new Set()).add(token)}
function clearLocalRisk(token){session.localUndurableGenerations?.delete(token)}
function clearLocalRiskAfter(token,promise){promise?.then(()=>clearLocalRisk(token),()=>{});return promise}
function requestCloudSave(snapshot,msg,generation){
  cloudSaveRequest={snapshot,msg,generation};
  if(session.cloudSavePromise)return session.cloudSavePromise;
  // Preserve the ordering with an outstanding file save when changing storage mode.
  session.cloudSavePromise=(session.saveQueue||Promise.resolve()).catch(error=>{console.error('previous save queue',error)}).then(async()=>{
    let ok=true;
    while(cloudSaveRequest){
      const next=cloudSaveRequest;cloudSaveRequest=null;
      try{ok=await persistSupabaseState(next.snapshot,next.msg,next.generation)}
      catch(error){console.error('cloud save failed before durable staging',error);setSaveStatus('השינוי לא נשמר באחסון המקומי — אין לסגור את החלון','error');ok=false}
      // Offline, retry-after and conflicts resume through the existing outbox poller.
      if(!ok)break;
      if(cloudSaveRequest&&cloudSaveRequest.generation<=Number(session.cloudAcknowledgedGeneration||0))cloudSaveRequest=null;
    }
    return ok;
  }).finally(()=>{session.cloudSavePromise=null});
  session.saveQueue=session.cloudSavePromise;
  return session.cloudSavePromise;
}
function mergeDeleteIntents(...values){const out={};for(const value of values){if(!value||typeof value!=='object'||Array.isArray(value))continue;for(const [key,ids] of Object.entries(value)){const clean=[...new Set((Array.isArray(ids)?ids:[]).map(x=>String(x||'').trim()).filter(Boolean))];if(clean.length)out[key]=[...new Set([...(out[key]||[]),...clean])].sort()}}return out}
const nextTurn=work=>new Promise(resolve=>setTimeout(resolve,0)).then(work);
async function loadState(){if(!files.dataFileHandle)throw new Error('לא נבחר קובץ נתונים');const p=await readJsonHandle(files.dataFileHandle);await captureLegacyWorkbook(p.notesSheet);const parsed=stateFromPayload(p),removed=model.lastNormalizeRemovedCredits,removedCreditIds=[...(model.lastNormalizeRemovedCreditIds||[])];if(storageV2Primary()){const installed=await replaceStorageV2AuthoritativeState(parsed.state,Number(parsed.meta.revision||0));if(!installed)throw new Error('storage_v2_local_file_checkpoint_failed')}const previous=model.state;model.state=parsed.state;domainRevisions?.reconcile(previous,model.state,{forceAll:true});session.dbRevision=Number(parsed.meta.revision||0);session.backendReady=true;session.localFileConflictPending=false;session.lastSavedSnapshot=JSON.stringify(model.state);session.serverInfo={schemaVersion:Number(parsed.meta.schemaVersion||6),lastSavedAt:parsed.meta.savedAt||null,databaseFile:files.dataFileHandle.name,backups:await listBackups()};if(!storageV2Primary())persistImmediateBrowserSnapshot(model.state,session.dbRevision,{storageBoundary:'local-file-load'});if(files.backupsDirHandle)await backupSnapshotToComputer(model.state,session.dbRevision);setConnectedStatus(session.connectionMode==='directory'?'תיקיית קופה מחוברת':'קובץ נתונים מחובר');setSaveStatus('נשמר בקובץ','ok');if(removed>0)setTimeout(()=>saveState(`נוקו אוטומטית ${removed} רשומות אשראי ישנות במסגרת ניקוי/מעבר למודל הסנכרון החדש`,{deleteIntents:{credits:removedCreditIds},operations:removedCreditIds.map(id=>({type:'delete',collection:'credits',id}))}),0);return model.state}

function saveState(msg='נשמר',{deleteIntents={},mutationType='autosave',surface='kupa',domains=null,operations=null,storageBoundary=''}={}){
  if(!tab.primaryTab){showSecondaryTabGuard();return Promise.resolve(false)}
  measureStorage('validate',()=>assertKupaEntityInvariants(model.state,{includeChecks:true,required:true}));
  if(mutationType==='restore'||mutationType==='import')domainRevisions?.touchAll();else if(Array.isArray(domains)&&domains.length)domainRevisions?.touch(domains);else domainRevisions?.touchAll();
  const localDone=beginMeasure('kupa:save-local',{paint:true});
  const generation=++session.localGeneration,typed=Array.isArray(operations)&&operations.length>0,normalizationMayDelete=(model.state.credits||[]).some(inactiveCreditExpired),fastLocal=storageV2Primary()&&typed&&!storageBoundary&&!normalizationMayDelete;
  if(fastLocal){
    const localOk=persistImmediateBrowserSnapshot(model.state,session.dbRevision,{operations,generation,mutationType,surface,deleteIntents});localDone();
    const idbPending=!localOk&&storageV2DurabilityAtRisk();
    const riskToken=`state:${generation}`;if(!localOk)beginLocalRisk(riskToken);
    if(idbPending)clearLocalRiskAfter(riskToken,storageV2CommitPromise());
    if(!localOk){
      if(idbPending){
        setSaveStatus('ממתין לאישור שמירה ב־IndexedDB','saving');
        storageV2CommitPromise().then(()=>{if(generation===session.localGeneration)setSaveStatus('השינוי נשמר מקומית','saving')},()=>setSaveStatus('השינוי לא נשמר — אין לסגור את החלון','error'));
      }else setSaveStatus('שגיאת עותק מקומי','error');
    }
    // The operation is already durable. Yield so normalization, cloud projection
    // and file I/O cannot delay the paint caused by the user's edit.
    return nextTurn(async()=>{
      if(idbPending){try{await storageV2CommitPromise()}catch(error){setSaveStatus('השינוי לא נשמר — אין לסגור את החלון','error');return false}}
      const currentGeneration=session.localGeneration,fullSnapshot=measureStorage('normalize',()=>normalizeState(model.state)),snapshot=session.connectionMode==='supabase'?prepareKupaCloudState(fullSnapshot,{normalized:true}):fullSnapshot;
      const v2Cloud=storageV2CloudOutboxActive()&&(localOk||idbPending);
      if(session.connectionMode==='supabase'&&session.backendReady&&!v2Cloud)try{stageCloudPendingLocal(snapshot,msg,session.dbRevision,lastSavedCloudState()||snapshot,currentGeneration,false,undefined,deleteIntents,{mutationType,surface});clearLocalRiskAfter(riskToken,session.cloudOutboxCommitPromise)}catch(error){console.error('cloud outbox staging',error);setSaveStatus('השינוי לא נשמר באחסון המקומי — אין לסגור את החלון','error');return false}
      if(session.connectionMode==='supabase'&&session.backendReady)return v2Cloud?storageV2CommitPromise().then(()=>requestCloudSave(snapshot,msg,currentGeneration)):requestCloudSave(snapshot,msg,currentGeneration);
      session.saveQueue=session.saveQueue.catch(e=>{console.error('previous save queue',e)}).then(()=>persistState(snapshot,msg,currentGeneration,deleteIntents));return session.saveQueue.then(ok=>{if(ok)clearLocalRisk(riskToken);return ok});
    });
  }
  const fullSnapshot=measureStorage('normalize',()=>normalizeState(model.state)),autoCreditDeleteIds=[...(model.lastNormalizeRemovedCreditIds||[])],effectiveDeleteIntents=mergeDeleteIntents(deleteIntents,autoCreditDeleteIds.length?{credits:autoCreditDeleteIds}:{}),snapshot=session.connectionMode==='supabase'?prepareKupaCloudState(fullSnapshot,{normalized:true}):fullSnapshot;
  if(Array.isArray(operations)&&autoCreditDeleteIds.length){const described=new Set(operations.filter(operation=>operation.type==='delete'&&operation.collection==='credits').map(operation=>operation.id));operations=[...operations,...autoCreditDeleteIds.filter(id=>!described.has(id)).map(id=>({type:'delete',collection:'credits',id}))]}
  else if(autoCreditDeleteIds.length&&!storageBoundary)storageBoundary='normalize-expired-credits';
  const localOk=persistImmediateBrowserSnapshot(fullSnapshot,session.dbRevision,{normalized:true,owned:true,operations,storageBoundary,generation,mutationType,surface,deleteIntents:effectiveDeleteIntents});
  localDone();
  const idbPending=!localOk&&storageV2DurabilityAtRisk();
  const riskToken=`state:${generation}`;if(!localOk)beginLocalRisk(riskToken);
  if(idbPending)clearLocalRiskAfter(riskToken,storageV2CommitPromise());
  if(!localOk&&!idbPending)setSaveStatus('שגיאת עותק מקומי','error');
  if(idbPending)setSaveStatus('ממתין לאישור שמירה ב־IndexedDB','saving');
  // Boundary operations (restore/import/authoritative replacement) intentionally stay on
  // the legacy compatibility outbox until the replacement-checkpoint migration is fully
  // drained. A boundary can install a new V2 epoch, so it must never reuse a stale V2 cursor.
  const continueSave=()=>{
    const v2Cloud=storageV2CloudOutboxActive()&&!storageBoundary&&(localOk||idbPending);
    if(session.connectionMode==='supabase'&&session.backendReady&&!v2Cloud)try{stageCloudPendingLocal(snapshot,msg,session.dbRevision,lastSavedCloudState()||snapshot,generation,false,undefined,effectiveDeleteIntents,{mutationType,surface});clearLocalRiskAfter(riskToken,session.cloudOutboxCommitPromise)}catch(error){console.error('cloud outbox staging',error);setSaveStatus('השינוי לא נשמר באחסון המקומי — אין לסגור את החלון','error');return false}
    if(session.connectionMode==='supabase'&&session.backendReady)return v2Cloud?storageV2CommitPromise().then(()=>requestCloudSave(snapshot,msg,generation)):requestCloudSave(snapshot,msg,generation);
    session.saveQueue=session.saveQueue.catch(e=>{console.error('previous save queue',e)}).then(()=>persistState(snapshot,msg,generation,effectiveDeleteIntents));
    return session.saveQueue.then(ok=>{if(ok)clearLocalRisk(riskToken);return ok})
  };
  return idbPending?storageV2CommitPromise().then(continueSave,()=>{setSaveStatus('השינוי לא נשמר — אין לסגור את החלון','error');return false}):continueSave()
}

function saveChecksState(msg='הצק נשמר',{deletedIds=[],mutationType='autosave',surface='kupa.checks',operations=null,storageBoundary=''}={}){
  if(!tab.primaryTab){showSecondaryTabGuard();return Promise.resolve(false)}
  measureStorage('validate',()=>assertKupaEntityInvariants(model.state,{includeChecks:true,required:true}));
  observeSharedChecks(operations,{generation:checksSession.sharedChecksGeneration+1,surface,mutationType,deleteIds:deletedIds,boundary:!!storageBoundary});
  if(session.connectionMode!=='supabase'||!session.backendReady)return saveState(msg,{deleteIntents:{checks:deletedIds},mutationType,surface,domains:['checks'],operations,storageBoundary});
  domainRevisions?.touch('checks');
  const deleteIntents={checks:deletedIds},generation=checksSession.sharedChecksGeneration+1,fastLocal=storageV2Primary()&&Array.isArray(operations)&&operations.length>0&&!storageBoundary&&!(model.state.credits||[]).some(inactiveCreditExpired),fullSnapshot=fastLocal?null:measureStorage('normalize',()=>normalizeState(model.state)),localOk=persistImmediateBrowserSnapshot(fastLocal?model.state:fullSnapshot,session.dbRevision,{normalized:!fastLocal,owned:!fastLocal,operations,storageBoundary,generation,mutationType,surface,deleteIntents});
  const idbPending=!localOk&&storageV2DurabilityAtRisk(),durable=idbPending?storageV2CommitPromise():null;
  const riskToken=`checks:${generation}`;if(!localOk)beginLocalRisk(riskToken);
  if(durable)clearLocalRiskAfter(riskToken,durable);
  checksSession.sharedChecksGeneration++;checksSession.sharedChecksSaveRequested=true;markSharedChecksPending(model.state.checks,undefined,undefined,{deleteIds:deletedIds,mutationType,surface});
  if(fastLocal)clearLocalRiskAfter(riskToken,checksSession.sharedChecksOutboxCommitPromise);
  if(idbPending){
    setSaveStatus('ממתין לאישור שמירת הצקים ב־IndexedDB','saving');
    durable.then(()=>setSaveStatus(navigator.onLine?'צקים ממתינים לסנכרון':'אופליין — הצקים שמורים מקומית','saving'),()=>setSaveStatus('הצקים לא נשמרו — אין לסגור את החלון','error'));
  }else if(!localOk)setSaveStatus('שגיאת עותק מקומי','error');else setSaveStatus(navigator.onLine?'צקים ממתינים לסנכרון':'אופליין — הצקים שמורים מקומית','saving');
  if(files.backupsDirHandle)(fastLocal?nextTurn(()=>backupSnapshotToComputer(normalizeState(model.state),session.dbRevision)):backupSnapshotToComputer(fullSnapshot,session.dbRevision)).catch(e=>console.error('shared checks local backup',e));
  clearTimeout(checksSession.sharedChecksSaveTimer);checksSession.sharedChecksSaveTimer=setTimeout(async()=>{checksSession.sharedChecksSaveTimer=null;if(durable)try{await durable}catch{return}await saveSharedChecksToCloud(msg)},220);
  return durable?durable.then(()=>true,()=>false):Promise.resolve(localOk)
}

async function persistState(snapshot,msg,generation=session.localGeneration,deleteIntents={}){
  if(!session.backendReady){setSaveStatus('לא מחובר למקור נתונים','error');return false}
  if(generation===session.localGeneration)snapshot=session.connectionMode==='supabase'?prepareKupaCloudState(model.state):normalizeState(model.state);
  if(session.connectionMode==='supabase')return persistSupabaseState(prepareKupaCloudState(snapshot),msg,generation);
  if(!files.dataFileHandle){setSaveStatus('אין קובץ נתונים','error');return false}
  if(session.localFileConflictPending){if(!storageV2Primary())persistImmediateBrowserSnapshot(model.state,session.dbRevision,{storageBoundary:'local-file-conflict-mirror'});setSaveStatus('התנגשות בקובץ — העותק המקומי שמור','error');return false}
  setSaveStatus(generation===session.localGeneration?'שומר…':'שומר תור שינויים…','saving');
  try{
    const current=await readJsonHandle(files.dataFileHandle),curMeta=current?._meta||{},curRev=Number(curMeta.revision||0),remote=stateFromPayload(current).state;
    let candidate=clone(snapshot),expected=curRev;
    if(curRev!==session.dbRevision){
      const base=lastSavedState();
      if(!base){session.localFileConflictPending=true;if(!storageV2Primary())persistImmediateBrowserSnapshot(model.state,session.dbRevision,{storageBoundary:'local-file-missing-base'});setSaveStatus('קובץ השתנה — נדרשת בדיקה','error');reportError('קובץ הנתונים השתנה ולא קיימת גרסת בסיס בטוחה למיזוג. השינויים שעל המסך נשמרו בעותק הדפדפן ולא נדרסו. מומלץ לייצא JSON ולפתוח מחדש את הקופה.');return false}
      const merged=mergeState3Way(base,snapshot,remote,{deleteIntents});
      if(merged.conflicts.length){session.localFileConflictPending=true;if(!storageV2Primary())persistImmediateBrowserSnapshot(model.state,session.dbRevision,{storageBoundary:'local-file-merge-conflict'});setSaveStatus('התנגשות בקובץ — העותק המקומי שמור','error');reportError('אותה רשומה שונתה גם בקובץ וגם במסך הזה. כדי למנוע דריסה השמירה לקובץ נעצרה; השינויים המקומיים נשמרו בעותק הדפדפן. ייצא גיבוי JSON ופתח מחדש את הקופה לפני המשך עריכה.');return false}
      candidate=merged.state;
    }
    const nextRev=expected+1,payload=payloadFromState(candidate,nextRev);
    await writeJsonHandleVerified(files.dataFileHandle,payload);
    session.dbRevision=nextRev;session.lastSavedSnapshot=JSON.stringify(candidate);session.serverInfo.lastSavedAt=payload._meta.savedAt;
    const visibleBefore=model.state;
    if(generation===session.localGeneration){model.state=normalizeState(clone(candidate))}else{
      const rebased=mergeState3Way(snapshot,model.state,candidate,{deleteIntents});
      if(rebased.conflicts.length){session.localFileConflictPending=true;setSaveStatus('שינוי נוסף התנגש — נשמר בדפדפן','error')}else model.state=rebased.state
    }
    const visibleChanged=!jsonEq(visibleBefore,model.state);if(visibleChanged)domainRevisions?.reconcile(visibleBefore,model.state);
    if(storageV2Primary()){if(await replaceStorageV2CurrentState(model.state)===false)throw new Error('storage_v2_local_file_checkpoint_failed')}else persistImmediateBrowserSnapshot(model.state,session.dbRevision,{storageBoundary:'local-file-authoritative-write'});
    if(visibleChanged)render();
    if(files.backupsDirHandle)await backupSnapshotToComputer(candidate,nextRev);session.serverInfo.backups=await listBackups();
    if(generation===session.localGeneration&&!session.localFileConflictPending){setSaveStatus('נשמר בקובץ','ok');toast(msg)}else if(!session.localFileConflictPending)setSaveStatus('שומר שינוי נוסף…','saving');
    return !session.localFileConflictPending
  }catch(e){console.error(e);if(!storageV2Primary())persistImmediateBrowserSnapshot(model.state,session.dbRevision,{storageBoundary:'local-file-write-error'});setSaveStatus('שגיאת שמירה — העותק המקומי שמור','error');reportError('השמירה לקובץ נכשלה. השינוי נשמר בעותק התאוששות בדפדפן ולא יידרס בלי אזהרה. מומלץ לייצא גיבוי JSON ולטפל בגישה לתיקייה.');return false}
}

return { loadState, saveState, saveChecksState, persistState };
}
