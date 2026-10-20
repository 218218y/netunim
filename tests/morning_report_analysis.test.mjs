import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildMorningReport} from '../netunim-orders/site/assets/js/domains/finance/morning-report-model.js';
import {filterMorningRecords, morningRecordFilterOptions, morningRecordCategoryValue, parseMorningFilterAmount} from '../netunim-orders/site/assets/js/domains/finance/morning-report-filters.js';
import {morningComparisonRange, morningReportTrend, compareMorningReportMetrics} from '../netunim-orders/site/assets/js/domains/finance/morning-report-analysis.js';
import {morningRecordFiltersMarkup, morningTrendMarkup} from '../netunim-orders/site/assets/js/domains/finance/morning-report-analysis-view.js';
import {morningComparisonMarkup} from '../netunim-orders/site/assets/js/domains/finance/morning-report-comparison-view.js';

const document = (values = {}) => ({kind:'document', id:'d1', type:305, status:0, date:'2026-01-10', documentDate:'2026-01-10',
  number:'10', name:'לקוח ראשון', description:'הזמנה', currency:'ILS', grossCents:11800, vatCents:1800, businessType:1, selfInvoice:false, payments:[], ...values});
const expense = (values = {}) => ({kind:'expense', id:'e1', type:305, status:20, date:'2026-01-01', documentDate:'2025-12-20',
  number:'20', name:'ספק ראשון', description:'נייר', currency:'ILS', grossCents:5900, vatCents:900, deductibleVatCents:450, deductibleCents:5000, category:'משרד', categoryKey:'office', ...values});
const report = (documents = [], expenses = [], options = {}) => buildMorningReport({documents, expenses, fromDate:'2026-01-01', toDate:'2026-03-31', ...options});

test('local search matches Hebrew names, source number and description without mutating loaded records', () => {
  const r = report([document({name:'לָקוֹחַ ראשון', number:'1042', description:'משלוח מיוחד'})], [expense()]);
  const original = r.records.slice();
  assert.deepEqual(filterMorningRecords(r.records, {search:'לקוח 1042 מיוחד'}).map(row => row.id), ['d1']);
  assert.deepEqual(filterMorningRecords(r.records, {search:'ספק נייר'}).map(row => row.id), ['e1']);
  assert.equal(filterMorningRecords(r.records, {search:'לא קיים'}).length, 0);
  assert.deepEqual(r.records, original);
  assert.notEqual(filterMorningRecords(r.records), r.records);
});

test('record filters combine kind, document type, payment method, stable classification and exact gross cents', () => {
  const r = report([
    document({type:320, payments:[{type:3, amountCents:11800}]}),
    document({id:'d2', type:400, number:'11', payments:[{type:1, amountCents:11800}]}),
  ], [expense(), expense({id:'e2', type:330, category:'משרד', categoryKey:'other-office'}), expense({id:'e3', category:'', categoryKey:''})]);
  assert.deepEqual(filterMorningRecords(r.records, {kind:'document', type:'320', method:'credit', minCents:11800, maxCents:11800}).map(row => row.id), ['d1']);
  assert.deepEqual(filterMorningRecords(r.records, {kind:'expense', category:'id:office'}).map(row => row.id), ['e1']);
  assert.deepEqual(filterMorningRecords(r.records, {category:'id:other-office'}).map(row => row.id), ['e2']);
  assert.deepEqual(filterMorningRecords(r.records, {category:'none:'}).map(row => row.id), ['e3']);
  assert.equal(morningRecordCategoryValue({...expense(), categoryKey:'', category:'משרד'}), 'title:משרד');
  const options = morningRecordFilterOptions(r.records);
  assert.deepEqual(options.kinds.map(choice => choice.value), ['document', 'expense']);
  assert.ok(options.types.some(choice => choice.value === '330'));
  assert.deepEqual(options.methods.map(choice => choice.value), ['credit', 'cash']);
  assert.equal(options.categories.filter(choice => choice.label === 'משרד').length, 2, 'equal labels do not collapse distinct source category IDs');
});

test('amount filters preserve zero, missing and signed source amounts and reject invalid bounds', () => {
  const rows = [document({id:'unknown', grossCents:null}), document({id:'zero', grossCents:0}), document({id:'credit', grossCents:-100}), document({id:'one', grossCents:1})];
  assert.deepEqual(filterMorningRecords(rows, {minCents:0, maxCents:0}).map(row => row.id), ['zero']);
  assert.deepEqual(filterMorningRecords(rows, {maxCents:-1}).map(row => row.id), ['credit']);
  assert.deepEqual(filterMorningRecords(rows, {minCents:1}).map(row => row.id), ['one']);
  for (const filters of [{minCents:0.1}, {maxCents:'100'}, {minCents:2, maxCents:1}, {method:'bad'}, {kind:'bad'}, {type:'305 OR 1'}]) assert.throws(() => filterMorningRecords(rows, filters), error => error.code === 'invalid_report_filter');
  assert.throws(() => filterMorningRecords(rows, {}, {field:'bad'}));
  assert.equal(parseMorningFilterAmount('1,234.56'), 123456);
  assert.equal(parseMorningFilterAmount('-0.01'), -1);
  assert.equal(parseMorningFilterAmount(''), null);
  assert.throws(() => parseMorningFilterAmount('0.001'));
});

