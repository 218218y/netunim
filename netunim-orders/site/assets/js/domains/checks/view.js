import {checkNum, money} from '../../core/money.js';
import {esc} from '../../core/values.js';
import {checkUrgency, futureCheckMonthsData} from './model.js';
import {checkMonthKey, checkMonthLabel, checkDateFmt, checkTodayISO} from '../../core/dates.js';
import {$} from '../../state/constants.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createDomainsChecksView({model, ui, checksSession, loadSession, mountViewLayout}){
function visibleChecks(){let rows=[...model.state.checks];if(ui.checkTab==='open')rows=rows.filter(x=>x.status==='בקופה');if(ui.checkTab==='deposited')rows=rows.filter(x=>x.status==='הופקד - במעקב');if(ui.checkTab==='closed')rows=rows.filter(x=>['נפרע','חזר','בוטל'].includes(x.status));if(ui.checkYear!=='all')rows=rows.filter(x=>x.dueDate?.startsWith(ui.checkYear+'-'));const q=ui.checkSearchValue.trim();if(q)rows=rows.filter(x=>`${x.name||''} ${x.checkNumber||''} ${x.note||''}`.includes(q));return rows.sort((a,b)=>(a.dueDate||'').localeCompare(b.dueDate||''))}

function visibleChecksTotal(rows=visibleChecks()){return rows.reduce((a,x)=>a+checkNum(x.amount),0)}

function checkBadgeStatus(s){const cls=s==='בקופה'?'blue':s==='הופקד - במעקב'?'orange':s==='נפרע'?'green':s==='חזר'?'red':'';return `<span class="checks-badge ${esc(cls)}">${esc(s)}</span>`}

function checkDueBadge(c){const u=checkUrgency(c);if(u==='overdue')return '<span class="checks-badge red">עבר מועד</span>';if(u==='week')return '<span class="checks-badge orange">השבוע</span>';if(u==='month')return '<span class="checks-badge yellow">עד 30 יום</span>';return ''}

function checksCloudLabel(){if(checksSession.checksCloudLastError)return `<span class="checks-cloud-note warn" title="${esc(checksSession.checksCloudLastError)}">צ'קים בענן: נדרשת בדיקה</span>`;if(checksSession.checksCloudRevision>0)return `<span class="checks-cloud-note synced">צ'קים משותפים · מקור עצמאי</span>`;if(loadSession())return '<span class="checks-cloud-note warn">צ\'קים בענן: טרם נטענו מהמאגר המשותף</span>';return '<span class="checks-cloud-note">צ\'קים מקומיים · יסתנכרנו לאחר חיבור לענן</span>'}

function toggleChecksBulkMode(){ui.checksBulkMode=!ui.checksBulkMode;ui.checksBulkSelected.clear()}

function toggleChecksBulkRow(id,checked){if(!ui.checksBulkMode)return;if(checked)ui.checksBulkSelected.add(id);else ui.checksBulkSelected.delete(id);syncChecksBulkUi()}

function checksVisibleIds(){return [...document.querySelectorAll('[data-check-id]')].map(x=>x.dataset.checkId).filter(Boolean)}

function toggleChecksBulkVisible(checked){if(!ui.checksBulkMode)return;checksVisibleIds().forEach(id=>checked?ui.checksBulkSelected.add(id):ui.checksBulkSelected.delete(id));document.querySelectorAll('.checks-bulk-check[data-check-row]').forEach(cb=>cb.checked=checked);syncChecksBulkUi()}

function syncChecksBulkUi(){if(!ui.checksBulkMode)return;const valid=new Set(model.state.checks.map(x=>x.id));[...ui.checksBulkSelected].forEach(id=>{if(!valid.has(id))ui.checksBulkSelected.delete(id)});const del=$('#checksBulkDelete');if(del){del.disabled=!ui.checksBulkSelected.size;del.textContent=ui.checksBulkSelected.size?`מחק ${ui.checksBulkSelected.size}`:'מחק נבחרים'}const visible=checksVisibleIds(),n=visible.filter(id=>ui.checksBulkSelected.has(id)).length;document.querySelectorAll('[data-check-all]').forEach(h=>{h.checked=visible.length>0&&n===visible.length;h.indeterminate=n>0&&n<visible.length});document.querySelectorAll('[data-check-id]').forEach(row=>row.classList.toggle('checks-bulk-selected',ui.checksBulkSelected.has(row.dataset.checkId)))}

