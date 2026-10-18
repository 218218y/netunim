import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { creditAdapterPolicyHashes } from './credit_adapter_policy_fixture.mjs';
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
const retired = ['normalizeAccountNumber', 'selectBalanceAccount', 'isHapoalimChequeTransaction'];
test('all 72 active Bank declarations match their reviewed policy digests', () => {
  const expected = { ...fixture.bankPolicies };
  for (const name of retired) {
    assert.ok(Object.hasOwn(expected, name));
    delete expected[name];
  }
  assert.equal(Object.keys(expected).length, 72);
  assert.deepEqual(creditAdapterPolicyHashes(modules.map(read)).policies, expected);
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
    assert.notEqual(actual[name], fixture.bankPolicies[name], name);
  }
});
