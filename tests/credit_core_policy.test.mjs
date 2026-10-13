import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from 'acorn';
import * as lib from '../netunim-kupa/bank-bridge/lib.mjs';
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
function bankSource() {
  const source = read('lib'),
    ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }),
    handoff = ast.body.find(
      (row) =>
        row.type === 'ExportNamedDeclaration' && row.source?.value === './credit-profile-model.mjs'
    );
  assert.ok(handoff);
  return source.slice(0, handoff.start);
}

test('all 73 Bank declarations and 30 Credit core declarations match the reviewed base', () => {
  assert.deepEqual(creditAdapterPolicyHashes([bankSource()]).policies, fixture.bankPolicies);
  assert.deepEqual(creditAdapterPolicyHashes(modules.map(read)).policies, fixture.creditPolicies);
});

test('historical Bank Bridge library retains exactly its 56 exports and canonical Credit identities', async () => {
  assert.deepEqual(Object.keys(lib).sort(), fixture.libExports);
  for (const module of modules) {
    const owner = await import('../netunim-kupa/bank-bridge/' + module + '.mjs');
    for (const name of Object.keys(owner))
      if (Object.hasOwn(lib, name)) assert.equal(lib[name], owner[name], name);
  }
  const ast = parse(read('lib'), { ecmaVersion: 'latest', sourceType: 'module' });
  const aliases = ast.body.filter(
    (row) =>
      row.type === 'ExportNamedDeclaration' &&
      modules.some((module) => row.source?.value === './' + module + '.mjs')
  );
  assert.equal(aliases.length, 4);
  assert.ok(
    aliases.every((row) => !row.declaration),
    'one canonical implementation per Credit function'
  );
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
      /status:\s*\['pending',\s*'completed'\]/,
      "status:['completed']",
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
