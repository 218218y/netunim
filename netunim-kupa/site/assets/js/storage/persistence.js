import {measureStorage} from '../shared/storage-metrics.js';
import {beginMeasure} from '../shared/runtime-performance.js';
import {clone} from '../core/values.js';
import {payloadFromState} from '../state/serialization.js';
import {assertKupaEntityInvariants,assertPortablePayload} from '../state/validation.js';
import {equalSyncJson} from '../shared/cloud-sync.js';
import {applyStorageV2LocalImport} from '../shared/storage-v2-local-import.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createStoragePersistence({checksStatus,loadSession=()=>null,setCloudHeaderStatus=()=>{},sharedChecksV2=null,storageV2Boundary=null,refreshStorageV2CloudState=async()=>null,recoverStorageV2State=async()=>null,captureLegacyWorkbook=async()=>{},storageV2Primary=()=>false,storageV2CommitPromise=()=>Promise.resolve(),storageV2DurabilityAtRisk=()=>false,creditNormalizationMayDelete=()=>true,reportError, model, session, files, tab, checksSession, domainRevisions, stateFromPayload, setSaveStatus, setConnectedStatus, persistImmediateBrowserSnapshot, readJsonHandle, listBackups, backupSnapshotToComputer, prepareKupaCloudState, normalizeState, showSecondaryTabGuard, saveSharedChecksToCloud, writeJsonHandleVerified, persistSupabaseState, toast}){
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
      // Offline, retry-after and conflicts resume from the V2 journal flight.
      if(!ok)break;
    }
    return ok;
  }).finally(()=>{session.cloudSavePromise=null});
  session.saveQueue=session.cloudSavePromise;
  return session.cloudSavePromise;
}
function mergeDeleteIntents(...values){const out={};for(const value of values){if(!value||typeof value!=='object'||Array.isArray(value))continue;for(const [key,ids] of Object.entries(value)){const clean=[...new Set((Array.isArray(ids)?ids:[]).map(x=>String(x||'').trim()).filter(Boolean))];if(clean.length)out[key]=[...new Set([...(out[key]||[]),...clean])].sort()}}return out}
function mainBusinessState(value){const copy=clone(value);delete copy.checks;delete copy._meta;return copy}
const nextTurn=work=>new Promise(resolve=>setTimeout(resolve,0)).then(work);
function markMainPending(){if(session.connectionMode==='supabase'&&session.backendReady)setCloudHeaderStatus(globalThis.navigator?.onLine===false?'offline':'syncing',globalThis.navigator?.onLine===false?'ענן: אופליין':'ענן: ממתין לסנכרון')}
async function loadState({automatic=false}={}){
  if(tab?.primaryTab===false){showSecondaryTabGuard();throw new Error('storage_v2_local_file_primary_tab_required')}
  if(!storageV2Primary()||!storageV2Boundary||!(sharedChecksV2?.primaryReady||sharedChecksV2?.localReady))throw new Error('storage_v2_local_file_journals_required');
  if(!files.dataFileHandle)throw new Error('לא נבחר קובץ נתונים');
  const payload=await readJsonHandle(files.dataFileHandle);
  const parsed=stateFromPayload(payload);
  if(automatic){
    const [main,shared]=await Promise.all([recoverStorageV2State(),sharedChecksV2.recover()]);
    if(!main||!shared||!equalSyncJson(mainBusinessState(main.state),mainBusinessState(parsed.state))||
      !equalSyncJson(shared.state?.checks,parsed.state.checks))throw new Error('storage_v2_local_file_requires_confirmation');
  }
  await captureLegacyWorkbook(payload.notesSheet);
  const cloud=await refreshStorageV2CloudState();
  if(cloud?.base){
    // A local file is never evidence of a cloud ACK. Preserve both cloud
    // cursors and make the complete file state pending in both journals.
    if(!sharedChecksV2.primaryReady)throw new Error('storage_v2_local_file_shared_head_required');
    if(!equalSyncJson(model.state,parsed.state)){
      await applyStorageV2LocalImport({
        boundary:storageV2Boundary,
        mainCloud:cloud,
        sharedCloud:await sharedChecksV2.cloudState(),
        mainState:parsed.state,
        sharedState:{checks:parsed.state.checks,bankEvents:checksSession.sharedChecksBankEvents||[]},
      });
      await refreshStorageV2CloudState();
    }
  }else{
    if(!sharedChecksV2.localReady)throw new Error('storage_v2_local_file_shared_head_required');
    if(!equalSyncJson(model.state,parsed.state)){
      const mainLocal=await recoverStorageV2State(),sharedLocal=await sharedChecksV2.recover();
      if(!mainLocal||!sharedLocal)throw new Error('storage_v2_local_file_checkpoint_missing');
      await applyStorageV2LocalImport({boundary:storageV2Boundary,mode:'local-only',mainLocal,sharedLocal,
        mainState:parsed.state,sharedState:{checks:parsed.state.checks,bankEvents:checksSession.sharedChecksBankEvents||[]}});
    }
  }
  const previous=model.state;
  model.state=parsed.state;
  domainRevisions?.reconcile(previous,model.state,{forceAll:true});
  session.dbRevision=Number(parsed.meta.revision||0);
  session.backendReady=true;
  session.localFileConflictPending=false;
  session.lastSavedSnapshot=JSON.stringify(model.state);
  session.serverInfo={schemaVersion:Number(parsed.meta.schemaVersion||6),lastSavedAt:parsed.meta.savedAt||null,databaseFile:files.dataFileHandle.name,backups:await listBackups()};
  if(files.backupsDirHandle)await backupSnapshotToComputer(model.state,session.dbRevision);
  setConnectedStatus(session.connectionMode==='directory'?'תיקיית קופה מחוברת':'קובץ נתונים מחובר');
  setSaveStatus('נשמר בקובץ','ok');
  return model.state;
}

