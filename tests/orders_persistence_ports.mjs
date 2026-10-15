import {createStoragePersistence as compose} from '../netunim-orders/site/assets/js/storage/persistence.js';
import {createMainSyncBrowserPorts} from '../shared/main-sync-browser.js';

// Explicit adapter for older behavior fixtures; production binds role ports.
export function createStoragePersistence(p) {
  return compose({
    access:{primary:()=>p.tab.primaryTab===true,error:()=>p.session.syncCapabilitiesError,showSecondaryTabGuard:p.showSecondaryTabGuard},
    session:p.session,
    journal:{localSnapshot:p.localSnapshot,storageV2CommitPromise:p.storageV2CommitPromise??(()=>Promise.resolve(true)),storageV2DurabilityAtRisk:p.storageV2DurabilityAtRisk??(()=>false)},
    projection:{touch:domains=>p.domainRevisions?.touch(domains),touchAll:()=>p.domainRevisions?.touchAll()},
    mirror:{available:p.folderBackupAvailable,write:p.writeStateToFolder,refreshAccess:p.syncFolderAccessButton},
    cloud:{enabled:p.cloudEnabled,save:p.requestCloudSave},
    view:{setSave:p.setSave,setCloud:p.setCloud,folderSaveTitle:p.folderSaveTitle},
    platform:{...createMainSyncBrowserPorts(),...p.platform,...(p.timers?{timers:p.timers}:{})},
  });
}
