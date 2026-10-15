import {createOrdersChecksCapability} from './composition/checks.js';
import {createOrdersFinanceCapability} from './composition/finance.js';
import {readCloudWriteScope} from './shared/cloud-write-scope.js';
import {createOrdersStorageV2Coordinator} from './composition/storage-v2.js';
import {createStorageStartupRecovery} from './shared/storage-startup-recovery.js';
import {createOrdersCloudStartup} from './startup/cloud-hydration.js';
import {createOrdersLocalServices} from './startup/local-services.js';
import {createOrdersBackgroundStartup} from './startup/background.js';
import {installLocalSiteResetPeerListener} from './shared/local-site-reset.js';
import {assertOrderEntityInvariants} from './state/validation.js';
import {createFinanceDerivationStore} from './shared/finance-derivations.js';
import {createMorningOperationScope} from './core/morning-operation-scope.js';
import {createStateNormalization} from './state/normalization.js';
import {createStorageBrowser} from './storage/browser.js';
import {createOrdersSuppliersRuntime} from './composition/suppliers.js';
import {createOrdersWarehouseRuntime} from './composition/warehouse.js';
import {createUiStatus} from './ui/status.js';
import {createUiFolderStatus} from './ui/folder-status.js';
import {createUiTabGuard} from './ui/tab-guard.js';
import {createStorageTabLock} from './storage/tab-lock.js';
import {createStoragePersistence} from './storage/persistence.js';
import {createStateSnapshots} from './state/snapshots.js';
import {createUiLayout} from './ui/layout.js';
import {createUiNavigation} from './ui/navigation.js';
import {createUiAlertCenter} from './ui/alert-center.js';
import {composeDocumentSearch} from './shared/document-search-composition.js';
import {createUiDateEditor} from './ui/date-editor.js';
import {createDomainsDashboardView} from './domains/dashboard/view.js';
import {createUiModal} from './ui/modal.js';
import {createOrdersCustomersRuntime} from './composition/customers.js';
import {createOrdersServiceRuntime} from './composition/service.js';
import {composeBackup} from './composition/backup.js';
import {createStateSelectors} from './state/selectors.js';
import {createStorageFiles} from './storage/files.js';
import {createStorageBackup} from './storage/backup.js';
import {createStorageIndexedDb} from './storage/indexed-db.js';
import {createOrdersFolderCapability} from './composition/folders.js';
import {createCloudAuth} from './cloud/auth.js';
import {createCloudTransport} from './cloud/transport.js';
import {createSyncMerge} from './sync/merge.js';
import {createSyncDocument} from './composition/main-sync.js';
import {composeCloudUi} from './composition/cloud.js';
import {createNotesDomain} from './domains/notes/index.js';
import {createOrdersCalendarRuntime} from './composition/calendar.js';
import {createUiSettings} from './ui/settings.js';
import {createLifecycle} from './lifecycle.js';
import {bindActionEvents,bindDismissibleDetails,bindNumberInputWheelGuard} from './shared/events.js';
import {composeActionRegistry} from './shared/action-registry.js';
import {wrapMutationActions,createExternalActionPacks,createAlertsActions,createShellActions,createDashboardActions,createBackupActions,createCloudActions,createNotesActions,createCalendarActions} from './ui/actions.js';
import {createUiGlobalSearch} from './ui/global-search.js';
import {createUiKeyboardNavigation} from './ui/keyboard-navigation.js';
import {createContexts} from './state/contexts.js';
import {createOrderDomainRevisions,orderViewRevision} from './state/revisions.js';
import {createRestoreGroupStore} from './shared/restore-groups.js';
import {INITIAL_STATE} from "./state/constants.js";
import {bindOrdersRuntimeEvents} from './runtime-events.js';

