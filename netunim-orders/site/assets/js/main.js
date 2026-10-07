import {createOrdersStorageV2Coordinator} from './composition/storage-v2.js';
import {installLocalSiteResetPeerListener} from './shared/local-site-reset.js';
import {assertOrderEntityInvariants} from './state/validation.js';
import {createInventoryRenderStore} from './domains/inventory/model.js';
import {createFinanceDerivationStore} from './shared/finance-derivations.js';
import {esc} from './core/values.js';
import {createCreditCardOrderView} from './shared/credit-card-order-view.js';
import {createFinanceConnectionImporter} from './shared/finance-connection-import.js';
import {createStateNormalization} from './state/normalization.js';
import {createStorageBrowser} from './storage/browser.js';
import {createDomainsSuppliersSelectors} from './domains/suppliers/selectors.js';
import {createDomainsSuppliersCommands} from './domains/suppliers/commands.js';
import {createDomainsSuppliersNavigation} from './domains/suppliers/navigation.js';
import {createUiStatus} from './ui/status.js';
import {createUiFolderStatus} from './ui/folder-status.js';
import {createUiTabGuard} from './ui/tab-guard.js';
import {createStorageTabLock} from './storage/tab-lock.js';
import {createStoragePersistence} from './storage/persistence.js';
import {createStateSnapshots} from './state/snapshots.js';
import {createUiLayout} from './ui/layout.js';
import {createUiNavigation} from './ui/navigation.js';
import {createDomainsChecksView} from './domains/checks/view.js';
import {createDomainsBankSelectors} from './domains/bank/selectors.js';
import {createDomainsBankCache} from './domains/bank/cache.js';
import {createUiAlertCenter} from './ui/alert-center.js';
import {createDomainsFinanceBridge} from './domains/finance/bridge.js';
import {composeDocumentSearch} from './shared/document-search-composition.js';
import {createDomainsFinanceController} from './domains/finance/controller.js';
import {createDomainsFinanceView} from './domains/finance/view.js';
import {createUiDateEditor} from './ui/date-editor.js';
import {createDomainsChecksEditor} from './domains/checks/editor.js';
import {composeChecksPersistence} from './composition/checks-persistence.js';
import {createDomainsDashboardView} from './domains/dashboard/view.js';
import {createDomainsSuppliersOrder} from './domains/suppliers/order.js';
import {createDomainsSuppliersBulk} from './domains/suppliers/bulk.js';
import {createDomainsSuppliersView} from './domains/suppliers/view.js';
import {createUiModal} from './ui/modal.js';
import {createDomainsSuppliersEditor} from './domains/suppliers/editor.js';
import {createDomainsCustomers} from './domains/customers/composition.js';
import {createDomainsServiceBulk} from './domains/service/bulk.js';
import {createDomainsServiceView} from './domains/service/view.js';
import {createDomainsServiceEditor} from './domains/service/editor.js';
import {createServiceActionPorts} from './domains/service/action-ports.js';
import {createDomainsInventorySelectors} from './domains/inventory/selectors.js';
import {createDomainsInventoryOrder} from './domains/inventory/order.js';
import {createDomainsInventoryView} from './domains/inventory/view.js';
import {createDomainsWarehouseBulk} from './domains/warehouse/bulk.js';
import {createDomainsWarehouseView} from './domains/warehouse/view.js';
import {createDomainsInventoryEditor} from './domains/inventory/editor.js';
import {createDomainsWarehouseEditor} from './domains/warehouse/editor.js';
import {createWarehouseActionPorts} from './domains/warehouse/action-ports.js';
import {composeBackup} from './composition/backup.js';
import {createStateSelectors} from './state/selectors.js';
import {createStorageFiles} from './storage/files.js';
import {createStorageBackup} from './storage/backup.js';
import {createStorageIndexedDb} from './storage/indexed-db.js';
import {createUiFolders} from './ui/folders.js';
import {createCloudAuth} from './cloud/auth.js';
import {createCloudTransport} from './cloud/transport.js';
import {createSyncMerge} from './sync/merge.js';
import {composeChecksSync} from './composition/checks-sync.js';
import {createSyncDocument} from './sync/document.js';
import {composeCloudUi} from './composition/cloud.js';
import {createNotesDomain} from './domains/notes/index.js';
import {createOrdersCalendarRuntime} from './composition/calendar.js';
import {createUiSettings} from './ui/settings.js';
import {createLifecycle} from './lifecycle.js';
import {verifyStorageV2LocalEngine} from './shared/storage-v2-local-birth.js';
import {bindActionEvents,bindDismissibleDetails,bindNumberInputWheelGuard} from './shared/events.js';
import {composeActionRegistry} from './shared/action-registry.js';
import {wrapMutationActions,createExternalActionPacks,createAlertsActions,createFinanceBankActions,createFinanceCreditActions,createChecksActions,createShellActions,createDashboardActions,createSuppliersActions,createCustomersActions,createMorningActions,createServiceActions,createWarehouseActions,createBackupActions,createCloudActions,createNotesActions,createCalendarActions} from './ui/actions.js';
import {createUiGlobalSearch} from './ui/global-search.js';
import {createUiKeyboardNavigation} from './ui/keyboard-navigation.js';
import {createContexts} from './state/contexts.js';
import {createOrderDomainRevisions,orderViewRevision} from './state/revisions.js';
import {createRestoreGroupStore} from './shared/restore-groups.js';
import {createOrdersBankChequeImageRuntime} from './domains/finance/bank-cheque-image-runtime.js';
import {INITIAL_STATE} from "./state/constants.js";
import {bindOrdersRuntimeEvents} from './runtime-events.js';















