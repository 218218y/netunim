import {createStateNormalization} from './state/normalization.js';
import {createStorageBrowser} from './storage/browser.js';
import {createStorageChecks} from './storage/checks.js';
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
import {createDomainsBankAlerts} from './domains/bank/alerts.js';
import {createDomainsFinanceBridge} from './domains/finance/bridge.js';
import {createDomainsFinanceController} from './domains/finance/controller.js';
import {createDomainsFinanceView} from './domains/finance/view.js';
import {createUiDateEditor} from './ui/date-editor.js';
import {createDomainsChecksEditor} from './domains/checks/editor.js';
import {createSyncChecksPersistence} from './sync/checks-persistence.js';
import {createDomainsDashboardView} from './domains/dashboard/view.js';
import {createDomainsSuppliersOrder} from './domains/suppliers/order.js';
import {createDomainsSuppliersBulk} from './domains/suppliers/bulk.js';
import {createDomainsSuppliersView} from './domains/suppliers/view.js';
import {createUiModal} from './ui/modal.js';
import {createDomainsSuppliersEditor} from './domains/suppliers/editor.js';
import {createDomainsCustomersSelectors} from './domains/customers/selectors.js';
import {createDomainsCustomersBulk} from './domains/customers/bulk.js';
import {createDomainsCustomersView} from './domains/customers/view.js';
import {createDomainsCustomersEditor} from './domains/customers/editor.js';
import {createDomainsServiceBulk} from './domains/service/bulk.js';
import {createDomainsServiceView} from './domains/service/view.js';
import {createDomainsServiceEditor} from './domains/service/editor.js';
import {createDomainsInventorySelectors} from './domains/inventory/selectors.js';
import {createDomainsInventoryOrder} from './domains/inventory/order.js';
import {createDomainsInventoryView} from './domains/inventory/view.js';
import {createDomainsWarehouseBulk} from './domains/warehouse/bulk.js';
import {createDomainsWarehouseView} from './domains/warehouse/view.js';
import {createDomainsInventoryEditor} from './domains/inventory/editor.js';
import {createDomainsWarehouseEditor} from './domains/warehouse/editor.js';
import {createUiBackup} from './ui/backup.js';
import {createStateSelectors} from './state/selectors.js';
import {createStorageFiles} from './storage/files.js';
import {createStorageBackup} from './storage/backup.js';
import {createStorageIndexedDb} from './storage/indexed-db.js';
import {createUiFolders} from './ui/folders.js';
import {createCloudAuth} from './cloud/auth.js';
import {createCloudTransport} from './cloud/transport.js';
import {createSyncMerge} from './sync/merge.js';
import {createSyncChecks} from './sync/checks.js';
import {createSyncDocument} from './sync/document.js';
import {createUiCloud} from './ui/cloud.js';
import {createDomainsNotesController} from './domains/notes/controller.js';
import {createCalendarStorage} from './calendar/storage.js';
import {createCalendarAuth} from './calendar/auth.js';
import {createCalendarApi} from './calendar/api.js';
import {createCalendarJournal} from './calendar/journal.js';
import {createDomainsCalendarController} from './domains/calendar/controller.js';
import {createUiSettings} from './ui/settings.js';
import {createLifecycle} from './lifecycle.js';
import {bindActionEvents,bindBackdropDismissal} from './shared/events.js';
import {createUiActions} from './ui/actions.js';
import {createUiGlobalSearch} from './ui/global-search.js';
import {createContexts} from './state/contexts.js';
import {INITIAL_STATE, $} from "./state/constants.js";















const {model, ui, supplierUi, customerUi, serviceUi, warehouseUi, notesUi, calendarUi, calendarSession, files, tab, session, checksSession}=createContexts();

const stateNormalization=createStateNormalization({

});

const storageBrowser=createStorageBrowser({
  model,
  files,
  prepareState:(...args)=>stateSelectors.prepareState(...args),
  normalizeState:(...args)=>stateNormalization.normalizeState(...args),
});

const storageChecks=createStorageChecks({
  checksSession,
});

const cloudAuth=createCloudAuth({

});

const domainsFinanceBridge=createDomainsFinanceBridge();

const calendarStorage=createCalendarStorage();
const calendarAuth=createCalendarAuth({
  calendarSession,
  supaFetch:(...args)=>cloudAuth.supaFetch(...args),
});
const calendarApi=createCalendarApi({calendarAuth});
const calendarJournal=createCalendarJournal({calendarStorage,calendarApi});

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
  model,
  tab,
  session,
  ui,
  normalizeState:(...args)=>stateNormalization.normalizeState(...args),
  loadLocal:(...args)=>storageBrowser.loadLocal(...args),
  showSecondaryTabGuard:(...args)=>uiTabGuard.showSecondaryTabGuard(...args),
  render:(...args)=>uiNavigation.render(...args),
  localSnapshot:(...args)=>storageBrowser.localSnapshot(...args),
  markCloudPending:(...args)=>storageBrowser.markCloudPending(...args),
  setSave:(...args)=>uiStatus.setSave(...args),
  syncFolderAccessButton:(...args)=>uiFolderStatus.syncFolderAccessButton(...args),
  folderBackupAvailable:(...args)=>uiFolderStatus.folderBackupAvailable(...args),
  folderSaveTitle:(...args)=>uiFolderStatus.folderSaveTitle(...args),
  writeStateToFolder:(...args)=>storageFiles.writeStateToFolder(...args),
  cloudEnabled:(...args)=>cloudAuth.cloudEnabled(...args),
  requestCloudSave:(...args)=>syncDocument.requestCloudSave(...args),
  cloudPendingExists:(...args)=>storageBrowser.cloudPendingExists(...args),
  toast:(...args)=>uiStatus.toast(...args),
  setCloud:(...args)=>uiStatus.setCloud(...args),
  folderPermissionPending:(...args)=>uiFolderStatus.folderPermissionPending(...args),
  sameBusinessData:(...args)=>stateSnapshots.sameBusinessData(...args),
  cloudHasLocalWork:(...args)=>stateSnapshots.cloudHasLocalWork(...args),
  checksHaveLocalWork:(...args)=>stateSnapshots.checksHaveLocalWork(...args),
  loadSession:(...args)=>cloudAuth.loadSession(...args),
  saveSharedChecksToCloud:(...args)=>syncChecks.saveSharedChecksToCloud(...args),
});

