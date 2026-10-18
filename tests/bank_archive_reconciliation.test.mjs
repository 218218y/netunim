import test from 'node:test';
import assert from 'node:assert/strict';
import { createBankArchiveReconciliation } from '../shared/bank-archive-reconciliation.js';
import { verifyBankArchiveCoverage } from '../shared/bank-archive-policy.js';
import { readBankBalanceResult } from '../shared/bank-balance-result.js';
const stamp = '2026-10-14T10:00:00Z',
  source = {
    mergeKey: 'tx',
    date: stamp,
    processedDate: stamp,
    amount: 12,
    currency: 'ILS',
    description: 'payment',
    status: 'completed',
    cheque: false,
  };
function fixture({ hold } = {}) {
  let current = true;
  const gate = Promise.withResolvers(),
    entered = Promise.withResolvers(),
    events = [];
  const guard = () => {
    if (!current)
      throw Object.assign(Error('authority changed'), { code: 'FINANCE_OPERATION_SCOPE_CHANGED' });
  };
  const phase = async (name, value) => {
    events.push(name);
    if (name === hold) {
      entered.resolve();
      await gate.promise;
    }
    return value;
  };
  const rows = [
      {
        ...source,
        id: 'tx',
        archiveId: 1,
        documentLinks: [{ documentId: 'morning-one', documentNumber: '51' }],
        handledAt: stamp,
      },
    ],
    homeRows = [];
  const coverage = { complete: true, from: '2025-10-14', to: '2026-10-14', days: 365 };
  const decoded = readBankBalanceResult({
    fetchedAt: stamp,
    accounts: {
      business: {
        balance: 500,
        accountId: 'B',
        transactions: [source],
        transactionCoverage: coverage,
      },
      home: { balance: 70, accountId: 'H', transactions: [], transactionCoverage: coverage },
    },
  });
  const request = {
    business: decoded.business,
    home: decoded.home,
    fetchedAt: stamp,
    historyDays: 365,
    lease: { leaseName: 'bank', leaseToken: 'L', fenceEpoch: 1, assertCurrent: guard },
  };
  const ports = {
    transactions: {
      reconcile: async (_key, role, _rows, options) => {
        options.lease.assertCurrent();
        return phase(role, {
          sourcePayload: role === 'business' ? [source] : [],
          result: { total_count: role === 'business' ? 1 : 0 },
        });
      },
    },
    images: { sync: () => phase('images', { warnings: [] }) },
    archive: {
      read: () =>
        phase('archive', [
          {
            role: 'business',
            accountKey: 'B',
            rows,
            directSnapshot: { coverageFrom: coverage.from },
          },
          { role: 'home', accountKey: 'H', rows: homeRows, directSnapshot: null },
        ]),
    },
    authority: { captureRead: () => guard },
  };
  return {
    ports,
    request,
    events,
    rows,
    homeRows,
    gate,
    entered,
    change: () => {
      current = false;
    },
    create: () => createBankArchiveReconciliation(ports),
  };
}
test('one canonical sequence preserves identities, exact audits and Morning enrichment without modifying inputs', async () => {
  const f = fixture(),
    before = structuredClone(f.rows),
    api = f.create(),
    result = await api.commands.sync(f.request);
  assert.deepEqual(f.events, ['business', 'home', 'images', 'archive']);
  assert.equal(result.archiveAudit.version, 3);
  assert.equal(result.archiveAudit.business.exactCount, true);
  assert.equal(result.archiveAudit.business.sourceCount, 1);
  assert.equal(result.archiveAudit.home.sourceCount, 0);
  assert.equal(result.businessArchive, f.rows);
  assert.equal(result.homeArchive, f.homeRows);
  assert.deepEqual(f.rows, before);
  assert.equal(result.businessArchive[0].documentLinks[0].documentId, 'morning-one');
  assert.equal(result.archiveCandidate.business.accountKey, 'B');
  assert.equal(result.archiveCandidate.home.accountKey, 'H');
  assert.equal(result.imageSyncWarning, '');
  assert.equal(api.runtime.isPending(), false);
});
for (const phase of ['business', 'home', 'images', 'archive'])
  for (const action of ['scope', 'dispose'])
    test(`${action} during ${phase} joins accepted work and fences the next stage`, async () => {
      const f = fixture({ hold: phase }),
        api = f.create();
      let drained = false,
        settled = false;
      const pending = api.commands.sync(f.request);
      void pending
        .catch(() => {})
        .finally(() => {
          settled = true;
        });
      await f.entered.promise;
      if (action === 'scope') f.change();
      else {
        assert.equal(api.runtime.dispose(), true);
        assert.equal(api.runtime.dispose(), false);
        assert.throws(() => api.commands.sync(f.request), /closed/);
      }
      const draining = api.runtime.drain().then(() => {
        drained = true;
      });
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(api.runtime.isPending(), true);
      assert.equal(drained, false);
      assert.equal(settled, false);
      const before = [...f.events];
      f.gate.resolve();
      await assert.rejects(pending, { code: 'FINANCE_OPERATION_SCOPE_CHANGED' });
      await draining;
      assert.deepEqual(f.events, before);
      assert.equal(api.runtime.isPending(), false);
    });