function saveState(msg='נשמר',{deleteIntents={},mutationType='autosave',surface='kupa',domains=null,operations=null}={}){
  if(!tab.primaryTab){showSecondaryTabGuard();return Promise.resolve(false)}
  if(!storageV2Primary()){setSaveStatus('אחסון V2 אינו מוכן — השמירה נעצרה','error');return Promise.resolve(false)}
  measureStorage('validate',()=>assertKupaEntityInvariants(model.state,{includeChecks:true,required:true}));
  if(mutationType==='restore'||mutationType==='import')domainRevisions?.touchAll();else if(Array.isArray(domains)&&domains.length)domainRevisions?.touch(domains);else domainRevisions?.touchAll();
  const localDone=beginMeasure('kupa:save-local',{paint:true});
  // Only the business layer knows whether normalization may remove a credit.
  // Without its policy, take the full normalization path instead of skipping it.
  const generation=++session.localGeneration,typed=Array.isArray(operations)&&operations.length>0,normalizationMayDelete=(model.state.credits||[]).some(creditNormalizationMayDelete),fastLocal=typed&&!normalizationMayDelete;
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
    if(!localOk&&!idbPending)return Promise.resolve(false);
    markMainPending();
    // The operation is already durable. Yield so normalization, cloud projection
    // and file I/O cannot delay the paint caused by the user's edit.
    return nextTurn(async()=>{
      if(idbPending){try{await storageV2CommitPromise()}catch(error){setSaveStatus('השינוי לא נשמר — אין לסגור את החלון','error');return false}}
      const currentGeneration=session.localGeneration,fullSnapshot=measureStorage('normalize',()=>normalizeState(model.state)),snapshot=session.connectionMode==='supabase'?prepareKupaCloudState(fullSnapshot,{normalized:true}):fullSnapshot;
      if(session.connectionMode==='supabase'&&session.backendReady){
        const head=await refreshStorageV2CloudState();
        if(!head?.base){setSaveStatus('ראש ענן V2 חסר — השינוי נשמר מקומית אך הסנכרון נעצר','error');return false}
        return storageV2CommitPromise().then(()=>requestCloudSave(snapshot,msg,currentGeneration));
      }
      session.saveQueue=session.saveQueue.catch(e=>{console.error('previous save queue',e)}).then(()=>persistState(snapshot,msg,currentGeneration,deleteIntents));return session.saveQueue.then(ok=>{if(ok)clearLocalRisk(riskToken);return ok});
    });
  }
  const fullSnapshot=measureStorage('normalize',()=>normalizeState(model.state)),autoCreditDeleteIds=[...(model.lastNormalizeRemovedCreditIds||[])],effectiveDeleteIntents=mergeDeleteIntents(deleteIntents,autoCreditDeleteIds.length?{credits:autoCreditDeleteIds}:{}),snapshot=session.connectionMode==='supabase'?prepareKupaCloudState(fullSnapshot,{normalized:true}):fullSnapshot;
  if(typed&&autoCreditDeleteIds.length){const described=new Set(operations.filter(operation=>operation.type==='delete'&&operation.collection==='credits').map(operation=>operation.id));operations=[...operations,...autoCreditDeleteIds.filter(id=>!described.has(id)).map(id=>({type:'delete',collection:'credits',id}))]}
  else if(autoCreditDeleteIds.length){
    // A caller without a typed mutation may be doing more than normalization.
    // Read the committed journal and prove that only these credits disappeared
    // before turning the deletion into typed operations. Never infer a full
    // snapshot edit from the visible model.
    const riskToken=`state:${generation}`,visibleBefore=mainBusinessState(model.state),target=mainBusinessState(fullSnapshot);
    beginLocalRisk(riskToken);localDone();
    return (async()=>{
      const recovered=await recoverStorageV2State(),source=mainBusinessState(recovered?.state||{}),removed=new Set(autoCreditDeleteIds);
      if(!Array.isArray(source.credits)||autoCreditDeleteIds.some(id=>!source.credits.some(row=>row.id===id)))throw new Error('kupa_v2_normalization_source_changed');
      source.credits=source.credits.filter(row=>!removed.has(row.id));
      if(generation!==session.localGeneration||!equalSyncJson(visibleBefore,mainBusinessState(model.state))||!equalSyncJson(source,target))throw new Error('kupa_v2_untyped_mutation');
      const saved=await saveState(msg,{deleteIntents:effectiveDeleteIntents,mutationType,surface,domains,operations:autoCreditDeleteIds.map(id=>({type:'delete',collection:'credits',id}))});
      if(saved)clearLocalRisk(riskToken);
      return saved;
    })().catch(error=>{console.error('Kupa V2 credit normalization',error);setSaveStatus('השינוי לא נשמר — נדרשת בדיקת נתונים','error');return false});
  }
  const localOk=persistImmediateBrowserSnapshot(fullSnapshot,session.dbRevision,{normalized:true,owned:true,operations,generation,mutationType,surface,deleteIntents:effectiveDeleteIntents});
  localDone();
  const idbPending=!localOk&&storageV2DurabilityAtRisk();
  const riskToken=`state:${generation}`;if(!localOk)beginLocalRisk(riskToken);
  if(idbPending)clearLocalRiskAfter(riskToken,storageV2CommitPromise());
  if(!localOk&&!idbPending)setSaveStatus('שגיאת עותק מקומי','error');
  if(idbPending)setSaveStatus('ממתין לאישור שמירה ב־IndexedDB','saving');
  if(!localOk&&!idbPending)return Promise.resolve(false);
  markMainPending();
  const continueSave=async()=>{
    if(session.connectionMode==='supabase'&&session.backendReady){
      const head=await refreshStorageV2CloudState();
      if(!head?.base){setSaveStatus('ראש ענן V2 חסר — השינוי נשמר מקומית אך הסנכרון נעצר','error');return false}
      await storageV2CommitPromise();return requestCloudSave(snapshot,msg,generation);
    }
    session.saveQueue=session.saveQueue.catch(e=>{console.error('previous save queue',e)}).then(()=>persistState(snapshot,msg,generation,effectiveDeleteIntents));
    return session.saveQueue.then(ok=>{if(ok)clearLocalRisk(riskToken);return ok})
  };
  return idbPending?storageV2CommitPromise().then(continueSave,()=>{setSaveStatus('השינוי לא נשמר — אין לסגור את החלון','error');return false}):continueSave()
}

