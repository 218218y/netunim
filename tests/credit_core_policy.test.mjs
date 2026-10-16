import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { creditAdapterPolicyHashes } from './credit_adapter_policy_fixture.mjs';
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
test('all 30 Credit core declarations match the reviewed base', () => {
  assert.deepEqual(creditAdapterPolicyHashes(modules.map(read)).policies, fixture.creditPolicies);
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
      /tx\?\.status\s*!==\s*'pending'/,
      "tx?.status==='pending'",
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
      fixture.creditPolicies[name],
      name
    );
  }
});
