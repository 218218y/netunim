import {createLazyDeferredSearchUpdater} from '../../shared/search-scheduler.js';
import {markMutationActions} from '../../shared/action-registry.js';

export function createCustomersActions({customerUi,domainsCustomers}){
const addCustomerOrder=(...args)=>domainsCustomers.addCustomerOrder(...args);
const deleteCustomerOrder=(...args)=>domainsCustomers.deleteCustomerOrder(...args);
const deleteDebt=(...args)=>domainsCustomers.deleteDebt(...args);
const deleteSelectedCustomerRows=(...args)=>domainsCustomers.deleteSelectedCustomerRows(...args);
const openDebtModal=(...args)=>domainsCustomers.openDebtModal(...args);
const openDebtProgressDetails=(...args)=>domainsCustomers.openDebtProgressDetails(...args);
const pageCustomerResults=(...args)=>domainsCustomers.view.pageCustomerResults(...args);
const renderCustomers=(...args)=>domainsCustomers.renderCustomers(...args);
const saveCustomerOrderField=(...args)=>domainsCustomers.saveCustomerOrderField(...args);
const saveDebt=(...args)=>domainsCustomers.saveDebt(...args);
const saveDebtField=(...args)=>domainsCustomers.saveDebtField(...args);
const setCustomerFlag=(...args)=>domainsCustomers.setCustomerFlag(...args);
const setCustomerTab=(...args)=>domainsCustomers.setCustomerTab(...args);
const toggleCustomerBulkMode=(...args)=>domainsCustomers.toggleCustomerBulkMode(...args);
const toggleCustomerBulkRow=(...args)=>domainsCustomers.toggleCustomerBulkRow(...args);
const toggleCustomerBulkVisible=(...args)=>domainsCustomers.toggleCustomerBulkVisible(...args);
const customerSearch=createLazyDeferredSearchUpdater(value=>{customerUi.customerSearch=value},()=>renderCustomers({resultsOnly:true}));
const actions={
  'toggle-customer-bulk-visible':(element,event)=>{toggleCustomerBulkVisible(element.checked)},
  'toggle-customer-bulk-row':(element,event)=>{toggleCustomerBulkRow(element.dataset.clickArg0,element.checked,!!event?.shiftKey)},
  'toggle-customer-bulk-mode':(element,event)=>{toggleCustomerBulkMode()},
  'delete-selected-customer-rows':(element,event)=>{deleteSelectedCustomerRows()},
  'customer-filter':(element,event)=>{customerUi.customerFilter='all';renderCustomers({resetScroll:true})},
  'customer-filter-2':(element,event)=>{customerUi.customerFilter='open';renderCustomers({resetScroll:true})},
  'customer-filter-3':(element,event)=>{customerUi.customerFilter='invoice';renderCustomers({resetScroll:true})},
  'customer-filter-4':(element,event)=>{customerUi.customerFilter='closed';renderCustomers({resetScroll:true})},
  'set-customer-tab':(element,event)=>{setCustomerTab('debts')},
  'set-customer-tab-2':(element,event)=>{setCustomerTab('orders')},
  'customer-search':(element,event)=>{customerSearch(element.value,element)},
  'open-debt-modal':(element,event)=>{openDebtModal()},
  'add-customer-order':(element,event)=>{addCustomerOrder()},
  'save-customer-order-field':(element,event)=>{saveCustomerOrderField(element.dataset.blurArg0,element.dataset.blurArg1,element)},
  'toggle-customer-order-urgent':(element,event)=>{saveCustomerOrderField(element.dataset.clickArg0,'urgent',{value:element.dataset.clickArg1});renderCustomers({resultsOnly:true})},
  'delete-customer-order':(element,event)=>{deleteCustomerOrder(element.dataset.clickArg0)},
  'set-customer-flag':(element,event)=>{setCustomerFlag(element.dataset.clickArg0,element.dataset.clickArg1,true)},
  'set-customer-flag-2':(element,event)=>{setCustomerFlag(element.dataset.clickArg0,element.dataset.clickArg1,false)},
  'save-debt-field':(element,event)=>{saveDebtField(element.dataset.blurArg0,element.dataset.blurArg1,element)},
  'open-debt-modal-2':(element,event)=>{openDebtModal(element.dataset.clickArg0)},
  'open-debt-progress-details':(element,event)=>{openDebtProgressDetails(element.dataset.clickArg0)},
  'save-debt':(element,event)=>{saveDebt(element.dataset.clickArg0)},
  'delete-debt':(element,event)=>{deleteDebt(element.dataset.clickArg0)},
  'customer-results-page':el=>pageCustomerResults(el.dataset.clickArg0,el.dataset.clickArg1),
};
return markMutationActions(actions,{orders:['open-debt-modal', 'add-customer-order', 'save-customer-order-field', 'toggle-customer-order-urgent', 'delete-customer-order', 'set-customer-flag', 'set-customer-flag-2', 'save-debt-field', 'open-debt-modal-2', 'save-debt', 'delete-debt', 'delete-selected-customer-rows']});
}
