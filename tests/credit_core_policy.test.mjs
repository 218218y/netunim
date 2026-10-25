import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { creditAdapterPolicyHashes } from './credit_adapter_policy_fixture.mjs';
import {restoreCreditPendingStatus,restoreCreditProfileAuthority} from './credit_account_authority_fixture.mjs';
import {restoreCreditCooldown} from './credit_cooldown_policy_fixture.mjs';
import {typedFinancialPolicies} from './typed_financial_policy_fixture.mjs';
const read = (name) =>
  fs.readFileSync(new URL('../netunim-kupa/bank-bridge/' + name + '.mjs', import.meta.url), 'utf8');
const modules = [
  'credit-core-values',
  'credit-profile-model',
  'credit-transaction-model',
  'credit-failure-policy',
];
const fixture = JSON.parse(
  fs.readFileSync(new URL('./fixtures/credit-core-policy.json', import.meta.url), 'utf8')
);
test('all 34 Credit core declarations match the reviewed contract', () => {
  assert.deepEqual(creditAdapterPolicyHashes(modules.map(name=>restoreCreditCooldown(restoreCreditProfileAuthority(restoreCreditPendingStatus(read(name).replaceAll('\r\n','\n')))))).policies, typedFinancialPolicies(fixture.creditPolicies,'creditPolicies'));
});

test('policy fixture detects changed charge signs, login identity, transaction status and cooldown', () => {
  for (const [module, before, after, name] of [
    [
      'credit-core-values',
      /amount\s*===\s*0\s*\?\s*0\s*:\s*-amount/,
      'amount===0?0:amount',
      'creditDebitAmount',
    ],
    [
      'credit-profile-model',
      /provider\s*===\s*'visaCal'\s*\|\|\s*provider\s*===\s*'max'/,
      "provider==='visaCal'",
      'creditProfilesShareLoginIdentity',
    ],
    [
      'credit-transaction-model',
      'assertCreditTransactionEvidence(tx)',
      "assertCreditTransactionEvidence({...tx,status:'completed'})",
      'normalizeCreditScrapeTransaction',
    ],
    [
      'credit-failure-policy',
      /CREDIT_AUTOMATION_BLOCK_COOLDOWN_MS\s*=\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/,
      'CREDIT_AUTOMATION_BLOCK_COOLDOWN_MS=0',
      'CREDIT_AUTOMATION_BLOCK_COOLDOWN_MS',
    ],
  ]) {
    const original = read(module),
      changed = original.replace(before, after);
    assert.notEqual(changed, original, module);
    const sources = modules.map((name) => (name === module ? changed : read(name)));
    assert.notEqual(
      creditAdapterPolicyHashes(sources).policies[name],
      creditAdapterPolicyHashes(modules.map(read)).policies[name],
      name
    );
  }
});
