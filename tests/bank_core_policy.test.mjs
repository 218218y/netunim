import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { creditAdapterPolicyHashes } from './credit_adapter_policy_fixture.mjs';
import {typedFinancialPolicies} from './typed_financial_policy_fixture.mjs';
import { retryTransientNavigation } from '../netunim-kupa/bank-bridge/hapoalim-navigation-policy.mjs';
const modules = [
  'hapoalim-policy',
  'hapoalim-navigation-policy',
  'hapoalim-login-runtime',
  'hapoalim-account-selector',
  'hapoalim-account-model',
  'hapoalim-detail-values',
  'hapoalim-detail-keys',
  'hapoalim-cheque-model',
  'hapoalim-credit-settlement-model',
  'hapoalim-additional-details-model',
  'hapoalim-date-codec',
  'hapoalim-transaction-model',
  'hapoalim-failure-policy',
];
const read = (name) =>
  fs.readFileSync(new URL('../netunim-kupa/bank-bridge/' + name + '.mjs', import.meta.url), 'utf8');
const fixture = JSON.parse(
  fs.readFileSync(new URL('./fixtures/credit-core-policy.json', import.meta.url), 'utf8')
);
const reviewedBoundaries=JSON.parse(fs.readFileSync(new URL('./fixtures/bank-bridge-checked-boundary-policies.json',import.meta.url),'utf8')).bank;
const retired = ['normalizeAccountNumber', 'selectBalanceAccount', 'isHapoalimChequeTransaction'];

test('a non-finite navigation retry budget cannot keep a bank refresh alive indefinitely', async () => {
  const navigationError = new Error('Execution context was destroyed');
  let calls = 0;
  await assert.rejects(retryTransientNavigation(() => {
    calls++;
    if (calls > 3) throw new Error('retry budget was not enforced');
    throw navigationError;
  }, { attempts: Infinity }), error => error === navigationError);
  assert.equal(calls, 3);
});
test('all 73 active Bank declarations match their reviewed policy digests', () => {
  const expected = { ...fixture.bankPolicies };
  // Reviewed audit change: unknown server capacity cannot prove completeness.
  // Keep the historical fixture intact and authorize only this declaration.
  assert.equal(expected.hapoalimTransactionPageState,'660bee221042dd50d5ac7052929e635910f24817954d0c83001f26bbc7feb294');
  expected.hapoalimTransactionPageState='1b6956762b3fefae99869dc115474f67140ebc5da818cc5cadc4485f6771c087';
  for (const name of retired) {
    assert.ok(Object.hasOwn(expected, name));
    delete expected[name];
  }
  assert.equal(Object.keys(expected).length, 72);
  const reviewed = typedFinancialPolicies(expected,'bankPolicies');
  for (const [name, {before, after}] of Object.entries(reviewedBoundaries)) {
    assert.equal(reviewed[name], before, name);
    reviewed[name] = after;
  }
  assert.deepEqual(creditAdapterPolicyHashes(modules.map(read)).policies, reviewed);
});
test('Bank policy digests detect altered cheque identity, pending status, account selection and login bounds', () => {
  for (const [module, before, after, name] of [
    [
      'hapoalim-account-model',
      /matches\.length\s*===\s*1/,
      'matches.length>=1',
      'selectAccountDescriptor',
    ],
    [
      'hapoalim-transaction-model',
      /serial\s*===\s*0/,
      'serial!==0',
      'normalizeHapoalimTransaction',
    ],
    [
      'hapoalim-cheque-model',
      /const required\s*=\s*\['bank',\s*'branch',\s*'account',\s*'number',\s*'amount'\]/,
      "const required=['bank','branch','account','amount']",
      'normalizeHapoalimChequeListItem',
    ],
    [
      'hapoalim-policy',
      /HAPOALIM_DATA_RETRY_LIMIT\s*=\s*3/,
      'HAPOALIM_DATA_RETRY_LIMIT=4',
      'HAPOALIM_DATA_RETRY_LIMIT',
    ],
    [
      'hapoalim-login-runtime',
      /if\s*\(page\?\.isClosed\?\.\(\)\)/,
      'if(false)',
      'waitForTerminalLoginResult',
    ],
  ]) {
    const original = read(module),
      changed = original.replace(before, after);
    assert.notEqual(changed, original, module);
    const actual = creditAdapterPolicyHashes(
      modules.map((row) => (row === module ? changed : read(row)))
    ).policies;
    assert.notEqual(actual[name], creditAdapterPolicyHashes(modules.map(read)).policies[name], name);
  }
});
