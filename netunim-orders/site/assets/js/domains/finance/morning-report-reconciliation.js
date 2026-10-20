import {reportMetric, validReportDate} from './morning-report-model.js';

function amountError(code) {
  return Object.assign(new Error(code === 'report_amount_out_of_range' ? 'הסכום חורג מטווח החישוב הנתמך' : 'יש להזין סכום מספרי בשקלים, עד שתי ספרות אחרי הנקודה'), {code});
}
// Currency input is parsed as decimal text before conversion to integer agorot.
// Standard comma thousands groups are accepted; no currency symbols, exponent,
// locale guessing, sub-cent rounding, or a missing value becoming zero.
export function parseReportAmount(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' && typeof value !== 'number') throw amountError('invalid_report_amount');
  const text = String(value).trim();
  if (!text) return null;
  if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(text)) throw amountError('invalid_report_amount');
  const negative = text.startsWith('-'), unsigned = text.replace(/^[+-]/, '').replaceAll(',', '');
  const [whole, fraction = ''] = unsigned.split('.');
  const cents = (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))) * (negative ? -1n : 1n);
  if (cents < BigInt(Number.MIN_SAFE_INTEGER) || cents > BigInt(Number.MAX_SAFE_INTEGER)) throw amountError('report_amount_out_of_range');
  return Number(cents);
}

export const RECONCILIATION_METRICS = Object.freeze([
  {key:'incomeCents', label:'הכנסות לפני מע״מ', basis:'document-income-excluding-vat'},
  {key:'receiptsCents', label:'סכום קבלות כולל מע״מ', basis:'document-receipts-including-vat'},
  {key:'expensesCents', label:'הוצאות לפני מע״מ', basis:'reporting-month-expenses-excluding-vat'},
  {key:'expenseCostCents', label:'עלות הוצאות ניהולית כולל רכישות', basis:'managerial-cost-including-acquisitions'},
  {key:'unrecoverableVatCents', label:'מע״מ שאינו ניתן לקיזוז', basis:'reporting-month-unrecoverable-vat'},
  {key:'outputVatCents', label:'מע״מ עסקאות', basis:'document-output-vat'},
  {key:'inputVatCents', label:'מע״מ תשומות מותר', basis:'reporting-month-recoverable-input-vat'},
  {key:'vatBalanceCents', label:'הפרש מע״מ לתשלום או להחזר', basis:'document-output-minus-reporting-month-recoverable-vat'},
  {key:'profitCents', label:'רווח ניהולי כולל רכישות', basis:'document-income-minus-managerial-cost-including-acquisitions'},
  {key:'deductibleExpensesCents', label:'סכום הוצאות מוכר ממורנינג', basis:'source-income-tax-deductible-expense-amount'},
].map(metric => Object.freeze(metric)));

function validScope(scope) {
  return !!scope && validReportDate(scope.fromDate) && validReportDate(scope.toDate) && scope.fromDate <= scope.toDate && ['production', 'sandbox'].includes(scope.environment);
}
function difference(left, right) {
  const result = BigInt(left) - BigInt(right);
  if (result < BigInt(Number.MIN_SAFE_INTEGER) || result > BigInt(Number.MAX_SAFE_INTEGER)) throw amountError('report_amount_out_of_range');
  return Number(result);
}
// This is a numeric comparison against a MANUALLY ENTERED reference. It never
// authenticates a file, validates a filing, or changes the report's completeness.
export function reconcileMorningReport({report, environment, official = {}}) {
  if (!report?.total || !validScope({...report, environment})) throw new Error('invalid_reconciliation_report');
  const values = official.valuesCents ?? {}, scope = official.scope;
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('invalid_reconciliation_values');
  const keys = new Set(RECONCILIATION_METRICS.map(metric => metric.key));
  if (Object.keys(values).some(key => !keys.has(key))) throw new Error('invalid_reconciliation_metric');
  const scopeMatches = validScope(scope) && scope.fromDate === report.fromDate && scope.toDate === report.toDate && scope.environment === environment;
  const reference = typeof official.reference === 'string' ? official.reference.trim().slice(0, 240) : '';
  const metrics = RECONCILIATION_METRICS.map(metric => {
    const officialCents = values[metric.key] ?? null;
    if (officialCents !== null && !Number.isSafeInteger(officialCents)) throw amountError('invalid_report_amount');
    const sourceCents = reportMetric(report.total, metric.key);
    const basisMatches = official.basis?.[metric.key] === metric.basis;
    let state = 'no-official', differenceCents = null, reason = 'official-value-missing';
    if (officialCents !== null) {
      if (!scopeMatches) { state = 'incomparable'; reason = 'scope-mismatch'; }
      else if (!basisMatches) { state = 'incomparable'; reason = 'basis-mismatch'; }
      else if (!reference) { state = 'incomparable'; reason = 'reference-missing'; }
      else if (sourceCents === null) { state = 'missing-source'; reason = 'source-incomplete'; }
      else {
        differenceCents = difference(sourceCents, officialCents);
        state = differenceCents === 0 ? 'match' : 'difference'; reason = '';
      }
    }
    return {...metric, sourceCents, officialCents, differenceCents, state, reason, basisMatches, scopeMatches};
  });
  return {method:'manual-reference', accountingVerified:false, reference, scopeMatches,
    scope:{fromDate:report.fromDate, toDate:report.toDate, environment}, metrics,
    compared:metrics.filter(metric => ['match', 'difference'].includes(metric.state)).length,
    matched:metrics.filter(metric => metric.state === 'match').length};
}
