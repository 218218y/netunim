import {createUiConnection} from './ui/connection.js';
import {createStateNormalization} from './state/normalization.js';
import {createUiStatus} from './ui/status.js';
import {createStorageIndexedDb} from './storage/indexed-db.js';
import {createStoragePending} from './storage/pending.js';
import {createStorageBrowser} from './storage/browser.js';
import {createSyncChecksState} from './sync/checks-state.js';
import {createStorageTabLock} from './storage/tab-lock.js';
import {createSyncRecovery} from './sync/recovery.js';
import {createStorageFiles} from './storage/files.js';
import {createStorageBackup} from './storage/backup.js';
import {createStoragePersistence} from './storage/persistence.js';
import {createUiFolders} from './ui/folders.js';
import {createCloudAuth} from './cloud/auth.js';
import {createCloudTransport} from './cloud/transport.js';
import {createSyncChecks} from './sync/checks.js';
import {createSyncMerge} from './sync/merge.js';
import {createSyncPending} from './sync/pending.js';
import {createSyncDocument} from './sync/document.js';
import {createUiCloud} from './ui/cloud.js';
import {createUiDateEditor} from './ui/date-editor.js';
import {createDomainsChecksSelectors} from './domains/checks/selectors.js';
import {createDomainsCashSelectors} from './domains/cash/selectors.js';
import {createDomainsCreditSelectors} from './domains/credit/selectors.js';
import {createDomainsExpensesSelectors} from './domains/expenses/selectors.js';
import {createDomainsExpensesView} from './domains/expenses/view.js';
import {createDomainsBankSelectors} from './domains/bank/selectors.js';
import {createDomainsChecksView} from './domains/checks/view.js';
import {createUiNavigation} from './ui/navigation.js';
import {createDomainsDashboardView} from './domains/dashboard/view.js';
import {createUiBulk} from './ui/bulk.js';
import {createDomainsCreditView} from './domains/credit/view.js';
import {createDomainsCashView} from './domains/cash/view.js';
import {createDomainsCashController} from './domains/cash/controller.js';
import {createDomainsNotesController} from './domains/notes/controller.js';
import {createDomainsBankView} from './domains/bank/view.js';
import {createDomainsBankAlerts} from './domains/bank/alerts.js';
import {createDomainsBankBridge} from './domains/bank/bridge.js';
import {createDomainsBankController} from './domains/bank/controller.js';
import {createUiSettings} from './ui/settings.js';
import {createUiModal} from './ui/modal.js';
import {createDomainsChecksEditor} from './domains/checks/editor.js';
import {createDomainsCreditEditor} from './domains/credit/editor.js';
import {createDomainsCreditController} from './domains/credit/controller.js';
import {createDomainsCashEditor} from './domains/cash/editor.js';
import {createDomainsExpensesEditor} from './domains/expenses/editor.js';
import {createDomainsRecordsCommands} from './domains/records/commands.js';
import {createUiBackup} from './ui/backup.js';
import {createLifecycle} from './lifecycle.js';
import {bindActionEvents,bindBackdropDismissal} from './shared/events.js';
import {createUiActions} from './ui/actions.js';
import {createContexts} from './state/contexts.js';







import {jsonEq} from "./sync/merge-records.js";






const {model, session, ui, files, tab, checksSession}=createContexts();

const uiConnection=createUiConnection({
  session,
  tab,
  files,
  setCloudHeaderStatus:(...args)=>uiStatus.setCloudHeaderStatus(...args),
  storeSupaSession:(...args)=>cloudAuth.storeSupaSession(...args),
  openSupabaseLoginModal:(...args)=>uiCloud.openSupabaseLoginModal(...args),
  openCloudUsingSavedSession:(...args)=>uiCloud.openCloudUsingSavedSession(...args),
  supaProjectRef:(...args)=>uiStatus.supaProjectRef(...args),
  supaConfigured:(...args)=>cloudAuth.supaConfigured(...args),
  getRememberedHandle:(...args)=>storageIndexedDb.getRememberedHandle(...args),
  ensureDirectoryFile:(...args)=>storageBackup.ensureDirectoryFile(...args),
  loadState:(...args)=>storagePersistence.loadState(...args),
  render:(...args)=>uiNavigation.render(...args),
});

const stateNormalization=createStateNormalization({
  model,
});

const uiStatus=createUiStatus({
  session,
  checksSession,
});

const storageIndexedDb=createStorageIndexedDb({

});

const storagePending=createStoragePending({
  session,
  idbPut:(...args)=>storageIndexedDb.idbPut(...args),
  idbGet:(...args)=>storageIndexedDb.idbGet(...args),
  idbDelete:(...args)=>storageIndexedDb.idbDelete(...args),
});

const storageBrowser=createStorageBrowser({
  model,
  session,
  files,
  normalizeState:(...args)=>stateNormalization.normalizeState(...args),
  idbPut:(...args)=>storageIndexedDb.idbPut(...args),
  idbGet:(...args)=>storageIndexedDb.idbGet(...args),
});

const syncChecksState=createSyncChecksState({
  session,
  checksSession,
  model,
  normalizeState:(...args)=>stateNormalization.normalizeState(...args),
  prepareKupaCloudState:(...args)=>stateNormalization.prepareKupaCloudState(...args),
  idbPut:(...args)=>storageIndexedDb.idbPut(...args),
  idbGet:(...args)=>storageIndexedDb.idbGet(...args),
  idbDelete:(...args)=>storageIndexedDb.idbDelete(...args),
});

const storageTabLock=createStorageTabLock({
  tab,
  showSecondaryTabGuard:(...args)=>uiConnection.showSecondaryTabGuard(...args),
});

const syncRecovery=createSyncRecovery({
  hideConnectScreen:(...args)=>uiStatus.hideConnectScreen(...args),
  model,
  session,
  checksSession,
  prepareKupaCloudState:(...args)=>stateNormalization.prepareKupaCloudState(...args),
  applyKupaCloudState:(...args)=>stateNormalization.applyKupaCloudState(...args),
  normalizeState:(...args)=>stateNormalization.normalizeState(...args),
  setSaveStatus:(...args)=>uiStatus.setSaveStatus(...args),
  setConnectedStatus:(...args)=>uiStatus.setConnectedStatus(...args),
  setCloudHeaderStatus:(...args)=>uiStatus.setCloudHeaderStatus(...args),
  getCloudPending:(...args)=>storagePending.getCloudPending(...args),
  getSharedChecksPending:(...args)=>syncChecksState.getSharedChecksPending(...args),
  loadBrowserState:(...args)=>storageBrowser.loadBrowserState(...args),
  loadSharedChecksBase:(...args)=>syncChecksState.loadSharedChecksBase(...args),
  sharedChecksPendingExists:(...args)=>syncChecksState.sharedChecksPendingExists(...args),
  startCloudPolling:(...args)=>syncDocument.startCloudPolling(...args),
  render:(...args)=>uiNavigation.render(...args),
});

