

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createSyncChecksPersistence({model, session, checksSession, localSnapshot, markChecksPending, toast, setSave, syncFolderAccessButton, folderBackupAvailable, folderSaveTitle, rejectSecondaryMutation, writeStateToFolder, loadSession, saveSharedChecksToCloud, storageV2=null, sharedChecksV2=null, refreshAlertCenter=()=>{}, touchChecksRevision=()=>{}, observeSharedChecks=()=>false}){
function scheduleCheckSave(message,{deletedIds=[],mutationType='autosave',surface='orders.checks',operations=null,storageBoundary=''}={}){
  if(rejectSecondaryMutation())return false;
  touchChecksRevision();refreshAlertCenter();
  const generation=++session.localGeneration,deleteIntents={checks:deletedIds};
  if(sharedChecksV2?.requested){
    const riskToken=`checks:${generation}`;let write;
    try{write=sharedChecksV2.persist(operations,{generation,surface,mutationType,deleteIds:deletedIds,storageBoundary})}
    catch(error){(session.localUndurableGenerations??=new Set()).add(riskToken);setSave('הצ׳ק לא נשמר — אין לסגור את החלון','error',folderSaveTitle());console.error('Shared Checks V2 save',error);return false}
    checksSession.checksGeneration++;checksSession.checksSaveRequested=true;
    if(!write.emergencyDurable)(session.localUndurableGenerations??=new Set()).add(riskToken);
    setSave(write.emergencyDurable?'מקומי: שמור':'מקומי: ממתין לאישור IndexedDB','',folderSaveTitle());
    write.committed.then(()=>{session.localUndurableGenerations?.delete(riskToken);setSave('מקומי: שמור','',folderSaveTitle())},()=>setSave('הצ׳ק לא נשמר — אין לסגור את החלון','error',folderSaveTitle()));
    clearTimeout(session.saveTimer);session.saveTimer=setTimeout(async()=>{session.saveTimer=null;try{await write.committed;if(folderBackupAvailable())await writeStateToFolder();else syncFolderAccessButton()}catch(error){console.error('checks backup',error)}},180);
    if(loadSession())queueSharedChecksSave(message,write.committed);
    else if(message)write.committed.then(()=>toast(message),()=>{});
    return write.emergencyDurable;
  }
  const localOk=localSnapshot(undefined,{operations,storageBoundary,generation,mutationType,surface,deleteIntents});
  observeSharedChecks(operations,{generation,surface,mutationType,deleteIds:deletedIds,boundary:!!storageBoundary});
  const idbPending=!localOk&&!!storageV2?.durabilityAtRisk;
  const durable=idbPending?storageV2.commitPromise:null;
  const riskToken=`checks:${generation}`;
  if(!localOk)(session.localUndurableGenerations??=new Set()).add(riskToken);
  checksSession.checksGeneration++;
  setSave(localOk?'מקומי: שומר…':idbPending?'מקומי: ממתין לאישור IndexedDB':'מקומי: שגיאה',localOk||idbPending?'':'error',folderSaveTitle());
  if(durable)durable.then(()=>{session.localUndurableGenerations?.delete(riskToken);if(generation===session.localGeneration)setSave('מקומי: שמור','',folderSaveTitle())},()=>setSave('הצ׳ק לא נשמר — אין לסגור את החלון','error',folderSaveTitle()));
  clearTimeout(session.saveTimer);
  session.saveTimer=setTimeout(async()=>{session.saveTimer=null;try{if(folderBackupAvailable()){if(await writeStateToFolder())session.localUndurableGenerations?.delete(riskToken)}else syncFolderAccessButton()}catch(e){console.error('folder save',e)}if(generation===session.localGeneration&&localOk)setSave('מקומי: שמור','',folderSaveTitle())},180);
  if(loadSession()){markChecksPending(model?.state?.checks,undefined,undefined,{deleteIds:deletedIds,mutationType,surface});checksSession.checksOutboxCommitPromise?.then(()=>session.localUndurableGenerations?.delete(riskToken),()=>{});queueSharedChecksSave(message,durable)}
  else if(message){if(durable)durable.then(()=>toast(message),()=>{});else toast(message)}
  return localOk;
}

function queueSharedChecksSave(message='צ\'קים סונכרנו',durable=null){
  checksSession.sharedChecksSaveMessage=message;checksSession.checksSaveMessage=message;checksSession.checksSaveRequested=true;
  clearTimeout(checksSession.sharedChecksSaveTimer);if(checksSession.checksSavePromise)return;
  checksSession.sharedChecksSaveTimer=setTimeout(async()=>{
    checksSession.sharedChecksSaveTimer=null;
    if(durable)try{await durable}catch{setSave('הצ׳ק לא נשמר — אין לסגור את החלון','error',folderSaveTitle());return}
    await saveSharedChecksToCloud(checksSession.sharedChecksSaveMessage);
  },260);
}

return { scheduleCheckSave, queueSharedChecksSave };
}
