import {beginMeasure} from '../shared/runtime-performance.js';


// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createStoragePersistence({model, tab, session, ui, domainRevisions, showSecondaryTabGuard, localSnapshot, storageV2CloudOutboxActive=()=>false, storageV2CommitPromise=()=>Promise.resolve(), storageV2DurabilityAtRisk=()=>false, setSave, syncFolderAccessButton, folderBackupAvailable, folderSaveTitle, writeStateToFolder, cloudEnabled, requestCloudSave, toast, setCloud, folderPermissionPending, cloudHasLocalWork, checksHaveLocalWork, loadSession, saveSharedChecksToCloud}){
function canMutate(){return tab.primaryTab===true&&!session.syncCapabilitiesError}
function rejectSecondaryAction(){if(tab.primaryTab)return false;showSecondaryTabGuard();return true}
function rejectSecondaryMutation(){
  if(session.syncCapabilitiesError){setCloud(session.syncCapabilitiesError.message,'error');return true}
  if(tab.primaryTab)return false;
  // A rejected edit may already have changed the in-memory model. Reload so
  // startup restores both authoritative V2 journals; never display a V1 copy.
  showSecondaryTabGuard();globalThis.location?.reload?.();return true;
}

function scheduleSave(message='השינויים נשמרו',{deleteIntents={},mutationType='autosave',surface='orders',domains=null,operations=null,storageBoundary=''}={}){
  if(rejectSecondaryMutation())return false;
  if(cloudEnabled()&&!storageV2CloudOutboxActive()){setSave('האחסון בענן עדיין לא מוכן — השינוי לא נשמר','error');setCloud('ענן: נדרשת התאוששות V2','error');globalThis.location?.reload?.();return false}
  if(Array.isArray(domains)&&domains.length)domainRevisions?.touch(domains);else domainRevisions?.touchAll();
  const localDone=beginMeasure('orders:save-local',{paint:true});
  const generation=++session.localGeneration,localOk=localSnapshot(undefined,{operations,storageBoundary,generation,mutationType,surface,deleteIntents}),idbPending=!localOk&&storageV2DurabilityAtRisk();localDone();
  if(!localOk)(session.localUndurableGenerations??=new Set()).add(generation);
  if(cloudEnabled()){session.cloudSaveRequested=true;session.cloudSaveMessage=message}
  if(cloudEnabled()||idbPending){const durable=storageV2CommitPromise();durable?.then(()=>{session.localUndurableGenerations?.delete(generation);if(generation===session.localGeneration)setSave(cloudEnabled()?'מקומי: שינוי שמור וממתין לסנכרון':'מקומי: שמור','',folderSaveTitle())},()=>{setSave('השינוי לא נשמר באחסון הדפדפן — אין לסגור את החלון','error');setCloud('ענן: השמירה נעצרה — אחסון מקומי נכשל','error')})}
  setSave(localOk?'מקומי: שומר…':idbPending?'מקומי: ממתין לאישור IndexedDB':'מקומי: שגיאה',localOk||idbPending?'':'error',folderSaveTitle());
  clearTimeout(session.saveTimer);session.saveTimer=setTimeout(async()=>{session.saveTimer=null;try{if(folderBackupAvailable()){if(await writeStateToFolder())session.localUndurableGenerations?.delete(generation)}else syncFolderAccessButton()}catch(e){console.error('folder save',e)}if(generation===session.localGeneration&&localOk)setSave('מקומי: שמור','',folderSaveTitle());if(cloudEnabled()){try{await storageV2CommitPromise();await requestCloudSave(message)}catch(error){console.error('durable staging',error);setSave('השינוי לא נשמר — אין לסגור את החלון','error')}}},180);
  return localOk;
}

async function manualSaveNow(){
  if(rejectSecondaryMutation())return;
  const localOk=localSnapshot(undefined,{storageBoundary:'manual-flush'});setSave(localOk?'מקומי: שומר…':'מקומי: שגיאה',localOk?'':'error',folderSaveTitle());
  if(cloudEnabled()&&!storageV2CloudOutboxActive()){setSave('האחסון בענן עדיין לא מוכן — השמירה נעצרה','error');setCloud('ענן: נדרשת התאוששות V2','error');return false}
  clearTimeout(session.saveTimer);session.saveTimer=null;
  try{if(folderBackupAvailable())await writeStateToFolder();else syncFolderAccessButton()}catch(e){console.error('manual folder save',e)}
  if(localOk)setSave('מקומי: שמור','',folderSaveTitle());
  try{await storageV2CommitPromise()}catch(error){console.error('manual durable staging',error);setSave('השינוי לא נשמר — אין לסגור את החלון','error');setCloud('ענן: אחסון מקומי נכשל','error');return false}
  let cloudOk=true,checksOk=true;
  if(cloudEnabled()&&cloudHasLocalWork())cloudOk=await requestCloudSave('השמירה הושלמה');else if(cloudEnabled())setCloud('ענן: מסונכרן','synced');
  if(loadSession()&&checksHaveLocalWork())checksOk=await saveSharedChecksToCloud('הצ\'קים סונכרנו');
  if(localOk&&cloudOk&&checksOk&&!cloudHasLocalWork()&&!checksHaveLocalWork())toast(folderPermissionPending()?'הדפדפן והענן שמורים; התיקייה ממתינה לאישור':'הכל שמור ומסונכרן');
}

return { canMutate, rejectSecondaryAction, rejectSecondaryMutation, scheduleSave, manualSaveNow };
}