const stateSnapshots=createStateSnapshots({
  model,
  ui,
  session,
  checksSession,
  prepareState:(...args)=>stateSelectors.prepareState(...args),
  cloudPendingExists:(...args)=>storageBrowser.cloudPendingExists(...args),
  checksPendingExists:(...args)=>storageChecks.checksPendingExists(...args),
  normalizeState:(...args)=>stateNormalization.normalizeState(...args),
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
  renderCustomers:(...args)=>domainsCustomersView.renderCustomers(...args),
  renderService:(...args)=>domainsServiceView.renderService(...args),
  renderWarehouse:(...args)=>domainsWarehouseView.renderWarehouse(...args),
  renderNotes:(...args)=>domainsNotesController.renderNotes(...args),
  renderCalendar:(...args)=>domainsCalendarController.renderCalendar(...args),
  renderSettings:(...args)=>uiSettings.renderSettings(...args),
  maybeShowCashflowStartupAlert:(...args)=>domainsBankAlerts.maybeShowStartupCashflowAlert(...args),
});

const domainsChecksView=createDomainsChecksView({
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

const syncChecksPersistence=createSyncChecksPersistence({
  session,
  checksSession,
  localSnapshot:(...args)=>storageBrowser.localSnapshot(...args),
  markChecksPending:(...args)=>storageChecks.markChecksPending(...args),
  toast:(...args)=>uiStatus.toast(...args),
  setSave:(...args)=>uiStatus.setSave(...args),
  syncFolderAccessButton:(...args)=>uiFolderStatus.syncFolderAccessButton(...args),
  folderBackupAvailable:(...args)=>uiFolderStatus.folderBackupAvailable(...args),
  folderSaveTitle:(...args)=>uiFolderStatus.folderSaveTitle(...args),
  rejectSecondaryMutation:(...args)=>storagePersistence.rejectSecondaryMutation(...args),
  writeStateToFolder:(...args)=>storageFiles.writeStateToFolder(...args),
  loadSession:(...args)=>cloudAuth.loadSession(...args),
  saveSharedChecksToCloud:(...args)=>syncChecks.saveSharedChecksToCloud(...args),
});

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
  customerStats:(...args)=>domainsCustomersSelectors.customerStats(...args),
});

const domainsSuppliersOrder=createDomainsSuppliersOrder({
  model,
  supplierUi,
  ui,
  modal:(...args)=>uiModal.modal(...args),
  scheduleSave:(...args)=>storagePersistence.scheduleSave(...args),
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
  scheduleSave:(...args)=>storagePersistence.scheduleSave(...args),
  closeModal:(...args)=>uiModal.closeModal(...args),
  confirmDialog:(...args)=>uiModal.confirmDialog(...args),
});

const domainsSuppliersView=createDomainsSuppliersView({
  model,
  supplierUi,
  balanceRows:(...args)=>domainsSuppliersSelectors.balanceRows(...args),
  supplierYearContext:(...args)=>domainsSuppliersSelectors.supplierYearContext(...args),
  supplierViewRows:(...args)=>domainsSuppliersSelectors.supplierViewRows(...args),
  mountViewLayout:(...args)=>uiLayout.mountViewLayout(...args),
  orderedSuppliers:(...args)=>domainsSuppliersSelectors.orderedSuppliers(...args),
  captureSupplierViewport:(...args)=>uiLayout.captureSupplierViewport(...args),
  restoreSupplierViewport:(...args)=>uiLayout.restoreSupplierViewport(...args),
  syncSupplierBulkUi:(...args)=>domainsSuppliersBulk.syncSupplierBulkUi(...args),
  supplierMoveTargetRow:(...args)=>domainsSuppliersBulk.supplierMoveTargetRow(...args),
  storeSupplierViewport:(...args)=>uiLayout.storeSupplierViewport(...args),
  scrollSupplierTransactionsEnd:(...args)=>uiLayout.scrollSupplierTransactionsEnd(...args),
  scheduleSave:(...args)=>storagePersistence.scheduleSave(...args),
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
  scheduleSave:(...args)=>storagePersistence.scheduleSave(...args),
  render:(...args)=>uiNavigation.render(...args),
  renderSupplier:(...args)=>domainsSuppliersView.renderSupplier(...args),
  closeModal:(...args)=>uiModal.closeModal(...args),
  parseTri:(...args)=>uiModal.parseTri(...args),
  confirmDialog:(...args)=>uiModal.confirmDialog(...args),
});

const domainsCustomersSelectors=createDomainsCustomersSelectors({
  model,
});

const domainsCustomersBulk=createDomainsCustomersBulk({
  customerUi,
  model,
  renderCustomers:(...args)=>domainsCustomersView.renderCustomers(...args),
  toast:(...args)=>uiStatus.toast(...args),
  scheduleSave:(...args)=>storagePersistence.scheduleSave(...args),
  confirmDialog:(...args)=>uiModal.confirmDialog(...args),
  onTabChange:(tab)=>uiNavigation.setCustomerRoute(tab),
});

const domainsCustomersView=createDomainsCustomersView({
  model,
  customerUi,
  bindScrollViewport:(...args)=>uiLayout.bindScrollViewport(...args),
  mountViewLayout:(...args)=>uiLayout.mountViewLayout(...args),
  customerStats:(...args)=>domainsCustomersSelectors.customerStats(...args),
  customerBulkHeader:(...args)=>domainsCustomersBulk.customerBulkHeader(...args),
  customerBulkControls:(...args)=>domainsCustomersBulk.customerBulkControls(...args),
  syncCustomerBulkUi:(...args)=>domainsCustomersBulk.syncCustomerBulkUi(...args),
  customerBottomSummary:(...args)=>domainsCustomersBulk.customerBottomSummary(...args),
  customerBulkCell:(...args)=>domainsCustomersBulk.customerBulkCell(...args),
  scheduleSave:(...args)=>storagePersistence.scheduleSave(...args),
});

const domainsCustomersEditor=createDomainsCustomersEditor({
  model,
  customerUi,
  modal:(...args)=>uiModal.modal(...args),
  toast:(...args)=>uiStatus.toast(...args),
  scheduleSave:(...args)=>storagePersistence.scheduleSave(...args),
  closeModal:(...args)=>uiModal.closeModal(...args),
  renderCustomers:(...args)=>domainsCustomersView.renderCustomers(...args),
  confirmDialog:(...args)=>uiModal.confirmDialog(...args),
});

