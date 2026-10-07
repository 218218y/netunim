import {markMutationActions} from '../../shared/action-registry.js';

export function createMorningActions({domainsCustomers}){
const addMorningPayment=(...args)=>domainsCustomers.addMorningPayment(...args);
const clearMorningBankTransaction=(...args)=>domainsCustomers.clearMorningBankTransaction(...args);
const confirmMorningRecoveryChoice=(...args)=>domainsCustomers.confirmMorningRecoveryChoice(...args);
const createMorningDocument=(...args)=>domainsCustomers.createMorningDocument(...args);
const downloadMorningDocument=(...args)=>domainsCustomers.downloadMorningDocument(...args);
const filterBankMorningDebts=(...args)=>domainsCustomers.filterBankMorningDebts(...args);
const filterMorningBankTransactions=(...args)=>domainsCustomers.filterMorningBankTransactions(...args);
const linkBankMorningDebt=(...args)=>domainsCustomers.linkBankMorningDebt(...args);
const linkMorningBankTransaction=(...args)=>domainsCustomers.linkMorningBankTransaction(...args);
const morningDocumentDetails=(...args)=>domainsCustomers.morningDocumentDetails(...args);
const openMorningDocument=(...args)=>domainsCustomers.openMorningDocument(...args);
const openMorningDocuments=(...args)=>domainsCustomers.openMorningDocuments(...args);
const openMorningExistingDocument=(...args)=>domainsCustomers.openMorningExistingDocument(...args);
const openMorningInvoicePicker=(...args)=>domainsCustomers.openMorningInvoicePicker(...args);
const openStandaloneMorningDocument=(...args)=>domainsCustomers.openStandaloneMorningDocument(...args);
const pageMorningDocuments=(...args)=>domainsCustomers.pageMorningDocuments(...args);
const previewMorningDocument=(...args)=>domainsCustomers.previewMorningDocument(...args);
const reconcileMorningDocument=(...args)=>domainsCustomers.reconcileMorningDocument(...args);
const removeMorningPayment=(...args)=>domainsCustomers.removeMorningPayment(...args);
const saveMorningRecoveryChoice=(...args)=>domainsCustomers.saveMorningRecoveryChoice(...args);
const searchMorningDocuments=(...args)=>domainsCustomers.searchMorningDocuments(...args);
const selectMorningInvoice=(...args)=>domainsCustomers.selectMorningInvoice(...args);
const syncMorningDocumentType=(...args)=>domainsCustomers.syncMorningDocumentType(...args);
const syncMorningPaymentBank=(...args)=>domainsCustomers.syncMorningPaymentBank(...args);
const syncMorningPaymentTotal=(...args)=>domainsCustomers.syncMorningPaymentTotal(...args);
const syncMorningPaymentType=(...args)=>domainsCustomers.syncMorningPaymentType(...args);
const actions={
  'open-morning-document':(element,event)=>{openMorningDocument(element.dataset.clickArg0)},
  'open-morning-standalone':(element,event)=>{openStandaloneMorningDocument()},
  'morning-document-type':(element,event)=>{syncMorningDocumentType()},
  'morning-payment-type':(element,event)=>{syncMorningPaymentType(element.dataset.changeArg0===''||element.dataset.changeArg0===undefined?null:Number(element.dataset.changeArg0))},
  'morning-payment-bank':(element,event)=>{syncMorningPaymentBank(Number(element.dataset.changeArg0))},
  'morning-payment-add':(element,event)=>{addMorningPayment()},
  'morning-payment-remove':(element,event)=>{removeMorningPayment(Number(element.dataset.clickArg0))},
  'morning-payment-amount':(element,event)=>{syncMorningPaymentTotal()},
  'morning-document-amount':(element,event)=>{syncMorningPaymentTotal()},
  'morning-bank-debt-select':(element,event)=>{linkBankMorningDebt(element.dataset.clickArg0)},
  'morning-bank-debt-clear':(element,event)=>{linkBankMorningDebt('')},
  'morning-bank-debt-search':(element,event)=>{filterBankMorningDebts(element.value)},
  'morning-bank-transaction-select':(element,event)=>{linkMorningBankTransaction(element.dataset.clickArg0)},
  'morning-bank-transaction-clear':()=>{clearMorningBankTransaction()},
  'morning-bank-transaction-search':(element,event)=>{filterMorningBankTransactions(element.value)},
  'morning-preview':(element,event)=>{previewMorningDocument(element)},
  'morning-create':(element,event)=>{createMorningDocument(element)},
  'morning-open-document':(element,event)=>{openMorningExistingDocument(element.dataset.clickArg0,element,element.dataset.clickArg1)},
  'open-morning-documents':()=>{openMorningDocuments()},
  'morning-search':()=>{searchMorningDocuments()},
  'morning-refresh':()=>{searchMorningDocuments(true)},
  'morning-search-enter':(element,event)=>{if(event.key==='Enter'){event.preventDefault();searchMorningDocuments()}},
  'morning-page':(element)=>{pageMorningDocuments(element.dataset.clickArg0)},
  'morning-invoice-picker':()=>{openMorningInvoicePicker()},
  'morning-select-invoice':(element)=>{selectMorningInvoice(element.dataset.clickArg0)},
  'morning-details':(element)=>{morningDocumentDetails(element.dataset.clickArg0,element)},
  'morning-browser-view':(element)=>{openMorningExistingDocument(element.dataset.clickArg0,element)},
  'morning-download':(element)=>{downloadMorningDocument(element.dataset.clickArg0,element)},
  'morning-reconcile':(element,event)=>{reconcileMorningDocument(element)},
  'morning-recovery-choice':(element,event)=>{saveMorningRecoveryChoice()},
  'morning-recovery-confirm':(element,event)=>{confirmMorningRecoveryChoice(element)},
};
return markMutationActions(actions,{orders:['open-morning-document', 'open-morning-standalone', 'morning-create']});
}
