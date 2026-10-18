import {equalSyncJson} from '../shared/cloud-sync.js';
import {applyStorageV2LocalImport} from '../shared/storage-v2-local-import.js';
import {mainBusinessState} from './main-state.js';

// A file import crosses Main and Shared through the durable boundary. It never
// manufactures a cloud cursor or publishes visible state before both commit.
export function createLocalFileAdoption({model,session,tab,journal,file,projection,view}){
const {sharedChecksV2,storageV2Boundary,storageV2Primary,recoverStorageV2State,refreshStorageV2CloudState}=journal;
const {files,checksSession,readJsonHandle,captureLegacyWorkbook,listBackups,backupSnapshotToComputer}=file;
const {stateFromPayload,domainRevisions}=projection;
const {showSecondaryTabGuard,setConnectedStatus,setSaveStatus}=view;
async function loadState({automatic=false,source={...files,connectionMode:session.connectionMode},assertCurrent=()=>{},installSource=()=>{}}={}){
  assertCurrent();
  if(tab?.primaryTab===false){showSecondaryTabGuard();throw new Error('storage_v2_local_file_primary_tab_required')}
  if(!storageV2Primary()||!storageV2Boundary||!(sharedChecksV2?.primaryReady||sharedChecksV2?.localReady))throw new Error('storage_v2_local_file_journals_required');
  if(!source.dataFileHandle)throw new Error('לא נבחר קובץ נתונים');
  const payload=await readJsonHandle(source.dataFileHandle);assertCurrent();
  const parsed=stateFromPayload(payload);
  if(automatic){
    const [main,shared]=await Promise.all([recoverStorageV2State(),sharedChecksV2.recover()]);
    assertCurrent();
    if(!main||!shared||!equalSyncJson(mainBusinessState(main.state),mainBusinessState(parsed.state))||
      !equalSyncJson(shared.state?.checks,parsed.state.checks))throw new Error('storage_v2_local_file_requires_confirmation');
  }
  // All candidate I/O and projection must succeed before the durable import and
  // synchronous installation. A catalog failure cannot publish half a source.
  const backups=await listBackups(source.backupsDirHandle);assertCurrent();
  const lastSavedSnapshot=JSON.stringify(parsed.state);
  const serverInfo={schemaVersion:Number(parsed.meta.schemaVersion||6),lastSavedAt:parsed.meta.savedAt||null,databaseFile:source.dataFileHandle.name,backups};
  await captureLegacyWorkbook(payload.notesSheet);
  assertCurrent();
  const cloud=await refreshStorageV2CloudState();
  assertCurrent();
  if(cloud?.base){
    // A local file is never evidence of a cloud ACK. Preserve both cloud
    // cursors and make the complete file state pending in both journals.
    if(!sharedChecksV2.primaryReady)throw new Error('storage_v2_local_file_shared_head_required');
    if(!equalSyncJson(model.state,parsed.state)){
      const sharedCloud=await sharedChecksV2.cloudState();assertCurrent();
      await applyStorageV2LocalImport({
        boundary:storageV2Boundary,
        mainCloud:cloud,
        sharedCloud,
        mainState:parsed.state,
        sharedState:{checks:parsed.state.checks,bankEvents:checksSession.sharedChecksBankEvents||[]},
      });
      assertCurrent();
      await refreshStorageV2CloudState();
      assertCurrent();
    }
  }else{
    if(!sharedChecksV2.localReady)throw new Error('storage_v2_local_file_shared_head_required');
    if(!equalSyncJson(model.state,parsed.state)){
      const mainLocal=await recoverStorageV2State(),sharedLocal=await sharedChecksV2.recover();
      assertCurrent();
      if(!mainLocal||!sharedLocal)throw new Error('storage_v2_local_file_checkpoint_missing');
      await applyStorageV2LocalImport({boundary:storageV2Boundary,mode:'local-only',mainLocal,sharedLocal,
        mainState:parsed.state,sharedState:{checks:parsed.state.checks,bankEvents:checksSession.sharedChecksBankEvents||[]}});
      assertCurrent();
    }
  }
  const previous=model.state;
  // No asynchronous work after this point: file references and visible state
  // are installed in the same turn, after both journals acknowledge the import.
  assertCurrent();installSource();
  model.state=parsed.state;
  domainRevisions?.reconcile(previous,model.state,{forceAll:true});
  session.dbRevision=Number(parsed.meta.revision||0);
  session.backendReady=true;
  session.localFileConflictPending=false;
  session.lastSavedSnapshot=lastSavedSnapshot;
  session.serverInfo=serverInfo;
  if(source.backupsDirHandle){
    // A backup is a secondary copy. Its failure must not turn an already
    // committed source change into an apparent import failure.
    const revision=session.dbRevision;
    Promise.resolve().then(()=>{if(files.backupsDirHandle===source.backupsDirHandle)return backupSnapshotToComputer(parsed.state,revision)}).catch(error=>console.error('local file adoption backup',error));
  }
  setConnectedStatus(source.connectionMode==='directory'?'תיקיית קופה מחוברת':'קובץ נתונים מחובר');
  setSaveStatus('נשמר בקובץ','ok');
  return model.state;
}

return {loadState};
}
