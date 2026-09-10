import {kupaWholeMoney} from '../../core/money.js';
import {checkTodayISO} from '../../core/dates.js';
import {normalizeSharedChecks} from '../checks/model.js';
import {
  kupaCreditScheduleData,
  kupaSyncedInstallmentsData,
  kupaAllInstallmentsData,
  kupaAccountInstallmentsData,
  kupaExpenseOccurrencesForMonthData,
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

export function computeKupaNetReadoutData(state,kupa){if(!kupa||typeof kupa!=='object')return null;const cash=(Array.isArray(kupa.cash)?kupa.cash:[]).reduce((sum,row)=>sum+kupaWholeMoney(row.amount),0),checks=normalizeSharedChecks(state.checks),cashflow=sharedKupaAccountCashflowData({...kupa,checks},'עסקי',checkTodayISO());if(cashflow.balance===null)return {net:null,cash,...cashflow};return {...cashflow,bank:cashflow.balance,cash,kupa:cashflow.checks,net:cashflow.projected}}
