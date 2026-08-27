import {esc} from '../../core/values.js';
import {money} from '../../core/money.js';
import {dateFmt, todayISO, monthKey, monthLabel, addMonthsISO} from '../../core/dates.js';
import {creditProgress} from './model.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createDomainsCreditView({model, ui, pendingInstallments, syncBulkUi, bulkControls, bulkHeader, bulkCell}){
function renderCredit(){
  const future=pendingInstallments();
  const currentMonth=monthKey(todayISO()),currentYear=Number(currentMonth.slice(0,4));
  const futureYears=[...new Set(future.map(x=>x.date.slice(0,4)))].map(Number).filter(y=>Number.isFinite(y)&&y>=currentYear);
  const maxYear=Math.max(currentYear+1,...futureYears,currentYear);
  const years=Array.from({length:maxYear-currentYear+1},(_,i)=>String(currentYear+i));
  if(!['rolling12','all',...years].includes(String(ui.creditView)))ui.creditView='rolling12';
  let monthKeys=[],forecastTitle='';
  if(ui.creditView==='rolling12'){
    monthKeys=Array.from({length:12},(_,i)=>monthKey(addMonthsISO(`${currentMonth}-01`,i)));
    forecastTitle='תחזית 12 חודשים קדימה';
  }else if(ui.creditView==='all'){
    monthKeys=[...new Set(future.map(x=>monthKey(x.date)).filter(Boolean))].sort();
    forecastTitle='כל חיובי האשראי העתידיים';
  }else{
    monthKeys=Array.from({length:12},(_,i)=>`${ui.creditView}-${String(i+1).padStart(2,'0')}`);
    forecastTitle=`תחזית ${ui.creditView}`;
  }
  const months=monthKeys.map(k=>{const inst=future.filter(x=>monthKey(x.date)===k);return {k,inst,total:inst.reduce((a,x)=>a+x.amount,0)}});
  const monthCards=months.length?months.map(m=>creditMonthCard(m)).join(''):'<div class="empty">אין חיובי אשראי עתידיים.</div>';
  document.getElementById('content').innerHTML=`<div class="toolbar"><select aria-label="טווח תחזית אשראי" data-change="credit-view"><option value="rolling12" ${ui.creditView==='rolling12'?'selected':''}>12 חודשים קדימה</option><option value="all" ${ui.creditView==='all'?'selected':''}>כל השנים</option><optgroup label="לפי שנה">${years.map(y=>`<option value="${esc(y)}" ${ui.creditView===y?'selected':''}>${esc(y)}</option>`).join('')}</optgroup></select><span class="stat-pill">עסקאות עם יתרה: ${model.state.credits.filter(x=>x.active&&creditProgress(x).remainingCount>0).length}</span><span class="stat-pill">סה״כ עתידי: ${money(future.reduce((a,x)=>a+x.amount,0))}</span><span class="stat-pill">ניקוי אוטומטי: לא פעיל + 60 יום</span><span style="flex:1"></span>${bulkControls('credits')}<button class="btn primary" data-action="open-credit-modal">+ עסקת אשראי</button></div><section class="section"><div class="section-head"><div><h3>${esc(forecastTitle)}</h3></div></div><div class="section-body"><div class="month-cards">${monthCards}</div></div></section><section class="section" style="margin-top:16px"><div class="section-head"><div><h3>עסקאות אשראי</h3></div></div><div style="overflow:auto"><table><thead><tr>${bulkHeader('credits')}<th>כרטיס</th><th>תיאור</th><th>סכום כולל</th><th>התקדמות</th><th>תשלום הבא</th><th>יתרה עתידית</th><th>מצב</th><th></th></tr></thead><tbody>${model.state.credits.map(cr=>{const p=creditProgress(cr),pct=cr.installments?Math.min(100,(p.completedCount/cr.installments)*100):0;const status=!cr.active?'לא פעיל':p.complete?'הסתיים':'פעיל';return `<tr data-bulk-collection="credits" data-bulk-id="${esc(cr.id)}" class="${esc(ui.bulkSelected.has(cr.id)?'bulk-selected-row':'')}">${bulkCell('credits',cr.id)}<td><b>${esc(cr.card)}</b><div class="muted">${esc(cr.account)}</div></td><td>${esc(cr.description)||'—'}</td><td class="amount">${money(cr.totalAmount)}</td><td><div class="credit-progress"><b>נותרו ${esc(p.remainingCount)} מתוך ${esc(cr.installments)}</b><div class="progress-mini"><div class="progress-track"><i style="width:${esc(pct)}%"></i></div><div class="muted" style="margin-top:4px">בוצעו ${esc(p.completedCount)}</div></div></div></td><td>${p.next?`${dateFmt(p.next.date)}<div class="muted">תשלום ${esc(p.next.part)}/${esc(p.next.totalParts)} · ${money(p.next.amount)}</div>`:'—'}</td><td class="amount">${money(p.remainingAmount)}</td><td><span class="badge ${esc(status==='פעיל'?'green':status==='הסתיים'?'blue':'')}">${esc(status)}</span></td><td><button class="iconbtn" data-action="open-credit-modal-2" data-click-arg0="${esc(cr.id)}">עריכה</button></td></tr>`}).join('')}</tbody></table></div></section>`;
  syncBulkUi('credits')
}

function creditMonthCard(m){const cur=monthKey(todayISO())===m.k,past=m.k<monthKey(todayISO());const by={};m.inst.forEach(x=>by[x.card]=(by[x.card]||0)+x.amount);return `<div class="month-card ${esc(cur?'current':'')}"><h4>${monthLabel(m.k)} ${cur?'<span class="badge blue">החודש</span>':past?'<span class="badge">עבר</span>':''}</h4>${Object.entries(by).length?Object.entries(by).map(([card,v])=>`<div class="metric"><span>${esc(card)}</span><b>${money(v)}</b></div>`).join(''):`<div class="muted">${past?'אין חיובים עתידיים':'אין חיובים'}</div>`}<div class="total">סה״כ ${money(m.total)}</div></div>`}

return { renderCredit, creditMonthCard };
}
