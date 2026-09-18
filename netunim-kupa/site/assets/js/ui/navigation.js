import {beginMeasure} from '../shared/runtime-performance.js';
import {TITLES} from '../state/constants.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createUiNavigation({ui, renderDashboard, renderChecks, renderCredit, renderCash, renderBank, renderNotes, renderSettings, maybeAutoRefreshBankBalance, maybeAutoRefreshCreditSync, refreshCheckBankIndicator=()=>{}, maybeShowCashflowStartupAlert=()=>{}}){
function setPage(p){ui.bulkCollection=null;ui.bulkSelected.clear();ui.currentPage=p;document.querySelectorAll('#nav button').forEach(b=>b.classList.toggle('active',b.dataset.page===p));const [t,s]=TITLES[p];document.getElementById('pageTitle').textContent=t;document.getElementById('pageSub').textContent=s;document.getElementById('sidebar').classList.remove('open');render()}

function render(){const done=beginMeasure(`kupa:render:${ui.currentPage}`);try{refreshCheckBankIndicator();if(ui.currentPage==='dashboard')renderDashboard();if(ui.currentPage==='checks')renderChecks();if(ui.currentPage==='credit')renderCredit();if(ui.currentPage==='cash')renderCash();if(ui.currentPage==='bank')renderBank();if(ui.currentPage==='expenses')renderBank();if(ui.currentPage==='notes')renderNotes();if(ui.currentPage==='settings')renderSettings();maybeAutoRefreshBankBalance();maybeAutoRefreshCreditSync();maybeShowCashflowStartupAlert()}finally{done()}}

return { setPage, render };
}