test('sorts are stable, numeric-aware and keep unknown amounts last in either direction', () => {
  const rows = [document({id:'a', grossCents:100, number:'10'}), document({id:'b', grossCents:100, number:'2'}), document({id:'unknown', grossCents:null}), document({id:'negative', grossCents:-100})];
  assert.deepEqual(filterMorningRecords(rows, {}, {field:'amount', direction:'asc'}).map(row => row.id), ['negative', 'a', 'b', 'unknown']);
  assert.deepEqual(filterMorningRecords(rows, {}, {field:'amount', direction:'desc'}).map(row => row.id), ['a', 'b', 'negative', 'unknown']);
  assert.deepEqual(filterMorningRecords(rows.slice(0, 2), {}, {field:'number'}).map(row => row.id), ['b', 'a']);
  assert.deepEqual(filterMorningRecords(rows, {}, {field:'name', direction:'desc'}).map(row => row.id), rows.map(row => row.id));
});

test('previous ranges shift full calendar months and custom ranges by their inclusive duration', () => {
  assert.deepEqual(morningComparisonRange({fromDate:'2026-07-01', toDate:'2026-08-31'}), {fromDate:'2026-05-01', toDate:'2026-06-30'});
  assert.deepEqual(morningComparisonRange({fromDate:'2026-03-01', toDate:'2026-03-31'}), {fromDate:'2026-02-01', toDate:'2026-02-28'});
  assert.deepEqual(morningComparisonRange({fromDate:'2024-03-01', toDate:'2024-03-31'}), {fromDate:'2024-02-01', toDate:'2024-02-29'});
  assert.deepEqual(morningComparisonRange({fromDate:'2026-01-01', toDate:'2026-12-31'}), {fromDate:'2025-01-01', toDate:'2025-12-31'});
  assert.deepEqual(morningComparisonRange({fromDate:'2026-03-15', toDate:'2026-04-05'}), {fromDate:'2026-02-21', toDate:'2026-03-14'});
  assert.deepEqual(morningComparisonRange({fromDate:'2026-07-05', toDate:'2026-07-05'}), {fromDate:'2026-07-04', toDate:'2026-07-04'});
  assert.throws(() => morningComparisonRange({fromDate:'2026-02-30', toDate:'2026-03-31'}));
  assert.throws(() => morningComparisonRange({fromDate:'2026-03-01', toDate:'2026-03-31'}, 'unknown'));
});

test('prior-year comparison clamps leap days without rolling into March', () => {
  assert.deepEqual(morningComparisonRange({fromDate:'2024-02-01', toDate:'2024-02-29'}, 'year'), {fromDate:'2023-02-01', toDate:'2023-02-28'});
  assert.deepEqual(morningComparisonRange({fromDate:'2025-02-01', toDate:'2025-02-28'}, 'year'), {fromDate:'2024-02-01', toDate:'2024-02-29'});
  assert.deepEqual(morningComparisonRange({fromDate:'2025-01-01', toDate:'2025-02-28'}, 'year'), {fromDate:'2024-01-01', toDate:'2024-02-29'});
  assert.deepEqual(morningComparisonRange({fromDate:'2024-02-29', toDate:'2024-02-29'}, 'year'), {fromDate:'2023-02-28', toDate:'2023-02-28'});
  assert.deepEqual(morningComparisonRange({fromDate:'2025-02-28', toDate:'2025-02-28'}, 'year'), {fromDate:'2024-02-28', toDate:'2024-02-28'});
  assert.deepEqual(morningComparisonRange({fromDate:'2024-02-29', toDate:'2024-03-01'}, 'year'), {fromDate:'2023-02-28', toDate:'2023-03-01'});
});

