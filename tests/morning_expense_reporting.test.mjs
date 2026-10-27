import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createExpenseReporting} from '../netunim-orders/site/assets/js/domains/finance/morning-expense-reporting.js';

const owner = 'aaaaaaaa-aaaa-4aaa-aaaa-000000000001';
const memory = () => {const values = new Map(); let writes = 0; return {getItem:key => values.get(key), setItem:(key,value) => {writes++; values.set(key,value);}, writes:() => writes};};

test('the reporting owner restores a sticky period and only manual choices replace it', () => {
  const storage = memory(); let today = '2026-10-27';
  const create = () => createExpenseReporting({storage:() => storage, todayISO:() => today});
  let reporting = create(); assert.ok(reporting.restore(owner, 'production'));
  assert.deepEqual(reporting.fields(today), {reportingPeriod:'2026-09', reportingDate:'2026-10-01'});
  assert.equal(storage.writes(), 1);
  today = '2026-11-01'; reporting = create(); assert.ok(reporting.restore(owner, 'production'));
  assert.equal(storage.writes(), 1, 'restoring an existing preference must not rewrite it');
  assert.equal(reporting.fields(today).reportingPeriod, '2026-09');
  assert.equal(reporting.choose('2026-11', '2026-10-20').reportingDate, '2026-11-01');
  assert.equal(reporting.choose('2026-09', '2026-10-20').reportingDate, '2026-10-01');
  today = '2028-03-01'; reporting = create(); reporting.restore(owner, 'production');
  assert.equal(reporting.fields(today).reportingPeriod, '2026-09');
  assert.deepEqual(reporting.choices().years, [2028,2026]);
  assert.equal(reporting.yearKey('2028'), '2028-03');
  reporting.reset(); assert.throws(() => reporting.choose('2028-01', today), /scope/);
  assert.equal(reporting.fields(today).reportingPeriod, '2028-03');
});

test('reporting state separates account/environment scopes and handles unavailable storage', () => {
  const storage = memory(), todayISO = () => '2026-10-27';
  const reporting = createExpenseReporting({storage:() => storage, todayISO});
  reporting.restore(owner, 'production'); reporting.choose('2026-07', '2026-08-15');
  reporting.restore(owner, 'sandbox'); assert.equal(reporting.fields('2026-08-15').reportingPeriod, '2026-09');
  reporting.restore(owner, 'production'); assert.equal(reporting.fields('2026-08-15').reportingPeriod, '2026-07');
  const blocked = createExpenseReporting({storage:() => {throw Error('storage unavailable');}, todayISO});
  assert.equal(blocked.restore(owner, 'production'), false);
  assert.equal(blocked.choose('2026-07', '2026-08-15').saved, false);
  assert.equal(blocked.fields('2026-08-15').reportingPeriod, '2026-07');
  assert.throws(() => blocked.choose('2026-11', '2026-08-15'));
  assert.equal(blocked.fields('2026-08-15').reportingPeriod, '2026-07');
});
