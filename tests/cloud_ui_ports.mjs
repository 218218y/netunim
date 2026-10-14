import {createUiCloud as ordersUi} from '../netunim-orders/site/assets/js/ui/cloud.js';
import {createUiCloud as kupaUi} from '../netunim-kupa/site/assets/js/ui/cloud.js';

// Named test stand-ins for the production capability ports.
export function createOrdersCloudUi(ports){return ordersUi({
  model:ports.model,files:ports.files,tab:ports.tab,session:ports.session,checksSession:ports.checksSession,
  auth:{supaConfigured:ports.supaConfigured,authPassword:ports.authPassword,authPasswordForLocalReset:ports.authPasswordForLocalReset,loadSession:ports.loadSession,saveSession:ports.saveSession},
  view:{modal:ports.modal,confirmDialog:ports.confirmDialog,toast:ports.toast,closeModal:ports.closeModal,setCloud:ports.setCloud,showSecondaryTabGuard:ports.showSecondaryTabGuard,render:ports.render,renderSettings:ports.renderSettings,resumeCalendarAfterCloudLogin:ports.resumeCalendarAfterCloudLogin},
  storage:{storageOwnerCurrent:ports.storageOwnerCurrent,storageOwnerAdoption:ports.storageOwnerAdoption,startStorageV2OwnerTransfer:ports.startStorageV2OwnerTransfer,storageV2CloudOutboxActive:ports.storageV2CloudOutboxActive,storageV2PrimaryRequested:ports.storageV2PrimaryRequested,refreshStorageV2CloudState:ports.refreshStorageV2CloudState,adoptStorageV2CloudHead:ports.adoptStorageV2CloudHead,setStorageV2CloudControl:ports.setStorageV2CloudControl,storageV2CommitPromise:ports.storageV2CommitPromise},
  main:{prepareCloudState:ports.prepareCloudState,composeOrderCloudState:ports.composeOrderCloudState,applyOrderCloudState:ports.applyOrderCloudState,readCloud:ports.readCloud,verifyLocalResetCloud:ports.verifyLocalResetCloud,requestCloudSave:ports.requestCloudSave,startPolling:ports.startPolling,stopPolling:ports.stopPolling,writeStateToFolder:ports.writeStateToFolder},
  secondary:{refreshKupaReadout:ports.refreshKupaReadout,syncSharedChecksFromCloud:ports.syncSharedChecksFromCloud,startFinanceAutoSync:ports.startFinanceAutoSync,stopFinanceAutoSync:ports.stopFinanceAutoSync},
  review:{prepareConcurrentAckRecovery:ports.prepareConcurrentAckRecovery,downloadRecoveryBackup:ports.downloadRecoveryBackup},
})}

export function createKupaCloudUi(ports){return kupaUi({
  session:ports.session,tab:ports.tab,checksSession:ports.checksSession,model:ports.model,
  auth:{supaConfigured:ports.supaConfigured,loadSupaSession:ports.loadSupaSession,restoreSupaSession:ports.restoreSupaSession,storeSupaSession:ports.storeSupaSession,isSupabaseAuthError:ports.isSupabaseAuthError,friendlySupabaseError:ports.friendlySupabaseError,supaEnsureSession:ports.supaEnsureSession,supaAuthPassword:ports.supaAuthPassword,supaAuthPasswordForLocalReset:ports.supaAuthPasswordForLocalReset},
  view:{toast:ports.toast,modal:ports.modal,configureCloudConnectButton:ports.configureCloudConnectButton,supaProjectRef:ports.supaProjectRef,setCloudHeaderStatus:ports.setCloudHeaderStatus,setConnectUI:ports.setConnectUI,showSecondaryTabGuard:ports.showSecondaryTabGuard,render:ports.render,setConnectedStatus:ports.setConnectedStatus,closeModal:ports.closeModal,showFirstRun:ports.showFirstRun,confirmDialog:ports.confirmDialog},
  storage:{storageV2CloudOutboxActive:ports.storageV2CloudOutboxActive,storageV2PrimaryRequested:ports.storageV2PrimaryRequested,refreshStorageV2CloudState:ports.refreshStorageV2CloudState,storageOwnerCurrent:ports.storageOwnerCurrent,storageOwnerAdoption:ports.storageOwnerAdoption,startStorageV2OwnerTransfer:ports.startStorageV2OwnerTransfer},
  main:{loadSupabaseState:ports.loadSupabaseState,prepareKupaCloudState:ports.prepareKupaCloudState,recoverBrowserV2State:ports.recoverBrowserV2State,readSupabaseDocument:ports.readSupabaseDocument,verifyLocalResetCloud:ports.verifyLocalResetCloud,applyCloudRow:ports.applyCloudRow,requestStorageV2CloudSave:ports.requestStorageV2CloudSave,startCloudPolling:ports.startCloudPolling,stopCloudPolling:ports.stopCloudPolling},
})}