const {model, ui, supplierUi, customerUi, serviceUi, warehouseUi, notesUi, calendarUi, calendarSession, files, tab, session, checksSession}=createContexts();
installLocalSiteResetPeerListener();
// Event handlers are installed before the async owner/protocol preflight finishes.
session.storageProtocolBlocked=true;
const storageRecovery=createStorageStartupRecovery();
const domainRevisions=createOrderDomainRevisions(session);
const financeDerivations=createFinanceDerivationStore({revision:()=>domainRevisions.stamp(['finance','checks'])});

const storageV2Coordinator=createOrdersStorageV2Coordinator({tab,session});
const {owner:storageOwner,preparing:storagePreparationActive}=storageV2Coordinator;

const stateNormalization=createStateNormalization({
  externalWorkbooks:true,
  model,
});

// Journal checkpoints must be deterministic: a new savedAt on every replay
// would make a frozen local-birth source fail parity after a crash.
const prepareV2Checkpoint=state=>{const business=structuredClone(state);delete business._meta;const snapshot=stateSelectors.prepareState(business);delete snapshot._meta.savedAt;return snapshot};
const mainStorageV2=storageV2Coordinator.createRuntime({validate:state=>assertOrderEntityInvariants(state,{includeChecks:Object.hasOwn(state||{},'checks'),required:true}),prepareCheckpoint:prepareV2Checkpoint});
const storageBrowser=createStorageBrowser({
  storageV2:mainStorageV2,
  captureEmbeddedWorkbook:(...args)=>spreadsheetWorkspace.sync.captureLegacy(...args),
  model,
  files,
  session,
  prepareCloudState:(...args)=>stateSnapshots.prepareCloudState(...args),
  normalizeState:(...args)=>stateNormalization.normalizeState(...args),
  domainRevisions,
});
const storageV2Cloud=storageV2Coordinator.createCloudPorts(storageBrowser);

const restoreGroupStore=createRestoreGroupStore({
  localKey:'orders.restore.group.v1',
  put:(...args)=>storageBrowser.idbSyncPut(...args),
  get:(...args)=>storageBrowser.idbSyncGet(...args),
  remove:(...args)=>storageBrowser.idbSyncDelete(...args),
});

const sharedChecksV2Composition=storageV2Coordinator.createSharedComposition({
  model,checksSession,domainRevisions,main:mainStorageV2,stateNormalization,getCloudTransport:()=>cloudTransport,
});
const sharedChecksV2=sharedChecksV2Composition.runtime;
const recoverSharedChecksV2Primary=()=>storageV2Coordinator.recoverShared();
const verifyStorageV2AccountMarker=sharedChecksV2Composition.verifyAccountMarker;

const cloudAuth=createCloudAuth({
  session,
  assertSessionOwner:(...args)=>storageOwner.assertSessionOwner(...args),
});

const checks=createOrdersChecksCapability({
  model,ui,session,checksSession,files,tab,sharedChecksV2,
  auth:{loadSession:(...args)=>cloudAuth.loadSession(...args)},
  touchRevision:()=>domainRevisions.touch('checks'),
});

const finance=createOrdersFinanceCapability({
  model,ui,checksSession,tab,
  auth:{loadSession:(...args)=>cloudAuth.loadSession(...args),supaFetch:(...args)=>cloudAuth.supaFetch(...args),ensureSession:(...args)=>cloudAuth.ensureSession(...args)},
  readAccess:()=>({
    account:cloudAuth.getAccountScope(),connectionMode:'supabase',storageOwner:storageOwner.current(),
    readable:storageOwner.ready&&!storagePreparationActive()&&!session.storageProtocolBlocked&&storageRecovery.isReady(),
    writable:tab.primaryTab&&storageOwner.writable&&!storagePreparationActive()&&!session.storageProtocolBlocked&&storageRecovery.isReady(),
  }),
  revisions:{read:()=>domainRevisions.stamp(['finance','checks','bankDisplay']),touchFinance:()=>domainRevisions.touch('finance'),touchBankDisplay:()=>domainRevisions.touch('bankDisplay')},
  runFinance:financeDerivations.run,
});
const morningOperationScope=createMorningOperationScope({readAccess:()=>({
  account:cloudAuth.getAccountScope(),storageOwner:storageOwner.current(),
  readable:storageOwner.ready&&!storagePreparationActive()&&!session.storageProtocolBlocked&&storageRecovery.isReady(),
  writable:tab.primaryTab&&storageOwner.writable&&!storagePreparationActive()&&!session.storageProtocolBlocked&&storageRecovery.isReady(),
})});
const domainsDocumentBridge=composeDocumentSearch({supaFetch:(...args)=>cloudAuth.supaFetch(...args),accountScope:()=>cloudAuth.getAccountScope(),subscribeAccountScope:cloudAuth.subscribeAccountScope});

