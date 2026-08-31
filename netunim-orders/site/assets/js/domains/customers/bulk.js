import {esc} from '../../core/values.js';
import {money} from '../../core/money.js';
import {$} from '../../state/constants.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createDomainsCustomersBulk({customerUi, model, renderCustomers, toast, scheduleSave, confirmDialog}){
function setCustomerTab(tab){if(!['debts','orders'].includes(tab)||tab===customerUi.customerTab)return;customerUi.customerTab=tab;customerUi.customerBulkSelected.clear();renderCustomers({resetScroll:true})}

function customerBulkSource(){return customerUi.customerTab==='debts'?(model.state.customerDebts||[]):(model.state.customerOrders||[])}

function customerVisibleBulkIds(){return [...document.querySelectorAll('[data-customer-bulk-id]')].map(el=>el.dataset.customerBulkId).filter(Boolean)}

function toggleCustomerBulkMode(){customerUi.customerBulkMode=!customerUi.customerBulkMode;customerUi.customerBulkSelected.clear();renderCustomers()}

function toggleCustomerBulkRow(id,checked){if(!customerUi.customerBulkMode)return;if(!customerBulkSource().some(x=>x.id===id))return;if(checked)customerUi.customerBulkSelected.add(id);else customerUi.customerBulkSelected.delete(id);syncCustomerBulkUi()}

function toggleCustomerBulkVisible(checked){if(!customerUi.customerBulkMode)return;customerVisibleBulkIds().forEach(id=>checked?customerUi.customerBulkSelected.add(id):customerUi.customerBulkSelected.delete(id));document.querySelectorAll('[data-customer-bulk-check]').forEach(cb=>cb.checked=checked);syncCustomerBulkUi()}

function customerBulkHeader(){return customerUi.customerBulkMode?'<th class="bulk-check-col"><input id="customerBulkAll" class="bulk-check" type="checkbox" title="בחר את כל השורות המוצגות" data-change="toggle-customer-bulk-visible"></th>':''}

function customerBulkCell(id){return customerUi.customerBulkMode?`<td class="bulk-check-col"><input class="bulk-check" data-customer-bulk-check type="checkbox" ${customerUi.customerBulkSelected.has(id)?'checked':''} aria-label="בחר שורה" data-change="toggle-customer-bulk-row" data-change-arg0="${esc(id)}"></td>`:''}

function customerBulkControls(){return `<div class="module-bulk-controls"><button class="btn small bulk-select-toggle ${esc(customerUi.customerBulkMode?'active':'')}" data-action="toggle-customer-bulk-mode">${customerUi.customerBulkMode?'סיום בחירה':'בחירה'}</button>${customerUi.customerBulkMode?`<button id="customerBulkDelete" class="btn danger small bulk-delete-btn" data-action="delete-selected-customer-rows" disabled>מחק נבחרים</button>`:''}</div>`}

function syncCustomerBulkUi(){if(!customerUi.customerBulkMode)return;const valid=new Set(customerBulkSource().map(x=>x.id));[...customerUi.customerBulkSelected].forEach(id=>{if(!valid.has(id))customerUi.customerBulkSelected.delete(id)});const del=$('#customerBulkDelete');if(del){del.disabled=!customerUi.customerBulkSelected.size;del.textContent=customerUi.customerBulkSelected.size?`מחק ${customerUi.customerBulkSelected.size}`:'מחק נבחרים'}const visible=customerVisibleBulkIds(),selectedVisible=visible.filter(id=>customerUi.customerBulkSelected.has(id)).length,all=$('#customerBulkAll');if(all){all.checked=visible.length>0&&selectedVisible===visible.length;all.indeterminate=selectedVisible>0&&selectedVisible<visible.length}document.querySelectorAll('[data-customer-bulk-id]').forEach(row=>row.classList.toggle('bulk-selected-row',customerUi.customerBulkSelected.has(row.dataset.customerBulkId)))}

async function deleteSelectedCustomerRows(){const source=customerBulkSource(),valid=new Set(source.map(x=>x.id)),ids=[...customerUi.customerBulkSelected].filter(id=>valid.has(id));if(!ids.length)return toast('לא נבחרו שורות למחיקה');const label=customerUi.customerTab==='debts'?'חובות לקוחות':'רשומות מעקב הזמנות';if(!await confirmDialog('מחיקת רשומות',`למחוק ${ids.length} ${label} שנבחרו?\n\nהמחיקה תישמר בגיבוי ובסנכרון כמו כל שינוי אחר.`,{confirmText:'מחק נבחרים'}))return;const set=new Set(ids);if(customerUi.customerTab==='debts')model.state.customerDebts=model.state.customerDebts.filter(x=>!set.has(x.id));else model.state.customerOrders=model.state.customerOrders.filter(x=>!set.has(x.id));customerUi.customerBulkSelected.clear();scheduleSave(`${ids.length} ${label} נמחקו`);renderCustomers()}

function customerBottomSummary(st){
  return `<section class="customer-bottom-summary"><div class="customer-bottom-head"><div><h2>סיכום לקוחות</h2></div></div><div class="customer-bottom-grid"><div><span>חוב שסופק</span><b class="badtext">${money(st.openSuppliedTotal)}</b><small>${esc(st.openSupplied)} חובות פתוחים שסופקו</small></div><div><span>חוב שלא סופק</span><b class="warntext">${money(st.openUnsuppliedTotal)}</b><small>${esc(st.openUnsupplied)} חובות פתוחים שטרם סופקו</small></div><div><span>סה״כ חוב פתוח</span><b class="badtext">${money(st.openTotal)}</b><small>${esc(st.open)} חובות שטרם שולמו</small></div></div></section>`;
}

return { setCustomerTab, customerBulkSource, customerVisibleBulkIds, toggleCustomerBulkMode, toggleCustomerBulkRow, toggleCustomerBulkVisible, customerBulkHeader, customerBulkCell, customerBulkControls, syncCustomerBulkUi, deleteSelectedCustomerRows, customerBottomSummary };
}
