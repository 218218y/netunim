

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createSyncChecksPersistence({session, checksSession, toast, setSave, setCloud, syncFolderAccessButton, folderBackupAvailable, folderSaveTitle, rejectSecondaryMutation, writeStateToFolder, loadSession, saveSharedChecksToCloud, sharedChecksV2=null, refreshAlertCenter=()=>{}, touchChecksRevision=()=>{}}){
function scheduleCheckSave(message,{deletedIds=[],mutationType='autosave',surface='orders.checks',operations=null}={}){
  if(rejectSecondaryMutation())return false;
  touchChecksRevision();refreshAlertCenter();
  const generation=++session.localGeneration;
  if(sharedChecksV2?.requested){
    const owner=loadSession()?.user?.id;
    const cloudCurrent=()=>!!owner&&loadSession()?.user?.id===owner&&sharedChecksV2.cloudReady;
    const failed=()=>{setSave('הצ׳ק לא נשמר — אין לסגור את החלון','error',folderSaveTitle());if(cloudCurrent())setCloud('ענן: שמירת הצ׳קים נעצרה — אחסון מקומי נכשל','error')};
    const riskToken=`checks:${generation}`;let write;
    try{write=sharedChecksV2.persist(operations,{generation,surface,mutationType,deleteIds:deletedIds})}
    catch(error){(session.localUndurableGenerations??=new Set()).add(riskToken);failed();console.error('Shared Checks V2 save',error);return false}
    checksSession.checksGeneration++;checksSession.checksSaveRequested=true;
    if(cloudCurrent())setCloud(globalThis.navigator?.onLine===false?'ענן: אופליין':'ענן: צ׳קים ממתינים לסנכרון',globalThis.navigator?.onLine===false?'offline':'');
    if(!write.emergencyDurable)(session.localUndurableGenerations??=new Set()).add(riskToken);
    setSave(write.emergencyDurable?'מקומי: שמור':'מקומי: ממתין לאישור IndexedDB','',folderSaveTitle());
    write.committed.then(()=>{session.localUndurableGenerations?.delete(riskToken);setSave('מקומי: שמור','',folderSaveTitle())},failed);
    clearTimeout(session.saveTimer);session.saveTimer=setTimeout(async()=>{session.saveTimer=null;try{await write.committed;if(folderBackupAvailable())await writeStateToFolder();else syncFolderAccessButton()}catch(error){console.error('checks backup',error)}},180);
    if(loadSession())queueSharedChecksSave(message,write.committed);
    else if(message)write.committed.then(()=>toast(message),()=>{});
    return write.emergencyDurable;
  }
  (session.localUndurableGenerations??=new Set()).add(`checks:${generation}`);
  setSave('Shared Checks V2 is required before saving checks','error',folderSaveTitle());
  return false;
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
