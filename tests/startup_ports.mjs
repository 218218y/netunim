import {createStorageStartupProtocol} from '../shared/storage-startup-protocol.js';
import {createStorageStartupRecovery} from '../shared/storage-startup-recovery.js';
import {createOrdersCloudStartup} from '../netunim-orders/site/assets/js/startup/cloud-hydration.js';
import {createOrdersLocalServices} from '../netunim-orders/site/assets/js/startup/local-services.js';
import {createOrdersBackgroundStartup} from '../netunim-orders/site/assets/js/startup/background.js';
import {createStorageBrowser} from '../netunim-orders/site/assets/js/storage/browser.js';

// Test controls expose independent failure/owner scenarios. Production obtains
// this protocol port directly from its configured Storage V2 coordinator.
export function withStorageProtocol(controls){
  const storageRecovery=createStorageStartupRecovery();
  storageRecovery.bind({
    main:{primary:async context=>context.localEngineActive||!controls.recoverBrowserV2State
      ?await controls.recoverLocalV2State?.():await controls.recoverBrowserV2State({startup:true,deferRender:true}),
      readOnly:controls.recoverReadOnlyV2State||(async()=>false)},
    shared:{primary:controls.recoverSharedChecksV2Primary||(async()=>false),readOnly:controls.recoverSharedChecksV2ReadOnly||(async()=>false)},
  });
  return {...controls,storageRecovery,storageProtocol:createStorageStartupProtocol({
    ownership:{current:controls.storageOwnerCurrent||(()=>null),authenticated:controls.authenticatedOwner||(()=>null)},
    markers:{account:controls.verifyStorageV2AccountMarker||(async()=>false),local:controls.verifyLocalStorageEngine||(async()=>false)},
    account:{read:controls.readStorageProtocolState||(async()=>null),recoverAccount:controls.recoverFencedAccount||(async()=>false)},
  })};
}

export function withOrdersStartup(controls){
  const p=controls.storageProtocol&&controls.storageRecovery?controls:withStorageProtocol(controls),noop=()=>{};
  const session=p.session||{},checksSession=p.checksSession||{},tab=p.tab||{primaryTab:true};
  const allowed=()=>tab.primaryTab&&!session.storageProtocolBlocked&&p.storageRecovery.isReady()&&!session.syncCapabilitiesError&&!session.syncCapabilitiesChecking;
  const browser=createStorageBrowser({session,storageV2:{primaryReady:true,cloudState:p.refreshStorageV2CloudState||(async()=>null)}});
  const cloudStartup=createOrdersCloudStartup({
    main:{recoverCursor:()=>browser.recoverCloudCursor(),open:p.openCloud||(async()=>false),cloudState:p.refreshStorageV2CloudState||(async()=>null),
      hasLocalWork:p.cloudHasLocalWork||(()=>false),conflictBlocked:()=>session.cloudConflictBlocked},
    checks:{sync:p.syncSharedChecksFromCloud||(async()=>false),pending:()=> (p.sharedChecksHasLocalWork||(()=>true))()||checksSession.checksSaveRequested,
      lastError:()=>checksSession.checksCloudLastError,recordError:error=>{checksSession.checksCloudLastError=error?.message||String(error)}},
    finance:{hydrate:p.refreshKupaReadout||(async()=>false)},
    status:{beginStartupSync:p.beginStartupSync||noop,setStartupDomain:p.setStartupDomain||noop,setCloud:p.setCloud||noop},
    access:{authenticated:()=>!!p.loadSession?.(),online:()=>!!globalThis.navigator?.onLine,cloudEnabled:p.cloudEnabled||(()=>false),
      canHydrate:()=>allowed()&&!!globalThis.navigator?.onLine&&!!p.loadSession?.()},
  });
  const localServices=createOrdersLocalServices({
    files:p.files||{},storage:{requestPersistentBrowserStorage:p.requestPersistentBrowserStorage||(async()=>{}),loadDirHandle:p.loadDirHandle||(async()=>null)},
    folder:{refreshPermission:p.refreshDirPermission||(async()=>false),syncStatus:p.syncFolderAccessButton||noop,backupAvailable:p.folderBackupAvailable||(()=>false)},
    backup:{capture:p.prepareState||(()=>({})),save:p.maybeCreateAutomaticFolderBackup||(async()=>false)},
  });
  const backgroundStartup=createOrdersBackgroundStartup({
    polling:{start:p.startOrderPolling||noop},finance:{start:p.startFinanceAutoSync||noop},
    alerts:{prepare:p.prepareStartupAlerts||(async()=>false),show:p.showStartupAlerts||noop},localServices,access:{allowed},
  });
  return {...p,cloudStartup,localServices,backgroundStartup};
}