function saveChecksState(msg='הצק נשמר',{deletedIds=[],mutationType='autosave',surface='kupa.checks',operations=null}={}){
  if(!tab.primaryTab){showSecondaryTabGuard();return Promise.resolve(false)}
  if(sharedChecksV2?.requested){
    if(typeof checksStatus?.save!=='function'||typeof checksStatus?.cloud!=='function')throw new Error('shared_checks_status_port_required');
    const account=loadSession()?.user?.id;
    const cloudCurrent=()=>!!account&&loadSession()?.user?.id===account&&session.connectionMode==='supabase'&&session.backendReady&&sharedChecksV2.cloudReady;
    const failed=()=>{checksStatus.save('הצקים לא נשמרו — אין לסגור את החלון','error');if(cloudCurrent())checksStatus.cloud('conflict','ענן: שמירת הצ׳קים נעצרה — אחסון מקומי נכשל')};
    const generation=Number(checksSession.sharedChecksGeneration||0)+1,riskToken=`checks:${generation}`;let write;
    domainRevisions?.touch('checks');
    try{write=sharedChecksV2.persist(operations,{generation,surface,mutationType,deleteIds:deletedIds})}
    catch(error){beginLocalRisk(riskToken);failed();console.error('Shared Checks V2 save',error);return Promise.resolve(false)}
    checksSession.sharedChecksGeneration=generation;checksSession.sharedChecksSaveRequested=true;
    if(cloudCurrent())checksStatus.cloud(globalThis.navigator?.onLine===false?'offline':'syncing',globalThis.navigator?.onLine===false?'ענן: אופליין':'ענן: צ׳קים ממתינים לסנכרון');
    if(!write.emergencyDurable){beginLocalRisk(riskToken);clearLocalRiskAfter(riskToken,write.committed)}
    checksStatus.save(write.emergencyDurable?'הצקים שמורים מקומית':'ממתין לאישור שמירת הצקים ב־IndexedDB','saving');
    write.committed.catch(failed);
    if(files.backupsDirHandle)write.committed.then(()=>nextTurn(()=>backupSnapshotToComputer(normalizeState(model.state),session.dbRevision))).catch(error=>console.error('checks backup',error));
    clearTimeout(checksSession.sharedChecksSaveTimer);
    if(session.connectionMode==='supabase'&&session.backendReady)checksSession.sharedChecksSaveTimer=setTimeout(async()=>{checksSession.sharedChecksSaveTimer=null;try{await write.committed;await saveSharedChecksToCloud(msg)}catch(error){console.error('checks sync',error)}},220);
    return write.committed.then(()=>true,()=>false);
  }
  beginLocalRisk(`checks:${Number(checksSession.sharedChecksGeneration||0)+1}`);
  setSaveStatus('Shared Checks V2 is required before saving checks','error');
  return Promise.resolve(false);
}