const calendarRuntime=createOrdersCalendarRuntime({
  calendarSession,supaFetch:(...args)=>cloudAuth.supaFetch(...args),accountScope:()=>cloudAuth.getAccountScope(),subscribeAccountScope:cloudAuth.subscribeAccountScope,
});

const suppliers=createOrdersSuppliersRuntime({model,supplierUi,ui});
const warehouse=createOrdersWarehouseRuntime({model,warehouseUi,ui,inventoryRevision:()=>domainRevisions.stamp(['inventory'])});
const domainsCustomers=createOrdersCustomersRuntime({model,customerUi,customerRevision:()=>domainRevisions.stamp(['customerDebts','customerOrders'])});
const service=createOrdersServiceRuntime({model,serviceUi,serviceRevision:()=>domainRevisions.stamp(['service'])});

const uiStatus=createUiStatus({
  storageRecovery,
  session,
  checksSession,
  tab,
});

const uiFolderStatus=createUiFolderStatus({
  files,
});

const uiTabGuard=createUiTabGuard({
  tab,
});

const storageTabLock=createStorageTabLock({
  tab,
  showSecondaryTabGuard:(...args)=>uiTabGuard.showSecondaryTabGuard(...args),
});

const storagePersistence=createStoragePersistence({
  tab,
  session,
  domainRevisions,
  showSecondaryTabGuard:(...args)=>uiTabGuard.showSecondaryTabGuard(...args),
  localSnapshot:(...args)=>storageBrowser.localSnapshot(...args),
  ...storageV2Cloud,
  storageV2DurabilityAtRisk:()=>mainStorageV2.durabilityAtRisk,
  setSave:(...args)=>uiStatus.setSave(...args),
  syncFolderAccessButton:(...args)=>uiFolderStatus.syncFolderAccessButton(...args),
  folderBackupAvailable:(...args)=>uiFolderStatus.folderBackupAvailable(...args),
  folderSaveTitle:(...args)=>uiFolderStatus.folderSaveTitle(...args),
  writeStateToFolder:(...args)=>storageFiles.writeStateToFolder(...args),
  cloudEnabled:(...args)=>cloudAuth.cloudEnabled(...args),
  requestCloudSave:(...args)=>syncDocument.requestCloudSave(...args),
  setCloud:(...args)=>uiStatus.setCloud(...args),
});

const stateSnapshots=createStateSnapshots({
  externalWorkbooks:true,
  model,
  ui,
  session,
  checksSession,
  prepareState:(...args)=>stateSelectors.prepareState(...args),
  cloudPendingExists:(...args)=>storageBrowser.cloudPendingExists(...args),
  sharedChecksHasLocalWork:()=>sharedChecksV2.hasLocalWork,
  normalizeState:(...args)=>stateNormalization.normalizeState(...args),
  domainRevisions,
});

const uiLayout=createUiLayout({
  ui,
  supplierUi,
});

