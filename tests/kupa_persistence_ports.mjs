import {createStoragePersistence as compose} from '../netunim-kupa/site/assets/js/storage/persistence.js';

// Test-only translation of historical stand-ins. Production requires the
// grouped owner ports and has no flat compatibility API.
export function createStoragePersistence(p){
  return compose({model:p.model,session:p.session,tab:p.tab,
    journal:{
      sharedChecksV2:p.sharedChecksV2??null,storageV2Boundary:p.storageV2Boundary??null,
      storageV2Primary:p.storageV2Primary??(()=>false),
      storageV2CommitPromise:p.storageV2CommitPromise??(()=>Promise.resolve(true)),
      storageV2DurabilityAtRisk:p.storageV2DurabilityAtRisk??(()=>false),
      recoverStorageV2State:p.recoverStorageV2State??(async()=>null),
      refreshStorageV2CloudState:p.refreshStorageV2CloudState??(async()=>null),
      persistImmediateBrowserSnapshot:p.persistImmediateBrowserSnapshot,
    },
    projection:{domainRevisions:p.domainRevisions,creditNormalizationMayDelete:p.creditNormalizationMayDelete??(()=>true),
      normalizeState:p.normalizeState,prepareKupaCloudState:p.prepareKupaCloudState,stateFromPayload:p.stateFromPayload},
    file:{files:p.files,checksSession:p.checksSession,readJsonHandle:p.readJsonHandle,
      writeJsonHandleVerified:p.writeJsonHandleVerified,captureLegacyWorkbook:p.captureLegacyWorkbook??(async()=>{}),
      listBackups:p.listBackups,backupSnapshotToComputer:p.backupSnapshotToComputer},
    cloud:{persistSupabaseState:p.persistSupabaseState},
    view:{setSaveStatus:p.setSaveStatus,setConnectedStatus:p.setConnectedStatus,setCloudHeaderStatus:p.setCloudHeaderStatus??(()=>{}),
      showSecondaryTabGuard:p.showSecondaryTabGuard,reportError:p.reportError,toast:p.toast,
      isOnline:()=>globalThis.navigator?.onLine!==false},
  });
}
