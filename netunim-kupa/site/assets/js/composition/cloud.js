import {createUiCloud} from '../ui/cloud.js';

export function composeCloudUi({
  session,tab,checksSession,model,storageV2Cloud,storageV2Coordinator,syncDocument,uiStatus,cloudAuth,
  getUiModal,uiConnection,stateNormalization,syncRecovery,cloudTransport,checks,getUiNavigation,financeAutomation,
}){
  if(typeof getUiModal!=='function'||typeof getUiNavigation!=='function')throw new Error('kupa_cloud_ui_ports_required');
  if(typeof financeAutomation?.start!=='function'||typeof financeAutomation?.stop!=='function')throw new Error('kupa_cloud_finance_automation_required');
  return createUiCloud({
    session,
    tab,
    checksSession,
    model,
    auth:{
      supaConfigured:(...args)=>cloudAuth.supaConfigured(...args),
      loadSupaSession:(...args)=>cloudAuth.loadSupaSession(...args),
      restoreSupaSession:(...args)=>cloudAuth.restoreSupaSession(...args),
      storeSupaSession:(...args)=>cloudAuth.storeSupaSession(...args),
      isSupabaseAuthError:(...args)=>cloudAuth.isSupabaseAuthError(...args),
      friendlySupabaseError:(...args)=>cloudAuth.friendlySupabaseError(...args),
      supaEnsureSession:(...args)=>cloudAuth.supaEnsureSession(...args),
      supaAuthPassword:(...args)=>cloudAuth.supaAuthPassword(...args),
      supaAuthPasswordForLocalReset:(...args)=>cloudAuth.supaAuthPasswordForLocalReset(...args),
    },
    view:{
      toast:(...args)=>uiStatus.toast(...args),
      modal:(...args)=>getUiModal().modal(...args),
      configureCloudConnectButton:(...args)=>uiConnection.configureCloudConnectButton(...args),
      supaProjectRef:(...args)=>uiStatus.supaProjectRef(...args),
      setCloudHeaderStatus:(...args)=>uiStatus.setCloudHeaderStatus(...args),
      setConnectUI:(...args)=>uiConnection.setConnectUI(...args),
      showSecondaryTabGuard:(...args)=>uiConnection.showSecondaryTabGuard(...args),
      render:(...args)=>getUiNavigation().render(...args),
      setConnectedStatus:(...args)=>uiStatus.setConnectedStatus(...args),
      closeModal:(...args)=>getUiModal().closeModal(...args),
      showFirstRun:(...args)=>uiConnection.showFirstRun(...args),
      confirmDialog:(...args)=>getUiModal().confirmDialog(...args),
    },
    storage:{
      ...storageV2Cloud,
      ...storageV2Coordinator.ownerUiPorts(),
    },
    main:{
      loadSupabaseState:(...args)=>syncDocument.loadSupabaseState(...args),
      prepareKupaCloudState:(...args)=>stateNormalization.prepareKupaCloudState(...args),
      recoverBrowserV2State:(...args)=>syncRecovery.recoverBrowserV2State(...args),
      readSupabaseDocument:(...args)=>cloudTransport.readSupabaseDocument(...args),
      verifyLocalResetCloud:(...args)=>cloudTransport.verifyLocalResetCloud(...args),
      applyCloudRow:(...args)=>syncDocument.applyCloudRow(...args),
      requestStorageV2CloudSave:(...args)=>syncDocument.requestStorageV2CloudSave(...args),
      startCloudPolling:(...args)=>{const result=syncDocument.startCloudPolling(...args);financeAutomation.start();return result},
      stopCloudPolling:(...args)=>{financeAutomation.stop();return syncDocument.stopCloudPolling(...args)},
    },
  });
}
