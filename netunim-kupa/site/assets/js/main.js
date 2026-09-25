import {createKupaStorageV2Coordinator} from './composition/storage-v2.js';
import {installLocalSiteResetPeerListener} from './shared/local-site-reset.js';
import {createSharedChecksObserver} from './shared/shared-checks-v2-shadow.js';
import {assertKupaEntityInvariants} from './state/validation.js';
import {KUPA_FINANCE_DOMAINS} from './state/revisions.js';
import {createFinanceDerivationStore} from './shared/finance-derivations.js';
import {createSpreadsheetWorkspace} from './shared/spreadsheet-workspace.js';
import {esc} from './core/values.js';
import {createCreditCardOrderView} from './shared/credit-card-order-view.js';
import {createUiConnection} from './ui/connection.js';
import {SECONDARY_READ_ONLY_ACTIONS} from './ui/secondary-read-only-actions.js';
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
import {composeCloudUi} from './composition/cloud.js';
import {createUiDateEditor} from './ui/date-editor.js';
import {createDomainsChecksSelectors} from './domains/checks/selectors.js';
import {createDomainsCashSelectors} from './domains/cash/selectors.js';
import {createDomainsCreditSelectors} from './domains/credit/selectors.js';
import {createDomainsExpensesSelectors} from './domains/expenses/selectors.js';
import {createDomainsExpensesView} from './domains/expenses/view.js';
import {createDomainsBankSelectors} from './domains/bank/selectors.js';
import {createDomainsChecksView} from './domains/checks/view.js';
import {createUiNavigation} from './ui/navigation.js';
import {createUiSidebar} from './ui/sidebar.js';
import {createUiGlobalSearch} from './ui/global-search.js';
import {createDomainsDashboardView} from './domains/dashboard/view.js';
import {createDomainsDashboardController} from './domains/dashboard/controller.js';
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
import {verifyStorageV2LocalEngine} from './shared/storage-v2-local-birth.js';
import {bindActionEvents,bindBackdropDismissal,bindDismissibleDetails,bindNumberInputWheelGuard} from './shared/events.js';
import {checkBankReviewItems,checkBankReviewMarkup} from './shared/check-bank-review.js';
import {createUiActions} from './ui/actions.js';
import {createContexts} from './state/contexts.js';
import {createKupaDomainRevisions,kupaPageRevision} from './state/revisions.js';
import {createRestoreGroupStore} from './shared/restore-groups.js';
import {createBankChequeImageStorage} from './shared/bank-cheque-images.js';







import {jsonEq} from "./sync/merge-records.js";






const {model, session, ui, files, tab, checksSession}=createContexts();
installLocalSiteResetPeerListener();
// Event handlers are installed before the async owner/protocol preflight finishes.
session.storageProtocolBlocked=true;
const domainRevisions=createKupaDomainRevisions(session);
const financeDerivations=createFinanceDerivationStore({revision:()=>domainRevisions.stamp(KUPA_FINANCE_DOMAINS)});

const storageV2Coordinator=createKupaStorageV2Coordinator({tab,session});
const {owner:storageOwner,preparing:storagePreparationActive}=storageV2Coordinator;

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
  externalWorkbooks:true,
  model,
});

const uiStatus=createUiStatus({
  session,
  checksSession,
});

const storageIndexedDb=createStorageIndexedDb({

});
const captureLegacyWorkbook=(...args)=>spreadsheetWorkspace.sync.captureLegacy(...args);

const storagePending=createStoragePending({
  externalWorkbooks:true,captureLegacyWorkbook,
  legacyWriteAllowed:()=>storageV2Coordinator.pendingLegacyWriteAllowed(storageShadow),
  session,
  idbPut:(...args)=>storageIndexedDb.idbPut(...args),
  idbGet:(...args)=>storageIndexedDb.idbGet(...args),
  idbDelete:(...args)=>storageIndexedDb.idbDelete(...args),
});

const storageShadow=storageV2Coordinator.createRuntime({validate:state=>assertKupaEntityInvariants(state,{includeChecks:true,required:true}),prepareCheckpoint:state=>stateNormalization.prepareKupaStorageState(state),prepareOperation:operation=>stateNormalization.prepareKupaStorageOperation(operation)});
const storageBrowser=createStorageBrowser({
  storageV2:storageShadow,
  legacyDrainActive:storageV2Coordinator.legacyDrainActive,
  legacyWriteAllowed:storageV2Coordinator.legacyWriteAllowed,
  legacyCloudPendingExists:(...args)=>storagePending.cloudPendingExistsSync(...args),
  legacyCloudHeadVerifiedClean:(...args)=>storagePending.cloudPendingHeadVerifiedCleanSync(...args),
  verifyLegacyCloudPending:(...args)=>storagePending.getCloudPending(...args),
  model,
  session,
  files,
  normalizeState:(...args)=>stateNormalization.normalizeState(...args),
  prepareKupaCloudState:(...args)=>stateNormalization.prepareKupaCloudState(...args),
  idbPut:(...args)=>storageIndexedDb.idbPut(...args),
  idbGet:(...args)=>storageIndexedDb.idbGet(...args),
});
const storageV2Cloud=storageV2Coordinator.createCloudPorts(storageBrowser);

