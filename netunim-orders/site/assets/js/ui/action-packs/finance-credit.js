import {creditDateRangeFromControl} from '../../shared/credit-detail-controls.js';
import {createLazyDeferredSearchUpdater} from '../../shared/search-scheduler.js';
import {markMutationActions} from '../../shared/action-registry.js';

export function createFinanceCreditActions({domainsFinanceView,ui}){
const acknowledgeOrdersCreditSettlementWarning=(...args)=>domainsFinanceView.acknowledgeCreditSettlementWarning(...args);
const clearOrdersCreditDetailFocus=(...args)=>domainsFinanceView.clearCreditDetailFocus(...args);
const copyOrdersSafeCreditDiagnostics=(...args)=>domainsFinanceView.copySafeCreditDiagnostics(...args);
const deleteOrdersCreditConnection=(...args)=>domainsFinanceView.deleteCreditConnection(...args);
const exportOrdersCreditDataDiagnostics=(...args)=>domainsFinanceView.exportCreditDataDiagnostics(...args);
const openOrdersCreditConnection=(...args)=>domainsFinanceView.openCreditConnection(...args);
const refreshOrdersCredit=(...args)=>domainsFinanceView.refreshCredit(...args);
const resetOrdersCreditSync=(...args)=>domainsFinanceView.resetCreditSync(...args);
const saveOrdersCreditConnection=(...args)=>domainsFinanceView.saveCreditConnection(...args);
const setOrdersCreditAccountFilter=(...args)=>domainsFinanceView.setCreditAccountFilter(...args);
const setOrdersCreditAuto=(...args)=>domainsFinanceView.setCreditAuto(...args);
const setOrdersCreditAutoMode=(...args)=>domainsFinanceView.setCreditAutoMode(...args);
const setOrdersCreditCardFilter=(...args)=>domainsFinanceView.setCreditCardFilter(...args);
const setOrdersCreditCardMapping=(...args)=>domainsFinanceView.setCardMapping(...args);
const setOrdersCreditDateRange=(...args)=>domainsFinanceView.setCreditDateRange(...args);
const setOrdersCreditDetailFocus=(...args)=>domainsFinanceView.setCreditDetailFocus(...args);
const setOrdersCreditDetailMonth=(...args)=>domainsFinanceView.setCreditDetailMonth(...args);
const setOrdersCreditDetailPeriod=(...args)=>domainsFinanceView.setCreditDetailPeriod(...args);
const setOrdersCreditDetailUpcoming=(...args)=>domainsFinanceView.setCreditDetailUpcoming(...args);
const setOrdersCreditProviderFilter=(...args)=>domainsFinanceView.setCreditProviderFilter(...args);
const setOrdersCreditSearch=(...args)=>domainsFinanceView.setCreditSearch(...args);
const setOrdersCreditView=(...args)=>domainsFinanceView.setCreditView(...args);
const toggleOrdersCreditSyncOptions=(...args)=>domainsFinanceView.toggleCreditSyncOptions(...args);
const creditSearch=createLazyDeferredSearchUpdater(value=>{ui.creditSearchValue=value},setOrdersCreditSearch);
const actions={
  'refresh-orders-credit':(element,event)=>{refreshOrdersCredit(false,'forecast')},
  'refresh-orders-credit-quick':(element,event)=>{refreshOrdersCredit(false,'quick')},
  'refresh-orders-credit-recovery':(element,event)=>{refreshOrdersCredit(false,'recovery')},
  'refresh-orders-credit-interactive':(element,event)=>{refreshOrdersCredit(true,'quick')},
  'copy-orders-safe-credit-diagnostics':(element,event)=>{copyOrdersSafeCreditDiagnostics()},
  'export-orders-credit-data-diagnostics':(element,event)=>{event?.preventDefault();event?.stopPropagation();exportOrdersCreditDataDiagnostics()},
  'ack-orders-credit-settlement-warning':(element,event)=>{event?.preventDefault();acknowledgeOrdersCreditSettlementWarning(element.dataset.clickArg0)},
  'set-orders-credit-auto':(element,event)=>{setOrdersCreditAuto(element.checked)},
  'set-orders-credit-auto-mode':(element,event)=>{setOrdersCreditAutoMode(element.value)},
  'orders-credit-view':(element,event)=>{setOrdersCreditView(element.value)},
  'toggle-orders-credit-forecast':(element,event)=>{ui.creditForecastOpen=!ui.creditForecastOpen;const body=document.getElementById('ordersCreditForecastBody'),button=document.querySelector('[data-action="toggle-orders-credit-forecast"]');if(body)body.hidden=!ui.creditForecastOpen;if(button){button.classList.toggle('open',ui.creditForecastOpen);button.setAttribute('aria-expanded',String(ui.creditForecastOpen))}},
  'orders-credit-account-filter':(element,event)=>{setOrdersCreditAccountFilter(element.dataset.clickArg0||element.value||'all')},
  'orders-credit-provider-filter':(element,event)=>{setOrdersCreditProviderFilter(element.dataset.clickArg0)},
  'orders-credit-card-filter':(element,event)=>{setOrdersCreditCardFilter(element.dataset.clickArg0)},
  'orders-credit-detail-period':(element,event)=>{setOrdersCreditDetailPeriod(element.dataset.clickArg0)},
  'orders-credit-date-apply':(element,event)=>{const range=creditDateRangeFromControl(element);if(range)setOrdersCreditDateRange(range)},
  'orders-credit-detail-upcoming':(element,event)=>{setOrdersCreditDetailUpcoming()},
  'orders-credit-detail-upcoming-day':(element,event)=>{setOrdersCreditDetailUpcoming(element.dataset.clickArg0)},
  'orders-credit-detail-month':(element,event)=>{setOrdersCreditDetailMonth(element.dataset.clickArg0)},
  'orders-credit-detail-month-day':(element,event)=>{setOrdersCreditDetailMonth(element.dataset.clickArg0,element.dataset.clickArg1)},
  'orders-credit-detail-focus':(element,event)=>{setOrdersCreditDetailFocus(element.dataset.clickArg0,element.dataset.clickArg1)},
  'clear-orders-credit-detail-focus':(element,event)=>{clearOrdersCreditDetailFocus(element.dataset.clickArg0)},
  'orders-credit-search':(element,event)=>{creditSearch(element.value,element)},
  'toggle-orders-credit-sync-options':(element,event)=>{toggleOrdersCreditSyncOptions()},
  'orders-credit-included':(element,event)=>{setOrdersCreditCardMapping(element.dataset.changeArg0,element.dataset.changeArg1,'included',element.checked)},
  'orders-credit-hidden':(element,event)=>{setOrdersCreditCardMapping(element.dataset.changeArg0,element.dataset.changeArg1,'hidden',element.checked)},
  'orders-credit-account':(element,event)=>{setOrdersCreditCardMapping(element.dataset.changeArg0,element.dataset.changeArg1,'account',element.value)},
  'orders-credit-name':(element,event)=>{setOrdersCreditCardMapping(element.dataset.changeArg0,element.dataset.changeArg1,'cardName',element.value)},
  'orders-credit-manual-frame':(element,event)=>{setOrdersCreditCardMapping(element.dataset.changeArg0,element.dataset.changeArg1,'manualFrame',element.value)},
  'open-orders-credit-connection':(element,event)=>{openOrdersCreditConnection(element.dataset.clickArg0||'')},
  'save-orders-credit-connection':(element,event)=>{saveOrdersCreditConnection(element.dataset.clickArg0||'')},
  'delete-orders-credit-connection':(element,event)=>{deleteOrdersCreditConnection(element.dataset.clickArg0)},
  'reset-orders-credit-sync':(element,event)=>{resetOrdersCreditSync()},
};
return markMutationActions(actions,{finance:['refresh-orders-credit', 'refresh-orders-credit-quick', 'refresh-orders-credit-recovery', 'refresh-orders-credit-interactive', 'ack-orders-credit-settlement-warning', 'set-orders-credit-auto', 'set-orders-credit-auto-mode', 'orders-credit-included', 'orders-credit-hidden', 'orders-credit-account', 'orders-credit-name', 'orders-credit-manual-frame', 'open-orders-credit-connection', 'save-orders-credit-connection', 'delete-orders-credit-connection', 'reset-orders-credit-sync']});
}