const domainsServiceBulk=createDomainsServiceBulk({
  serviceUi,
  model,
  renderService:(...args)=>domainsServiceView.renderService(...args),
  toast:(...args)=>uiStatus.toast(...args),
  scheduleSave:(...args)=>storagePersistence.scheduleSave(...args),
  confirmDialog:(...args)=>uiModal.confirmDialog(...args),
});

const domainsServiceView=createDomainsServiceView({
  model,
  serviceUi,
  mountViewLayout:(...args)=>uiLayout.mountViewLayout(...args),
  serviceBulkControls:(...args)=>domainsServiceBulk.serviceBulkControls(...args),
  syncServiceBulkUi:(...args)=>domainsServiceBulk.syncServiceBulkUi(...args),
  toast:(...args)=>uiStatus.toast(...args),
  scheduleSave:(...args)=>storagePersistence.scheduleSave(...args),
});

const domainsServiceEditor=createDomainsServiceEditor({
  model,
  modal:(...args)=>uiModal.modal(...args),
  toast:(...args)=>uiStatus.toast(...args),
  scheduleSave:(...args)=>storagePersistence.scheduleSave(...args),
  closeModal:(...args)=>uiModal.closeModal(...args),
  renderService:(...args)=>domainsServiceView.renderService(...args),
  confirmDialog:(...args)=>uiModal.confirmDialog(...args),
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
  scheduleSave:(...args)=>storagePersistence.scheduleSave(...args),
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
  inventoryGroupStats:(...args)=>domainsInventorySelectors.inventoryGroupStats(...args),
  inventoryCategoryGroups:(...args)=>domainsInventorySelectors.inventoryCategoryGroups(...args),
  inventoryLocationText:(...args)=>domainsInventorySelectors.inventoryLocationText(...args),
  inventoryItemLocations:(...args)=>domainsInventorySelectors.inventoryItemLocations(...args),
});

const domainsWarehouseBulk=createDomainsWarehouseBulk({
  warehouseUi,
  model,
  renderWarehouse:(...args)=>domainsWarehouseView.renderWarehouse(...args),
  toast:(...args)=>uiStatus.toast(...args),
  scheduleSave:(...args)=>storagePersistence.scheduleSave(...args),
  inventoryStats:(...args)=>domainsInventorySelectors.inventoryStats(...args),
  confirmDialog:(...args)=>uiModal.confirmDialog(...args),
});

const domainsWarehouseView=createDomainsWarehouseView({
  warehouseUi,
  model,
  mountViewLayout:(...args)=>uiLayout.mountViewLayout(...args),
  inventoryTotals:(...args)=>domainsInventorySelectors.inventoryTotals(...args),
  renderStockGrid:(...args)=>domainsInventoryView.renderStockGrid(...args),
  renderWarehouseLocations:(...args)=>domainsInventoryView.renderWarehouseLocations(...args),
  warehouseBulkControls:(...args)=>domainsWarehouseBulk.warehouseBulkControls(...args),
  syncWarehouseBulkUi:(...args)=>domainsWarehouseBulk.syncWarehouseBulkUi(...args),
  inventoryEventView:(...args)=>domainsInventorySelectors.inventoryEventView(...args),
});

const domainsInventoryEditor=createDomainsInventoryEditor({
  model,
  modal:(...args)=>uiModal.modal(...args),
  inventoryStats:(...args)=>domainsInventorySelectors.inventoryStats(...args),
  inventoryLocationDatalist:(...args)=>domainsInventoryView.inventoryLocationDatalist(...args),
  inventoryCategoryDatalist:(...args)=>domainsInventoryView.inventoryCategoryDatalist(...args),
  toast:(...args)=>uiStatus.toast(...args),
  scheduleSave:(...args)=>storagePersistence.scheduleSave(...args),
  closeModal:(...args)=>uiModal.closeModal(...args),
  ensureInventoryCategoryOrder:(...args)=>domainsInventoryOrder.ensureInventoryCategoryOrder(...args),
  renderWarehouse:(...args)=>domainsWarehouseView.renderWarehouse(...args),
  confirmDialog:(...args)=>uiModal.confirmDialog(...args),
});

const domainsWarehouseEditor=createDomainsWarehouseEditor({
  model,
  modal:(...args)=>uiModal.modal(...args),
  toast:(...args)=>uiStatus.toast(...args),
  scheduleSave:(...args)=>storagePersistence.scheduleSave(...args),
  closeModal:(...args)=>uiModal.closeModal(...args),
  renderWarehouse:(...args)=>domainsWarehouseView.renderWarehouse(...args),
  confirmDialog:(...args)=>uiModal.confirmDialog(...args),
});

const uiBackup=createUiBackup({
  validateRestoreJson:(...args)=>stateNormalization.validateRestoreJson(...args),
  tab,
  ui,
  model,
  session,
  checksSession,
  prepareState:(...args)=>stateSelectors.prepareState(...args),
  normalizeState:(...args)=>stateNormalization.normalizeState(...args),
  toast:(...args)=>uiStatus.toast(...args),
  showSecondaryTabGuard:(...args)=>uiTabGuard.showSecondaryTabGuard(...args),
  modal:(...args)=>uiModal.modal(...args),
  localSnapshot:(...args)=>storageBrowser.localSnapshot(...args),
  markCloudPending:(...args)=>storageBrowser.markCloudPending(...args),
  persistChecksBase:(...args)=>storageChecks.persistChecksBase(...args),
  markChecksPending:(...args)=>storageChecks.markChecksPending(...args),
  setSave:(...args)=>uiStatus.setSave(...args),
  folderBackupAvailable:(...args)=>uiFolderStatus.folderBackupAvailable(...args),
  folderSaveTitle:(...args)=>uiFolderStatus.folderSaveTitle(...args),
  prepareCloudState:(...args)=>stateSnapshots.prepareCloudState(...args),
  render:(...args)=>uiNavigation.render(...args),
  closeModal:(...args)=>uiModal.closeModal(...args),
  writeStateSnapshotToFolder:(...args)=>storageFiles.writeStateSnapshotToFolder(...args),
  writeStateToFolder:(...args)=>storageFiles.writeStateToFolder(...args),
  loadSession:(...args)=>cloudAuth.loadSession(...args),
  readCloud:(...args)=>cloudTransport.readCloud(...args),
  cloudEnabled:(...args)=>cloudAuth.cloudEnabled(...args),
  readSharedChecksCloud:(...args)=>cloudTransport.readSharedChecksCloud(...args),
  saveSharedChecksToCloud:(...args)=>syncChecks.saveSharedChecksToCloud(...args),
  requestCloudSave:(...args)=>syncDocument.requestCloudSave(...args),
  balanceRows:(...args)=>domainsSuppliersSelectors.balanceRows(...args),
  supplierYearContext:(...args)=>domainsSuppliersSelectors.supplierYearContext(...args),
  boolText:(...args)=>domainsSuppliersView.boolText(...args),
  confirmDialog:(...args)=>uiModal.confirmDialog(...args),
});

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
});