function checksBulkControls(){return `<div class="checks-bulk-actions"><button class="btn small checks-bulk-toggle ${esc(ui.checksBulkMode?'active':'')}" data-action="toggle-checks-bulk-mode">${ui.checksBulkMode?'סיום בחירה':'בחירה'}</button>${ui.checksBulkMode?'<button id="checksBulkDelete" class="btn danger small checks-bulk-delete" data-action="delete-checks-bulk-selected" disabled>מחק נבחרים</button>':''}</div>`}

function checksBulkHeader(){return ui.checksBulkMode?'<th class="checks-bulk-col"><input class="checks-bulk-check" type="checkbox" data-check-all title="בחר את כל השורות המוצגות" data-change="toggle-checks-bulk-visible"></th>':''}

function checksBulkCell(id){return ui.checksBulkMode?`<td class="checks-bulk-col"><input class="checks-bulk-check" data-check-row type="checkbox" ${ui.checksBulkSelected.has(id)?'checked':''} aria-label="בחר צ'ק" data-change="toggle-checks-bulk-row" data-change-arg0="${esc(id)}"></td>`:''}

function checksMarkup({embedded=false,showEmbeddedStatus=true}={}){const rows=visibleChecks();const groups={};rows.forEach(r=>(groups[checkMonthKey(r.dueDate)]??=[]).push(r));const years=[...new Set(model.state.checks.map(x=>x.dueDate?.slice(0,4)).filter(Boolean))].sort();return `<div class="checks-page ${embedded?'checks-page-embedded':''}">${embedded?(showEmbeddedStatus?`<div class="checks-embedded-status">${checksCloudLabel()}</div>`:''):`<section class="hero checks-hero"><div><h1>צ'קים</h1></div><div class="actions">${checksCloudLabel()}</div></section>`}<div class="checks-toolbar"><div class="checks-segmented"><button class="${esc(ui.checkTab==='open'?'active':'')}" data-action="check-tab">בקופה</button><button class="${esc(ui.checkTab==='deposited'?'active':'')}" data-action="check-tab-2">הופקדו</button><button class="${esc(ui.checkTab==='closed'?'active':'')}" data-action="check-tab-3">נסגרו</button><button class="${esc(ui.checkTab==='all'?'active':'')}" data-action="check-tab-4">הכל</button></div><select data-change="check-year"><option value="all">כל השנים</option>${years.map(y=>`<option value="${esc(y)}" ${ui.checkYear===y?'selected':''}>${esc(y)}</option>`).join('')}</select><input class="checks-search" value="${esc(ui.checkSearchValue)}" placeholder="חיפוש שם / מספר / הערה" data-input="render-checks-search"><span class="checks-grand-total" id="checksGrandTotal">סה״כ צ׳קים <b>${money(visibleChecksTotal(rows))}</b></span><span class="checks-spacer"></span>${checksBulkControls()}<button class="btn primary" data-action="open-check-modal">+ צ'ק חדש</button></div>${checkForecastMarkup()}<div id="checkGroups">${renderCheckGroups(groups)}</div></div>`}

function checkForecastMarkup(){
  const months=futureCheckMonthsData(model.state,{fromMonth:checkMonthKey(checkTodayISO()),year:ui.checkYear});
  if(!months.length)return `<section class="checks-forecast"><div class="checks-forecast-body"><div class="checks-forecast-empty">אין צ׳קים עתידיים בקופה בטווח שנבחר.</div></div></section>`;
  const max=Math.max(1,...months.map(x=>Math.abs(x.total))),split=Math.ceil(months.length/2),columns=[months.slice(0,split),months.slice(split)];
  return `<section class="checks-forecast"><div class="checks-forecast-body"><div class="checks-forecast-columns">${columns.filter(column=>column.length).map(column=>`<div class="checks-forecast-list">${column.map(x=>checkForecastBarRow(x,max)).join('')}</div>`).join('')}</div></div></section>`;
}

function checkForecastBarRow(month,max){const width=month.total===0?0:Math.max(2,Math.abs(month.total)/max*100);return `<div class="checks-forecast-row"><b>${esc(checkMonthLabel(month.key))}</b><div class="checks-forecast-bar"><i style="width:${esc(width)}%"></i></div><div class="checks-forecast-num">${money(month.total)}</div></div>`}

function renderChecks({embedded=false,target=null}={}){const host=target||$('#main');if(!host)return;host.innerHTML=checksMarkup({embedded});if(!embedded)mountViewLayout({sourceSelector:'.checks-page',headCount:2,className:'checks-page',scrollKey:`checks:${ui.checkTab}:${ui.checkYear}`});syncChecksBulkUi()}

function renderChecksSearch(v){ui.checkSearchValue=v;const rows=visibleChecks(),groups={};rows.forEach(r=>(groups[checkMonthKey(r.dueDate)]??=[]).push(r));const host=$('#checkGroups');if(host)host.innerHTML=renderCheckGroups(groups);const total=$('#checksGrandTotal');if(total)total.innerHTML=`סה״כ צ׳קים <b>${money(visibleChecksTotal(rows))}</b>`;syncChecksBulkUi()}

function renderCheckGroups(groups){const keys=Object.keys(groups).sort();if(!keys.length)return '<div class="checks-empty">אין צ\'קים בתצוגה הזאת.</div>';return keys.map(k=>{const arr=groups[k],sum=arr.reduce((a,x)=>a+checkNum(x.amount),0);return `<section class="checks-month"><div class="checks-month-title"><b>${checkMonthLabel(k)}</b><span class="checks-month-total">${esc(arr.length)} צ'קים · ${money(sum)}</span></div><div class="checks-table-wrap"><table class="checks-table"><thead><tr>${checksBulkHeader()}<th>שם</th><th>סכום</th><th>פירעון</th><th>סטטוס</th><th>התראה</th><th>מס' צ'ק</th><th>הערה</th><th></th></tr></thead><tbody>${arr.map(checkRow).join('')}</tbody></table></div></section>`}).join('')}

function checkRow(c){return `<tr data-check-id="${esc(c.id)}" class="${esc(ui.checksBulkSelected.has(c.id)?'checks-bulk-selected':'')}">${checksBulkCell(c.id)}<td data-label="שם"><b>${esc(c.name)}</b></td><td data-label="סכום" class="checks-amount">${money(c.amount)}</td><td data-label="פירעון">${checkDateFmt(c.dueDate)}</td><td data-label="סטטוס">${checkBadgeStatus(c.status)}</td><td data-label="התראה">${checkDueBadge(c)}</td><td data-label="מספר צ׳ק">${esc(c.checkNumber)||'—'}</td><td data-label="הערה" class="checks-muted">${esc(c.note)||'—'}</td><td data-label="פעולות"><div class="checks-row-actions">${c.status==='בקופה'?`<button class="checks-iconbtn" data-action="mark-check-deposited" data-click-arg0="${esc(c.id)}">הופקד</button>`:''}${c.status==='הופקד - במעקב'?`<button class="checks-iconbtn" data-action="mark-check-cleared" data-click-arg0="${esc(c.id)}">נפרע</button>`:''}<button class="checks-iconbtn" data-action="open-check-modal-2" data-click-arg0="${esc(c.id)}">עריכה</button></div></td></tr>`}

return { visibleChecks, visibleChecksTotal, checkBadgeStatus, checkDueBadge, checksCloudLabel, toggleChecksBulkMode, toggleChecksBulkRow, checksVisibleIds, toggleChecksBulkVisible, syncChecksBulkUi, checksBulkControls, checksBulkHeader, checksBulkCell, checksMarkup, renderChecks, renderChecksSearch, renderCheckGroups, checkRow };
}
