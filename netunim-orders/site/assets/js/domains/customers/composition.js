import {createDomainsCustomersBulk} from './bulk.js';
import {createDomainsCustomersView} from './view.js';
import {createDomainsCustomersEditor} from './editor.js';
import {createDomainsCustomersDocuments} from './documents.js';
import {createDomainsCustomersDocumentsBrowser} from './documents-browser.js';
import {createMorningMetadataPersistence} from './morning-metadata-persistence.js';

export function createDomainsCustomers({morningOperationScope,morningRequest,documentMedia,customerRevision,model,customerUi,selectors,uiLayout,uiModal,uiStatus,storagePersistence,uiNavigation,uiDateEditor,refreshForMorningRecovery,subscribeAccountScope,getBusinessBankTransactions,ensureBusinessBankTransactions,onBankDocumentVerified}){
  let view,editor,disposed=false;
  const metadataPersistence=createMorningMetadataPersistence({model,operationScope:morningOperationScope,commitSave:(...args)=>storagePersistence.commitSave(...args),canMutate:()=>storagePersistence.canMutate?.()!==false});
  const persistResolvedDebtDocumentMetadata=metadataPersistence.persist;
  if(typeof selectors?.customerStats!=='function')throw new TypeError('customers_selectors_required');
  const bulk=createDomainsCustomersBulk({
    customerUi,model,
    rejectDebtRecoveryMutation:(...args)=>documents.rejectDebtRecoveryMutation(...args),
    renderCustomers:(...args)=>view.renderCustomers(...args),
    toast:(...args)=>uiStatus.toast(...args),
    scheduleSave:(...args)=>storagePersistence.scheduleSave(...args),
    confirmDialog:(...args)=>uiModal.confirmDialog(...args),
    onTabChange:(tab)=>uiNavigation.setCustomerRoute(tab),
  });
  const documentsBrowser=createDomainsCustomersDocumentsBrowser({
    documentMedia,
    operationScope:morningOperationScope,
    subscribeAccountScope,
    modal:(...args)=>uiModal.modal(...args),
    toast:(...args)=>uiStatus.toast(...args),
    request:morningRequest,
    dateEditorMarkup:(...args)=>uiDateEditor.dateEditorMarkup(...args),
    onDebtDocumentMetadataResolved:persistResolvedDebtDocumentMetadata,
  });
  const documents=createDomainsCustomersDocuments({
    operationScope:morningOperationScope,
    subscribeAccountScope,
    model,
    refreshForMorningRecovery,
    modal:(...args)=>uiModal.modal(...args),
    toast:(...args)=>uiStatus.toast(...args),
    confirmDialog:(...args)=>uiModal.confirmDialog(...args),
    markModalDraftSaved:(...args)=>uiModal.markModalDraftSaved(...args),
    request:morningRequest,
    documentsBrowser,
    dateEditorMarkup:(...args)=>uiDateEditor.dateEditorMarkup(...args),
    setDateValue:(...args)=>uiDateEditor.setDateValue(...args),
    getBusinessBankTransactions:(...args)=>getBusinessBankTransactions?.(...args)||[],
    ensureBusinessBankTransactions:(...args)=>ensureBusinessBankTransactions?.(...args),
    rejectSecondaryIssuance:(...args)=>storagePersistence.rejectSecondaryAction(...args),
    rejectSecondaryMutation:(...args)=>storagePersistence.rejectSecondaryMutation(...args),
    applyVerifiedDebtDocument:(...args)=>{if(storagePersistence.rejectSecondaryMutation())return {changed:false,reason:'write-blocked'};return editor?.applyVerifiedMorningDocument(...args)||{changed:false,reason:'editor-unavailable'}},
    onBankDocumentVerified:(...args)=>onBankDocumentVerified?.(...args),
  });
  view=createDomainsCustomersView({
    customerRevision,
    model,customerUi,
    morningMetadataState:metadataPersistence.state,
    rejectDebtRecoveryMutation:(...args)=>documents.rejectDebtRecoveryMutation(...args),
    bindScrollViewport:(...args)=>uiLayout.bindScrollViewport(...args),
    mountViewLayout:(...args)=>uiLayout.mountViewLayout(...args),
    customerStats:(...args)=>selectors.customerStats(...args),
    customerBulkHeader:(...args)=>bulk.customerBulkHeader(...args),
    customerBulkControls:(...args)=>bulk.customerBulkControls(...args),
    syncCustomerBulkUi:(...args)=>bulk.syncCustomerBulkUi(...args),
    customerBottomSummary:(...args)=>bulk.customerBottomSummary(...args),
    customerBulkCell:(...args)=>bulk.customerBulkCell(...args),
    scheduleSave:(...args)=>storagePersistence.scheduleSave(...args),
    morningDocumentButton:(...args)=>documents.documentButton(...args),
    hydrateMorningDebtDocuments:(...args)=>documentsBrowser.hydrateDebtDocumentLinks(...args),
  });
  editor=createDomainsCustomersEditor({
    model,customerUi,
    morningMetadataState:metadataPersistence.state,
    isDebtRecoveryPending:(...args)=>documents.isDebtRecoveryPending(...args),
    rejectDebtRecoveryMutation:(...args)=>documents.rejectDebtRecoveryMutation(...args),
    modal:(...args)=>uiModal.modal(...args),
    toast:(...args)=>uiStatus.toast(...args),
    scheduleSave:(...args)=>storagePersistence.scheduleSave(...args),
    closeModal:(...args)=>uiModal.closeModal(...args),
    renderCustomers:(...args)=>view.renderCustomers(...args),
    confirmDialog:(...args)=>uiModal.confirmDialog(...args),
    hydrateMorningDebtDocuments:(...args)=>documentsBrowser.hydrateDebtDocumentLinks(...args),
  });
  function dispose(){if(disposed)return false;disposed=true;documents.dispose();documentsBrowser.dispose();return true}
  async function drain(){do{await Promise.all([documents.runtime.drain(),documentsBrowser.runtime.drain()])}while(documents.runtime.isPending()||documentsBrowser.runtime.isPending())}
  const runtime={dispose,drain,cancelPending:()=>{documents.runtime.cancelPending();documentsBrowser.runtime.cancelPending()},isPending:()=>documents.runtime.isPending()||documentsBrowser.runtime.isPending()};
  return {
    selectors,bulk,view,editor,documents,documentsBrowser,
    dispose,runtime,
    renderCustomers:(...args)=>view.renderCustomers(...args),
    openMorningDocuments:(...args)=>documentsBrowser.openDocuments(...args),
    searchMorningDocuments:(...args)=>documentsBrowser.search(...args),
    pageMorningDocuments:(...args)=>documentsBrowser.page(...args),
    openMorningInvoicePicker:(...args)=>documentsBrowser.openInvoicePicker(...args),
    selectMorningInvoice:(...args)=>documentsBrowser.selectInvoice(...args),
    morningDocumentDetails:(...args)=>documentsBrowser.details(...args),
    downloadMorningDocument:(...args)=>documentsBrowser.downloadDocument(...args),
    setCustomerTab:(...args)=>bulk.setCustomerTab(...args),
    toggleCustomerBulkMode:(...args)=>bulk.toggleCustomerBulkMode(...args),
    toggleCustomerBulkRow:(...args)=>bulk.toggleCustomerBulkRow(...args),
    toggleCustomerBulkVisible:(...args)=>bulk.toggleCustomerBulkVisible(...args),
    deleteSelectedCustomerRows:(...args)=>bulk.deleteSelectedCustomerRows(...args),
    addCustomerOrder:(...args)=>editor.addCustomerOrder(...args),
    saveCustomerOrderField:(...args)=>editor.saveCustomerOrderField(...args),
    deleteCustomerOrder:(...args)=>editor.deleteCustomerOrder(...args),
    setCustomerFlag:(...args)=>view.setCustomerFlag(...args),
    saveDebtField:(...args)=>view.saveDebtField(...args),
    openDebtModal:(...args)=>editor.openDebtModal(...args),
    openDebtProgressDetails:(...args)=>editor.openDebtProgressDetails(...args),
    saveDebt:(...args)=>editor.saveDebt(...args),
    deleteDebt:(...args)=>editor.deleteDebt(...args),
    openMorningDocument:(...args)=>documents.openMorningDocument(...args),
    openStandaloneMorningDocument:(...args)=>documents.openStandaloneMorningDocument(...args),
    openBankMorningDocument:(...args)=>documents.openBankMorningDocument(...args),
    linkBankMorningDebt:(...args)=>documents.linkBankDebt(...args),
    filterBankMorningDebts:(...args)=>documents.filterBankDebtPicker(...args),
    linkMorningBankTransaction:(...args)=>documents.linkBankTransaction(...args),
    clearMorningBankTransaction:(...args)=>documents.clearBankTransactionLink(...args),
    filterMorningBankTransactions:(...args)=>documents.filterBankTransactionPicker(...args),
    addMorningPayment:(...args)=>documents.addMorningPayment(...args),
    removeMorningPayment:(...args)=>documents.removeMorningPayment(...args),
    syncMorningPaymentTotal:(...args)=>documents.syncPaymentTotal(...args),
    syncMorningDocumentType:(...args)=>documents.syncDocumentType(...args),
    syncMorningPaymentType:(...args)=>documents.syncPaymentType(...args),
    syncMorningPaymentBank:(...args)=>documents.syncPaymentBank(...args),
    previewMorningDocument:(...args)=>documents.previewMorningDocument(...args),
    createMorningDocument:(...args)=>documents.createMorningDocument(...args),
    openMorningExistingDocument:(...args)=>documents.openExistingDocument(...args),
    reconcileMorningDocument:(...args)=>documents.reconcile(...args),
    recoverPendingMorningOperation:(...args)=>documents.recoverPendingMorningOperation(...args),
    saveMorningRecoveryChoice:(...args)=>documents.saveRecoveryChoice(...args),
    confirmMorningRecoveryChoice:(...args)=>documents.confirmRecoveryChoice(...args),
  };
}