const storageFiles=createStorageFiles({

});

const storageBackup=createStorageBackup({
  files,
  model,
  session,
  normalizeState:(...args)=>stateNormalization.normalizeState(...args),
  writeJsonHandle:(...args)=>storageFiles.writeJsonHandle(...args),
  readJsonHandle:(...args)=>storageFiles.readJsonHandle(...args),
});

const storagePersistence=createStoragePersistence({
  reportError:(...args)=>uiStatus.reportError(...args),
  model,
  session,
  files,
  tab,
  checksSession,
  stateFromPayload:(...args)=>stateNormalization.stateFromPayload(...args),
  setSaveStatus:(...args)=>uiStatus.setSaveStatus(...args),
  setConnectedStatus:(...args)=>uiStatus.setConnectedStatus(...args),
  persistImmediateBrowserSnapshot:(...args)=>storageBrowser.persistImmediateBrowserSnapshot(...args),
  readJsonHandle:(...args)=>storageFiles.readJsonHandle(...args),
  listBackups:(...args)=>storageBackup.listBackups(...args),
  backupSnapshotToComputer:(...args)=>storageBackup.backupSnapshotToComputer(...args),
  prepareKupaCloudState:(...args)=>stateNormalization.prepareKupaCloudState(...args),
  normalizeState:(...args)=>stateNormalization.normalizeState(...args),
  lastSavedCloudState:(...args)=>syncChecksState.lastSavedCloudState(...args),
  showSecondaryTabGuard:(...args)=>uiConnection.showSecondaryTabGuard(...args),
  stageCloudPendingLocal:(...args)=>syncPending.stageCloudPendingLocal(...args),
  markSharedChecksPending:(...args)=>syncChecksState.markSharedChecksPending(...args),
  getSharedChecksPending:(...args)=>syncChecksState.getSharedChecksPending(...args),
  saveSharedChecksToCloud:(...args)=>syncChecks.saveSharedChecksToCloud(...args),
  render:(...args)=>uiNavigation.render(...args),
  lastSavedState:(...args)=>syncChecksState.lastSavedState(...args),
  writeJsonHandleVerified:(...args)=>storageFiles.writeJsonHandleVerified(...args),
  mergeState3Way:(...args)=>syncMerge.mergeState3Way(...args),
  persistSupabaseState:(...args)=>syncDocument.persistSupabaseState(...args),
  toast:(...args)=>uiStatus.toast(...args),
});

const uiFolders=createUiFolders({
  files,
  session,
  tab,
  ui,
  rememberHandle:(...args)=>storageIndexedDb.rememberHandle(...args),
  rememberBackupHandle:(...args)=>storageIndexedDb.rememberBackupHandle(...args),
  showSecondaryTabGuard:(...args)=>uiConnection.showSecondaryTabGuard(...args),
  permissionFor:(...args)=>storageFiles.permissionFor(...args),
  ensureDirectoryFile:(...args)=>storageBackup.ensureDirectoryFile(...args),
  loadState:(...args)=>storagePersistence.loadState(...args),
  render:(...args)=>uiNavigation.render(...args),
  listBackups:(...args)=>storageBackup.listBackups(...args),
  backupSnapshotToComputer:(...args)=>storageBackup.backupSnapshotToComputer(...args),
  toast:(...args)=>uiStatus.toast(...args),
  renderSettings:(...args)=>uiSettings.renderSettings(...args),
  getRememberedHandle:(...args)=>storageIndexedDb.getRememberedHandle(...args),
  getRememberedBackupHandle:(...args)=>storageIndexedDb.getRememberedBackupHandle(...args),
  showFirstRun:(...args)=>uiConnection.showFirstRun(...args),
  showRememberedFolderPrompt:(...args)=>uiConnection.showRememberedFolderPrompt(...args),
});

const cloudAuth=createCloudAuth({
  session,
  idbGet:(...args)=>storageIndexedDb.idbGet(...args),
  idbPut:(...args)=>storageIndexedDb.idbPut(...args),
  idbDelete:(...args)=>storageIndexedDb.idbDelete(...args),
  supaProjectRef:(...args)=>uiStatus.supaProjectRef(...args),
  setCloudHeaderStatus:(...args)=>uiStatus.setCloudHeaderStatus(...args),
});

const cloudTransport=createCloudTransport({
  session,
  supaRest:(...args)=>cloudAuth.supaRest(...args),
});

const syncChecks=createSyncChecks({
  checksSession,
  model,
  session,
  files,
  tab,
  persistImmediateBrowserSnapshot:(...args)=>storageBrowser.persistImmediateBrowserSnapshot(...args),
  persistSharedChecksBase:(...args)=>syncChecksState.persistSharedChecksBase(...args),
  markSharedChecksPending:(...args)=>syncChecksState.markSharedChecksPending(...args),
  getSharedChecksPending:(...args)=>syncChecksState.getSharedChecksPending(...args),
  clearSharedChecksPending:(...args)=>syncChecksState.clearSharedChecksPending(...args),
  readSharedChecksDocument:(...args)=>cloudTransport.readSharedChecksDocument(...args),
  toast:(...args)=>uiStatus.toast(...args),
  render:(...args)=>uiNavigation.render(...args),
  rpcSaveSharedChecks:(...args)=>cloudTransport.rpcSaveSharedChecks(...args),
  setSaveStatus:(...args)=>uiStatus.setSaveStatus(...args),
  setCloudHeaderStatus:(...args)=>uiStatus.setCloudHeaderStatus(...args),
  sharedChecksPendingExists:(...args)=>syncChecksState.sharedChecksPendingExists(...args),
  backupSnapshotToComputer:(...args)=>storageBackup.backupSnapshotToComputer(...args),
  sharedChecksHaveLocalWork:(...args)=>syncChecksState.sharedChecksHaveLocalWork(...args),
  readSharedChecksMeta:(...args)=>cloudTransport.readSharedChecksMeta(...args),
  refreshCloudHeaderTimestamp:(...args)=>uiStatus.refreshCloudHeaderTimestamp(...args),
});

