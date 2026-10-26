import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createExpenseRequest} from '../netunim-orders/site/assets/js/integrations/morning-expenses.js';
import {readExpenseCatalog, readExpenseCatalogPage, expenseSupplierEligibility} from '../netunim-orders/site/assets/js/domains/finance/morning-expense-catalog.js';
import {validateExpenseFile, uploadExpenseFile} from '../netunim-orders/site/assets/js/platform/morning-expense-files.js';

test('expense client fences auth refresh, body consumption and errors to the entering account', async () => {
  let current = true, calls = 0;
  const check = () => {if (!current) throw new Error('account_changed');};
  const request = createExpenseRequest({supaFetch:async (path, options) => {
    calls++; assert.equal(path, '/functions/v1/morning-expenses'); assert.equal(options.networkRetry, false);
    assert.equal(typeof options.assertRequestScope, 'function'); options.assertRequestScope();
    return {ok:true, json:async () => {current = false; return {ok:true};}};
  }});
  await assert.rejects(request('capabilities', {}, check), /account_changed/);
  await assert.rejects(request('create', {}, check), /account_changed/); assert.equal(calls, 1);
});
test('malformed pages and switched environments invalidate catalog suggestions', async () => {
  for (const fault of ['total', 'duplicate', 'environment']) {
    const request = async (action, body) => {
      if (action === 'capabilities') return {version:1, environment:'sandbox'};
      const rows = Array.from({length:50}, (_, index) => ({id:String(index), name:'Supplier', active:true}));
      if (fault === 'duplicate') rows[1].id = '0';
      return {version:1, environment:fault === 'environment' ? 'production' : 'sandbox', page:body.page, pageSize:50,
        total:fault === 'total' ? 49 : 51, pages:2, items:rows};
    };
    await assert.rejects(readExpenseCatalog(request, () => {}, '2026-10-26'));
  }
});

test('large directories load one page only and later searches remain bounded and account fenced', async () => {
  const calls = [], capabilities = {version:1, environment:'sandbox'};
  const request = async (action, body) => {
    calls.push({action, body}); if (action === 'capabilities') return capabilities;
    return {version:1, environment:'sandbox', page:body.page, pageSize:50, total:5000, pages:100,
      items:Array.from({length:50}, (_, index) => ({id:String(body.page * 50 + index), kind:'expense', name:'Supplier', active:true}))};
  };
  const catalog = await readExpenseCatalog(request, () => {}, '2026-10-26');
  assert.equal(calls.length, 3); assert.equal(catalog.suppliers.length, 50); assert.equal(catalog.expenses.length, 50);
  assert.equal(catalog.supplierPage.total, 5000);
  const page = await readExpenseCatalogPage(request, capabilities, 'suppliers', {taxId:'123456789'}, 5, () => {});
  assert.equal(page.items.length, 50); assert.deepEqual(calls.at(-1).body, {taxId:'123456789',page:5});
  await assert.rejects(readExpenseCatalogPage(request, capabilities, 'suppliers', {}, 6, () => {throw Error('account_changed');}), /account_changed/);
});

test('supplier eligibility exposes missing identities, foreign suppliers and protected P matches before submission', () => {
  const supplier = {id:'one', taxId:'123456789', active:true, country:'IL'};
  assert.equal(expenseSupplierEligibility(supplier).eligible, true);
  for (const patch of [{taxId:''}, {country:'PS'}, {active:false}]) assert.equal(expenseSupplierEligibility({...supplier, ...patch}).eligible, false);
  assert.equal(expenseSupplierEligibility(supplier, [{id:'different',taxId:'123456789'}]).p, true);
});
test('catalog classifications retain source expense IDs and genuine recognition percentages', async () => {
  const request = async action => action === 'capabilities' ? {version:1, environment:'sandbox'} : {
    version:1, environment:'sandbox', page:0, pageSize:50, total:1, pages:1,
    items:action === 'suppliers' ? [{id:'supplier', name:'Supplier', active:true}] : [{id:'expense', kind:'expense', status:10, classification:{id:'category', title:'Category', vat:66.67}}],
  };
  const catalog = await readExpenseCatalog(request, () => {}, '2026-10-26');
  assert.equal(catalog.classifications[0].sourceExpenseId, 'expense'); assert.equal(catalog.classifications[0].vat, 66.67);
});
test('source files require valid magic bytes and uploads preserve fields, put file last and omit credentials', async () => {
  const file = new File(['%PDF-1.4\n'], 'invoice.pdf', {type:'application/pdf'}), selected = await validateExpenseFile(file);
  await assert.rejects(validateExpenseFile(new File(['not a PDF'], 'invoice.pdf', {type:'application/pdf'})));
  await assert.rejects(validateExpenseFile(new File(['%PDF-1.4'], 'image.png', {type:'image/png'})));
  const ticket = {url:'https://s3.eu-west-1.amazonaws.com/sandbox-file-upload-service-uploaded', fields:{key:'test', Policy:'exact-policy'}, maxFileSize:100, expiresAt:1000};
  let calls = 0;
  const result = await uploadExpenseFile(ticket, selected, () => {}, {now:() => 500, fetch:async (_, init) => {
    calls++; assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error'); assert.equal(init.headers, undefined);
    assert.deepEqual([...init.body.keys()], ['key', 'Policy', 'file']); assert.equal(init.body.get('Policy'), 'exact-policy');
    return new Response(null, {status:204});
  }});
  assert.equal(result.accepted, true); assert.equal(result.fileLinked, false);
  await assert.rejects(uploadExpenseFile({...ticket, expiresAt:1}, selected, () => {}, {fetch:() => assert.fail('expired upload')}));
  await assert.rejects(uploadExpenseFile({...ticket, url:'https://attacker.example'}, selected, () => {}, {fetch:() => assert.fail('unsafe upload')}));
  assert.equal(calls, 1);
});
