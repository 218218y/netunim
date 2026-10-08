import {createKupaConnectivityRuntime} from './connectivity.js';
import {createStorageStartupRecovery} from './shared/storage-startup-recovery.js';
import {createRuntimeResources} from './shared/runtime-resources.js';
import {createKupaCloudStartup} from './startup/cloud-hydration.js';
import {createKupaLocalServices} from './startup/local-services.js';
import {createKupaConnectionStartup} from './startup/connection.js';
import {createKupaStorageV2Coordinator} from './composition/storage-v2.js';
import {installLocalSiteResetPeerListener} from './shared/local-site-reset.js';
import {assertKupaEntityInvariants} from './state/validation.js';
import {KUPA_FINANCE_DOMAINS} from './state/revisions.js';
import {createFinanceDerivationStore} from './shared/finance-derivations.js';
import {esc} from './core/values.js';
import {createCreditCardOrderView} from './shared/credit-card-order-view.js';
import {createUiConnection} from './ui/connection.js';
import {createStateNormalization} from './composition/state-normalization.js';
import {createUiStatus} from './ui/status.js';
import {createStorageIndexedDb} from './storage/indexed-db.js';
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
import {createSyncDocument} from './sync/document.js';
import {composeCloudUi} from './composition/cloud.js';
import {createUiDateEditor} from './ui/date-editor.js';
import {createKupaChecksRuntime} from './composition/checks.js';
import {createKupaCashRuntime} from './composition/cash.js';
import {createKupaCreditRuntime} from './composition/credit.js';
import {createKupaExpensesRuntime} from './composition/expenses.js';
import {createDomainsBankSelectors} from './domains/bank/selectors.js';
import {createUiNavigation} from './ui/navigation.js';
import {createUiSidebar} from './ui/sidebar.js';
import {createUiGlobalSearch} from './ui/global-search.js';
import {createDomainsDashboardView} from './domains/dashboard/view.js';
import {createDomainsDashboardController} from './domains/dashboard/controller.js';
import {createUiBulk} from './ui/bulk.js';
import {createKupaNotesRuntime} from './composition/notes.js';
import {createDomainsBankAlerts} from './domains/bank/alerts.js';
import {composeDocumentSearch} from './shared/document-search-composition.js';
import {composeKupaFinance} from './composition/finance.js';
import {createUiSettings} from './ui/settings.js';
import {createUiModal} from './ui/modal.js';
import {inactiveCreditExpired} from './domains/credit/model.js';
import {createDomainsRecordsCommands} from './domains/records/commands.js';
import {createUiBackup} from './ui/backup.js';
import {createLifecycle} from './lifecycle.js';
import {bindActionEvents,bindBackdropDismissal,bindDismissibleDetails,bindNumberInputWheelGuard} from './shared/events.js';
import {checkBankReviewItems,checkBankReviewMarkup} from './shared/check-bank-review.js';
import {composeActionRegistry} from './shared/action-registry.js';
import {createBankActions,createShellActions,createSettingsActions,createBackupActions,createCloudActions} from './ui/actions.js';
import {createContexts} from './state/contexts.js';
import {createKupaDomainRevisions,kupaPageRevision} from './state/revisions.js';
import {createRestoreGroupStore} from './shared/restore-groups.js';













const {model, session, ui, files, tab, checksSession}=createContexts();
installLocalSiteResetPeerListener();
// Event handlers are installed before the async owner/protocol preflight finishes.
session.storageProtocolBlocked=true;
const storageRecovery=createStorageStartupRecovery();
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
  storageRecovery,
  session,
  checksSession,
  tab,
});

const storageIndexedDb=createStorageIndexedDb({

});
const notes=createKupaNotesRuntime({model,ui,session,tab});
const captureLegacyWorkbook=(...args)=>notes.captureLegacyWorkbook(...args);

