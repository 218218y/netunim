import {esc} from '../../core/values.js';
import {customerDebtStatus} from './model.js';
import {money} from '../../core/money.js';
import {$} from '../../state/constants.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createDomainsCustomersView({model, customerUi, bindScrollViewport, mountViewLayout, customerStats, customerBulkHeader, customerBulkControls, syncCustomerBulkUi, customerBottomSummary, customerBulkCell, scheduleSave}){
function renderCustomers({resultsOnly=false}={}){
  const st=customerStats(),q=(customerUi.customerSearch||'').trim(),summary=customerBottomSummary(st);
  let table='';
  if(customerUi.customerTab==='debts'){
    const rows=(model.state.customerDebts||[]).filter(d=>{
      const ds=customerDebtStatus(d);
      if(customerUi.customerFilter==='all'&&ds.key==='closed')return false;
      if(customerUi.customerFilter==='open'&&d.paid)return false;
      if(customerUi.customerFilter==='invoice'&&!(d.paid&&!d.invoiceIssued))return false;
      if(customerUi.customerFilter==='closed'&&ds.key!=='closed')return false;
      if(q&&!`${d.customerName||''} ${d.orderNumber||''} ${d.phone||''} ${d.note||''}`.includes(q))return false;
      return true;
    }).sort((a,b)=>Number(b.amount||0)-Number(a.amount||0));
    table=`<table class="customer-table ${esc(customerUi.customerBulkMode?'customer-bulk-table':'')}"><thead><tr>${customerBulkHeader()}<th>לקוח</th><th>סכום</th><th>הזמנה</th><th>שולם</th><th>חשבונית יצאה</th><th>מצב</th><th>הערה</th><th></th></tr></thead><tbody>${rows.map(debtRow).join('')||`<tr><td colspan="${esc(customerUi.customerBulkMode?9:8)}" class="empty">אין חובות המתאימים לסינון.</td></tr>`}</tbody></table>`;
  }else{
    const rows=(model.state.customerOrders||[]).filter(o=>{
      if(customerUi.customerOrderFilter==='mattress'&&!o.mattressMarked)return false;
      if(customerUi.customerOrderFilter==='attention'&&!o.sourceAttention)return false;
      if(q&&!`${o.orderNumber||''} ${o.customerName||''} ${o.sourceMarkA||''} ${o.sourceMarkB||''} ${o.mattressRaw||''} ${o.note||''}`.includes(q))return false;
      return true;
    }).sort((a,b)=>String(a.orderNumber||'').localeCompare(String(b.orderNumber||''),'he',{numeric:true}));
    table=`<table class="customer-orders-table ${esc(customerUi.customerBulkMode?'customer-bulk-table':'')}"><thead><tr>${customerBulkHeader()}<th>הזמנה</th><th>לקוח</th><th>סימון 1</th><th>סימון 2</th><th>מזרונים</th><th>הערה</th></tr></thead><tbody>${rows.map(customerOrderRow).join('')||`<tr><td colspan="${esc(customerUi.customerBulkMode?7:6)}" class="empty">אין הזמנות המתאימות לסינון.</td></tr>`}</tbody></table>`;
  }
  const body=`<div class="panel customer-work-panel"><div class="table-wrap module-table customer-work-table">${table}${summary}</div></div>`;
  if(resultsOnly){
    const host=$('#customerSearchResults');
    if(host)host.innerHTML=body;
    bindScrollViewport(`customers:${customerUi.customerTab}`,$('.customer-work-table'));
    syncCustomerBulkUi();
    return;
  }
  const filters=customerUi.customerTab==='debts'?`<div class="filters"><button class="chip-filter ${esc(customerUi.customerFilter==='all'?'active':'')}" data-action="customer-filter">הכל</button><button class="chip-filter ${esc(customerUi.customerFilter==='open'?'active':'')}" data-action="customer-filter-2">חוב פתוח</button><button class="chip-filter ${esc(customerUi.customerFilter==='invoice'?'active':'')}" data-action="customer-filter-3">שולם בלי חשבונית</button><button class="chip-filter ${esc(customerUi.customerFilter==='closed'?'active':'')}" data-action="customer-filter-4">נסגר</button></div>`:`<div class="filters"><button class="chip-filter ${esc(customerUi.customerOrderFilter==='all'?'active':'')}" data-action="customer-order-filter">הכל</button><button class="chip-filter ${esc(customerUi.customerOrderFilter==='mattress'?'active':'')}" data-action="customer-order-filter-2">מזרונים</button><button class="chip-filter ${esc(customerUi.customerOrderFilter==='attention'?'active':'')}" data-action="customer-order-filter-3">דורש תשומת לב</button></div>`;
  $('#main').innerHTML=`<div class="customers-view"><div class="module-toolbar customer-command"><div class="module-tabs"><button class="chip-filter ${esc(customerUi.customerTab==='debts'?'active':'')}" data-action="set-customer-tab">חובות</button><button class="chip-filter ${esc(customerUi.customerTab==='orders'?'active':'')}" data-action="set-customer-tab-2">מעקב הזמנות</button></div>${customerBulkControls()}<input class="customer-search" placeholder="${esc(customerUi.customerTab==='debts'?'חיפוש לקוח, הזמנה, טלפון או הערה…':'חיפוש הזמנה, לקוח או סימון…')}" value="${esc(customerUi.customerSearch)}" data-input="customer-search">${filters}${customerUi.customerTab==='debts'?'<button class="btn primary small customer-add-btn" data-action="open-debt-modal">+ חוב לקוח</button>':''}</div><div id="customerSearchResults">${body}</div></div>`;
  mountViewLayout({sourceSelector:'.customers-view',headCount:1,className:'customers-view'});
  bindScrollViewport(`customers:${customerUi.customerTab}`,$('.customer-work-table'));
  syncCustomerBulkUi();
}

