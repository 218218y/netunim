import {createSyncDocument as createDocumentRuntime} from '../sync/document.js';

// Main owns its journal/ACK. Finance, Shared Checks and local backup participate
// through separate APIs; none can silently grant Main save confirmation.
export function createSyncDocument({model,session,tab,ownership,storage,state,transport,view,mirror,secondary}){
  return createDocumentRuntime({
    model,session,tab,
    access:{
      getCloudWriteScope:()=>ownership.getScope(),
      storageV2PreparationActive:()=>ownership.preparing(),
      storageV2CloudOutboxActive:()=>storage.storageV2CloudOutboxActive(),
      assertAccountOwner:()=>ownership.assertAccountOwner(),
    },
    journal:{
      refreshStorageV2CloudState:()=>storage.refreshStorageV2CloudState(),
      materializeStorageV2CloudFlight:(...args)=>storage.materializeStorageV2CloudFlight(...args),
      acknowledgeStorageV2CloudFlight:(...args)=>storage.acknowledgeStorageV2CloudFlight(...args),
      rejectStorageV2CloudFlight:(...args)=>storage.rejectStorageV2CloudFlight(...args),
      setStorageV2CloudControl:(...args)=>storage.setStorageV2CloudControl(...args),
      storageV2CommitPromise:()=>storage.storageV2CommitPromise(),
    },
    checkpoint:{
      clearStorageV2CloudControl:(...args)=>storage.clearStorageV2CloudControl(...args),
      replaceStorageV2CurrentState:(...args)=>storage.replaceStorageV2CurrentState(...args),
      queueStorageV2CloudNormalization:(...args)=>storage.queueStorageV2CloudNormalization(...args),
      adoptStorageV2CloudHead:(...args)=>storage.adoptStorageV2CloudHead(...args),
      resetStorageV2CloudHead:(...args)=>storage.resetStorageV2CloudHead(...args),
    },
    recovery:{
      readStorageV2CloudRecovery:(...args)=>storage.readStorageV2CloudRecovery(...args),
      commitStorageV2CloudRecovery:(...args)=>storage.commitStorageV2CloudRecovery(...args),
      cancelCloudRecovery:()=>ownership.cancelRecovery(),
    },
    projection:{
      prepareKupaCloudState:(...args)=>state.normalization.prepareKupaCloudState(...args),
      applyKupaCloudState:(...args)=>state.normalization.applyKupaCloudState(...args),
      mergeKupaCloudState3Way:(...args)=>state.merge.mergeKupaCloudState3Way(...args),
      domainRevisions:state.domainRevisions,
    },
    transport:{
      readSupabaseDocument:(...args)=>transport.readSupabaseDocument(...args),
      readFinanceSyncDocument:(...args)=>transport.readFinanceSyncDocument(...args),
      rpcSaveCloudV2:(...args)=>transport.rpcSaveCloudV2(...args),
    },
    view:{
      hideConnectScreen:(...args)=>view.status.hideConnectScreen(...args),
      reportError:(...args)=>view.status.reportError(...args),
      setSaveStatus:(...args)=>view.status.setSaveStatus(...args),
      setConnectedStatus:(...args)=>view.status.setConnectedStatus(...args),
      setCloudHeaderStatus:(...args)=>view.status.setCloudHeaderStatus(...args),
      toast:(...args)=>view.status.toast(...args),
      showSecondaryTabGuard:()=>view.showSecondaryTabGuard(),
      render:()=>view.render(),
    },
    mirror:{
      listBackups:(...args)=>mirror.listBackups(...args),
      backupSnapshotToComputer:(...args)=>mirror.backupSnapshotToComputer(...args),
    },
    secondary:{
      syncSharedChecksFromCloud:(...args)=>secondary.checks.commands.sync(...args),
      pollSharedChecks:(...args)=>secondary.checks.runtime.poll(...args),
      refreshOrdersFinanceSummary:(...args)=>secondary.dashboard.refreshOrdersSummary(...args),
    },
  });
}
