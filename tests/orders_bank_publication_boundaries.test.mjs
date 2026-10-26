import {archivePolicySource} from './bank_archive_reconciliation_policy_fixture.mjs';
import test from 'node:test';
import {assertFinanceRuntimeJoined} from './finance_runtime_ownership_fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from 'acorn';
import { analyze } from 'eslint-scope';
import {restoreOrdersBankPublication} from './orders_bank_publication_policy_fixture.mjs';
import {declaration,tokens} from './bank_policy_ast_fixture.mjs';
const read = (file) => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const folder = 'netunim-orders/site/assets/js/domains/finance/';
const fixture = JSON.parse(read('tests/fixtures/orders-bank-publication-policy.json'));
const clean = (key, value) =>
  ['start', 'end', 'raw', 'loc', 'range'].includes(key) ? undefined : value;
const ast = (value) => JSON.parse(JSON.stringify(value, clean));

test('provider/lease/publication workflow matches the immutable before-extraction algorithm across its actual owners', () => {
  assert.equal(fixture.baseline, '3d8b29d9fe5f6b2461308c3b6e8f656757927997');
  const controller = read(folder + 'controller.js'),
    restored = restoreOrdersBankPublication(controller);
  assert.deepEqual(
    ast(declaration(restored, 'refreshBank')),
    ast(declaration(fixture.refresh, 'refreshBank'))
  );
});

test('archive audit, feed, home failure, sequence and checks-preparation algorithms retain their before-extraction AST', () => {
  const model = read(folder + 'bank-snapshot-policy.js');
  for (const [name, expected] of Object.entries(fixture.helpers)) {
    let source = ['accountIdOf','completeTransactionCoverage','canonicalJson','sameInstant','sameNumber','assertBankArchiveCoverage'].includes(name)?archivePolicySource():model;
    if (name === 'observedChecksSequence')
      source = source
        .replace(/observedChecksSequence\(kupa,\s*bankEvents\)/, 'observedChecksSequence(kupa)')
        .replace(
          'normalizeSharedBankEvents(bankEvents)',
          'normalizeSharedBankEvents(checksSession.checksBankEvents)'
        );
    assert.deepEqual(ast(declaration(source, name)), ast(declaration(expected, name)), name);
  }
  const owner = read(folder + 'bank-snapshot-publication.js')
    .replaceAll('checks.hasLocalWork()', 'checksHaveLocalWork()')
    .replaceAll('checks.save(', 'saveSharedChecksToCloud(')
    .replaceAll('checks.refresh(', 'syncSharedChecksFromCloud(');
  assert.deepEqual(
    ast(declaration(owner, 'prepareBankSnapshot')),
    ast(declaration(fixture.prepare, 'prepareBankSnapshot'))
  );
});

test('preservation rejects changed reconciliation, backfill and atomic publication policy', () => {
  const controller = read(folder + 'controller.js'),
    owner = tokens(read(folder + 'bank-snapshot-publication.js')),
    model = tokens(read(folder + 'bank-snapshot-policy.js'));
  for (const [target, from, to] of [
    ['owner', 'if(readoutVerified)', 'if(true)'],
    ['model', 'historyDays>=365', 'historyDays>=30'],
    ['model', 'snapshotSeq=observedChecksSequence', 'snapshotSeq=0&&observedChecksSequence'],
  ]) {
    const original = target === 'owner' ? owner : model,
      changed = original.replace(from, to);
    assert.notEqual(changed, original, from);
    const restored = restoreOrdersBankPublication(controller, {
      owner: target === 'owner' ? changed : owner,
      model: target === 'model' ? changed : model,
    });
    assert.notDeepEqual(
      ast(declaration(restored, 'refreshBank')),
      ast(declaration(fixture.refresh, 'refreshBank')),
      from
    );
  }
});

test('the publication owner has five required ports, two commands, and no direct platform/provider access', () => {
  const source = read(folder + 'bank-snapshot-publication.js'),
    tree = parse(source, { ecmaVersion: 'latest', sourceType: 'module', ranges: true });
  assert.equal(
    declaration(source, 'createOrdersBankSnapshotPublication').params[0].properties.length,
    5
  );
  assert.deepEqual(
    tree.body.filter((n) => n.type === 'ImportDeclaration').map((n) => n.source.value),
    [
      '../../shared/runtime-task-owner.js',
      '../../shared/bank-balance-result.js',
      './document-publication.js',
    ]
  );
  for (const ref of analyze(tree, { ecmaVersion: 2022, sourceType: 'module' }).globalScope.through)
    assert.ok(
      ![
        'document',
        'navigator',
        'fetch',
        'localStorage',
        'globalThis',
        'setTimeout',
        'setInterval',
        'console',
        'process',
        'Blob',
        'URL',
      ].includes(ref.identifier.name)
    );
  assert.ok(Buffer.byteLength(source) < 16000);
  const controller = read(folder + 'controller.js');
  assert.equal(
    declaration(controller, 'createDomainsFinanceController').params[0].properties.length,
    18
  );
  for (const old of [
    'syncBankTransactionsSnapshot',
    'syncBankChequeImages',
    'prepareBankSnapshot',
    'publishDisplayArchive',
    'assertBankArchiveCoverage',
    'financeBankPayload',
  ])
    assert.ok(!controller.includes(old), old);
  assert.ok(controller.includes('bankRefresh.commands.refresh('));
  assert.ok(tokens(read(folder+'bank-refresh.js')).includes('publication.publish(candidate,'));
  const composition = read('netunim-orders/site/assets/js/composition/finance.js');
  assertFinanceRuntimeJoined(composition, 'bankSnapshots?.runtime');
});
