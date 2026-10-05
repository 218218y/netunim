import {createSyncChecksPersistence} from '../sync/checks-persistence.js';

export function composeChecksPersistence({model,session,checksSession,storageBrowser,uiStatus,uiFolderStatus,storagePersistence,storageFiles,cloudAuth,syncChecks,uiAlertCenter,domainRevisions,sharedChecksV2}){
  return createSyncChecksPersistence({
    model,session,checksSession,sharedChecksV2,
    toast:(...args)=>uiStatus.toast(...args),
    setSave:(...args)=>uiStatus.setSave(...args),
    syncFolderAccessButton:(...args)=>uiFolderStatus.syncFolderAccessButton(...args),
    folderBackupAvailable:(...args)=>uiFolderStatus.folderBackupAvailable(...args),
    folderSaveTitle:(...args)=>uiFolderStatus.folderSaveTitle(...args),
    rejectSecondaryMutation:(...args)=>storagePersistence.rejectSecondaryMutation(...args),
    writeStateToFolder:(...args)=>storageFiles().writeStateToFolder(...args),
    loadSession:(...args)=>cloudAuth.loadSession(...args),
    saveSharedChecksToCloud:(...args)=>syncChecks().saveSharedChecksToCloud(...args),
    refreshAlertCenter:(...args)=>uiAlertCenter().refreshIndicator(...args),
    touchChecksRevision:()=>domainRevisions.touch('checks'),
  });
}