const syncMerge=createSyncMerge({
  normalizeState:(...args)=>stateNormalization.normalizeState(...args),
});

const syncChecks=createSyncChecks({
  model,
  files,
  checksSession,
  tab,
  localSnapshot:(...args)=>storageBrowser.localSnapshot(...args),
  persistChecksBase:(...args)=>storageChecks.persistChecksBase(...args),
  markChecksPending:(...args)=>storageChecks.markChecksPending(...args),
  clearChecksPending:(...args)=>storageChecks.clearChecksPending(...args),
  toast:(...args)=>uiStatus.toast(...args),
  recomputeKupaNetFromCache:(...args)=>domainsBankCache.recomputeKupaNetFromCache(...args),
  renderKupaDependentView:(...args)=>domainsBankCache.renderKupaDependentView(...args),
  queueSharedChecksSave:(...args)=>syncChecksPersistence.queueSharedChecksSave(...args),
  writeStateToFolder:(...args)=>storageFiles.writeStateToFolder(...args),
  loadSession:(...args)=>cloudAuth.loadSession(...args),
  readSharedChecksCloud:(...args)=>cloudTransport.readSharedChecksCloud(...args),
  checksPendingExists:(...args)=>storageChecks.checksPendingExists(...args),
  rpcSaveSharedChecks:(...args)=>cloudTransport.rpcSaveSharedChecks(...args),
  checksHaveLocalWork:(...args)=>stateSnapshots.checksHaveLocalWork(...args),
  readSharedChecksCloudMeta:(...args)=>cloudTransport.readSharedChecksCloudMeta(...args),
  refreshCloudTimestamp:(...args)=>uiStatus.refreshCloudTimestamp(...args),
});

const domainsFinanceController=createDomainsFinanceController({
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
  toast:(...args)=>uiStatus.toast(...args),
  readFinanceSyncDocument:(...args)=>cloudTransport.readFinanceSyncDocument(...args),
  rpcSaveFinanceSync:(...args)=>cloudTransport.rpcSaveFinanceSync(...args),
  claimFinanceSyncLease:(...args)=>cloudTransport.claimFinanceSyncLease(...args),
  releaseFinanceSyncLease:(...args)=>cloudTransport.releaseFinanceSyncLease(...args),
  saveBankSyncSnapshot:(...args)=>cloudTransport.saveBankSyncSnapshot(...args),
  mergeBankTransactions:(...args)=>cloudTransport.mergeBankTransactions(...args),
  readBankTransactions:(...args)=>cloudTransport.readBankTransactions(...args),
});

const domainsFinanceView=createDomainsFinanceView({
  ui,
  controller:domainsFinanceController,
  checksView:domainsChecksView,
  dashboardView:domainsDashboardView,
  mountViewLayout:(...args)=>uiLayout.mountViewLayout(...args),
  modal:(...args)=>uiModal.modal(...args),
  closeModal:(...args)=>uiModal.closeModal(...args),
  confirmDialog:(...args)=>uiModal.confirmDialog(...args),
});

const domainsBankAlerts=createDomainsBankAlerts({
  financeSnapshot:(...args)=>domainsFinanceController.snapshot(...args),
  modal:(...args)=>uiModal.modal(...args),
});

const syncDocument=createSyncDocument({
  model,
  files,
  session,
  ui,
  tab,
  normalizeState:(...args)=>stateNormalization.normalizeState(...args),
  localSnapshot:(...args)=>storageBrowser.localSnapshot(...args),
  markCloudPending:(...args)=>storageBrowser.markCloudPending(...args),
  clearCloudPending:(...args)=>storageBrowser.clearCloudPending(...args),
  toast:(...args)=>uiStatus.toast(...args),
  setCloud:(...args)=>uiStatus.setCloud(...args),
  prepareCloudState:(...args)=>stateSnapshots.prepareCloudState(...args),
  writeStateToFolder:(...args)=>storageFiles.writeStateToFolder(...args),
  readCloud:(...args)=>cloudTransport.readCloud(...args),
  rpcSave:(...args)=>cloudTransport.rpcSave(...args),
  merge3:(...args)=>syncMerge.merge3(...args),
  applyOrderCloudState:(...args)=>stateSnapshots.applyOrderCloudState(...args),
  cloudPendingExists:(...args)=>storageBrowser.cloudPendingExists(...args),
  setSave:(...args)=>uiStatus.setSave(...args),
  cloudEnabled:(...args)=>cloudAuth.cloudEnabled(...args),
  loadCloudPendingState:(...args)=>storageBrowser.loadCloudPendingState(...args),
  sameOrderCloudData:(...args)=>stateSnapshots.sameOrderCloudData(...args),
  cloudHasLocalWork:(...args)=>stateSnapshots.cloudHasLocalWork(...args),
  render:(...args)=>uiNavigation.render(...args),
  readCloudMeta:(...args)=>cloudTransport.readCloudMeta(...args),
  refreshKupaReadout:(...args)=>domainsBankCache.refreshKupaReadout(...args),
  pollSharedChecks:(...args)=>syncChecks.pollSharedChecks(...args),
  refreshCloudTimestamp:(...args)=>uiStatus.refreshCloudTimestamp(...args),
});