const uiNavigation=createUiNavigation({
  ui,
  model,
  supplierUi,
  customerUi,
  serviceUi,
  warehouseUi,
  notesUi,
  renderKupa:(...args)=>finance.presentation.renderKupa(...args),
  renderChecks:(...args)=>checks.presentation.renderChecks(...args),
  renderSummary:(...args)=>domainsDashboardView.renderSummary(...args),
  renderSupplier:(...args)=>suppliers.renderSupplier(...args),
  renderCustomers:(...args)=>domainsCustomers.renderCustomers(...args),
  renderService:(...args)=>service.renderService(...args),
  renderWarehouse:(...args)=>warehouse.renderWarehouse(...args),
  renderNotes:(...args)=>domainsNotesController.renderNotes(...args),
  renderCalendar:(...args)=>domainsCalendarController.renderCalendar(...args),
  renderSettings:(...args)=>uiSettings.renderSettings(...args),
  refreshAlertCenter:(...args)=>uiAlertCenter.refreshIndicator(...args),
  dataRevision:view=>orderViewRevision(domainRevisions,view)+':'+new Date().toLocaleDateString('en-CA'),
});

checks.bindView({
  layout:{mountViewLayout:(...args)=>uiLayout.mountViewLayout(...args)},
  bankImageContext:()=>({bank:finance.queries.snapshot().bank,imageAction:'view-orders-bank-cheque-image'}),
});

finance.bindReadout({
  cloud:{readKupaReadOnlyCloud:(...args)=>cloudTransport.readKupaReadOnlyCloud(...args),readKupaReadOnlyMeta:(...args)=>cloudTransport.readKupaReadOnlyMeta(...args)},
  display:{renderChecks:(...args)=>checks.presentation.renderChecks(...args),renderSummary:(...args)=>domainsDashboardView.renderSummary(...args),refreshAlerts:(...args)=>uiAlertCenter.refreshIndicator(...args)},
});

const uiDateEditor=createUiDateEditor({
  markCheckSeriesManual:(...args)=>checks.dateEditing.markCheckSeriesManual(...args),
  syncCheckSeriesFromFirst:(...args)=>checks.dateEditing.syncCheckSeriesFromFirst(...args),
  toast:(...args)=>uiStatus.toast(...args),
});

checks.bindEditor({
  date:uiDateEditor,
  modal:{modal:(...args)=>uiModal.modal(...args),closeModal:(...args)=>uiModal.closeModal(...args),confirmDialog:(...args)=>uiModal.confirmDialog(...args)},
  toast:(...args)=>uiStatus.toast(...args),
  finance:{readout:finance.readout,presentation:finance.presentation},
});
checks.bindPersistence({
  status:uiStatus,folder:uiFolderStatus,
  rejectMutation:(...args)=>storagePersistence.rejectSecondaryMutation(...args),
  writeFolder:(...args)=>storageFiles.writeStateToFolder(...args),
  refreshAlerts:(...args)=>uiAlertCenter.refreshIndicator(...args),
});

const domainsDashboardView=createDomainsDashboardView({
  model,
  ui,
  checksSession,
  ...suppliers.dashboardPorts(),
  mountViewLayout:(...args)=>uiLayout.mountViewLayout(...args),
  customerStats:(...args)=>domainsCustomers.customerStats(...args),
});

const uiModal=createUiModal({});
suppliers.bindUi({uiLayout,uiNavigation,uiModal,uiStatus,storagePersistence});
suppliers.assertReady();

const uiBackup=composeBackup({tab,ui,model,session,checksSession,storageV2Cloud,storageV2Runtime:mainStorageV2,storageOwner,sharedChecksV2Composition,sharedChecksV2,stateNormalization,stateSelectors:()=>stateSelectors,uiTabGuard,uiModal,storageBrowser,uiStatus,uiFolderStatus,stateSnapshots,uiNavigation,uiSettings:()=>uiSettings,storageFiles:()=>storageFiles,cloudAuth,cloudTransport:()=>cloudTransport,syncDocument:()=>syncDocument,restoreGroupStore,supplierBackup:suppliers.backupPorts(),domainRevisions});

const stateSelectors=createStateSelectors({
  model,
});

