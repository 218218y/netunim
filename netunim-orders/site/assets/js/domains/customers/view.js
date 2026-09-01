import {esc} from '../../core/values.js';
import {customerDebtStatus} from './model.js';
import {money} from '../../core/money.js';
import {$} from '../../state/constants.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createDomainsCustomersView({model, customerUi, bindScrollViewport, mountViewLayout, customerStats, customerBulkHeader, customerBulkControls, syncCustomerBulkUi, customerBottomSummary, customerBulkCell, scheduleSave}){
function filteredCustomerDebtRows(){
  const q=(customerUi.customerSearch||'').trim();
  return (model.state.customerDebts||[]).filter(d=>{
    const ds=customerDebtStatus(d);
    if(customerUi.customerFilter==='all'&&d.paid)return false;
    if(customerUi.customerFilter==='open'&&d.paid)return false;
    if(customerUi.customerFilter==='invoice'&&!(d.paid&&!d.invoiceIssued))return false;
    if(customerUi.customerFilter==='closed'&&ds.key!=='closed')return false;
    if(q&&!`${d.customerName||''} ${d.orderNumber||''} ${d.phone||''} ${d.note||''}`.includes(q))return false;
    return true;
  }).sort((a,b)=>Number(b.amount||0)-Number(a.amount||0));
}

function customerVisibleDebtTotal(rows){return rows.reduce((sum,d)=>sum+Number(d.amount||0),0)}

function updateCustomerVisibleTotal(total){
  const el=$('#main')?.querySelector('[data-customer-visible-total]');if(!el)return;
  el.textContent=money(total);el.classList.toggle('badtext',total>0);el.classList.toggle('goodtext',total<0);
}

