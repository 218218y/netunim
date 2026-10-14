import {createUiCloud} from '../ui/cloud.js';

export function composeCloudUi({
  model,files,tab,session,checksSession,ui,uiModal,cloudAuth,uiStatus,storageBrowser,uiTabGuard,stateSnapshots,uiNavigation,storageFiles,uiBackup,
  cloudTransport,financeReadout,checksCloud,syncDocument,getUiSettings,getCalendarController,financeRuntime,storageV2Coordinator,storageV2Cloud,
}){
  if(typeof getUiSettings!=='function'||typeof getCalendarController!=='function')throw new Error('orders_cloud_ui_ports_required');
  return createUiCloud({
    model,
    files,
    tab,
    session,
    checksSession,
    auth:{
      supaConfigured:(...args)=>cloudAuth.supaConfigured(...args),
      authPassword:(...args)=>cloudAuth.authPassword(...args),
      authPasswordForLocalReset:(...args)=>cloudAuth.authPasswordForLocalReset(...args),
      loadSession:(...args)=>cloudAuth.loadSession(...args),
      saveSession:(...args)=>cloudAuth.saveSession(...args),
    },
    view:{
      modal:(...args)=>uiModal.modal(...args),
      confirmDialog:(...args)=>uiModal.confirmDialog(...args),
      toast:(...args)=>uiStatus.toast(...args),
      closeModal:(...args)=>uiModal.closeModal(...args),
      setCloud:(...args)=>uiStatus.setCloud(...args),
      showSecondaryTabGuard:(...args)=>uiTabGuard.showSecondaryTabGuard(...args),
      render:(...args)=>uiNavigation.render(...args),
      renderSettings:(...args)=>getUiSettings().renderSettings(...args),
      resumeCalendarAfterCloudLogin:(...args)=>getCalendarController().resumeAfterCloudLogin(...args),
    },
    storage:{
      storageV2CommitPromise:()=>storageBrowser.storageV2CommitPromise,
      ...storageV2Coordinator.ownerUiPorts(),
      ...storageV2Coordinator.ownerTransferUiPorts(),
      ...storageV2Cloud,
    },
    main:{
      prepareCloudState:(...args)=>stateSnapshots.prepareCloudState(...args),
      writeStateToFolder:(...args)=>storageFiles.writeStateToFolder(...args),
      readCloud:(...args)=>cloudTransport.readCloud(...args),
      verifyLocalResetCloud:(...args)=>cloudTransport.verifyLocalResetCloud(...args),
      applyOrderCloudState:(...args)=>stateSnapshots.applyOrderCloudState(...args),
      composeOrderCloudState:(...args)=>stateSnapshots.composeOrderCloudState(...args),
      requestCloudSave:(...args)=>syncDocument.requestCloudSave(...args),
      startPolling:(...args)=>syncDocument.startPolling(...args),
      stopPolling:(...args)=>syncDocument.stopPolling(...args),
    },
    secondary:{
      refreshKupaReadout:(...args)=>financeReadout.refreshKupaReadout(...args),
      syncSharedChecksFromCloud:(...args)=>checksCloud.sync(...args),
      startFinanceAutoSync:(...args)=>financeRuntime.start(...args),
      stopFinanceAutoSync:()=>financeRuntime.stop(),
    },
    review:{
      prepareConcurrentAckRecovery:async()=>{const review=await syncDocument.prepareConcurrentAckRecovery();return {...review,diffText:uiBackup.syncRecoveryDiffText(review.backup.remote.state,review.backup.localState)}},
      downloadRecoveryBackup:payload=>uiBackup.downloadBlob(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),`orders-sync-recovery_${new Date().toISOString().replace(/[:.]/g,'-')}.json`),
    },
  });
}
