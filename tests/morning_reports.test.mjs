import assert from 'node:assert/strict';
import {test} from 'node:test';
import {reportDocument, reportExpense, reportPermission, reportInput, createMorningReportsHandler} from '../netunim-orders/supabase/functions/morning-documents/reports.js';
import {buildMorningReport, reportPeriod, reportCsv, reportMetric} from '../netunim-orders/site/assets/js/domains/finance/morning-report-model.js';
import {loadMorningReportSource} from '../netunim-orders/site/assets/js/domains/finance/morning-report-loader.js';

const id = value => `aaaaaaaa-aaaa-4aaa-aaaa-${String(value).padStart(12, '0')}`;
const raw = (value = {}) => ({id:id(1), type:305, number:'123', documentDate:'2026-01-10', status:0, business:{type:1}, client:{name:'לקוח'}, amount:118, amountLocal:118, vat:18, currency:'ILS', currencyRate:1, ...value});
const doc = value => reportDocument(raw(value));
const expense = value => reportExpense({id:id(20), documentType:305, number:'20', reportingDate:'2026-01-01', date:'2025-12-28', status:10, supplier:{name:'ספק'}, amount:59, amountLocal:59, vat:9, currency:'ILS', deductibleAmount:50, deductibleVat:9, ...value});
const report = (documents = [], expenses = [], options = {}) => buildMorningReport({documents, expenses, fromDate:'2026-01-01', toDate:'2026-12-31', ...options});