const uiCloud=createUiCloud({
  model,
  files,
  tab,
  session,
  checksSession,
  ui,
  modal:(...args)=>uiModal.modal(...args),
  supaConfigured:(...args)=>cloudAuth.supaConfigured(...args),
  toast:(...args)=>uiStatus.toast(...args),
  closeModal:(...args)=>uiModal.closeModal(...args),
  authPassword:(...args)=>cloudAuth.authPassword(...args),
  localSnapshot:(...args)=>storageBrowser.localSnapshot(...args),
  markCloudPending:(...args)=>storageBrowser.markCloudPending(...args),
  clearCloudPending:(...args)=>storageBrowser.clearCloudPending(...args),
  setCloud:(...args)=>uiStatus.setCloud(...args),
  showSecondaryTabGuard:(...args)=>uiTabGuard.showSecondaryTabGuard(...args),
  prepareCloudState:(...args)=>stateSnapshots.prepareCloudState(...args),
  render:(...args)=>uiNavigation.render(...args),
  writeStateToFolder:(...args)=>storageFiles.writeStateToFolder(...args),
  loadSession:(...args)=>cloudAuth.loadSession(...args),
  readCloud:(...args)=>cloudTransport.readCloud(...args),
  applyOrderCloudState:(...args)=>stateSnapshots.applyOrderCloudState(...args),
  refreshKupaReadout:(...args)=>domainsBankCache.refreshKupaReadout(...args),
  syncSharedChecksFromCloud:(...args)=>syncChecks.syncSharedChecksFromCloud(...args),
  requestCloudSave:(...args)=>syncDocument.requestCloudSave(...args),
  restorePendingAgainstCloud:(...args)=>syncDocument.restorePendingAgainstCloud(...args),
  startPolling:(...args)=>syncDocument.startPolling(...args),
  saveSession:(...args)=>cloudAuth.saveSession(...args),
  renderSettings:(...args)=>uiSettings.renderSettings(...args),
  resumeCalendarAfterCloudLogin:(...args)=>domainsCalendarController.resumeAfterCloudLogin(...args),
  startFinanceAutoSync:(...args)=>domainsFinanceController.startAutoSync(...args),
});

const domainsCalendarController=createDomainsCalendarController({
  ui,
  calendarUi,
  calendarSession,
  calendarStorage,
  calendarAuth,
  calendarApi,
  calendarJournal,
  mountViewLayout:(...args)=>uiLayout.mountViewLayout(...args),
  modal:(...args)=>uiModal.modal(...args),
  closeModal:(...args)=>uiModal.closeModal(...args),
  toast:(...args)=>uiStatus.toast(...args),
  requestCloudLogin:()=>uiCloud.loginModal('calendar'),
  confirmDialog:(...args)=>uiModal.confirmDialog(...args),
});

const domainsNotesController=createDomainsNotesController({
  model,
  notesUi,
  scheduleSave:(...args)=>storagePersistence.scheduleSave(...args),
  toast:(...args)=>uiStatus.toast(...args),
  mountViewLayout:(...args)=>uiLayout.mountViewLayout(...args),
  confirmDialog:(...args)=>uiModal.confirmDialog(...args),
});

const uiSettings=createUiSettings({
  model,
  supplierUi,
  files,
  session,
  checksSession,
  mountViewLayout:(...args)=>uiLayout.mountViewLayout(...args),
  orderedSuppliers:(...args)=>domainsSuppliersSelectors.orderedSuppliers(...args),
  orderedInventoryCategoryNames:(...args)=>domainsInventorySelectors.orderedInventoryCategoryNames(...args),
  cloudEnabled:(...args)=>cloudAuth.cloudEnabled(...args),
  financeSnapshot:(...args)=>domainsFinanceController.snapshot(...args),
});

const lifecycle=createLifecycle({
  model,
  files,
  tab,
  ui,
  session,
  checksSession,
  normalizeState:(...args)=>stateNormalization.normalizeState(...args),
  restoreBrowserStateFallback:(...args)=>storageBrowser.restoreBrowserStateFallback(...args),
  markCloudPending:(...args)=>storageBrowser.markCloudPending(...args),
  loadCloudPendingState:(...args)=>storageBrowser.loadCloudPendingState(...args),
  checksPendingExists:(...args)=>storageChecks.checksPendingExists(...args),
  setSave:(...args)=>uiStatus.setSave(...args),
  setCloud:(...args)=>uiStatus.setCloud(...args),
  syncFolderAccessButton:(...args)=>uiFolderStatus.syncFolderAccessButton(...args),
  folderBackupAvailable:(...args)=>uiFolderStatus.folderBackupAvailable(...args),
  folderSaveTitle:(...args)=>uiFolderStatus.folderSaveTitle(...args),
  showSecondaryTabGuard:(...args)=>uiTabGuard.showSecondaryTabGuard(...args),
  acquirePrimaryTabLock:(...args)=>storageTabLock.acquirePrimaryTabLock(...args),
  sameOrderCloudData:(...args)=>stateSnapshots.sameOrderCloudData(...args),
  hasMeaningfulLocalData:(...args)=>stateSnapshots.hasMeaningfulLocalData(...args),
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
  startFinanceAutoSync:(...args)=>domainsFinanceController.startAutoSync(...args),
});

const uiEvents={bindActionEvents};