function customerOrderRow(o){const a=o.sourceMarkA?`<span class="source-marker">${esc(o.sourceMarkA)}</span>`:'—',b=o.sourceMarkB?`<span class="source-marker">${esc(o.sourceMarkB)}</span>`:'—';return `<tr data-customer-bulk-id="${esc(o.id)}" class="${esc(o.sourceAttention?'source-attention':'')} ${esc(customerUi.customerBulkSelected.has(o.id)?'bulk-selected-row':'')}">${customerBulkCell(o.id)}<td><b>${esc(o.orderNumber||'—')}</b></td><td><b>${esc(o.customerName||'')}</b></td><td>${esc(a)}</td><td>${esc(b)}</td><td>${o.mattressMarked?'<span class="badge green">מזרונים</span>':'—'}</td><td><input class="inline-input" value="${esc(o.note||'')}" placeholder="הערה" data-keydown="blur-on-enter" data-blur="save-customer-order-note" data-blur-arg0="${esc(o.id)}"></td></tr>`}

function saveCustomerOrderNote(id,el){const o=model.state.customerOrders.find(x=>x.id===id);if(!o)return;const v=el.value.trim();if((o.note||'')===v)return;o.note=v;o.updatedAt=new Date().toISOString();scheduleSave('הערת מעקב ההזמנה עודכנה')}

function debtToggle(d,field,label){const v=!!d[field];return `<div class="status-toggle binary" title="${esc(label)}"><button class="yes ${esc(v?'active':'')}" data-action="set-customer-flag" data-click-arg0="${esc(d.id)}" data-click-arg1="${esc(field)}">כן</button><button class="no ${esc(!v?'active':'')}" data-action="set-customer-flag-2" data-click-arg0="${esc(d.id)}" data-click-arg1="${esc(field)}">לא</button></div>`}

function debtRow(d){const s=customerDebtStatus(d);return `<tr data-customer-bulk-id="${esc(d.id)}" class="${esc(s.key==='closed'?'row-closed':'')} ${esc(customerUi.customerBulkSelected.has(d.id)?'bulk-selected-row':'')}">${customerBulkCell(d.id)}<td><b>${esc(d.customerName)}</b>${d.phone?`<div class="customer-phone">${esc(d.phone)}</div>`:''}</td><td class="money badtext"><b>${money(d.amount)}</b></td><td>${esc(d.orderNumber||'—')}</td><td>${debtToggle(d,'paid','שולם')}</td><td>${debtToggle(d,'invoiceIssued','חשבונית יצאה')}</td><td><span class="badge ${esc(s.cls)}">${esc(s.text)}</span></td><td><input class="inline-input" value="${esc(d.note||'')}" placeholder="הערה" data-keydown="blur-on-enter" data-blur="save-debt-note" data-blur-arg0="${esc(d.id)}"></td><td class="module-actions"><button class="icon-btn" title="עריכה" data-action="open-debt-modal-2" data-click-arg0="${esc(d.id)}">✎</button></td></tr>`}

function setCustomerFlag(id,field,value){const d=model.state.customerDebts.find(x=>x.id===id);if(!d||!['paid','invoiceIssued'].includes(field))return;if(d[field]===value)return;const now=new Date().toISOString();d[field]=value;d.updatedAt=now;if(field==='paid')d.paidAt=value?now:null;if(field==='invoiceIssued')d.invoiceIssuedAt=value?now:null;d.closedAt=d.paid&&d.invoiceIssued?(d.closedAt||now):null;scheduleSave('סטטוס חוב הלקוח עודכן');renderCustomers()}

function saveDebtNote(id,el){const d=model.state.customerDebts.find(x=>x.id===id);if(!d)return;const v=el.value.trim();if((d.note||'')===v)return;d.note=v;d.updatedAt=new Date().toISOString();scheduleSave('הערת הלקוח עודכנה')}

return { renderCustomers, customerOrderRow, saveCustomerOrderNote, debtToggle, debtRow, setCustomerFlag, saveDebtNote };
}
