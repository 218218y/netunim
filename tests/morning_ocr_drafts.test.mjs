import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {draftRecord, createExpenseService} from '../netunim-orders/supabase/functions/morning-expenses/service.js';

const fixture = JSON.parse(await readFile(new URL('./fixtures/morning-ocr-sandbox.json', import.meta.url), 'utf8'));
test('real sanitized Sandbox draft shapes retain document types, exact VAT and leading invoice zeros as unverified suggestions', () => {
  assert.equal(fixture.items.length, 3);
  for (const raw of fixture.items) {
    const row = draftRecord(raw);
    assert.equal(row.documentType, raw.expense.documentType);
    assert.equal(row.number, raw.expense.number);
    assert.equal(row.vat, raw.expense.vat); assert.equal(row.amount, raw.expense.amount);
    if (row.grossCents !== null && row.vatCents !== null) assert.equal(row.netCents + row.vatCents, row.grossCents);
    assert.equal(row.supplier.verified, false); assert.equal(row.approved, false); assert.equal(row.parsingVerified, false);
    assert.equal(row.reviewRequired, true); assert.ok(!Object.hasOwn(row, 'pcnClassification'));
    assert.ok(!JSON.stringify(row).includes('private.invalid'));
  }
  const row = draftRecord({...fixture.items[0], expense:{...fixture.items[0].expense, number:'000001', amount:1160, vat:150}});
  assert.equal(row.number, '000001'); assert.equal(row.netCents, 101000); assert.equal(row.vatCents, 15000);
});
test('partial drafts, malformed money and status 10 never imply complete parsing or invented supplier identity', () => {
  for (const hasDefaultValues of [true, false]) {
    const row = draftRecord({...fixture.items[0], hasDefaultValues, expense:{amount:0.001, vat:'18', supplier:{name:'Similar name'}}});
    assert.equal(row.documentType, null); assert.equal(row.grossCents, null); assert.equal(row.vatCents, 1800);
    assert.equal(row.netCents, null); assert.equal(row.supplier.id, ''); assert.equal(row.supplier.taxId, '');
    assert.equal(row.parsingVerified, false); assert.ok(row.missingFields.includes('date'));
  }
  assert.throws(() => draftRecord({...fixture.items[0], status:999}));
});
test('draft search maps canonical data without leaking source links or private supplier fields', async () => {
  const service = createExpenseService({environment:'sandbox', request:async path => {
    assert.equal(path, '/expenses/drafts/search');
    return {page:1, pages:1, pageSize:50, total:3, items:fixture.items};
  }});
  const result = await service({id:'owner', app_metadata:{morning_expenses_read:true}}, {action:'drafts', fromDate:'2026-10-26', toDate:'2026-10-27', expectedEnvironment:'sandbox'});
  assert.equal(result.status, 200); assert.equal(result.body.items.length, 3);
  assert.ok(result.body.items.every(row => row.approved === false && row.reviewRequired));
  assert.ok(!JSON.stringify(result).includes('private.invalid'));
});
