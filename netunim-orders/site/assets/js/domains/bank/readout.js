import {kupaWholeMoney} from '../../core/money.js';
import {checkMonthKey, checkTodayISO} from '../../core/dates.js';
import {normalizeSharedChecks} from '../checks/model.js';
import {
  kupaCreditScheduleData,
  kupaSyncedInstallmentsData,
  kupaAllInstallmentsData,
  kupaAccountInstallmentsData,
  kupaExpenseOccurrencesForMonthData,
  kupaExpenseBelongsToAccountData,
  kupaNextAccountCreditCycleData,
  kupaExpenseRowsBetweenData,
  kupaAccountBankBalanceData,
  kupaAccountBankAsOfDateData,
  kupaAccountCashflowData as sharedKupaAccountCashflowData,
} from '../../shared/kupa-cashflow.js';

export function kupaCreditSchedule(cr){return kupaCreditScheduleData(cr)}
export function kupaSyncedInstallments(kupa){return kupaSyncedInstallmentsData(kupa)}
export function kupaAllInstallments(kupa){return kupaAllInstallmentsData(kupa)}
export function kupaAccountInstallments(kupa,account='עסקי'){return kupaAccountInstallmentsData(kupa,account)}
export function kupaBusinessInstallments(kupa){return kupaAccountInstallmentsData(kupa,'עסקי')}
export function kupaHomeInstallments(kupa){return kupaAccountInstallmentsData(kupa,'ביתי')}
export function kupaExpenseOccurrencesForMonth(kupa,key){return kupaExpenseOccurrencesForMonthData(kupa,key)}
export function kupaNextAccountCreditCycle(kupa,account='עסקי',reference=checkTodayISO()){return kupaNextAccountCreditCycleData(kupa,account,reference)}
export function kupaNextCreditCycle(kupa,reference=checkTodayISO()){return kupaNextAccountCreditCycleData(kupa,'עסקי',reference)}
export function kupaExpenseRowsBetween(kupa,start,end){return kupaExpenseRowsBetweenData(kupa,start,end)}
export function kupaAccountBankBalance(kupa,account='עסקי'){return kupaAccountBankBalanceData(kupa,account)}
export function kupaAccountBankAsOfDate(kupa,account='עסקי',reference=checkTodayISO()){return kupaAccountBankAsOfDateData(kupa,account,reference)}
export function kupaAccountCashflowData(kupa,account='עסקי',reference=checkTodayISO()){return sharedKupaAccountCashflowData(kupa,account,reference)}

export function computeKupaNetReadoutData(state,kupa){if(!kupa||typeof kupa!=='object')return null;const bankObj=kupa.bank&&typeof kupa.bank==='object'?kupa.bank:{},rawBase=bankObj.currentBalance;if(rawBase===null||rawBase===undefined||rawBase==='')return {net:null};const sharedChecks=normalizeSharedChecks(state.checks),manualAdjustments=(Array.isArray(bankObj.adjustments)?bankObj.adjustments:[]).filter(x=>x?.type!=='check_deposit'),bank=kupaWholeMoney(rawBase)+manualAdjustments.reduce((a,x)=>a+kupaWholeMoney(x.amount),0),start=bankObj.asOfDate||(bankObj.updatedAt?String(bankObj.updatedAt).slice(0,10):checkTodayISO()),cycle=kupaNextCreditCycle(kupa,checkTodayISO()),credit=kupaBusinessInstallments(kupa).filter(x=>x.date>=start).reduce((a,x)=>a+x.amount,0),expenseRows=kupaExpenseOccurrencesForMonth(kupa,cycle.targetMonth).filter(x=>kupaExpenseBelongsToAccountData(x,'עסקי')&&(cycle.targetMonth!==checkMonthKey(start)||x.dueDate>=start)),expenses=expenseRows.reduce((a,x)=>a+kupaWholeMoney(x.amount),0),cash=(Array.isArray(kupa.cash)?kupa.cash:[]).reduce((a,x)=>a+kupaWholeMoney(x.amount),0),checks=sharedChecks.filter(x=>x.status==='בקופה'&&x.account==='עסקי').reduce((a,x)=>a+kupaWholeMoney(x.amount),0);return {bank,credit,expenses,cash,checks,kupa:checks,net:bank-credit-expenses+checks}}
