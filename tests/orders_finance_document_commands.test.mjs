import test from 'node:test';
import assert from 'node:assert/strict';
import { createOrdersFinanceDocumentCommands } from '../netunim-orders/site/assets/js/domains/finance/document-commands.js';
import { createDomainsFinanceController } from '../netunim-orders/site/assets/js/domains/finance/controller.js';

function fixture(overrides = {}) {
  const events = [],
    guard = () => {},
    main = {
      revision: 3,
      state: {
        notes: [{ id: 'retained' }],
        creditSync: { privateFinance: true },
        bank: { feed: { privateFinance: true }, snapshotSeq: 7 },
      },
    };
  let finance = { revision: 5, state: { creditSync: { profiles: [] }, marker: 'existing' } },
    active = 0;
  const leases = {
    claim: async (leaseName, leaseToken) => {
      assert.equal(active++, 0);
      events.push(['claim', leaseName]);
      return { acquired: true, leaseName, leaseToken, fenceEpoch: 1 };
    },
    release: async () => {
      active--;
      events.push(['release']);
    },
  };
  const ports = {
    operationScope: { capture: () => guard, captureRead: () => guard },
    kupa: {
      read: async () => structuredClone(main),
      save: async (state, revision, id) => {
        events.push(['main', revision, id]);
        main.revision++;
        main.state = structuredClone(state);
        return { r: { ok: true }, row: structuredClone(main) };
      },
      accept: () => {},
    },
    finance: {
      read: async () => structuredClone(finance),
      save: async (state, revision, id, audit, lease) => {
        assert.equal(active, 1);
        assert.equal(lease.assertCurrent, guard);
        events.push(['finance', revision, id]);
        finance = { revision: revision + 1, state: structuredClone(state) };
        return { r: { ok: true }, row: structuredClone(finance) };
      },
      publishBankSnapshot: async () => {
        events.push(['atomic']);
        return { finance_revision: 8, kupa_revision: 6 };
      },
    },
    leases,
    readout: {
      refresh: async (options) => {
        events.push(['readout', options]);
        return true;
      },
    },
    delay: async () => {},
    ...overrides,
  };
  return {
    ports,
    events,
    main,
    guard,
    getFinance: () => finance,
    setFinance: (value) => {
      finance = value;
    },
    create: () => createOrdersFinanceDocumentCommands(ports),
  };
}

test('document construction rejects incomplete current ports before any read, write or lease', () => {
  const required = {
    operationScope: ['capture', 'captureRead'],
    kupa: ['read', 'save', 'accept'],
    finance: ['read', 'save', 'publishBankSnapshot'],
    leases: ['claim', 'release'],
    readout: ['refresh'],
  };
  for (const [group, methods] of Object.entries(required))
    for (const method of methods) {
      const f = fixture();
      delete f.ports[group][method];
      assert.throws(f.create, TypeError);
      assert.deepEqual(f.events, []);
    }
  const f = fixture({ delay: null });
  assert.throws(f.create, TypeError);
  assert.deepEqual(f.events, []);
});

test('controller rejects the former flat RPC surface instead of activating a legacy write path', () => {
  const unexpected = () => assert.fail('construction cannot activate a write');
  assert.throws(
    () =>
      createDomainsFinanceController({
        operationScope: { capture: () => () => {}, captureRead: () => () => {} },
        effects: {
          isOnline: () => true,
          writeText: unexpected,
          saveJson: unexpected,
          delay: unexpected,
        },
        readKupaReadOnlyCloud: unexpected,
        rpcSaveKupaDocument: unexpected,
        readFinanceSyncDocument: unexpected,
        rpcSaveFinanceSync: unexpected,
        saveBankSyncSnapshot: unexpected,
      }),
    /document_command_mutateKupa_required/
  );
});

test('document capability exposes only three commands and its scoped Finance read query', () => {
  const f = fixture(),
    api = f.create();
  assert.deepEqual(Object.keys(api), ['commands', 'queries']);
  assert.deepEqual(Object.keys(api.commands), [
    'mutateKupa',
    'mutateFinance',
    'publishBankSnapshot',
  ]);
  assert.deepEqual(Object.keys(api.queries), ['readFinance']);
  assert.ok(Object.isFrozen(api) && Object.isFrozen(api.commands) && Object.isFrozen(api.queries));
  assert.deepEqual(f.events, []);
});

test('the controller cannot manufacture a lease grant when the current lease port is absent', () => {
  const unexpected = () => assert.fail('construction cannot start an operation'),
    f = fixture();
  assert.throws(
    () =>
      createDomainsFinanceController({
        operationScope: { capture: () => () => {}, captureRead: () => () => {} },
        effects: {
          isOnline: () => true,
          writeText: unexpected,
          saveJson: unexpected,
          delay: unexpected,
        },
        documents: f.create(),
      }),
    /sync_lease_claim_required/
  );
});

