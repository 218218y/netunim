import {createDomainsCustomersSelectors} from './selectors.js';
import {createDomainsCustomersBulk} from './bulk.js';
import {createDomainsCustomersView} from './view.js';
import {createDomainsCustomersEditor} from './editor.js';
import {createDomainsCustomersDocuments} from './documents.js';
import {createDomainsCustomersDocumentsBrowser} from './documents-browser.js';

export function createDomainsCustomers({model,customerUi,uiLayout,uiModal,uiStatus,storagePersistence,cloudAuth,uiNavigation,uiDateEditor}){
  let view,editor;
  const selectors=createDomainsCustomersSelectors({model});
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
    modal:(...args)=>uiModal.modal(...args),
    toast:(...args)=>uiStatus.toast(...args),
    supaFetch:(...args)=>cloudAuth.supaFetch(...args),
    dateEditorMarkup:(...args)=>uiDateEditor.dateEditorMarkup(...args),
  });
  const documents=createDomainsCustomersDocuments({
    model,
    modal:(...args)=>uiModal.modal(...args),
    toast:(...args)=>uiStatus.toast(...args),
    confirmDialog:(...args)=>uiModal.confirmDialog(...args),
    markModalDraftSaved:(...args)=>uiModal.markModalDraftSaved(...args),
    supaFetch:(...args)=>cloudAuth.supaFetch(...args),
    documentsBrowser,
    dateEditorMarkup:(...args)=>uiDateEditor.dateEditorMarkup(...args),
    rejectSecondaryIssuance:(...args)=>storagePersistence.rejectSecondaryAction(...args),
    rejectSecondaryMutation:(...args)=>storagePersistence.rejectSecondaryMutation(...args),
    applyVerifiedDebtDocument:(...args)=>{if(storagePersistence.rejectSecondaryMutation())return {changed:false,reason:'write-blocked'};return editor?.applyVerifiedMorningDocument(...args)||{changed:false,reason:'editor-unavailable'}},
  });
  view=createDomainsCustomersView({
    model,customerUi,
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
  });
  editor=createDomainsCustomersEditor({
    model,customerUi,
    isDebtRecoveryPending:(...args)=>documents.isDebtRecoveryPending(...args),
    rejectDebtRecoveryMutation:(...args)=>documents.rejectDebtRecoveryMutation(...args),
    modal:(...args)=>uiModal.modal(...args),
    toast:(...args)=>uiStatus.toast(...args),
    scheduleSave:(...args)=>storagePersistence.scheduleSave(...args),
    closeModal:(...args)=>uiModal.closeModal(...args),
    renderCustomers:(...args)=>view.renderCustomers(...args),
    confirmDialog:(...args)=>uiModal.confirmDialog(...args),
  });
  return {
    selectors,bulk,view,editor,documents,documentsBrowser,
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
    saveDebtNote:(...args)=>view.saveDebtNote(...args),
    openDebtModal:(...args)=>editor.openDebtModal(...args),
    openDebtProgressDetails:(...args)=>editor.openDebtProgressDetails(...args),
    saveDebt:(...args)=>editor.saveDebt(...args),
    deleteDebt:(...args)=>editor.deleteDebt(...args),
    openMorningDocument:(...args)=>documents.openMorningDocument(...args),
    openStandaloneMorningDocument:(...args)=>documents.openStandaloneMorningDocument(...args),
    syncMorningDocumentType:(...args)=>documents.syncDocumentType(...args),
    syncMorningPaymentType:(...args)=>documents.syncPaymentType(...args),
    previewMorningDocument:(...args)=>documents.previewMorningDocument(...args),
    createMorningDocument:(...args)=>documents.createMorningDocument(...args),
    openMorningExistingDocument:(...args)=>documents.openExistingDocument(...args),
    reconcileMorningDocument:(...args)=>documents.reconcile(...args),
    recoverPendingMorningOperation:(...args)=>documents.recoverPendingMorningOperation(...args),
  };
}