const syncMerge=createSyncMerge({
  normalizeState:(...args)=>stateNormalization.normalizeState(...args),
  prepareKupaCloudState:(...args)=>stateNormalization.prepareKupaCloudState(...args),
});

const syncPending=createSyncPending({
  session,
  prepareKupaCloudState:(...args)=>stateNormalization.prepareKupaCloudState(...args),
  setSaveStatus:(...args)=>uiStatus.setSaveStatus(...args),
  setCloudHeaderStatus:(...args)=>uiStatus.setCloudHeaderStatus(...args),
  loadCloudPendingSync:(...args)=>storagePending.loadCloudPendingSync(...args),
  persistCloudPendingSync:(...args)=>storagePending.persistCloudPendingSync(...args),
  putCloudPending:(...args)=>storagePending.putCloudPending(...args),
  lastSavedCloudState:(...args)=>syncChecksState.lastSavedCloudState(...args),
  getCloudPending:(...args)=>storagePending.getCloudPending(...args),
  rebaseKupaCloudProgress:(...args)=>syncMerge.rebaseKupaCloudProgress(...args),
});

const syncDocument=createSyncDocument({
  hideConnectScreen:(...args)=>uiStatus.hideConnectScreen(...args),
  reportError:(...args)=>uiStatus.reportError(...args),
  model,
  session,
  checksSession,
  tab,
  prepareKupaCloudState:(...args)=>stateNormalization.prepareKupaCloudState(...args),
  applyKupaCloudState:(...args)=>stateNormalization.applyKupaCloudState(...args),
  setSaveStatus:(...args)=>uiStatus.setSaveStatus(...args),
  setConnectedStatus:(...args)=>uiStatus.setConnectedStatus(...args),
  setCloudHeaderStatus:(...args)=>uiStatus.setCloudHeaderStatus(...args),
  persistImmediateBrowserSnapshot:(...args)=>storageBrowser.persistImmediateBrowserSnapshot(...args),
  loadSharedChecksBase:(...args)=>syncChecksState.loadSharedChecksBase(...args),
  loadSharedChecksBankEvents:(...args)=>syncChecksState.loadSharedChecksBankEvents(...args),
  listBackups:(...args)=>storageBackup.listBackups(...args),
  backupSnapshotToComputer:(...args)=>storageBackup.backupSnapshotToComputer(...args),
  saveState:(...args)=>storagePersistence.saveState(...args),
  syncSharedChecksFromCloud:(...args)=>syncChecks.syncSharedChecksFromCloud(...args),
  render:(...args)=>uiNavigation.render(...args),
  getCloudPending:(...args)=>storagePending.getCloudPending(...args),
  readSupabaseDocument:(...args)=>cloudTransport.readSupabaseDocument(...args),
  supaRest:(...args)=>cloudAuth.supaRest(...args),
  putCloudPending:(...args)=>storagePending.putCloudPending(...args),
  clearCloudPending:(...args)=>storagePending.clearCloudPending(...args),
  mergeKupaCloudState3Way:(...args)=>syncMerge.mergeKupaCloudState3Way(...args),
  rebaseNewerPending:(...args)=>syncPending.rebaseNewerPending(...args),
  lastSavedCloudState:(...args)=>syncChecksState.lastSavedCloudState(...args),
  showSecondaryTabGuard:(...args)=>uiConnection.showSecondaryTabGuard(...args),
  stageCloudPendingLocal:(...args)=>syncPending.stageCloudPendingLocal(...args),
  toast:(...args)=>uiStatus.toast(...args),
  pollSharedChecks:(...args)=>syncChecks.pollSharedChecks(...args),
});

const uiCloud=createUiCloud({
  session,
  tab,
  checksSession,
  model,
  clearCloudPending:(...args)=>storagePending.clearCloudPending(...args),
  loadSupabaseState:(...args)=>syncDocument.loadSupabaseState(...args),
  toast:(...args)=>uiStatus.toast(...args),
  supaConfigured:(...args)=>cloudAuth.supaConfigured(...args),
  modal:(...args)=>uiModal.modal(...args),
  configureCloudConnectButton:(...args)=>uiConnection.configureCloudConnectButton(...args),
  supaProjectRef:(...args)=>uiStatus.supaProjectRef(...args),
  setCloudHeaderStatus:(...args)=>uiStatus.setCloudHeaderStatus(...args),
  loadSupaSession:(...args)=>cloudAuth.loadSupaSession(...args),
  setConnectUI:(...args)=>uiConnection.setConnectUI(...args),
  prepareKupaCloudState:(...args)=>stateNormalization.prepareKupaCloudState(...args),
  getCloudPending:(...args)=>storagePending.getCloudPending(...args),
  loadSharedChecksBase:(...args)=>syncChecksState.loadSharedChecksBase(...args),
  loadSharedChecksBankEvents:(...args)=>syncChecksState.loadSharedChecksBankEvents(...args),
  showSecondaryTabGuard:(...args)=>uiConnection.showSecondaryTabGuard(...args),
  openBrowserStateFallback:(...args)=>syncRecovery.openBrowserStateFallback(...args),
  restoreSupaSession:(...args)=>cloudAuth.restoreSupaSession(...args),
  storeSupaSession:(...args)=>cloudAuth.storeSupaSession(...args),
  isSupabaseAuthError:(...args)=>cloudAuth.isSupabaseAuthError(...args),
  friendlySupabaseError:(...args)=>cloudAuth.friendlySupabaseError(...args),
  supaEnsureSession:(...args)=>cloudAuth.supaEnsureSession(...args),
  readSupabaseDocument:(...args)=>cloudTransport.readSupabaseDocument(...args),
  syncSharedChecksFromCloud:(...args)=>syncChecks.syncSharedChecksFromCloud(...args),
  applyCloudRow:(...args)=>syncDocument.applyCloudRow(...args),
  reconcileCloudPending:(...args)=>syncDocument.reconcileCloudPending(...args),
  startCloudPolling:(...args)=>syncDocument.startCloudPolling(...args),
  render:(...args)=>uiNavigation.render(...args),
  setConnectedStatus:(...args)=>uiStatus.setConnectedStatus(...args),
  ensureSharedChecksForNewCloud:(...args)=>syncChecks.ensureSharedChecksForNewCloud(...args),
  persistSupabaseState:(...args)=>syncDocument.persistSupabaseState(...args),
  supaAuthPassword:(...args)=>cloudAuth.supaAuthPassword(...args),
  closeModal:(...args)=>uiModal.closeModal(...args),
  showFirstRun:(...args)=>uiConnection.showFirstRun(...args),
  confirmDialog:(...args)=>uiModal.confirmDialog(...args),
});