const {model, ui, supplierUi, customerUi, serviceUi, warehouseUi, notesUi, calendarUi, calendarSession, files, tab, session, checksSession}=createContexts();
installLocalSiteResetPeerListener();
// Event handlers are installed before the async owner/protocol preflight finishes.
session.storageProtocolBlocked=true;
const domainRevisions=createOrderDomainRevisions(session);
const inventoryRenderStore=createInventoryRenderStore({state:()=>model.state,revision:()=>domainRevisions.stamp(['inventory'])});
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
  model,checksSession,domainRevisions,main:mainStorageV2,stateNormalization,getSyncChecks:()=>syncChecks,getCloudTransport:()=>cloudTransport,
});
const sharedChecksV2=sharedChecksV2Composition.runtime;
const recoverSharedChecksV2Primary=()=>storageV2Coordinator.recoverShared();
const verifyStorageV2AccountMarker=sharedChecksV2Composition.verifyAccountMarker;

const cloudAuth=createCloudAuth({
  session,
  assertSessionOwner:(...args)=>storageOwner.assertSessionOwner(...args),
});

const domainsFinanceBridge=createDomainsFinanceBridge();
const domainsDocumentBridge=composeDocumentSearch({supaFetch:(...args)=>cloudAuth.supaFetch(...args)});
const bankChequeImages=createOrdersBankChequeImageRuntime({cloudAuth,bridge:domainsFinanceBridge});

const calendarRuntime=createOrdersCalendarRuntime({
  calendarSession,supaFetch:(...args)=>cloudAuth.supaFetch(...args),
});

const domainsSuppliersSelectors=createDomainsSuppliersSelectors({
  model,
});

const domainsSuppliersCommands=createDomainsSuppliersCommands({
  supplierTx:(...args)=>domainsSuppliersSelectors.supplierTx(...args),
});

const domainsSuppliersNavigation=createDomainsSuppliersNavigation({
  supplierUi,
  ui,
  supplierYearContext:(...args)=>domainsSuppliersSelectors.supplierYearContext(...args),
  renderSupplier:(...args)=>domainsSuppliersView.renderSupplier(...args),
  render:(...args)=>uiNavigation.render(...args),
});

const uiStatus=createUiStatus({
  session,
  checksSession,
  tab,
});

const uiFolderStatus=createUiFolderStatus({
  files,
});

const uiTabGuard=createUiTabGuard({
  tab,
  toast:(...args)=>uiStatus.toast(...args),
  acquirePrimaryTabLock:(...args)=>storageTabLock.acquirePrimaryTabLock(...args),
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
  renderKupa:(...args)=>domainsFinanceView.renderKupa(...args),
  renderChecks:(...args)=>domainsChecksView.renderChecks(...args),
  renderSummary:(...args)=>domainsDashboardView.renderSummary(...args),
  renderSupplier:(...args)=>domainsSuppliersView.renderSupplier(...args),
  renderCustomers:(...args)=>domainsCustomers.renderCustomers(...args),
  renderService:(...args)=>domainsServiceView.renderService(...args),
  renderWarehouse:(...args)=>domainsWarehouseView.renderWarehouse(...args),
  renderNotes:(...args)=>domainsNotesController.renderNotes(...args),
  renderCalendar:(...args)=>domainsCalendarController.renderCalendar(...args),
  renderSettings:(...args)=>uiSettings.renderSettings(...args),
  refreshAlertCenter:(...args)=>uiAlertCenter.refreshIndicator(...args),
  dataRevision:view=>orderViewRevision(domainRevisions,view)+':'+new Date().toLocaleDateString('en-CA'),
});

const domainsChecksView=createDomainsChecksView({
  getBankImageContext:()=>({bank:domainsFinanceController.snapshot().bank,imageAction:'view-orders-bank-cheque-image'}),
  model,
  ui,
  checksSession,
  loadSession:(...args)=>cloudAuth.loadSession(...args),
  mountViewLayout:(...args)=>uiLayout.mountViewLayout(...args),
});

const domainsBankSelectors=createDomainsBankSelectors({
  model,
});

const domainsBankCache=createDomainsBankCache({
  checksSession,
  ui,
  computeKupaNetReadout:(...args)=>domainsBankSelectors.computeKupaNetReadout(...args),
  renderKupa:(...args)=>domainsFinanceView.renderKupa(...args),
  renderChecks:(...args)=>domainsChecksView.renderChecks(...args),
  renderSummary:(...args)=>domainsDashboardView.renderSummary(...args),
  loadSession:(...args)=>cloudAuth.loadSession(...args),
  readKupaReadOnlyCloud:(...args)=>cloudTransport.readKupaReadOnlyCloud(...args),
  readKupaReadOnlyMeta:(...args)=>cloudTransport.readKupaReadOnlyMeta(...args),
  refreshAlertCenter:(...args)=>uiAlertCenter.refreshIndicator(...args),
  refreshBankAlertArchive:(...args)=>domainsFinanceController.ensureBankDisplayArchive(...args),
  touchFinanceRevision:()=>domainRevisions.touch('finance'),
});

