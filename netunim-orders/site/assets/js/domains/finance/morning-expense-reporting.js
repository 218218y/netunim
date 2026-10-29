import {expenseBimonth, expenseReportingChoice, expenseReportingDefault, expenseReportingYears} from '../../core/morning-report-period.js';
import {readExpenseReportingPeriod, writeExpenseReportingPeriod} from './morning-expense-preferences.js';
import {esc} from '../../core/values.js';

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
    return {today, year, years:expenseReportingYears(today, selected), periods, previous:selected<expenseBimonth(today).key};
  }
  function markup(disabled) {
    const {year,years,periods,previous}=choices(), selected=fields('').reportingPeriod;
    const options=items=>items.map(([key,label])=>`<option value="${esc(key)}" ${String(key)===String(selected)?'selected':''}>${esc(label)}</option>`).join('');
    return `<label class="morning-expense-period"><span class="morning-expense-field-label">תקופת דיווח מע״מ ${previous?'<span class="morning-expense-period-warning" data-expense-period-warning title="נבחרה תקופה קודמת לתקופה הנוכחית. יש לוודא שהבחירה מכוונת.">תקופה קודמת</span>':''}</span>
      <select aria-label="שנת דיווח מע״מ" data-expense-field="reportingYear" data-change="morning-expense-field" ${disabled?'disabled':''}>${years.map(value=>`<option value="${value}" ${value===year?'selected':''}>${value}</option>`).join('')}</select>
      <select aria-label="תקופת דיווח מע״מ" data-expense-field="reportingPeriod" data-change="morning-expense-field" ${previous?'aria-description="נבחרה תקופה קודמת; יש לוודא שהבחירה מכוונת."':''} ${disabled?'disabled':''}>${options(periods.map(item=>[item.key,item.label]))}</select></label>`;
  }
  return {reset, fields, restore, choose, yearKey, choices, markup};
}