const uiDateEditor=createUiDateEditor({
  markCheckSeriesManual:(...args)=>domainsChecksEditor.markCheckSeriesManual(...args),
  syncCheckSeriesFromFirst:(...args)=>domainsChecksEditor.syncCheckSeriesFromFirst(...args),
  toast:(...args)=>uiStatus.toast(...args),
});

const domainsChecksSelectors=createDomainsChecksSelectors({
  model,
});

const domainsCashSelectors=createDomainsCashSelectors({
  model,
});

const domainsCreditSelectors=createDomainsCreditSelectors({
  model,
});

const domainsExpensesSelectors=createDomainsExpensesSelectors({
  model,
});

const domainsBankSelectors=createDomainsBankSelectors({
  model,
  checksSession,
});

const domainsChecksView=createDomainsChecksView({
  ui,
  model,
  syncBulkUi:(...args)=>uiBulk.syncBulkUi(...args),
  bulkControls:(...args)=>uiBulk.bulkControls(...args),
  bulkHeader:(...args)=>uiBulk.bulkHeader(...args),
  bulkCell:(...args)=>uiBulk.bulkCell(...args),
  futureCheckMonths:(...args)=>domainsChecksSelectors.futureCheckMonths(...args),
});

const uiNavigation=createUiNavigation({
  ui,
  renderDashboard:(...args)=>domainsDashboardView.renderDashboard(...args),
  renderChecks:(...args)=>domainsChecksView.renderChecks(...args),
  renderCredit:(...args)=>domainsCreditView.renderCredit(...args),
  renderCash:(...args)=>domainsCashView.renderCash(...args),
  renderBank:(...args)=>domainsBankView.renderBank(...args),
  renderNotes:(...args)=>domainsNotesController.renderNotes(...args),
  renderSettings:(...args)=>uiSettings.renderSettings(...args),
  maybeAutoRefreshBankBalance:(...args)=>domainsBankController.maybeAutoRefreshBankBalance(...args),
  maybeAutoRefreshCreditSync:(...args)=>domainsCreditController.maybeAutoRefreshCreditSync(...args),
  maybeShowCashflowStartupAlert:(...args)=>domainsBankAlerts.maybeShowStartupCashflowAlert(...args),
});

const domainsDashboardView=createDomainsDashboardView({
  model,
  activeChecks:(...args)=>domainsChecksSelectors.activeChecks(...args),
  depositedChecks:(...args)=>domainsChecksSelectors.depositedChecks(...args),
  bankLongTermPosition:(...args)=>domainsBankSelectors.bankLongTermPosition(...args),
});

const uiBulk=createUiBulk({
  ui,
  model,
  render:(...args)=>uiNavigation.render(...args),
  saveState:(...args)=>storagePersistence.saveState(...args),
  saveChecksState:(...args)=>storagePersistence.saveChecksState(...args),
  toast:(...args)=>uiStatus.toast(...args),
  confirmDialog:(...args)=>uiModal.confirmDialog(...args),
});

const domainsExpensesView=createDomainsExpensesView({
  model,
  bankNextCycleCommitments:(...args)=>domainsBankSelectors.bankNextCycleCommitments(...args),
  bankHomeNextCycleCommitments:(...args)=>domainsBankSelectors.bankHomeNextCycleCommitments(...args),
});

const domainsCreditView=createDomainsCreditView({
  model,
  ui,
  pendingInstallments:(...args)=>domainsCreditSelectors.pendingInstallments(...args),
  syncBulkUi:(...args)=>uiBulk.syncBulkUi(...args),
  bulkControls:(...args)=>uiBulk.bulkControls(...args),
  bulkHeader:(...args)=>uiBulk.bulkHeader(...args),
  bulkCell:(...args)=>uiBulk.bulkCell(...args),
  creditSyncUiState:(...args)=>domainsCreditController.creditSyncUiState(...args),
  refreshCreditBridgeStatus:(...args)=>domainsCreditController.refreshCreditBridgeStatus(...args),
  expensesMarkup:(...args)=>domainsExpensesView.expensesMarkup(...args),
});

const domainsCashView=createDomainsCashView({
  model,
  ui,
  cashBalance:(...args)=>domainsCashSelectors.cashBalance(...args),
  rightsBalance:(...args)=>domainsCashSelectors.rightsBalance(...args),
  kpi:(...args)=>domainsDashboardView.kpi(...args),
  syncBulkUi:(...args)=>uiBulk.syncBulkUi(...args),
  bulkControls:(...args)=>uiBulk.bulkControls(...args),
  bulkHeader:(...args)=>uiBulk.bulkHeader(...args),
  bulkCell:(...args)=>uiBulk.bulkCell(...args),
});

const domainsCashController=createDomainsCashController({
  model,
  saveState:(...args)=>storagePersistence.saveState(...args),
  toast:(...args)=>uiStatus.toast(...args),
});

const domainsNotesController=createDomainsNotesController({
  model,
  saveState:(...args)=>storagePersistence.saveState(...args),
  confirmDialog:(...args)=>uiModal.confirmDialog(...args),
});

const domainsBankBridge=createDomainsBankBridge();