const uiDateEditor=createUiDateEditor({
  markCheckSeriesManual:(...args)=>domainsChecksEditor.markCheckSeriesManual(...args),
  syncCheckSeriesFromFirst:(...args)=>domainsChecksEditor.syncCheckSeriesFromFirst(...args),
  toast:(...args)=>uiStatus.toast(...args),
});

const domainsChecksEditor=createDomainsChecksEditor({
  model,
  ui,
  toast:(...args)=>uiStatus.toast(...args),
  checkDateEditorMarkup:(...args)=>uiDateEditor.checkDateEditorMarkup(...args),
  modal:(...args)=>uiModal.modal(...args),
  setCheckDateValue:(...args)=>uiDateEditor.setCheckDateValue(...args),
  normalizeCheckModalDates:(...args)=>uiDateEditor.normalizeCheckModalDates(...args),
  scheduleCheckSave:(...args)=>syncChecksPersistence.scheduleCheckSave(...args),
  closeModal:(...args)=>uiModal.closeModal(...args),
  confirmDialog:(...args)=>uiModal.confirmDialog(...args),
});

const syncChecksPersistence=composeChecksPersistence({model,session,checksSession,storageBrowser,uiStatus,uiFolderStatus,storagePersistence,storageFiles:()=>storageFiles,cloudAuth,syncChecks:()=>syncChecks,uiAlertCenter:()=>uiAlertCenter,domainRevisions,sharedChecksV2});

const domainsDashboardView=createDomainsDashboardView({
  model,
  ui,
  checksSession,
  supplierBalance:(...args)=>domainsSuppliersSelectors.supplierBalance(...args),
  supplierArchiveYears:(...args)=>domainsSuppliersSelectors.supplierArchiveYears(...args),
  supplierPeriodTx:(...args)=>domainsSuppliersSelectors.supplierPeriodTx(...args),
  supplierFinancialStats:(...args)=>domainsSuppliersSelectors.supplierFinancialStats(...args),
  totalStats:(...args)=>domainsSuppliersSelectors.totalStats(...args),
  mountViewLayout:(...args)=>uiLayout.mountViewLayout(...args),
  customerStats:(...args)=>domainsCustomers.selectors.customerStats(...args),
});

const domainsSuppliersOrder=createDomainsSuppliersOrder({
  model,
  supplierUi,
  ui,
  modal:(...args)=>uiModal.modal(...args),
  scheduleSave:(message,options={})=>storagePersistence.scheduleSave(message,{...options,domains:['suppliers','transactions']}),
  render:(...args)=>uiNavigation.render(...args),
  renderSupplier:(...args)=>domainsSuppliersView.renderSupplier(...args),
  closeModal:(...args)=>uiModal.closeModal(...args),
});

const domainsSuppliersBulk=createDomainsSuppliersBulk({
  supplierUi,
  model,
  renderSupplier:(...args)=>domainsSuppliersView.renderSupplier(...args),
  toast:(...args)=>uiStatus.toast(...args),
  supplierTx:(...args)=>domainsSuppliersSelectors.supplierTx(...args),
  supplierYearContext:(...args)=>domainsSuppliersSelectors.supplierYearContext(...args),
  modal:(...args)=>uiModal.modal(...args),
  resequenceSupplier:(...args)=>domainsSuppliersCommands.resequenceSupplier(...args),
  moveTransactionAfter:(...args)=>domainsSuppliersCommands.moveTransactionAfter(...args),
  supplierBalance:(...args)=>domainsSuppliersSelectors.supplierBalance(...args),
  scheduleSave:(message,options={})=>storagePersistence.scheduleSave(message,{...options,domains:['suppliers','transactions']}),
  closeModal:(...args)=>uiModal.closeModal(...args),
  confirmDialog:(...args)=>uiModal.confirmDialog(...args),
});

const domainsSuppliersView=createDomainsSuppliersView({
  model,
  supplierUi,
  mountViewLayout:(...args)=>uiLayout.mountViewLayout(...args),
  orderedSuppliers:(...args)=>domainsSuppliersSelectors.orderedSuppliers(...args),
  captureSupplierViewport:(...args)=>uiLayout.captureSupplierViewport(...args),
  restoreSupplierViewport:(...args)=>uiLayout.restoreSupplierViewport(...args),
  syncSupplierBulkUi:(...args)=>domainsSuppliersBulk.syncSupplierBulkUi(...args),
  supplierMoveTargetRow:(...args)=>domainsSuppliersBulk.supplierMoveTargetRow(...args),
  storeSupplierViewport:(...args)=>uiLayout.storeSupplierViewport(...args),
  scrollSupplierTransactionsEnd:(...args)=>uiLayout.scrollSupplierTransactionsEnd(...args),
  scheduleSave:(message,options={})=>storagePersistence.scheduleSave(message,{...options,domains:['suppliers','transactions']}),
});

const uiModal=createUiModal({

});

