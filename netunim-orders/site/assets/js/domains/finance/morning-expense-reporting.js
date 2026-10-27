import {expenseBimonth, expenseReportingChoice, expenseReportingDefault, expenseReportingYears} from '../../core/morning-report-period.js';
import {readExpenseReportingPeriod, writeExpenseReportingPeriod} from './morning-expense-preferences.js';

export const expenseReportingStorageWarning = 'תקופת הדיווח נשמרה למסך זה בלבד. הדפדפן לא אפשר לשמור אותה לפתיחה הבאה.';

// The reporting choice belongs to the account's intake workflow, rather than to
// an individual invoice draft. Calendar changes and file restoration only read it.
export function createExpenseReporting({storage, todayISO}) {
  let period = '', scope = null;
  function reset() {period = ''; scope = null;}
  function fields(date) {
    const today = todayISO(), key = expenseReportingDefault(period, today);
    return {reportingPeriod:key, reportingDate:expenseReportingChoice(date, key, today).reportingDate};
  }
  function persist() {
    try {return writeExpenseReportingPeriod(storage(), scope.owner, scope.environment, period, todayISO());} catch {return false;}
  }
  function restore(owner, environment) {
    const today = todayISO(); scope = {owner, environment};
    let saved = '';
    try {saved = readExpenseReportingPeriod(storage(), owner, environment, today);} catch { /* Browser storage itself may be unavailable. */ }
    period = expenseReportingDefault(saved, today);
    // A native select does not emit change when the current option is reselected.
    // Seed its initial choice, but never rewrite an existing remembered choice.
    return !!saved || persist();
  }
  function choose(key, date) {
    if (!scope) throw new Error('invalid_expense_reporting_scope');
    const today = todayISO(), reportingDate = expenseReportingChoice(date, key, today).reportingDate;
    period = key;
    return {reportingPeriod:key, reportingDate, saved:persist()};
  }
  function yearKey(value) {
    const year = Number(value), today = todayISO(), selected = fields('').reportingPeriod;
    if (!expenseReportingYears(today, selected).includes(year)) throw new Error('invalid_expense_reporting_period');
    const key = String(year) + selected.slice(4);
    return key + '-01' > today ? expenseBimonth(today).key : key;
  }
  function choices() {
    const today = todayISO(), selected = fields('').reportingPeriod, year = Number(selected.slice(0, 4)), periods = [];
    for (let month = 11; month >= 1; month -= 2) {
      const date = `${year}-${String(month).padStart(2, '0')}-01`;
      if (date <= today) periods.push(expenseBimonth(date));
    }
    return {today, year, years:expenseReportingYears(today, selected), periods};
  }
  return {reset, fields, restore, choose, yearKey, choices};
}