const storageFiles=createStorageFiles({
  files,
  tab,
  canWrite:()=>tab.primaryTab&&storageOwner.writable&&!storagePreparationActive()&&!session.storageProtocolBlocked&&storageRecovery.isReady(),
  syncFolderAccessButton:(...args)=>uiFolderStatus.syncFolderAccessButton(...args),
  prepareState:(...args)=>stateSelectors.prepareState(...args),
  writeVerifiedFolderBackup:(...args)=>storageBackup.writeVerifiedFolderBackup(...args),
  maybeCreateAutomaticFolderBackup:(...args)=>storageBackup.maybeCreateAutomaticFolderBackup(...args),
});

const storageBackup=createStorageBackup({
  files,
  writeTextHandle:(...args)=>storageFiles.writeTextHandle(...args),
});

const storageIndexedDb=createStorageIndexedDb({

});

const uiFolders=createOrdersFolderCapability({
  files,tab,ui,storage:storageFiles,preferences:storageIndexedDb,
  presentation:{rejectSecondary:()=>uiTabGuard.showSecondaryTabGuard(),toast:message=>uiStatus.toast(message),
    syncStatus:()=>uiFolderStatus.syncFolderAccessButton(),renderSettings:()=>uiSettings.renderSettings()},
});

const cloudTransport=createCloudTransport({
  supaFetch:(...args)=>cloudAuth.supaFetch(...args),
  localResetReadOnlyFetch:(...args)=>cloudAuth.localResetReadOnlyFetch(...args),
});


const syncMerge=createSyncMerge({
  normalizeState:(...args)=>stateNormalization.normalizeState(...args),
});

checks.bindSync({status:uiStatus,financeReadout:finance.readout,writeFolder:(...args)=>storageFiles.writeStateToFolder(...args)});
checks.assertReady();

finance.bindCore({
  cloud:cloudTransport,
  checks:{syncSharedChecksFromCloud:(...args)=>checks.commands.sync(...args),saveSharedChecksToCloud:(...args)=>checks.commands.saveToCloud(...args),hasLocalWork:()=>stateSnapshots.checksHaveLocalWork()},
  toast:(...args)=>uiStatus.toast(...args),
});
finance.bindUi({
  layout:uiLayout,modal:uiModal,date:uiDateEditor,
  checksView:{checksMarkup:(...args)=>checks.presentation.checksMarkup(...args),checksHeaderContextMarkup:(...args)=>checks.presentation.checksHeaderContextMarkup(...args),syncChecksBulkUi:(...args)=>checks.presentation.syncChecksBulkUi(...args)},
  dashboard:{summaryMarkup:(...args)=>domainsDashboardView.summaryMarkup(...args)},
  openBankMorningDocument:(...args)=>domainsCustomers.openBankMorningDocument(...args),toast:(...args)=>uiStatus.toast(...args),
});
finance.assertReady();

const uiAlertCenter=createUiAlertCenter({
  alertsRevision:()=>domainRevisions.stamp(['checks','notes','finance','bankDisplay']),
  runFinance:financeDerivations.run,
  model,
  financeSnapshot:(...args)=>finance.queries.readSnapshot(...args),
  modal:(...args)=>uiModal.modal(...args),
  closeModal:(...args)=>uiModal.closeModal(...args),
  navigateToChecks:(...args)=>uiNavigation.openKupaChecks(...args),
  navigateToCashflow:(...args)=>uiNavigation.openKupaBank(...args),
  navigateToBank:(...args)=>uiNavigation.openKupaBank(...args),
  navigateToNote:(...args)=>uiNavigation.openNotesNote(...args),
  markCheckDeposited:(...args)=>checks.commands.markDeposited(...args),
  dismissNoteReminder:(...args)=>domainsNotesController.removeStickyNoteReminder(...args),
  dismissBankWarning:async item=>item?.kind==='bank_missing'
    ?finance.commands.acknowledgeMissingBankTransaction(item.archiveId)
    :finance.commands.acknowledgePersistentBankAlert(item?.archiveId,item?.alertKind),
});

