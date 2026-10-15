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

return {loadState};
}
