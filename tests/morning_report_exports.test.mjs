import assert from 'node:assert/strict';
import {test} from 'node:test';
import {reportDocument, reportExpense} from '../netunim-orders/supabase/functions/morning-documents/reports.js';
import {buildMorningReport} from '../netunim-orders/site/assets/js/domains/finance/morning-report-model.js';
import {morningReportCsv, morningReportExportRows} from '../netunim-orders/site/assets/js/domains/finance/morning-report-exports.js';
import {parseReportAmount, reconcileMorningReport, RECONCILIATION_METRICS} from '../netunim-orders/site/assets/js/domains/finance/morning-report-reconciliation.js';
import {morningReconciliationMarkup} from '../netunim-orders/site/assets/js/domains/finance/morning-report-reconciliation-view.js';

const id = number => `aaaaaaaa-aaaa-4aaa-aaaa-${String(number).padStart(12, '0')}`;
const document = patch => reportDocument({id:id(1),number:'123',type:305,status:0,business:{type:1},client:{name:'לקוח'},description:'תיאור',documentDate:'2026-01-15',amount:118,amountLocal:118,vat:18,currency:'ILS',creationDate:1767225600,...patch});
const expense = patch => reportExpense({id:id(2),number:'100',documentType:305,status:10,supplier:{name:'ספק'},description:'הוצאה',date:'2025-12-28',reportingDate:'2026-01-01',amount:118,amountLocal:118,vat:18,currency:'ILS',deductibleAmount:100,deductibleVat:0,...patch});
const report = (documents = [document()], expenses = [expense()], patch = {}) => buildMorningReport({documents,expenses,fromDate:'2026-01-01',toDate:'2026-01-31',...patch});
const metadata = {reportType:'profit',environment:'production',readAt:'2026-10-20T10:00:00.000Z',openPeriod:false};
const exported = (r, patch = {}) => morningReportExportRows({report:r,metadata,...patch});
function sourceTable(rows) {
  const index = rows.findIndex(row => row[0] === 'מזהה מסמך / הוצאה במורנינג');
  return {header:rows[index],rows:rows.slice(index + 1)};
}
function summaryTable(rows) {
  const index = rows.findIndex(row => row[0] === 'תקופה');
  return {header:rows[index],rows:rows.slice(index + 1,rows.findIndex((row, i) => i > index && row.length === 0))};
}
const basisFor = keys => Object.fromEntries(RECONCILIATION_METRICS.filter(metric => keys.includes(metric.key)).map(metric => [metric.key,metric.basis]));
const officialFor = (r, valuesCents, patch = {}) => ({valuesCents,reference:'Morning January 2026.csv',scope:{fromDate:r.fromDate,toDate:r.toDate,environment:'production'},basis:basisFor(Object.keys(valuesCents)),...patch});
const compare = (r, official) => reconcileMorningReport({report:r,environment:'production',official});