test('invoices and receipts never double count revenue; exact cents and monthly totals', () => {
  const r = report([doc(), doc({id:id(2), type:400, payment:[{type:3, price:68}, {type:1, price:20}, {type:2, price:30}]})], [expense()]);
  assert.equal(r.total.incomeCents, 10000); assert.equal(r.total.receiptsCents, 11800);
  assert.equal(r.total.expensesCents, 5000); assert.equal(r.profitCents, 5000);
  assert.deepEqual(r.total.methods, {credit:6800, cash:2000, cheque:3000, bank:0, paypal:0, app:0, other:0, withholding:0, unknown:0});
  assert.equal(r.buckets.length, 12); assert.equal(r.complete, true);
  const cents = report([doc({amount:0.3, amountLocal:0.3, vat:0.1})], [expense({amount:0.1, amountLocal:0.1, vat:0, deductibleVat:0})]);
  assert.equal(cents.profitCents, 10);
});
test('invoice receipts, credit notes, cancelled originals and negative receipts balance once', () => {
  const r = report([doc({type:320, status:4, payment:[{type:3, price:118}]}), doc({id:id(2), type:330, status:3}), doc({id:id(3), type:400, status:3, amount:-118, amountLocal:-118, vat:0, payment:[{type:3, price:-118}]})]);
  assert.equal(r.total.incomeCents, 0); assert.equal(r.total.receiptsCents, 0); assert.equal(r.total.methods.credit, 0);
  assert.equal(r.complete, true);
  const january = report([doc({status:4}), doc({id:id(2), type:330, documentDate:'2026-02-02'})], [], {toDate:'2026-01-31'});
  assert.equal(january.total.incomeCents, 10000, 'a later cancellation must not erase the original period');
});
test('exempt businesses use receipts as income and exclude self invoices', () => {
  const r = report([doc({business:{type:3}, type:400, vat:0, payment:[{type:4, price:118}]}), doc({id:id(2), client:{self:true}})]);
  assert.equal(r.total.incomeCents, 11800); assert.equal(r.total.receiptsCents, 11800); assert.equal(r.profitComplete, true);
  assert.equal(r.vatComplete, false, 'self invoices require official VAT reconciliation');
  const unknown = report([doc({type:400, business:{}, vat:0, payment:[{type:4, price:118}]})]);
  assert.equal(unknown.profitCents, null); assert.equal(unknown.receiptsComplete, true);
});
test('expense reporting date controls the report, deleted expenses and credit signs', () => {
  const r = report([], [expense(), expense({id:id(21), status:100}), expense({id:id(22), documentType:330})]);
  assert.equal(r.total.expensesCents, 0); assert.equal(r.records.length, 2);
  assert.equal(report([], [expense()], {fromDate:'2026-01-15'}).total.expensesCents, 0);
  const missingInvoiceVat = report([], [expense({vat:null})]);
  assert.equal(missingInvoiceVat.expensesComplete, false);
  assert.equal(missingInvoiceVat.profitCents, -5000, 'known gross and source deductible VAT are sufficient for managerial cost');
  assert.equal(report([], [expense({status:30})]).profitCents, -5000);
});
test('four edited expenses in July-August retain current totals, VAT and a reconciliation notice', () => {
  const rows = Array.from({length:4}, (_, i) => expense({id:id(30 + i), status:30, reportingDate:i < 2 ? '2026-07-01' : '2026-08-01', date:'2026-06-20'}));
  const options = reportPeriod('bimonth', 2026, 4);
  const r = report([doc({documentDate:'2026-07-10', amount:1180, amountLocal:1180, vat:180})], rows, options);
  assert.equal(r.complete, true); assert.equal(r.profitCents, 80000);
  assert.equal(r.total.expensesCents, 20000); assert.equal(r.total.deductibleExpensesCents, 20000);
  assert.equal(r.total.inputVatCents, 3600); assert.equal(r.vatBalanceCents, 14400);
  assert.equal(r.notices[0].code, 'expense-edited'); assert.equal(r.notices[0].count, 4);
  assert.equal(r.issues.length, 0); assert.equal(r.records.length, 5);
  const missingVat = report([], [expense({status:30, deductibleVat:null})]);
  assert.equal(missingVat.profitCents, null); assert.equal(missingVat.vatBalanceCents, null);
  assert.equal(missingVat.expensesComplete, true); assert.equal(missingVat.expenseCostComplete, false);
  assert.equal(missingVat.complete, false); assert.equal(missingVat.issues[0].code, 'input-vat');
  const missingAmount = report([], [expense({status:30, amountLocal:null, amount:null})]);
  assert.equal(missingAmount.profitCents, null); assert.equal(missingAmount.expensesComplete, false);
  const outside = report([], [expense({status:30})], options);
  assert.equal(outside.notices.length, 0); assert.equal(outside.total.expensesCents, 0);
});
test('foreign currencies use explicit rates, never mix native amounts into ILS', () => {
  const r = report([doc({currency:'USD', currencyRate:3.5, amount:100, amountLocal:350, vat:10, type:320, payment:[{type:3, currency:'USD', price:100}]})]);
  assert.equal(r.total.incomeCents, 31500); assert.equal(r.total.methods.credit, 35000);
  const missing = report([doc({currency:'USD', currencyRate:undefined, amountLocal:undefined, type:320, payment:[{type:3, currency:'USD', price:118}]})]);
  assert.equal(missing.profitCents, null); assert.equal(missing.receiptsComplete, false);
});
test('missing breakdowns and unknown payment types remain visible and partial', () => {
  const r = report([doc({type:400, payment:[{type:0, price:18}, {type:77, price:20}, {type:3, price:60}]})]);
  assert.equal(r.total.methods.withholding, 1800); assert.equal(r.total.methods.unknown, 4000);
  assert.equal(Object.values(r.total.methods).reduce((a, b) => a + b, 0), r.total.receiptsCents);
  assert.equal(r.complete, false);
  const unavailable = buildMorningReport({documents:[], expenses:null, fromDate:'2026-01-01', toDate:'2026-12-31', errors:[{source:'expenses', message:'הוצאות לא זמינות'}]});
  assert.equal(unavailable.profitCents, null); assert.equal(unavailable.expensesComplete, false);
});
test('month, quarter, leap year, invalid ranges and safe CSV', () => {
  assert.deepEqual(reportPeriod('month', 2024, 2), {fromDate:'2024-02-01', toDate:'2024-02-29'});
  assert.deepEqual(reportPeriod('quarter', 2026, 4), {fromDate:'2026-10-01', toDate:'2026-12-31'});
  assert.deepEqual(reportPeriod('bimonth', 2026, 1), {fromDate:'2026-01-01', toDate:'2026-02-28'});
  assert.deepEqual(reportPeriod('bimonth', 2024, 1), {fromDate:'2024-01-01', toDate:'2024-02-29'});
  assert.deepEqual(reportPeriod('bimonth', 2026, 6), {fromDate:'2026-11-01', toDate:'2026-12-31'});
  assert.throws(() => reportInput({source:'documents', fromDate:'2026-02-30', toDate:'2026-03-01'}));
  assert.throws(() => reportPeriod('month', 2026, 13));
  const csv = reportCsv([['=HYPERLINK("bad")', '@SUM(A1)', 'טקסט, "מצוטט"', -1.25]]);
  assert.ok(csv.startsWith('\ufeff')); assert.ok(csv.includes("'=HYPERLINK")); assert.ok(csv.includes("'@SUM")); assert.ok(csv.includes('"-1.25"'));
});
test('VAT uses deductible input VAT in reporting months, including zero recognition and credits', () => {
  const r = report([doc(), doc({id:id(2), documentDate:'2026-02-10'})], [
    expense({date:'2025-11-20', deductibleVat:4.5}),
    expense({id:id(21), reportingDate:'2026-02-01', vat:9, deductibleVat:0}),
    expense({id:id(22), reportingDate:'2026-03-01', date:'2026-01-15', deductibleVat:9}),
  ], {...reportPeriod('bimonth', 2026, 1), group:'bimonth'});
  assert.equal(r.buckets.length, 1); assert.equal(r.buckets[0].key, '2026-01');
  assert.equal(r.total.outputVatCents, 3600); assert.equal(r.total.inputVatCents, 450);
  assert.equal(r.vatBalanceCents, 3150); assert.equal(r.vatComplete, true);
  assert.equal(report([doc({type:330})], [expense({documentType:330})]).vatBalanceCents, -900);
  assert.equal(report([doc()], [expense({deductibleVat:null})]).vatBalanceCents, null);
  assert.equal(report([doc()], [expense()], {fromDate:'2026-01-15'}).vatBalanceCents, null);
  assert.equal(report([], [], {group:'bimonth'}).buckets.length, 6);
  assert.equal(report([], [], {group:'quarter'}).buckets.length, 4);
});
test('managerial expense cost includes unrecoverable VAT, separately from net expense analysis', () => {
  for (const [deductibleVat, cost, profit, unrecoverable] of [[0, 11800, -1800, 1800], [6, 11200, -1200, 1200], [18, 10000, 0, 0]]) {
    const r = report([doc()], [expense({amount:118, amountLocal:118, vat:18, deductibleVat})]);
    assert.equal(r.total.expensesCents, 10000);
    assert.equal(reportMetric(r.total, 'expenseCostCents'), cost);
    assert.equal(reportMetric(r.total, 'unrecoverableVatCents'), unrecoverable);
    assert.equal(r.profitCents, profit);
    assert.equal(reportMetric(r.buckets[0], 'profitCents'), profit);
    assert.equal(r.expenseCostComplete, true);
  }
  const exempt = report([doc({type:400, business:{type:3}, amount:100, amountLocal:100, vat:0, payment:[{type:1, price:100}]})],
    [expense({amount:118, amountLocal:118, vat:18, deductibleVat:0})]);
  assert.equal(exempt.profitCents, -1800, 'source zero deductible VAT preserves the full acquisition cost for exempt entities');
  const unknown = report([doc()], [expense({amount:118, amountLocal:118, vat:18, deductibleVat:null})]);
  assert.equal(reportMetric(unknown.total, 'expensesCents'), 10000);
  assert.equal(reportMetric(unknown.total, 'expenseCostCents'), null);
  assert.equal(unknown.profitCents, null, 'missing deductible VAT must not imply a full reclaim');
  assert.ok(unknown.records.find(row => row.kind === 'expense').issues.some(item => item.code === 'input-vat'));
});

