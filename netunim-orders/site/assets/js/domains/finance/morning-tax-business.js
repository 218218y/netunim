import {reportPeriod, validReportDate} from '../../core/morning-report-period.js';
import {FIRST_MORNING_TAX_YEAR} from '../../shared/tax-calculator/contracts.js';
import {buildMorningReport, reportMetric} from './morning-report-model.js';
import {createMorningReportCache} from './morning-report-cache.js';
import {readMorningReportBundle} from './morning-report-reader.js';

function selectedRanges({year, mode, months}, today) {
  if (year < FIRST_MORNING_TAX_YEAR) throw new Error(`נתוני Morning זמינים לחישוב משנת ${FIRST_MORNING_TAX_YEAR}`);
  const yearRange = reportPeriod('year', year);
  if (!validReportDate(today) || yearRange.fromDate > today) throw new Error('יש לבחור שנה שכבר התחילה');
  if (mode === 'annual') {
    if (yearRange.toDate >= today) throw new Error('לחישוב שנתי יש לבחור שנה שהסתיימה');
    return [yearRange];
  }
  if (mode !== 'monthly' || !Array.isArray(months) || !months.length || new Set(months).size !== months.length)
    throw new Error('יש לבחור לפחות חודש אחד');
  const ranges = [];
  let previousMonth = 0;
  for (const month of [...months].sort((left, right) => left - right)) {
    const range = reportPeriod('month', year, month);
    if (!Number.isInteger(month) || range.fromDate > today) throw new Error('אי אפשר לבחור חודש עתידי');
    range.toDate = range.toDate > today ? today : range.toDate;
    if (ranges.length && month === previousMonth + 1) ranges.at(-1).toDate = range.toDate;
    else ranges.push(range);
    previousMonth = month;
  }
  return ranges;
}

export async function readMorningTaxBusiness({request, scope, assertCurrent, signal, selection, today}) {
  const ranges = selectedRanges(selection, today);
  const cache = createMorningReportCache({ttlMs:0});
  const amounts = {income:0, expenseCost:0, outputVat:0, inputVat:0};
  const metrics = {income:'incomeCents', expenseCost:'expenseCostCents', outputVat:'outputVatCents', inputVat:'inputVatCents'};
  let environment = '';
  for (const range of ranges) {
    const bundle = await readMorningReportBundle({request, cache, scope, assertCurrent, signal, ...range, reportType:'profit'});
    if (environment && bundle.environment !== environment)
      throw new Error('סביבת Morning השתנתה במהלך הקריאה. יש לחשב שוב');
    environment = bundle.environment;
    const report = buildMorningReport({...bundle, ...range, group:'year'});
    if (!report.profitComplete) {
      const reason = report.issues.find(issue => issue.code.startsWith('source-') ||
        issue.fields?.some(field => field === 'incomeCents' || field === 'expenseCostCents'));
      throw new Error(reason?.label || 'נתוני ההכנסות וההוצאות אינם מספיקים לחישוב רווח');
    }
    for (const [key, field] of Object.entries(metrics)) {
      const value = reportMetric(report.total, field);
      amounts[key] = value === null || amounts[key] === null ? null : amounts[key] + value;
      if (amounts[key] !== null && !Number.isSafeInteger(amounts[key]))
        throw new Error('סכומי הדוח חורגים מטווח החישוב הנתמך');
    }
  }
  scope();
  assertCurrent();
  signal?.throwIfAborted();
  return {...amounts, environment, monthCount:selection.mode === 'monthly' ? selection.months.length : null,
    partialThrough:ranges.at(-1).toDate === today ? today : null};
}