async function persistState(snapshot,msg,generation=session.localGeneration){
  if(!storageV2Primary()){setSaveStatus('אחסון V2 אינו מוכן — השמירה נעצרה','error');return false}
  if(!session.backendReady){setSaveStatus('לא מחובר למקור נתונים','error');return false}
  if(generation===session.localGeneration)snapshot=session.connectionMode==='supabase'?prepareKupaCloudState(model.state):normalizeState(model.state);
  if(session.connectionMode==='supabase')return persistSupabaseState(prepareKupaCloudState(snapshot),msg,generation);
  if(!files.dataFileHandle){setSaveStatus('אין קובץ נתונים','error');return false}
  if(session.localFileConflictPending){setSaveStatus('התנגשות בקובץ — השינוי שמור ב־V2','error');return false}
  setSaveStatus(generation===session.localGeneration?'שומר…':'שומר תור שינויים…','saving');
  try{
    // A file is an export of the journals. Never let it create or replace a
    // Main checkpoint, even when the owner has no cloud cursor.
    await storageV2CommitPromise();
    if(!sharedChecksV2?.flush||!sharedChecksV2?.recoverReadOnly)throw new Error('storage_v2_local_file_shared_head_required');
    await sharedChecksV2.flush();
    const [recovered,shared]=await Promise.all([recoverStorageV2State(),sharedChecksV2.recoverReadOnly()]);
    if(!recovered||!equalSyncJson(mainBusinessState(recovered.state),mainBusinessState(model.state)))throw new Error('storage_v2_local_file_unjournaled_state');
    if(generation===session.localGeneration&&!equalSyncJson(mainBusinessState(snapshot),mainBusinessState(recovered.state)))throw new Error('storage_v2_local_file_unjournaled_normalization');
    if(!shared||!equalSyncJson(shared.state?.checks,snapshot.checks))throw new Error('storage_v2_local_file_unjournaled_checks');
    const current=await readJsonHandle(files.dataFileHandle),curMeta=current?._meta||{},curRev=Number(curMeta.revision||0);
    assertPortablePayload(current); // Reject a malformed file instead of overwriting it.
    if(curRev!==session.dbRevision){
      session.localFileConflictPending=true;
      setSaveStatus('קובץ הנתונים השתנה — השמירה לקובץ נעצרה','error');
      reportError('קובץ הנתונים השתנה מחוץ לאפליקציה. השינוי המקומי שמור ב־Storage V2 ולא ייכתב על הקובץ שהשתנה. ייצא גיבוי לפני פתיחה מחדש: פתיחת הקובץ תייבא את תוכנו ותחליף את המצב המקומי.');
      return false;
    }
    const nextRev=curRev+1,payload=payloadFromState(snapshot,nextRev);
    await writeJsonHandleVerified(files.dataFileHandle,payload);
    session.dbRevision=nextRev;session.lastSavedSnapshot=JSON.stringify(snapshot);session.serverInfo.lastSavedAt=payload._meta.savedAt;
    if(files.backupsDirHandle)await backupSnapshotToComputer(snapshot,nextRev);session.serverInfo.backups=await listBackups();
    if(generation===session.localGeneration&&!session.localFileConflictPending){setSaveStatus('נשמר בקובץ','ok');toast(msg)}else if(!session.localFileConflictPending)setSaveStatus('שומר שינוי נוסף…','saving');
    return !session.localFileConflictPending
  }catch(e){console.error(e);setSaveStatus('שגיאת שמירה לקובץ — בדוק את מצב V2','error');reportError('השמירה לקובץ נכשלה. בדוק את מצב Storage V2 ואת הגישה לתיקייה לפני ניסיון נוסף; הקובץ הקיים לא יידרס אוטומטית.');return false}
}

return { loadState, saveState, saveChecksState, persistState };
}