const domainsSuppliersEditor=createDomainsSuppliersEditor({
  model,
  supplierUi,
  ui,
  modal:(...args)=>uiModal.modal(...args),
  triSelect:(...args)=>uiModal.triSelect(...args),
  resequenceSupplier:(...args)=>domainsSuppliersCommands.resequenceSupplier(...args),
  insertTransactionAfter:(...args)=>domainsSuppliersCommands.insertTransactionAfter(...args),
  toast:(...args)=>uiStatus.toast(...args),
  scheduleSave:(message,options={})=>storagePersistence.scheduleSave(message,{...options,domains:['suppliers','transactions']}),
  render:(...args)=>uiNavigation.render(...args),
  renderSupplier:(...args)=>domainsSuppliersView.renderSupplier(...args),
  closeModal:(...args)=>uiModal.closeModal(...args),
  parseTri:(...args)=>uiModal.parseTri(...args),
  confirmDialog:(...args)=>uiModal.confirmDialog(...args),
});

const domainsCustomers=createDomainsCustomers({
  customerRevision:()=>domainRevisions.stamp(['customerDebts','customerOrders']),
  model,
  refreshForMorningRecovery:(...args)=>syncDocument.refreshForMorningRecovery(...args),
  customerUi,
  uiLayout,
  uiModal,
  uiStatus,
  storagePersistence,
  cloudAuth,
  uiNavigation,
  uiDateEditor,
  getBusinessBankTransactions:()=>domainsFinanceController.snapshot().bank?.feed?.transactions||[],
  ensureBusinessBankTransactions:async()=>{await domainsFinanceController.ensureBankDisplayArchive();return domainsFinanceController.snapshot().bank?.feed?.transactions||[]},
  onBankDocumentVerified:(...args)=>domainsFinanceController.markBankMorningVerified(...args),
});


const domainsServiceBulk=createDomainsServiceBulk({
  serviceUi,
  model,
  renderService:(...args)=>domainsServiceView.renderService(...args),
  toast:(...args)=>uiStatus.toast(...args),
  scheduleSave:(message,options={})=>storagePersistence.scheduleSave(message,{...options,domains:['service']}),
  confirmDialog:(...args)=>uiModal.confirmDialog(...args),
});

const domainsServiceView=createDomainsServiceView({
  serviceRevision:()=>domainRevisions.stamp(['service']),
  model,
  serviceUi,
  mountViewLayout:(...args)=>uiLayout.mountViewLayout(...args),
  serviceBulkControls:(...args)=>domainsServiceBulk.serviceBulkControls(...args),
  syncServiceBulkUi:(...args)=>domainsServiceBulk.syncServiceBulkUi(...args),
  toast:(...args)=>uiStatus.toast(...args),
  scheduleSave:(message,options={})=>storagePersistence.scheduleSave(message,{...options,domains:['service']}),
});

const domainsServiceEditor=createDomainsServiceEditor({
  model,
  modal:(...args)=>uiModal.modal(...args),
  toast:(...args)=>uiStatus.toast(...args),
  scheduleSave:(message,options={})=>storagePersistence.scheduleSave(message,{...options,domains:['service']}),
  closeModal:(...args)=>uiModal.closeModal(...args),
  renderService:(...args)=>domainsServiceView.renderService(...args),
  confirmDialog:(...args)=>uiModal.confirmDialog(...args),
  dateEditorMarkup:(...args)=>uiDateEditor.dateEditorMarkup(...args),
});

const domainsInventorySelectors=createDomainsInventorySelectors({
  model,
  warehouseUi,
  renderWarehouse:(...args)=>domainsWarehouseView.renderWarehouse(...args),
});

const domainsInventoryOrder=createDomainsInventoryOrder({
  model,
  warehouseUi,
  ui,
  modal:(...args)=>uiModal.modal(...args),
  orderedInventoryCategoryNames:(...args)=>domainsInventorySelectors.orderedInventoryCategoryNames(...args),
  scheduleSave:(message,options={})=>storagePersistence.scheduleSave(message,{...options,domains:['inventory']}),
  closeModal:(...args)=>uiModal.closeModal(...args),
  inventoryCategoryNames:(...args)=>domainsInventorySelectors.inventoryCategoryNames(...args),
  renderWarehouse:(...args)=>domainsWarehouseView.renderWarehouse(...args),
  renderSettings:(...args)=>uiSettings.renderSettings(...args),
});

const domainsInventoryView=createDomainsInventoryView({
  warehouseUi,
  model,
  orderedInventoryCategoryNames:(...args)=>domainsInventorySelectors.orderedInventoryCategoryNames(...args),
  inventoryStats:(...args)=>domainsInventorySelectors.inventoryStats(...args),
  inventoryCategoryGroups:(...args)=>domainsInventorySelectors.inventoryCategoryGroups(...args),
});

const domainsWarehouseBulk=createDomainsWarehouseBulk({
  warehouseUi,
  model,
  renderWarehouse:(...args)=>domainsWarehouseView.renderWarehouse(...args),
  toast:(...args)=>uiStatus.toast(...args),
  scheduleSave:(message,options={})=>storagePersistence.scheduleSave(message,{...options,domains:['inventory','warehouseOrders']}),
  confirmDialog:(...args)=>uiModal.confirmDialog(...args),
});

