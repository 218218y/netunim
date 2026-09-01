import {esc} from '../../core/values.js';
import {money} from '../../core/money.js';
import {dateFmt} from '../../core/dates.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createDomainsCashView({model, ui, cashBalance, rightsBalance, kpi, syncBulkUi, bulkControls, bulkHeader, bulkCell}){
function ledgerTable({collection,title,rows,openAction,editAction}){
  return `<section class="section cash-ledger-section"><div class="section-head"><div><h3>${esc(title)}</h3></div><div class="bulk-actions">${bulkControls(collection)}<button class="btn primary" data-action="${esc(openAction)}">+ תנועה חדשה</button></div></div><div class="table-scroll"><table class="mobile-card-table cash-table"><thead><tr>${bulkHeader(collection)}<th>תאריך</th><th>סוג</th><th>תיאור</th><th>סכום</th><th>הערה</th><th></th></tr></thead><tbody>${rows.map(r=>`<tr data-bulk-collection="${esc(collection)}" data-bulk-id="${esc(r.id)}" class="${esc(ui.bulkSelected.has(r.id)?'bulk-selected-row':'')}">${bulkCell(collection,r.id)}<td data-label="תאריך">${dateFmt(r.date)}</td><td data-label="סוג">${esc(r.type)}</td><td data-label="תיאור"><b>${esc(r.description)}</b></td><td data-label="סכום" class="amount cash-amount ${esc(r.amount<0?'negative':'positive')}">${money(r.amount)}</td><td data-label="הערה" class="muted">${esc(r.note)||'—'}</td><td data-label="פעולות"><button class="iconbtn" data-action="${esc(editAction)}" data-click-arg0="${esc(r.id)}">עריכה</button></td></tr>`).join('')}</tbody></table></div></section>`
}
function renderCash(){
  const cashRows=[...model.state.cash].sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  const rightsRows=[...(model.state.rights||[])].sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  document.getElementById('content').innerHTML=`<div class="cash-ledgers"><div class="cash-ledger-column cash-ledger-cash">${kpi('יתרת מזומן',cashBalance(),'#e8f4f2','#147d73','מחושב מכל תנועות המזומן')}${ledgerTable({collection:'cash',title:'תנועות מזומן',rows:cashRows,openAction:'open-cash-modal',editAction:'open-cash-modal-2'})}</div><div class="cash-ledger-column cash-ledger-rights">${kpi('יתרת מעשר',rightsBalance(),'#eef1f8','#7f86a6','מחושב מכל תנועות הזכות')}${ledgerTable({collection:'rights',title:'תנועות מעשר',rows:rightsRows,openAction:'open-right-modal',editAction:'open-right-modal-2'})}</div></div>`;
  syncBulkUi('cash');syncBulkUi('rights')
}

return { renderCash };
}