const restoreGroupStore=createRestoreGroupStore({
  localKey:'kupa.restore.group.v1',
  put:(key,value)=>storageIndexedDb.idbPut('sync',key,value),
  get:key=>storageIndexedDb.idbGet('sync',key),
  remove:key=>storageIndexedDb.idbDelete('sync',key),
});

const syncChecksState=createSyncChecksState({
  legacyWriteAllowed:storageV2Coordinator.legacyChecksWriteAllowed,
  session,
  checksSession,
  model,
  normalizeState:(...args)=>stateNormalization.normalizeState(...args),
  prepareKupaCloudState:(...args)=>stateNormalization.prepareKupaCloudState(...args),
  idbPut:(...args)=>storageIndexedDb.idbPut(...args),
  idbGet:(...args)=>storageIndexedDb.idbGet(...args),
  idbDelete:(...args)=>storageIndexedDb.idbDelete(...args),
});

const sharedChecksV2Shadow=createSharedChecksObserver({
  readState:()=>({checks:model.state.checks,bankEvents:checksSession.sharedChecksBankEvents||[]}),
  ...storageV2Coordinator.observerPorts(storageShadow,'netunim-shared-checks-v2-shadow'),
});


const sharedChecksV2Composition=storageV2Coordinator.createSharedComposition({
  model,checksSession,domainRevisions,main:storageShadow,stateNormalization,syncChecksState,getSyncChecks:()=>syncChecks,getCloudTransport:()=>cloudTransport,
});
const sharedChecksV2=sharedChecksV2Composition.runtime;
const recoverSharedChecksV2Primary=sharedChecksV2Composition.recoverPrimary;
const verifyStorageCutover=sharedChecksV2Composition.verifyCutover;

const storageTabLock=createStorageTabLock({
  tab,
  showSecondaryTabGuard:(...args)=>uiConnection.showSecondaryTabGuard(...args),
});

const syncRecovery=createSyncRecovery({
  captureLegacyWorkbook,
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
  ...storageV2Cloud,
  getCloudPending:(...args)=>storagePending.getCloudPending(...args),
  getSharedChecksPending:(...args)=>syncChecksState.getSharedChecksPending(...args),
  loadBrowserState:(...args)=>storageBrowser.loadBrowserState(...args),
  loadBrowserStateReadOnly:(...args)=>storageBrowser.loadBrowserStateReadOnly(...args),
  loadSharedChecksBase:(...args)=>syncChecksState.loadSharedChecksBase(...args),
  loadSharedChecksBankEvents:(...args)=>syncChecksState.loadSharedChecksBankEvents(...args),
  sharedChecksPendingExists:(...args)=>syncChecksState.sharedChecksPendingExists(...args),
  startCloudPolling:(...args)=>syncDocument.startCloudPolling(...args),
  render:(...args)=>uiNavigation.render(...args),
  domainRevisions,
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
  sharedChecksV2,
  storageV2Boundary:sharedChecksV2Composition.boundary,
  captureLegacyWorkbook,
  storageV2Primary:()=>storageShadow.primaryReady,
  recoverStorageV2State:()=>storageShadow.recoverForOwner({intent:'load-account'}),
  storageV2DurabilityAtRisk:()=>storageShadow.durabilityAtRisk,
  observeSharedChecks:sharedChecksV2Shadow.mutation,
  ...storageV2Cloud,
  reportError:(...args)=>uiStatus.reportError(...args),
  model,
  session,
  files,
  tab,
  checksSession,
  domainRevisions,
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
  assertSessionOwner:(...args)=>storageOwner.assertSessionOwner(...args),
});

const cloudTransport=createCloudTransport({
  session,
  supaRest:(...args)=>cloudAuth.supaRest(...args),
  localResetReadOnlyFetch:(...args)=>cloudAuth.localResetReadOnlyFetch(...args),
});

const domainsDashboardController=createDomainsDashboardController({
  session,
  ui,
  readOrdersReadOnlyMeta:(...args)=>cloudTransport.readOrdersReadOnlyMeta(...args),
  readOrdersReadOnlyCloud:(...args)=>cloudTransport.readOrdersReadOnlyCloud(...args),
  renderDashboard:(...args)=>domainsDashboardView.renderDashboard(...args),
  touchOrdersFinanceRevision:()=>domainRevisions.touch('ordersFinance'),
});