async function refreshFinanceCloudSnapshot(){
  if(session.connectionMode!=='supabase'||!session.backendReady)return {verified:true,state:model.state,revision:Number(session.dbRevision||0),financeRevision:Number(session.financeRevision||0)};
  if(!navigator.onLine)return {verified:false,state:null};
  try{
    const row=await cloudTransport.readSupabaseDocument();
    if(!row?.state)return {verified:false,state:null};
    const kupaChanged=Number(row.revision||0)>Number(session.dbRevision||0),financeChanged=Number(row.financeRevision||0)>Number(session.financeRevision||0);
    if(kupaChanged||financeChanged)await syncDocument.cloudPoll();
    return {verified:true,state:row.state,revision:Number(row.revision||0),financeRevision:Number(row.financeRevision||0)};
  }catch(error){console.error('finance cloud freshness',error);return {verified:false,state:null}}
}
async function saveFinancePatchTracked(...args){
  const result=await cloudTransport.saveFinancePatch(...args),row=result?.row;
  if(row){session.financeRevision=Number(row.revision||session.financeRevision||0);session.financeUpdatedAt=row.updated_at||session.financeUpdatedAt||null}
  return result
}
const remoteFinanceLeaseTokens=new Set();
async function claimSharedFinanceSyncLease(kind,token){
  if(session.connectionMode!=='supabase'||!session.backendReady)return {acquired:true,localOnly:true};
  const result=await cloudTransport.claimFinanceSyncLease(kind,token);if(result?.acquired)remoteFinanceLeaseTokens.add(String(token));return result
}
async function releaseSharedFinanceSyncLease(kind,token){
  const key=String(token||'');if(!remoteFinanceLeaseTokens.has(key))return true;
  try{return await cloudTransport.releaseFinanceSyncLease(kind,key)}finally{remoteFinanceLeaseTokens.delete(key)}
}

const domainsCreditController=createDomainsCreditController({
  model,
  saveState:(...args)=>storagePersistence.saveState(...args),
  toast:(...args)=>uiStatus.toast(...args),
  render:(...args)=>uiNavigation.render(...args),
  bridge:domainsBankBridge,
  modal:(...args)=>uiModal.modal(...args),
  armModalDraftGuard:(...args)=>uiModal.armModalDraftGuard(...args),
  closeModal:(...args)=>uiModal.closeModal(...args),
  confirmDialog:(...args)=>uiModal.confirmDialog(...args),
  refreshFinanceCloudSnapshot,
  saveFinancePatch:(...args)=>saveFinancePatchTracked(...args),
  claimFinanceSyncLease:(...args)=>claimSharedFinanceSyncLease(...args),
  releaseFinanceSyncLease:(...args)=>releaseSharedFinanceSyncLease(...args),
});

const domainsBankController=createDomainsBankController({
  model,
  session,
  checksSession,
  sharedChecksHaveLocalWork:(...args)=>syncChecksState.sharedChecksHaveLocalWork(...args),
  saveState:(...args)=>storagePersistence.saveState(...args),
  syncSharedChecksFromCloud:(...args)=>syncChecks.syncSharedChecksFromCloud(...args),
  sharedChecksObservedSequence:(...args)=>domainsBankSelectors.sharedChecksObservedSequence(...args),
  toast:(...args)=>uiStatus.toast(...args),
  render:(...args)=>uiNavigation.render(...args),
  bridge:domainsBankBridge,
  refreshFinanceCloudSnapshot,
  saveFinancePatch:(...args)=>saveFinancePatchTracked(...args),
  claimFinanceSyncLease:(...args)=>claimSharedFinanceSyncLease(...args),
  releaseFinanceSyncLease:(...args)=>releaseSharedFinanceSyncLease(...args),
  saveBankSyncSnapshot:(...args)=>cloudTransport.saveBankSyncSnapshot(...args),
  mergeBankTransactions:(...args)=>cloudTransport.mergeBankTransactions(...args),
  readBankTransactions:(...args)=>cloudTransport.readBankTransactions(...args),
});

const domainsBankView=createDomainsBankView({
  model,
  ui,
  bankAsOfDate:(...args)=>domainsBankSelectors.bankAsOfDate(...args),
  bankHomeAsOfDate:(...args)=>domainsBankSelectors.bankHomeAsOfDate(...args),
  bankCurrentBalance:(...args)=>domainsBankSelectors.bankCurrentBalance(...args),
  bankHomeBalance:(...args)=>domainsBankSelectors.bankHomeBalance(...args),
  bankNextCycleCommitments:(...args)=>domainsBankSelectors.bankNextCycleCommitments(...args),
  bankHomeNextCycleCommitments:(...args)=>domainsBankSelectors.bankHomeNextCycleCommitments(...args),
  bankProjectedThisMonth:(...args)=>domainsBankSelectors.bankProjectedThisMonth(...args),
  bankHomeProjectedThisMonth:(...args)=>domainsBankSelectors.bankHomeProjectedThisMonth(...args),
  bankBridgeUiState:(...args)=>domainsBankController.bankBridgeUiState(...args),
  refreshBankBridgeStatus:(...args)=>domainsBankController.refreshBankBridgeStatus(...args),
});

const uiSettings=createUiSettings({
  model,
  session,
  checksSession,
  files,
  supaProjectRef:(...args)=>uiStatus.supaProjectRef(...args),
  supaConfigured:(...args)=>cloudAuth.supaConfigured(...args),
  bankCurrentBalance:(...args)=>domainsBankSelectors.bankCurrentBalance(...args),
  saveState:(...args)=>storagePersistence.saveState(...args),
});

const uiModal=createUiModal({
  ui,
});

const domainsBankAlerts=createDomainsBankAlerts({
  model,
  bankProjectedThisMonth:(...args)=>domainsBankSelectors.bankProjectedThisMonth(...args),
  bankHomeProjectedThisMonth:(...args)=>domainsBankSelectors.bankHomeProjectedThisMonth(...args),
  modal:(...args)=>uiModal.modal(...args),
  closeModal:(...args)=>uiModal.closeModal(...args),
});

const domainsChecksEditor=createDomainsChecksEditor({
  model,
  checkDateEditorMarkup:(...args)=>uiDateEditor.checkDateEditorMarkup(...args),
  toast:(...args)=>uiStatus.toast(...args),
  armModalDraftGuard:(...args)=>uiModal.armModalDraftGuard(...args),
  modal:(...args)=>uiModal.modal(...args),
  deleteRecord:(...args)=>domainsRecordsCommands.deleteRecord(...args),
  setCheckDateValue:(...args)=>uiDateEditor.setCheckDateValue(...args),
  saveChecksState:(...args)=>storagePersistence.saveChecksState(...args),
  normalizeCheckModalDates:(...args)=>uiDateEditor.normalizeCheckModalDates(...args),
  closeModal:(...args)=>uiModal.closeModal(...args),
});

const domainsCreditEditor=createDomainsCreditEditor({
  model,
  armModalDraftGuard:(...args)=>uiModal.armModalDraftGuard(...args),
  modal:(...args)=>uiModal.modal(...args),
  nextChargeDate:(...args)=>domainsCreditSelectors.nextChargeDate(...args),
  deleteRecord:(...args)=>domainsRecordsCommands.deleteRecord(...args),
  saveState:(...args)=>storagePersistence.saveState(...args),
  toast:(...args)=>uiStatus.toast(...args),
  closeModal:(...args)=>uiModal.closeModal(...args),
});

