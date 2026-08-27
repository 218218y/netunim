import {num} from '../../core/money.js';
import {todayISO, monthKey} from '../../core/dates.js';
import {normalizeSharedChecks, checkBankEffectAmount, normalizeSharedBankEvents, checksBalanceData} from '../checks/model.js';
import {allInstallmentsData, nextCreditCycleData} from '../credit/model.js';
import {expenseOccurrencesForMonthData, expenseRowsBetweenData} from '../expenses/model.js';
import {cashBalanceData} from '../cash/model.js';

export function bankBaseBalanceData(state){return state.bank?.currentBalance===null||state.bank?.currentBalance===undefined?null:num(state.bank.currentBalance)}

export function bankAdjustmentsData(state){return (Array.isArray(state.bank?.adjustments)?state.bank.adjustments:[]).filter(x=>x?.type!=='check_deposit')}

export function bankAdjustmentsTotalData(state){return bankAdjustmentsData(state).reduce((a,x)=>a+num(x.amount),0)}

export function bankAsOfDateData(state){return state.bank?.asOfDate||(state.bank?.updatedAt?String(state.bank.updatedAt).slice(0,10):todayISO())}

export function pendingSharedCheckBankDeltaData(sharedChecksBase,state){if(!sharedChecksBase)return 0;const base=new Map(normalizeSharedChecks(sharedChecksBase).map(c=>[c.id,c])),local=new Map(normalizeSharedChecks(state.checks).map(c=>[c.id,c])),ids=new Set([...base.keys(),...local.keys()]);let total=0;for(const id of ids)total+=checkBankEffectAmount(local.get(id))-checkBankEffectAmount(base.get(id));return total}

export function sharedChecksObservedSequenceData(sharedChecksBankEvents,state){const floor=Number(state.bank?.snapshotSeq),start=Number.isSafeInteger(floor)&&floor>=0?floor:0;return normalizeSharedBankEvents(sharedChecksBankEvents).reduce((m,e)=>Math.max(m,e.seq),start)}

export function checkDepositedAfterBankSnapshotData(state,c){if(!c||!['הופקד - במעקב','נפרע'].includes(c.status))return false;const depositSeq=Number(c.depositSeq),snapshotSeq=Number(state.bank?.snapshotSeq);if(Number.isSafeInteger(depositSeq)&&depositSeq>0&&Number.isSafeInteger(snapshotSeq)&&snapshotSeq>0)return depositSeq>snapshotSeq;const updatedAt=state.bank?.updatedAt,asOf=bankAsOfDateData(state);if(c.depositedAt&&updatedAt){const a=Date.parse(c.depositedAt),b=Date.parse(updatedAt);if(Number.isFinite(a)&&Number.isFinite(b))return a>b}return !!(c.depositDate&&asOf&&c.depositDate>asOf)}

export function bankDerivedCheckDepositsData(state){return normalizeSharedChecks(state.checks).filter((...args)=>checkDepositedAfterBankSnapshotData(state,...args))}

export function legacyCheckDepositFallbacksData(state){const derived=new Set(bankDerivedCheckDepositsData(state).map(x=>x.id));return (Array.isArray(state.bank?.adjustments)?state.bank.adjustments:[]).filter(x=>x?.type==='check_deposit'&&!derived.has(String(x.refId||'')))}

export function bankCheckEffectsTotalData(sharedChecksBankEvents,sharedChecksBase,state){const snapshotSeq=Number(state.bank?.snapshotSeq);if(Number.isSafeInteger(snapshotSeq)&&snapshotSeq>=0)return normalizeSharedBankEvents(sharedChecksBankEvents).filter(e=>e.seq>snapshotSeq).reduce((a,e)=>a+num(e.delta),0)+pendingSharedCheckBankDeltaData(sharedChecksBase,state);return bankDerivedCheckDepositsData(state).reduce((a,x)=>a+num(x.amount),0)+legacyCheckDepositFallbacksData(state).reduce((a,x)=>a+num(x.amount),0)}

export function bankCurrentBalanceData(sharedChecksBankEvents,sharedChecksBase,state){const b=bankBaseBalanceData(state);return b===null?null:b+bankAdjustmentsTotalData(state)+bankCheckEffectsTotalData(sharedChecksBankEvents,sharedChecksBase,state)}

export function bankNextCycleCommitmentsData(sharedChecksBankEvents,sharedChecksBase,state){
  const b=bankCurrentBalanceData(sharedChecksBankEvents,sharedChecksBase,state);const start=bankAsOfDateData(state),today=todayISO(),cycle=nextCreditCycleData(state,today);
  if(b===null)return {credit:0,expenses:0,total:0,start,end:cycle.targetEnd,targetMonth:cycle.targetMonth,nextCreditRows:cycle.rows,nextCreditTotal:cycle.total,elapsedCredit:0,elapsedExpenses:0,targetExpenseRows:[]};
  const elapsedCreditRows=allInstallmentsData(state).filter(x=>x.date>=start&&x.date<today);
  const elapsedExpenseRows=expenseRowsBetweenData(state,start,today).filter(x=>x.dueDate<today);
  const targetExpenseRows=expenseOccurrencesForMonthData(state,cycle.targetMonth,false).filter(x=>x.dueDate>=today);
  const creditRows=[...elapsedCreditRows,...cycle.rows].filter((x,i,a)=>a.findIndex(y=>y.creditId===x.creditId&&y.part===x.part)===i);
  const expenseRows=[...elapsedExpenseRows,...targetExpenseRows].filter((x,i,a)=>a.findIndex(y=>y.id===x.id&&y.dueDate===x.dueDate)===i);
  const credit=creditRows.reduce((a,x)=>a+x.amount,0),expenses=expenseRows.reduce((a,x)=>a+num(x.amount),0);
  return {credit,expenses,total:credit+expenses,start,end:cycle.targetEnd,targetMonth:cycle.targetMonth,nextCreditRows:cycle.rows,nextCreditTotal:cycle.total,elapsedCredit:elapsedCreditRows.reduce((a,x)=>a+x.amount,0),elapsedExpenses:elapsedExpenseRows.reduce((a,x)=>a+num(x.amount),0),targetExpenseRows};
}

export function bankLongTermPositionData(sharedChecksBankEvents,sharedChecksBase,state){
  const b=bankCurrentBalanceData(sharedChecksBankEvents,sharedChecksBase,state);const start=bankAsOfDateData(state),cycle=nextCreditCycleData(state,todayISO());
  if(b===null)return {bank:null,credit:0,expenses:0,cash:cashBalanceData(state),checks:checksBalanceData(state),kupa:cashBalanceData(state)+checksBalanceData(state),net:null,targetMonth:cycle.targetMonth};
  const credit=allInstallmentsData(state).filter(x=>x.date>=start).reduce((a,x)=>a+x.amount,0);
  const expenseRows=expenseOccurrencesForMonthData(state,cycle.targetMonth,false).filter(x=>cycle.targetMonth!==monthKey(start)||x.dueDate>=start);
  const expenses=expenseRows.reduce((a,x)=>a+num(x.amount),0);
  const cash=cashBalanceData(state),checks=checksBalanceData(state),kupa=cash+checks;
  return {bank:b,credit,expenses,cash,checks,kupa,net:b-credit-expenses+kupa,targetMonth:cycle.targetMonth};
}

export function bankProjectedThisMonthData(sharedChecksBankEvents,sharedChecksBase,state){const b=bankCurrentBalanceData(sharedChecksBankEvents,sharedChecksBase,state);if(b===null)return null;return b-bankNextCycleCommitmentsData(sharedChecksBankEvents,sharedChecksBase,state).total}
