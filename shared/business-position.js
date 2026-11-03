import {kupaAccountCashflowData,kupaOutstandingCreditRowsData,kupaExpenseOccurrencesForMonthData,kupaExpenseBelongsToAccountData} from './kupa-cashflow.js';
import {bankRecurringExpensesData} from './bank-recurring-debits.js';

export function financeMoneySum(values){return values.reduce((sum,value)=>sum+Math.round(Number(value||0)*100),0)/100}

// This is a position over all known commitments, not a forecast to one date.
// Start from the bank itself: no forecast cheques or credit are added twice.
// Preserve the existing one expense-month policy, independent of card lifetime.
export function kupaBusinessPositionData(state,reference){
  const cycle=kupaAccountCashflowData(state,'עסקי',reference),bank=cycle.balance;
  const outstanding=kupaOutstandingCreditRowsData(state,'עסקי',reference);
  const creditRows=outstanding.filter(row=>row.date&&row.includedInIlsTotal&&Math.abs(row.amount)>0.004);
  const incompleteCreditRows=outstanding.filter(row=>!row.includedInIlsTotal||row.coverageIncomplete);
  const [year,month]=cycle.targetMonth.split('-').map(Number),expenseEnd=`${cycle.targetMonth}-${new Date(Date.UTC(year,month,0)).getUTCDate()}`;
  const recurring=bankRecurringExpensesData(state,'עסקי',cycle.reference,expenseEnd);
  const expenseRows=[...kupaExpenseOccurrencesForMonthData(state,cycle.targetMonth).filter(row=>kupaExpenseBelongsToAccountData(row,'עסקי')&&row.dueDate>=cycle.start),...recurring.rows];
  const checkRows=(Array.isArray(state.checks)?state.checks:[]).filter(row=>row.status==='בקופה'&&kupaExpenseBelongsToAccountData(row,'עסקי'));
  const credit=financeMoneySum(creditRows.map(row=>row.amount)),expenses=financeMoneySum(expenseRows.map(row=>row.amount)),checks=financeMoneySum(checkRows.map(row=>row.amount));
  const cash=financeMoneySum((Array.isArray(state.cash)?state.cash:[]).map(row=>row.amount)),kupa=financeMoneySum([cash,checks]);
  const netWithoutCash=bank===null?null:financeMoneySum([bank,-credit,-expenses,checks]);
  return {bank,credit,expenses,cash,checks,kupa,netWithoutCash,net:netWithoutCash===null?null:financeMoneySum([netWithoutCash,cash]),
    targetMonth:cycle.targetMonth,targetDate:cycle.targetDate,expenseStart:cycle.start.slice(0,7)===cycle.targetMonth?cycle.start:`${cycle.targetMonth}-01`,expenseEnd,
    creditRows,expenseRows,checkRows,incompleteCreditRows,elapsedIncompleteCreditRows:cycle.elapsedIncompleteCreditRows,expiredSettlementWarnings:cycle.expiredSettlementWarnings,
    forecastIncomplete:incompleteCreditRows.length>0||recurring.incomplete,recurringExpenseWarnings:recurring.warnings,
    incompleteCreditCount:incompleteCreditRows.length,missingAmountCount:incompleteCreditRows.filter(row=>row.amountStatus!=='known_ils').length,
    coverageGapCount:incompleteCreditRows.filter(row=>row.coverageIncomplete).length,unassignedCount:incompleteCreditRows.filter(row=>!row.date).length};
}