test('expense credits reverse cost, deductible VAT and unrecoverable VAT consistently', () => {
  const r = report([], [expense({documentType:330, amount:118, amountLocal:118, vat:18, deductibleVat:6})]);
  assert.equal(r.total.expensesCents, -10000);
  assert.equal(r.total.expenseCostCents, -11200);
  assert.equal(r.total.unrecoverableVatCents, -1200);
  assert.equal(r.total.inputVatCents, -600);
  assert.equal(r.profitCents, 11200);
  const signedCredit = report([], [expense({documentType:330, amount:-118, amountLocal:-118, vat:-18, deductibleVat:-6})]);
  assert.equal(signedCredit.total.expenseCostCents, -11200);
  const inconsistent = report([], [expense({vat:9, deductibleVat:18})]);
  assert.equal(reportMetric(inconsistent.total, 'expenseCostCents'), null);
  assert.equal(reportMetric(inconsistent.total, 'inputVatCents'), null);
  assert.ok(inconsistent.issues.some(item => item.code === 'input-vat-inconsistent'));
});

test('unknown receipt amounts never appear as verified zero and do not hide good months', () => {
  const r = report([
    doc({type:400, amountLocal:null, amount:null, payment:[{type:3, price:118}]}),
    doc({id:id(2), type:400, documentDate:'2026-02-10', payment:[{type:1, price:118}]}),
  ]);
  assert.equal(r.total.receiptsCents, 11800, 'known subtotal remains available internally');
  assert.equal(reportMetric(r.total, 'receiptsCents'), null);
  assert.equal(r.receiptAmountComplete, false);
  assert.equal(reportMetric(r.buckets[0], 'receiptsCents'), null);
  assert.equal(reportMetric(r.buckets[1], 'receiptsCents'), 11800);
  assert.equal(reportMetric(r.buckets[1], 'methods', 'cash'), 11800);
  assert.equal(reportMetric(r.buckets[2], 'receiptsCents'), 0, 'a successfully read inactive month is a real zero');
  assert.equal(reportMetric(r.records[0], 'receiptsCents'), null);
  assert.equal(r.records[0].issues[0].code, 'receipt-money');
});

