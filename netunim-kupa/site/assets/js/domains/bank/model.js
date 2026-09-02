import {num} from '../../core/money.js';
import {todayISO, monthKey} from '../../core/dates.js';
import {normalizeSharedBankEvents, checksBalanceData} from '../checks/model.js';
import {accountInstallmentsData, nextAccountCreditCycleData} from '../credit/model.js';
import {expenseOccurrencesForMonthData, expenseRowsBetweenData} from '../expenses/model.js';
import {cashBalanceData} from '../cash/model.js';

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

export function bankAccountNextCycleCommitmentsData(state,account='עסקי'){
  const role=accountRole(account),balance=bankAccountBalanceData(state,role),start=bankAccountAsOfDateData(state,role),today=todayISO(),cycle=nextAccountCreditCycleData(state,role,today);
  const elapsedCreditRows=accountInstallmentsData(state,role).filter(x=>x.date>=start&&x.date<today);
  const elapsedExpenseRows=expenseRowsBetweenData(state,start,today).filter(x=>x.dueDate<today&&expenseBelongsTo(x,role));
  const targetExpenseRows=expenseOccurrencesForMonthData(state,cycle.targetMonth,false).filter(x=>x.dueDate>=today&&expenseBelongsTo(x,role));
  const creditRows=[...elapsedCreditRows,...cycle.rows].filter((x,i,a)=>a.findIndex(y=>y.creditId===x.creditId&&y.part===x.part)===i);
  const expenseRows=[...elapsedExpenseRows,...targetExpenseRows].filter((x,i,a)=>a.findIndex(y=>y.id===x.id&&y.dueDate===x.dueDate)===i);
  const credit=creditRows.reduce((a,x)=>a+x.amount,0),expenses=expenseRows.reduce((a,x)=>a+num(x.amount),0),targetExpenseTotal=targetExpenseRows.reduce((a,x)=>a+num(x.amount),0);
  return {account:role,balance,credit,expenses,total:credit+expenses,start,end:cycle.targetEnd,targetMonth:cycle.targetMonth,nextCreditRows:cycle.rows,nextCreditTotal:cycle.total,elapsedCredit:elapsedCreditRows.reduce((a,x)=>a+x.amount,0),elapsedExpenses:elapsedExpenseRows.reduce((a,x)=>a+num(x.amount),0),targetExpenseRows,targetExpenseTotal};
}

export function bankNextCycleCommitmentsData(state){return bankAccountNextCycleCommitmentsData(state,'עסקי')}

export function bankHomeNextCycleCommitmentsData(state){return bankAccountNextCycleCommitmentsData(state,'ביתי')}

export function bankLongTermPositionData(state){
  const b=bankCurrentBalanceData(state),start=bankAsOfDateData(state),cycle=nextAccountCreditCycleData(state,'עסקי',todayISO());
  const credit=accountInstallmentsData(state,'עסקי').filter(x=>x.date>=start).reduce((a,x)=>a+x.amount,0);
  const expenseRows=expenseOccurrencesForMonthData(state,cycle.targetMonth,false).filter(x=>expenseBelongsTo(x,'עסקי')&&(cycle.targetMonth!==monthKey(start)||x.dueDate>=start));
  const expenses=expenseRows.reduce((a,x)=>a+num(x.amount),0);
  const cash=cashBalanceData(state),checks=checksBalanceData(state),kupa=cash+checks;
  return {bank:b,credit,expenses,cash,checks,kupa,net:b===null?null:b-credit-expenses+kupa,targetMonth:cycle.targetMonth};
}

export function bankProjectedAccountCycleData(state,account='עסקי'){const b=bankAccountBalanceData(state,account);if(b===null)return null;return b-bankAccountNextCycleCommitmentsData(state,account).total}

export function bankProjectedThisMonthData(state){return bankProjectedAccountCycleData(state,'עסקי')}

export function bankHomeProjectedThisMonthData(state){return bankProjectedAccountCycleData(state,'ביתי')}