const mainStorageV2=storageV2Coordinator.createRuntime({validate:state=>assertKupaEntityInvariants(state,{includeChecks:Object.hasOwn(state||{},'checks'),required:true}),prepareCheckpoint:state=>stateNormalization.prepareKupaStorageState(state),prepareOperation:operation=>stateNormalization.prepareKupaStorageOperation(operation)});
const storageBrowser=createStorageBrowser({
  storageV2:mainStorageV2,
  model,
  session,
  files,
  normalizeState:(...args)=>stateNormalization.normalizeState(...args),
  prepareKupaCloudState:(...args)=>stateNormalization.prepareKupaCloudState(...args),
});
const storageV2Cloud=storageV2Coordinator.createCloudPorts(storageBrowser);

const restoreGroupStore=createRestoreGroupStore({
  localKey:'kupa.restore.group.v1',
  put:(key,value)=>storageIndexedDb.idbPut('sync',key,value),
  get:key=>storageIndexedDb.idbGet('sync',key),
  remove:key=>storageIndexedDb.idbDelete('sync',key),
});

const syncChecksState=createSyncChecksState({
  checksSession,
  model,
  sharedChecksHasLocalWork:()=>sharedChecksV2.hasLocalWork,
});

const sharedChecksV2Composition=storageV2Coordinator.createSharedComposition({
  model,checksSession,domainRevisions,main:mainStorageV2,stateNormalization,getSyncChecks:()=>syncChecks,getCloudTransport:()=>cloudTransport,
});
const sharedChecksV2=sharedChecksV2Composition.runtime;
const recoverSharedChecksV2Primary=()=>storageV2Coordinator.recoverShared();
const verifyStorageV2AccountMarker=sharedChecksV2Composition.verifyAccountMarker;

const storageTabLock=createStorageTabLock({
  tab,
  showSecondaryTabGuard:(...args)=>uiConnection.showSecondaryTabGuard(...args),
});

const syncRecovery=createSyncRecovery({
  captureLegacyWorkbook,
  hideConnectScreen:(...args)=>uiStatus.hideConnectScreen(...args),
  model,
  session,
  prepareKupaCloudState:(...args)=>stateNormalization.prepareKupaCloudState(...args),
  normalizeState:(...args)=>stateNormalization.normalizeState(...args),
  setSaveStatus:(...args)=>uiStatus.setSaveStatus(...args),
  setConnectedStatus:(...args)=>uiStatus.setConnectedStatus(...args),
  setCloudHeaderStatus:(...args)=>uiStatus.setCloudHeaderStatus(...args),
  ...storageV2Cloud,
  loadBrowserState:(...args)=>storageBrowser.loadBrowserState(...args),
  loadBrowserStateReadOnly:(...args)=>storageBrowser.loadBrowserStateReadOnly(...args),
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
  creditNormalizationMayDelete:inactiveCreditExpired,
  sharedChecksV2,
  storageV2Boundary:sharedChecksV2Composition.boundary,
  captureLegacyWorkbook,
  storageV2Primary:()=>mainStorageV2.primaryReady,
  recoverStorageV2State:()=>mainStorageV2.recoverForOwner({intent:'load-account'}),
  storageV2DurabilityAtRisk:()=>mainStorageV2.durabilityAtRisk,
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
  showSecondaryTabGuard:(...args)=>uiConnection.showSecondaryTabGuard(...args),
  saveSharedChecksToCloud:(...args)=>syncChecks.saveSharedChecksToCloud(...args),
  writeJsonHandleVerified:(...args)=>storageFiles.writeJsonHandleVerified(...args),
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

const domainsDocumentBridge=composeDocumentSearch({supaFetch:(...args)=>cloudAuth.supaRest(...args)});

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
  toast:(...args)=>uiStatus.toast(...args),
  render:(...args)=>uiNavigation.checksChanged(...args),
  setSaveStatus:(text,mode)=>uiStatus.setSaveStatus(text,mode,'shared-checks'),
  setCloudHeaderStatus:(mode,text)=>uiStatus.setCloudHeaderStatus(mode,text,'shared-checks'),
  backupSnapshotToComputer:(...args)=>storageBackup.backupSnapshotToComputer(...args),
  refreshCloudHeaderTimestamp:(...args)=>uiStatus.refreshCloudHeaderTimestamp(...args),
});