const domainsCashEditor=createDomainsCashEditor({
  model,
  armModalDraftGuard:(...args)=>uiModal.armModalDraftGuard(...args),
  modal:(...args)=>uiModal.modal(...args),
  deleteRecord:(...args)=>domainsRecordsCommands.deleteRecord(...args),
  saveState:(...args)=>storagePersistence.saveState(...args),
  toast:(...args)=>uiStatus.toast(...args),
  closeModal:(...args)=>uiModal.closeModal(...args),
});

const domainsExpensesEditor=createDomainsExpensesEditor({
  model,
  armModalDraftGuard:(...args)=>uiModal.armModalDraftGuard(...args),
  modal:(...args)=>uiModal.modal(...args),
  deleteRecord:(...args)=>domainsRecordsCommands.deleteRecord(...args),
  saveState:(...args)=>storagePersistence.saveState(...args),
  toast:(...args)=>uiStatus.toast(...args),
  closeModal:(...args)=>uiModal.closeModal(...args),
});

const domainsRecordsCommands=createDomainsRecordsCommands({
  model,
  saveState:(...args)=>storagePersistence.saveState(...args),
  saveChecksState:(...args)=>storagePersistence.saveChecksState(...args),
  closeModal:(...args)=>uiModal.closeModal(...args),
  confirmDialog:(...args)=>uiModal.confirmDialog(...args),
});

const uiBackup=createUiBackup({
  model,
  session,
  ui,
  files,
  checksSession,
  readJsonHandle:(...args)=>storageFiles.readJsonHandle(...args),
  listBackups:(...args)=>storageBackup.listBackups(...args),
  createManualBackup:(...args)=>storageBackup.createManualBackup(...args),
  toast:(...args)=>uiStatus.toast(...args),
  renderSettings:(...args)=>uiSettings.renderSettings(...args),
  normalizeState:(...args)=>stateNormalization.normalizeState(...args),
  stateFromPayload:(...args)=>stateNormalization.stateFromPayload(...args),
  persistImmediateBrowserSnapshot:(...args)=>storageBrowser.persistImmediateBrowserSnapshot(...args),
  markSharedChecksPending:(...args)=>syncChecksState.markSharedChecksPending(...args),
  saveState:(...args)=>storagePersistence.saveState(...args),
  saveSharedChecksToCloud:(...args)=>syncChecks.saveSharedChecksToCloud(...args),
  chooseFolder:(...args)=>uiFolders.chooseFolder(...args),
  confirmDialog:(...args)=>uiModal.confirmDialog(...args),
});

const lifecycle=createLifecycle({
  session,
  tab,
  checksSession,
  prepareKupaCloudState:(...args)=>stateNormalization.prepareKupaCloudState(...args),
  normalizeState:(...args)=>stateNormalization.normalizeState(...args),
  saveChecksState:(...args)=>storagePersistence.saveChecksState(...args),
  syncSharedChecksFromCloud:(...args)=>syncChecks.syncSharedChecksFromCloud(...args),
  saveSharedChecksToCloud:(...args)=>syncChecks.saveSharedChecksToCloud(...args),
  pollSharedChecks:(...args)=>syncChecks.pollSharedChecks(...args),
  openLastFolder:(...args)=>uiFolders.openLastFolder(...args),
  checkDateEditorMarkup:(...args)=>uiDateEditor.checkDateEditorMarkup(...args),
  checkDateEditorValue:(...args)=>uiDateEditor.checkDateEditorValue(...args),
  commitCheckDateEditor:(...args)=>uiDateEditor.commitCheckDateEditor(...args),
  setCheckDateValue:(...args)=>uiDateEditor.setCheckDateValue(...args),
  normalizeCheckModalDates:(...args)=>uiDateEditor.normalizeCheckModalDates(...args),
  activeChecks:(...args)=>domainsChecksSelectors.activeChecks(...args),
  depositedChecks:(...args)=>domainsChecksSelectors.depositedChecks(...args),
  cashBalance:(...args)=>domainsCashSelectors.cashBalance(...args),
  checksBalance:(...args)=>domainsChecksSelectors.checksBalance(...args),
  depositedBalance:(...args)=>domainsChecksSelectors.depositedBalance(...args),
  pendingInstallments:(...args)=>domainsCreditSelectors.pendingInstallments(...args),
  allInstallments:(...args)=>domainsCreditSelectors.allInstallments(...args),
  monthSumInstallments:(...args)=>domainsCreditSelectors.monthSumInstallments(...args),
  expenseOccurrencesForMonth:(...args)=>domainsExpensesSelectors.expenseOccurrencesForMonth(...args),
  monthSumExpenses:(...args)=>domainsExpensesSelectors.monthSumExpenses(...args),
  bankBaseBalance:(...args)=>domainsBankSelectors.bankBaseBalance(...args),
  bankAdjustments:(...args)=>domainsBankSelectors.bankAdjustments(...args),
  bankAdjustmentsTotal:(...args)=>domainsBankSelectors.bankAdjustmentsTotal(...args),
  bankAsOfDate:(...args)=>domainsBankSelectors.bankAsOfDate(...args),
  sharedChecksObservedSequence:(...args)=>domainsBankSelectors.sharedChecksObservedSequence(...args),
  bankCurrentBalance:(...args)=>domainsBankSelectors.bankCurrentBalance(...args),
  nextCreditCycle:(...args)=>domainsCreditSelectors.nextCreditCycle(...args),
  modalFormSnapshot:(...args)=>uiModal.modalFormSnapshot(...args),
  armModalDraftGuard:(...args)=>uiModal.armModalDraftGuard(...args),
  modalHasUnsavedDraft:(...args)=>uiModal.modalHasUnsavedDraft(...args),
  clearModalDraftGuard:(...args)=>uiModal.clearModalDraftGuard(...args),
  configureCloudConnectButton:(...args)=>uiConnection.configureCloudConnectButton(...args),
  handleCloudConnectButton:(...args)=>uiConnection.handleCloudConnectButton(...args),
  setCloudHeaderStatus:(...args)=>uiStatus.setCloudHeaderStatus(...args),
  requestPersistentBrowserStorage:(...args)=>storageBrowser.requestPersistentBrowserStorage(...args),
  loadSharedChecksBase:(...args)=>syncChecksState.loadSharedChecksBase(...args),
  loadSharedChecksBankEvents:(...args)=>syncChecksState.loadSharedChecksBankEvents(...args),
  getSharedChecksPending:(...args)=>syncChecksState.getSharedChecksPending(...args),
  sharedChecksPendingExists:(...args)=>syncChecksState.sharedChecksPendingExists(...args),
  showSecondaryTabGuard:(...args)=>uiConnection.showSecondaryTabGuard(...args),
  acquirePrimaryTabLock:(...args)=>storageTabLock.acquirePrimaryTabLock(...args),
  chooseFolder:(...args)=>uiFolders.chooseFolder(...args),
  chooseDataFile:(...args)=>uiFolders.chooseDataFile(...args),
  restoreRememberedBackupTarget:(...args)=>uiFolders.restoreRememberedBackupTarget(...args),
  supaConfigured:(...args)=>cloudAuth.supaConfigured(...args),
  restoreSupaSession:(...args)=>cloudAuth.restoreSupaSession(...args),
  showCloudNoDocument:(...args)=>uiCloud.showCloudNoDocument(...args),
  tryAutoOpenSupabase:(...args)=>uiCloud.tryAutoOpenSupabase(...args),
  setConnectUI:(...args)=>uiConnection.setConnectUI(...args),
  showFirstRun:(...args)=>uiConnection.showFirstRun(...args),
  tryAutoOpenRemembered:(...args)=>uiConnection.tryAutoOpenRemembered(...args),
});

