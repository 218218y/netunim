

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createStoragePersistence({model, tab, session, ui, normalizeState, loadLocal, showSecondaryTabGuard, render, localSnapshot, markCloudPending, setSave, syncFolderAccessButton, folderBackupAvailable, folderSaveTitle, writeStateToFolder, cloudEnabled, requestCloudSave, cloudPendingExists, toast, setCloud, folderPermissionPending, sameBusinessData, cloudHasLocalWork, checksHaveLocalWork, loadSession, saveSharedChecksToCloud}){
function rejectSecondaryMutation(){if(tab.primaryTab)return false;const saved=loadLocal();if(saved)model.state=normalizeState(saved);render();showSecondaryTabGuard();return true}

function scheduleSave(message='השינויים נשמרו'){
  if(rejectSecondaryMutation())return;
  const generation=++session.localGeneration,localOk=localSnapshot();
  if(cloudEnabled()){if(localOk)markCloudPending();session.cloudSaveRequested=true;session.cloudSaveMessage=message}
  setSave(localOk?'מקומי: שומר…':'מקומי: שגיאה',localOk?'':'error',folderSaveTitle());
  clearTimeout(session.saveTimer);session.saveTimer=setTimeout(async()=>{session.saveTimer=null;try{if(folderBackupAvailable())await writeStateToFolder();else syncFolderAccessButton()}catch(e){console.error('folder save',e)}if(generation===session.localGeneration&&localOk)setSave('מקומי: שמור','',folderSaveTitle());if(cloudEnabled())await requestCloudSave(message)},180);
}

async function manualSaveNow(){
  if(rejectSecondaryMutation())return;
  const localOk=localSnapshot();setSave(localOk?'מקומי: שומר…':'מקומי: שגיאה',localOk?'':'error',folderSaveTitle());
  if(cloudEnabled()&&localOk&&(cloudPendingExists()||!session.lastCloudState||!sameBusinessData(model.state,session.lastCloudState)))markCloudPending();
  clearTimeout(session.saveTimer);session.saveTimer=null;
  try{if(folderBackupAvailable())await writeStateToFolder();else syncFolderAccessButton()}catch(e){console.error('manual folder save',e)}
  if(localOk)setSave('מקומי: שמור','',folderSaveTitle());
  let cloudOk=true,checksOk=true;
  if(cloudEnabled()&&cloudHasLocalWork())cloudOk=await requestCloudSave('השמירה הושלמה');else if(cloudEnabled())setCloud('ענן: מסונכרן','synced');
  if(loadSession()&&checksHaveLocalWork())checksOk=await saveSharedChecksToCloud('הצ\'קים סונכרנו');
  if(localOk&&cloudOk&&checksOk&&!cloudHasLocalWork()&&!checksHaveLocalWork())toast(folderPermissionPending()?'הדפדפן והענן שמורים; התיקייה ממתינה לאישור':'הכל שמור ומסונכרן');
}

return { rejectSecondaryMutation, scheduleSave, manualSaveNow };
}