const syncChecks=createSyncChecks({
  sharedChecksV2,
  checksSession,
  model,
  session,
  files,
  tab,
  persistImmediateBrowserSnapshot:(...args)=>storageBrowser.persistImmediateBrowserSnapshot(...args),
  observeSharedChecksBoundary:sharedChecksV2Shadow.boundary,
  ...storageV2Cloud,
  persistSharedChecksBase:(...args)=>syncChecksState.persistSharedChecksBase(...args),
  markSharedChecksPending:(...args)=>syncChecksState.markSharedChecksPending(...args),
  getSharedChecksPending:(...args)=>syncChecksState.getSharedChecksPending(...args),
  clearSharedChecksPending:(...args)=>syncChecksState.clearSharedChecksPending(...args),
  readSharedChecksDocument:(...args)=>cloudTransport.readSharedChecksDocument(...args),
  toast:(...args)=>uiStatus.toast(...args),
  render:(...args)=>uiNavigation.checksChanged(...args),
  rpcSaveSharedChecks:(...args)=>cloudTransport.rpcSaveSharedChecks(...args),
  setSaveStatus:(...args)=>uiStatus.setSaveStatus(...args),
  setCloudHeaderStatus:(...args)=>uiStatus.setCloudHeaderStatus(...args),
  sharedChecksPendingExists:(...args)=>syncChecksState.sharedChecksPendingExists(...args),
  backupSnapshotToComputer:(...args)=>storageBackup.backupSnapshotToComputer(...args),
  sharedChecksHaveLocalWork:(...args)=>syncChecksState.sharedChecksHaveLocalWork(...args),
  readSharedChecksMeta:(...args)=>cloudTransport.readSharedChecksMeta(...args),
  refreshCloudHeaderTimestamp:(...args)=>uiStatus.refreshCloudHeaderTimestamp(...args),
  touchChecksRevision:()=>domainRevisions.touch('checks'),
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
  refreshOrdersFinanceSummary:(...args)=>domainsDashboardController.refreshOrdersFinanceSummary(...args),
  ...storageV2Cloud,
  storageV2PreparationActive:storagePreparationActive,
  ...storageV2Coordinator.adoptionPort(),
  domainRevisions,
});


storageV2Coordinator.configure({
  storagePending,syncChecksState,storageBrowser,syncDocument,syncChecks,model,session,checksSession,files,
  storageIndexedDb,
  captureLegacyWorkbook,
  stateNormalization,domainRevisions,sharedChecksV2Composition,sharedChecksV2,
  cloudTransport,cloudAuth,storageShadow,verifyStorageCutover:()=>verifyStorageCutover(),
});
async function beginStorageV2Cutover(){
  try{
    const result=await storageV2Coordinator.beginCutover();
    if(result.already){uiStatus.toast('Storage V2 כבר פעיל לחשבון הזה.');return true}
    uiStatus.toast('המעבר ל־Storage V2 הושלם ואומת.');syncDocument.startCloudPolling();uiSettings.renderSettings();return true;
  }catch(error){
    console.error(error);
    uiStatus.toast('המעבר ל־Storage V2 נעצר בבדיקת בטיחות. לא בוצע מעבר.');
    uiSettings.renderSettings();
    return false;
  }
}

const uiCloud=composeCloudUi({
  session,tab,checksSession,model,storageV2Cloud,storageV2Coordinator,storagePending,syncDocument,uiStatus,cloudAuth,
  getUiModal:()=>uiModal,uiConnection,stateNormalization,syncChecksState,syncRecovery,cloudTransport,syncChecks,getUiNavigation:()=>uiNavigation,
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
  getBankImageContext:()=>({bank:domainsBankController.bankBridgeUiState(),imageAction:'view-bank-cheque-image'}),
  ui,
  model,
  syncBulkUi:(...args)=>uiBulk.syncBulkUi(...args),
  bulkControls:(...args)=>uiBulk.bulkControls(...args),
  bulkHeader:(...args)=>uiBulk.bulkHeader(...args),
  bulkCell:(...args)=>uiBulk.bulkCell(...args),
  futureCheckMonths:(...args)=>domainsChecksSelectors.futureCheckMonths(...args),
});

const uiNavigation=createUiNavigation({
  runFinance:financeDerivations.run,
  refreshCheckBankIndicator:()=>{const b=document.getElementById('checkBankAlerts');if(b){const count=checkBankReviewItems(model.state.checks).length;b.hidden=!count;b.textContent=`⚠ צ׳קים (${count})`}},
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
  onPageActivated:page=>{if(page==='notes'&&ui.notesTab==='sheet')void spreadsheetWorkspace.activate()},
  dataRevision:page=>kupaPageRevision(domainRevisions,page)+':'+new Date().toLocaleDateString('en-CA')+(page==='notes'&&ui.notesTab==='sheet'?':'+spreadsheetWorkspace.sync.cacheStamp:''),
});

const uiGlobalSearch=createUiGlobalSearch({
  searchRevision:domains=>domainRevisions.stamp(domains)+':'+new Date().toLocaleDateString('en-CA'),
  runFinance:financeDerivations.run,model,ui,setPage:(...args)=>uiNavigation.setPage(...args)});

const uiSidebar=createUiSidebar({setPage:(...args)=>uiNavigation.setPage(...args)});

const domainsDashboardView=createDomainsDashboardView({
  runFinance:financeDerivations.run,
  model,
  activeChecks:(...args)=>domainsChecksSelectors.activeChecks(...args),
  depositedChecks:(...args)=>domainsChecksSelectors.depositedChecks(...args),
  bankLongTermPosition:(...args)=>domainsBankSelectors.bankLongTermPosition(...args),
  bankAsOfDate:(...args)=>domainsBankSelectors.bankAsOfDate(...args),
  bankHomeAsOfDate:(...args)=>domainsBankSelectors.bankHomeAsOfDate(...args),
  bankCurrentBalance:(...args)=>domainsBankSelectors.bankCurrentBalance(...args),
  bankHomeBalance:(...args)=>domainsBankSelectors.bankHomeBalance(...args),
  bankNextCycleCommitments:(...args)=>domainsBankSelectors.bankNextCycleCommitments(...args),
  bankHomeNextCycleCommitments:(...args)=>domainsBankSelectors.bankHomeNextCycleCommitments(...args),
  bankProjectedThisMonth:(...args)=>domainsBankSelectors.bankProjectedThisMonth(...args),
  bankHomeProjectedThisMonth:(...args)=>domainsBankSelectors.bankHomeProjectedThisMonth(...args),
  ordersFinanceSummary:(...args)=>domainsDashboardController.summary(...args),
  refreshOrdersFinanceSummary:(...args)=>domainsDashboardController.refreshOrdersFinanceSummary(...args),
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
  ui,
  bankNextCycleCommitments:(...args)=>domainsBankSelectors.bankNextCycleCommitments(...args),
  bankHomeNextCycleCommitments:(...args)=>domainsBankSelectors.bankHomeNextCycleCommitments(...args),
});