const domainsWarehouseView=createDomainsWarehouseView({
  runInventory:inventoryRenderStore.run,
  warehouseUi,
  model,
  mountViewLayout:(...args)=>uiLayout.mountViewLayout(...args),
  inventoryTotals:(...args)=>domainsInventorySelectors.inventoryTotals(...args),
  inventoryStockViewData:(...args)=>domainsInventoryView.inventoryStockViewData(...args),
  renderStockGrid:(...args)=>domainsInventoryView.renderStockGrid(...args),
  renderWarehouseLocations:(...args)=>domainsInventoryView.renderWarehouseLocations(...args),
  warehouseBulkControls:(...args)=>domainsWarehouseBulk.warehouseBulkControls(...args),
  syncWarehouseBulkUi:(...args)=>domainsWarehouseBulk.syncWarehouseBulkUi(...args),
  inventoryEventView:(...args)=>domainsInventorySelectors.inventoryEventView(...args),
});

const domainsInventoryEditor=createDomainsInventoryEditor({
  dateEditorMarkup:(...args)=>uiDateEditor.dateEditorMarkup(...args),
  model,
  modal:(...args)=>uiModal.modal(...args),
  inventoryStats:(...args)=>domainsInventorySelectors.inventoryStats(...args),
  inventoryLocationOptions:(...args)=>domainsInventoryView.inventoryLocationOptions(...args),
  inventoryCategoryDatalist:(...args)=>domainsInventoryView.inventoryCategoryDatalist(...args),
  toast:(...args)=>uiStatus.toast(...args),
  scheduleSave:(message,options={})=>storagePersistence.scheduleSave(message,{...options,domains:['inventory']}),
  closeModal:(...args)=>uiModal.closeModal(...args),
  ensureInventoryCategoryOrder:(...args)=>domainsInventoryOrder.ensureInventoryCategoryOrder(...args),
  renderWarehouse:(...args)=>domainsWarehouseView.renderWarehouse(...args),
  confirmDialog:(...args)=>uiModal.confirmDialog(...args),
});

const domainsWarehouseEditor=createDomainsWarehouseEditor({
  model,
  modal:(...args)=>uiModal.modal(...args),
  toast:(...args)=>uiStatus.toast(...args),
  scheduleSave:(message,options={})=>storagePersistence.scheduleSave(message,{...options,domains:['warehouseOrders']}),
  closeModal:(...args)=>uiModal.closeModal(...args),
  renderWarehouse:(...args)=>domainsWarehouseView.renderWarehouse(...args),
  confirmDialog:(...args)=>uiModal.confirmDialog(...args),
});

const uiBackup=composeBackup({tab,ui,model,session,checksSession,storageV2Cloud,storageV2Runtime:mainStorageV2,storageOwner,sharedChecksV2Composition,sharedChecksV2,stateNormalization,stateSelectors:()=>stateSelectors,uiTabGuard,uiModal,storageBrowser,uiStatus,uiFolderStatus,stateSnapshots,uiNavigation,uiSettings:()=>uiSettings,storageFiles:()=>storageFiles,cloudAuth,cloudTransport:()=>cloudTransport,syncDocument:()=>syncDocument,restoreGroupStore,domainsSuppliersSelectors,domainsSuppliersView,domainRevisions});

const stateSelectors=createStateSelectors({
  model,
});

