import {createDomainsCustomersSelectors} from './selectors.js';
import {createDomainsCustomersBulk} from './bulk.js';
import {createDomainsCustomersView} from './view.js';
import {createDomainsCustomersEditor} from './editor.js';
import {createDomainsCustomersDocuments} from './documents.js';

export function createDomainsCustomers({model,customerUi,uiLayout,uiModal,uiStatus,storagePersistence,cloudAuth,uiNavigation,uiDateEditor}){
  let view;
  const selectors=createDomainsCustomersSelectors({model});
  const bulk=createDomainsCustomersBulk({
    customerUi,model,
    renderCustomers:(...args)=>view.renderCustomers(...args),
    toast:(...args)=>uiStatus.toast(...args),
    scheduleSave:(...args)=>storagePersistence.scheduleSave(...args),
    confirmDialog:(...args)=>uiModal.confirmDialog(...args),
    onTabChange:(tab)=>uiNavigation.setCustomerRoute(tab),
  });
  const documents=createDomainsCustomersDocuments({
    model,
    modal:(...args)=>uiModal.modal(...args),
    toast:(...args)=>uiStatus.toast(...args),
    confirmDialog:(...args)=>uiModal.confirmDialog(...args),
    supaFetch:(...args)=>cloudAuth.supaFetch(...args),
    scheduleSave:(...args)=>storagePersistence.scheduleSave(...args),
    renderCustomers:(...args)=>view.renderCustomers(...args),
    dateEditorMarkup:(...args)=>uiDateEditor.dateEditorMarkup(...args),
  });
  view=createDomainsCustomersView({
    model,customerUi,
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
  const editor=createDomainsCustomersEditor({
    model,customerUi,
    modal:(...args)=>uiModal.modal(...args),
    toast:(...args)=>uiStatus.toast(...args),
    scheduleSave:(...args)=>storagePersistence.scheduleSave(...args),
    closeModal:(...args)=>uiModal.closeModal(...args),
    renderCustomers:(...args)=>view.renderCustomers(...args),
    confirmDialog:(...args)=>uiModal.confirmDialog(...args),
  });
  return {selectors,bulk,view,editor,documents};
}