const domainsCreditView=createDomainsCreditView({
  detailRevision:()=>domainRevisions.stamp(KUPA_FINANCE_DOMAINS),
  runFinance:financeDerivations.run,
  dateEditorMarkup:(...args)=>uiDateEditor.dateEditorMarkup(...args),
  model,
  ui,
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
  dateEditorMarkup:(...args)=>uiDateEditor.dateEditorMarkup(...args),
});

const domainsCashController=createDomainsCashController({
  model,
  saveState:(message,options={})=>storagePersistence.saveState(message,{...options,domains:['rights']}),
  toast:(...args)=>uiStatus.toast(...args),
});

const spreadsheetWorkspace=createSpreadsheetWorkspace({
  domain:'kupa',request:(...args)=>cloudAuth.supaRest(...args),account:()=>cloudAuth.loadSupaSession()?.user?.id,enabled:()=>session.connectionMode==='supabase'&&!!cloudAuth.loadSupaSession(),primary:()=>tab.primaryTab,
  active:()=>ui.currentPage==='notes'&&ui.notesTab==='sheet',render:()=>domainsNotesController.renderNotes(),legacy:()=>model.legacyNotesSheet,
  esc,confirmDialog:(...args)=>uiModal.confirmDialog(...args),modal:(title,body)=>uiModal.modal(title,body,'סגור',()=>uiModal.closeModal()),closeModal:()=>uiModal.closeModal(),
});

const domainsNotesController=createDomainsNotesController({
  workspace:spreadsheetWorkspace,
  model,
  ui,
  saveState:(message,options={})=>storagePersistence.saveState(message,{...options,domains:['notes']}),
  confirmDialog:(...args)=>uiModal.confirmDialog(...args),
});

const domainsBankBridge=createDomainsBankBridge();

const bankChequeImageStorage=createBankChequeImageStorage({supaFetch:(...args)=>cloudAuth.supaRest(...args),ensureSession:(...args)=>cloudAuth.supaEnsureSession(...args),fetchBridgeImage:(...args)=>domainsBankBridge.fetchChequeImage(...args)});

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
  saveState:(message,options={})=>storagePersistence.saveState(message,{...options,domains:['creditSync']}),
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
  saveSharedChecksToCloud:(...args)=>syncChecks.saveSharedChecksToCloud(...args),
  saveState:(message,options={})=>storagePersistence.saveState(message,{...options,domains:['bank','bankFeed']}),
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
  syncBankTransactionsSnapshot:(...args)=>cloudTransport.syncBankTransactionsSnapshot(...args),
  readBankTransactions:(...args)=>cloudTransport.readBankTransactions(...args),
  readBankTransactionSnapshot:(...args)=>cloudTransport.readBankTransactionSnapshot(...args),
  acknowledgeBankTransactionMissing:(...args)=>cloudTransport.acknowledgeBankTransactionMissing(...args),
  syncBankChequeImages:(...args)=>bankChequeImageStorage.sync(...args),
  touchBankDataRevision:()=>domainRevisions.touch(['bank','bankFeed']),
  touchBankDisplayRevision:()=>domainRevisions.touch('bankDisplay'),
});

const domainsBankView=createDomainsBankView({
  runFinance:financeDerivations.run,
  modal:(...args)=>uiModal.modal(...args),
  closeModal:(...args)=>uiModal.closeModal(...args),
  model,
  ui,
  bankHomeBalance:(...args)=>domainsBankSelectors.bankHomeBalance(...args),
  bankNextCycleCommitments:(...args)=>domainsBankSelectors.bankNextCycleCommitments(...args),
  bankHomeNextCycleCommitments:(...args)=>domainsBankSelectors.bankHomeNextCycleCommitments(...args),
  bankBridgeUiState:(...args)=>domainsBankController.bankBridgeUiState(...args),
  refreshBankBridgeStatus:(...args)=>domainsBankController.refreshBankBridgeStatus(...args),
  ensureBankDisplayArchive:(...args)=>domainsBankController.ensureBankDisplayArchive(...args),
  downloadBankChequeImage:(...args)=>bankChequeImageStorage.download(...args),
  dateEditorMarkup:(...args)=>uiDateEditor.dateEditorMarkup(...args),
});