test('monthly trends rebuild from source records even when summary grouping is bimonthly or quarterly', () => {
  for (const group of ['bimonth', 'quarter', 'year']) {
    const r = report([document(), document({id:'d2', date:'2026-02-10', type:320, payments:[{type:3, amountCents:11800}]})], [expense()], {group});
    const trend = morningReportTrend(r);
    assert.deepEqual(trend.map(point => point.key), ['2026-01', '2026-02', '2026-03']);
    assert.deepEqual(trend.map(point => point.incomeCents), [10000, 10000, 0]);
    assert.deepEqual(trend.map(point => point.expenseCostCents), [5450, 0, 0]);
    assert.deepEqual(trend.map(point => point.profitCents), [4550, 10000, 0]);
    assert.deepEqual(trend.map(point => point.receiptsCents), [0, 11800, 0]);
    assert.deepEqual(trend.map(point => point.methods.credit), [0, 11800, 0]);
  }
});

test('trends retain incomplete record metrics independently and preserve missing-source nulls', () => {
  const incomplete = report([document(), document({id:'d2', date:'2026-02-10', vatCents:null})], [expense()]);
  const trend = morningReportTrend(incomplete);
  assert.equal(trend[0].incomeCents, 10000); assert.equal(trend[1].incomeCents, null); assert.equal(trend[2].incomeCents, 0);
  assert.equal(trend[1].receiptsCents, 0, 'an unrelated invoice VAT issue does not invalidate receipt amounts');
  const missing = morningReportTrend(report([document()], null));
  assert.deepEqual(missing.map(point => point.expenseCostCents), [null, null, null]);
  assert.deepEqual(missing.map(point => point.profitCents), [null, null, null]);
  assert.deepEqual(missing.map(point => point.incomeCents), [10000, 0, 0]);
  const explicitMissing = morningReportTrend(report([], []), {sources:{documents:false, expenses:true}});
  assert.deepEqual(explicitMissing.map(point => point.receiptsCents), [null, null, null]);
  assert.deepEqual(explicitMissing.map(point => point.expenseCostCents), [0, 0, 0]);
  const tagged = report([], []); tagged.sources = {documents:false, expenses:false};
  assert.equal(morningReportTrend(tagged)[0].incomeCents, null);
});

test('custom-range trend labels and VAT completeness use actual clipped monthly boundaries', () => {
  const trend = morningReportTrend(report([], [], {fromDate:'2026-01-15', toDate:'2026-03-10'}));
  assert.deepEqual(trend.map(({fromDate, toDate}) => ({fromDate, toDate})), [
    {fromDate:'2026-01-15', toDate:'2026-01-31'}, {fromDate:'2026-02-01', toDate:'2026-02-28'}, {fromDate:'2026-03-01', toDate:'2026-03-10'},
  ]);
  assert.deepEqual(trend.map(point => point.vatBalanceCents), [null, 0, null]);
});

test('comparisons expose explicit periods and independently verified monetary and payment deltas', () => {
  const current = report([document({type:320, payments:[{type:3, amountCents:11800}]})], [expense()]);
  const previous = report([document({date:'2025-11-10', grossCents:5900, vatCents:900, type:320, payments:[{type:3, amountCents:5900}]})], [], {fromDate:'2025-10-01', toDate:'2025-12-31'});
  const comparison = compareMorningReportMetrics(current, previous);
  assert.deepEqual(comparison.currentRange, {fromDate:'2026-01-01', toDate:'2026-03-31'});
  assert.deepEqual(comparison.comparisonRange, {fromDate:'2025-10-01', toDate:'2025-12-31'});
  assert.equal(comparison.metrics.incomeCents.deltaCents, 5000); assert.equal(comparison.metrics.incomeCents.percent, 100);
  assert.equal(comparison.methods.credit.deltaCents, 5900); assert.equal(comparison.methods.credit.percent, 100);
  assert.equal(comparison.metrics.expenseCostCents.percent, null); assert.equal(comparison.metrics.expenseCostCents.state, 'from-zero');
  assert.equal(comparison.metrics.profitCents.deltaCents, -450); assert.equal(comparison.metrics.profitCents.direction, 'down');
});

test('comparison zero and missing baselines never create Infinity or fabricated deltas', () => {
  const empty = report([], []), current = report([document()], null);
  const comparison = compareMorningReportMetrics(current, empty);
  assert.equal(comparison.metrics.incomeCents.percent, null); assert.equal(comparison.metrics.incomeCents.state, 'from-zero');
  assert.equal(comparison.metrics.expenseCostCents.deltaCents, null); assert.equal(comparison.metrics.expenseCostCents.state, 'missing');
  assert.equal(comparison.metrics.receiptsCents.deltaCents, 0); assert.equal(comparison.metrics.receiptsCents.percent, null);
  const missing = compareMorningReportMetrics(empty, null);
  assert.equal(missing.comparisonRange, null); assert.equal(missing.metrics.incomeCents.deltaCents, null);
  const huge = report([{...document(), grossCents:Number.MAX_SAFE_INTEGER, vatCents:0}]);
  const negative = report([{...document(), grossCents:-Number.MAX_SAFE_INTEGER, vatCents:0}]);
  assert.throws(() => compareMorningReportMetrics(huge, negative), /טווח החישוב/);
});

