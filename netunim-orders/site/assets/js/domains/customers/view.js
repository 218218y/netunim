import {createResultPages} from '../../shared/result-pages.js';
import {esc,uid} from '../../core/values.js';
import {customerDebtFilteredTotal,customerDebtMatchesFilter,customerDebtStatus,createCustomerRenderSelector} from './model.js';
import {customerDebtProgressData,customerDebtActiveProgressEntries} from '../../shared/customer-debt-progress.js';
import {morningDebtDocuments} from './morning-debt-documents.js';
import {money} from '../../core/money.js';
import {$} from '../../state/constants.js';

export function morningDebtLinksMarkup(debt){
  const links=morningDebtDocuments(debt).slice(-3).reverse();
  if(!links.length)return'';
  return `<div class="customer-debt-documents" aria-label="מסמכי Morning של החוב">${links.map(link=>`<button type="button" class="bank-row-morning-doc" data-action="morning-open-document" data-click-arg0="${esc(link.documentId)}" data-click-arg1="${esc(link.operationId)}" title="צפה במסמך Morning ${esc(link.documentNumber||'')}"><span aria-hidden="true">▤</span><span>${esc(Number(link.documentType)===320?'חשבונית מס / קבלה':Number(link.documentType)===305?'חשבונית מס':Number(link.documentType)===400?'קבלה':'מסמך Morning')} ${esc(link.documentNumber||'')}</span></button>`).join('')}</div>`;
}

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createDomainsCustomersView({customerRevision,model, customerUi, bindScrollViewport, mountViewLayout, customerStats, customerBulkHeader, customerBulkControls, syncCustomerBulkUi, customerBottomSummary, customerBulkCell, scheduleSave, morningDocumentButton=()=>'',rejectDebtRecoveryMutation=()=>false}){
const pages=createResultPages({ui:customerUi,action:'customer-results-page'});
function pageCustomerResults(name,delta){if(pages.move(name,delta)){renderCustomers({resultsOnly:true,resetScroll:true});pages.focus(name,delta)}}
function customerPage(rows){const page=pages.page(rows,customerUi.customerTab,`${customerUi.customerFilter}:${customerUi.customerSearch||''}`,{target:customerUi.resultTarget});customerUi.resultTarget='';return page}
const customerReadModel=createCustomerRenderSelector({state:()=>model.state,revision:customerRevision});
let preparedRows=new WeakMap(),lastReadModel;
function debtReadModel(){const next=customerReadModel();if(next!==lastReadModel){preparedRows=new WeakMap(next.rows.map(row=>[row.record,row]));lastReadModel=next}return next}
function filteredCustomerDebtRows(){
  const q=(customerUi.customerSearch||'').trim().toLocaleLowerCase();
  return debtReadModel().rows.filter(({progress,search})=>{
    if(!customerDebtMatchesFilter(progress,customerUi.customerFilter))return false;
    return !q||search.includes(q);
  }).map(row=>row.record);
}

function updateCustomerVisibleTotal(total){
  const el=$('#main')?.querySelector('[data-customer-visible-total]');if(!el)return;
  el.textContent=money(total);el.classList.toggle('badtext',total>0);el.classList.toggle('goodtext',total<0);
}

function renderCustomers({resultsOnly=false,resetScroll=false}={}){
  const st=customerUi.customerTab==='debts'?debtReadModel().stats:null,q=(customerUi.customerSearch||'').trim(),summary=st?customerBottomSummary(st):'';
  let table='',visibleDebtTotal=null,page;
  if(customerUi.customerTab==='debts'){
    const rows=filteredCustomerDebtRows();visibleDebtTotal=customerDebtFilteredTotal(rows,customerUi.customerFilter,row=>preparedRows.get(row).progress);
    const amountHeading=customerUi.customerFilter==='invoice'?'נותר לחשבונית':'סכום';
    page=customerPage(rows);table=`<table class="customer-table ${esc(customerUi.customerBulkMode?'customer-bulk-table':'')}"><thead><tr>${customerBulkHeader()}<th class="customer-col-name">לקוח</th><th class="customer-col-amount table-head-center">${amountHeading}</th><th class="customer-col-paid table-head-center">שולם</th><th class="customer-col-supplied table-head-center">סופק</th><th class="customer-col-invoice table-head-center">חשבונית יצאה</th><th class="customer-col-state table-head-badge-text">מצב</th><th class="customer-col-note table-head-input-text">הערה</th><th class="customer-col-clearing table-head-center">סליקה</th><th class="customer-col-customer-id table-head-center">ת.ז</th><th class="customer-col-actions"></th></tr></thead><tbody>${page.rows.map(debtRow).join('')||`<tr><td colspan="${esc(customerUi.customerBulkMode?11:10)}" class="empty">אין חובות המתאימים לסינון.</td></tr>`}</tbody></table>`;
  }else{
    const rows=(model.state.customerOrders||[]).filter(o=>{
      if(q&&!`${o.orderNumber||''} ${o.customerName||''} ${o.mark1||''} ${o.mark2||''} ${o.mark3||''} ${o.mattresses||''} ${o.note||''}`.includes(q))return false;
      return true;
    }).sort((a,b)=>String(a.orderNumber||'').localeCompare(String(b.orderNumber||''),'he',{numeric:true}));
    page=customerPage(rows);table=`<table class="customer-orders-table ${esc(customerUi.customerBulkMode?'customer-bulk-table':'')}"><thead><tr>${customerBulkHeader()}<th class="customer-order-col-order">הזמנה</th><th class="customer-order-col-customer">לקוח</th><th class="customer-order-col-mark">חובות</th><th class="customer-order-col-mark">סימון 2</th><th class="customer-order-col-mark">סימון 3</th><th class="customer-order-col-mattresses">מזרונים</th><th class="customer-order-col-note">הערה</th><th class="customer-order-actions-head"><button class="btn primary small customer-order-header-add" title="הוסף הזמנת לקוח" data-action="add-customer-order">+ הזמנת לקוח</button></th></tr></thead><tbody>${page.rows.map(customerOrderRow).join('')||`<tr><td colspan="${esc(customerUi.customerBulkMode?9:8)}" class="empty">אין הזמנות להצגה.</td></tr>`}</tbody></table>`;
  }
  const body=`<div class="panel customer-work-panel"><div class="table-wrap module-table customer-work-table">${page.controls}${table}${summary}</div></div>`;
  if(resultsOnly){
    const host=$('#customerSearchResults');
    if(host)host.innerHTML=body;
    if(visibleDebtTotal!==null)updateCustomerVisibleTotal(visibleDebtTotal);
    bindScrollViewport(`customers:${customerUi.customerTab}`,$('.customer-work-table'),{resetTop:resetScroll});
    syncCustomerBulkUi();
    return;
  }
  const filters=customerUi.customerTab==='debts'?`<div class="filters"><button class="chip-filter ${esc(customerUi.customerFilter==='all'?'active':'')}" data-action="customer-filter">הכל</button><button class="chip-filter ${esc(customerUi.customerFilter==='open'?'active':'')}" data-action="customer-filter-2">חוב פתוח</button><button class="chip-filter ${esc(customerUi.customerFilter==='invoice'?'active':'')}" data-action="customer-filter-3" title="חובות שטרם יצאה עליהם חשבונית מלאה, גם אם טרם שולמו">בלי חשבונית מלאה</button><button class="chip-filter ${esc(customerUi.customerFilter==='closed'?'active':'')}" data-action="customer-filter-4">נסגר</button></div>`:'';
  const debtTotal=customerUi.customerTab==='debts'?`<span class="customer-visible-total">${customerUi.customerFilter==='invoice'?'סה״כ נותר לחשבונית':'סה״כ'} <b data-customer-visible-total class="${esc(visibleDebtTotal>0?'badtext':visibleDebtTotal<0?'goodtext':'')}">${money(visibleDebtTotal)}</b></span>`:'';
  $('#main').innerHTML=`<div class="customers-view"><div class="module-toolbar customer-command"><div class="module-tabs"><button class="chip-filter ${esc(customerUi.customerTab==='debts'?'active':'')}" data-action="set-customer-tab">חובות</button><button class="chip-filter ${esc(customerUi.customerTab==='orders'?'active':'')}" data-action="set-customer-tab-2">מעקב הזמנות</button></div>${customerBulkControls()}<input class="customer-search" placeholder="${esc(customerUi.customerTab==='debts'?'חיפוש לקוח, טלפון, הערה, סליקה או ת.ז…':'חיפוש הזמנה, לקוח, חובות או סימון…')}" value="${esc(customerUi.customerSearch)}" data-input="customer-search">${filters}${customerUi.customerTab==='debts'?'<button class="btn primary small customer-add-btn" data-action="open-debt-modal">+ חוב לקוח</button>':'<button class="btn primary small customer-order-mobile-add" data-action="add-customer-order">+ הזמנת לקוח</button>'}${debtTotal}${customerUi.customerTab==='debts'?'<div class="customer-morning-actions"><button class="btn small" data-action="open-morning-documents">הצג מסמכים</button><button class="btn small customer-morning-add-btn" data-action="open-morning-standalone"><span aria-hidden="true">▤</span> הפק מסמך</button></div>':''}</div><div id="customerSearchResults">${body}</div></div>`;
  mountViewLayout({sourceSelector:'.customers-view',headCount:1,className:'customers-view'});
  bindScrollViewport(`customers:${customerUi.customerTab}`,$('.customer-work-table'),{resetTop:resetScroll});
  syncCustomerBulkUi();
}

function customerOrderInput(o,field,placeholder){return `<input class="inline-input customer-order-input" value="${esc(o[field]||'')}" placeholder="${esc(placeholder)}" data-keydown="blur-on-enter" data-blur="save-customer-order-field" data-blur-arg0="${esc(o.id)}" data-blur-arg1="${esc(field)}">`}

function customerOrderRow(o){const urgent=o.urgent===true;return `<tr data-customer-order-id="${esc(o.id)}" data-customer-bulk-id="${esc(o.id)}" class="${esc(`${customerUi.customerBulkSelected.has(o.id)?'bulk-selected-row ':''}${urgent?'customer-order-urgent':''}`.trim())}">${customerBulkCell(o.id)}<td data-label="הזמנה" class="customer-order-field-cell customer-order-col-order">${customerOrderInput(o,'orderNumber','מספר הזמנה')}</td><td data-label="לקוח" class="customer-order-field-cell customer-order-col-customer">${customerOrderInput(o,'customerName','שם לקוח')}</td><td data-label="חובות" class="customer-order-field-cell customer-order-col-mark">${customerOrderInput(o,'mark1','חובות')}</td><td data-label="סימון 2" class="customer-order-field-cell customer-order-col-mark">${customerOrderInput(o,'mark2','סימון 2')}</td><td data-label="סימון 3" class="customer-order-field-cell customer-order-col-mark">${customerOrderInput(o,'mark3','סימון 3')}</td><td data-label="מזרונים" class="customer-order-field-cell customer-order-col-mattresses">${customerOrderInput(o,'mattresses','מזרונים')}</td><td data-label="הערה" class="customer-order-field-cell customer-order-col-note">${customerOrderInput(o,'note','הערה')}</td><td data-label="פעולות" class="module-actions customer-order-actions"><div class="row-actions"><button class="icon-btn customer-order-urgent-toggle ${esc(urgent?'active':'')}" title="${esc(urgent?'בטל סימון דחוף לטיפול':'סמן דחוף לטיפול')}" aria-label="${esc(urgent?'בטל סימון דחוף לטיפול':'סמן דחוף לטיפול')}" aria-pressed="${esc(urgent?'true':'false')}" data-action="toggle-customer-order-urgent" data-click-arg0="${esc(o.id)}" data-click-arg1="${esc(urgent?'false':'true')}">!</button><button class="icon-btn customer-order-delete" title="מחק שורה" aria-label="מחק שורה" data-action="delete-customer-order" data-click-arg0="${esc(o.id)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V5h6v2m-8 0 1 13h8l1-13M10 11v5m4-5v5"/></svg></button></div></td></tr>`}

function debtDetailsIcon(){return `<svg class="debt-details-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h12v16H6zM9 8h6M9 12h6M9 16h4"/></svg>`}

function debtToggle(d,field,label){
  if(field==='paid'||field==='invoiceIssued'){
    const p=preparedRows.get(d)?.progress||customerDebtProgressData(d),complete=field==='paid'?p.paymentComplete:p.invoiceComplete,partial=field==='paid'?p.paymentPartial:p.invoicePartial;
    if(partial)return `<button type="button" class="debt-partial-chip" title="${esc(label)} חלקית — לחץ לצפייה בפירוט" aria-label="${esc(label)} חלקית — הצג פירוט" data-action="open-debt-progress-details" data-click-arg0="${esc(d.id)}"><span>חלקי</span>${debtDetailsIcon()}</button>`;
    return `<div class="status-toggle binary" title="${esc(label)}"><button class="yes ${esc(complete?'active':'')}" data-action="set-customer-flag" data-click-arg0="${esc(d.id)}" data-click-arg1="${esc(field)}">כן</button><button class="no ${esc(!complete?'active':'')}" data-action="set-customer-flag-2" data-click-arg0="${esc(d.id)}" data-click-arg1="${esc(field)}">לא</button></div>`;
  }
  const v=!!d[field];return `<div class="status-toggle binary" title="${esc(label)}"><button class="yes ${esc(v?'active':'')}" data-action="set-customer-flag" data-click-arg0="${esc(d.id)}" data-click-arg1="${esc(field)}">כן</button><button class="no ${esc(!v?'active':'')}" data-action="set-customer-flag-2" data-click-arg0="${esc(d.id)}" data-click-arg1="${esc(field)}">לא</button></div>`;
}

function debtRow(d){
  const p=preparedRows.get(d)?.progress||customerDebtProgressData(d),s=preparedRows.get(d)?.status||customerDebtStatus(d,p),invoiceFilter=customerUi.customerFilter==='invoice',paymentPartial=p.paymentPartial,amountStateClass=invoiceFilter?'is-invoice-pending':p.paymentComplete?'is-paid':paymentPartial?'is-payment-partial':d.supplied===true?'is-supplied':'',partial=s.key==='partial';
  const displayAmount=invoiceFilter?p.remainingInvoice:paymentPartial?p.remainingPayment:d.amount;
  const amountDetails=(invoiceFilter?p.invoicePartial:paymentPartial)?`<small class="customer-debt-progress-line">מתוך ${money(p.targetMagnitude)}</small>`:'';
  const invoiceDetails=!invoiceFilter&&p.invoicePartial?`<small class="customer-debt-invoice-remaining">נותר ${money(p.remainingInvoice)}</small>`:'';
  const stateBadge=partial?`<button type="button" class="badge ${esc(s.cls)} customer-debt-state-button" title="הצג פירוט חוב" aria-label="${esc(s.text)} — הצג פירוט חוב" data-action="open-debt-progress-details" data-click-arg0="${esc(d.id)}"><span>${esc(s.text)}</span>${debtDetailsIcon()}</button>`:`<span class="badge ${esc(s.cls)}">${esc(s.text)}</span>`;
  return `<tr data-customer-bulk-id="${esc(d.id)}" class="${esc(s.key==='closed'?'row-closed':'')} ${esc(customerUi.customerBulkSelected.has(d.id)?'bulk-selected-row':'')}">${customerBulkCell(d.id)}<td data-label="לקוח" class="customer-col-name"><b>${esc(d.customerName)}</b>${d.phone?`<div class="customer-phone">${esc(d.phone)}</div>`:''}${morningDebtLinksMarkup(d)}</td><td data-label="${invoiceFilter?'נותר לחשבונית':'סכום'}" class="money badtext customer-col-amount customer-debt-amount ${esc(amountStateClass)}"><b>${money(displayAmount)}</b>${amountDetails}</td><td data-label="שולם" class="customer-col-paid">${debtToggle(d,'paid','שולם')}</td><td data-label="סופק" class="customer-col-supplied">${debtToggle(d,'supplied','סופק')}</td><td data-label="חשבונית" class="customer-col-invoice">${debtToggle(d,'invoiceIssued','חשבונית יצאה')}${invoiceDetails}</td><td data-label="מצב" class="customer-col-state">${stateBadge}</td><td data-label="הערה" class="customer-col-note"><input class="inline-input" value="${esc(d.note||'')}" placeholder="הערה" data-keydown="blur-on-enter" data-blur="save-debt-field" data-blur-arg0="${esc(d.id)}" data-blur-arg1="note"></td><td data-label="סליקה" class="customer-col-clearing"><input class="inline-input debt-number-input" inputmode="numeric" maxlength="20" value="${esc(d.clearingApproval||'')}" placeholder="סליקה" data-keydown="blur-on-enter" data-blur="save-debt-field" data-blur-arg0="${esc(d.id)}" data-blur-arg1="clearingApproval"></td><td data-label="ת.ז" class="customer-col-customer-id"><input class="inline-input debt-number-input" inputmode="numeric" maxlength="9" value="${esc(d.customerId||'')}" placeholder="ת.ז" data-keydown="blur-on-enter" data-blur="save-debt-field" data-blur-arg0="${esc(d.id)}" data-blur-arg1="customerId"></td><td data-label="פעולות" class="module-actions customer-col-actions"><div class="row-actions customer-row-actions"><button class="icon-btn" title="עריכה" aria-label="עריכת חוב" data-action="open-debt-modal-2" data-click-arg0="${esc(d.id)}">✎</button>${morningDocumentButton(d)}</div></td></tr>`;
}

function appendProgressReset(d,kind,now){
  const clears=customerDebtActiveProgressEntries(d,kind).map(row=>row.id);if(!clears.length)return false;
  d.debtProgress=Array.isArray(d.debtProgress)?d.debtProgress:[];
  d.debtProgress.push({id:uid(kind==='payment'?'DPAYRESET':'DINVRESET'),kind,action:'reset',clears,source:'manual',createdAt:now});return true;
}

function setCustomerFlag(id,field,value){
  const d=model.state.customerDebts.find(x=>x.id===id);
  if(!d||!['paid','supplied','invoiceIssued'].includes(field))return;
  if(field!=='supplied'&&rejectDebtRecoveryMutation(id))return;
  const now=new Date().toISOString();
  if(field==='supplied'){
    if(d.supplied===value)return;d.supplied=value;d.updatedAt=now;d.suppliedAt=value?now:null;
  }else{
    const kind=field==='paid'?'payment':'invoice',before=customerDebtProgressData(d),complete=field==='paid'?before.paymentComplete:before.invoiceComplete,activeCount=customerDebtActiveProgressEntries(d,kind).length;
    if(value){if(complete)return;d[field]=true;if(field==='paid')d.paidAt=d.paidAt||now;else d.invoiceIssuedAt=d.invoiceIssuedAt||now}
    else{
      if(!complete&&!activeCount&&d[field]!==true)return;
      d[field]=false;appendProgressReset(d,kind,now);if(field==='paid')d.paidAt=null;else d.invoiceIssuedAt=null;
    }
    d.updatedAt=now;
  }
  const after=customerDebtProgressData(d);d.closedAt=after.paymentComplete&&after.invoiceComplete?(d.closedAt||now):null;
  scheduleSave('סטטוס חוב הלקוח עודכן',{domains:['customerDebts'],operations:[{type:'put',collection:'customerDebts',id:d.id,mode:'replace',record:d}]});renderCustomers({resultsOnly:true});
}

function saveDebtField(id,field,el){const d=model.state.customerDebts.find(x=>x.id===id),allowed=new Set(['note','clearingApproval','customerId']);if(!d||!allowed.has(field))return;let value=String(el?.value||'').trim();if(field==='clearingApproval')value=value.replace(/\D/g,'').slice(0,20);else if(field==='customerId')value=value.replace(/\D/g,'').slice(0,9);if(el&&el.value!==value)el.value=value;if(String(d[field]||'')===value)return;d[field]=value;d.updatedAt=new Date().toISOString();const labels={note:'הערת הלקוח',clearingApproval:'מספר הסליקה',customerId:'ת.ז הלקוח'};scheduleSave(`${labels[field]} עודכן`,{domains:['customerDebts'],operations:[{type:'put',collection:'customerDebts',id:d.id,mode:'replace',record:d}]})}

return { pageCustomerResults, renderCustomers, customerOrderRow, debtToggle, debtRow, setCustomerFlag, saveDebtField };
}
