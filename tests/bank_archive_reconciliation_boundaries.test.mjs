import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from 'acorn';
import { analyze } from 'eslint-scope';
import { declaration, tokens } from './bank_policy_ast_fixture.mjs';
import {
  archivePolicySource,
  archiveCoreSource,
  coreSequence,
  restoreKupaReconciliation,
  expandOrdersReconciliation,
} from './bank_archive_reconciliation_policy_fixture.mjs';
const read = (file) => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const clean = (key, value) =>
  ['start', 'end', 'raw', 'loc', 'range'].includes(key) ? undefined : value;
const ast = (value) => JSON.parse(JSON.stringify(value, clean));
const fixture = JSON.parse(read('tests/fixtures/bank-archive-reconciliation-policy.json'));
const kp = 'netunim-kupa/site/assets/js/domains/bank/',
  op = 'netunim-orders/site/assets/js/domains/finance/';

test('six canonical Orders archive algorithms are exactly the existing Kupa algorithms', () => {
  assert.equal(fixture.baseline, 'c4442d28e4f989a2a10e0dea5895e8234fb9c262');
  for (const [name, original] of Object.entries(fixture.helpers))
    assert.deepEqual(
      ast(declaration(archivePolicySource(), name)),
      ast(declaration(original, name)),
      name
    );
});
test('both actual archive consumers preserve their complete provider/publication workflows', () => {
  assert.deepEqual(
    ast(declaration(restoreKupaReconciliation(read(kp + 'controller.js')), 'refreshBankBalance')),
    ast(declaration(fixture.kupaRefresh, 'refreshBankBalance'))
  );
  // Compare the unchanged archive policy; actual publication tests separately
  // require explicit observations and prove zero writes on missing evidence.
  const restored = expandOrdersReconciliation(read(op + 'bank-snapshot-publication.js'))
    .replace('readBankSnapshotResult(result)', 'readBankBalanceResult(result)')
    .replace('source.fetchedAt', 'source.fetchedAt||new Date().toISOString()');
  assert.deepEqual(
    ast(declaration(restored, 'publish').body.body.filter((n) => n.type !== 'EmptyStatement')),
    ast(
      declaration(fixture.ordersPublish, 'publish').body.body.filter(
        (n) => n.type !== 'EmptyStatement'
      )
    )
  );
});
test('actual shared-core mutations cannot change reconciliation, read horizon, home isolation or audit thresholds unnoticed', () => {
  const shared = tokens(archiveCoreSource()),
    controller = read(kp + 'controller.js');
  for (const [from, to] of [
    ["'business',", "'home',"],
    ['days:370', 'days:30'],
    ['historyDays>=365', 'historyDays>=30'],
    ['home&&homeAccount', 'home'],
  ]) {
    const changed = shared.replace(from, to);
    assert.notEqual(changed, shared);
    assert.notDeepEqual(
      ast(declaration(restoreKupaReconciliation(controller, changed), 'refreshBankBalance')),
      ast(declaration(fixture.kupaRefresh, 'refreshBankBalance')),
      from
    );
  }
  assert.ok(coreSequence().includes('verifyBankArchiveCoverage('));
});
test('the shared cloud archive owner has four required ports and no provider, UI, timer or document writer authority', () => {
  const source = archiveCoreSource(),
    tree = parse(source, { ecmaVersion: 'latest', sourceType: 'module', ranges: true });
  assert.equal(
    declaration(source, 'createBankArchiveReconciliation').params[0].properties.length,
    4
  );
  assert.deepEqual(
    tree.body.filter((n) => n.type === 'ImportDeclaration').map((n) => n.source.value),
    ['./runtime-task-owner.js', './bank-archive-policy.js']
  );
  for (const ref of analyze(tree, { ecmaVersion: 2022, sourceType: 'module' }).globalScope.through)
    assert.ok(
      ![
        'window',
        'document',
        'navigator',
        'fetch',
        'globalThis',
        'localStorage',
        'setTimeout',
        'setInterval',
        'console',
        'process',
        'Blob',
        'URL',
      ].includes(ref.identifier.name)
    );
  assert.ok(Buffer.byteLength(source) < 14000);
  for (const site of ['kupa', 'orders'])
    for (const module of ['bank-archive-policy', 'bank-archive-reconciliation'])
      assert.equal(
        read(`netunim-${site}/site/assets/js/shared/${module}.js`).replaceAll('\r\n', '\n'),
        read(`shared/${module}.js`).replaceAll('\r\n', '\n')
      );
});
test('compositions join separate archive owners and keep intentional application-specific writers and Morning adapters', () => {
  for (const site of ['kupa', 'orders']) {
    const composition = read(
      `netunim-${site}/site/assets/js/composition/${site === 'kupa' ? 'bank' : 'finance'}.js`
    );
    for (const method of ['dispose', 'drain', 'isPending'])
      assert.ok(
        composition.includes(
          `archiveReconciliation${site === 'orders' ? '?' : ''}.runtime.${method}()`
        )
      );
    assert.ok(composition.includes('archive:{read:archive.queries.readSnapshot}'));
  }
  const controller = read(kp + 'controller.js');
  assert.equal(
    declaration(controller, 'createDomainsBankController').params[0].properties.length,
    13
  );
  for (const retired of [
    'syncBankTransactionsSnapshot',
    'syncBankChequeImages',
    'assertBankArchiveCoverage',
    'canonicalJson',
  ])
    assert.ok(!controller.includes(retired));
  const snapshot = read(kp + 'snapshot-commands.js');
  assert.ok(snapshot.includes('publishLocal'));
  assert.ok(snapshot.includes('publication.bank(nextBank)'));
  const transport = read('netunim-orders/site/assets/js/cloud/transport.js');
  assert.ok(transport.includes('readBankMorningDocumentLinks'));
  assert.ok(transport.includes('documentLinks:links.get(Number(x.id))||[]'));
});
