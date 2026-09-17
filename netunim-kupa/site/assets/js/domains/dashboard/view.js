import {esc} from '../../core/values.js';
import {money, moneyWithCents, formatNullableMoney} from '../../core/money.js';
import {dateFmt, daysFromToday, monthLabel} from '../../core/dates.js';
import {cashflowBreachMarkup} from '../../shared/cashflow-breakdown.js';
import {dashboardNetPositionData} from './model.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createDomainsDashboardView({model, activeChecks, depositedChecks, bankLongTermPosition, bankAsOfDate, bankHomeAsOfDate, bankCurrentBalance, bankHomeBalance, bankNextCycleCommitments, bankHomeNextCycleCommitments, bankProjectedThisMonth, bankHomeProjectedThisMonth, ordersFinanceSummary=()=>null, refreshOrdersFinanceSummary=async()=>false}){
function bankSnapshotLabel(){
  if(!model.state.bank?.updatedAt)return 'היתרה העסקית טרם סונכרנה.';
  const source=model.state.bank.source==='hapoalim'?'בנק הפועלים':'נתון קודם — מומלץ לרענן מהבנק';
  const account=model.state.bank.sourceAccount?` · חשבון עסקי ${model.state.bank.sourceAccount}`:'';
  return `${source} · ${dateFmt(bankAsOfDate())} · ${new Date(model.state.bank.updatedAt).toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'})}${account}`;
}

function homeBankSnapshotLabel(){
  const feed=model.state.bank?.homeFeed;if(!feed?.syncedAt)return 'היתרה הביתית טרם סונכרנה.';
  const account=feed.accountNumber?` · חשבון ביתי ${feed.accountNumber}`:'';
  return `בנק הפועלים · ${dateFmt(bankHomeAsOfDate())} · ${new Date(feed.syncedAt).toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'})}${account}`;
}

