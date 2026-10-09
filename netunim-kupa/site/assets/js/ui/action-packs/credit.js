import {createLazyDeferredSearchUpdater} from '../../shared/search-scheduler.js';
import {creditDateRangeFromControl} from '../../shared/credit-detail-controls.js';

// Credit owns these delegated UI actions and its local event ports.
export function createCreditActions({domainsCreditController,domainsCreditEditor,domainsCreditView,ui}){
const copySafeCreditDiagnostics=(...args)=>domainsCreditController.copySafeCreditDiagnostics(...args);
const deleteCreditConnection=(...args)=>domainsCreditController.deleteCreditConnection(...args);
const exportCreditDataDiagnostics=(...args)=>domainsCreditController.exportCreditDataDiagnostics(...args);
const openCreditConnectionModal=(...args)=>domainsCreditController.openCreditConnectionModal(...args);
const openCreditModal=(...args)=>domainsCreditEditor.openCreditModal(...args);
const pageCreditDetails=(...args)=>domainsCreditView.pageCreditDetails(...args);
const prefillChargeDate=(...args)=>domainsCreditEditor.prefillChargeDate(...args);
const refreshCreditSync=(...args)=>domainsCreditController.refreshCreditSync(...args);
const renderCredit=(...args)=>domainsCreditView.renderCredit(...args);
const renderCreditDetails=(...args)=>domainsCreditView.renderCreditDetails(...args);
const resetCreditSync=(...args)=>domainsCreditController.resetCreditSync(...args);
const setCreditAutoMode=(...args)=>domainsCreditController.setCreditAutoMode(...args);
const setCreditAutoRefresh=(...args)=>domainsCreditController.setCreditAutoRefresh(...args);
const setCreditCardMapping=(...args)=>domainsCreditController.setCreditCardMapping(...args);
const setCreditSearch=(...args)=>domainsCreditView.setCreditSearch(...args);
const toggleCreditSyncOptions=(...args)=>domainsCreditView.toggleCreditSyncOptions(...args);
const creditSearch=createLazyDeferredSearchUpdater(value=>{ui.creditSearchValue=value},setCreditSearch);
return {
  'expenses-hub-tab':(element,event)=>{ui.expensesTab=element.dataset.clickArg0==='expenses'?'expenses':'credit';renderCredit()},
  'credit-details-page':element=>pageCreditDetails(element.dataset.clickArg0,element.dataset.clickArg1),
  'credit-search':(element,event)=>{creditSearch(element.value,element)},
  'toggle-credit-sync-options':(element,event)=>{toggleCreditSyncOptions()},
  'credit-view':(element,event)=>{ui.creditView=element.value;if(ui.creditDetailFocus?.cardKey)ui.creditDetailFocus={...ui.creditDetailFocus,cardKey:''};renderCredit()},
  'toggle-credit-forecast':(element,event)=>{ui.creditForecastOpen=!ui.creditForecastOpen;const body=document.getElementById('creditForecastBody'),button=document.querySelector('[data-action="toggle-credit-forecast"]');if(body)body.hidden=!ui.creditForecastOpen;if(button){button.classList.toggle('open',ui.creditForecastOpen);button.setAttribute('aria-expanded',String(ui.creditForecastOpen))}},
  'credit-account-filter':(element,event)=>{ui.creditAccountFilter=element.dataset.clickArg0||element.value||'all';ui.creditDetailFocus=ui.creditDetailMode==='month'&&ui.creditDetailFocus?.monthKey?{monthKey:ui.creditDetailFocus.monthKey,cardKey:''}:null;renderCredit()},
  'credit-provider-filter':(element,event)=>{ui.creditProviderFilter=element.dataset.clickArg0||'all';ui.creditCardFilter='all';ui.creditDetailFocus=ui.creditDetailMode==='month'&&ui.creditDetailFocus?.monthKey?{monthKey:ui.creditDetailFocus.monthKey,cardKey:''}:null;renderCredit()},
  'credit-card-filter':(element,event)=>{ui.creditCardFilter=element.dataset.clickArg0||'all';ui.creditDetailFocus=ui.creditDetailMode==='month'&&ui.creditDetailFocus?.monthKey?{monthKey:ui.creditDetailFocus.monthKey,cardKey:''}:null;renderCredit()},
  'credit-detail-period':(element,event)=>{ui.creditDetailMode=element.dataset.clickArg0==='all'?'all':'recent3';ui.creditDetailChargeDay='all';ui.creditDetailFocus=null;renderCreditDetails()},
  'credit-date-apply':(element,event)=>{const range=creditDateRangeFromControl(element);if(!range)return;ui.creditDateFrom=range.from;ui.creditDateTo=range.to;ui.creditDetailMode='range';ui.creditDetailChargeDay='all';ui.creditDetailFocus=null;renderCreditDetails()},
  'credit-detail-upcoming':(element,event)=>{ui.creditDetailMode='upcoming';ui.creditDetailChargeDay='all';ui.creditDetailFocus=null;renderCreditDetails()},
  'credit-detail-upcoming-day':(element,event)=>{const day=element.dataset.clickArg0==='10'?'10':'15',active=ui.creditDetailMode==='upcoming'&&ui.creditDetailChargeDay===day;ui.creditDetailMode='upcoming';ui.creditDetailChargeDay=active?'all':day;ui.creditDetailFocus=null;renderCreditDetails()},
  'credit-detail-month':(element,event)=>{ui.creditDetailMode='month';ui.creditDetailChargeDay='all';ui.creditDetailFocus={monthKey:element.dataset.clickArg0||'',cardKey:''};renderCreditDetails()},
  'credit-detail-month-day':(element,event)=>{const monthKey=element.dataset.clickArg0||'',day=element.dataset.clickArg1==='10'?'10':'15',active=ui.creditDetailMode==='month'&&ui.creditDetailFocus?.monthKey===monthKey&&ui.creditDetailChargeDay===day;ui.creditDetailMode='month';ui.creditDetailChargeDay=active?'all':day;ui.creditDetailFocus={monthKey,cardKey:''};renderCreditDetails()},
  'credit-detail-focus':(element,event)=>{ui.creditDetailMode='month';ui.creditDetailChargeDay='all';ui.creditDetailFocus={monthKey:element.dataset.clickArg0||'',cardKey:element.dataset.clickArg1||''};renderCredit();requestAnimationFrame(()=>document.getElementById('credit-active-transactions')?.scrollIntoView({behavior:'smooth',block:'start'}))},
  'clear-credit-detail-focus':(element,event)=>{ui.creditDetailMode='month';ui.creditDetailFocus={monthKey:element.dataset.clickArg0||ui.creditDetailFocus?.monthKey||'',cardKey:''};renderCreditDetails()},
  'open-credit-modal-2':(element,event)=>{openCreditModal(element.dataset.clickArg0)},
  'open-credit-connection':(element,event)=>{event?.preventDefault();event?.stopPropagation();openCreditConnectionModal(element.dataset.clickArg0||'')},
  'delete-credit-connection':(element,event)=>{event?.preventDefault();event?.stopPropagation();deleteCreditConnection(element.dataset.clickArg0||'')},
  'reset-credit-sync':(element,event)=>{event?.preventDefault();event?.stopPropagation();resetCreditSync()},
  'refresh-credit-sync':(element,event)=>{event?.preventDefault();event?.stopPropagation();refreshCreditSync({interactive:false,auto:false,syncMode:'forecast'})},
  'retry-credit-publication':(element,event)=>{event?.preventDefault();event?.stopPropagation();return domainsCreditController.retryCreditPublication()},
  'refresh-credit-sync-quick':(element,event)=>{event?.preventDefault();event?.stopPropagation();refreshCreditSync({interactive:false,auto:false,syncMode:'quick'})},
  'refresh-credit-sync-recovery':(element,event)=>{event?.preventDefault();event?.stopPropagation();refreshCreditSync({interactive:false,auto:false,syncMode:'recovery'})},
  'refresh-credit-sync-interactive':(element,event)=>{event?.preventDefault();event?.stopPropagation();refreshCreditSync({interactive:true,auto:false,syncMode:'quick'})},
  'copy-safe-credit-diagnostics':(element,event)=>{event?.preventDefault();event?.stopPropagation();copySafeCreditDiagnostics()},
  'export-credit-data-diagnostics':(element,event)=>{event?.preventDefault();event?.stopPropagation();exportCreditDataDiagnostics()},
  'set-credit-card-included':(element,event)=>{setCreditCardMapping(element.dataset.changeArg0,element.dataset.changeArg1,'included',element.checked)},
  'set-credit-card-hidden':(element,event)=>{setCreditCardMapping(element.dataset.changeArg0,element.dataset.changeArg1,'hidden',element.checked)},
  'set-credit-card-account':(element,event)=>{setCreditCardMapping(element.dataset.changeArg0,element.dataset.changeArg1,'account',element.value)},
  'set-credit-card-name':(element,event)=>{setCreditCardMapping(element.dataset.changeArg0,element.dataset.changeArg1,'cardName',element.value)},
  'set-credit-card-manual-frame':(element,event)=>{setCreditCardMapping(element.dataset.changeArg0,element.dataset.changeArg1,'manualFrame',element.value)},
  'set-credit-auto-refresh':(element,event)=>{setCreditAutoRefresh(element.checked)},
  'set-credit-auto-mode':(element,event)=>{setCreditAutoMode(element.value)},
  'prefill-charge-date':(element,event)=>{prefillChargeDate()},
};
}