const uiEvents={bindActionEvents};

const uiActions=createUiActions({
  ui,
  chooseBackupFolder:(...args)=>uiFolders.chooseBackupFolder(...args),
  loadSupabaseState:(...args)=>syncDocument.loadSupabaseState(...args),
  cloudPoll:(...args)=>syncDocument.cloudPoll(...args),
  discardCloudPendingAndLoadRemote:(...args)=>uiCloud.discardCloudPendingAndLoadRemote(...args),
  openSupabaseLoginModal:(...args)=>uiCloud.openSupabaseLoginModal(...args),
  enableCloudFromCurrentState:(...args)=>uiCloud.enableCloudFromCurrentState(...args),
  logoutSupabase:(...args)=>uiCloud.logoutSupabase(...args),
  handleCheckDatePartInput:(...args)=>uiDateEditor.handleCheckDatePartInput(...args),
  handleCheckDatePartBlur:(...args)=>uiDateEditor.handleCheckDatePartBlur(...args),
  handleCheckDatePartKeydown:(...args)=>uiDateEditor.handleCheckDatePartKeydown(...args),
  openCheckDatePicker:(...args)=>uiDateEditor.openCheckDatePicker(...args),
  applyCheckDatePicker:(...args)=>uiDateEditor.applyCheckDatePicker(...args),
  setPage:(...args)=>uiNavigation.setPage(...args),
  clearCheckFocus:(...args)=>domainsChecksView.clearCheckFocus(...args),
  toggleBulkMode:(...args)=>uiBulk.toggleBulkMode(...args),
  toggleBulkRow:(...args)=>uiBulk.toggleBulkRow(...args),
  toggleBulkVisible:(...args)=>uiBulk.toggleBulkVisible(...args),
  deleteBulkSelected:(...args)=>uiBulk.deleteBulkSelected(...args),
  renderChecks:(...args)=>domainsChecksView.renderChecks(...args),
  renderChecksSearch:(...args)=>domainsChecksView.renderChecksSearch(...args),
  renderCredit:(...args)=>domainsCreditView.renderCredit(...args),
  setCreditSearch:(...args)=>domainsCreditView.setCreditSearch(...args),
  toggleCreditSyncOptions:(...args)=>domainsCreditView.toggleCreditSyncOptions(...args),
  saveBankBalance:(...args)=>domainsBankController.saveBankBalance(...args),
  saveBankBridgeToken:(...args)=>domainsBankController.saveBankBridgeToken(...args),
  configureBankBridge:(...args)=>domainsBankController.configureBankBridge(...args),
  selectBankBridgeAccount:(...args)=>domainsBankController.selectBankBridgeAccount(...args),
  setBankAccountView:(...args)=>domainsBankView.setBankAccountView(...args),
  setBankSearch:(...args)=>domainsBankView.setBankSearch(...args),
  toggleBankSyncOptions:(...args)=>domainsBankView.toggleBankSyncOptions(...args),
  refreshBankBalance:(...args)=>domainsBankController.refreshBankBalance(...args),
  deleteBankBridgeCredentials:(...args)=>domainsBankController.deleteBankBridgeCredentials(...args),
  setBankAutoRefresh:(...args)=>domainsBankController.setBankAutoRefresh(...args),
  openCreditConnectionModal:(...args)=>domainsCreditController.openCreditConnectionModal(...args),
  deleteCreditConnection:(...args)=>domainsCreditController.deleteCreditConnection(...args),
  resetCreditSync:(...args)=>domainsCreditController.resetCreditSync(...args),
  refreshCreditSync:(...args)=>domainsCreditController.refreshCreditSync(...args),
  copySafeCreditDiagnostics:(...args)=>domainsCreditController.copySafeCreditDiagnostics(...args),
  setCreditCardMapping:(...args)=>domainsCreditController.setCreditCardMapping(...args),
  setCreditAutoRefresh:(...args)=>domainsCreditController.setCreditAutoRefresh(...args),
  setCreditAutoMode:(...args)=>domainsCreditController.setCreditAutoMode(...args),
  closeModal:(...args)=>uiModal.closeModal(...args),
  openCheckModal:(...args)=>domainsChecksEditor.openCheckModal(...args),
  markCheckSeriesManual:(...args)=>domainsChecksEditor.markCheckSeriesManual(...args),
  changeCheckSeriesCount:(...args)=>domainsChecksEditor.changeCheckSeriesCount(...args),
  syncCheckSeriesFromFirst:(...args)=>domainsChecksEditor.syncCheckSeriesFromFirst(...args),
  markDeposited:(...args)=>domainsChecksEditor.markDeposited(...args),
  markCleared:(...args)=>domainsChecksEditor.markCleared(...args),
  openCreditModal:(...args)=>domainsCreditEditor.openCreditModal(...args),
  prefillChargeDate:(...args)=>domainsCreditEditor.prefillChargeDate(...args),
  openCashModal:(...args)=>domainsCashEditor.openCashModal(...args),
  openRightModal:(...args)=>domainsCashEditor.openRightModal(...args),
  setRightsLastCalculatedDate:(...args)=>domainsCashController.setRightsLastCalculatedDate(...args),
  addStickyNote:(...args)=>domainsNotesController.addStickyNote(...args),
  updateStickyNote:(...args)=>domainsNotesController.updateStickyNote(...args),
  blurStickyNote:(...args)=>domainsNotesController.blurStickyNote(...args),
  deleteStickyNote:(...args)=>domainsNotesController.deleteStickyNote(...args),
  openExpenseModal:(...args)=>domainsExpensesEditor.openExpenseModal(...args),
  updateCard:(...args)=>uiSettings.updateCard(...args),
  updateCashflowMinimum:(...args)=>uiSettings.updateCashflowMinimum(...args),
  manualBackup:(...args)=>uiBackup.manualBackup(...args),
  downloadJsonBackup:(...args)=>uiBackup.downloadJsonBackup(...args),
  restoreBackup:(...args)=>uiBackup.restoreBackup(...args),
  switchFolder:(...args)=>uiBackup.switchFolder(...args),
  exportCSV:(...args)=>uiBackup.exportCSV(...args),
});


