import {num} from '../../core/money.js';
import {todayISO, monthKey} from '../../core/dates.js';
import {normalizeSharedBankEvents, checksBalanceData} from '../checks/model.js';
import {accountInstallmentsData, nextAccountCreditCycleData} from '../credit/model.js';
import {expenseOccurrencesForMonthData} from '../expenses/model.js';
import {cashBalanceData} from '../cash/model.js';
import {kupaAccountCashflowData} from '../../shared/kupa-cashflow.js';

function accountRole(account){return account==='ביתי'?'ביתי':'עסקי'}
function expenseBelongsTo(row,account){return accountRole(row?.account)===accountRole(account)}
function finiteNullable(value){if(value===null||value===undefined||value==='')return null;const n=Number(value);return Number.isFinite(n)?n:null}

export function bankBaseBalanceData(state){return state.bank?.currentBalance===null||state.bank?.currentBalance===undefined?null:num(state.bank.currentBalance)}

export function bankHomeBalanceData(state){return finiteNullable(state.bank?.homeFeed?.balance)}

export function bankAdjustmentsData(state){return (Array.isArray(state.bank?.adjustments)?state.bank.adjustments:[]).filter(x=>x?.type!=='check_deposit')}

export function bankAdjustmentsTotalData(state){return bankAdjustmentsData(state).reduce((a,x)=>a+num(x.amount),0)}

export function bankAsOfDateData(state){return state.bank?.asOfDate||(state.bank?.updatedAt?String(state.bank.updatedAt).slice(0,10):todayISO())}

export function bankHomeAsOfDateData(state){const syncedAt=state.bank?.homeFeed?.syncedAt;return syncedAt?String(syncedAt).slice(0,10):todayISO()}

export function sharedChecksObservedSequenceData(sharedChecksBankEvents,state){const floor=Number(state.bank?.snapshotSeq),start=Number.isSafeInteger(floor)&&floor>=0?floor:0;return normalizeSharedBankEvents(sharedChecksBankEvents).reduce((m,e)=>Math.max(m,e.seq),start)}

// The bank snapshot is authoritative. Check workflow status is operational metadata and
// must never manufacture a bank movement on top of a synchronized (or manual) snapshot.
export function bankCurrentBalanceData(state){const b=bankBaseBalanceData(state);return b===null?null:b+bankAdjustmentsTotalData(state)}

export function bankAccountBalanceData(state,account='עסקי'){return accountRole(account)==='ביתי'?bankHomeBalanceData(state):bankCurrentBalanceData(state)}

export function bankAccountAsOfDateData(state,account='עסקי'){return accountRole(account)==='ביתי'?bankHomeAsOfDateData(state):bankAsOfDateData(state)}

export function bankAccountNextCycleCommitmentsData(state,account='עסקי',reference=todayISO()){
  const {projected,alert,...commitments}=kupaAccountCashflowData(state,account,reference);
  return commitments;
}

export function bankNextCycleCommitmentsData(state,reference=todayISO()){return bankAccountNextCycleCommitmentsData(state,'עסקי',reference)}

export function bankHomeNextCycleCommitmentsData(state,reference=todayISO()){return bankAccountNextCycleCommitmentsData(state,'ביתי',reference)}

export function bankLongTermPositionData(state){
  const b=bankCurrentBalanceData(state),start=bankAsOfDateData(state),cycle=nextAccountCreditCycleData(state,'עסקי',todayISO());
  const credit=accountInstallmentsData(state,'עסקי').filter(x=>x.date>=start).reduce((a,x)=>a+x.amount,0);
  const expenseRows=expenseOccurrencesForMonthData(state,cycle.targetMonth,false).filter(x=>expenseBelongsTo(x,'עסקי')&&(cycle.targetMonth!==monthKey(start)||x.dueDate>=start));
  const expenses=expenseRows.reduce((a,x)=>a+num(x.amount),0);
  const cash=cashBalanceData(state),checks=checksBalanceData(state),kupa=cash+checks;
  return {bank:b,credit,expenses,cash,checks,kupa,net:b===null?null:b-credit-expenses+kupa,targetMonth:cycle.targetMonth};
}

export function bankProjectedAccountCycleData(state,account='עסקי',reference=todayISO()){return kupaAccountCashflowData(state,account,reference).projected}

export function bankProjectedThisMonthData(state,reference=todayISO()){return bankProjectedAccountCycleData(state,'עסקי',reference)}

export function bankHomeProjectedThisMonthData(state,reference=todayISO()){return bankProjectedAccountCycleData(state,'ביתי',reference)}
