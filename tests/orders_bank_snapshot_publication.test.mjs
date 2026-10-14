import test from 'node:test';
import assert from 'node:assert/strict';
import { createOrdersBankSnapshotPublication } from '../netunim-orders/site/assets/js/domains/finance/bank-snapshot-publication.js';
import { createOrdersBankSnapshotPolicy } from '../netunim-orders/site/assets/js/domains/finance/bank-snapshot-policy.js';
import {createBankArchiveReconciliation} from '../netunim-orders/site/assets/js/shared/bank-archive-reconciliation.js';

const stamp = '2026-10-14T10:00:00.000Z';
function publicationPorts(ports){return {
  checks:ports.checks,publication:ports.publication,policy:ports.policy,
  archive:{publish:ports.archive.publish},
  reconciliation:createBankArchiveReconciliation({transactions:ports.transactions,images:ports.images,archive:{read:ports.archive.read},authority:ports.authority}),
}}
function fixture({ hold, confirmation = true } = {}) {
  const events = [],
    gate = Promise.withResolvers(),
    entered = Promise.withResolvers();
  let current = true;
  const guard = () => {
    if (!current)
      throw Object.assign(Error('account/device changed'), {
        code: 'FINANCE_OPERATION_SCOPE_CHANGED',
      });
  };
  const phase = async (name, value) => {
    events.push(name);
    if (name === hold) {
      entered.resolve();
      await gate.promise;
    }
    return value;
  };
  const input = {
    fetchedAt: stamp,
    accounts: {
      business: { balance: 500, accountId: 'B', transactions: [] },
      home: { balance: 70, accountId: 'H', transactions: [] },
    },
  };
  let saved, display;
  const ports = {
    authority: { captureRead: () => guard },
    checks: {
      hasLocalWork: () => false,
      save: () => phase('checks-save', true),
      refresh: () => phase('checks', true),
      read: () => ({
        kupa: { bank: { snapshotSeq: 3 } },
        bankEvents: [{ seq: 7, at: stamp, delta: 10, kind: 'check_effect_delta', checkId: 'C' }],
      }),
    },
    transactions: {
      reconcile: (account, role, rows, options) => {
        options.lease.assertCurrent();
        return phase(role, { sourcePayload: [], result: { total_count: 0 } });
      },
    },
    images: { sync: () => phase('images', { warnings: [] }) },
    archive: {
      read: () =>
        phase('archive', [
          { role: 'business', accountKey: 'B', rows: [], directSnapshot: null },
          { role: 'home', accountKey: 'H', rows: [], directSnapshot: null },
        ]),
      publish: (value) => {
        events.push('display');
        display = value;
      },
    },
    publication: {
      save: async (bank, token, seq, lease) => {
        lease.assertCurrent();
        saved = { bank, token, seq };
        return phase('publication', { published: confirmation });
      },
    },
    policy: createOrdersBankSnapshotPolicy(),
  };
  const options = {
    financeRow: {
      state: {
        bank: {
          archiveInitialized: true,
          archiveVersion: 2,
          retained: 'peer',
          adjustments: [1],
          snapshotToken: 'old',
          snapshotSeq: 2,
        },
      },
    },
    historyDays: 30,
    archiveReady: true,
    archiveVersion: 2,
    lease: { leaseName: 'bank', leaseToken: 'L', fenceEpoch: 1, assertCurrent: guard },
  };
  const create = () => createOrdersBankSnapshotPublication(publicationPorts(ports));
  return {
    ports,
    options,
    input,
    events,
    gate,
    entered,
    create,
    change: () => {
      current = false;
    },
    saved: () => saved,
    display: () => display,
  };
}

test('the actual model publishes dual feeds with one separate token/sequence and retains current bank fields', async () => {
  const f = fixture(),
    api = f.create(),
    result = await api.commands.publish(f.input, f.options);
  assert.deepEqual(f.events, [
    'business',
    'home',
    'images',
    'archive',
    'checks',
    'publication',
    'display',
  ]);
  assert.equal(result.published, true);
  assert.equal(result.homeFailed, false);
  assert.equal(result.scan.lastScrapeAt, stamp);
  assert.equal(f.saved().bank.currentBalance, 500);
  assert.equal(f.saved().bank.homeFeed.balance, 70);
  assert.equal(f.saved().bank.retained, 'peer');
  for (const field of ['adjustments', 'snapshotToken', 'snapshotSeq'])
    assert.ok(!Object.hasOwn(f.saved().bank, field));
  assert.match(f.saved().token, /^BANK-/);
  assert.equal(f.saved().seq, 7);
  assert.equal(f.display().business.accountKey, 'B');
  assert.equal(api.runtime.isPending(), false);
});