const uiSettings=createUiSettings({
  model,
  session,
  ui,
  checksSession,
  files,
  supaProjectRef:(...args)=>uiStatus.supaProjectRef(...args),
  supaConfigured:(...args)=>cloudAuth.supaConfigured(...args),
  bankCurrentBalance:(...args)=>domainsBankSelectors.bankCurrentBalance(...args),
  saveState:(...args)=>storagePersistence.saveState(...args),
  storageV2Status:()=>storageV2Coordinator.status(storageShadow,cloudAuth.loadSupaSession()),
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
  onChecksChanged:()=>uiNavigation.checksChanged(),
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
  saveState:(message,options={})=>storagePersistence.saveState(message,{...options,domains:['credits']}),
  toast:(...args)=>uiStatus.toast(...args),
  closeModal:(...args)=>uiModal.closeModal(...args),
  dateEditorMarkup:(...args)=>uiDateEditor.dateEditorMarkup(...args),
  setDateValue:(...args)=>uiDateEditor.setDateValue(...args),
  renderCredit:(...args)=>domainsCreditView.renderCredit(...args),
});

const domainsCashEditor=createDomainsCashEditor({
  model,
  armModalDraftGuard:(...args)=>uiModal.armModalDraftGuard(...args),
  modal:(...args)=>uiModal.modal(...args),
  deleteRecord:(...args)=>domainsRecordsCommands.deleteRecord(...args),
  saveState:(...args)=>storagePersistence.saveState(...args),
  toast:(...args)=>uiStatus.toast(...args),
  closeModal:(...args)=>uiModal.closeModal(...args),
  dateEditorMarkup:(...args)=>uiDateEditor.dateEditorMarkup(...args),
  renderCash:(...args)=>domainsCashView.renderCash(...args),
});

const domainsExpensesEditor=createDomainsExpensesEditor({
  model,
  armModalDraftGuard:(...args)=>uiModal.armModalDraftGuard(...args),
  modal:(...args)=>uiModal.modal(...args),
  deleteRecord:(...args)=>domainsRecordsCommands.deleteRecord(...args),
  saveState:(message,options={})=>storagePersistence.saveState(message,{...options,domains:['expenses']}),
  toast:(...args)=>uiStatus.toast(...args),
  closeModal:(...args)=>uiModal.closeModal(...args),
  dateEditorMarkup:(...args)=>uiDateEditor.dateEditorMarkup(...args),
  renderCredit:(...args)=>domainsCreditView.renderCredit(...args),
});

const domainsRecordsCommands=createDomainsRecordsCommands({
  model,
  saveState:(...args)=>storagePersistence.saveState(...args),
  saveChecksState:(...args)=>storagePersistence.saveChecksState(...args),
  closeModal:(...args)=>uiModal.closeModal(...args),
  confirmDialog:(...args)=>uiModal.confirmDialog(...args),
  renderCollection:collection=>{
    if(collection==='checks')uiNavigation.checksChanged();
    if(collection==='cash'||collection==='rights')domainsCashView.renderCash();
    else if(collection==='expenses'||collection==='credits')domainsCreditView.renderCredit();
  },
});

const uiBackup=createUiBackup({
  observeSharedChecksBoundary:sharedChecksV2Shadow.boundary,
  ...storageV2Cloud,
  storageV2Boundary:sharedChecksV2Composition.boundary,sharedChecksV2,
  storageV2LocalPrimary:()=>storageShadow.primaryReady,
  recoverStorageV2State:()=>storageShadow.recoverForOwner({intent:'load-account'}),
  storageOwnerCurrent:()=>storageOwner.current(),
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
  persistSupabaseState:(...args)=>syncDocument.persistSupabaseState(...args),
  persistImmediateBrowserSnapshot:(...args)=>storageBrowser.persistImmediateBrowserSnapshot(...args),
  persistSharedChecksBase:(...args)=>syncChecksState.persistSharedChecksBase(...args),
  saveState:(...args)=>storagePersistence.saveState(...args),
  prepareKupaCloudState:(...args)=>stateNormalization.prepareKupaCloudState(...args),
  readSupabaseDocument:(...args)=>cloudTransport.readSupabaseDocument(...args),
  readSharedChecksDocument:(...args)=>cloudTransport.readSharedChecksDocument(...args),
  getCloudPending:(...args)=>storagePending.getCloudPending(...args),
  getSharedChecksPending:(...args)=>syncChecksState.getSharedChecksPending(...args),
  restoreGroupStore,
  stageRestoreGroup:(...args)=>cloudTransport.stageRestoreGroup(...args),
  applyRestoreGroup:(...args)=>cloudTransport.applyRestoreGroup(...args),
  listIncompleteRestoreGroups:(...args)=>cloudTransport.listIncompleteRestoreGroups(...args),
  listKupaCloudBackups:(...args)=>cloudTransport.listKupaCloudBackups(...args),
  readKupaCloudBackupPoint:(...args)=>cloudTransport.readKupaCloudBackupPoint(...args),
  loadSupaSession:(...args)=>cloudAuth.loadSupaSession(...args),
  render:(...args)=>uiNavigation.render(...args),
  modal:(...args)=>uiModal.modal(...args),
  closeModal:(...args)=>uiModal.closeModal(...args),
  chooseFolder:(...args)=>uiFolders.chooseFolder(...args),
  confirmDialog:(...args)=>uiModal.confirmDialog(...args),
  invalidateAllViewDomains:()=>domainRevisions.touchAll(),
});

