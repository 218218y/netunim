import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assertFinanceRuntimeJoined} from './finance_runtime_ownership_fixture.mjs';
const source = readFileSync(new URL('../netunim-orders/site/assets/js/composition/finance.js', import.meta.url), 'utf8');
test('every Finance owner is joined, and deleting membership or awaiting is detected', () => {
  for (const reference of ['archive?.runtime', 'controller?.runtime', 'connections?.runtime', 'bankConnections?.runtime', 'bankSnapshots?.runtime', 'archiveReconciliation?.runtime',
    'reports?.runtime', 'expenses?.runtime', 'importConnections.runtime', 'view.connectionRuntime']) {
    assertFinanceRuntimeJoined(source, reference);
    assert.throws(() => assertFinanceRuntimeJoined(source.replace(reference, 'null'), reference), undefined, reference);
  }
  assert.throws(() => assertFinanceRuntimeJoined(source.replace('await Promise.all(ownedRuntimes()', 'void Promise.all(ownedRuntimes()'), 'archive?.runtime'));
  assert.throws(() => assertFinanceRuntimeJoined(source.replace('presentation?.runtimes || []', '[]'), 'expenses?.runtime'));
});
