import { createLazyDeferredSearchUpdater } from '../../shared/search-scheduler.js';
import { markMutationActions } from '../../shared/action-registry.js';
export function createSuppliersActions({ domainsSuppliersBulk, domainsSuppliersEditor, domainsSuppliersNavigation, domainsSuppliersOrder, domainsSuppliersView, supplierUi }) {
  const supplierMenu = domainsSuppliersNavigation;
  const cancelSupplierMoveTarget = (...args) => domainsSuppliersBulk.cancelSupplierMoveTarget(...args);
  const deleteSelectedTransactions = (...args) => domainsSuppliersBulk.deleteSelectedTransactions(...args);
  const deleteTransaction = (...args) => domainsSuppliersEditor.deleteTransaction(...args);
  const filterSupplierSearch = (...args) => domainsSuppliersView.filterSupplierSearch(...args);
  const moveSupplierOrder = (...args) => domainsSuppliersOrder.moveSupplierOrder(...args);
  const openSelectedSupplierEditor = (...args) => domainsSuppliersEditor.openSelectedSupplierEditor(...args);
  const openSelectedSupplierMove = (...args) => domainsSuppliersBulk.openSelectedSupplierMove(...args);
  const openSelectedSupplierYearBoundary = (...args) => domainsSuppliersBulk.openSelectedSupplierYearBoundary(...args);
  const openSupplier = (...args) => domainsSuppliersNavigation.openSupplier(...args);
  const openSupplierModal = (...args) => domainsSuppliersEditor.openSupplierModal(...args);
  const openSupplierMoveConfirm = (...args) => domainsSuppliersBulk.openSupplierMoveConfirm(...args);
  const openSupplierOrderModal = (...args) => domainsSuppliersOrder.openSupplierOrderModal(...args);
  const openTransactionModal = (...args) => domainsSuppliersEditor.openTransactionModal(...args);
  const removeSupplierYearBoundary = (...args) => domainsSuppliersBulk.removeSupplierYearBoundary(...args);
  const renderSupplier = (...args) => domainsSuppliersView.renderSupplier(...args);
  const saveInlineText = (...args) => domainsSuppliersView.saveInlineText(...args);
  const saveSupplier = (...args) => domainsSuppliersEditor.saveSupplier(...args);
  const saveSupplierOrder = (...args) => domainsSuppliersOrder.saveSupplierOrder(...args);
  const saveSupplierYearBoundary = (...args) => domainsSuppliersBulk.saveSupplierYearBoundary(...args);
  const saveTransaction = (...args) => domainsSuppliersEditor.saveTransaction(...args);
  const setInlineTri = (...args) => domainsSuppliersView.setInlineTri(...args);
  const setSupplierYearView = (...args) => domainsSuppliersNavigation.setSupplierYearView(...args);
  const supplierOrderDragStart = (...args) => domainsSuppliersOrder.supplierOrderDragStart(...args);
  const supplierOrderDrop = (...args) => domainsSuppliersOrder.supplierOrderDrop(...args);
  const toggleSupplierBulkMode = (...args) => domainsSuppliersBulk.toggleSupplierBulkMode(...args);
  const toggleSupplierBulkRow = (...args) => domainsSuppliersBulk.toggleSupplierBulkRow(...args);
  const toggleSupplierBulkVisible = (...args) => domainsSuppliersBulk.toggleSupplierBulkVisible(...args);
  const supplierSearch = createLazyDeferredSearchUpdater(() => { }, filterSupplierSearch);
  const actions = {
    'open-selected-supplier-move': (element, event) => { return openSelectedSupplierMove(); },
    'open-supplier': (element, event) => { return openSupplier(element.dataset.clickArg0); },
    'save-supplier-order': (element, event) => { return saveSupplierOrder(); },
    'supplier-order-drag-start': (element, event) => { return supplierOrderDragStart(event, element.dataset.dragstartArg0, element); },
    'allow-drop': (element, event) => { return event.preventDefault(); },
    'supplier-order-drop': (element, event) => { return supplierOrderDrop(event, element.dataset.dropArg0); },
    'end-drag': (element, event) => { return element.classList.remove('dragging'); },
    'move-supplier-order': (element, event) => { return moveSupplierOrder(element.dataset.clickArg0, -1); },
    'move-supplier-order-2': (element, event) => { return moveSupplierOrder(element.dataset.clickArg0, 1); },
    'open-supplier-move-confirm': (element, event) => { return openSupplierMoveConfirm(element.dataset.clickArg0); },
    'save-supplier-year-boundary': (element, event) => { return saveSupplierYearBoundary(element.dataset.clickArg0); },
    'remove-supplier-year-boundary': (element, event) => { return removeSupplierYearBoundary(element.dataset.clickArg0); },
    'cancel-supplier-move-target': (element, event) => { return cancelSupplierMoveTarget(); },
    'toggle-supplier-menu': (element, event) => { return supplierMenu.toggleSupplierMenu(event); },
    'filter-supplier-menu': (element, event) => { return supplierMenu.filterSupplierMenu(element.value); },
    'supplier-menu-search-keydown': (element, event) => { return supplierMenu.supplierMenuSearchKeydown(event, element); },
    'stop-propagation': (element, event) => { return event.stopPropagation(); },
    'choose-supplier': (element, event) => { return supplierMenu.chooseSupplier(element.dataset.clickArg0); },
    'open-transaction-modal': (element, event) => { return openTransactionModal(null, element.dataset.clickArg0); },
    'set-supplier-year-view': (element, event) => { return setSupplierYearView(element.value); },
    'filter-supplier-search': (element, event) => { return supplierSearch(element.value, element); },
    'filter-mode': (element, event) => { supplierUi.filterMode = 'all'; return renderSupplier({ scrollMode: 'end' }); },
    'filter-mode-2': (element, event) => { supplierUi.filterMode = 'pending'; return renderSupplier({ scrollMode: 'end' }); },
    'filter-mode-3': (element, event) => { supplierUi.filterMode = 'invoice'; return renderSupplier({ scrollMode: 'end' }); },
    'toggle-supplier-bulk-mode': (element, event) => { return toggleSupplierBulkMode(); },
    'open-selected-supplier-year-boundary': (element, event) => { return openSelectedSupplierYearBoundary(); },
    'delete-selected-transactions': (element, event) => { return deleteSelectedTransactions(); },
    'toggle-supplier-bulk-visible': (element, event) => { return toggleSupplierBulkVisible(element.checked); },
    'set-inline-tri': (element, event) => { setInlineTri(element.dataset.clickArg0, element.dataset.clickArg1, true); return event.stopPropagation(); },
    'set-inline-tri-2': (element, event) => { setInlineTri(element.dataset.clickArg0, element.dataset.clickArg1, false); return event.stopPropagation(); },
    'toggle-supplier-bulk-row': (element, event) => { return toggleSupplierBulkRow(element.dataset.clickArg0, element.checked, !!event?.shiftKey); },
    'blur-input': (element, event) => { if (event.key === 'Enter') {
      return element.blur();
    } },
    'save-inline-text': (element, event) => { return saveInlineText(element.dataset.blurArg0, 'supplyInfo', element); },
    'save-inline-text-2': (element, event) => { return saveInlineText(element.dataset.blurArg0, 'note', element); },
    'open-transaction-modal-2': (element, event) => { return openTransactionModal(null, element.dataset.clickArg0, element.dataset.clickArg1); },
    'open-transaction-modal-3': (element, event) => { return openTransactionModal(element.dataset.clickArg0); },
    'save-transaction': (element, event) => { return saveTransaction(element.dataset.clickArg0, element.dataset.clickArg1); },
    'delete-transaction': (element, event) => { return deleteTransaction(element.dataset.clickArg0); },
    'save-supplier': (element, event) => { return saveSupplier(element.dataset.clickArg0); },
    'open-supplier-modal': (element, event) => { return openSupplierModal(); },
    'open-supplier-order-modal': (element, event) => { return openSupplierOrderModal(); },
    'open-selected-supplier-editor': (element, event) => { return openSelectedSupplierEditor(); },
  };
  return markMutationActions(actions,
    { orders: ['open-selected-supplier-move',
    'save-supplier-order',
    'supplier-order-drag-start',
    'supplier-order-drop',
    'move-supplier-order',
    'move-supplier-order-2',
    'open-supplier-move-confirm',
    'save-supplier-year-boundary',
    'remove-supplier-year-boundary',
    'open-transaction-modal',
    'open-selected-supplier-year-boundary',
    'delete-selected-transactions',
    'set-inline-tri',
    'set-inline-tri-2',
    'save-inline-text',
    'save-inline-text-2',
    'open-transaction-modal-2',
    'open-transaction-modal-3',
    'save-transaction',
    'delete-transaction',
    'save-supplier',
    'open-supplier-modal',
    'open-supplier-order-modal',
    'open-selected-supplier-editor'] });
}
