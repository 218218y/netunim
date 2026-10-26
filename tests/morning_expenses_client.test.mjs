import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createExpenseRequest} from '../netunim-orders/site/assets/js/integrations/morning-expenses.js';
import {readExpenseCatalog} from '../netunim-orders/site/assets/js/domains/finance/morning-expense-catalog.js';
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
test('a late partial catalog, duplicate or switched environment invalidates the whole catalog', async () => {
  for (const fault of ['total', 'duplicate', 'environment']) {
    const request = async (action, body) => {
      if (action === 'capabilities') return {version:1, environment:'sandbox'};
      const rows = action === 'suppliers' ? Array.from({length:body.page === 0 ? 50 : 1}, (_, index) => ({id:String(body.page * 50 + index), name:'Supplier', active:true})) : [];
      if (body.page === 1 && fault === 'duplicate') rows[0].id = '0';
      return {version:1, environment:body.page === 1 && fault === 'environment' ? 'production' : 'sandbox', page:body.page, pageSize:50,
        total:body.page === 1 && fault === 'total' ? 52 : action === 'suppliers' ? 51 : 0, pages:action === 'suppliers' ? 2 : 0, items:rows};
    };
    await assert.rejects(readExpenseCatalog(request, () => {}, '2026-10-26'));
  }
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
