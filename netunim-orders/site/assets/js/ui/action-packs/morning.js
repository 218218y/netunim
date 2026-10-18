import { markMutationActions } from '../../shared/action-registry.js';
export function createMorningActions({ domainsCustomers }) {
  const addMorningPayment = (...args) => domainsCustomers.addMorningPayment(...args);
  const clearMorningBankTransaction = (...args) => domainsCustomers.clearMorningBankTransaction(...args);
  const confirmMorningRecoveryChoice = (...args) => domainsCustomers.confirmMorningRecoveryChoice(...args);
  const createMorningDocument = (...args) => domainsCustomers.createMorningDocument(...args);
  const downloadMorningDocument = (...args) => domainsCustomers.downloadMorningDocument(...args);
  const filterBankMorningDebts = (...args) => domainsCustomers.filterBankMorningDebts(...args);
  const filterMorningBankTransactions = (...args) => domainsCustomers.filterMorningBankTransactions(...args);
  const linkBankMorningDebt = (...args) => domainsCustomers.linkBankMorningDebt(...args);
  const linkMorningBankTransaction = (...args) => domainsCustomers.linkMorningBankTransaction(...args);
  const morningDocumentDetails = (...args) => domainsCustomers.morningDocumentDetails(...args);
  const openMorningDocument = (...args) => domainsCustomers.openMorningDocument(...args);
  const openMorningDocuments = (...args) => domainsCustomers.openMorningDocuments(...args);
  const openMorningExistingDocument = (...args) => domainsCustomers.openMorningExistingDocument(...args);
  const openMorningInvoicePicker = (...args) => domainsCustomers.openMorningInvoicePicker(...args);
  const openStandaloneMorningDocument = (...args) => domainsCustomers.openStandaloneMorningDocument(...args);
  const pageMorningDocuments = (...args) => domainsCustomers.pageMorningDocuments(...args);
  const previewMorningDocument = (...args) => domainsCustomers.previewMorningDocument(...args);
  const reconcileMorningDocument = (...args) => domainsCustomers.reconcileMorningDocument(...args);
  const removeMorningPayment = (...args) => domainsCustomers.removeMorningPayment(...args);
  const saveMorningRecoveryChoice = (...args) => domainsCustomers.saveMorningRecoveryChoice(...args);
  const searchMorningDocuments = (...args) => domainsCustomers.searchMorningDocuments(...args);
  const selectMorningInvoice = (...args) => domainsCustomers.selectMorningInvoice(...args);
  const syncMorningDocumentType = (...args) => domainsCustomers.syncMorningDocumentType(...args);
  const syncMorningPaymentBank = (...args) => domainsCustomers.syncMorningPaymentBank(...args);
  const syncMorningPaymentTotal = (...args) => domainsCustomers.syncMorningPaymentTotal(...args);
  const syncMorningPaymentType = (...args) => domainsCustomers.syncMorningPaymentType(...args);
  const actions = {
    'open-morning-document': (element, event) => { return openMorningDocument(element.dataset.clickArg0); },
    'open-morning-standalone': (element, event) => { return openStandaloneMorningDocument(); },
    'morning-document-type': (element, event) => { return syncMorningDocumentType(); },
    'morning-payment-type': (element, event) => { return syncMorningPaymentType(element.dataset.changeArg0 === '' || element.dataset.changeArg0 === undefined ? null : Number(element.dataset.changeArg0)); },
    'morning-payment-bank': (element, event) => { return syncMorningPaymentBank(Number(element.dataset.changeArg0)); },
    'morning-payment-add': (element, event) => { return addMorningPayment(); },
    'morning-payment-remove': (element, event) => { return removeMorningPayment(Number(element.dataset.clickArg0)); },
    'morning-payment-amount': (element, event) => { return syncMorningPaymentTotal(); },
    'morning-document-amount': (element, event) => { return syncMorningPaymentTotal(); },
    'morning-bank-debt-select': (element, event) => { return linkBankMorningDebt(element.dataset.clickArg0); },
    'morning-bank-debt-clear': (element, event) => { return linkBankMorningDebt(''); },
    'morning-bank-debt-search': (element, event) => { return filterBankMorningDebts(element.value); },
    'morning-bank-transaction-select': (element, event) => { return linkMorningBankTransaction(element.dataset.clickArg0); },
    'morning-bank-transaction-clear': () => { return clearMorningBankTransaction(); },
    'morning-bank-transaction-search': (element, event) => { return filterMorningBankTransactions(element.value); },
    'morning-preview': (element, event) => { return previewMorningDocument(element); },
    'morning-create': (element, event) => { return createMorningDocument(element); },
    'morning-open-document': (element, event) => { return openMorningExistingDocument(element.dataset.clickArg0, element, element.dataset.clickArg1); },
    'open-morning-documents': () => { return openMorningDocuments(); },
    'morning-search': () => { return searchMorningDocuments(); },
    'morning-refresh': () => { return searchMorningDocuments(true); },
    'morning-search-enter': (element, event) => { if (event.key === 'Enter') {
      event.preventDefault();
      return searchMorningDocuments();
    } },
    'morning-page': (element) => { return pageMorningDocuments(element.dataset.clickArg0); },
    'morning-invoice-picker': () => { return openMorningInvoicePicker(); },
    'morning-select-invoice': (element) => { return selectMorningInvoice(element.dataset.clickArg0); },
    'morning-details': (element) => { return morningDocumentDetails(element.dataset.clickArg0, element); },
    'morning-browser-view': (element) => { return openMorningExistingDocument(element.dataset.clickArg0, element); },
    'morning-download': (element) => { return downloadMorningDocument(element.dataset.clickArg0, element); },
    'morning-reconcile': (element, event) => { return reconcileMorningDocument(element); },
    'morning-recovery-choice': (element, event) => { return saveMorningRecoveryChoice(); },
    'morning-recovery-confirm': (element, event) => { return confirmMorningRecoveryChoice(element); },
  };
  return markMutationActions(actions, { orders: ['open-morning-document', 'open-morning-standalone', 'morning-create'] });
}
