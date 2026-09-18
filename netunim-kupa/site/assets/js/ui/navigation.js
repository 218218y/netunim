import {beginMeasure} from '../shared/runtime-performance.js';
import {createCleanViewCache} from '../shared/clean-view-cache.js';
import {TITLES} from '../state/constants.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createUiNavigation({ui, renderDashboard, renderChecks, renderCredit, renderCash, renderBank, renderNotes, renderSettings, maybeAutoRefreshBankBalance, maybeAutoRefreshCreditSync, refreshCheckBankIndicator=()=>{}, maybeShowCashflowStartupAlert=()=>{},dataRevision=()=>''}){
const setKey=value=>[...(value||[])].map(String).sort().join(',');
function viewStateKey(page){
  if(page==='checks')return JSON.stringify([ui.checkTab,ui.checkAccount,ui.checkYear,ui.checkFocus,ui.checkSearchValue,ui.bulkCollection,setKey(ui.bulkSelected)]);
  if(page==='credit')return JSON.stringify([ui.expensesTab,ui.creditView,ui.creditAccountFilter,ui.creditProviderFilter,ui.creditCardFilter,ui.creditDetailMode,ui.creditDetailChargeDay,ui.creditDetailFocus?.monthKey||'',ui.creditDetailFocus?.cardKey||'',ui.creditSearchValue,ui.expenseSearchValue,ui.creditSyncOpen,ui.creditForecastOpen,ui.bulkCollection,setKey(ui.bulkSelected)]);
  if(page==='cash')return JSON.stringify([ui.cashSearchValue,ui.bulkCollection,setKey(ui.bulkSelected)]);
  if(page==='bank'||page==='expenses')return JSON.stringify([ui.bankAccountView,ui.bankDataView,ui.bankDateMode,ui.bankDateFrom,ui.bankDateTo,ui.bankSearchValue,ui.bankSyncOpen]);
  if(page==='notes')return JSON.stringify([ui.notesTab,ui.notesSheetId,ui.notesSearchValue,ui.notesSheetSearchValue,ui.bulkCollection,setKey(ui.bulkSelected)]);
  return '';
}
const cacheablePage=page=>['dashboard','checks','credit','cash','bank','expenses','notes'].includes(page);
const viewCache=createCleanViewCache({container:()=>document.getElementById('content'),dataRevision,viewStateKey,cacheable:cacheablePage,maxEntries:3});
function afterNavigation(){refreshCheckBankIndicator();maybeAutoRefreshBankBalance();maybeAutoRefreshCreditSync();maybeShowCashflowStartupAlert()}
function setPage(p){ui.bulkCollection=null;ui.bulkSelected.clear();ui.currentPage=p;document.querySelectorAll('#nav button').forEach(b=>b.classList.toggle('active',b.dataset.page===p));const [t,s]=TITLES[p];document.getElementById('pageTitle').textContent=t;document.getElementById('pageSub').textContent=s;document.getElementById('sidebar').classList.remove('open');if(viewCache.activate(p)){afterNavigation();return}render()}

function render(){const done=beginMeasure(`kupa:render:${ui.currentPage}`);try{if(ui.currentPage==='dashboard')renderDashboard();if(ui.currentPage==='checks')renderChecks();if(ui.currentPage==='credit')renderCredit();if(ui.currentPage==='cash')renderCash();if(ui.currentPage==='bank')renderBank();if(ui.currentPage==='expenses')renderBank();if(ui.currentPage==='notes')renderNotes();if(ui.currentPage==='settings')renderSettings();viewCache.markRendered(ui.currentPage);afterNavigation()}finally{done()}}

return { setPage, render };
}