function bankOverviewMarkup(){
  const bank=bankCurrentBalance(),cycle=bankNextCycleCommitments(),after=bankProjectedThisMonth(),cycleLabel=monthLabel(cycle.targetMonth),cycleDate=dateFmt(cycle.targetDate);
  const homeBank=bankHomeBalance(),homeCycle=bankHomeNextCycleCommitments(),homeAfter=bankHomeProjectedThisMonth(),homeCycleLabel=monthLabel(homeCycle.targetMonth),homeCycleDate=dateFmt(homeCycle.targetDate);
  const businessCashflowAlert={active:!!cycle.breach.breachDate},homeCashflowAlert={active:!!homeCycle.breach.breachDate};
  return `<div class="bank-balance-card dashboard-bank-overview">
    <section class="bank-account-overview business">
      <div class="bank-account-summary-label business"><b>חשבון עסקי</b><span>התחייבויות עסקיות בלבד</span></div>
      <div class="bank-account-overview-body">
        <div class="bank-entry">
          <label>עובר ושב עסקי בבנק — היתרה לחישובי הקופה</label>
          <div class="bank-readonly-value">${formatNullableMoney(bank)}</div>
          <small>${esc(bankSnapshotLabel())} · החשבון העסקי מחושב מול אשראי והוצאות עסקיים ובתוספת צ׳קים עסקיים צפויים</small>
        </div>
        <div class="bank-account-metrics">
          <div class="bank-mini"><div class="bank-label">אשראי עסקי עד אופק התזרים</div><div class="bank-value">${money(cycle.nextCreditTotal)}</div><div class="muted">${cycle.nextCreditCycles.length?`${esc(cycle.nextCreditCycles.length)} מחזורים עד ${esc(cycleDate)} · ${esc(cycleLabel)}`:'אין חיובי אשראי עסקיים עתידיים'}${cycle.forecastIncomplete?' · אומדן ₪ חלקי: חסר סכום מלא או שכיסוי החברה הוא LKG/חסר':''}</div></div>
          <div class="bank-mini"><div class="bank-label">הוצאות עסקיות עד אופק התזרים</div><div class="bank-value">${money(cycle.targetExpenseTotal)}</div><div class="muted">כל ההוצאות העסקיות עד ${esc(cycleDate)}</div></div>
          <div class="bank-mini positive"><div class="bank-label">צ׳קים עסקיים לתזרים</div><div class="bank-value">+${money(cycle.checks)}</div><div class="muted">צ׳קים בקופה עד ${esc(dateFmt(cycle.checkCutoffDate))}, ולא מעבר לאופק</div></div>
          <button type="button" class="bank-mini cashflow-breakdown-trigger" data-action="cashflow-breakdown" data-click-arg0="business" aria-haspopup="dialog"><span class="bank-label">שינוי צפוי ⓘ</span><span class="bank-value">${moneyWithCents(cycle.expectedChange)}</span><span class="muted">לחץ לפירוט סכומים ומועדים</span></button>
          <button type="button" data-action="cashflow-breakdown" data-click-arg0="business" aria-haspopup="dialog" class="bank-mini cashflow-breakdown-trigger ${esc(businessCashflowAlert.active?'cashflow-alert':after!==null&&after>=0?'positive':'warning')}"><span class="bank-label">עו״ש עסקי באופק ${esc(cycleDate)}${cycle.forecastIncomplete?' · תחזית חלקית':''}</span><span class="bank-value">${formatNullableMoney(after)}</span><span class="muted">עו״ש פחות מחזורי אשראי והוצאות עד האופק, ובתוספת צ׳קים עד אותו אופק${cycle.forecastIncomplete?' · יש לבדוק את הנתונים החסרים בפירוט השינוי הצפוי':''}</span></button>
        </div>
      </div>
      ${cashflowBreachMarkup(cycle)}
    </section>
    <section class="bank-account-overview home">
      <div class="bank-account-summary-label home"><b>חשבון ביתי</b><span>התחייבויות ביתיות בלבד</span></div>
      <div class="bank-account-overview-body">
        <div class="bank-entry bank-home-entry">
          <label>עובר ושב ביתי בבנק — היתרה לחישובי הבית</label>
          <div class="bank-readonly-value">${formatNullableMoney(homeBank)}</div>
          <small>${esc(homeBankSnapshotLabel())} · החשבון הביתי מחושב מול אשראי והוצאות ביתיים ובתוספת צ׳קים ביתיים צפויים</small>
        </div>
        <div class="bank-account-metrics">
          <div class="bank-mini"><div class="bank-label">אשראי ביתי עד אופק התזרים</div><div class="bank-value">${money(homeCycle.nextCreditTotal)}</div><div class="muted">${homeCycle.nextCreditCycles.length?`${esc(homeCycle.nextCreditCycles.length)} מחזורים עד ${esc(homeCycleDate)} · ${esc(homeCycleLabel)}`:'אין חיובי אשראי ביתיים עתידיים'}${homeCycle.forecastIncomplete?' · אומדן ₪ חלקי: חסר סכום מלא או שכיסוי החברה הוא LKG/חסר':''}</div></div>
          <div class="bank-mini"><div class="bank-label">הוצאות ביתיות עד אופק התזרים</div><div class="bank-value">${money(homeCycle.targetExpenseTotal)}</div><div class="muted">כל ההוצאות הביתיות עד ${esc(homeCycleDate)}</div></div>
          <div class="bank-mini positive"><div class="bank-label">צ׳קים ביתיים לתזרים</div><div class="bank-value">+${money(homeCycle.checks)}</div><div class="muted">צ׳קים בקופה עד ${esc(dateFmt(homeCycle.checkCutoffDate))}, ולא מעבר לאופק</div></div>
          <button type="button" class="bank-mini cashflow-breakdown-trigger" data-action="cashflow-breakdown" data-click-arg0="home" aria-haspopup="dialog"><span class="bank-label">שינוי צפוי ⓘ</span><span class="bank-value">${moneyWithCents(homeCycle.expectedChange)}</span><span class="muted">לחץ לפירוט סכומים ומועדים</span></button>
          <button type="button" data-action="cashflow-breakdown" data-click-arg0="home" aria-haspopup="dialog" class="bank-mini cashflow-breakdown-trigger ${esc(homeCashflowAlert.active?'cashflow-alert':homeAfter!==null&&homeAfter>=0?'positive':'warning')}"><span class="bank-label">עו״ש ביתי באופק ${esc(homeCycleDate)}${homeCycle.forecastIncomplete?' · תחזית חלקית':''}</span><span class="bank-value">${formatNullableMoney(homeAfter)}</span><span class="muted">עו״ש פחות מחזורי אשראי והוצאות עד האופק, ובתוספת צ׳קים עד אותו אופק${homeCycle.forecastIncomplete?' · יש לבדוק את הנתונים החסרים בפירוט השינוי הצפוי':''}</span></button>
        </div>
      </div>
      ${cashflowBreachMarkup(homeCycle)}
    </section>
  </div>`;
}

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
  const partial=long.forecastIncomplete===true,partialFacts=[long.missingAmountCount?`${long.missingAmountCount} ללא סכום ₪`:null,long.coverageGapCount?`${long.coverageGapCount} בכיסוי חברה חסר/ישן`:null,long.unassignedCount?`${long.unassignedCount} ללא מועד חיוב ודאי`:null].filter(Boolean);
  document.getElementById('content').innerHTML=`
  ${bankOverviewMarkup()}
  <div class="net-summary dashboard-net-summary"><div class="net-mini"><span>סה״כ קופה</span><b>+ ${money(long.kupa)}</b><small>מזומן + צקים שטרם הופקדו</small></div><div class="net-mini"><span>חוב לקוחות פתוח</span><b>${long.customerOpen===null?'—':`+ ${money(long.customerOpen)}`}</b></div><div class="net-mini"><span>נטו ספקים</span><b>${long.supplierNet===null?'—':money(long.supplierNet)}</b></div><div class="net-total"><span>מאזן כולל נטו${partial?' · חלקי':''}</span><b>${formatNullableMoney(long.net)}</b><small>עו״ש עסקי − כל האשראים העסקיים העתידיים − חודש הוצאות עסקיות + קופה + חוב לקוחות פתוח + נטו ספקים${partial?' · מבוסס על סכומי ₪ הידועים כרגע':''}${partialFacts.length?` · ${esc(partialFacts.join(' · '))}`:''}</small></div></div>
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

function kpi(label,value,accent,dot,hint,formatValue=money){return `<div class="kpi" style="--accent:${esc(accent)};--dot:${esc(dot)}"><div class="label"><span class="dot"></span>${esc(label)}</div><div class="value">${formatValue(value)}</div><div class="hint">${esc(hint)}</div></div>`}

return { renderDashboard, kpi };
}
