import {esc} from '../../core/values.js';
import {money} from '../../core/money.js';
import {dateFmt} from '../../core/dates.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createDomainsCashView({model, ui, cashBalance, kpi, syncBulkUi, bulkControls, bulkHeader, bulkCell}){
function renderCash(){const rows=[...model.state.cash].sort((a,b)=>(b.date||'').localeCompare(a.date||''));document.getElementById('content').innerHTML=`<div class="grid kpis" style="grid-template-columns:repeat(3,minmax(0,1fr));margin-bottom:16px">${kpi('יתרת מזומן',cashBalance(),'#e8f4f2','#147d73','מחושב מכל התנועות')}${kpi('כניסות',model.state.cash.filter(x=>x.amount>0).reduce((a,x)=>a+x.amount,0),'#eaf5ee','#39835a','סה״כ תנועות חיוביות')}${kpi('יציאות / התאמות',Math.abs(model.state.cash.filter(x=>x.amount<0).reduce((a,x)=>a+x.amount,0)),'#fff0de','#d88422','סה״כ תנועות שליליות')}</div><section class="section"><div class="section-head"><div><h3>תנועות מזומן</h3><div class="muted">כל שינוי נשמר כתנועה — אין צורך לשנות יתרה ידנית</div></div><div class="bulk-actions">${bulkControls('cash')}<button class="btn primary" data-action="open-cash-modal">+ תנועה חדשה</button></div></div><div style="overflow:auto"><table><thead><tr>${bulkHeader('cash')}<th>תאריך</th><th>סוג</th><th>תיאור</th><th>סכום</th><th>הערה</th><th></th></tr></thead><tbody>${rows.map(r=>`<tr data-bulk-collection="cash" data-bulk-id="${esc(r.id)}" class="${esc(ui.bulkSelected.has(r.id)?'bulk-selected-row':'')}">${bulkCell('cash',r.id)}<td>${dateFmt(r.date)}</td><td>${esc(r.type)}</td><td><b>${esc(r.description)}</b></td><td class="amount" style="color:${esc(r.amount<0?'#b5443c':'#2f7952')}">${money(r.amount)}</td><td class="muted">${esc(r.note)||'—'}</td><td><button class="iconbtn" data-action="open-cash-modal-2" data-click-arg0="${esc(r.id)}">עריכה</button></td></tr>`).join('')}</tbody></table></div></section>`;syncBulkUi('cash')}

return { renderCash };
}