const syncDocument=createSyncDocument({
  model,session,tab,
  ownership:{
    getScope:()=>readCloudWriteScope(mainStorageV2.cloudScope,cloudAuth.getAccountScope()),
    preparing:storagePreparationActive,
    enabled:()=>cloudAuth.cloudEnabled(),
    cancelRecovery:()=>uiCloud.recoveryRuntime.cancel(),
  },
  storage:storageV2Cloud,
  state:{snapshots:stateSnapshots,merge:syncMerge},
  transport:cloudTransport,
  view:{status:uiStatus,render:()=>uiNavigation.render()},
  mirror:{files,writeStateToFolder:(...args)=>storageFiles.writeStateToFolder(...args)},
  secondary:{finance:finance.readout,checks:checks.runtime},
});


storageV2Coordinator.configure({
  storageBrowser,syncDocument,model,session,checksSession,files,
  saveRuntime:{main:storagePersistence.runtime,checks:checks.runtime,folder:storageFiles.runtime,backup:{cancelPending(){uiBackup.runtime.cancelPending();storageBackup.runtime.cancelPending()},async drain(){await uiBackup.runtime.drain();await storageBackup.runtime.drain()}}},
  stateSnapshots,stateNormalization,prepareV2Checkpoint,validateMainState:state=>assertOrderEntityInvariants(state,{includeChecks:Object.hasOwn(state||{},'checks'),required:true}),domainRevisions,sharedChecksV2Composition,sharedChecksV2,
  cloudTransport,cloudAuth,mainStorageV2,verifyStorageV2AccountMarker:()=>verifyStorageV2AccountMarker(),
});

domainsCustomers.bindUi({
  morningOperationScope,uiLayout,uiModal,uiStatus,storagePersistence,cloudAuth,uiNavigation,uiDateEditor,
  refreshForMorningRecovery:(...args)=>syncDocument.refreshForMorningRecovery(...args),
  bankTransactions:finance.customerBankPort(),
});
domainsCustomers.assertReady();
service.bindUi({uiLayout,uiModal,uiStatus,storagePersistence,uiDateEditor});
service.assertReady();

const uiCloud=composeCloudUi({
  uiBackup,
  model,files,tab,session,checksSession,ui,uiModal,cloudAuth,uiStatus,storageBrowser,uiTabGuard,stateSnapshots,uiNavigation,storageFiles,
  cloudTransport,financeReadout:finance.readout,checksCloud:{sync:(...args)=>checks.commands.sync(...args)},syncDocument,getUiSettings:()=>uiSettings,getCalendarController:()=>domainsCalendarController,
  financeRuntime:finance.runtime,storageV2Coordinator,storageV2Cloud,
});

const domainsCalendarController=calendarRuntime.createController({
  ui,tab,calendarUi,uiLayout,uiModal,uiStatus,uiCloud,uiDateEditor,
});

const {spreadsheetWorkspace,domainsNotesController}=createNotesDomain({cloudAuth,tab,ui,notesUi,model,uiModal,storagePersistence,uiStatus,uiLayout,uiAlertCenter,uiDateEditor});

const uiSettings=createUiSettings({
  model,
  ui,
  supplierUi,
  files,
  session,
  checksSession,
  mountViewLayout:(...args)=>uiLayout.mountViewLayout(...args),
  orderedSuppliers:(...args)=>suppliers.orderedSuppliers(...args),
  orderedInventoryCategoryNames:(...args)=>warehouse.orderedInventoryCategoryNames(...args),
  cloudEnabled:(...args)=>cloudAuth.cloudEnabled(...args),
  financeSnapshot:(...args)=>finance.queries.readSnapshot(...args),
});

warehouse.bindUi({uiLayout,uiModal,uiStatus,storagePersistence,uiDateEditor,uiSettings});
warehouse.assertReady();

