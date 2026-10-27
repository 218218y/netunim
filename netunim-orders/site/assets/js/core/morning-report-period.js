export function validReportDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function reportPeriod(mode, year, part = 1) {
  year = Number(year); part = Number(part);
  const lengths = {month:1, bimonth:2, quarter:3, year:12}, length = lengths[mode];
  if (!Number.isInteger(year) || year < 2000 || year > 2099 || !length || !Number.isInteger(part) || part < 1 || part > 12 / length) throw new Error('יש לבחור תקופה תקינה');
  const month = (part - 1) * length + 1;
  return {fromDate:`${year}-${String(month).padStart(2, '0')}-01`, toDate:new Date(Date.UTC(year, month + length - 1, 0)).toISOString().slice(0, 10)};
}
export function expenseBimonth(date) {
  if (!validReportDate(date)) throw new Error('invalid_expense_reporting_period');
  const year = Number(date.slice(0, 4)), part = Math.ceil(Number(date.slice(5, 7)) / 2);
  const range = reportPeriod('bimonth', year, part), first = range.fromDate.slice(0, 7), second = range.toDate.slice(0, 7);
  const monthName = value => new Intl.DateTimeFormat('he-IL', {month:'long', timeZone:'UTC'}).format(new Date(value + '-01'));
  return {...range, key:first, label:`${monthName(first)}–${monthName(second)} ${year}`, months:[first + '-01', second + '-01']};
}
export function expenseReportingChoice(date, key, today) {
  if (!/^\d{4}-(?:01|03|05|07|09|11)$/.test(key)) throw new Error('invalid_expense_reporting_period');
  const period = expenseBimonth(key + '-01');
  if (!validReportDate(today) || period.fromDate < '2010-01-01' || period.fromDate > today) throw new Error('invalid_expense_reporting_period');
  const invoiceMonth = validReportDate(date) ? date.slice(0, 7) + '-01' : '';
  const reportingDate = period.months.includes(invoiceMonth) ? invoiceMonth : period.months.filter(month => month <= today).at(-1);
  return {period, reportingDate, requiresConfirmation:invoiceMonth !== reportingDate};
}
// Keep the previous reporting year during the first bimonth. A draft already
// assigned to it stays selectable if the screen remains open into March.
export function expenseReportingYears(today, selectedPeriod = '') {
  if (!validReportDate(today)) throw new Error('invalid_expense_reporting_period');
  const year = Number(today.slice(0, 4));
  return Number(today.slice(5, 7)) <= 2 || selectedPeriod.startsWith(`${year - 1}-`) ? [year, year - 1] : [year];
}
export function validateExpenseReporting(input, today) {
  const date = input.reportingDate;
  if (!validReportDate(date) || !date.endsWith('-01') || date < '2010-01-01' || date > today.slice(0, 7) + '-01' || date < input.date.slice(0, 7) + '-01') throw new Error('invalid_expense_reporting_period');
  const period = expenseBimonth(date);
  if (input.reportingPeriod !== undefined && input.reportingPeriod !== period.key) throw new Error('invalid_expense_reporting_period');
  // The selected bimonth and the ordinary save confirmation express the choice.
  // Retain the old flag in normalized requests for existing operation fingerprints.
  return {reportingPeriod:period.key, reportingDateConfirmed:input.reportingDateConfirmed === true};
}