test('waiting edits re-read after lease grant and preserve intervening remote changes in FIFO order', async () => {
  const f = fixture();
  let claim = 0,
    token = 0;
  const actual = f.ports.leases.claim;
  f.ports.leases.claim = async (...args) => (++claim === 1 ? { acquired: false } : actual(...args));
  f.ports.delay = async () => {
    token++;
    f.setFinance({
      revision: 6,
      state: { creditSync: { profiles: [] }, marker: 'remote while waiting', retained: 'peer' },
    });
  };
  const api = f.create();
  await Promise.all([
    api.commands.mutateFinance((state) => ({ ...state, first: 'edit' })),
    api.commands.mutateFinance((state) => ({ ...state, second: 'edit' })),
  ]);
  assert.equal(token, 1);
  assert.deepEqual(f.getFinance().state, {
    creditSync: { profiles: [] },
    marker: 'remote while waiting',
    retained: 'peer',
    first: 'edit',
    second: 'edit',
  });
  assert.deepEqual(
    f.events.filter((row) => row[0] === 'finance').map((row) => row[1]),
    [6, 7]
  );
  assert.equal(
    f.events.some((row) => row[0] === 'main'),
    false
  );
  assert.deepEqual(
    f.events.filter((row) => ['claim', 'release'].includes(row[0])).map((row) => row[0]),
    ['claim', 'release', 'claim', 'release']
  );
});

for (const domain of ['kupa', 'finance'])
  test(`${domain} conflicts retain one operation ID and rebase the edit on the new remote state`, async () => {
    const f = fixture(),
      port = f.ports[domain];
    let writes = 0;
    const original = port.save,
      ids = [];
    port.save = async (state, revision, id, ...args) => {
      ids.push(id);
      if (++writes === 1) {
        if (domain === 'finance')
          f.setFinance({ revision: 6, state: { ...f.getFinance().state, peer: 'retained' } });
        else {
          f.main.revision++;
          f.main.state.peer = 'retained';
        }
        return { r: { ok: false }, j: { code: 'PT409', message: 'revision_conflict' } };
      }
      return original(state, revision, id, ...args);
    };
    const result = await f
      .create()
      .commands[
        domain === 'finance' ? 'mutateFinance' : 'mutateKupa'
      ]((state) => ({ ...state, edit: 'kept' }));
    assert.equal(writes, 2);
    assert.equal(ids[0], ids[1]);
    assert.equal(result.row.state.peer, 'retained');
    assert.equal(result.row.state.edit, 'kept');
    assert.equal(f.events.filter((row) => row[0] === 'readout').length, 1);
    if (domain === 'kupa') {
      assert.equal('creditSync' in result.row.state, false);
      assert.equal('feed' in result.row.state.bank, false);
      assert.equal(result.row.state.bank.snapshotSeq, 7);
    }
  });

for (const reply of [
  null,
  {},
  [
    { finance_revision: 8, kupa_revision: 6 },
    { finance_revision: 9, kupa_revision: 7 },
  ],
])
  test('unknown atomic confirmation never falls back to separate Main/Finance writes', async () => {
    const f = fixture();
    f.ports.finance.publishBankSnapshot = async () => {
      f.events.push(['atomic']);
      return reply;
    };
    await assert.rejects(
      f.create().commands.publishBankSnapshot({}, 'snapshot', 7, { assertCurrent: f.guard }),
      { code: 'BANK_SNAPSHOT_RECEIPT_INVALID' }
    );
    assert.deepEqual(f.events, [['atomic']]);
  });

test('a confirmed atomic commit with an unverified readout reports separate publication status', async () => {
  const f = fixture();
  f.ports.readout.refresh = async (options) => {
    f.events.push(['readout', options]);
    return false;
  };
  const result = await f
    .create()
    .commands.publishBankSnapshot({}, 'snapshot', 7, { assertCurrent: f.guard });
  assert.equal(result.receipt.finance_revision, 8);
  assert.equal(result.published, false);
  assert.ok(result.publicationWarning);
  assert.deepEqual(
    f.events.map((row) => row[0]),
    ['atomic', 'readout']
  );
  assert.equal(f.events[1][1].minimumRevision, 6);
  assert.equal(f.events[1][1].minimumFinanceRevision, 8);
});

test('the Finance query uses read authority and fences a late result after account handoff', async () => {
  const f = fixture();
  let current = true;
  const readGuard = () => {
    if (!current)
      throw Object.assign(new Error('scope changed'), { code: 'FINANCE_OPERATION_SCOPE_CHANGED' });
  };
  f.ports.operationScope.capture = () => {
    throw new Error('read-only scope cannot write');
  };
  f.ports.operationScope.captureRead = () => readGuard;
  const api = f.create();
  assert.equal((await api.queries.readFinance()).revision, 5);
  f.ports.finance.read = async () => {
    current = false;
    return { revision: 6, state: { marker: 'former account' } };
  };
  // A fresh capability captures the replaced test read port.
  await assert.rejects(f.create().queries.readFinance(), {
    code: 'FINANCE_OPERATION_SCOPE_CHANGED',
  });
});

test('owner loss during lease wait prevents both a write and a second claim', async () => {
  const f = fixture();
  let current = true,
    claims = 0;
  const guard = () => {
    if (!current)
      throw Object.assign(new Error('scope changed'), { code: 'FINANCE_OPERATION_SCOPE_CHANGED' });
  };
  f.ports.operationScope.capture = () => guard;
  f.ports.leases.claim = async () => {
    claims++;
    return { acquired: false };
  };
  f.ports.delay = async () => {
    current = false;
  };
  await assert.rejects(
    f.create().commands.mutateFinance((state) => ({ ...state, edit: 'never' })),
    { code: 'FINANCE_OPERATION_SCOPE_CHANGED' }
  );
  assert.equal(claims, 1);
  assert.deepEqual(f.events, []);
});
