import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { creditAdapterPolicyHashes } from './credit_adapter_policy_fixture.mjs';
import {restoreRetryAfterRangeGuard} from './credit_cooldown_policy_fixture.mjs';
import {typedFinancialPolicies} from './typed_financial_policy_fixture.mjs';
const read = (name) =>
  fs.readFileSync(new URL('../netunim-kupa/bank-bridge/' + name + '.mjs', import.meta.url), 'utf8').replaceAll('\r\n','\n');
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
  'isracard-group-adapter',
  'credit-adapter-factory',
  'credit-adapter-wire',
];
// Only the plan's retired alias is mapped to its former name. The call stays in
// the same default initializer; all branches, arguments and returned data remain
// covered by the immutable pre-refactor digests and behavior tests.
const sources = () =>
  modules.map((name) => {
    const source = restoreRetryAfterRangeGuard(read(name));
    return name === 'credit-month-plan'
      ? source.replace('startDate = creditRecoveryStartDate(),', 'startDate = creditStartDate(),')
      : source;
  });
const fixture = JSON.parse(
  fs.readFileSync(new URL('./fixtures/credit-adapter-policy.json', import.meta.url), 'utf8')
);
const httpReceiptPolicies=JSON.parse(fs.readFileSync(new URL('./fixtures/credit-http-receipt-policies.json',import.meta.url),'utf8'));

test('credit provider methods, normalization, wire constants and fallback policy match the reviewed baseline', () => {
  const active = { ...fixture.policies };
  for (const name of ['creditStartDate', 'GenericScraperAdapter', 'maxRawDiagnosticSamples'])
    delete active[name];
  const reviewed=typedFinancialPolicies(active,'coveragePolicies');
  // These individually reviewed changes validate unknown page receipts and
  // retain bounded typed error metadata. The historical baseline stays intact.
  for(const [name,{before,after}] of Object.entries(httpReceiptPolicies)){
    assert.equal(reviewed[name]??null,before,name);
    reviewed[name]=after;
  }
  assert.deepEqual(creditAdapterPolicyHashes(sources()).policies,reviewed);
  assert.equal(Object.keys(fixture.policies).length, 118);
});

test('retired Credit facades and uninstantiated generic scraper have no current files or exports', async () => {
  for (const name of ['credit-adapters', 'credit-diagnostics', 'credit-generic-adapter'])
    assert.equal(
      fs.existsSync(new URL('../netunim-kupa/bank-bridge/' + name + '.mjs', import.meta.url)),
      false,
      name
    );
  const plan = await import('../netunim-kupa/bank-bridge/credit-month-plan.mjs');
  assert.equal(Object.hasOwn(plan, 'creditStartDate'), false);
  assert.ok(read('credit-month-plan').includes('startDate = creditRecoveryStartDate(),'));
  const max = await import('../netunim-kupa/bank-bridge/max-model.mjs');
  assert.equal(Object.hasOwn(max, 'maxRawDiagnosticSamples'), false);
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