window.addEventListener('online',()=>{if(session.connectionMode==='supabase'){uiStatus.setSaveStatus('חזרה רשת — מסנכרן…','saving');uiStatus.setCloudHeaderStatus('syncing','ענן: חזרה רשת…');setTimeout(syncDocument.cloudPoll,250)}domainsBankController.maybeAutoRefreshBankBalance();domainsCreditController.maybeAutoRefreshCreditSync()});
window.addEventListener('offline',()=>{if(session.connectionMode==='supabase'){storageBrowser.persistImmediateBrowserSnapshot(model.state,session.dbRevision);uiStatus.setSaveStatus('אופליין — שינויים יישמרו מקומית','saving');uiStatus.setCloudHeaderStatus('offline','ענן: אופליין')}});
document.addEventListener('visibilitychange',()=>{if(document.hidden)return;if(session.connectionMode==='supabase')setTimeout(syncDocument.cloudPoll,100);domainsBankController.maybeAutoRefreshBankBalance();domainsCreditController.maybeAutoRefreshCreditSync()});
const sidebar=document.getElementById('sidebar'),sidebarBackdrop=document.getElementById('sidebarBackdrop'),mobileMenu=document.getElementById('mobileMenu'),sidebarMedia=window.matchMedia('(max-width: 820px)');
function setSidebarOpen(open,{restoreFocus=false}={}){const expanded=sidebarMedia.matches&&!!open;sidebar.classList.toggle('open',expanded);sidebarBackdrop.classList.toggle('open',expanded);document.body.classList.toggle('sidebar-open',expanded);mobileMenu.setAttribute('aria-expanded',String(expanded));mobileMenu.setAttribute('aria-label',expanded?'סגור תפריט':'פתח תפריט');sidebar.setAttribute('aria-hidden',String(sidebarMedia.matches&&!expanded));sidebarBackdrop.tabIndex=expanded?0:-1;if(expanded)requestAnimationFrame(()=>sidebar.querySelector('.nav button.active')?.focus());else if(restoreFocus)mobileMenu.focus()}
function syncSidebarMode(){if(sidebarMedia.matches)setSidebarOpen(sidebar.classList.contains('open'));else setSidebarOpen(false)}
document.getElementById('nav').addEventListener('click',e=>{const b=e.target.closest('button[data-page]');if(b){uiNavigation.setPage(b.dataset.page);setSidebarOpen(false)}});
mobileMenu.addEventListener('click',()=>setSidebarOpen(!sidebar.classList.contains('open'),{restoreFocus:sidebar.classList.contains('open')}));
sidebarBackdrop.addEventListener('click',()=>setSidebarOpen(false,{restoreFocus:true}));
sidebarMedia.addEventListener('change',syncSidebarMode);syncSidebarMode();
document.getElementById('quickAddCheck').addEventListener('click',()=>domainsChecksEditor.openCheckModal());
document.getElementById('backupTop').addEventListener('click',uiBackup.manualBackup);
bindBackdropDismissal(document.getElementById('modalBackdrop'),()=>uiModal.closeModal());
document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(sidebar.classList.contains('open'))setSidebarOpen(false,{restoreFocus:true});else uiModal.closeModal()}});
window.addEventListener('pagehide',()=>{if(!tab.primaryTab)return;storageBrowser.persistImmediateBrowserSnapshot(model.state,session.dbRevision);if(session.connectionMode==='supabase'&&session.backendReady&&session.lastSavedSnapshot&&!jsonEq(stateNormalization.prepareKupaCloudState(model.state),syncChecksState.lastSavedCloudState()))syncPending.stageCloudPendingLocal(stateNormalization.prepareKupaCloudState(model.state),'שינוי לפני סגירה',session.dbRevision,syncChecksState.lastSavedCloudState(),session.localGeneration,false);if(session.connectionMode==='supabase'&&syncChecksState.sharedChecksHaveLocalWork())syncChecksState.markSharedChecksPending()});
window.addEventListener('beforeunload',e=>{if(!tab.primaryTab)return;const unsavedKupa=session.backendReady&&session.lastSavedSnapshot&&!jsonEq(stateNormalization.prepareKupaCloudState(model.state),syncChecksState.lastSavedCloudState()),unsavedChecks=session.connectionMode==='supabase'&&syncChecksState.sharedChecksHaveLocalWork();if(!unsavedKupa&&!unsavedChecks&&!storagePending.cloudPendingExistsSync())return;storageBrowser.persistImmediateBrowserSnapshot(model.state,session.dbRevision);if(session.connectionMode==='supabase'&&unsavedKupa&&session.lastSavedSnapshot)syncPending.stageCloudPendingLocal(stateNormalization.prepareKupaCloudState(model.state),'שינוי לפני סגירה',session.dbRevision,syncChecksState.lastSavedCloudState(),session.localGeneration,false);if(unsavedChecks)syncChecksState.markSharedChecksPending();e.preventDefault();e.returnValue=''});
if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js').catch(console.error));}
uiEvents.bindActionEvents(document.getElementById('content'),uiActions);
uiEvents.bindActionEvents(document.getElementById('modal'),uiActions);
export const appReady=lifecycle.boot();
