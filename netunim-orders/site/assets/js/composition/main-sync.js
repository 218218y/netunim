import {createMainSyncBrowserPorts} from '../shared/main-sync-browser.js';
import {createSyncDocument as createDocumentRuntime} from '../sync/document.js';

// Bind stable owners here; the startup root does not forward every sync method.
// Explicit selections prevent reset/restore APIs from entering ordinary writes.
export function createSyncDocument({model,session,tab,ownership,storage,state,transport,view,mirror,secondary}){
  const environment=view.environment??createMainSyncBrowserPorts();
  return createDocumentRuntime({
    model,session,tab,
    access:{
      isOnline:()=>environment.isOnline(),
      getCloudWriteScope:()=>ownership.getScope(),
      storageV2PreparationActive:()=>ownership.preparing(),
      cloudEnabled:()=>ownership.enabled(),
      cloudHasLocalWork:()=>state.snapshots.cloudHasLocalWork(),
    },
    journal:{
      refreshStorageV2CloudState:()=>storage.refreshStorageV2CloudState(),
      materializeStorageV2CloudFlight:(...args)=>storage.materializeStorageV2CloudFlight(...args),
      acknowledgeStorageV2CloudFlight:(...args)=>storage.acknowledgeStorageV2CloudFlight(...args),
      rejectStorageV2CloudFlight:(...args)=>storage.rejectStorageV2CloudFlight(...args),
      setStorageV2CloudControl:(...args)=>storage.setStorageV2CloudControl(...args),
      storageV2CommitPromise:()=>storage.storageV2CommitPromise(),
    },
    checkpoint:{adoptStorageV2CloudHead:(...args)=>storage.adoptStorageV2CloudHead(...args)},
    recovery:{
      readStorageV2CloudRecovery:(...args)=>storage.readStorageV2CloudRecovery(...args),
      commitStorageV2CloudRecovery:(...args)=>storage.commitStorageV2CloudRecovery(...args),
      cancelCloudRecovery:()=>ownership.cancelRecovery(),
    },
    projection:{
      prepareCloudState:(...args)=>state.snapshots.prepareCloudState(...args),
      sameOrderCloudData:(...args)=>state.snapshots.sameOrderCloudData(...args),
      composeOrderCloudState:(...args)=>state.snapshots.composeOrderCloudState(...args),
      applyOrderCloudState:(...args)=>state.snapshots.applyOrderCloudState(...args),
      merge3:(...args)=>state.merge.merge3(...args),
    },
    transport:{
      readCloud:(...args)=>transport.readCloud(...args),
      readCloudMeta:(...args)=>transport.readCloudMeta(...args),
      rpcSaveV2:(...args)=>transport.rpcSaveV2(...args),
    },
    view:{
      setCloud:(...args)=>view.status.setCloud(...args),
      toast:(...args)=>view.status.toast(...args),
      refreshCloudTimestamp:(...args)=>view.status.refreshCloudTimestamp(...args),
      render:()=>view.render(),
    },
    mirror:{files:mirror.files,writeStateToFolder:(...args)=>mirror.writeStateToFolder(...args)},
    secondary:{
      refreshKupaReadout:(...args)=>secondary.finance.refreshKupaReadout(...args),
      pollSharedChecks:(...args)=>secondary.checks.poll(...args),
    },
  });
}