storageRecovery.bind({
  main:{primary:()=>storageBrowser.recoverLocalV2State(),readOnly:()=>storageBrowser.recoverReadOnlyV2State()},
  shared:{primary:recoverSharedChecksV2Primary,readOnly:()=>sharedChecksV2.recoverReadOnly()},
});

const startupWritable=()=>tab.primaryTab&&!session.storageProtocolBlocked&&storageRecovery.isReady()&&!storagePreparationActive()&&!session.syncCapabilitiesError&&!session.syncCapabilitiesChecking;
const cloudStartup=createOrdersCloudStartup({
  main:{recoverCursor:()=>storageBrowser.recoverCloudCursor(),open:options=>uiCloud.openCloud(options),
    cloudState:()=>storageBrowser.refreshStorageV2CloudState(),hasLocalWork:()=>stateSnapshots.cloudHasLocalWork(),conflictBlocked:()=>session.cloudConflictBlocked},
  checks:{sync:options=>checks.commands.sync(options),pending:()=>sharedChecksV2.hasLocalWork||checksSession.checksSaveRequested,
    lastError:()=>checksSession.checksCloudLastError,recordError:error=>{checksSession.checksCloudLastError=error?.message||String(error)}},
  finance:{hydrate:options=>finance.readout.refreshKupaReadout(options)},
  status:uiStatus,
  access:{authenticated:()=>!!cloudAuth.loadSession(),online:()=>navigator.onLine,cloudEnabled:()=>cloudAuth.cloudEnabled(),
    canHydrate:()=>startupWritable()&&navigator.onLine&&!!cloudAuth.loadSession()},
});
const localServices=createOrdersLocalServices({
  files,storage:storageIndexedDb,
  folder:{refreshPermission:interactive=>storageFiles.refreshDirPermission(interactive),syncStatus:()=>uiFolderStatus.syncFolderAccessButton(),backupAvailable:()=>uiFolderStatus.folderBackupAvailable()},
  backup:{capture:()=>stateSelectors.prepareState(),save:state=>storageBackup.maybeCreateAutomaticFolderBackup(state)},
});
const backgroundStartup=createOrdersBackgroundStartup({
  polling:{start:()=>syncDocument.startPolling()},finance:{start:()=>finance.runtime.start()},
  alerts:{prepare:()=>finance.queries.ensureBankDisplayArchive(),show:()=>uiAlertCenter.showStartupAlerts()},
  localServices,access:{allowed:startupWritable},
});

const lifecycle=createLifecycle({
  storageProtocol:storageV2Coordinator.startupProtocol,
  storageRecovery,
  cloudStartup,
  localServices,
  backgroundStartup,
  hydrateStorageOwner:()=>storageOwner.hydrate({initialOwner:()=>cloudAuth.loadSession()?.user?.id}),
  ...storageV2Coordinator.localBirthLifecyclePorts(),
  ...storageV2Coordinator.ownerTransferLifecyclePorts(),
  ensureSyncCapabilities:(...args)=>cloudAuth.ensureSyncCapabilities(...args),
  tab,
  session,
  resumeIncompleteRestore:(...args)=>uiBackup.resumeIncompleteRestore(...args),
  setSave:(...args)=>uiStatus.setSave(...args),
  setCloud:(...args)=>uiStatus.setCloud(...args),
  syncFolderAccessButton:(...args)=>uiFolderStatus.syncFolderAccessButton(...args),
  folderSaveTitle:(...args)=>uiFolderStatus.folderSaveTitle(...args),
  showSecondaryTabGuard:(...args)=>uiTabGuard.showSecondaryTabGuard(...args),
  acquirePrimaryTabLock:(...args)=>storageTabLock.acquirePrimaryTabLock(...args),
  render:(...args)=>uiNavigation.render(...args),
  loadSession:(...args)=>cloudAuth.loadSession(...args),
});