const lifecycle=createLifecycle({
  hydrateStorageOwner:()=>storageOwner.hydrate({legacyOwner:async()=> (await cloudAuth.restoreSupaSession())?.user?.id}),
  verifyLocalStorageEngine:()=>verifyStorageV2LocalEngine({app:'kupa',owner:()=>storageOwner.current()}),
  recoverLocalV2State:()=>storageV2Coordinator.recoverLocalV2State(),
  recoverReadOnlyV2State:()=>storageV2Coordinator.recoverReadOnlyV2State(),
  ...storageV2Coordinator.transitionLifecyclePorts(),
  verifyStorageCutover,
  storageOwnerCurrent:()=>storageOwner.current(),
  authenticatedOwner:()=>cloudAuth.loadSupaSession()?.user?.id||null,
  readStorageProtocolState:()=>cloudTransport.readStorageProtocolState(),
  recoverFencedAccount:()=>storageV2Coordinator.recoverFencedAccount(),
  model,
  recoverSharedChecksV2Primary,
  recoverSharedChecksV2ReadOnly:(...args)=>sharedChecksV2.recoverReadOnly(...args),
  openBrowserStateFallback:(...args)=>syncRecovery.openBrowserStateFallback(...args),
  openBrowserStateReadOnly:(...args)=>syncRecovery.openBrowserStateReadOnly(...args),
  render:(...args)=>uiNavigation.render(...args),
  ensureSyncCapabilities:(...args)=>cloudAuth.ensureSyncCapabilities(...args),
  session,
  ...storageV2Cloud,
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
  setSaveStatus:(...args)=>uiStatus.setSaveStatus(...args),
  setConnectedStatus:(...args)=>uiStatus.setConnectedStatus(...args),
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
  resumeIncompleteRestore:(...args)=>uiBackup.resumeIncompleteRestore(...args),
  showCloudNoDocument:(...args)=>uiCloud.showCloudNoDocument(...args),
  tryAutoOpenSupabase:(...args)=>uiCloud.tryAutoOpenSupabase(...args),
  setConnectUI:(...args)=>uiConnection.setConnectUI(...args),
  showFirstRun:(...args)=>uiConnection.showFirstRun(...args),
  tryAutoOpenRemembered:(...args)=>uiConnection.tryAutoOpenRemembered(...args),
});

function canRunInteractiveAction(name=''){
  if(!tab.primaryTab&&!SECONDARY_READ_ONLY_ACTIONS.has(name)){uiStatus.toast('לקריאה בלבד — העריכה זמינה בטאב הראשי.');return false}
  // Recovery must stay reachable when an interrupted storage transition has
  // intentionally blocked every ordinary mutation. It still runs only in the
  // primary tab and performs its own authenticated cloud preflight.
  if(name==='reset-local-site-storage')return true;
  if(session.storageProtocolBlocked){uiStatus.toast('העריכה חסומה עד לאימות שדרוג האחסון. יש לרענן לאחר התחברות וחיבור לרשת.');return false}
  if(session.syncCapabilitiesError){uiStatus.toast('העריכה חסומה עד להשלמת התאמת מסד הנתונים לגרסת האתר.');return false}
  if(session.syncCapabilitiesChecking||session.startupCloudHydrating){uiStatus.toast('הנתונים המקומיים כבר מוצגים; העריכה תיפתח מיד לאחר אימות הענן.');return false}
  return true
}
const uiEvents={bindActionEvents:(root,actions)=>bindActionEvents(root,actions,{canRun:canRunInteractiveAction})};

document.getElementById('checkBankAlerts').addEventListener('click',()=>{if(canRunInteractiveAction('view-check-bank-alerts'))uiModal.modal('התאמות צ׳קים בבנק',checkBankReviewMarkup(model.state.checks),'סגור',()=>uiModal.closeModal(true))});

const creditCardOrderView=createCreditCardOrderView({getSync:()=>model.state.creditSync,saveOrder:(...args)=>domainsCreditController.saveCreditCardOrder(...args),modal:(title,body,footer)=>{uiModal.modal(title,body,'',()=>{});document.querySelector('#modal .modal-foot').innerHTML=footer},closeModal:()=>uiModal.closeModal(),render:()=>domainsCreditView.renderCredit(),escapeHtml:esc});