test('strict decimal input distinguishes missing and zero and never rounds', () => {
  for (const value of ['', '  ', undefined, null]) assert.equal(parseReportAmount(value),null);
  for (const [value,cents] of [['0',0],['-0.00',0],['+12.3',1230],[' 1,234.56 ',123456],['-1,234.56',-123456],[12.25,1225],['90071992547409.91',Number.MAX_SAFE_INTEGER],['-90071992547409.91',Number.MIN_SAFE_INTEGER]]) assert.equal(parseReportAmount(value),cents);
  for (const value of ['1,23','12,34.56','1.001','1e3','₪10','1 000','--1','.5','1.','NaN',NaN,Infinity,true,[],{}]) assert.throws(() => parseReportAmount(value),error => error.code === 'invalid_report_amount',String(value));
  for (const value of ['90071992547409.92','-90071992547409.92']) assert.throws(() => parseReportAmount(value),error => error.code === 'report_amount_out_of_range');
});
test('summary export contains exactly the selected financial columns and metadata', () => {
  const r = report();
  const rows = exported(r,{kind:'summary',periodLabel:key => `חודש ${key}`});
  const summary = summaryTable(rows);
  assert.deepEqual(summary.header,['תקופה','הכנסות לפני מע״מ','הוצאות לפני מע״מ','עלות הוצאות ניהולית','רווח / הפסד ניהולי','שלמות הדוח הנבחר','חוסרים']);
  assert.deepEqual(summary.rows[0].slice(0,6),['חודש 2026-01',100,100,118,-18,'מלא']);
  assert.equal(rows.some(row => row[0] === 'מזהה מסמך / הוצאה במורנינג'),false);
  assert.ok(rows.some(row => row.includes(metadata.readAt) && row.includes('production')));
  assert.ok(rows.some(row => row.includes('תקופה הסתיימה')));
  const vat = summaryTable(exported(r,{kind:'summary',metadata:{...metadata,reportType:'vat'}}));
  assert.deepEqual(vat.header.slice(1,4),['מע״מ עסקאות','מע״מ תשומות מותר','הפרש לתשלום / להחזר']);
  assert.deepEqual(vat.rows[0].slice(1,4),[18,0,18]);
});
test('one missing VAT document leaves intact months exported and total blank', () => {
  const r = report([document(),document({id:id(3),documentDate:'2026-02-15',vat:null})],[],{toDate:'2026-02-28'});
  const summary = summaryTable(exported(r,{kind:'summary',metadata:{...metadata,reportType:'vat'}}));
  assert.deepEqual(summary.rows[0].slice(0,5),['2026-01',18,0,18,'מלא']);
  assert.deepEqual(summary.rows[1].slice(0,5),['2026-02','',0,'','חלקי']);
  assert.deepEqual(summary.rows[2].slice(0,5),['סה״כ','',0,'','חלקי']);
});
test('known partial amounts are separated from complete totals and absent is never zero', () => {
  const r = report([document({type:400,amount:null,amountLocal:null,vat:0,payment:[{type:3,price:118}]})],[]);
  const rows = exported(r,{metadata:{...metadata,reportType:'receipts'}});
  const summary = summaryTable(rows), sources = sourceTable(rows);
  assert.equal(summary.rows[0][1],'');
  assert.equal(summary.rows[0][10],'','an unknown receipt amount is blank rather than a zero total');
  assert.equal(sources.rows[0][sources.header.indexOf('סכום קבלה כולל מע״מ')],'');
  assert.equal(sources.rows[0][sources.header.indexOf('שלמות סכום הקבלה')],'חלקי');
  assert.ok(sources.rows[0][sources.header.indexOf('חוסרים ברשומה')].includes('receipt-money'));
  const mismatch = report([document({type:400,vat:0,payment:[{type:3,price:100}]})],[]);
  const partial = sourceTable(exported(mismatch));
  assert.equal(partial.rows[0][partial.header.indexOf('תקבולים — אשראי')],'');
  assert.equal(partial.rows[0][partial.header.indexOf('הקצאה ידועה בלבד — אשראי')],100);
});
test('sources start with the Morning ID and retain exact dates, classification and current edited status', () => {
  const r = report([document()],[expense({status:30,lastUpdateDate:1767312000,accountingClassification:{title:'רכישה',key:'1310',code:'1300',type:20}})]);
  const sources = sourceTable(exported(r,{kind:'sources'}));
  assert.equal(sources.rows[1][0],id(2));
  const get = label => sources.rows[1][sources.header.indexOf(label)];
  assert.equal(get('תאריך שיוך לדוח'),'2026-01-01');
  assert.equal(get('תאריך מסמך המקור'),'2025-12-28');
  assert.equal(get('עודכן במורנינג'),'2026-01-02T00:00:00.000Z');
  assert.equal(get('מפתח סיווג מקור'),'1310');
  assert.equal(get('קוד סיווג מקור'),'1300');
  assert.equal(get('סוג סיווג מקור'),20);
  assert.equal(get('הוצאה לפני מע״מ'),100);
  assert.equal(get('עלות הוצאה ניהולית'),118);
  assert.equal(get('מע״מ שאינו ניתן לקיזוז'),18);
  assert.equal(get('מע״מ תשומות מותר'),0);
  assert.equal(get('תיאור סטטוס הוצאה'),'הוצאה שנערכה מחדש');
  assert.ok(get('הערות לרשומה').includes('expense-edited'));
  assert.equal(exported(r,{kind:'sources'}).some(row => row[0] === 'תקופה'),false);
});
test('source payment columns are blank on invoices/expenses and signed on reversal receipts', () => {
  const r = report([document(),document({id:id(3),type:400,amount:-118,amountLocal:-118,vat:0,payment:[{type:3,price:118}]})],[expense({documentType:330})]);
  const {header,rows} = sourceTable(exported(r));
  const payment = header.indexOf('תקבולים — אשראי');
  assert.equal(rows[0][payment],'');
  assert.equal(rows[1][payment],-118);
  assert.equal(rows[2][payment],'');
  assert.equal(rows[2][header.indexOf('עלות הוצאה ניהולית')],-118);
  assert.equal(rows[2][header.indexOf('הוצאה לפני מע״מ')],-100);
});
test('CSV keeps formula injection guards, quotes, UTF-8 BOM, safe signed numeric values and exact extreme cents', () => {
  const r = report([document({client:{name:'=HYPERLINK("bad")'},description:'@SUM(A1)\n"quoted"'})],[]);
  const csv = morningReportCsv({report:r,metadata});
  assert.ok(csv.startsWith('\ufeff'));
  assert.ok(csv.includes("'=HYPERLINK"));
  assert.ok(csv.includes("'@SUM"));
  assert.ok(csv.includes('""quoted""'));
  assert.ok(morningReportCsv({report:report(),metadata}).includes('"-18"'),'safe calculated negatives remain numeric spreadsheet cells');
  const huge = report([{...document(),grossCents:Number.MAX_SAFE_INTEGER,vatCents:0}],[]);
  const values = summaryTable(exported(huge,{kind:'summary'})).rows[0];
  assert.equal(values[1],'90071992547409.91','extreme decimal text keeps the last cent rather than stringify a rounded JS number');
});
test('filtered source exports keep the full-report summary and mark the selection', () => {
  const r = report(), rows = exported(r,{records:r.records.slice(0,1),metadata:{...metadata,selectionLabel:'לקוח נבחר',openPeriod:true}});
  assert.equal(sourceTable(rows).rows.length,1);
  assert.equal(summaryTable(rows).rows[0][3],118);
  assert.ok(rows.some(row => row.includes('תקופה פתוחה — נתוני ביניים')));
  assert.ok(rows.some(row => row.includes('הסיכום מתייחס לכל הדוח ולא למסנן רשומות המקור')));
  for (const patch of [{kind:'xlsx'},{metadata:{reportType:'bad'}},{report:{...r,fromDate:'2026-02-30'}}]) assert.throws(() => exported(r,patch),/invalid_report_export/);
});
test('manual reference comparison returns safe cent differences without claiming accounting verification', () => {
  const r = report(), before = structuredClone(r);
  const result = compare(r,officialFor(r,{incomeCents:10000,expenseCostCents:11800,profitCents:-1800,inputVatCents:0,receiptsCents:100}));
  const metric = key => result.metrics.find(item => item.key === key);
  assert.equal(metric('incomeCents').state,'match');
  assert.equal(metric('inputVatCents').state,'match','official zero remains known zero');
  assert.equal(metric('profitCents').state,'match');
  assert.equal(metric('receiptsCents').state,'difference');
  assert.equal(metric('receiptsCents').differenceCents,-100,'difference is source minus reference');
  assert.equal(metric('outputVatCents').state,'no-official');
  assert.equal(metric('outputVatCents').officialCents,null);
  assert.equal(result.accountingVerified,false);
  assert.equal(result.method,'manual-reference');
  assert.equal(result.compared,5);assert.equal(result.matched,4);
  assert.deepEqual(r,before,'reconciliation cannot change financial results or completeness');
});
test('unknown basis, official P&L basis, missing reference and differing scopes cannot become a match', () => {
  const r = report();
  for (const patch of [
    {basis:{}}, {basis:{profitCents:'morning-official-profit-excluding-fixed-assets'}}, {reference:''},
    {scope:{fromDate:r.fromDate,toDate:r.toDate,environment:'sandbox'}},
    {scope:{fromDate:'2026-01-15',toDate:r.toDate,environment:'production'}},
    {scope:{fromDate:r.fromDate,toDate:'2026-02-30',environment:'production'}},
  ]) {
    const item = compare(r,officialFor(r,{profitCents:-1800},patch)).metrics.find(metric => metric.key === 'profitCents');
    assert.equal(item.state,'incomparable'); assert.equal(item.differenceCents,null);
  }
});
test('incomplete source and no official value remain distinct from numeric zero', () => {
  const r = report([document({type:400,amount:null,amountLocal:null,vat:0})],[]);
  const result = compare(r,officialFor(r,{receiptsCents:0,incomeCents:null}));
  assert.equal(result.metrics.find(metric => metric.key === 'receiptsCents').state,'missing-source');
  assert.equal(result.metrics.find(metric => metric.key === 'receiptsCents').sourceCents,null);
  assert.equal(result.metrics.find(metric => metric.key === 'incomeCents').state,'no-official');
  for (const value of ['',false,0.1,'100']) assert.throws(() => compare(r,officialFor(r,{receiptsCents:value})),error => error.code === 'invalid_report_amount');
  assert.throws(() => compare(r,officialFor(r,{madeUpCents:0})),/invalid_reconciliation_metric/);
});
test('unsafe reconciliation differences reject instead of losing cents', () => {
  const r = report([{...document(),grossCents:Number.MAX_SAFE_INTEGER,vatCents:0}],[]);
  assert.throws(() => compare(r,officialFor(r,{incomeCents:Number.MIN_SAFE_INTEGER})),error => error.code === 'report_amount_out_of_range');
  assert.throws(() => reconcileMorningReport({report:r,environment:'unknown'}),/invalid_reconciliation_report/);
});
test('manual reference markup starts unconfirmed, uses existing lazy bindings and shows scope and explicit acquisition basis', () => {
  const html = morningReconciliationMarkup({report:report(),environment:'production',reportType:'profit'});
  assert.ok(html.startsWith('<details class="morning-report-reconciliation">'));
  assert.ok(html.includes('2026-01-01–2026-01-31'));
  assert.ok(html.includes('סביבת אמת (Production)'));
  assert.ok(html.includes('דוח רווח והפסד רשמי במורנינג עשוי להחריג רכוש קבוע'));
  assert.ok(html.includes('אינה מאמתת את הקובץ'));
  assert.equal(html.includes(' checked'),false);
  for (const option of ['official:reference','official:scope','official:value:incomeCents','official:basis:profitCents']) assert.ok(html.includes(`data-report-option="${option}"`));
  assert.ok(html.includes('data-change="morning-report-option"'));
  assert.ok(html.includes('data-label="סכום באתר"'));
  assert.ok(html.includes('data-reconciliation-state="no-official"'));
  assert.equal(html.includes('official:value:receiptsCents'),false,'only selected-report metrics are shown');
});
test('manual markup distinguishes empty, zero, invalid and matched amounts; reference, scope and basis confirmations are mandatory', () => {
  const r = report([],[]);
  const make = patch => morningReconciliationMarkup({report:r,environment:'sandbox',reportType:'receipts',inputs:{reference:'דוח רשמי',scopeConfirmed:true,values:{receiptsCents:'0'},basisConfirmed:{receiptsCents:true},...patch}});
  assert.ok(make().includes('data-reconciliation-state="match"'));
  assert.ok(make().includes('<bdi dir="ltr">0.00 ₪</bdi>'));
  assert.ok(make({values:{receiptsCents:''}}).includes('data-reconciliation-state="no-official"'));
  assert.ok(make({values:{receiptsCents:'1.001'}}).includes('data-reconciliation-state="invalid-value"'));
  for (const patch of [{reference:''},{scopeConfirmed:false},{basisConfirmed:{}}]) assert.ok(make(patch).includes('data-reconciliation-state="incomparable"'));
  assert.ok(make({values:{receiptsCents:'1'}}).includes('data-reconciliation-state="difference"'));
  assert.ok(make({values:{receiptsCents:'1'}}).includes('<bdi dir="ltr">-1.00 ₪</bdi>'));
});
test('markup escapes reference, raw values, source scope and external errors and keeps invalid inputs editable', () => {
  const r = report(), attack='"><img src=x onerror=alert(1)>';
  const html = morningReconciliationMarkup({report:{...r,fromDate:attack},environment:'production',reportType:'vat',inputs:{reference:attack,scopeConfirmed:false,values:{outputVatCents:attack},basisConfirmed:{}},error:attack});
  assert.equal(html.includes('<img'),false);
  assert.equal(html.includes('value=""><'),false);
  assert.ok(html.includes('value="&quot;&gt;&lt;img'));
  assert.ok(html.includes('role="alert"'));
  assert.ok(html.includes('data-reconciliation-state="invalid-value"'));
  assert.ok(html.startsWith('<details class="morning-report-reconciliation" open>'));
});
test('one invalid or overflowing manual amount leaves other metric comparisons visible', () => {
  const r = report([{...document(),grossCents:Number.MAX_SAFE_INTEGER,vatCents:0}],[]);
  const html = morningReconciliationMarkup({report:r,environment:'production',reportType:'profit',inputs:{reference:'Reference',scopeConfirmed:true,values:{incomeCents:'-90071992547409.91',expensesCents:'0',profitCents:'not a number'},basisConfirmed:{incomeCents:true,expensesCents:true,profitCents:true},open:false}});
  assert.ok(html.includes('data-reconciliation-state="calculation-error"'));
  assert.ok(html.includes('data-reconciliation-state="match"'));
  assert.ok(html.includes('data-reconciliation-state="invalid-value"'));
  assert.ok(html.startsWith('<details class="morning-report-reconciliation">'),'caller can preserve disclosure closed state');
});