const uiEvents={bindActionEvents:(root,actions)=>bindActionEvents(root,actions)};

const calendarPorts=calendarRuntime.actionPorts();
const uiActions=composeActionRegistry([
  ...createExternalActionPacks({notesSheetActions:domainsNotesController.sheetActions}),
  ...finance.actionPacks(),
  {name:'alerts',actions:createAlertsActions({uiAlertCenter})},
  checks.actionPack(),
  {name:'shell',actions:createShellActions({uiModal})},
  {name:'dashboard',actions:createDashboardActions({domainsDashboardView,domainsFinanceView:finance.presentation,ui})},
  {name:'suppliers',actions:suppliers.actions},
  {name:'customers',actions:domainsCustomers.actions},
  {name:'morning',actions:domainsCustomers.morningActions},
  {name:'service',actions:service.actions},
  {name:'warehouse',actions:warehouse.actions},
  {name:'backup',actions:createBackupActions({ui,uiBackup,uiFolders,uiModal})},
  {name:'cloud',actions:createCloudActions({uiCloud})},
  {name:'notes',actions:createNotesActions({domainsNotesController})},
  {name:'calendar',actions:createCalendarActions({calendarPorts})},
]);

const uiKeyboardNavigation=createUiKeyboardNavigation({
  switchView:(...args)=>uiNavigation.switchView(...args),
});

const uiGlobalSearch=createUiGlobalSearch({
  documentBridge:domainsDocumentBridge,
  searchRevision:domains=>domainRevisions.stamp(domains)+':'+new Date().toLocaleDateString('en-CA'),
  model,
  notesUi,
  ui,
  supplierUi,
  customerUi,
  serviceUi,
  warehouseUi,
  prepareView:(...args)=>uiNavigation.prepareView(...args),
  render:(...args)=>uiNavigation.render(...args),
  openInventoryItemModal:(...args)=>{if(!tab.primaryTab){uiStatus.toast('לקריאה בלבד — עריכת פריט זמינה בטאב הראשי.');return}return warehouse.openInventoryItemModal(...args)},
  confirmDialog:(...args)=>uiModal.confirmDialog(...args),
});

// The visible model starts empty and is hydrated only from the verified V2
// Main and Shared journals during boot. Retired V1 browser keys are inert.
model.state=stateNormalization.normalizeState(structuredClone(INITIAL_STATE));
suppliers.initializeSelection();
checksSession.checksCloudBase=[];
checksSession.checksBankEvents=[];
const connectivity=bindOrdersRuntimeEvents({uiModal,uiNavigation,domainsSuppliersNavigation:suppliers.navigation,cloudAuth,uiStatus,checksRuntime:checks.runtime,tab,session,storageRecovery,recoverPendingMorningOperation:(...args)=>domainsCustomers.recoverPendingMorningOperation(...args),financeRuntime:finance.runtime,stateSnapshots,syncDocument,uiFolders,uiAlertCenter,uiTabGuard,storageV2:mainStorageV2,sharedChecksV2});
const startupUiActions=wrapMutationActions(uiActions,(domain)=>uiStatus.guardStartupMutation(domain));
uiEvents.bindActionEvents(document.getElementById('main'),startupUiActions);
bindDismissibleDetails(document);
bindNumberInputWheelGuard(document);
uiEvents.bindActionEvents(document.getElementById('modal'),startupUiActions);
uiGlobalSearch.bind();
uiKeyboardNavigation.bind();
export const appReady=lifecycle.boot().then(()=>{if(session.storageProtocolBlocked||!storageRecovery.isReady()||session.syncCapabilitiesError)return false;domainsCalendarController.start();connectivity.resumeStartup();return true});
export async function sharedChecksStorageV2Diagnostics(){await sharedChecksV2.flush();return {...sharedChecksV2.diagnostics}}
void appReady.then(ready=>{if(ready)uiAlertCenter.startDateWatcher()});
