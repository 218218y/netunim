import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'acorn';
import { analyze } from 'eslint-scope';
import { declaration, tokens } from './bank_policy_ast_fixture.mjs';
import {
  restoreKupaBankRefresh,
  restoreKupaBankFeedPolicy
} from './kupa_bank_refresh_policy_fixture.mjs';
const read = name =>
  readFileSync(
    new URL(
      '../netunim-kupa/site/assets/js/domains/bank/' + name + '.js',
      import.meta.url
    ),
    'utf8'
  );
const baseline = JSON.parse(
  readFileSync(
    new URL('./fixtures/kupa-bank-refresh-policy.json', import.meta.url),
    'utf8'
  )
);
const clean = (key, value) =>
  ['start', 'end', 'raw', 'loc', 'range'].includes(key) ? undefined : value;
const ast = (source, name) =>
  JSON.parse(JSON.stringify(declaration(source, name), clean));
test('Kupa Bank full refresh, candidate, feeds, backfill, cloud/local publication and UI preserve the immutable main policy', () => {
  assert.equal(baseline.baseline, 'cc6a33d65c11454f12a6d4e0dcfde74e7b371b3b');
  for (const [name, original] of Object.entries(baseline.functions)) {
    const restored =
      name === 'feedFromSnapshot'
        ? restoreKupaBankFeedPolicy()
        : restoreKupaBankRefresh(read('controller'));
    assert.deepEqual(ast(restored, name), ast(original, name), name);
  }
});
test('Kupa Bank characterization rejects changed request scope, backfill, home retention, watermark and cleanup', () => {
  for (const [file, from, to] of [
    [
      'refresh',
      '{interactive,historyDays}',
      '{interactive:false,historyDays:365}'
    ],
    [
      'refresh',
      'historyDays=cloudArchive&&!auto&&!archiveReady?365:30',
      'historyDays=365'
    ],
    ['refresh', 'await leaseSession?.close()', 'leaseSession?.close()'],
    ['snapshot-policy', 'homeFailure?(previousBank.homeFeed??null):null', 'null'],
    ['snapshot-policy', 'source.observedSequence()', '0']
  ]) {
    const source = tokens(read(file)),
      changed = source.replace(from, to);
    assert.notEqual(changed, source, from);
    const restored = restoreKupaBankRefresh(read('controller'), {
      [file === 'refresh' ? 'owner' : 'model']: changed
    });
    assert.notDeepEqual(
      ast(restored, 'refreshBankBalance'),
      ast(baseline.functions.refreshBankBalance, 'refreshBankBalance'),
      from
    );
  }
});
test('Kupa Bank operation and pure candidate policy have seven and three APIs without ambient I/O', () => {
  for (const [file, factory, count] of [
    ['refresh', 'createKupaBankRefresh', 7],
    ['snapshot-policy', 'createKupaBankSnapshotPolicy', 3]
  ]) {
    const source = read(file),
      tree = parse(source, {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ranges: true
      });
    assert.equal(
      declaration(source, factory).params[0].properties.length,
      count
    );
    for (const ref of analyze(tree, { ecmaVersion: 2022, sourceType: 'module' })
      .globalScope.through)
      assert.ok(
        ![
          'window',
          'document',
          'navigator',
          'localStorage',
          'fetch',
          'console',
          'globalThis',
          'setTimeout',
          'setInterval',
          'process'
        ].includes(ref.identifier.name),
        ref.identifier.name
      );
  }
  const source = read('controller'),
    fn = declaration(source, 'refreshBankBalance'),
    body = source.slice(fn.start, fn.end);
  for (const retired of [
    'leaseSession',
    'syncLeases',
    'archiveReconciliation',
    'prepareBankSnapshot',
    'fetchBalance',
    'readFinance',
    'readBankBalanceResult',
    'snapshotSeq'
  ])
    assert.ok(!body.includes(retired), retired);
  assert.equal(
    declaration(source, 'createDomainsBankController').params[0].properties
      .length,
    13
  );
});
