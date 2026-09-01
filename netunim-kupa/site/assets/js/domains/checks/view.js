import {esc} from '../../core/values.js';
import {checkUrgency} from './model.js';
import {daysFromToday, monthKey, monthLabel, dateFmt} from '../../core/dates.js';
import {num, money} from '../../core/money.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createDomainsChecksView({ui, model, syncBulkUi, bulkControls, bulkHeader, bulkCell}){
function badgeStatus(s){const cls=s==='בקופה'?'blue':s==='הופקד - במעקב'?'orange':s==='נפרע'?'green':s==='חזר'?'red':'';return `<span class="badge ${esc(cls)}">${esc(s)}</span>`}

function dueBadge(c){const u=checkUrgency(c);if(u==='overdue')return '<span class="badge red">עבר מועד</span>';if(u==='week')return '<span class="badge orange">השבוע</span>';if(u==='month')return '<span class="badge yellow">עד 30 יום</span>';return ''}

function checkFocusMatch(x){
  if(ui.checkFocus==='due7'){const d=daysFromToday(x.dueDate);return x.status==='בקופה'&&d>=0&&d<=7}
  if(ui.checkFocus==='overdue')return x.status==='בקופה'&&daysFromToday(x.dueDate)<0;
  return true;
}

function clearCheckFocus(){ui.checkFocus='all';renderChecks()}

function visibleChecks(){let rows=[...model.state.checks];if(ui.checkTab==='open')rows=rows.filter(x=>x.status==='בקופה');if(ui.checkTab==='deposited')rows=rows.filter(x=>x.status==='הופקד - במעקב');if(ui.checkTab==='closed')rows=rows.filter(x=>['נפרע','חזר','בוטל'].includes(x.status));rows=rows.filter(checkFocusMatch);if(ui.checkYear!=='all')rows=rows.filter(x=>x.dueDate?.startsWith(ui.checkYear+'-'));const q=ui.checkSearchValue.trim();if(q)rows=rows.filter(x=>(x.name+' '+x.checkNumber+' '+x.note).includes(q));return rows.sort((a,b)=>(a.dueDate||'').localeCompare(b.dueDate||''))}

function visibleChecksTotal(rows=visibleChecks()){return rows.reduce((a,x)=>a+num(x.amount),0)}

function renderChecks(){const rows=visibleChecks();const groups={};rows.forEach(r=>(groups[monthKey(r.dueDate)]??=[]).push(r));const years=[...new Set(model.state.checks.map(x=>x.dueDate?.slice(0,4)).filter(Boolean))].sort();
document.getElementById('content').innerHTML=`<div class="toolbar checks-toolbar"><div class="segmented"><button class="${esc(ui.checkTab==='open'?'active':'')}" data-action="check-tab">בקופה</button><button class="${esc(ui.checkTab==='deposited'?'active':'')}" data-action="check-tab-2">הופקדו</button><button class="${esc(ui.checkTab==='closed'?'active':'')}" data-action="check-tab-3">נסגרו</button><button class="${esc(ui.checkTab==='all'?'active':'')}" data-action="check-tab-4">הכל</button></div><select data-change="check-year"><option value="all">כל השנים</option>${years.map(y=>`<option ${ui.checkYear===y?'selected':''}>${esc(y)}</option>`).join('')}</select><input class="checks-search" id="checkSearch" value="${esc(ui.checkSearchValue)}" placeholder="חיפוש שם / מספר / הערה" data-input="render-checks-search"><span class="checks-grand-total" id="checksGrandTotal">סה״כ צ׳קים <b>${money(visibleChecksTotal(rows))}</b></span>${ui.checkFocus==='due7'?`<span class="stat-pill">סינון: פירעון ב־7 ימים <button class="iconbtn" data-action="clear-check-focus" title="הסר סינון">×</button></span>`:''}${ui.checkFocus==='overdue'?`<span class="stat-pill">סינון: עבר מועד <button class="iconbtn" data-action="clear-check-focus" title="הסר סינון">×</button></span>`:''}<span class="toolbar-spacer"></span>${bulkControls('checks')}<button class="btn primary" data-action="open-check-modal">+ צק חדש</button></div><div id="checkGroups">${renderCheckGroups(groups)}</div>`;syncBulkUi('checks')}

function renderChecksSearch(v){ui.checkSearchValue=v;const rows=visibleChecks(),g={};rows.forEach(r=>(g[monthKey(r.dueDate)]??=[]).push(r));document.getElementById('checkGroups').innerHTML=renderCheckGroups(g);const total=document.getElementById('checksGrandTotal');if(total)total.innerHTML=`סה״כ צ׳קים <b>${money(visibleChecksTotal(rows))}</b>`;syncBulkUi('checks')}

function renderCheckGroups(groups){const keys=Object.keys(groups).sort();if(!keys.length)return '<section class="section"><div class="empty">אין צקים בתצוגה הזאת.</div></section>';return keys.map(k=>{const arr=groups[k],sum=arr.reduce((a,x)=>a+x.amount,0);return `<div class="month-group"><div class="month-title"><b>${monthLabel(k)}</b><span class="month-check-total">${esc(arr.length)} צקים · ${money(sum)}</span></div><div class="table-scroll"><table class="mobile-card-table checks-table"><thead><tr>${bulkHeader('checks')}<th>שם</th><th>סכום</th><th>פירעון</th><th>סטטוס</th><th>התראה</th><th>מס׳ צק</th><th>הערה</th><th></th></tr></thead><tbody>${arr.map(checkRow).join('')}</tbody></table></div></div>`}).join('')}

function checkRow(c){return `<tr data-bulk-collection="checks" data-bulk-id="${esc(c.id)}" class="${esc(ui.bulkSelected.has(c.id)?'bulk-selected-row':'')}">${bulkCell('checks',c.id)}<td data-label="שם"><b>${esc(c.name)}</b></td><td data-label="סכום" class="amount">${money(c.amount)}</td><td data-label="פירעון">${dateFmt(c.dueDate)}</td><td data-label="סטטוס">${badgeStatus(c.status)}</td><td data-label="התראה">${dueBadge(c)}</td><td data-label="מספר צק">${esc(c.checkNumber)||'—'}</td><td data-label="הערה" class="muted">${esc(c.note)||'—'}</td><td data-label="פעולות"><div class="row-actions">${c.status==='בקופה'?`<button class="iconbtn" data-action="mark-deposited" data-click-arg0="${esc(c.id)}">הופקד</button>`:''}${c.status==='הופקד - במעקב'?`<button class="iconbtn" data-action="mark-cleared" data-click-arg0="${esc(c.id)}">נפרע</button>`:''}<button class="iconbtn" data-action="open-check-modal-2" data-click-arg0="${esc(c.id)}">עריכה</button></div></td></tr>`}

return { badgeStatus, dueBadge, checkFocusMatch, clearCheckFocus, visibleChecks, visibleChecksTotal, renderChecks, renderChecksSearch, renderCheckGroups, checkRow };
}
