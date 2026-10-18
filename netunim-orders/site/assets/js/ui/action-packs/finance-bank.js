import { createLazyDeferredSearchUpdater } from '../../shared/search-scheduler.js';
import { markMutationActions } from '../../shared/action-registry.js';
export function createFinanceBankActions({ domainsFinanceController, domainsFinanceView, importFinanceConnections, ui, uiStatus }) {
  const acknowledgeOrdersBankMissing = (...args) => domainsFinanceView.acknowledgeBankMissing(...args);
  const configureOrdersBank = (...args) => domainsFinanceView.configureBank(...args);
  const createOrdersBankDocument = (...args) => domainsFinanceView.createBankDocument(...args);
  const deleteOrdersBankCredentials = (...args) => domainsFinanceView.deleteBankCredentials(...args);
  const exportOrdersBankChequeDiagnostics = (...args) => domainsFinanceView.exportBankChequeDiagnostics(...args);
  const openOrdersBankChequeImage = (...args) => domainsFinanceView.openBankChequeImage(...args).catch(error => uiStatus.toast(error?.message || String(error)));
  const openOrdersCashflowBreakdown = (...args) => domainsFinanceView.openCashflowBreakdown(...args);
  const refreshOrdersBank = (...args) => domainsFinanceView.refreshBank(...args);
  const saveOrdersBankToken = (...args) => domainsFinanceView.saveBankToken(...args);
  const saveOrdersCashflowMinimum = (...args) => domainsFinanceController.saveCashflowMinimum(...args);
  const selectOrdersBankAccount = (...args) => domainsFinanceView.selectBankAccount(...args);
  const setKupaSection = (...args) => domainsFinanceView.setKupaSection(...args);
  const setOrdersBankAccountView = (...args) => domainsFinanceView.setBankAccountView(...args);
  const setOrdersBankAuto = (...args) => domainsFinanceView.setBankAuto(...args);
  const setOrdersBankDataView = (...args) => domainsFinanceView.setBankDataView(...args);
  const setOrdersBankDateMode = (...args) => domainsFinanceView.setBankDateMode(...args);
  const setOrdersBankSearch = (...args) => domainsFinanceView.setBankSearch(...args);
  const setOrdersBankTransactionHandled = (...args) => domainsFinanceView.setBankTransactionHandled(...args);
  const toggleOrdersBankSyncOptions = (...args) => domainsFinanceView.toggleBankSyncOptions(...args);
  const bankSearch = createLazyDeferredSearchUpdater(value => { ui.bankSearchValue = value; }, setOrdersBankSearch);
  const actions = {
    'orders-cashflow-breakdown': element => openOrdersCashflowBreakdown(element.dataset.clickArg0),
    'orders-cashflow-breakdown-date': element => { return openOrdersCashflowBreakdown(element.dataset.changeArg0, element.value, element); },
    'set-kupa-section': (element, event) => { return setKupaSection(element.dataset.clickArg0); },
    'set-orders-bank-account-view': (element, event) => { return setOrdersBankAccountView(element.dataset.clickArg0); },
    'set-orders-bank-data-view': (element, event) => { return setOrdersBankDataView(element.dataset.clickArg0); },
    'orders-bank-handled': (element, event) => { event?.preventDefault(); event?.stopPropagation(); return setOrdersBankTransactionHandled(Number(element.dataset.clickArg0), element.dataset.clickArg1 === 'true'); },
    'orders-bank-create-document': (element, event) => { event?.preventDefault(); event?.stopPropagation(); return createOrdersBankDocument(Number(element.dataset.clickArg0), Number(element.dataset.clickArg1)); },
    'view-orders-bank-cheque-image': (element, event) => { event?.preventDefault(); event?.stopPropagation(); return openOrdersBankChequeImage(element.dataset.clickArg0, element.dataset.clickArg1, element.dataset.clickArg2); },
    'ack-orders-bank-missing': (element, event) => { event?.preventDefault(); event?.stopPropagation(); return acknowledgeOrdersBankMissing(Number(element.dataset.clickArg0)); },
    'orders-bank-search': (element, event) => { return bankSearch(element.value, element); },
    'orders-bank-date-mode': (element, event) => { return setOrdersBankDateMode(element.dataset.clickArg0 || element.value); },
    'orders-bank-date-apply': (element, event) => { const host = element.closest('.bank-date-filter'); return setOrdersBankDateMode('range', host?.querySelector('[data-bank-date-from]')?.value || '', host?.querySelector('[data-bank-date-to]')?.value || ''); },
    'toggle-orders-bank-sync-options': (element, event) => { return toggleOrdersBankSyncOptions(); },
    'save-orders-bank-token': (element, event) => { return saveOrdersBankToken(); },
    'configure-orders-bank': (element, event) => { return configureOrdersBank(); },
    'import-orders-finance-connections': (element, event) => { event?.preventDefault(); event?.stopPropagation(); return importFinanceConnections(); },
    'select-orders-bank-account': (element, event) => { return selectOrdersBankAccount(element.dataset.clickArg0, element.dataset.clickArg1, element.dataset.clickArg2); },
    'delete-orders-bank-credentials': (element, event) => { return deleteOrdersBankCredentials(); },
    'export-orders-bank-cheque-diagnostics': (element, event) => { event?.preventDefault(); event?.stopPropagation(); return exportOrdersBankChequeDiagnostics(); },
    'refresh-orders-bank': (element, event) => { return refreshOrdersBank(false); },
    'refresh-orders-bank-interactive': (element, event) => { return refreshOrdersBank(true); },
    'set-orders-bank-auto': (element, event) => { return setOrdersBankAuto(element.checked); },
    'orders-cashflow-minimum': (element, event) => { return saveOrdersCashflowMinimum(element.dataset.changeArg0, element.value); },
  };
  return markMutationActions(actions, { finance: ['orders-bank-handled', 'save-orders-bank-token', 'configure-orders-bank', 'import-orders-finance-connections', 'select-orders-bank-account', 'delete-orders-bank-credentials', 'refresh-orders-bank', 'refresh-orders-bank-interactive', 'set-orders-bank-auto', 'orders-cashflow-minimum'] });
}