function renderCustomers({resultsOnly=false,resetScroll=false}={}){
  const st=customerUi.customerTab==='debts'?customerStats():null,q=(customerUi.customerSearch||'').trim(),summary=st?customerBottomSummary(st):'';
  let table='',visibleDebtTotal=null;
  if(customerUi.customerTab==='debts'){
    const rows=filteredCustomerDebtRows();visibleDebtTotal=customerVisibleDebtTotal(rows);
    table=`<table class="customer-table ${esc(customerUi.customerBulkMode?'customer-bulk-table':'')}"><thead><tr>${customerBulkHeader()}<th class="customer-col-name">לקוח</th><th class="customer-col-amount table-head-center">סכום</th><th class="customer-col-order table-head-center">הזמנה</th><th class="customer-col-paid table-head-center">שולם</th><th class="customer-col-supplied table-head-center">סופק</th><th class="customer-col-invoice table-head-center">חשבונית יצאה</th><th class="customer-col-state table-head-badge-text">מצב</th><th class="customer-col-note table-head-input-text">הערה</th><th class="customer-col-actions"></th></tr></thead><tbody>${rows.map(debtRow).join('')||`<tr><td colspan="${esc(customerUi.customerBulkMode?10:9)}" class="empty">אין חובות המתאימים לסינון.</td></tr>`}</tbody></table>`;
  }else{
    const rows=(model.state.customerOrders||[]).filter(o=>{
      if(customerUi.customerOrderFilter==='mattress'&&!String(o.mattresses||'').trim())return false;
      if(q&&!`${o.orderNumber||''} ${o.customerName||''} ${o.mark1||''} ${o.mark2||''} ${o.mark3||''} ${o.mattresses||''} ${o.note||''}`.includes(q))return false;
      return true;
    }).sort((a,b)=>String(a.orderNumber||'').localeCompare(String(b.orderNumber||''),'he',{numeric:true}));
    table=`<table class="customer-orders-table ${esc(customerUi.customerBulkMode?'customer-bulk-table':'')}"><thead><tr>${customerBulkHeader()}<th class="customer-order-col-order">הזמנה</th><th class="customer-order-col-customer">לקוח</th><th class="customer-order-col-mark">סימון 1</th><th class="customer-order-col-mark">סימון 2</th><th class="customer-order-col-mark">סימון 3</th><th class="customer-order-col-mattresses">מזרונים</th><th class="customer-order-col-note">הערה</th><th class="customer-order-actions-head"><button class="icon-btn customer-order-add" title="הוסף שורה חדשה" aria-label="הוסף שורה חדשה" data-action="add-customer-order">＋</button></th></tr></thead><tbody>${rows.map(customerOrderRow).join('')||`<tr><td colspan="${esc(customerUi.customerBulkMode?9:8)}" class="empty">אין הזמנות המתאימות לסינון.</td></tr>`}</tbody></table>`;
  }
  const body=`<div class="panel customer-work-panel"><div class="table-wrap module-table customer-work-table">${table}${summary}</div></div>`;
  if(resultsOnly){
    const host=$('#customerSearchResults');
    if(host)host.innerHTML=body;
    if(visibleDebtTotal!==null)updateCustomerVisibleTotal(visibleDebtTotal);
    bindScrollViewport(`customers:${customerUi.customerTab}`,$('.customer-work-table'),{resetTop:resetScroll});
    syncCustomerBulkUi();
    return;
  }
  const filters=customerUi.customerTab==='debts'?`<div class="filters"><button class="chip-filter ${esc(customerUi.customerFilter==='all'?'active':'')}" data-action="customer-filter">הכל</button><button class="chip-filter ${esc(customerUi.customerFilter==='open'?'active':'')}" data-action="customer-filter-2">חוב פתוח</button><button class="chip-filter ${esc(customerUi.customerFilter==='invoice'?'active':'')}" data-action="customer-filter-3">שולם בלי חשבונית</button><button class="chip-filter ${esc(customerUi.customerFilter==='closed'?'active':'')}" data-action="customer-filter-4">נסגר</button></div>`:`<div class="filters"><button class="chip-filter ${esc(customerUi.customerOrderFilter==='all'?'active':'')}" data-action="customer-order-filter">הכל</button><button class="chip-filter ${esc(customerUi.customerOrderFilter==='mattress'?'active':'')}" data-action="customer-order-filter-2">מזרונים</button></div>`;
  const debtTotal=customerUi.customerTab==='debts'?`<span class="customer-visible-total">סה״כ <b data-customer-visible-total class="${esc(visibleDebtTotal>0?'badtext':visibleDebtTotal<0?'goodtext':'')}">${money(visibleDebtTotal)}</b></span>`:'';
  $('#main').innerHTML=`<div class="customers-view"><div class="module-toolbar customer-command"><div class="module-tabs"><button class="chip-filter ${esc(customerUi.customerTab==='debts'?'active':'')}" data-action="set-customer-tab">חובות</button><button class="chip-filter ${esc(customerUi.customerTab==='orders'?'active':'')}" data-action="set-customer-tab-2">מעקב הזמנות</button></div>${customerBulkControls()}<input class="customer-search" placeholder="${esc(customerUi.customerTab==='debts'?'חיפוש לקוח, הזמנה, טלפון או הערה…':'חיפוש הזמנה, לקוח או סימון…')}" value="${esc(customerUi.customerSearch)}" data-input="customer-search">${filters}${customerUi.customerTab==='debts'?'<button class="btn primary small customer-add-btn" data-action="open-debt-modal">+ חוב לקוח</button>':''}${debtTotal}</div><div id="customerSearchResults">${body}</div></div>`;
  mountViewLayout({sourceSelector:'.customers-view',headCount:1,className:'customers-view'});
  bindScrollViewport(`customers:${customerUi.customerTab}`,$('.customer-work-table'),{resetTop:resetScroll});
  syncCustomerBulkUi();
}

function customerOrderInput(o,field,placeholder){return `<input class="inline-input customer-order-input" value="${esc(o[field]||'')}" placeholder="${esc(placeholder)}" data-keydown="blur-on-enter" data-blur="save-customer-order-field" data-blur-arg0="${esc(o.id)}" data-blur-arg1="${esc(field)}">`}

