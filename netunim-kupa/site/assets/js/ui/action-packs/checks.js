import {createLazyDeferredSearchUpdater} from '../../shared/search-scheduler.js';

// Checks owns these delegated UI actions and its local event ports.
export function createChecksActions({domainsChecksEditor,domainsChecksView,ui,uiBulk,uiDateEditor,uiModal}){
const applyCheckDatePicker=(...args)=>uiDateEditor.applyCheckDatePicker(...args);
const changeCheckSeriesCount=(...args)=>domainsChecksEditor.changeCheckSeriesCount(...args);
const clearCheckFocus=(...args)=>domainsChecksView.clearCheckFocus(...args);
const deleteBulkSelected=(...args)=>uiBulk.deleteBulkSelected(...args);
const handleCheckDatePartBlur=(...args)=>uiDateEditor.handleCheckDatePartBlur(...args);
const handleCheckDatePartInput=(...args)=>uiDateEditor.handleCheckDatePartInput(...args);
const handleCheckDatePartKeydown=(...args)=>uiDateEditor.handleCheckDatePartKeydown(...args);
const markCheckSeriesManual=(...args)=>domainsChecksEditor.markCheckSeriesManual(...args);
const markCleared=(...args)=>domainsChecksEditor.markCleared(...args);
const markDeposited=(...args)=>domainsChecksEditor.markDeposited(...args);
const openCheckDatePicker=(...args)=>uiDateEditor.openCheckDatePicker(...args);
const openCheckModal=(...args)=>domainsChecksEditor.openCheckModal(...args);
const renderChecks=(...args)=>domainsChecksView.renderChecks(...args);
const renderChecksSearch=(...args)=>domainsChecksView.renderChecksSearch(...args);
const reviewCheckBank=(...args)=>{if(domainsChecksEditor.reviewCheckBank(...args))uiModal.closeModal(true)};
const syncCheckSeriesFromFirst=(...args)=>domainsChecksEditor.syncCheckSeriesFromFirst(...args);
const toggleBulkMode=(...args)=>uiBulk.toggleBulkMode(...args);
const toggleBulkRow=(...args)=>uiBulk.toggleBulkRow(...args);
const toggleBulkVisible=(...args)=>uiBulk.toggleBulkVisible(...args);
const checksSearch=createLazyDeferredSearchUpdater(value=>{ui.checkSearchValue=value},renderChecksSearch);
return {
  'review-check-bank':element=>reviewCheckBank(element.dataset.clickArg2==='remove-selected'?[...ui.bulkSelected]:element.dataset.clickArg0,element.dataset.clickArg1,element.dataset.clickArg2),
  'handle-check-date-part-input':(element,event)=>{handleCheckDatePartInput(element)},
  'handle-check-date-part-blur':(element,event)=>{handleCheckDatePartBlur(element)},
  'handle-check-date-part-keydown':(element,event)=>{handleCheckDatePartKeydown(event,element)},
  'open-check-date-picker':(element,event)=>{openCheckDatePicker(element)},
  'apply-check-date-picker':(element,event)=>{applyCheckDatePicker(element)},
  'open-check-modal':(element,event)=>{openCheckModal()},
  'mark-cleared':(element,event)=>{markCleared(element.dataset.clickArg0)},
  'mark-deposited':(element,event)=>{markDeposited(element.dataset.clickArg0)},
  'open-check-modal-2':(element,event)=>{openCheckModal(element.dataset.clickArg0)},
  'toggle-bulk-mode':(element,event)=>{toggleBulkMode(element.dataset.clickArg0)},
  'delete-bulk-selected':(element,event)=>{deleteBulkSelected(element.dataset.clickArg0)},
  'toggle-bulk-visible':(element,event)=>{toggleBulkVisible(element.dataset.changeArg0,element.checked)},
  'toggle-bulk-row':(element,event)=>{toggleBulkRow(element.dataset.changeArg0,element.dataset.changeArg1,element.checked)},
  'check-tab':(element,event)=>{ui.checkTab='open';ui.checkFocus='all';renderChecks()},
  'check-tab-2':(element,event)=>{ui.checkTab='deposited';ui.checkFocus='all';renderChecks()},
  'check-tab-3':(element,event)=>{ui.checkTab='closed';ui.checkFocus='all';renderChecks()},
  'check-account':(element,event)=>{ui.checkBankHistoryPage=0;const account=element.dataset.clickArg0;ui.checkAccount=account==='ביתי'?'ביתי':account==='עסקי'?'עסקי':'all';ui.checkFocus='all';ui.bulkSelected.clear();renderChecks()},
  'check-bank-history-page':(element,event)=>{ui.checkBankHistoryPage=Number(element.dataset.clickArg0)||0;renderChecks();document.querySelectorAll('.check-bank-activity').forEach(panel=>{panel.open=true})},
  'check-year':(element,event)=>{ui.checkYear=element.value;renderChecks()},
  'toggle-checks-forecast':(element,event)=>{ui.checksForecastOpen=!ui.checksForecastOpen;const body=document.getElementById('checksForecastBody'),button=document.querySelector('[data-action="toggle-checks-forecast"]');if(body)body.hidden=!ui.checksForecastOpen;if(button){button.classList.toggle('open',ui.checksForecastOpen);button.setAttribute('aria-expanded',String(ui.checksForecastOpen))}},
  'render-checks-search':(element,event)=>{checksSearch(element.value,element)},
  'clear-check-focus':(element,event)=>{clearCheckFocus()},
  'change-check-series-count':(element,event)=>{changeCheckSeriesCount()},
  'sync-check-series-from-first':(element,event)=>{syncCheckSeriesFromFirst()},
  'mark-check-series-manual':(element,event)=>{markCheckSeriesManual(element)},
};
}
