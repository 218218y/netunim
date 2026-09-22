import {beginMeasure} from '../shared/runtime-performance.js';


// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createStoragePersistence({model, tab, session, ui, domainRevisions, normalizeState, loadLocal, showSecondaryTabGuard, render, localSnapshot, markCloudPending, storageV2CloudOutboxActive=()=>false, storageV2CommitPromise=()=>Promise.resolve(), storageV2DurabilityAtRisk=()=>false, setSave, syncFolderAccessButton, folderBackupAvailable, folderSaveTitle, writeStateToFolder, cloudEnabled, requestCloudSave, cloudPendingExists, toast, setCloud, folderPermissionPending, sameBusinessData, cloudHasLocalWork, checksHaveLocalWork, loadSession, saveSharedChecksToCloud}){
function rejectSecondaryAction(){if(tab.primaryTab)return false;showSecondaryTabGuard();return true}
function rejectSecondaryMutation(){if(session.syncCapabilitiesError){setCloud(session.syncCapabilitiesError.message,'error');return true}if(tab.primaryTab)return false;const saved=loadLocal();if(saved){const previous=model.state;model.state=normalizeState(saved);domainRevisions?.reconcile(previous,model.state)}render();showSecondaryTabGuard();return true}

function scheduleSave(message='השינויים נשמרו',{deleteIntents={},mutationType='autosave',surface='orders',domains=null,operations=null,storageBoundary=''}={}){
  if(rejectSecondaryMutation())return false;
  if(Array.isArray(domains)&&domains.length)domainRevisions?.touch(domains);else domainRevisions?.touchAll();
  const localDone=beginMeasure('orders:save-local',{paint:true});
  const generation=++session.localGeneration,localOk=localSnapshot(undefined,{operations,storageBoundary,generation,mutationType,surface,deleteIntents}),idbPending=!localOk&&storageV2DurabilityAtRisk();localDone();
  if(!localOk)(session.localUndurableGenerations??=new Set()).add(generation);
  if(cloudEnabled()){const v2=storageV2CloudOutboxActive()&&(localOk||idbPending);if(!v2)markCloudPending(undefined,'',{deleteIntents,mutationType,surface});session.cloudSaveRequested=true;session.cloudSaveMessage=message}
  if(cloudEnabled()||idbPending){const durable=idbPending||storageV2CloudOutboxActive()?storageV2CommitPromise():session.ordersOutboxCommitPromise;durable?.then(()=>{session.localUndurableGenerations?.delete(generation);if(generation===session.localGeneration)setSave(cloudEnabled()?'מקומי: שינוי שמור וממתין לסנכרון':'מקומי: שמור','',folderSaveTitle())},()=>{setSave('השינוי לא נשמר באחסון הדפדפן — אין לסגור את החלון','error');setCloud('ענן: השמירה נעצרה — אחסון מקומי נכשל','error')})}
  setSave(localOk?'מקומי: שומר…':idbPending?'מקומי: ממתין לאישור IndexedDB':'מקומי: שגיאה',localOk||idbPending?'':'error',folderSaveTitle());
  clearTimeout(session.saveTimer);session.saveTimer=setTimeout(async()=>{session.saveTimer=null;try{if(folderBackupAvailable()){if(await writeStateToFolder())session.localUndurableGenerations?.delete(generation)}else syncFolderAccessButton()}catch(e){console.error('folder save',e)}if(generation===session.localGeneration&&localOk)setSave('מקומי: שמור','',folderSaveTitle());if(cloudEnabled()){try{await (idbPending||storageV2CloudOutboxActive()?storageV2CommitPromise():session.ordersOutboxCommitPromise);await requestCloudSave(message)}catch(error){console.error('durable staging',error);setSave('השינוי לא נשמר — אין לסגור את החלון','error')}}},180);
  return localOk;
}

async function manualSaveNow(){
  if(rejectSecondaryMutation())return;
  const localOk=localSnapshot(undefined,{storageBoundary:'manual-flush'});setSave(localOk?'מקומי: שומר…':'מקומי: שגיאה',localOk?'':'error',folderSaveTitle());
  if(cloudEnabled()&&!storageV2CloudOutboxActive()&&(cloudPendingExists()||!session.lastCloudState||!sameBusinessData(model.state,session.lastCloudState)))markCloudPending();
  clearTimeout(session.saveTimer);session.saveTimer=null;
  try{if(folderBackupAvailable())await writeStateToFolder();else syncFolderAccessButton()}catch(e){console.error('manual folder save',e)}
  if(localOk)setSave('מקומי: שמור','',folderSaveTitle());
  try{await (storageV2CloudOutboxActive()?storageV2CommitPromise():session.ordersOutboxCommitPromise)}catch(error){console.error('manual durable staging',error);setSave('השינוי לא נשמר — אין לסגור את החלון','error');setCloud('ענן: אחסון מקומי נכשל','error');return false}
  let cloudOk=true,checksOk=true;
  if(cloudEnabled()&&cloudHasLocalWork())cloudOk=await requestCloudSave('השמירה הושלמה');else if(cloudEnabled())setCloud('ענן: מסונכרן','synced');
  if(loadSession()&&checksHaveLocalWork())checksOk=await saveSharedChecksToCloud('הצ\'קים סונכרנו');
  if(localOk&&cloudOk&&checksOk&&!cloudHasLocalWork()&&!checksHaveLocalWork())toast(folderPermissionPending()?'הדפדפן והענן שמורים; התיקייה ממתינה לאישור':'הכל שמור ומסונכרן');
}

return { rejectSecondaryAction, rejectSecondaryMutation, scheduleSave, manualSaveNow };
}