const storageFiles=createStorageFiles({
  files,
  tab,
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

const uiFolders=createUiFolders({
  files,
  tab,
  ui,
  showSecondaryTabGuard:(...args)=>uiTabGuard.showSecondaryTabGuard(...args),
  toast:(...args)=>uiStatus.toast(...args),
  syncFolderAccessButton:(...args)=>uiFolderStatus.syncFolderAccessButton(...args),
  requestPersistentBrowserStorage:(...args)=>storageIndexedDb.requestPersistentBrowserStorage(...args),
  refreshDirPermission:(...args)=>storageFiles.refreshDirPermission(...args),
  isFolderPermissionError:(...args)=>storageFiles.isFolderPermissionError(...args),
  preserveExistingFolderState:(...args)=>storageFiles.preserveExistingFolderState(...args),
  writeStateToFolder:(...args)=>storageFiles.writeStateToFolder(...args),
  renderSettings:(...args)=>uiSettings.renderSettings(...args),
  saveDirHandle:(...args)=>storageIndexedDb.saveDirHandle(...args),
});

const cloudTransport=createCloudTransport({
  supaFetch:(...args)=>cloudAuth.supaFetch(...args),
  localResetReadOnlyFetch:(...args)=>cloudAuth.localResetReadOnlyFetch(...args),
});


const syncMerge=createSyncMerge({
  normalizeState:(...args)=>stateNormalization.normalizeState(...args),
});

const syncChecks=composeChecksSync({model,files,checksSession,tab,uiStatus,domainsBankCache,storageFiles,cloudAuth,sharedChecksV2});

const domainsFinanceController=createDomainsFinanceController({
  readRevision:()=>domainRevisions.stamp(['finance','checks','bankDisplay']),
  tab,
  checksSession,
  bridge:domainsFinanceBridge,
  loadSession:(...args)=>cloudAuth.loadSession(...args),
  refreshKupaReadout:(...args)=>domainsBankCache.refreshKupaReadout(...args),
  readKupaReadOnlyCloud:(...args)=>cloudTransport.readKupaReadOnlyCloud(...args),
  rpcSaveKupaDocument:(...args)=>cloudTransport.rpcSaveKupaDocument(...args),
  acceptKupaCloudRow:(...args)=>domainsBankCache.acceptKupaCloudRow(...args),
  syncSharedChecksFromCloud:(...args)=>syncChecks.syncSharedChecksFromCloud(...args),
  saveSharedChecksToCloud:(...args)=>syncChecks.saveSharedChecksToCloud(...args),
  checksHaveLocalWork:(...args)=>stateSnapshots.checksHaveLocalWork(...args),
  getSharedChecks:()=>model.state.checks,
  toast:(...args)=>uiStatus.toast(...args),
  readFinanceSyncDocument:(...args)=>cloudTransport.readFinanceSyncDocument(...args),
  rpcSaveFinanceSync:(...args)=>cloudTransport.rpcSaveFinanceSync(...args),
  claimFinanceSyncLease:(...args)=>cloudTransport.claimFinanceSyncLease(...args),
  releaseFinanceSyncLease:(...args)=>cloudTransport.releaseFinanceSyncLease(...args),
  saveBankSyncSnapshot:(...args)=>cloudTransport.saveBankSyncSnapshot(...args),
  mergeBankTransactions:(...args)=>cloudTransport.mergeBankTransactions(...args),
  syncBankTransactionsSnapshot:(...args)=>cloudTransport.syncBankTransactionsSnapshot(...args),
  readBankTransactions:(...args)=>cloudTransport.readBankTransactions(...args),
  readBankTransactionSnapshot:(...args)=>cloudTransport.readBankTransactionSnapshot(...args),
  setBankTransactionHandled:(...args)=>cloudTransport.setBankTransactionHandled(...args),
  acknowledgeBankTransactionMissing:(...args)=>cloudTransport.acknowledgeBankTransactionMissing(...args),
  acknowledgeBankTransactionAlert:(...args)=>cloudTransport.acknowledgeBankTransactionAlert(...args),
  syncBankChequeImages:bankChequeImages.sync,
  touchBankDisplayRevision:()=>domainRevisions.touch('bankDisplay'),
});

const domainsFinanceView=createDomainsFinanceView({
  runFinance:financeDerivations.run,
  ui,
  controller:domainsFinanceController,
  checksView:domainsChecksView,
  dashboardView:domainsDashboardView,
  mountViewLayout:(...args)=>uiLayout.mountViewLayout(...args),
  modal:(...args)=>uiModal.modal(...args),
  closeModal:(...args)=>uiModal.closeModal(...args),
  downloadBankChequeImage:bankChequeImages.download,
  confirmDialog:(...args)=>uiModal.confirmDialog(...args),
  dateEditorMarkup:(...args)=>uiDateEditor.dateEditorMarkup(...args),
  openBankMorningDocument:(...args)=>domainsCustomers.openBankMorningDocument(...args),
});

const uiAlertCenter=createUiAlertCenter({
  alertsRevision:()=>domainRevisions.stamp(['checks','notes','finance','bankDisplay']),
  runFinance:financeDerivations.run,
  model,
  financeSnapshot:(...args)=>domainsFinanceController.readSnapshot(...args),
  modal:(...args)=>uiModal.modal(...args),
  closeModal:(...args)=>uiModal.closeModal(...args),
  navigateToChecks:(...args)=>uiNavigation.openKupaChecks(...args),
  navigateToCashflow:(...args)=>uiNavigation.openKupaBank(...args),
  navigateToBank:(...args)=>uiNavigation.openKupaBank(...args),
  navigateToNote:(...args)=>uiNavigation.openNotesNote(...args),
  markCheckDeposited:(...args)=>domainsChecksEditor.markCheckDeposited(...args),
  dismissNoteReminder:(...args)=>domainsNotesController.removeStickyNoteReminder(...args),
  dismissBankWarning:async item=>item?.kind==='bank_missing'
    ?domainsFinanceController.acknowledgeMissingBankTransaction(item.archiveId)
    :domainsFinanceController.acknowledgePersistentBankAlert(item?.archiveId,item?.alertKind),
});

const syncDocument=createSyncDocument({
  model,
  files,
  session,
  tab,
  toast:(...args)=>uiStatus.toast(...args),
  setCloud:(...args)=>uiStatus.setCloud(...args),
  prepareCloudState:(...args)=>stateSnapshots.prepareCloudState(...args),
  writeStateToFolder:(...args)=>storageFiles.writeStateToFolder(...args),
  readCloud:(...args)=>cloudTransport.readCloud(...args),
  rpcSaveV2:(...args)=>cloudTransport.rpcSaveV2(...args),
  merge3:(...args)=>syncMerge.merge3(...args),
  applyOrderCloudState:(...args)=>stateSnapshots.applyOrderCloudState(...args),
  composeOrderCloudState:(...args)=>stateSnapshots.composeOrderCloudState(...args),
  cloudEnabled:(...args)=>cloudAuth.cloudEnabled(...args),
  sameOrderCloudData:(...args)=>stateSnapshots.sameOrderCloudData(...args),
  cloudHasLocalWork:(...args)=>stateSnapshots.cloudHasLocalWork(...args),
  render:(...args)=>uiNavigation.render(...args),
  readCloudMeta:(...args)=>cloudTransport.readCloudMeta(...args),
  refreshKupaReadout:(...args)=>domainsBankCache.refreshKupaReadout(...args),
  pollSharedChecks:(...args)=>syncChecks.pollSharedChecks(...args),
  refreshCloudTimestamp:(...args)=>uiStatus.refreshCloudTimestamp(...args),
  ...storageV2Cloud,
  storageV2PreparationActive:storagePreparationActive,
});


storageV2Coordinator.configure({
  storageBrowser,syncDocument,syncChecks,model,session,checksSession,files,
  stateSnapshots,stateNormalization,prepareV2Checkpoint,validateMainState:state=>assertOrderEntityInvariants(state,{includeChecks:Object.hasOwn(state||{},'checks'),required:true}),domainRevisions,sharedChecksV2Composition,sharedChecksV2,
  cloudTransport,cloudAuth,mainStorageV2,verifyStorageV2AccountMarker:()=>verifyStorageV2AccountMarker(),
});

const uiCloud=composeCloudUi({
  model,files,tab,session,checksSession,ui,uiModal,cloudAuth,uiStatus,storageBrowser,uiTabGuard,stateSnapshots,uiNavigation,storageFiles,
  cloudTransport,domainsBankCache,syncChecks,syncDocument,getUiSettings:()=>uiSettings,getCalendarController:()=>domainsCalendarController,
  domainsFinanceController,storageV2Coordinator,storageV2Cloud,
});

const importFinanceConnections=createFinanceConnectionImporter({
  bridge:domainsFinanceBridge,
  getCreditProfiles:()=>domainsFinanceController.snapshot().creditSync?.profiles||[],
  confirmDialog:(...args)=>uiModal.confirmDialog(...args),
  toast:(...args)=>uiStatus.toast(...args),
  afterImport:async()=>{await Promise.all([domainsFinanceController.refreshBankBridgeStatus({quiet:true}),domainsFinanceController.refreshCreditBridgeStatus({quiet:true})]);domainsFinanceView.renderKupa()},
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
  orderedSuppliers:(...args)=>domainsSuppliersSelectors.orderedSuppliers(...args),
  orderedInventoryCategoryNames:(...args)=>domainsInventorySelectors.orderedInventoryCategoryNames(...args),
  cloudEnabled:(...args)=>cloudAuth.cloudEnabled(...args),
  financeSnapshot:(...args)=>domainsFinanceController.readSnapshot(...args),
});

const lifecycle=createLifecycle({
  hydrateStorageOwner:()=>storageOwner.hydrate({initialOwner:()=>cloudAuth.loadSession()?.user?.id}),
  verifyLocalStorageEngine:()=>verifyStorageV2LocalEngine({app:'orders',owner:()=>storageOwner.current()}),
  ...storageV2Coordinator.localBirthLifecyclePorts(),
  ...storageV2Coordinator.ownerTransferLifecyclePorts(),
  verifyStorageV2AccountMarker,
  authenticatedOwner:()=>cloudAuth.loadSession()?.user?.id||null,
  readStorageProtocolState:()=>cloudTransport.readStorageProtocolState(),
  recoverFencedAccount:()=>storageV2Coordinator.recoverFencedAccount(),
  recoverSharedChecksV2Primary,
  recoverSharedChecksV2ReadOnly:(...args)=>sharedChecksV2.recoverReadOnly(...args),
  ensureSyncCapabilities:(...args)=>cloudAuth.ensureSyncCapabilities(...args),
  files,
  tab,
  session,
  checksSession,
  recoverLocalV2State:(...args)=>storageBrowser.recoverLocalV2State(...args),
  recoverReadOnlyV2State:(...args)=>storageBrowser.recoverReadOnlyV2State(...args),
  resumeIncompleteRestore:(...args)=>uiBackup.resumeIncompleteRestore(...args),
  ...storageV2Cloud,
  cloudHasLocalWork:(...args)=>stateSnapshots.cloudHasLocalWork(...args),
  sharedChecksHasLocalWork:()=>sharedChecksV2.hasLocalWork,
  setSave:(...args)=>uiStatus.setSave(...args),
  setCloud:(...args)=>uiStatus.setCloud(...args),
  beginStartupSync:(...args)=>uiStatus.beginStartupSync(...args),
  setStartupDomain:(...args)=>uiStatus.setStartupDomain(...args),
  syncFolderAccessButton:(...args)=>uiFolderStatus.syncFolderAccessButton(...args),
  folderBackupAvailable:(...args)=>uiFolderStatus.folderBackupAvailable(...args),
  folderSaveTitle:(...args)=>uiFolderStatus.folderSaveTitle(...args),
  showSecondaryTabGuard:(...args)=>uiTabGuard.showSecondaryTabGuard(...args),
  acquirePrimaryTabLock:(...args)=>storageTabLock.acquirePrimaryTabLock(...args),
  render:(...args)=>uiNavigation.render(...args),
  prepareState:(...args)=>stateSelectors.prepareState(...args),
  maybeCreateAutomaticFolderBackup:(...args)=>storageBackup.maybeCreateAutomaticFolderBackup(...args),
  loadDirHandle:(...args)=>storageIndexedDb.loadDirHandle(...args),
  requestPersistentBrowserStorage:(...args)=>storageIndexedDb.requestPersistentBrowserStorage(...args),
  refreshDirPermission:(...args)=>storageFiles.refreshDirPermission(...args),
  loadSession:(...args)=>cloudAuth.loadSession(...args),
  cloudEnabled:(...args)=>cloudAuth.cloudEnabled(...args),
  refreshKupaReadout:(...args)=>domainsBankCache.refreshKupaReadout(...args),
  syncSharedChecksFromCloud:(...args)=>syncChecks.syncSharedChecksFromCloud(...args),
  openCloud:(...args)=>uiCloud.openCloud(...args),
  startOrderPolling:(...args)=>syncDocument.startPolling(...args),
  startFinanceAutoSync:(...args)=>domainsFinanceController.startAutoSync(...args),
  prepareStartupAlerts:(...args)=>domainsFinanceController.ensureBankDisplayArchive(...args),
  showStartupAlerts:(...args)=>uiAlertCenter.showStartupAlerts(...args),
});

const uiEvents={bindActionEvents:(root,actions)=>bindActionEvents(root,actions)};

const creditCardOrderView=createCreditCardOrderView({getSync:()=>domainsFinanceController.snapshot().creditSync,saveOrder:(...args)=>domainsFinanceController.saveCreditCardOrder(...args),modal:(...args)=>uiModal.modal(...args),closeModal:()=>uiModal.closeModal(),render:()=>domainsFinanceView.renderKupa(),escapeHtml:esc});

const servicePorts=createServiceActionPorts({bulk:domainsServiceBulk,view:domainsServiceView,editor:domainsServiceEditor});
const warehousePorts=createWarehouseActionPorts({inventoryOrder:domainsInventoryOrder,inventorySelectors:domainsInventorySelectors,bulk:domainsWarehouseBulk,view:domainsWarehouseView,inventoryEditor:domainsInventoryEditor,editor:domainsWarehouseEditor});
const calendarPorts=calendarRuntime.actionPorts();
const uiActions=composeActionRegistry([
  ...createExternalActionPacks({notesSheetActions:domainsNotesController.sheetActions,creditOrderActions:creditCardOrderView.actions}),
  {name:'alerts',actions:createAlertsActions({uiAlertCenter})},
  {name:'finance-bank',actions:createFinanceBankActions({domainsFinanceController,domainsFinanceView,importFinanceConnections,ui,uiStatus})},
  {name:'finance-credit',actions:createFinanceCreditActions({domainsFinanceView,ui})},
  {name:'checks',actions:createChecksActions({domainsBankCache,domainsChecksEditor,domainsChecksView,domainsFinanceView,ui,uiDateEditor,uiModal})},
  {name:'shell',actions:createShellActions({uiModal})},
  {name:'dashboard',actions:createDashboardActions({domainsDashboardView,domainsFinanceView,ui})},
  {name:'suppliers',actions:createSuppliersActions({domainsSuppliersBulk,domainsSuppliersEditor,domainsSuppliersNavigation,domainsSuppliersOrder,domainsSuppliersView,supplierUi})},
  {name:'customers',actions:createCustomersActions({customerUi,domainsCustomers})},
  {name:'morning',actions:createMorningActions({domainsCustomers})},
  {name:'service',actions:createServiceActions({domainsServiceView,servicePorts,serviceUi})},
  {name:'warehouse',actions:createWarehouseActions({domainsWarehouseView,uiModal,warehousePorts,warehouseUi})},
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
  openInventoryItemModal:(...args)=>{if(!tab.primaryTab){uiStatus.toast('לקריאה בלבד — עריכת פריט זמינה בטאב הראשי.');return}return domainsInventoryEditor.openInventoryItemModal(...args)},
  confirmDialog:(...args)=>uiModal.confirmDialog(...args),
});

// The visible model starts empty and is hydrated only from the verified V2
// Main and Shared journals during boot. Retired V1 browser keys are inert.
model.state=stateNormalization.normalizeState(structuredClone(INITIAL_STATE));
supplierUi.currentSupplierId=domainsSuppliersSelectors.orderedSuppliers()[0]?.id||null;
checksSession.checksCloudBase=[];
checksSession.checksBankEvents=[];
bindOrdersRuntimeEvents({uiModal,uiNavigation,domainsSuppliersNavigation,cloudAuth,uiStatus,syncChecks,tab,session,domainsCustomers,domainsFinanceController,stateSnapshots,syncDocument,uiFolders,uiAlertCenter,uiTabGuard,storageV2:mainStorageV2,sharedChecksV2});
const startupUiActions=wrapMutationActions(uiActions,(domain)=>uiStatus.guardStartupMutation(domain));
uiEvents.bindActionEvents(document.getElementById('main'),startupUiActions);
bindDismissibleDetails(document);
bindNumberInputWheelGuard(document);
uiEvents.bindActionEvents(document.getElementById('modal'),startupUiActions);
uiGlobalSearch.bind();
uiKeyboardNavigation.bind();
export const appReady=lifecycle.boot().then(()=>{if(session.storageProtocolBlocked)return false;domainsCalendarController.start();if(tab.primaryTab&&navigator.onLine&&cloudAuth.loadSession())setTimeout(()=>void domainsCustomers.recoverPendingMorningOperation({quiet:false}),350);return true});
export async function sharedChecksStorageV2Diagnostics(){await sharedChecksV2.flush();return {...sharedChecksV2.diagnostics}}
void appReady.then(ready=>{if(ready)uiAlertCenter.startDateWatcher()});