const uiActions=createUiActions({
  supplierUi,
  customerUi,
  serviceUi,
  warehouseUi,
  ui,
  setKupaSection:(...args)=>domainsFinanceView.setKupaSection(...args),
  setOrdersBankAccountView:(...args)=>domainsFinanceView.setBankAccountView(...args),
  setOrdersBankSearch:(...args)=>domainsFinanceView.setBankSearch(...args),
  toggleOrdersBankSyncOptions:(...args)=>domainsFinanceView.toggleBankSyncOptions(...args),
  saveOrdersBankToken:(...args)=>domainsFinanceView.saveBankToken(...args),
  configureOrdersBank:(...args)=>domainsFinanceView.configureBank(...args),
  selectOrdersBankAccount:(...args)=>domainsFinanceView.selectBankAccount(...args),
  deleteOrdersBankCredentials:(...args)=>domainsFinanceView.deleteBankCredentials(...args),
  refreshOrdersBank:(...args)=>domainsFinanceView.refreshBank(...args),
  setOrdersBankAuto:(...args)=>domainsFinanceView.setBankAuto(...args),
  saveOrdersCashflowMinimum:(...args)=>domainsFinanceController.saveCashflowMinimum(...args),
  refreshOrdersCredit:(...args)=>domainsFinanceView.refreshCredit(...args),
  setOrdersCreditAuto:(...args)=>domainsFinanceView.setCreditAuto(...args),
  setOrdersCreditView:(...args)=>domainsFinanceView.setCreditView(...args),
  setOrdersCreditAccountFilter:(...args)=>domainsFinanceView.setCreditAccountFilter(...args),
  setOrdersCreditProviderFilter:(...args)=>domainsFinanceView.setCreditProviderFilter(...args),
  setOrdersCreditCardFilter:(...args)=>domainsFinanceView.setCreditCardFilter(...args),
  setOrdersCreditDetailMonth:(...args)=>domainsFinanceView.setCreditDetailMonth(...args),
  setOrdersCreditDetailFocus:(...args)=>domainsFinanceView.setCreditDetailFocus(...args),
  clearOrdersCreditDetailFocus:(...args)=>domainsFinanceView.clearCreditDetailFocus(...args),
  setOrdersCreditSearch:(...args)=>domainsFinanceView.setCreditSearch(...args),
  toggleOrdersCreditSyncOptions:(...args)=>domainsFinanceView.toggleCreditSyncOptions(...args),
  setOrdersCreditCardMapping:(...args)=>domainsFinanceView.setCardMapping(...args),
  openOrdersCreditConnection:(...args)=>domainsFinanceView.openCreditConnection(...args),
  saveOrdersCreditConnection:(...args)=>domainsFinanceView.saveCreditConnection(...args),
  deleteOrdersCreditConnection:(...args)=>domainsFinanceView.deleteCreditConnection(...args),
  resetOrdersCreditSync:(...args)=>domainsFinanceView.resetCreditSync(...args),
  setSupplierYearView:(...args)=>domainsSuppliersNavigation.setSupplierYearView(...args),
  setSummarySupplierYearView:(...args)=>{domainsDashboardView.setSummarySupplierYearView(...args,{render:false});if(ui.currentView==='kupa')domainsFinanceView.renderKupa();else domainsDashboardView.renderSummary()},
  handleCheckDatePartInput:(...args)=>uiDateEditor.handleCheckDatePartInput(...args),
  handleCheckDatePartBlur:(...args)=>uiDateEditor.handleCheckDatePartBlur(...args),
  handleCheckDatePartKeydown:(...args)=>uiDateEditor.handleCheckDatePartKeydown(...args),
  openCheckDatePicker:(...args)=>uiDateEditor.openCheckDatePicker(...args),
  applyCheckDatePicker:(...args)=>uiDateEditor.applyCheckDatePicker(...args),
  toggleChecksBulkMode:(...args)=>domainsChecksView.toggleChecksBulkMode(...args),
  toggleChecksBulkRow:(...args)=>domainsChecksView.toggleChecksBulkRow(...args),
  toggleChecksBulkVisible:(...args)=>domainsChecksView.toggleChecksBulkVisible(...args),
  renderChecks:(...args)=>ui.currentView==='kupa'?domainsFinanceView.renderKupa(...args):domainsChecksView.renderChecks(...args),
  renderChecksSearch:(...args)=>domainsChecksView.renderChecksSearch(...args),
  openCheckModal:(...args)=>domainsChecksEditor.openCheckModal(...args),
  markCheckSeriesManual:(...args)=>domainsChecksEditor.markCheckSeriesManual(...args),
  changeCheckSeriesCount:(...args)=>domainsChecksEditor.changeCheckSeriesCount(...args),
  syncCheckSeriesFromFirst:(...args)=>domainsChecksEditor.syncCheckSeriesFromFirst(...args),
  saveCheckSeries:(...args)=>domainsChecksEditor.saveCheckSeries(...args),
  saveCheck:(...args)=>domainsChecksEditor.saveCheck(...args),
  markCheckDeposited:(...args)=>domainsChecksEditor.markCheckDeposited(...args),
  markCheckCleared:(...args)=>domainsChecksEditor.markCheckCleared(...args),
  deleteCheck:(...args)=>domainsChecksEditor.deleteCheck(...args),
  deleteChecksBulkSelected:(...args)=>domainsChecksEditor.deleteChecksBulkSelected(...args),
  openSupplierOrderModal:(...args)=>domainsSuppliersOrder.openSupplierOrderModal(...args),
  moveSupplierOrder:(...args)=>domainsSuppliersOrder.moveSupplierOrder(...args),
  supplierOrderDragStart:(...args)=>domainsSuppliersOrder.supplierOrderDragStart(...args),
  supplierOrderDrop:(...args)=>domainsSuppliersOrder.supplierOrderDrop(...args),
  saveSupplierOrder:(...args)=>domainsSuppliersOrder.saveSupplierOrder(...args),
  toggleSupplierMenu:(...args)=>domainsSuppliersNavigation.toggleSupplierMenu(...args),
  chooseSupplier:(...args)=>domainsSuppliersNavigation.chooseSupplier(...args),
  openSupplier:(...args)=>domainsSuppliersNavigation.openSupplier(...args),
  toggleSupplierBulkMode:(...args)=>domainsSuppliersBulk.toggleSupplierBulkMode(...args),
  toggleSupplierBulkRow:(...args)=>domainsSuppliersBulk.toggleSupplierBulkRow(...args),
  toggleSupplierBulkVisible:(...args)=>domainsSuppliersBulk.toggleSupplierBulkVisible(...args),
  openSelectedSupplierMove:(...args)=>domainsSuppliersBulk.openSelectedSupplierMove(...args),
  cancelSupplierMoveTarget:(...args)=>domainsSuppliersBulk.cancelSupplierMoveTarget(...args),
  openSupplierMoveConfirm:(...args)=>domainsSuppliersBulk.openSupplierMoveConfirm(...args),
  executeSupplierTransactionMove:(...args)=>domainsSuppliersBulk.executeSupplierTransactionMove(...args),
  openSelectedSupplierYearBoundary:(...args)=>domainsSuppliersBulk.openSelectedSupplierYearBoundary(...args),
  saveSupplierYearBoundary:(...args)=>domainsSuppliersBulk.saveSupplierYearBoundary(...args),
  removeSupplierYearBoundary:(...args)=>domainsSuppliersBulk.removeSupplierYearBoundary(...args),
  deleteSelectedTransactions:(...args)=>domainsSuppliersBulk.deleteSelectedTransactions(...args),
  renderSupplier:(...args)=>domainsSuppliersView.renderSupplier(...args),
  filterSupplierSearch:(...args)=>domainsSuppliersView.filterSupplierSearch(...args),
  setInlineTri:(...args)=>domainsSuppliersView.setInlineTri(...args),
  setInlineBool:(...args)=>domainsSuppliersView.setInlineBool(...args),
  saveInlineText:(...args)=>domainsSuppliersView.saveInlineText(...args),
  closeModal:(...args)=>uiModal.closeModal(...args),
  dismissModal:(...args)=>uiModal.dismissModal(...args),
  openTransactionModal:(...args)=>domainsSuppliersEditor.openTransactionModal(...args),
  saveTransaction:(...args)=>domainsSuppliersEditor.saveTransaction(...args),
  deleteTransaction:(...args)=>domainsSuppliersEditor.deleteTransaction(...args),
  openSelectedSupplierEditor:(...args)=>domainsSuppliersEditor.openSelectedSupplierEditor(...args),
  openSupplierModal:(...args)=>domainsSuppliersEditor.openSupplierModal(...args),
  saveSupplier:(...args)=>domainsSuppliersEditor.saveSupplier(...args),
  setCustomerTab:(...args)=>domainsCustomersBulk.setCustomerTab(...args),
  toggleCustomerBulkMode:(...args)=>domainsCustomersBulk.toggleCustomerBulkMode(...args),
  toggleCustomerBulkRow:(...args)=>domainsCustomersBulk.toggleCustomerBulkRow(...args),
  toggleCustomerBulkVisible:(...args)=>domainsCustomersBulk.toggleCustomerBulkVisible(...args),
  deleteSelectedCustomerRows:(...args)=>domainsCustomersBulk.deleteSelectedCustomerRows(...args),
  renderCustomers:(...args)=>domainsCustomersView.renderCustomers(...args),
  addCustomerOrder:(...args)=>domainsCustomersEditor.addCustomerOrder(...args),
  saveCustomerOrderField:(...args)=>domainsCustomersEditor.saveCustomerOrderField(...args),
  deleteCustomerOrder:(...args)=>domainsCustomersEditor.deleteCustomerOrder(...args),
  setCustomerFlag:(...args)=>domainsCustomersView.setCustomerFlag(...args),
  saveDebtNote:(...args)=>domainsCustomersView.saveDebtNote(...args),
  openDebtModal:(...args)=>domainsCustomersEditor.openDebtModal(...args),
  saveDebt:(...args)=>domainsCustomersEditor.saveDebt(...args),
  deleteDebt:(...args)=>domainsCustomersEditor.deleteDebt(...args),
  toggleServiceBulkMode:(...args)=>domainsServiceBulk.toggleServiceBulkMode(...args),
  toggleServiceBulkRow:(...args)=>domainsServiceBulk.toggleServiceBulkRow(...args),
  toggleServiceBulkVisible:(...args)=>domainsServiceBulk.toggleServiceBulkVisible(...args),
  deleteSelectedServiceCalls:(...args)=>domainsServiceBulk.deleteSelectedServiceCalls(...args),
  renderService:(...args)=>domainsServiceView.renderService(...args),
  openServiceGmail:(...args)=>domainsServiceView.openServiceGmail(...args),
  toggleServiceFlag:(...args)=>domainsServiceView.toggleServiceFlag(...args),
  openServiceModal:(...args)=>domainsServiceEditor.openServiceModal(...args),
  saveService:(...args)=>domainsServiceEditor.saveService(...args),
  deleteService:(...args)=>domainsServiceEditor.deleteService(...args),
  openInventoryCategoryOrderModal:(...args)=>domainsInventoryOrder.openInventoryCategoryOrderModal(...args),
  moveInventoryCategoryOrder:(...args)=>domainsInventoryOrder.moveInventoryCategoryOrder(...args),
  inventoryCategoryOrderDragStart:(...args)=>domainsInventoryOrder.inventoryCategoryOrderDragStart(...args),
  inventoryCategoryOrderDrop:(...args)=>domainsInventoryOrder.inventoryCategoryOrderDrop(...args),
  saveInventoryCategoryOrder:(...args)=>domainsInventoryOrder.saveInventoryCategoryOrder(...args),
  toggleInventoryGroup:(...args)=>domainsInventorySelectors.toggleInventoryGroup(...args),
  setWarehouseTab:(...args)=>domainsWarehouseBulk.setWarehouseTab(...args),
  toggleWarehouseBulkMode:(...args)=>domainsWarehouseBulk.toggleWarehouseBulkMode(...args),
  toggleWarehouseBulkRow:(...args)=>domainsWarehouseBulk.toggleWarehouseBulkRow(...args),
  toggleWarehouseBulkVisible:(...args)=>domainsWarehouseBulk.toggleWarehouseBulkVisible(...args),
  archiveSelectedInventoryItems:(...args)=>domainsWarehouseBulk.archiveSelectedInventoryItems(...args),
  renderWarehouse:(...args)=>domainsWarehouseView.renderWarehouse(...args),
  openInventoryItemModal:(...args)=>domainsInventoryEditor.openInventoryItemModal(...args),
  saveInventoryItem:(...args)=>domainsInventoryEditor.saveInventoryItem(...args),
  archiveInventoryItem:(...args)=>domainsInventoryEditor.archiveInventoryItem(...args),
  openStockAdjustmentModal:(...args)=>domainsInventoryEditor.openStockAdjustmentModal(...args),
  saveStockAdjustment:(...args)=>domainsInventoryEditor.saveStockAdjustment(...args),
  openInventoryEventModal:(...args)=>domainsInventoryEditor.openInventoryEventModal(...args),
  saveInventoryEvent:(...args)=>domainsInventoryEditor.saveInventoryEvent(...args),
  editInventoryEvent:(...args)=>domainsInventoryEditor.editInventoryEvent(...args),
  openStockReceive:(...args)=>domainsInventoryEditor.openStockReceive(...args),
  receiveIncoming:(...args)=>domainsInventoryEditor.receiveIncoming(...args),
  confirmReceive:(...args)=>domainsInventoryEditor.confirmReceive(...args),
  pickupReservation:(...args)=>domainsInventoryEditor.pickupReservation(...args),
  releaseReservation:(...args)=>domainsInventoryEditor.releaseReservation(...args),
  cancelIncoming:(...args)=>domainsInventoryEditor.cancelIncoming(...args),
  openWarehouseOrderModal:(...args)=>domainsWarehouseEditor.openWarehouseOrderModal(...args),
  saveWarehouseOrder:(...args)=>domainsWarehouseEditor.saveWarehouseOrder(...args),
  setWarehouseOrderStatus:(...args)=>domainsWarehouseEditor.setWarehouseOrderStatus(...args),
  deleteWarehouseOrder:(...args)=>domainsWarehouseEditor.deleteWarehouseOrder(...args),
  exportJson:(...args)=>uiBackup.exportJson(...args),
  beginJsonRestore:(...args)=>uiBackup.beginJsonRestore(...args),
  applyJsonRestore:(...args)=>uiBackup.applyJsonRestore(...args),
  exportCsv:(...args)=>uiBackup.exportCsv(...args),
  activateSavedFolder:(...args)=>uiFolders.activateSavedFolder(...args),
  chooseFolder:(...args)=>uiFolders.chooseFolder(...args),
  backupToFolder:(...args)=>uiFolders.backupToFolder(...args),
  finishCloudLogin:(...args)=>uiCloud.finishCloudLogin(...args),
  enableCloud:(...args)=>uiCloud.enableCloud(...args),
  openCloud:(...args)=>uiCloud.openCloud(...args),
  logoutCloud:(...args)=>uiCloud.logoutCloud(...args),
  addStickyNote:(...args)=>domainsNotesController.addStickyNote(...args),
  updateStickyNote:(...args)=>domainsNotesController.updateStickyNote(...args),
  deleteStickyNote:(...args)=>domainsNotesController.deleteStickyNote(...args),
  toggleNotesBulkMode:(...args)=>domainsNotesController.toggleNotesBulkMode(...args),
  toggleNotesBulkRow:(...args)=>domainsNotesController.toggleNotesBulkRow(...args),
  toggleNotesBulkVisible:(...args)=>domainsNotesController.toggleNotesBulkVisible(...args),
  deleteSelectedStickyNotes:(...args)=>domainsNotesController.deleteSelectedStickyNotes(...args),
  calendarPrevPeriod:()=>domainsCalendarController.changePeriod(-1),
  calendarNextPeriod:()=>domainsCalendarController.changePeriod(1),
  calendarToday:(...args)=>domainsCalendarController.goToday(...args),
  calendarSetView:(...args)=>domainsCalendarController.setViewMode(...args),
  calendarRefresh:(...args)=>domainsCalendarController.refreshCalendar(...args),
  calendarAuthAction:(...args)=>domainsCalendarController.calendarAuthAction(...args),
  calendarNewEvent:(...args)=>domainsCalendarController.newEvent(...args),
  calendarOpenEvent:(...args)=>domainsCalendarController.openCalendarEvent(...args),
  calendarToggleAllDay:(...args)=>domainsCalendarController.toggleCalendarAllDay(...args),
  calendarSaveEvent:(...args)=>domainsCalendarController.saveCalendarEvent(...args),
  calendarDeleteEvent:(...args)=>domainsCalendarController.deleteCalendarEvent(...args),
});

