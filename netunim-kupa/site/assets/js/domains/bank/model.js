import {num} from '../../core/money.js';
import {todayISO, monthKey} from '../../core/dates.js';
import {normalizeSharedBankEvents, checksBalanceData} from '../checks/model.js';
import {allInstallmentsData, nextCreditCycleData} from '../credit/model.js';
import {expenseOccurrencesForMonthData, expenseRowsBetweenData} from '../expenses/model.js';
import {cashBalanceData} from '../cash/model.js';

export function bankBaseBalanceData(state){return state.bank?.currentBalance===null||state.bank?.currentBalance===undefined?null:num(state.bank.currentBalance)}

export function bankAdjustmentsData(state){return (Array.isArray(state.bank?.adjustments)?state.bank.adjustments:[]).filter(x=>x?.type!=='check_deposit')}

export function bankAdjustmentsTotalData(state){return bankAdjustmentsData(state).reduce((a,x)=>a+num(x.amount),0)}

export function bankAsOfDateData(state){return state.bank?.asOfDate||(state.bank?.updatedAt?String(state.bank.updatedAt).slice(0,10):todayISO())}

export function sharedChecksObservedSequenceData(sharedChecksBankEvents,state){const floor=Number(state.bank?.snapshotSeq),start=Number.isSafeInteger(floor)&&floor>=0?floor:0;return normalizeSharedBankEvents(sharedChecksBankEvents).reduce((m,e)=>Math.max(m,e.seq),start)}

// The bank snapshot is authoritative. Check workflow status is operational metadata and
// must never manufacture a bank movement on top of a synchronized (or manual) snapshot.
export function bankCurrentBalanceData(state){const b=bankBaseBalanceData(state);return b===null?null:b+bankAdjustmentsTotalData(state)}

export function bankNextCycleCommitmentsData(state){
  const b=bankCurrentBalanceData(state);const start=bankAsOfDateData(state),today=todayISO(),cycle=nextCreditCycleData(state,today);
  if(b===null)return {credit:0,expenses:0,total:0,start,end:cycle.targetEnd,targetMonth:cycle.targetMonth,nextCreditRows:cycle.rows,nextCreditTotal:cycle.total,elapsedCredit:0,elapsedExpenses:0,targetExpenseRows:[]};
  const elapsedCreditRows=allInstallmentsData(state).filter(x=>x.date>=start&&x.date<today);
  const elapsedExpenseRows=expenseRowsBetweenData(state,start,today).filter(x=>x.dueDate<today);
  const targetExpenseRows=expenseOccurrencesForMonthData(state,cycle.targetMonth,false).filter(x=>x.dueDate>=today);
  const creditRows=[...elapsedCreditRows,...cycle.rows].filter((x,i,a)=>a.findIndex(y=>y.creditId===x.creditId&&y.part===x.part)===i);
  const expenseRows=[...elapsedExpenseRows,...targetExpenseRows].filter((x,i,a)=>a.findIndex(y=>y.id===x.id&&y.dueDate===x.dueDate)===i);
  const credit=creditRows.reduce((a,x)=>a+x.amount,0),expenses=expenseRows.reduce((a,x)=>a+num(x.amount),0);
  return {credit,expenses,total:credit+expenses,start,end:cycle.targetEnd,targetMonth:cycle.targetMonth,nextCreditRows:cycle.rows,nextCreditTotal:cycle.total,elapsedCredit:elapsedCreditRows.reduce((a,x)=>a+x.amount,0),elapsedExpenses:elapsedExpenseRows.reduce((a,x)=>a+num(x.amount),0),targetExpenseRows};
}

export function bankLongTermPositionData(state){
  const b=bankCurrentBalanceData(state);const start=bankAsOfDateData(state),cycle=nextCreditCycleData(state,todayISO());
  if(b===null)return {bank:null,credit:0,expenses:0,cash:cashBalanceData(state),checks:checksBalanceData(state),kupa:cashBalanceData(state)+checksBalanceData(state),net:null,targetMonth:cycle.targetMonth};
  const credit=allInstallmentsData(state).filter(x=>x.date>=start).reduce((a,x)=>a+x.amount,0);
  const expenseRows=expenseOccurrencesForMonthData(state,cycle.targetMonth,false).filter(x=>cycle.targetMonth!==monthKey(start)||x.dueDate>=start);
  const expenses=expenseRows.reduce((a,x)=>a+num(x.amount),0);
  const cash=cashBalanceData(state),checks=checksBalanceData(state),kupa=cash+checks;
  return {bank:b,credit,expenses,cash,checks,kupa,net:b-credit-expenses+kupa,targetMonth:cycle.targetMonth};
}

export function bankProjectedThisMonthData(state){const b=bankCurrentBalanceData(state);if(b===null)return null;return b-bankNextCycleCommitmentsData(state).total}
