import {esc} from '../../core/values.js';
import {money, formatNullableMoney} from '../../core/money.js';
import {dateFmt, daysFromToday, monthLabel} from '../../core/dates.js';
import {dashboardNetPositionData} from './model.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createDomainsDashboardView({model, activeChecks, depositedChecks, bankLongTermPosition, ordersFinanceSummary=()=>null, refreshOrdersFinanceSummary=async()=>false}){
function renderDashboard(){
  const due7=activeChecks().filter(c=>{const d=daysFromToday(c.dueDate);return d>=0&&d<=7}).sort((a,b)=>(a.dueDate||'').localeCompare(b.dueDate||''));
  const overdue=activeChecks().filter(c=>daysFromToday(c.dueDate)<0).sort((a,b)=>(a.dueDate||'').localeCompare(b.dueDate||''));
  const depOver=depositedChecks().filter(c=>daysFromToday(c.dueDate)<0).sort((a,b)=>(a.dueDate||'').localeCompare(b.dueDate||''));
  const criticalAlerts=[
    ...overdue.map(c=>({kind:'open',id:c.id,c:'#b86561',t:`${c.name} — ${money(c.amount)}`,s:`צק בקופה עבר מועד (${dateFmt(c.dueDate)})`})),
    ...depOver.map(c=>({kind:'deposited',id:c.id,c:'#8b7ca0',t:`${c.name} — ${money(c.amount)}`,s:`הופקד וממתין לסימון נפרע · פירעון ${dateFmt(c.dueDate)}`}))
  ].sort((a,b)=>{
    const ca=model.state.checks.find(x=>x.id===a.id),cb=model.state.checks.find(x=>x.id===b.id);
    return (ca?.dueDate||'').localeCompare(cb?.dueDate||'');
  });
  const upcomingAlerts=due7.map(c=>({kind:'open',id:c.id,c:'#c59661',t:`${c.name} — ${money(c.amount)}`,s:`פירעון קרוב ${dateFmt(c.dueDate)}`}));
  const alerts=[...criticalAlerts,...upcomingAlerts];
  const long=dashboardNetPositionData(bankLongTermPosition(),ordersFinanceSummary());
  document.getElementById('content').innerHTML=`
  <div class="net-summary dashboard-net-summary"><div class="net-mini"><span>עו״ש עסקי מעודכן</span><b>${formatNullableMoney(long.bank)}</b></div><div class="net-mini"><span>כל האשראי העסקי שנותר</span><b>− ${money(long.credit)}</b></div><div class="net-mini"><span>הוצאות עסקיות חודש אחד</span><b>− ${money(long.expenses)}</b><small>${monthLabel(long.targetMonth)}</small></div><div class="net-mini"><span>סה״כ קופה</span><b>+ ${money(long.kupa)}</b><small>מזומן + צקים שטרם הופקדו</small></div><div class="net-mini"><span>חוב לקוחות פתוח</span><b>${long.customerOpen===null?'—':`+ ${money(long.customerOpen)}`}</b></div><div class="net-mini"><span>נטו ספקים</span><b>${long.supplierNet===null?'—':money(long.supplierNet)}</b></div><div class="net-total"><span>מאזן כולל נטו</span><b>${formatNullableMoney(long.net)}</b><small>עו״ש עסקי − כל האשראים העסקיים העתידיים − חודש הוצאות עסקיות + קופה + חוב לקוחות פתוח + נטו ספקים</small></div></div>
  <div class="grid two" style="margin-top:16px">
   <section class="section"><div class="section-head"><div><h3>פעולות מהירות</h3></div></div><div class="section-body"><div class="quick">
    <button data-action="open-check-modal"><b>+ צק חדש</b><span>שם, סכום ותאריך פירעון</span></button>
    <button data-action="open-credit-modal"><b>+ עסקת אשראי</b><span>סכום, כרטיס ומספר תשלומים</span></button>
    <button data-action="set-page"><b>בנק ועו״ש</b><span>יתרה, סנכרון ותנועות בנק</span></button>
   </div></div></section>
   <section class="section"><div class="section-head"><div><h3>דורש תשומת לב</h3></div><span class="badge ${esc(criticalAlerts.length?'red':'green')}">${esc(criticalAlerts.length)} חריגים${upcomingAlerts.length?` · ${upcomingAlerts.length} קרובים`:''}</span></div><div class="section-body"><div class="alert-list">${alerts.length?alerts.map(a=>`<div class="alert" style="--c:${esc(a.c)}"><div><b>${esc(a.t)}</b><small>${esc(a.s)}</small></div><div class="alert-actions">${a.kind==='deposited'?`<button class="iconbtn" data-action="mark-cleared" data-click-arg0="${esc(a.id)}">נפרע</button>`:`<button class="iconbtn" data-action="mark-deposited" data-click-arg0="${esc(a.id)}">הופקד</button>`}<button class="iconbtn" data-action="open-check-modal-2" data-click-arg0="${esc(a.id)}">עריכה</button></div></div>`).join(''):'<div class="empty">אין כרגע חריגים או פירעונות קרובים.</div>'}</div></div></section>
  </div>`;
  refreshOrdersFinanceSummary({renderIfChanged:true})
}

function kpi(label,value,accent,dot,hint){return `<div class="kpi" style="--accent:${esc(accent)};--dot:${esc(dot)}"><div class="label"><span class="dot"></span>${esc(label)}</div><div class="value">${money(value)}</div><div class="hint">${esc(hint)}</div></div>`}

return { renderDashboard, kpi };
}
