import assert from 'node:assert/strict';
import {test} from 'node:test';
import {expenseConfiguration} from '../netunim-orders/supabase/functions/morning-expenses/configuration.js';
const shared = {MORNING_ENV:'production', MORNING_CLIENT_ID:'production-id', MORNING_CLIENT_SECRET:'production-secret'};
const config = values => expenseConfiguration(key => ({...shared, ...values})[key]);
test('dedicated expense Sandbox credentials never fall back to the live income credentials', () => {
  assert.equal(config({}).environment, 'production'); assert.equal(config({}).sandboxWrites, false);
  const missing = config({MORNING_EXPENSE_ENV:'sandbox'});
  assert.equal(missing.valid, false); assert.equal(missing.clientId, ''); assert.equal(missing.clientSecret, '');
  assert.equal(config({MORNING_EXPENSE_CLIENT_ID:'partial'}).valid, false);
  const sandbox = config({MORNING_EXPENSE_ENV:'sandbox', MORNING_EXPENSE_CLIENT_ID:'test', MORNING_EXPENSE_CLIENT_SECRET:'test-secret'});
  assert.equal(sandbox.environment, 'sandbox'); assert.equal(sandbox.valid, true); assert.equal(sandbox.clientId, 'test');
  assert.equal(config({MORNING_EXPENSE_ENV:'typo'}).valid, false);
});
test('explicit P supplier protection is required before enabling any Sandbox expense writes', () => {
  const enabled = {MORNING_ENV:'sandbox', MORNING_EXPENSE_SANDBOX_WRITES:'true'};
  for (const raw of [undefined, 'broken', '{}', '[{}]', '[{"id":"local-id","taxId":"123456789"}]']) {
    assert.equal(config({...enabled, MORNING_EXPENSE_P_SUPPLIERS:raw}).sandboxWrites, false);
  }
  assert.equal(config({...enabled, MORNING_EXPENSE_P_SUPPLIERS:'[]'}).sandboxWrites, false);
  const profiles = [{id:'aaaaaaaa-aaaa-4aaa-aaaa-000000000020', taxId:'123456780'}, {id:'aaaaaaaa-aaaa-4aaa-aaaa-000000000021', taxId:'123456781'}];
  assert.equal(config({...enabled, MORNING_EXPENSE_P_SUPPLIERS:JSON.stringify(profiles)}).sandboxWrites, true);
  assert.equal(config({...enabled, MORNING_EXPENSE_P_SUPPLIERS:JSON.stringify([profiles[0], profiles[0]])}).sandboxWrites, false);
  assert.equal(config({MORNING_EXPENSE_SANDBOX_WRITES:'true', MORNING_EXPENSE_P_SUPPLIERS:'[]'}).sandboxWrites, false);
});

test('Production requires a separate pair, an explicit environment, one pilot user and independent create/upload flags', () => {
  const profiles = [{id:'aaaaaaaa-aaaa-4aaa-aaaa-000000000020', taxId:'123456780'}, {id:'aaaaaaaa-aaaa-4aaa-aaaa-000000000021', taxId:'123456781'}];
  const complete = {MORNING_EXPENSE_ENV:'production', MORNING_EXPENSE_CLIENT_ID:'expense-production-id', MORNING_EXPENSE_CLIENT_SECRET:'expense-production-secret',
    MORNING_EXPENSE_PRODUCTION_WRITES:'true', MORNING_EXPENSE_PRODUCTION_USER_ID:profiles[0].id, MORNING_EXPENSE_P_SUPPLIERS:JSON.stringify(profiles)};
  assert.equal(config(complete).productionWrites, true); assert.equal(config(complete).writes, true);
  assert.equal(config(complete).uploads, false);
  assert.equal(config({...complete, MORNING_EXPENSE_PRODUCTION_UPLOADS:'true'}).uploads, true);
  for (const patch of [{MORNING_EXPENSE_ENV:undefined}, {MORNING_EXPENSE_CLIENT_ID:shared.MORNING_CLIENT_ID},
    {MORNING_EXPENSE_CLIENT_SECRET:shared.MORNING_CLIENT_SECRET}, {MORNING_EXPENSE_CLIENT_SECRET:''},
    {MORNING_EXPENSE_PRODUCTION_USER_ID:''}, {MORNING_EXPENSE_PRODUCTION_USER_ID:profiles.map(row => row.id).join(',')},
    {MORNING_EXPENSE_PRODUCTION_WRITES:'false'}, {MORNING_EXPENSE_PRODUCTION_WRITES:undefined}, {MORNING_EXPENSE_P_SUPPLIERS:'[]'},
    {MORNING_EXPENSE_ENV:'sandbox'}]) {
    const closed = config({...complete, ...patch, MORNING_EXPENSE_PRODUCTION_UPLOADS:'true'});
    assert.equal(closed.productionWrites, false); assert.equal(closed.uploads, false);
  }
  assert.equal(config({...complete, MORNING_EXPENSE_PRODUCTION_WRITES:'false'}).productionUserId, profiles[0].id, 'kill switch preserves recovery identity');
});
