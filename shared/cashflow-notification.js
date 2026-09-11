import {cashflowAlertForAccount,normalizeCashflowSettings} from './cashflow.js';
import {creditBillingISODate} from './credit-billing-cycles.js';

function today(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}

// Notification timing only: use the exact contributions already selected by the
// cash-flow engine. Net same-day movements together; never invent intraday order.
export function cashflowNotificationData(cashflow,settings={},reference=today()){
  const asOf=creditBillingISODate(reference)||today(),normalized=normalizeCashflowSettings(settings),role=cashflow.account,leadDays=role==='ביתי'?normalized.homeAlertLeadDays:normalized.businessAlertLeadDays;
  const base=cashflowAlertForAccount(cashflow.balance,settings,role),result={...base,active:false,breachDate:'',daysUntilBreach:null,leadDays,projectedAtHorizon:cashflow.projected};
  if(cashflow.balance===null||cashflow.balance===undefined||!Number.isFinite(Number(cashflow.balance)))return result;
  const movements=new Map();
  const add=(rows,sign,dateKey)=>{for(const row of rows||[]){const due=creditBillingISODate(row[dateKey]);if(!due)continue;const date=due<asOf?asOf:due;movements.set(date,(movements.get(date)||0)+sign*Math.round(Number(row.amount||0)*100))}};
  add(cashflow.creditRows,-1,'date');add(cashflow.expenseRows,-1,'dueDate');add(cashflow.checkRows,1,'dueDate');
  let cents=Math.round(Number(cashflow.balance)*100);
  const breach=(date)=>{const alert=cashflowAlertForAccount(cents/100,settings,role),daysUntilBreach=Math.round((Date.parse(date)-Date.parse(asOf))/86400000);return alert.active?{...result,...alert,active:daysUntilBreach<=leadDays,breachDate:date,daysUntilBreach}:null};
  // A bank balance already below the threshold warrants an immediate notification.
  const current=breach(asOf);if(current)return current;
  for(const [date,delta] of [...movements].sort(([a],[b])=>a.localeCompare(b))){cents+=delta;const warning=breach(date);if(warning)return warning}
  return {...result,reason:'ok'};
}
