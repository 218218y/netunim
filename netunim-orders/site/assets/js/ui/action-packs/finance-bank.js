import {createLazyDeferredSearchUpdater} from '../../shared/search-scheduler.js';
import {markMutationActions} from '../../shared/action-registry.js';

export function createFinanceBankActions({domainsFinanceController,domainsFinanceView,importFinanceConnections,ui,uiStatus}){
const acknowledgeOrdersBankMissing=(...args)=>domainsFinanceView.acknowledgeBankMissing(...args);
const configureOrdersBank=(...args)=>domainsFinanceView.configureBank(...args);
const createOrdersBankDocument=(...args)=>domainsFinanceView.createBankDocument(...args);
const deleteOrdersBankCredentials=(...args)=>domainsFinanceView.deleteBankCredentials(...args);
const exportOrdersBankChequeDiagnostics=(...args)=>domainsFinanceView.exportBankChequeDiagnostics(...args);
const openOrdersBankChequeImage=(...args)=>domainsFinanceView.openBankChequeImage(...args).catch(error=>uiStatus.toast(error?.message||String(error)));
const openOrdersCashflowBreakdown=(...args)=>domainsFinanceView.openCashflowBreakdown(...args);
const refreshOrdersBank=(...args)=>domainsFinanceView.refreshBank(...args);
const saveOrdersBankToken=(...args)=>domainsFinanceView.saveBankToken(...args);
const saveOrdersCashflowMinimum=(...args)=>domainsFinanceController.saveCashflowMinimum(...args);
const selectOrdersBankAccount=(...args)=>domainsFinanceView.selectBankAccount(...args);
const setKupaSection=(...args)=>domainsFinanceView.setKupaSection(...args);
const setOrdersBankAccountView=(...args)=>domainsFinanceView.setBankAccountView(...args);
const setOrdersBankAuto=(...args)=>domainsFinanceView.setBankAuto(...args);
const setOrdersBankDataView=(...args)=>domainsFinanceView.setBankDataView(...args);
const setOrdersBankDateMode=(...args)=>domainsFinanceView.setBankDateMode(...args);
const setOrdersBankSearch=(...args)=>domainsFinanceView.setBankSearch(...args);
const setOrdersBankTransactionHandled=(...args)=>domainsFinanceView.setBankTransactionHandled(...args);
const toggleOrdersBankSyncOptions=(...args)=>domainsFinanceView.toggleBankSyncOptions(...args);
const bankSearch=createLazyDeferredSearchUpdater(value=>{ui.bankSearchValue=value},setOrdersBankSearch);
const actions={
  'orders-cashflow-breakdown':element=>openOrdersCashflowBreakdown(element.dataset.clickArg0),
  'orders-cashflow-breakdown-date':element=>{openOrdersCashflowBreakdown(element.dataset.changeArg0,element.value,element)},
  'set-kupa-section':(element,event)=>{setKupaSection(element.dataset.clickArg0)},
  'set-orders-bank-account-view':(element,event)=>{setOrdersBankAccountView(element.dataset.clickArg0)},
  'set-orders-bank-data-view':(element,event)=>{setOrdersBankDataView(element.dataset.clickArg0)},
  'orders-bank-handled':(element,event)=>{event?.preventDefault();event?.stopPropagation();setOrdersBankTransactionHandled(Number(element.dataset.clickArg0),element.dataset.clickArg1==='true')},
  'orders-bank-create-document':(element,event)=>{event?.preventDefault();event?.stopPropagation();createOrdersBankDocument(Number(element.dataset.clickArg0),Number(element.dataset.clickArg1))},
  'view-orders-bank-cheque-image':(element,event)=>{event?.preventDefault();event?.stopPropagation();openOrdersBankChequeImage(element.dataset.clickArg0,element.dataset.clickArg1,element.dataset.clickArg2)},
  'ack-orders-bank-missing':(element,event)=>{event?.preventDefault();event?.stopPropagation();acknowledgeOrdersBankMissing(Number(element.dataset.clickArg0))},
  'orders-bank-search':(element,event)=>{bankSearch(element.value,element)},
  'orders-bank-date-mode':(element,event)=>{setOrdersBankDateMode(element.dataset.clickArg0||element.value)},
  'orders-bank-date-apply':(element,event)=>{const host=element.closest('.bank-date-filter');setOrdersBankDateMode('range',host?.querySelector('[data-bank-date-from]')?.value||'',host?.querySelector('[data-bank-date-to]')?.value||'')},
  'toggle-orders-bank-sync-options':(element,event)=>{toggleOrdersBankSyncOptions()},
  'save-orders-bank-token':(element,event)=>{saveOrdersBankToken()},
  'configure-orders-bank':(element,event)=>{configureOrdersBank()},
  'import-orders-finance-connections':(element,event)=>{event?.preventDefault();event?.stopPropagation();importFinanceConnections()},
  'select-orders-bank-account':(element,event)=>{selectOrdersBankAccount(element.dataset.clickArg0,element.dataset.clickArg1,element.dataset.clickArg2)},
  'delete-orders-bank-credentials':(element,event)=>{deleteOrdersBankCredentials()},
  'export-orders-bank-cheque-diagnostics':(element,event)=>{event?.preventDefault();event?.stopPropagation();exportOrdersBankChequeDiagnostics()},
  'refresh-orders-bank':(element,event)=>{refreshOrdersBank(false)},
  'refresh-orders-bank-interactive':(element,event)=>{refreshOrdersBank(true)},
  'set-orders-bank-auto':(element,event)=>{setOrdersBankAuto(element.checked)},
  'orders-cashflow-minimum':(element,event)=>{saveOrdersCashflowMinimum(element.dataset.changeArg0,element.value)},
};
return markMutationActions(actions,{finance:['orders-bank-handled', 'save-orders-bank-token', 'configure-orders-bank', 'import-orders-finance-connections', 'select-orders-bank-account', 'delete-orders-bank-credentials', 'refresh-orders-bank', 'refresh-orders-bank-interactive', 'set-orders-bank-auto', 'orders-cashflow-minimum']});
}
