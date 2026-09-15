import {cashflowBreachMarkup} from '../../shared/cashflow-breakdown.js';
import {checkDateFmt} from '../../core/dates.js';
import {esc} from '../../core/values.js';
import {money} from '../../core/money.js';
import {kupaAccountCashflowData} from '../bank/readout.js';

export function bankBalanceCaptionMarkup(feed,role,kupa){
  const balance=feed?.balance===null||feed?.balance===undefined?null:Number(feed.balance),available=feed?.availableBalance===null||feed?.availableBalance===undefined?null:Number(feed.availableBalance);
    const roleName=role==='home'?'ביתי':'עסקי',difference=Number.isFinite(balance)&&Number.isFinite(available)?available-balance:null,cashflow=kupaAccountCashflowData(kupa,roleName),cashflowFacts=cashflow.projected===null?'':`<span class="bank-cashflow-summary"${cashflow.forecastIncomplete?' title="התחזית חלקית: חסרים נתוני אשראי או נדרשת בדיקה של חיוב בנק קבוע. לפירוט יש לפתוח את השינוי הצפוי"':''}><button type="button" class="bank-cashflow-metric bank-cashflow-outflow" data-action="orders-cashflow-breakdown" data-click-arg0="${role}" aria-haspopup="dialog"><span>שינוי צפוי</span><b>${money(cashflow.expectedChange)}</b></button><button type="button" data-action="orders-cashflow-breakdown" data-click-arg0="${role}" aria-haspopup="dialog" class="bank-cashflow-metric bank-cashflow-projected ${cashflow.breach.breachDate?'bank-cashflow-alert':''} ${cashflow.forecastIncomplete?'bank-cashflow-incomplete':''}"><span>עו״ש תזרימי (${esc(checkDateFmt(cashflow.targetDate))})${cashflow.forecastIncomplete?' · חלקי':''}</span><b>${money(cashflow.projected)}</b></button></span>`;
    const balanceFacts=Number.isFinite(balance)?`<div class="bank-compact-balance"><span class="bank-primary-balance"><span>יתרה ${roleName}</span><b>${money(balance)}</b></span>${Number.isFinite(available)?`<span class="bank-balance-separator" aria-hidden="true"></span><span class="bank-available-balance"><span>למשיכה</span><b>${money(available)}</b><span class="bank-balance-delta" title="הפרש בין היתרה ליתרה הזמינה למשיכה">(${money(difference)})</span></span>`:''}${cashflowFacts?`<span class="bank-balance-separator" aria-hidden="true"></span>${cashflowFacts}`:''}</div>`:'';
  return {balanceFacts,warning:cashflowBreachMarkup(cashflow)};
}

export function bankBalanceFactsMarkup(feed,role,kupa){return bankBalanceCaptionMarkup(feed,role,kupa).balanceFacts}