const syncMerge=createSyncMerge({
  normalizeState:(...args)=>stateNormalization.normalizeState(...args),
  prepareKupaCloudState:(...args)=>stateNormalization.prepareKupaCloudState(...args),
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
  listBackups:(...args)=>storageBackup.listBackups(...args),
  backupSnapshotToComputer:(...args)=>storageBackup.backupSnapshotToComputer(...args),
  syncSharedChecksFromCloud:(...args)=>syncChecks.syncSharedChecksFromCloud(...args),
  render:(...args)=>uiNavigation.render(...args),
  readSupabaseDocument:(...args)=>cloudTransport.readSupabaseDocument(...args),
  readFinanceSyncDocument:(...args)=>cloudTransport.readFinanceSyncDocument(...args),
  supaRest:(...args)=>cloudAuth.supaRest(...args),
  mergeKupaCloudState3Way:(...args)=>syncMerge.mergeKupaCloudState3Way(...args),
  showSecondaryTabGuard:(...args)=>uiConnection.showSecondaryTabGuard(...args),
  toast:(...args)=>uiStatus.toast(...args),
  pollSharedChecks:(...args)=>syncChecks.pollSharedChecks(...args),
  refreshOrdersFinanceSummary:(...args)=>domainsDashboardController.refreshOrdersFinanceSummary(...args),
  ...storageV2Cloud,
  storageV2PreparationActive:storagePreparationActive,
  ...storageV2Coordinator.accountContextPort(),
  domainRevisions,
});


storageV2Coordinator.configure({
  storageBrowser,syncDocument,syncChecks,model,session,checksSession,files,
  captureLegacyWorkbook,
  stateNormalization,domainRevisions,sharedChecksV2Composition,sharedChecksV2,
  cloudTransport,cloudAuth,mainStorageV2,verifyStorageV2AccountMarker:()=>verifyStorageV2AccountMarker(),
});

const uiCloud=composeCloudUi({
  session,tab,checksSession,model,storageV2Cloud,storageV2Coordinator,syncDocument,uiStatus,cloudAuth,
  getUiModal:()=>uiModal,uiConnection,stateNormalization,syncChecksState,syncRecovery,cloudTransport,syncChecks,getUiNavigation:()=>uiNavigation,
});

const checks=createKupaChecksRuntime({model,ui});
const uiDateEditor=createUiDateEditor({
  markCheckSeriesManual:(...args)=>checks.markCheckSeriesManual(...args),
  syncCheckSeriesFromFirst:(...args)=>checks.syncCheckSeriesFromFirst(...args),
  toast:(...args)=>uiStatus.toast(...args),
});

const cash=createKupaCashRuntime({model,ui});
const credit=createKupaCreditRuntime({model,ui});

const domainsBankSelectors=createDomainsBankSelectors({
  model,
  checksSession,
});

const uiNavigation=createUiNavigation({
  runFinance:financeDerivations.run,
  refreshCheckBankIndicator:()=>{const b=document.getElementById('checkBankAlerts');if(b){const count=checkBankReviewItems(model.state.checks).length;b.hidden=!count;b.textContent=`⚠ צ׳קים (${count})`}},
  ui,
  renderDashboard:(...args)=>domainsDashboardView.renderDashboard(...args),
  renderChecks:(...args)=>checks.renderChecks(...args),
  renderCredit:(...args)=>credit.renderCredit(...args),
  renderCash:(...args)=>cash.renderCash(...args),
  renderBank:(...args)=>domainsBankView.renderBank(...args),
  renderNotes:(...args)=>notes.renderNotes(...args),
  renderSettings:(...args)=>uiSettings.renderSettings(...args),
  maybeAutoRefreshBankBalance:(...args)=>domainsBankController.maybeAutoRefreshBankBalance(...args),
  maybeAutoRefreshCreditSync:(...args)=>domainsCreditController.maybeAutoRefreshCreditSync(...args),
  maybeShowCashflowStartupAlert:(...args)=>domainsBankAlerts.maybeShowStartupCashflowAlert(...args),
  onPageActivated:page=>{void notes.activateSheetIfVisible(page)},
  dataRevision:page=>kupaPageRevision(domainRevisions,page)+':'+new Date().toLocaleDateString('en-CA')+notes.revisionSuffix(page),
});