function customerOrderRow(o){return `<tr data-customer-order-id="${esc(o.id)}" data-customer-bulk-id="${esc(o.id)}" class="${esc(customerUi.customerBulkSelected.has(o.id)?'bulk-selected-row':'')}">${customerBulkCell(o.id)}<td data-label="הזמנה" class="customer-order-field-cell customer-order-col-order">${customerOrderInput(o,'orderNumber','מספר הזמנה')}</td><td data-label="לקוח" class="customer-order-field-cell customer-order-col-customer">${customerOrderInput(o,'customerName','שם לקוח')}</td><td data-label="סימון 1" class="customer-order-field-cell customer-order-col-mark">${customerOrderInput(o,'mark1','סימון 1')}</td><td data-label="סימון 2" class="customer-order-field-cell customer-order-col-mark">${customerOrderInput(o,'mark2','סימון 2')}</td><td data-label="סימון 3" class="customer-order-field-cell customer-order-col-mark">${customerOrderInput(o,'mark3','סימון 3')}</td><td data-label="מזרונים" class="customer-order-field-cell customer-order-col-mattresses">${customerOrderInput(o,'mattresses','מזרונים')}</td><td data-label="הערה" class="customer-order-field-cell customer-order-col-note">${customerOrderInput(o,'note','הערה')}</td><td data-label="פעולות" class="module-actions customer-order-actions"><div class="row-actions"><button class="icon-btn customer-order-add" title="הוסף שורה חדשה" aria-label="הוסף שורה חדשה" data-action="add-customer-order">＋</button><button class="icon-btn customer-order-delete" title="מחק שורה" aria-label="מחק שורה" data-action="delete-customer-order" data-click-arg0="${esc(o.id)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V5h6v2m-8 0 1 13h8l1-13M10 11v5m4-5v5"/></svg></button></div></td></tr>`}

function debtToggle(d,field,label){const v=!!d[field];return `<div class="status-toggle binary" title="${esc(label)}"><button class="yes ${esc(v?'active':'')}" data-action="set-customer-flag" data-click-arg0="${esc(d.id)}" data-click-arg1="${esc(field)}">כן</button><button class="no ${esc(!v?'active':'')}" data-action="set-customer-flag-2" data-click-arg0="${esc(d.id)}" data-click-arg1="${esc(field)}">לא</button></div>`}

function debtRow(d){
  const s=customerDebtStatus(d),amountStateClass=d.paid?'is-paid':d.supplied===true?'is-supplied':'';
  return `<tr data-customer-bulk-id="${esc(d.id)}" class="${esc(s.key==='closed'?'row-closed':'')} ${esc(customerUi.customerBulkSelected.has(d.id)?'bulk-selected-row':'')}">${customerBulkCell(d.id)}<td data-label="לקוח" class="customer-col-name"><b>${esc(d.customerName)}</b>${d.phone?`<div class="customer-phone">${esc(d.phone)}</div>`:''}</td><td data-label="סכום" class="money badtext customer-col-amount customer-debt-amount ${esc(amountStateClass)}"><b>${money(d.amount)}</b></td><td data-label="הזמנה" class="customer-col-order">${esc(d.orderNumber||'—')}</td><td data-label="שולם" class="customer-col-paid">${debtToggle(d,'paid','שולם')}</td><td data-label="סופק" class="customer-col-supplied">${debtToggle(d,'supplied','סופק')}</td><td data-label="חשבונית" class="customer-col-invoice">${debtToggle(d,'invoiceIssued','חשבונית יצאה')}</td><td data-label="מצב" class="customer-col-state"><span class="badge ${esc(s.cls)}">${esc(s.text)}</span></td><td data-label="הערה" class="customer-col-note"><input class="inline-input" value="${esc(d.note||'')}" placeholder="הערה" data-keydown="blur-on-enter" data-blur="save-debt-note" data-blur-arg0="${esc(d.id)}"></td><td data-label="פעולות" class="module-actions customer-col-actions"><button class="icon-btn" title="עריכה" aria-label="עריכת חוב" data-action="open-debt-modal-2" data-click-arg0="${esc(d.id)}">✎</button></td></tr>`
}

function setCustomerFlag(id,field,value){
  const d=model.state.customerDebts.find(x=>x.id===id);
  if(!d||!['paid','supplied','invoiceIssued'].includes(field)||d[field]===value)return;
  const now=new Date().toISOString();
  d[field]=value;d.updatedAt=now;
  if(field==='paid')d.paidAt=value?now:null;
  if(field==='supplied')d.suppliedAt=value?now:null;
  if(field==='invoiceIssued')d.invoiceIssuedAt=value?now:null;
  d.closedAt=d.paid&&d.invoiceIssued?(d.closedAt||now):null;
  scheduleSave('סטטוס חוב הלקוח עודכן');renderCustomers()
}

function saveDebtNote(id,el){const d=model.state.customerDebts.find(x=>x.id===id);if(!d)return;const v=el.value.trim();if((d.note||'')===v)return;d.note=v;d.updatedAt=new Date().toISOString();scheduleSave('הערת הלקוח עודכנה')}

return { renderCustomers, customerOrderRow, debtToggle, debtRow, setCustomerFlag, saveDebtNote };
}
