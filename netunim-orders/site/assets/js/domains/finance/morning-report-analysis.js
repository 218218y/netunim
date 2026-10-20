import {buildMorningReport, REPORT_METHODS, reportMetric, validReportDate} from './morning-report-model.js';

export const MORNING_COMPARISON_METRICS = Object.freeze(['incomeCents', 'expensesCents', 'expenseCostCents', 'profitCents', 'receiptsCents', 'outputVatCents', 'inputVatCents', 'vatBalanceCents']);
const DAY = 86400000;
const rangeOf = report => report ? {fromDate:report.fromDate, toDate:report.toDate} : null;
function assertRange(range) {
  if (!validReportDate(range?.fromDate) || !validReportDate(range?.toDate) || range.fromDate > range.toDate) throw new Error('טווח ההשוואה אינו תקין');
}
function iso(date) {
  const result = new Date(date).toISOString().slice(0, 10);
  if (!validReportDate(result)) throw new Error('טווח ההשוואה אינו נתמך');
  return result;
}
function shiftMonths(date, months) {
  const shifted = new Date(date + 'T00:00:00Z');
  shifted.setUTCMonth(shifted.getUTCMonth() + months);
  return iso(shifted);
}
const monthEnd = date => iso(Date.parse(shiftMonths(date.slice(0, 7) + '-01', 1)) - DAY);
function yearBefore(date) {
  const year = Number(date.slice(0, 4)) - 1;
  if (year < 0) throw new Error('טווח ההשוואה אינו נתמך');
  const start = `${String(year).padStart(4, '0')}-${date.slice(5, 7)}-01`;
  const last = Number(monthEnd(start).slice(8, 10));
  return start.slice(0, 8) + String(Math.min(Number(date.slice(8, 10)), last)).padStart(2, '0');
}
export function morningComparisonRange(range, mode = 'previous') {
  assertRange(range);
  const {fromDate, toDate} = range;
  const fullMonths = fromDate.endsWith('-01') && iso(Date.parse(toDate) + DAY).endsWith('-01');
  // Whole reporting months remain whole in leap years in both directions.
  // Custom day ranges retain their calendar days, clamping February 29 only.
  if (mode === 'year') return {fromDate:yearBefore(fromDate), toDate:fullMonths ? monthEnd(yearBefore(toDate)) : yearBefore(toDate)};
  if (mode !== 'previous') throw new Error('יש לבחור סוג השוואה תקין');
  const end = iso(Date.parse(fromDate) - DAY);
  if (fullMonths) {
    const months = (Number(toDate.slice(0, 4)) - Number(fromDate.slice(0, 4))) * 12 + Number(toDate.slice(5, 7)) - Number(fromDate.slice(5, 7)) + 1;
    return {fromDate:shiftMonths(fromDate, -months), toDate:end};
  }
  return {fromDate:iso(Date.parse(fromDate) - (Date.parse(toDate) - Date.parse(fromDate) + DAY)), toDate:end};
}
function inferredSource(report, source) {
  if (report.issues?.some(issue => issue.code === `source-${source}`)) return false;
  if (report.records?.some(row => row.kind === (source === 'documents' ? 'document' : 'expense'))) return true;
  const flags = source === 'documents' ? ['incomeComplete', 'receiptAmountComplete', 'outputVatComplete'] : ['expensesComplete', 'expenseCostComplete', 'inputVatComplete'];
  return flags.some(flag => report.total?.[flag] === true);
}
export function morningReportTrend(report, {sources = report?.sources} = {}) {
  assertRange(report);
  if (!Array.isArray(report.records)) throw new Error('חסרים מסמכי המקור לחישוב מגמה חודשית');
  const sourceAvailable = source => typeof sources?.[source] === 'boolean' ? sources[source] : inferredSource(report, source);
  const monthly = buildMorningReport({fromDate:report.fromDate, toDate:report.toDate, group:'month',
    documents:sourceAvailable('documents') ? report.records.filter(row => row.kind === 'document') : null,
    expenses:sourceAvailable('expenses') ? report.records.filter(row => row.kind === 'expense') : null});
  return monthly.buckets.map(bucket => ({
    key:bucket.key,
    fromDate:bucket.key + '-01' < report.fromDate ? report.fromDate : bucket.key + '-01',
    toDate:monthEnd(bucket.key + '-01') > report.toDate ? report.toDate : monthEnd(bucket.key + '-01'),
    ...Object.fromEntries(MORNING_COMPARISON_METRICS.map(field => [field, reportMetric(bucket, field)])),
    methods:Object.fromEntries(Object.keys(REPORT_METHODS).map(method => [method, reportMetric(bucket, 'methods', method)])),
    complete:bucket.complete, issues:bucket.issues,
  }));
}
function difference(current, previous) {
  if (current === null || previous === null) return {current, previous, deltaCents:null, percent:null, state:'missing', direction:null};
  const deltaCents = current - previous;
  if (!Number.isSafeInteger(deltaCents)) throw new Error('הפרש ההשוואה חורג מטווח החישוב הנתמך');
  const percent = previous === 0 ? null : Number((deltaCents / Math.abs(previous) * 100).toFixed(2));
  if (percent !== null && !Number.isFinite(percent)) throw new Error('אחוז ההשוואה אינו נתמך');
  return {current, previous, deltaCents, percent, state:deltaCents === 0 ? 'unchanged' : previous === 0 ? 'from-zero' : 'changed', direction:deltaCents === 0 ? 'flat' : deltaCents > 0 ? 'up' : 'down'};
}
export function compareMorningReportMetrics(current, comparison) {
  assertRange(current);
  if (comparison) assertRange(comparison);
  return {currentRange:rangeOf(current), comparisonRange:rangeOf(comparison), percentageBasis:'absolute-previous',
    metrics:Object.fromEntries(MORNING_COMPARISON_METRICS.map(field => [field, difference(reportMetric(current.total, field), reportMetric(comparison?.total, field))])),
    methods:Object.fromEntries(Object.keys(REPORT_METHODS).map(method => [method, difference(reportMetric(current.total, 'methods', method), reportMetric(comparison?.total, 'methods', method))])),
  };
}