test('verified receipt totals remain usable when only their allocation is incomplete', () => {
  const r = report([doc({type:400, payment:[{type:3, price:60}]})]);
  assert.equal(r.receiptAmountComplete, true);
  assert.equal(r.paymentBreakdownComplete, false);
  assert.equal(r.receiptsComplete, false, 'legacy composite still indicates allocation problems');
  assert.equal(reportMetric(r.total, 'receiptsCents'), 11800);
  assert.equal(reportMetric(r.total, 'methods', 'credit'), null, 'incomplete method totals are not presented as verified');
  assert.equal(r.total.methods.credit, 6000);
  assert.equal(r.total.methods.unknown, 5800);
  const zeroReceipt = report([doc({type:400, amount:0, amountLocal:0, vat:0, payment:[]})]);
  assert.equal(reportMetric(zeroReceipt.total, 'receiptsCents'), 0);
  assert.equal(zeroReceipt.receiptsComplete, true);
});

test('completeness is independent for each record, month and total metric', () => {
  const r = report([doc(), doc({id:id(2), documentDate:'2026-02-10', vat:null})], [expense()]);
  assert.equal(r.incomeComplete, false); assert.equal(r.outputVatComplete, false);
  assert.equal(reportMetric(r.total, 'incomeCents'), null);
  assert.equal(reportMetric(r.total, 'outputVatCents'), null);
  assert.equal(reportMetric(r.buckets[0], 'incomeCents'), 10000);
  assert.equal(reportMetric(r.buckets[0], 'outputVatCents'), 1800);
  assert.equal(reportMetric(r.buckets[0], 'expenseCostCents'), 5000);
  assert.equal(reportMetric(r.buckets[0], 'profitCents'), 5000);
  assert.equal(reportMetric(r.buckets[0], 'vatBalanceCents'), 900);
  assert.equal(reportMetric(r.buckets[1], 'incomeCents'), null);
  assert.equal(reportMetric(r.buckets[1], 'outputVatCents'), null);
  assert.equal(reportMetric(r.buckets[1], 'expenseCostCents'), 0);
  assert.equal(reportMetric(r.buckets[2], 'profitCents'), 0);
  assert.equal(r.buckets[0].issues.length, 0);
  assert.deepEqual(r.buckets[1].issues.map(item => item.code), ['income-money', 'output-vat']);
  assert.equal(r.records[0].outputVatComplete, true);
  assert.equal(r.records[1].outputVatComplete, false);
});

test('missing sources propagate to all zero-activity months instead of inventing complete zero totals', () => {
  for (const missing of ['documents', 'expenses']) {
    const r = report(missing === 'documents' ? null : [], missing === 'expenses' ? null : []);
    const missingFields = missing === 'documents' ? ['incomeCents', 'receiptsCents', 'outputVatCents'] : ['expensesCents', 'expenseCostCents', 'inputVatCents'];
    for (const scope of [r.total, ...r.buckets]) for (const field of missingFields) assert.equal(reportMetric(scope, field), null, `${missing}: ${field} must remain unknown`);
    assert.equal(r.profitCents, null);
    assert.equal(r.buckets.length, 12);
    assert.equal(reportMetric(r.buckets[0], missing === 'documents' ? 'expenseCostCents' : 'incomeCents'), 0);
  }
  const failed = report([], [], {errors:[{source:'expenses', message:'unavailable'}]});
  assert.equal(reportMetric(failed.total, 'expenseCostCents'), null);
  assert.equal(reportMetric(failed.buckets[0], 'expenseCostCents'), null);
});