test('a failure still fences former authority and cannot expose a former operation error', async () => {
  const f = fixture({ hold: 'business' }),
    api = f.create(),
    pending = api.commands.sync(f.request);
  await f.entered.promise;
  f.change();
  f.gate.reject(Error('private former operation'));
  await assert.rejects(pending, { code: 'FINANCE_OPERATION_SCOPE_CHANGED' });
  await api.runtime.drain();
  assert.deepEqual(f.events, ['business']);
});
test('image errors remain warnings while authority errors stop reconciliation', async () => {
  const f = fixture();
  f.ports.images.sync = async () => {
    throw Error('image unavailable');
  };
  const result = await f.create().commands.sync(f.request);
  assert.match(result.imageSyncWarning, /image unavailable/);
  const other = fixture();
  other.ports.images.sync = async () => {
    throw Object.assign(Error('pairing changed'), { code: 'BRIDGE_PAIRING_SCOPE_CHANGED' });
  };
  await assert.rejects(other.create().commands.sync(other.request), {
    code: 'BRIDGE_PAIRING_SCOPE_CHANGED',
  });
  assert.ok(!other.events.includes('archive'));
});
test('a missing home account key does not issue a home write or archive read target', async () => {
  const f = fixture();
  const decoded = readBankBalanceResult({
    fetchedAt: stamp, balance: 500, accountId: 'B', transactions: [source] });
  f.request.business = decoded.business;
  f.request.home = null;
  f.ports.archive.read = async (targets) => {
    assert.equal(targets.length, 1);
    return [{ role: 'business', accountKey: 'B', rows: f.rows, directSnapshot: null }];
  };
  const result = await f.create().commands.sync(f.request);
  assert.equal(result.homeAccount, '');
  assert.equal(result.archiveAudit.home, null);
  assert.ok(!f.events.includes('home'));
});
test('separate compositions cannot dispose each other or share accepted work', async () => {
  const a = fixture({ hold: 'business' }),
    b = fixture(),
    ownerA = a.create(),
    ownerB = b.create(),
    pending = ownerA.commands.sync(a.request);
  await a.entered.promise;
  ownerA.runtime.dispose();
  assert.equal((await ownerB.commands.sync(b.request)).businessAccount, 'B');
  assert.equal(ownerB.runtime.isPending(), false);
  assert.equal(ownerA.runtime.isPending(), true);
  a.gate.resolve();
  await assert.rejects(pending, { code: 'FINANCE_OPERATION_SCOPE_CHANGED' });
});
test('all four ports are required and construction allocates no work', () => {
  const f = fixture();
  for (const [name, port] of Object.entries(f.ports))
    for (const method of Object.keys(port))
      assert.throws(
        () => createBankArchiveReconciliation({ ...f.ports, [name]: { ...port, [method]: null } }),
        /required/
      );
  assert.deepEqual(f.events, []);
});
test('typed archive input refuses former synthetic no-op results and malformed rows', () => {
  for (const merge of [null, {}, true, { sourcePayload: [null] }, { sourcePayload: [[]] }])
    assert.throws(() => verifyBankArchiveCoverage(merge, []), /source_payload_required/);
  for (const rows of [null, 200, [null], [[]]])
    assert.throws(() => verifyBankArchiveCoverage({ sourcePayload: [] }, rows), /rows_required/);
});
test('readback policy rejects missing/duplicate identities, changed financial content and wrong exact backfill count', () => {
  const valid = { ...source, id: 'tx' },
    merge = { sourcePayload: [source], result: { total_count: 1 } };
  for (const rows of [
    [],
    [{ ...valid, id: '' }],
    [valid, valid],
    [{ ...valid, amount: 13 }],
    [{ ...valid, checkDetails: { checkNumbers: ['other'] } }],
  ])
    assert.throws(
      () => verifyBankArchiveCoverage(merge, rows, { requireExactCount: true }),
      /ארכיון|בשלמותה/
    );
  for (const total_count of [null, 0, 2, 1.5, 'not-a-count'])
    assert.throws(
      () =>
        verifyBankArchiveCoverage({ ...merge, result: { total_count } }, [valid], {
          requireExactCount: true,
        }),
      /backfill/
    );
  assert.equal(
    verifyBankArchiveCoverage(merge, [valid], { requireExactCount: true }).exactCount,
    true
  );
  assert.equal(
    verifyBankArchiveCoverage({ ...merge, result: null }, [valid]).archiveCount,
    1,
    'incremental readback retains advisory metadata policy'
  );
});
