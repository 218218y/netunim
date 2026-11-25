import {createDomainsCustomersBulk} from './bulk.js';
import {createDomainsCustomersView} from './view.js';
import {createDomainsCustomersEditor,updateDebtNote,updateDebtUrgency} from './editor.js';
import {createDomainsCustomersDocuments} from './documents.js';
import {createDomainsCustomersDocumentsBrowser} from './documents-browser.js';
import {createMorningMetadataPersistence} from './morning-metadata-persistence.js';
import {loadMorningDebtRecoveryContext} from './morning-debt-recovery.js';

export function createDomainsCustomers({
  morningOperationScope,morningRequest,contactsRequest,documentMedia,customerRevision,model,customerUi,selectors,
  uiLayout,uiModal,uiStatus,storagePersistence,uiNavigation,uiDateEditor,reminderPicker,refreshAlertCenter=()=>{},
  refreshForMorningRecovery,subscribeAccountScope,getBusinessBankTransactions,ensureBusinessBankTransactions,onBankDocumentVerified,
}){
  let view,editor,disposed=false;
  function scheduleSave(message,options){
    const saved=storagePersistence.scheduleSave(message,options);
    if(options?.domains?.includes('customerDebts'))refreshAlertCenter();
    return saved;
  }
  const metadataPersistence=createMorningMetadataPersistence({model,operationScope:morningOperationScope,commitSave:(...args)=>storagePersistence.commitSave(...args),canMutate:()=>storagePersistence.canMutate?.()!==false});
  const persistResolvedDebtDocumentMetadata=metadataPersistence.persist;
  if(typeof selectors?.customerStats!=='function')throw new TypeError('customers_selectors_required');
  const bulk=createDomainsCustomersBulk({
    customerUi,model,
    rejectDebtRecoveryMutation:(...args)=>documents.rejectDebtRecoveryMutation(...args),
    renderCustomers:(...args)=>view.renderCustomers(...args),
    toast:(...args)=>uiStatus.toast(...args),
    scheduleSave,
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
    clearRecoveryNotice:id=>uiStatus.clearNotice?.(id),
    debtNotes:{
      updateNote:(debt,note)=>updateDebtNote(debt,note,scheduleSave),
      updateUrgency:(debt,note)=>updateDebtUrgency(debt,note,scheduleSave),
    },
    onDebtNotesChanged:()=>view.refreshDebtTable(),
    request:morningRequest,
    contactsRequest,
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
    scheduleSave,
    morningDocumentButton:(...args)=>documents.documentButton(...args),
    hydrateMorningDebtDocuments:(...args)=>documentsBrowser.hydrateDebtDocumentLinks(...args),
  });
  editor=createDomainsCustomersEditor({
    model,customerUi,reminderPicker,
    rejectMutation:()=>storagePersistence.rejectSecondaryMutation(),
    morningMetadataState:metadataPersistence.state,
    isDebtRecoveryPending:(...args)=>documents.isDebtRecoveryPending(...args),
    rejectDebtRecoveryMutation:(...args)=>documents.rejectDebtRecoveryMutation(...args),
    modal:(...args)=>uiModal.modal(...args),
    toast:(...args)=>uiStatus.toast(...args),
    scheduleSave,
    commitSave:async(message,options)=>{
      const saved=await storagePersistence.commitSave(message,options);
      if(saved)refreshAlertCenter();
      return saved;
    },
    closeModal:(...args)=>uiModal.closeModal(...args),
    renderCustomers:(...args)=>view.renderCustomers(...args),
    confirmDialog:(...args)=>uiModal.confirmDialog(...args),
    hydrateMorningDebtDocuments:(...args)=>documentsBrowser.hydrateDebtDocumentLinks(...args),
  });
  function dispose(){if(disposed)return false;disposed=true;documents.dispose();documentsBrowser.dispose();return true}
  async function drain(){do{await Promise.all([documents.runtime.drain(),documentsBrowser.runtime.drain()])}while(documents.runtime.isPending()||documentsBrowser.runtime.isPending())}
  const runtime={dispose,drain,cancelPending:()=>{documents.runtime.cancelPending();documentsBrowser.runtime.cancelPending()},isPending:()=>documents.runtime.isPending()||documentsBrowser.runtime.isPending()};
  const morningOperationCenter={
    async recoverLocal(operationId,row){
      const local=loadMorningDebtRecoveryContext();
      if(!storagePersistence.canMutate())return row?.debt_state==='pending'?{state:'write-blocked'}:null;
      if(local?.operationId!==operationId){
        if(row?.debt_state!=='pending'||!row.verified_at)return null;
        if(local)return {state:'other-local-recovery'};
        const adopted=await documents.adoptSharedDebtRecovery(operationId);
        if(!adopted)return null;
      }
      const result=await documents.recoverPendingMorningOperation({expectedOperationId:operationId,retryChecks:true,quiet:false});
      if(result.state==='unavailable')throw result.error;
      if(result.result?.reason==='decision-required')return {state:'decision-required'};
      if(['write-blocked','missing-debt','conflicting-recovery','verification-mismatch','decision-changed'].includes(result.result?.reason))
        return {state:result.result.reason};
      if(result.status?.check_retry&&['cooldown','busy','failed'].includes(result.status.check_retry.state))return result.status.check_retry;
      if(result.status?.checks_registration_pending)return {state:'verification'};
      if(result.status?.bank_link_pending)return {state:'bank_link'};
      if(result.state==='created'&&row?.debt_state==='pending'&&!['cloud-complete','historical-receipt'].includes(result.result?.reason))
        return {state:'debt-sync-pending'};
      return {state:result.state};
    },
    debtAction(row){
      const context=loadMorningDebtRecoveryContext();
      const debt=(model.state.customerDebts||[]).find(item=>(context?.operationId===row.operation_id&&context.debtId===item.id)
        ||item.morningDocuments?.some(link=>link.operationId===row.operation_id));
      if(row.debt_state==='pending'&&row.verified_at)return async()=>{
        const active=loadMorningDebtRecoveryContext();
        if(active&&active.operationId!==row.operation_id){uiStatus.toast('פעולת מורנינג אחרת עדיין ממתינה בעמדה זו.');return}
        const selected=active||await documents.adoptSharedDebtRecovery(row.operation_id);
        if(selected?.debtId)await documents.openDebtRecovery(selected);
        else uiStatus.toast('יש לרענן את מצב הפעולה בענן.');
      };
      return debt?()=>editor.openDebtProgressDetails(debt.id):null;
    },
  };
  return {
    selectors,bulk,view,editor,documents,documentsBrowser,
    dispose,runtime,morningOperationCenter,
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
    openDebtUrgency:(...args)=>editor.openDebtUrgency(...args),
    openDebtUrgencyReminder:(...args)=>editor.openDebtUrgencyReminder(...args),
    saveDebtUrgency:(...args)=>editor.saveDebtUrgency(...args),
    removeDebtUrgencyReminder:(...args)=>editor.removeDebtUrgencyReminder(...args),
    openDebtProgressDetails:(...args)=>editor.openDebtProgressDetails(...args),
    removeDebtProgressEntry:(...args)=>editor.removeDebtProgressEntry(...args),
    saveDebt:(...args)=>editor.saveDebt(...args),
    deleteDebt:(...args)=>editor.deleteDebt(...args),
    openMorningDocument:(...args)=>documents.openMorningDocument(...args),
    openStandaloneMorningDocument:(...args)=>documents.openStandaloneMorningDocument(...args),
    toggleMorningEmailLookup:(...args)=>documents.toggleEmailLookup(...args),
    openBankMorningDocument:(...args)=>documents.openBankMorningDocument(...args),
    linkBankMorningDebt:(...args)=>documents.linkBankDebt(...args),
    morningDebtNote:(...args)=>documents.debtNote(...args),
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
