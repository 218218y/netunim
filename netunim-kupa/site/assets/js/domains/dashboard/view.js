import {esc} from '../../core/values.js';
import {money, formatNullableMoney} from '../../core/money.js';
import {HEB_MONTHS, dateFmt, daysFromToday, monthLabel} from '../../core/dates.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createDomainsDashboardView({model, activeChecks, depositedChecks, cashBalance, checksBalance, depositedBalance, pendingBusinessInstallments, monthSumBusinessInstallments, monthSumExpenses, bankNextCycleCommitments, bankLongTermPosition, bankProjectedThisMonth}){
function renderDashboard(){
  const now=new Date();
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
  const months=[];for(let i=0;i<6;i++){const d=new Date(now.getFullYear(),now.getMonth()+i,1),k=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;months.push({k,label:HEB_MONTHS[d.getMonth()],credit:monthSumBusinessInstallments(k,true)+monthSumExpenses(k,true)})}
  const max=Math.max(1,...months.map(x=>Math.abs(x.credit)));
  const cycle=bankNextCycleCommitments(),bankAfter=bankProjectedThisMonth(),long=bankLongTermPosition(),cycleLabel=monthLabel(cycle.targetMonth),futureCreditRows=pendingBusinessInstallments(),futureCreditTotal=futureCreditRows.reduce((a,x)=>a+x.amount,0);
  document.getElementById('content').innerHTML=`
  <div class="grid kpis">
   ${kpi('מזומן בקופה',cashBalance(),'#edf4f1','#638f87','יתרת תנועות המזומן',{page:'cash',tab:''})}
   ${kpi('צקים בקופה',checksBalance(),'#eef2f3','#76929a',`${activeChecks().length} צקים פתוחים`,{page:'checks',tab:'open'})}
   ${kpi('סה״כ קופה',cashBalance()+checksBalance(),'#eff4ef','#72957b','מזומן + צקים שטרם הופקדו',{page:'checks',tab:'open'})}
   ${kpi('הופקדו במעקב',depositedBalance(),'#f7f1e8','#b78b57',`${depositedChecks().length} צקים ממתינים`,{page:'checks',tab:'deposited'})}
  </div>
  <div class="grid kpis" style="margin-top:16px">
   ${kpi('סה״כ אשראי עסקי עתידי',futureCreditTotal,'#f7efe7','#c59661',futureCreditRows.length?`${futureCreditRows.length} חיובים עתידיים שנותרו`:'אין חיובי אשראי עתידיים',{page:'credit',tab:''})}
   ${kpi('אשראי עסקי במחזור הקרוב',cycle.nextCreditTotal,'#edf4f1','#638f87',cycle.nextCreditRows.length?`החיובים הקרובים עד ${dateFmt(cycle.end)} · ${cycleLabel}`:'אין חיוב אשראי עתידי',{page:'credit',tab:''})}
   ${kpiDisplay('עו״ש אחרי המחזור הקרוב',bankAfter,'#eff3f0','#5f7c77',bankAfter===null?'יש להזין יתרת עו״ש בטאב בנק':`כולל אשראי עסקי קרוב + הוצאות ${cycleLabel}`,{page:'bank',tab:''})}
   ${kpiDisplay('מאזן כולל נטו',long.net,'#edf3ef','#557a68',long.net===null?'יש להזין יתרת עו״ש':`עו״ש − כל האשראי העסקי העתידי − חודש הוצאות + קופה`,{page:'bank',tab:''})}
  </div>
  <div class="grid two" style="margin-top:16px">
   <section class="section"><div class="section-head"><div><h3>פעולות מהירות</h3></div></div><div class="section-body"><div class="quick">
    <button data-action="open-check-modal"><b>+ צק חדש</b><span>שם, סכום ותאריך פירעון</span></button>
    <button data-action="open-credit-modal"><b>+ עסקת אשראי</b><span>סכום, כרטיס ומספר תשלומים</span></button>
    <button data-action="set-page"><b>בנק ועו״ש</b><span>יתרה, מחזור קרוב ומאזן כולל</span></button>
   </div></div></section>
   <section class="section"><div class="section-head"><div><h3>דורש תשומת לב</h3></div><span class="badge ${esc(criticalAlerts.length?'red':'green')}">${esc(criticalAlerts.length)} חריגים${upcomingAlerts.length?` · ${upcomingAlerts.length} קרובים`:''}</span></div><div class="section-body"><div class="alert-list">${alerts.length?alerts.map(a=>`<div class="alert" style="--c:${esc(a.c)}"><div><b>${esc(a.t)}</b><small>${esc(a.s)}</small></div><div class="alert-actions">${a.kind==='deposited'?`<button class="iconbtn" data-action="mark-cleared" data-click-arg0="${esc(a.id)}">נפרע</button>`:`<button class="iconbtn" data-action="mark-deposited" data-click-arg0="${esc(a.id)}">הופקד</button>`}<button class="iconbtn" data-action="open-check-modal-2" data-click-arg0="${esc(a.id)}">עריכה</button></div></div>`).join(''):'<div class="empty">אין כרגע חריגים או פירעונות קרובים.</div>'}</div></div></section>
  </div>
  <section class="section" style="margin-top:16px"><div class="section-head"><div><h3>6 חודשים קדימה — אשראי עסקי והוצאות</h3></div></div><div class="section-body"><div class="bar-list">${months.map(x=>barRow(x.label,x.credit,max,'#638f87')).join('')}</div></div></section>`}

function kpiAttrs(action){
  if(!action)return '';
  return ` role="button" tabindex="0" data-action="dashboard-go" data-keydown="dashboard-keyboard" data-page="${esc(action.page)}" data-tab="${esc(action.tab||'')}"`;
}

function kpiDisplay(label,value,accent,dot,hint,action=''){return `<div class="kpi${esc(action?' clickable':'')}" style="--accent:${esc(accent)};--dot:${esc(dot)}"${kpiAttrs(action)}><div class="label"><span class="dot"></span>${esc(label)}</div><div class="value">${formatNullableMoney(value)}</div><div class="hint">${esc(hint)}</div></div>`}

function kpi(label,value,accent,dot,hint,action=''){return `<div class="kpi${esc(action?' clickable':'')}" style="--accent:${esc(accent)};--dot:${esc(dot)}"${kpiAttrs(action)}><div class="label"><span class="dot"></span>${esc(label)}</div><div class="value">${money(value)}</div><div class="hint">${esc(hint)}</div></div>`}

function barRow(label,val,max,c){return `<div class="bar-row"><b>${esc(label)}</b><div class="bar"><i style="--bar:${esc(c)};width:${esc(Math.max(2,val/max*100))}%"></i></div><div class="num">${money(val)}</div></div>`}

return { renderDashboard, kpiAttrs, kpiDisplay, kpi, barRow };
}