for (const confirmation of [false, 'saved', 1])
  test(`a readout without boolean confirmation (${confirmation}) retains its warning and cannot publish archive display`, async () => {
    const f = fixture({ confirmation }),
      result = await f.create().commands.publish(f.input, f.options);
    assert.equal(result.published, false);
    assert.match(result.scan.lastWarning, /לא אומת/);
    assert.equal(f.display(), undefined);
    assert.equal(f.events.filter((name) => name === 'publication').length, 1);
  });

for (const hold of ['business', 'home', 'images', 'archive', 'checks', 'publication'])
  for (const action of ['scope', 'dispose'])
    test(`${action} during ${hold} retains accepted work and suppresses later stages`, async () => {
      const f = fixture({ hold }),
        api = f.create();
      let settled = false,
        drained = false;
      const pending = api.commands.publish(f.input, f.options);
      void pending
        .catch(() => {})
        .finally(() => {
          settled = true;
        });
      await f.entered.promise;
      if (action === 'dispose') {
        assert.equal(api.runtime.dispose(), true);
        assert.equal(api.runtime.dispose(), false);
        assert.throws(() => api.commands.prepare(() => {}), /closed/);
      } else f.change();
      const draining = api.runtime.drain().then(() => {
        drained = true;
      });
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(api.runtime.isPending(), true);
      assert.equal(settled, false);
      assert.equal(drained, false);
      const accepted = [...f.events];
      f.gate.resolve();
      await assert.rejects(pending, { code: 'FINANCE_OPERATION_SCOPE_CHANGED' });
      await draining;
      assert.deepEqual(f.events, accepted);
      assert.equal(api.runtime.isPending(), false);
      assert.equal(f.display(), undefined);
    });

test('a failed archive sibling remains owned by the actual archive read capability until it settles', async () => {
  // The production archive implementation is separately exercised by its
  // native/paired-read suite. The publisher must await that capability promise.
  const f = fixture({ hold: 'archive' }),
    api = f.create(),
    pending = api.commands.publish(f.input, f.options);
  await f.entered.promise;
  assert.equal(api.runtime.isPending(), true);
  f.gate.reject(Error('archive failed'));
  await assert.rejects(pending, /archive failed/);
  await api.runtime.drain();
  assert.equal(f.events.includes('publication'), false);
});

test('a partial home failure preserves the former home feed, home choice and incomplete-backfill policy', async () => {
  const f = fixture();
  delete f.input.accounts.home;
  f.input.accountFailures = {
    home: { message: 'home unavailable', availableAccounts: [{ accountNumber: 'H' }] },
  };
  f.options.financeRow.state.bank.homeFeed = {
    accountNumber: 'previous',
    balance: 80,
    transactions: [],
  };
  const result = await f.create().commands.publish(f.input, f.options);
  assert.equal(result.homeFailed, true);
  assert.match(result.scan.lastWarning, /home unavailable/);
  assert.equal(result.scan.accountRole, 'home');
  assert.deepEqual(result.scan.availableAccounts, [{ accountNumber: 'H' }]);
  assert.equal(f.saved().bank.homeFeed.accountNumber, 'previous');
  assert.equal(f.events.includes('home'), false);
});

test('image failure remains a warning after verified archive publication', async () => {
  const f = fixture();
  f.ports.images.sync = async () => {
    throw Error('image unavailable');
  };
  const result = await f.create().commands.publish(f.input, f.options);
  assert.equal(result.published, true);
  assert.match(result.scan.lastWarning, /image unavailable/);
});

test('checks changed during their required read must be saved before a Bank snapshot is emitted', async () => {
  const f = fixture();
  let dirty = false;
  f.ports.checks.hasLocalWork = () => dirty;
  f.ports.checks.refresh = async () => {
    dirty = true;
    f.events.push('checks');
    return true;
  };
  f.ports.checks.save = async () => {
    dirty = false;
    f.events.push('checks-save');
    return true;
  };
  await f.create().commands.publish(f.input, f.options);
  assert.ok(f.events.indexOf('checks-save') < f.events.indexOf('publication'));
});

test('failed checks synchronization cannot issue an atomic Bank write', async () => {
  const f = fixture();
  f.ports.checks.refresh = async () => false;
  await assert.rejects(f.create().commands.publish(f.input, f.options), /לא ניתן לאמת/);
  assert.equal(f.events.includes('publication'), false);
});

test('missing archive readback cannot issue an atomic Bank write', async () => {
  const f = fixture();
  f.ports.archive.read = async () => [];
  await assert.rejects(f.create().commands.publish(f.input, f.options), /archive_read_required/);
  assert.equal(f.events.includes('publication'), false);
});

test('publication and reconciliation ports are mandatory and construction starts no work', () => {
  const f = fixture();
  for (const [name, port] of Object.entries(f.ports))
    for (const method of Object.keys(port))
      assert.throws(
        () =>
          createOrdersBankSnapshotPublication(publicationPorts({ ...f.ports, [name]: { ...port, [method]: null } })),
        /required/
      );
  assert.deepEqual(f.events, []);
});
