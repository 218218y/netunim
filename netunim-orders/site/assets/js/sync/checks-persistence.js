

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createSyncChecksPersistence({model, session, checksSession, localSnapshot, markChecksPending, toast, setSave, syncFolderAccessButton, folderBackupAvailable, folderSaveTitle, rejectSecondaryMutation, writeStateToFolder, loadSession, saveSharedChecksToCloud, refreshAlertCenter=()=>{}}){
function scheduleCheckSave(message,{deletedIds=[],mutationType='autosave',surface='orders.checks'}={}){if(rejectSecondaryMutation())return;refreshAlertCenter();const generation=++session.localGeneration,localOk=localSnapshot();checksSession.checksGeneration++;setSave(localOk?'מקומי: שומר…':'מקומי: שגיאה',localOk?'':'error',folderSaveTitle());clearTimeout(session.saveTimer);session.saveTimer=setTimeout(async()=>{session.saveTimer=null;try{if(folderBackupAvailable())await writeStateToFolder();else syncFolderAccessButton()}catch(e){console.error('folder save',e)}if(generation===session.localGeneration&&localOk)setSave('מקומי: שמור','',folderSaveTitle())},180);if(loadSession()){markChecksPending(model?.state?.checks,undefined,undefined,{deleteIds:deletedIds,mutationType,surface});queueSharedChecksSave(message)}else if(message)toast(message)}

function queueSharedChecksSave(message='צ\'קים סונכרנו'){checksSession.sharedChecksSaveMessage=message;checksSession.checksSaveMessage=message;checksSession.checksSaveRequested=true;clearTimeout(checksSession.sharedChecksSaveTimer);if(checksSession.checksSavePromise)return;checksSession.sharedChecksSaveTimer=setTimeout(()=>{checksSession.sharedChecksSaveTimer=null;saveSharedChecksToCloud(checksSession.sharedChecksSaveMessage)},260)}

return { scheduleCheckSave, queueSharedChecksSave };
}
