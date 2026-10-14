// Test-only translation of existing named stand-ins. The deployed factory has
// no flat API or success defaults. Native tests use this same explicit mapping.
export function ordersDocumentPorts(p){
  return {
    model:p.model,session:p.session,tab:p.tab,
    access:{
      getCloudWriteScope:p.getCloudWriteScope??(()=>null),
      storageV2PreparationActive:p.storageV2PreparationActive??(()=>false),
      cloudEnabled:p.cloudEnabled,cloudHasLocalWork:p.cloudHasLocalWork,
    },
    journal:{
      refreshStorageV2CloudState:p.refreshStorageV2CloudState??(async()=>null),
      materializeStorageV2CloudFlight:p.materializeStorageV2CloudFlight??(async()=>null),
      acknowledgeStorageV2CloudFlight:p.acknowledgeStorageV2CloudFlight??(async()=>null),
      rejectStorageV2CloudFlight:p.rejectStorageV2CloudFlight??(async()=>null),
      setStorageV2CloudControl:p.setStorageV2CloudControl??(async()=>null),
      storageV2CommitPromise:p.storageV2CommitPromise??(()=>Promise.resolve()),
    },
    checkpoint:{adoptStorageV2CloudHead:p.adoptStorageV2CloudHead??(async()=>null)},
    recovery:{
      readStorageV2CloudRecovery:p.readStorageV2CloudRecovery??null,
      commitStorageV2CloudRecovery:p.commitStorageV2CloudRecovery??null,
      cancelCloudRecovery:p.cancelCloudRecovery??(()=>{}),
    },
    projection:{
      prepareCloudState:p.prepareCloudState,sameOrderCloudData:p.sameOrderCloudData,merge3:p.merge3,
      composeOrderCloudState:p.composeOrderCloudState??((cloud,current)=>({...structuredClone(cloud),checks:structuredClone(current.checks||[])})),
      applyOrderCloudState:p.applyOrderCloudState,
    },
    transport:{readCloud:p.readCloud,readCloudMeta:p.readCloudMeta,rpcSaveV2:p.rpcSaveV2},
    view:{setCloud:p.setCloud,toast:p.toast,render:p.render,refreshCloudTimestamp:p.refreshCloudTimestamp},
    mirror:{files:p.files,writeStateToFolder:p.writeStateToFolder},
    secondary:{pollSharedChecks:p.pollSharedChecks,refreshKupaReadout:p.refreshKupaReadout},
  };
}

export function kupaDocumentPorts(p,rpcSaveCloudV2){
  return {
    model:p.model,session:p.session,tab:p.tab,
    access:{
      getCloudWriteScope:p.getCloudWriteScope??(()=>null),
      storageV2PreparationActive:p.storageV2PreparationActive??(()=>false),
      storageV2CloudOutboxActive:p.storageV2CloudOutboxActive??(()=>false),
      assertAccountOwner:p.assertAccountOwner??(()=>{throw new Error('storage_owner_account_required')}),
    },
    journal:{
      refreshStorageV2CloudState:p.refreshStorageV2CloudState??(async()=>null),
      materializeStorageV2CloudFlight:p.materializeStorageV2CloudFlight??(async()=>null),
      acknowledgeStorageV2CloudFlight:p.acknowledgeStorageV2CloudFlight??(async()=>null),
      rejectStorageV2CloudFlight:p.rejectStorageV2CloudFlight??(async()=>null),
      setStorageV2CloudControl:p.setStorageV2CloudControl??(async()=>null),
      storageV2CommitPromise:p.storageV2CommitPromise??(()=>Promise.resolve()),
    },
    checkpoint:{
      clearStorageV2CloudControl:p.clearStorageV2CloudControl??(async()=>false),
      replaceStorageV2CurrentState:p.replaceStorageV2CurrentState??(async()=>null),
      queueStorageV2CloudNormalization:p.queueStorageV2CloudNormalization??(async()=>null),
      adoptStorageV2CloudHead:p.adoptStorageV2CloudHead??(async()=>null),
      resetStorageV2CloudHead:p.resetStorageV2CloudHead??(async()=>null),
    },
    recovery:{
      readStorageV2CloudRecovery:p.readStorageV2CloudRecovery??null,
      commitStorageV2CloudRecovery:p.commitStorageV2CloudRecovery??null,
      cancelCloudRecovery:p.cancelCloudRecovery??(()=>{}),
    },
    projection:{prepareKupaCloudState:p.prepareKupaCloudState,applyKupaCloudState:p.applyKupaCloudState,mergeKupaCloudState3Way:p.mergeKupaCloudState3Way,domainRevisions:p.domainRevisions},
    transport:{readSupabaseDocument:p.readSupabaseDocument,readFinanceSyncDocument:p.readFinanceSyncDocument??(async()=>null),rpcSaveCloudV2},
    view:{hideConnectScreen:p.hideConnectScreen,reportError:p.reportError,setSaveStatus:p.setSaveStatus,setConnectedStatus:p.setConnectedStatus,setCloudHeaderStatus:p.setCloudHeaderStatus,showSecondaryTabGuard:p.showSecondaryTabGuard,toast:p.toast,render:p.render},
    mirror:{listBackups:p.listBackups,backupSnapshotToComputer:p.backupSnapshotToComputer},
    secondary:{syncSharedChecksFromCloud:p.syncSharedChecksFromCloud,pollSharedChecks:p.pollSharedChecks,refreshOrdersFinanceSummary:p.refreshOrdersFinanceSummary??(async()=>false)},
  };
}