test('optional filter and SVG markup escape source text and show missing data without fabricated bars', () => {
  const malicious = '<img src=x onerror=alert(1)>', records = report([], [expense({category:malicious})]).records;
  const filters = morningRecordFiltersMarkup(records, {search:malicious, minCents:Number.MAX_SAFE_INTEGER});
  assert.equal(filters.includes('<img'), false); assert.ok(filters.includes('&lt;img'));
  assert.ok(filters.includes('90071992547409.91'), 'filter formatting preserves exact safe integer cents');
  assert.ok(filters.includes('data-report-option="filter:category"'));
  assert.ok(filters.includes('data-action="morning-report-option" data-report-option="filter:reset" value="1"'));
  assert.equal(filters.includes('morning-report-filter-reset'), false);
  const trend = morningReportTrend(report([document()], null));
  const chart = morningTrendMarkup(trend, {title:malicious});
  assert.equal(chart.includes('<img'), false); assert.ok(chart.includes('&lt;img'));
  assert.ok(chart.includes('role="img"')); assert.ok(chart.includes('<summary>נתוני התרשים לפי חודשים</summary>'));
  assert.ok(chart.includes('חסר נתון מלא')); assert.equal(chart.includes('NaN'), false); assert.equal(chart.includes('Infinity'), false);
  assert.equal(morningTrendMarkup([], {}), '');
  assert.equal(morningTrendMarkup([{key:'bad'}]), '');
});

test('optional comparison markup reuses option actions and displays explicit ranges and unknowns safely', () => {
  const current = report([document()], null);
  const previous = report([], [], {fromDate:'2025-10-01', toDate:'2025-12-31'});
  const comparison = compareMorningReportMetrics(current, previous);
  const html = morningComparisonMarkup({comparison, fromDate:current.fromDate, toDate:current.toDate});
  assert.ok(html.includes('01.01.2026–31.03.2026'));
  assert.ok(html.includes('01.10.2025–31.12.2025'));
  assert.ok(html.includes('data-report-option="comparison:mode" value="previous"'));
  assert.ok(html.includes('data-report-option="comparison:mode" value="year"'));
  assert.ok(html.includes('data-report-option="comparison:load" value="1"'));
  assert.ok(html.includes('חסרים נתונים להשוואה מלאה'));
  assert.ok(html.includes('השוואת אמצעי תשלום')); assert.equal(html.includes('Infinity'), false);
  const malicious = '<img src=x onerror=alert(1)>';
  assert.equal(morningComparisonMarkup({error:malicious}).includes('<img'), false);
  const stale = morningComparisonMarkup({comparison, fromDate:'2026-02-01', toDate:'2026-03-31'});
  assert.ok(stale.includes('בחירת התקופה השתנתה')); assert.equal(stale.includes('סיכום ההשוואה לפי המדדים הזמינים'), false);
  const busy = morningComparisonMarkup({busy:true, fromDate:current.fromDate, toDate:current.toDate});
  assert.ok(busy.includes('aria-busy="true"')); assert.ok(busy.includes('value="1" disabled'));
});

test('VAT trend SVG and monthly data table preserve source VAT labels and per-month missing values', () => {
  const trend = morningReportTrend(report([document(), document({id:'d2', date:'2026-02-10', vatCents:null})], [expense()]));
  assert.deepEqual(trend.map(point => point.outputVatCents), [1800, null, 0]);
  assert.deepEqual(trend.map(point => point.inputVatCents), [450, 0, 0]);
  assert.deepEqual(trend.map(point => point.vatBalanceCents), [1350, null, 0]);
  const chart = morningTrendMarkup(trend, {title:'סיכום מע״מ לפי חודשי דיווח', series:['outputVatCents', 'inputVatCents', 'vatBalanceCents']});
  for (const label of ['מע״מ עסקאות', 'מע״מ תשומות מותר', 'יתרת מע״מ ניהולית']) assert.ok(chart.includes(label));
  assert.ok(chart.includes('<table')); assert.ok(chart.includes('חסר נתון מלא'));
  assert.equal(chart.includes('NaN'), false); assert.equal(chart.includes('Infinity'), false);
  const partial = morningReportTrend(report([document({date:'2026-01-20'})], [], {fromDate:'2026-01-15', toDate:'2026-02-28'}));
  assert.equal(partial[0].outputVatCents, 1800); assert.equal(partial[0].vatBalanceCents, null);
  assert.equal(partial[1].vatBalanceCents, 0);
});
