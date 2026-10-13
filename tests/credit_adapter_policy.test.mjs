import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as facade from '../netunim-kupa/bank-bridge/credit-adapters.mjs';
import { creditAdapterPolicyHashes } from './credit_adapter_policy_fixture.mjs';
const read = (name) =>
  fs.readFileSync(new URL('../netunim-kupa/bank-bridge/' + name + '.mjs', import.meta.url), 'utf8');
const modules = [
  'credit-value-codec',
  'credit-month-plan',
  'credit-sync-scope',
  'credit-http-policy',
  'credit-http',
  'credit-scheduler',
  'visa-cal-model',
  'credit-coverage',
  'visa-cal-session',
  'credit-adapter-base',
  'visa-cal-adapter',
  'max-model',
  'credit-monthly-projection',
  'max-adapter',
  'credit-generic-adapter',
  'isracard-group-adapter',
  'credit-adapter-factory',
  'credit-adapter-wire',
];
const sources = () => modules.map(read);
const fixture = JSON.parse(
  fs.readFileSync(new URL('./fixtures/credit-adapter-policy.json', import.meta.url), 'utf8')
);

test('credit provider methods, normalization, wire constants and fallback policy match the reviewed baseline', () => {
  assert.deepEqual(creditAdapterPolicyHashes(sources()).policies, fixture.policies);
  assert.equal(Object.keys(fixture.policies).length, 118);
});

test('the historical credit facade keeps exactly its former exports and canonical identities', async () => {
  assert.deepEqual(Object.keys(facade).sort(), fixture.exports);
  for (const name of modules) {
    const owner = await import('../netunim-kupa/bank-bridge/' + name + '.mjs');
    for (const key of Object.keys(owner))
      if (Object.hasOwn(facade, key)) assert.equal(facade[key], owner[key], key);
  }
});

test('policy fixtures detect changed terminal cleanup, fallback, month horizon and account exclusion', () => {
  for (const [module, before, after, name] of [
    [
      'visa-cal-adapter',
      /scraper\.terminate\(success\)/,
      'scraper.terminate(false)',
      'VisaCalAdapter',
    ],
    [
      'isracard-group-adapter',
      /!this\.allowCamoufoxFallback/,
      'false',
      'IsracardGroupDigitalV3Adapter',
    ],
    [
      'credit-sync-scope',
      /futureMonths:\s*CREDIT_CORE_FUTURE_MONTHS/,
      'futureMonths:12',
      'creditSyncScope',
    ],
    [
      'credit-adapter-base',
      /this\.excludedAccountNumbers\s*=\s*excludedAccountSet\(excludedAccountNumbers\)/,
      'this.excludedAccountNumbers=new Set()',
      'CreditProviderAdapter',
    ],
    ['credit-http', /if\s*\(!inPageError\)/, 'if(false)', 'postVisaCalJson'],
  ]) {
    const all = sources(),
      original = read(module),
      changed = original.replace(before, after);
    assert.notEqual(changed, original, module);
    all[all.indexOf(original)] = changed;
    assert.notEqual(creditAdapterPolicyHashes(all).policies[name], fixture.policies[name], name);
  }
});