test('a partial custom period does not hide VAT of full interior months', () => {
  const r = report([doc({documentDate:'2026-02-10'})], [expense({reportingDate:'2026-02-01'})], {fromDate:'2026-01-15', toDate:'2026-03-31'});
  assert.equal(r.vatComplete, false);
  assert.equal(reportMetric(r.total, 'vatBalanceCents'), null);
  assert.equal(reportMetric(r.buckets[0], 'vatBalanceCents'), null);
  assert.equal(reportMetric(r.buckets[1], 'vatBalanceCents'), 900);
  assert.equal(reportMetric(r.buckets[2], 'vatBalanceCents'), 0);
});

test('known arithmetic and derived profit are constrained to safe integer cents', () => {
  const huge = {...doc(), grossCents:Number.MAX_SAFE_INTEGER, vatCents:0};
  assert.throws(() => report([huge, {...huge, id:id(2)}]), /טווח החישוב/);
  assert.throws(() => report([huge], [{...expense(), grossCents:-Number.MAX_SAFE_INTEGER, vatCents:0, deductibleVatCents:0}]), /טווח החישוב/);
  assert.throws(() => report([huge, {...huge, id:id(2), grossCents:2}, {...huge, id:id(3), grossCents:-2}]), /טווח החישוב/, 'an unsafe intermediate sum cannot be made accurate by a later reversal');
  assert.throws(() => report([{...huge, type:400, payments:[{type:3, amountCents:Number.MAX_SAFE_INTEGER}, {type:3, amountCents:2}, {type:3, amountCents:-2}]}]), /טווח החישוב/, 'payment allocation uses checked arithmetic too');
});

test('report permissions are server controlled and upstream receives only whitelisted reads', async () => {
  assert.equal(reportPermission({id:id(1), user_metadata:{morning_reports:true}}), false);
  assert.equal(reportPermission({id:id(1)}, id(1)), true);
  const calls = [], handler = createMorningReportsHandler({environment:'sandbox', allowedIds:() => id(1), request:async (path, init) => { calls.push({path, payload:JSON.parse(init.body)}); return {items:[], total:0, pages:0, page:1}; }});
  const body = {source:'expenses', fromDate:'2026-01-15', toDate:'2026-02-20', page:0, url:'https://bad', status:[100]};
  assert.equal((await handler({id:id(2)}, body)).status, 403); assert.equal(calls.length, 0);
  const response = await handler({id:id(1)}, body);
  assert.equal(response.status, 200); assert.equal(response.body.environment, 'sandbox');
  assert.deepEqual(calls, [{path:'/expenses/search', payload:{page:1, pageSize:50, fromDate:'2026-01-01', toDate:'2026-02-01'}}]);
});
function pageResponse({page, source, fromDate, toDate}) {
  return {ok:true, version:1, page, source, fromDate, toDate, pageSize:50, total:51, pages:2, environment:'production', readAt:'2026-10-19T00:00:00Z', items:Array.from({length:page ? 1 : 50}, (_, i) => ({...doc(), id:id(page * 50 + i), date:'2026-01-10'}))};
}
test('all pages are read once and failed, duplicate, shifted or cross-environment pages reject a source', async () => {
  const input = {source:'documents', fromDate:'2026-01-01', toDate:'2026-12-31', assertCurrent:() => {}};
  const calls = []; const request = async (_action, body) => { calls.push(body); return pageResponse(body); };
  assert.equal((await loadMorningReportSource({...input, request})).items.length, 51); assert.equal(calls.length, 2);
  for (const mutation of [r => {r.items[0].id = id(0);}, r => {r.total = 52;}, r => {r.environment = 'sandbox';}, r => {r.page = 0;}]) {
    await assert.rejects(loadMorningReportSource({...input, request:async (_action, body) => {const r = pageResponse(body); if (body.page) mutation(r); return r;}}));
  }
  await assert.rejects(loadMorningReportSource({...input, request:async (_action, body) => {if (body.page) throw new Error('network'); return pageResponse(body);}}));
  let active = true;
  await assert.rejects(loadMorningReportSource({...input, assertCurrent:() => {if (!active) throw new Error('scope');}, request:async (_action, body) => {active = false; return pageResponse(body);}}));
});
test('projection removes private supplier, bank and signed PDF fields', () => {
  const row = doc({url:{he:'secret'}, client:{name:'לקוח', taxId:'private'}, payment:[{type:2, price:118, bankAccount:'private-account'}]});
  assert.equal(JSON.stringify(row).includes('private'), false); assert.equal(JSON.stringify(row).includes('secret'), false);
});
