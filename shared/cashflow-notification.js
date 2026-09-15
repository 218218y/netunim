import {cashflowAlertForAccount,normalizeCashflowSettings} from './cashflow.js';
import {creditBillingISODate} from './credit-billing-cycles.js';

function today(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}

// Consume the engine's warning window, which can extend beyond the displayed
// projection. Legacy callers without one retain their lead-day policy.
// Net same-day movements together; never invent intraday order.
export function cashflowNotificationData(cashflow,settings={},reference=today()){
  const asOf=creditBillingISODate(reference)||today(),normalized=normalizeCashflowSettings(settings),role=cashflow.account,leadDays=role==='ביתי'?normalized.homeAlertLeadDays:normalized.businessAlertLeadDays;
  const window=cashflow.warningProjection||cashflow;
  const base=cashflowAlertForAccount(cashflow.balance,settings,role),result={...base,active:false,breachDate:'',daysUntilBreach:null,leadDays,projectedAtHorizon:cashflow.projected,warningTargetDate:window.targetDate||'',forecastIncomplete:!!window.forecastIncomplete};
  if(cashflow.balance===null||cashflow.balance===undefined||!Number.isFinite(Number(cashflow.balance)))return result;
  const movements=new Map();
  const add=(rows,sign,dateKey)=>{for(const row of rows||[]){const due=creditBillingISODate(row[dateKey]);if(!due)continue;const date=due<asOf?asOf:due;movements.set(date,(movements.get(date)||0)+sign*Math.round(Number(row.amount||0)*100))}};
  add(window.creditRows,-1,'date');add(window.expenseRows,-1,'dueDate');add(window.checkRows,1,'dueDate');
  let cents=Math.round(Number(cashflow.balance)*100);
  const breach=(date)=>{const alert=cashflowAlertForAccount(cents/100,settings,role),daysUntilBreach=Math.round((Date.parse(date)-Date.parse(asOf))/86400000);return alert.active?{...result,...alert,active:window.notifyThroughHorizon===true||daysUntilBreach<=leadDays,breachDate:date,daysUntilBreach}:null};
  // A bank balance already below the threshold warrants an immediate notification.
  const current=breach(asOf);if(current)return current;
  for(const [date,delta] of [...movements].sort(([a],[b])=>a.localeCompare(b))){cents+=delta;const warning=breach(date);if(warning)return warning}
  return {...result,reason:'ok'};
}
