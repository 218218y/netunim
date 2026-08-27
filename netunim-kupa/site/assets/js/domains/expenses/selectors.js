import {expenseOccurrencesForMonthData, monthSumExpensesData, expenseRowsBetweenData} from './model.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createDomainsExpensesSelectors({model}){
function expenseOccurrencesForMonth(...args){return expenseOccurrencesForMonthData(model.state,...args)}

function monthSumExpenses(...args){return monthSumExpensesData(model.state,...args)}

function expenseRowsBetween(...args){return expenseRowsBetweenData(model.state,...args)}

return { expenseOccurrencesForMonth, monthSumExpenses, expenseRowsBetween };
}