const uiGlobalSearch=createUiGlobalSearch({
  model,
  ui,
  supplierUi,
  customerUi,
  serviceUi,
  warehouseUi,
  prepareView:(...args)=>uiNavigation.prepareView(...args),
  render:(...args)=>uiNavigation.render(...args),
  openInventoryItemModal:(...args)=>domainsInventoryEditor.openInventoryItemModal(...args),
});

model.state=stateNormalization.normalizeState(storageBrowser.loadLocal()||structuredClone(INITIAL_STATE));
supplierUi.currentSupplierId=domainsSuppliersSelectors.orderedSuppliers()[0]?.id||null;
checksSession.checksCloudBase=storageChecks.loadChecksBase()||structuredClone(model.state.checks||[]);
checksSession.checksBankEvents=storageChecks.loadChecksBankEvents();
bindBackdropDismissal($('#modalBackdrop'),()=>uiModal.dismissModal());
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>uiNavigation.switchView(b.dataset.view)));
document.addEventListener('click',e=>{const menu=$('#supplierMenu');if(menu&&!menu.contains(e.target))domainsSuppliersNavigation.closeSupplierMenu()});
document.addEventListener('keydown',e=>{if(e.key==='Escape')domainsSuppliersNavigation.closeSupplierMenu()});
document.addEventListener('visibilitychange',()=>{if(document.hidden)return;if(cloudAuth.loadSession())setTimeout(syncChecks.pollSharedChecks,120);domainsFinanceController.startAutoSync()});
window.addEventListener('online',()=>{if(cloudAuth.cloudEnabled()){uiStatus.setCloud('ענן: חזרה רשת…');setTimeout(()=>{const resume=stateSnapshots.cloudHasLocalWork()?syncDocument.requestCloudSave('שינויים ממתינים סונכרנו'):Promise.resolve(true);resume.then(()=>syncDocument.cloudPoll())},250)}else if(cloudAuth.loadSession())setTimeout(syncChecks.pollSharedChecks,300);domainsFinanceController.startAutoSync()});
window.addEventListener('offline',()=>{if(cloudAuth.cloudEnabled())uiStatus.setCloud('ענן: אופליין','offline')});
window.addEventListener('pagehide',()=>{if(!tab.primaryTab)return;const ok=storageBrowser.localSnapshot();if(cloudAuth.cloudEnabled()&&ok&&stateSnapshots.cloudHasLocalWork())storageBrowser.markCloudPending();if(cloudAuth.loadSession()&&stateSnapshots.checksHaveLocalWork())storageChecks.markChecksPending()});
if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js').catch(console.error));}
document.getElementById('saveNowButton').addEventListener('click',storagePersistence.manualSaveNow);
document.getElementById('folderAccessButton').addEventListener('click',uiFolders.handleTopFolderAccess);
document.getElementById('retryPrimaryTab').addEventListener('click',uiTabGuard.retryPrimaryTabLock);
uiEvents.bindActionEvents(document.getElementById('main'),uiActions);
uiEvents.bindActionEvents(document.getElementById('modal'),uiActions);
uiGlobalSearch.bind();
domainsCalendarController.start();
export const appReady=lifecycle.boot();
