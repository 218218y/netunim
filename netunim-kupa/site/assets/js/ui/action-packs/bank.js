import {createLazyDeferredSearchUpdater} from '../../shared/search-scheduler.js';

// Bank owns these delegated UI actions and its local event ports.
export function createBankActions({bankCommands,bankPresentation,connectionForms,importFinanceConnections,ui,toast,search=null}){
const acknowledgeMissingBankTransaction=(...args)=>bankCommands.acknowledgeMissingBankTransaction(...args);
const configureBankBridge=connectionForms.configure;
const deleteBankBridgeCredentials=(...args)=>bankCommands.deleteBankBridgeCredentials(...args);
const exportBankChequeDiagnostics=(...args)=>bankCommands.exportBankChequeDiagnostics(...args);
const openBankChequeImage=(...args)=>bankPresentation.openBankChequeImage(...args).catch(error=>toast(error?.message||String(error)));
const openCashflowBreakdown=(...args)=>bankPresentation.openCashflowBreakdown(...args);
const refreshBankBalance=(...args)=>bankCommands.refreshBankBalance(...args);
const retryLocalBankSnapshot=(...args)=>bankCommands.retryLocalBankSnapshot(...args);
const saveBankBridgeToken=connectionForms.saveToken;
const selectBankBridgeAccount=(...args)=>bankCommands.selectBankBridgeAccount(...args);
const setBankAccountView=(...args)=>bankPresentation.setBankAccountView(...args);
const setBankAutoRefresh=(...args)=>bankCommands.setBankAutoRefresh(...args);
const setBankDataView=(...args)=>bankPresentation.setBankDataView(...args);
const setBankDateBoundary=(...args)=>bankPresentation.setBankDateBoundary(...args);
const setBankDateMode=(...args)=>bankPresentation.setBankDateMode(...args);
const setBankSearch=(...args)=>bankPresentation.setBankSearch(...args);
const toggleBankSyncOptions=(...args)=>bankPresentation.toggleBankSyncOptions(...args);
const bankSearch=search??createLazyDeferredSearchUpdater(value=>{ui.bankSearchValue=value},setBankSearch);
return {
  'cashflow-breakdown':element=>openCashflowBreakdown(element.dataset.clickArg0),
  'cashflow-breakdown-date':element=>{openCashflowBreakdown(element.dataset.changeArg0,element.value,element)},
  'save-bank-bridge-token':(element,event)=>{saveBankBridgeToken()},
  'configure-bank-bridge':(element,event)=>{configureBankBridge()},
  'import-finance-connections':(element,event)=>{event?.preventDefault();event?.stopPropagation();importFinanceConnections()},
  'select-bank-bridge-account':(element,event)=>{selectBankBridgeAccount(element.dataset.clickArg0,element.dataset.clickArg1,element.dataset.clickArg2)},
  'set-bank-account-view':(element,event)=>{event?.preventDefault();event?.stopPropagation();setBankAccountView(element.dataset.clickArg0)},
  'set-bank-data-view':(element,event)=>{event?.preventDefault();event?.stopPropagation();setBankDataView(element.dataset.clickArg0)},
  'view-bank-cheque-image':(element,event)=>{event?.preventDefault();event?.stopPropagation();openBankChequeImage(element.dataset.clickArg0,element.dataset.clickArg1,element.dataset.clickArg2)},
  'ack-bank-missing':(element,event)=>{event?.preventDefault();event?.stopPropagation();acknowledgeMissingBankTransaction(Number(element.dataset.clickArg0))},
  'bank-search':(element,event)=>{bankSearch(element.value,element)},
  'bank-date-mode':(element,event)=>{setBankDateMode(element.dataset.clickArg0||element.value)},
  'bank-date-apply':(element,event)=>{const host=element.closest('.bank-date-filter');setBankDateMode('range',host?.querySelector('[data-bank-date-from]')?.value||'',host?.querySelector('[data-bank-date-to]')?.value||'')},
  'bank-date-from':(element,event)=>{setBankDateBoundary('from',element.value)},
  'bank-date-to':(element,event)=>{setBankDateBoundary('to',element.value)},
  'toggle-bank-sync-options':(element,event)=>{toggleBankSyncOptions()},
  'refresh-bank-from-hapoalim':(element,event)=>{event?.preventDefault();event?.stopPropagation();refreshBankBalance({interactive:false,auto:false})},
  'retry-local-bank-snapshot':(element,event)=>{event?.preventDefault();event?.stopPropagation();return retryLocalBankSnapshot()},
  'open-bank-auth':(element,event)=>{event?.preventDefault();event?.stopPropagation();refreshBankBalance({interactive:true,auto:false})},
  'delete-bank-bridge-credentials':(element,event)=>{deleteBankBridgeCredentials()},
  'export-bank-cheque-diagnostics':(element,event)=>{event?.preventDefault();event?.stopPropagation();exportBankChequeDiagnostics()},
  'set-bank-auto-refresh':(element,event)=>{setBankAutoRefresh(element.checked)},
};
}