const uiGlobalSearch=createUiGlobalSearch({
  documentBridge:domainsDocumentBridge,
  searchRevision:domains=>domainRevisions.stamp(domains)+':'+new Date().toLocaleDateString('en-CA'),
  runFinance:financeDerivations.run,
  model,
  ui,
  setPage:(...args)=>uiNavigation.setPage(...args),
  confirmDialog:(...args)=>uiModal.confirmDialog(...args),
});

const uiSidebar=createUiSidebar({setPage:(...args)=>uiNavigation.setPage(...args)});

const domainsDashboardView=createDomainsDashboardView({
  runFinance:financeDerivations.run,
  model,
  activeChecks:(...args)=>checks.activeChecks(...args),
  depositedChecks:(...args)=>checks.depositedChecks(...args),
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

const expenses=createKupaExpensesRuntime({
  model,ui,
  bankForecast:{
    business:(...args)=>domainsBankSelectors.bankNextCycleCommitments(...args),
    home:(...args)=>domainsBankSelectors.bankHomeNextCycleCommitments(...args),
  },
});

const {
  creditController:domainsCreditController,
  bankController:domainsBankController,
  bankView:domainsBankView,
  createConnectionImporter:composeFinanceConnectionImporter,
}=composeKupaFinance({
  model,session,checksSession,ui,cloudAuth,cloudTransport,syncDocument,
  syncChecksState,syncChecks,storagePersistence,uiStatus,uiNavigation,
  uiDateEditor,financeDerivations,domainsBankSelectors,domainRevisions,
  getUiModal:()=>uiModal,
});

credit.bindView({
  controller:domainsCreditController,uiBulk,uiDateEditor,financeDerivations,domainRevisions,
  expensesMarkup:(...args)=>expenses.expensesMarkup(...args),
});

checks.bindView({
  uiBulk,
  getBankImageContext:()=>({bank:domainsBankController.bankBridgeUiState(),imageAction:'view-bank-cheque-image'}),
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
});

const uiModal=createUiModal({
  ui,
});

notes.bind({cloudAuth,uiModal,storagePersistence});
notes.assertReady();

const importFinanceConnections=composeFinanceConnectionImporter();

const domainsBankAlerts=createDomainsBankAlerts({
  model,
  bankProjectedThisMonth:(...args)=>domainsBankSelectors.bankProjectedThisMonth(...args),
  bankHomeProjectedThisMonth:(...args)=>domainsBankSelectors.bankHomeProjectedThisMonth(...args),
  modal:(...args)=>uiModal.modal(...args),
  closeModal:(...args)=>uiModal.closeModal(...args),
});

const domainsRecordsCommands=createDomainsRecordsCommands({
  model,
  saveState:(...args)=>storagePersistence.saveState(...args),
  saveChecksState:(...args)=>storagePersistence.saveChecksState(...args),
  closeModal:(...args)=>uiModal.closeModal(...args),
  confirmDialog:(...args)=>uiModal.confirmDialog(...args),
  renderCollection:collection=>{
    if(collection==='checks')uiNavigation.checksChanged();
    if(collection==='cash'||collection==='rights')cash.renderCash();
    else if(collection==='expenses'||collection==='credits')credit.renderCredit();
  },
});

cash.bindUi({uiBulk,uiDateEditor,domainsDashboardView,uiModal,uiStatus,storagePersistence,domainsRecordsCommands});
cash.assertReady();

checks.bindEditor({uiDateEditor,uiModal,uiStatus,storagePersistence,domainsRecordsCommands,uiNavigation,uiBulk});
checks.assertReady();

credit.bindEditor({uiModal,uiDateEditor,uiStatus,storagePersistence,domainsRecordsCommands});
credit.assertReady();

expenses.bindEditor({
  uiModal,uiDateEditor,uiStatus,storagePersistence,domainsRecordsCommands,
  renderCredit:(...args)=>credit.renderCredit(...args),
});
expenses.assertReady();

const uiBackup=createUiBackup({
  ...storageV2Cloud,
  storageV2Boundary:sharedChecksV2Composition.boundary,sharedChecksV2,
  storageV2LocalPrimary:()=>mainStorageV2.primaryReady,
  recoverStorageV2State:()=>mainStorageV2.recoverForOwner({intent:'load-account'}),
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
  stateFromPayload:(...args)=>stateNormalization.stateFromPayload(...args),
  persistSupabaseState:(...args)=>syncDocument.persistSupabaseState(...args),
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

storageRecovery.bind({
  main:{primary:({localEngineActive})=>localEngineActive?storageV2Coordinator.recoverLocalV2State():syncRecovery.recoverBrowserV2State({startup:true,deferRender:true}),
    readOnly:()=>storageV2Coordinator.recoverReadOnlyV2State()},
  shared:{primary:recoverSharedChecksV2Primary,readOnly:()=>sharedChecksV2.recoverReadOnly()},
});

const startupAccess=()=>tab.primaryTab&&!session.storageProtocolBlocked&&storageRecovery.isReady();
const connectionResources=createRuntimeResources();
const connectionStartup=createKupaConnectionStartup({
  events:{listen:(id,handler)=>connectionResources.listen(document.getElementById(id),'click',handler),dispose:()=>connectionResources.dispose()},
  actions:{chooseFolder:uiFolders.chooseFolder,chooseDataFile:uiFolders.chooseDataFile,openLastFolder:uiFolders.openLastFolder,openCloud:uiConnection.handleCloudConnectButton},
  presentation:{tryAutoOpenRemembered:uiConnection.tryAutoOpenRemembered,showFirstRun:uiConnection.showFirstRun},access:{allowed:startupAccess},
});
const localServices=createKupaLocalServices({storage:{requestPersistentBrowserStorage:storageBrowser.requestPersistentBrowserStorage},backup:{restoreTarget:uiFolders.restoreRememberedBackupTarget}});
const cloudStartup=createKupaCloudStartup({
  session,access:{allowed:startupAccess,online:()=>navigator.onLine!==false,authenticated:()=>!!cloudAuth.loadSupaSession()},
  capabilities:{ensure:cloudAuth.ensureSyncCapabilities},restore:{resume:uiBackup.resumeIncompleteRestore},
  cloud:{configured:cloudAuth.supaConfigured,openAutomatic:uiCloud.tryAutoOpenSupabase,noDocument:()=>session.cloudAuthNoDocument,
    showNoDocument:uiCloud.showCloudNoDocument,startPolling:syncDocument.startCloudPolling},
  status:{setCloudHeaderStatus:uiStatus.setCloudHeaderStatus,setConnectUI:uiConnection.setConnectUI},
});

const lifecycle=createLifecycle({
  storageProtocol:storageV2Coordinator.startupProtocol,
  storageRecovery,
  cloudStartup,localServices,connectionStartup,
  hydrateStorageOwner:()=>storageOwner.hydrate({initialOwner:async()=> (await cloudAuth.restoreSupaSession())?.user?.id}),
  hideConnectScreen:()=>uiStatus.hideConnectScreen(),
  ...storageV2Coordinator.lifecyclePorts(),
  render:(...args)=>uiNavigation.render(...args),
  session,
  tab,
  setCloudHeaderStatus:(...args)=>uiStatus.setCloudHeaderStatus(...args),
  setSaveStatus:(...args)=>uiStatus.setSaveStatus(...args),
  setConnectedStatus:(...args)=>uiStatus.setConnectedStatus(...args),
  showSecondaryTabGuard:(...args)=>uiConnection.showSecondaryTabGuard(...args),
  acquirePrimaryTabLock:(...args)=>storageTabLock.acquirePrimaryTabLock(...args),
  restoreSupaSession:(...args)=>cloudAuth.restoreSupaSession(...args),
  setConnectUI:(...args)=>uiConnection.setConnectUI(...args),
});

const uiEvents={bindActionEvents:(root,actions)=>bindActionEvents(root,actions,{canRun:(...args)=>uiStatus.canRunInteractiveAction(...args)})};

document.getElementById('checkBankAlerts').addEventListener('click',()=>{if(uiStatus.canRunInteractiveAction('view-check-bank-alerts'))uiModal.modal('התאמות צ׳קים בבנק',checkBankReviewMarkup(model.state.checks),'סגור',()=>uiModal.closeModal(true))});

const creditCardOrderView=createCreditCardOrderView({getSync:()=>model.state.creditSync,saveOrder:(...args)=>domainsCreditController.saveCreditCardOrder(...args),modal:(title,body,footer)=>{uiModal.modal(title,body,'',()=>{});document.querySelector('#modal .modal-foot').innerHTML=footer},closeModal:()=>uiModal.closeModal(),render:()=>credit.renderCredit(),escapeHtml:esc});

const uiActions=composeActionRegistry([
  {name:'checks',actions:checks.actions},
  {name:'bank',actions:createBankActions({domainsBankController,domainsBankView,importFinanceConnections,ui,uiStatus})},
  {name:'shell',actions:createShellActions({uiModal,uiNavigation})},
  {name:'credit',actions:credit.actions},
  {name:'credit-order',actions:creditCardOrderView.actions},
  {name:'cash',actions:cash.actions},
  {name:'notes',actions:notes.actions},
  {name:'notes-sheet',actions:notes.sheetActions},
  {name:'spreadsheet-workspace',actions:notes.workspaceActions},
  {name:'expenses',actions:expenses.actions},
  {name:'settings',actions:createSettingsActions({uiSettings})},
  {name:'backup',actions:createBackupActions({uiBackup,uiFolders})},
  {name:'cloud',actions:createCloudActions({syncDocument,uiCloud})},
]);


const connectivity=createKupaConnectivityRuntime({
  access:{primary:()=>tab.primaryTab,blocked:()=>session.storageProtocolBlocked||!storageRecovery.isReady()||session.startupCloudHydrating||session.syncCapabilitiesChecking||!!session.syncCapabilitiesError},
  cloud:{connected:()=>session.connectionMode==='supabase',resumeAfterReconnect:()=>syncDocument.resumeAfterReconnect(),cloudPoll:()=>syncDocument.cloudPoll()},
  bank:domainsBankController,credit:domainsCreditController,status:uiStatus,
});
connectivity.start();
uiSidebar.bind();
document.getElementById('backupTop').addEventListener('click',()=>{if(uiStatus.canRunInteractiveAction('manual-backup'))uiBackup.manualBackup()});
bindBackdropDismissal(document.getElementById('modalBackdrop'),()=>uiModal.closeModal());
document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(uiSidebar.isOpen())uiSidebar.close({restoreFocus:true});else uiModal.closeModal()}});
window.addEventListener('beforeunload',e=>{
  if(!tab.primaryTab||session.storageProtocolBlocked)return;
  if(mainStorageV2.durabilityAtRisk||sharedChecksV2.durabilityAtRisk||session.localUndurableGenerations?.size){e.preventDefault();e.returnValue=''}
});
if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js').catch(console.error));}
uiEvents.bindActionEvents(document.getElementById('content'),uiActions);
bindDismissibleDetails(document);
bindNumberInputWheelGuard(document);
uiEvents.bindActionEvents(document.getElementById('modal'),uiActions);
uiGlobalSearch.bind();
export const appReady=lifecycle.boot();
export async function sharedChecksStorageV2Diagnostics(){await sharedChecksV2.flush();return {...sharedChecksV2.diagnostics}}