const uiActions=createUiActions({
  notesSheetActions:{...domainsNotesController.sheetActions,...spreadsheetWorkspace.actions},
  creditOrderActions:creditCardOrderView.actions,
  reviewCheckBank:(...args)=>{if(domainsChecksEditor.reviewCheckBank(...args))uiModal.closeModal(true)},
  ui,
  chooseBackupFolder:(...args)=>uiFolders.chooseBackupFolder(...args),
  loadSupabaseState:(...args)=>syncDocument.loadSupabaseState(...args),
  cloudPoll:(...args)=>syncDocument.cloudPoll(...args),
  discardCloudPendingAndLoadRemote:(...args)=>uiCloud.discardCloudPendingAndLoadRemote(...args),
  openSupabaseLoginModal:(...args)=>uiCloud.openSupabaseLoginModal(...args),
  enableCloudFromCurrentState:(...args)=>uiCloud.enableCloudFromCurrentState(...args),
  logoutSupabase:(...args)=>uiCloud.logoutSupabase(...args),
  resetLocalSiteStorage:(...args)=>uiCloud.resetLocalSiteStorage(...args),
  beginStorageV2Cutover,
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
  renderCreditDetails:(...args)=>domainsCreditView.renderCreditDetails(...args),
  pageCreditDetails:(...args)=>domainsCreditView.pageCreditDetails(...args),
  setCreditSearch:(...args)=>domainsCreditView.setCreditSearch(...args),
  setExpenseSearch:(...args)=>domainsExpensesView.setExpenseSearch(...args),
  setCashSearch:(...args)=>domainsCashView.setCashSearch(...args),
  setNotesSearch:(...args)=>domainsNotesController.setNotesSearch(...args),
  toggleCreditSyncOptions:(...args)=>domainsCreditView.toggleCreditSyncOptions(...args),
  saveBankBridgeToken:(...args)=>domainsBankController.saveBankBridgeToken(...args),
  configureBankBridge:(...args)=>domainsBankController.configureBankBridge(...args),
  selectBankBridgeAccount:(...args)=>domainsBankController.selectBankBridgeAccount(...args),
  openCashflowBreakdown:(...args)=>domainsBankView.openCashflowBreakdown(...args),
  setBankAccountView:(...args)=>domainsBankView.setBankAccountView(...args),
  setBankDataView:(...args)=>domainsBankView.setBankDataView(...args),
  openBankChequeImage:(...args)=>domainsBankView.openBankChequeImage(...args).catch(error=>uiStatus.toast(error?.message||String(error))),
  acknowledgeMissingBankTransaction:(...args)=>domainsBankController.acknowledgeMissingBankTransaction(...args),
  setBankSearch:(...args)=>domainsBankView.setBankSearch(...args),
  setBankDateMode:(...args)=>domainsBankView.setBankDateMode(...args),
  setBankDateBoundary:(...args)=>domainsBankView.setBankDateBoundary(...args),
  toggleBankSyncOptions:(...args)=>domainsBankView.toggleBankSyncOptions(...args),
  refreshBankBalance:(...args)=>domainsBankController.refreshBankBalance(...args),
  deleteBankBridgeCredentials:(...args)=>domainsBankController.deleteBankBridgeCredentials(...args),
  exportBankChequeDiagnostics:(...args)=>domainsBankController.exportBankChequeDiagnostics(...args),
  setBankAutoRefresh:(...args)=>domainsBankController.setBankAutoRefresh(...args),
  openCreditConnectionModal:(...args)=>domainsCreditController.openCreditConnectionModal(...args),
  deleteCreditConnection:(...args)=>domainsCreditController.deleteCreditConnection(...args),
  resetCreditSync:(...args)=>domainsCreditController.resetCreditSync(...args),
  refreshCreditSync:(...args)=>domainsCreditController.refreshCreditSync(...args),
  copySafeCreditDiagnostics:(...args)=>domainsCreditController.copySafeCreditDiagnostics(...args),
  exportCreditDataDiagnostics:(...args)=>domainsCreditController.exportCreditDataDiagnostics(...args),
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
  setNotesWorkspaceTab:(...args)=>domainsNotesController.setNotesWorkspaceTab(...args),
  setActiveNotesSheet:(...args)=>domainsNotesController.setActiveNotesSheet(...args),
  addNotesSheet:(...args)=>domainsNotesController.addNotesSheet(...args),
  deleteNotesSheet:(...args)=>domainsNotesController.deleteNotesSheet(...args),
  renameNotesSheet:(...args)=>domainsNotesController.renameNotesSheet(...args),
  addSheetRow:(...args)=>domainsNotesController.addSheetRow(...args),
  updateSheetCell:(...args)=>domainsNotesController.updateSheetCell(...args),
  saveSheetCell:(...args)=>domainsNotesController.saveSheetCell(...args),
  updateSheetColumnTitleDraft:(...args)=>domainsNotesController.updateSheetColumnTitleDraft(...args),
  handleSheetCellKeydown:(...args)=>domainsNotesController.handleSheetCellKeydown(...args),
  deleteSheetRow:(...args)=>domainsNotesController.deleteSheetRow(...args),
  addSheetColumn:(...args)=>domainsNotesController.addSheetColumn(...args),
  renameSheetColumn:(...args)=>domainsNotesController.renameSheetColumn(...args),
  setSheetColumnNumeric:(...args)=>domainsNotesController.setSheetColumnNumeric(...args),
  deleteSheetColumn:(...args)=>domainsNotesController.deleteSheetColumn(...args),
  openExpenseModal:(...args)=>domainsExpensesEditor.openExpenseModal(...args),
  updateCard:(...args)=>uiSettings.updateCard(...args),
  updateCashflowMinimum:(...args)=>uiSettings.updateCashflowMinimum(...args),
  updateCashflowCheckCutoff:(...args)=>uiSettings.updateCashflowCheckCutoff(...args),
  manualBackup:(...args)=>uiBackup.manualBackup(...args),
  downloadJsonBackup:(...args)=>uiBackup.downloadJsonBackup(...args),
  restoreBackup:(...args)=>uiBackup.restoreBackup(...args),
  refreshCloudBackups:(...args)=>uiBackup.refreshCloudBackups(...args),
  loadMoreCloudBackups:(...args)=>uiBackup.loadMoreCloudBackups(...args),
  previewCloudBackup:(...args)=>uiBackup.previewCloudBackup(...args),
  downloadCloudBackup:(...args)=>uiBackup.downloadCloudBackup(...args),
  downloadSelectedCloudBackup:(...args)=>uiBackup.downloadSelectedCloudBackup(...args),
  switchFolder:(...args)=>uiBackup.switchFolder(...args),
  exportCSV:(...args)=>uiBackup.exportCSV(...args),
});


window.addEventListener('online',()=>{if(!tab.primaryTab||session.storageProtocolBlocked)return;if(session.connectionMode==='supabase'){uiStatus.setSaveStatus('חזרה רשת — מסנכרן…','saving');uiStatus.setCloudHeaderStatus('syncing','ענן: חזרה רשת…');setTimeout(syncDocument.cloudPoll,250)}domainsBankController.maybeAutoRefreshBankBalance();domainsCreditController.maybeAutoRefreshCreditSync()});
window.addEventListener('offline',()=>{if(!tab.primaryTab||session.storageProtocolBlocked)return;if(session.connectionMode==='supabase'){storageBrowser.persistImmediateBrowserSnapshot(model.state,session.dbRevision,{storageBoundary:'network-offline-mirror'});uiStatus.setSaveStatus('אופליין — שינויים יישמרו מקומית','saving');uiStatus.setCloudHeaderStatus('offline','ענן: אופליין')}});
document.addEventListener('visibilitychange',()=>{if(document.hidden||!tab.primaryTab||session.storageProtocolBlocked)return;if(session.connectionMode==='supabase')setTimeout(syncDocument.cloudPoll,100);domainsBankController.maybeAutoRefreshBankBalance();domainsCreditController.maybeAutoRefreshCreditSync()});
uiSidebar.bind();
document.getElementById('backupTop').addEventListener('click',()=>{if(canRunInteractiveAction('manual-backup'))uiBackup.manualBackup()});
bindBackdropDismissal(document.getElementById('modalBackdrop'),()=>uiModal.closeModal());
document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(uiSidebar.isOpen())uiSidebar.close({restoreFocus:true});else uiModal.closeModal()}});
window.addEventListener('pagehide',()=>{
  if(!tab.primaryTab||session.storageProtocolBlocked)return;
  const v2Cloud=storageV2Cloud.storageV2CloudOutboxActive();
  if(!storageShadow.primaryReady)storageBrowser.persistImmediateBrowserSnapshot(model.state,session.dbRevision,{storageBoundary:'pagehide-v1-checkpoint'});
  if(session.connectionMode==='supabase'&&session.backendReady&&!v2Cloud&&session.lastSavedSnapshot){
    const current=stateNormalization.prepareKupaCloudState(model.state);
    if(!jsonEq(current,syncChecksState.lastSavedCloudState()))syncPending.stageCloudPendingLocal(current,'שינוי לפני סגירה',session.dbRevision,syncChecksState.lastSavedCloudState(),session.localGeneration,false);
  }
  if(!sharedChecksV2.primaryReady&&session.connectionMode==='supabase'&&syncChecksState.sharedChecksHaveLocalWork())syncChecksState.markSharedChecksPending();
});

window.addEventListener('beforeunload',e=>{
  if(!tab.primaryTab||session.storageProtocolBlocked)return;
  if(storageShadow.durabilityAtRisk||sharedChecksV2.durabilityAtRisk||session.localUndurableGenerations?.size){e.preventDefault();e.returnValue='';return}
  const v2Cloud=storageV2Cloud.storageV2CloudOutboxActive();
  const unsavedKupa=!v2Cloud&&session.backendReady&&session.lastSavedSnapshot&&!jsonEq(stateNormalization.prepareKupaCloudState(model.state),syncChecksState.lastSavedCloudState());
  const unsavedChecks=!sharedChecksV2.primaryReady&&session.connectionMode==='supabase'&&syncChecksState.sharedChecksHaveLocalWork();
  const v2Pending=v2Cloud&&!!session.storageV2CloudPending;
  if(!unsavedKupa&&!unsavedChecks&&!storagePending.cloudPendingExistsSync()&&!v2Pending)return;
  if(!storageShadow.primaryReady)storageBrowser.persistImmediateBrowserSnapshot(model.state,session.dbRevision,{storageBoundary:'beforeunload-v1-checkpoint'});
  if(session.connectionMode==='supabase'&&unsavedKupa&&session.lastSavedSnapshot)syncPending.stageCloudPendingLocal(stateNormalization.prepareKupaCloudState(model.state),'שינוי לפני סגירה',session.dbRevision,syncChecksState.lastSavedCloudState(),session.localGeneration,false);
  if(unsavedChecks)syncChecksState.markSharedChecksPending();
  e.preventDefault();e.returnValue='';
});
if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js').catch(console.error));}
uiEvents.bindActionEvents(document.getElementById('content'),uiActions);
bindDismissibleDetails(document);
bindNumberInputWheelGuard(document);
uiEvents.bindActionEvents(document.getElementById('modal'),uiActions);
uiGlobalSearch.bind();
export const appReady=lifecycle.boot().then(result=>{if(!session.storageProtocolBlocked)sharedChecksV2Shadow.boundary();return result});
export async function sharedChecksStorageV2Diagnostics(){await sharedChecksV2Shadow.flush();return {...sharedChecksV2Shadow.diagnostics}}
