import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createKupaBankSnapshotCommands,
  BANK_LOCAL_SAVE_WARNING,
} from '../netunim-kupa/site/assets/js/domains/bank/snapshot-commands.js';
const gate = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
function fixture() {
  let mode = 'supabase',
    current = true,
    dirty = false,
    pending = null;
  const events = [],
    candidate = {
      snapshotToken: 'BANK-one',
      snapshotSeq: 7,
      currentBalance: 500,
      adjustments: [{ amount: 12 }],
      feed: { transactions: [{ id: 'retained' }] },
    };
  const guard = () => {
    if (!current)
      throw Object.assign(Error('scope changed'), { code: 'FINANCE_OPERATION_SCOPE_CHANGED' });
  };
  const lease = { leaseName: 'bank', leaseToken: 'lease-one', fenceEpoch: 3, assertCurrent: guard };
  const ports = {
    authority: {
      capture: () => {
        events.push('capture');
        return guard;
      },
    },
    bank: {
      mode: () => mode,
      manualCandidate: (numeric, options) => {
        events.push(['candidate', numeric, options]);
        return { ...candidate, currentBalance: numeric };
      },
    },
    checks: {
      hasLocalWork: () => dirty,
      saveCloud: async (message) => {
        events.push(['checks-save', message]);
        dirty = false;
        return true;
      },
      syncCloud: async (options) => {
        events.push(['checks-sync', options]);
        return true;
      },
    },
    local: {
      state: () => pending,
      save: async (...args) => {
        events.push(['local-save', ...args]);
        return true;
      },
      retry: async () => true,
    },
    cloud: {
      publish: async (...args) => {
        events.push(['atomic', ...args]);
        return { kupa_revision: 4, finance_revision: 9 };
      },
      refresh: async (options) => {
        events.push(['refresh', options]);
        return { verified: true, revision: 4, financeRevision: 9 };
      },
    },
    publication: {
      bank: (value) => {
        events.push(['bank-publish', value]);
      },
      archive: (value) => {
        events.push(['archive-publish', value]);
      },
      data: () => {
        events.push('data');
      },
    },
  };
  return {
    ports,
    candidate,
    events,
    guard,
    lease,
    create: () => createKupaBankSnapshotCommands(ports),
    close: () => {
      current = false;
    },
    mode: (value) => {
      mode = value;
    },
    dirty: (value) => {
      dirty = value;
    },
    pending: (value) => {
      pending = value;
    },
  };
}
test('snapshot command construction is inert and requires all six explicit ports', () => {
  const f = fixture();
  f.create();
  assert.deepEqual(f.events, []);
  for (const [group, methods] of Object.entries({
    authority: ['capture'],
    bank: ['mode', 'manualCandidate'],
    checks: ['hasLocalWork', 'saveCloud', 'syncCloud'],
    local: ['state', 'save', 'retry'],
    cloud: ['publish', 'refresh'],
    publication: ['archive', 'data'],
  }))
    for (const method of methods) {
      const f = fixture();
      delete f.ports[group][method];
      assert.throws(f.create, TypeError);
    }
});
test('cloud preparation flushes before and after required Shared synchronization', async () => {
  const f = fixture();
  f.dirty(true);
  f.ports.checks.syncCloud = async (options) => {
    f.events.push(['checks-sync', options]);
    f.dirty(true);
    return true;
  };
  await f.create().commands.prepare(f.guard);
  assert.deepEqual(
    f.events.map((event) => event[0]),
    ['checks-save', 'checks-sync', 'checks-save']
  );
  assert.deepEqual(f.events[1][1], { quiet: true, required: true });
});
test('failed Shared flush or synchronization never builds or saves a manual candidate', async () => {
  for (const failure of ['save', 'sync']) {
    const f = fixture();
    f.dirty(failure === 'save');
    f.ports.checks[failure === 'save' ? 'saveCloud' : 'syncCloud'] = async () => false;
    await assert.rejects(f.create().commands.commitManual(500));
    assert.ok(!f.events.some((event) => ['candidate', 'local-save', 'atomic'].includes(event[0])));
  }
});
test('manual construction occurs after required synchronization with validated numeric input', async () => {
  const f = fixture();
  f.dirty(true);
  const options = { source: 'manual', bankFeed: null, message: '' };
  assert.equal(await f.create().commands.commitManual('500', options), true);
  assert.deepEqual(
    f.events.map((event) => (typeof event === 'string' ? event : event[0])),
    ['capture', 'checks-save', 'checks-sync', 'candidate', 'local-save']
  );
  assert.equal(f.events.at(-1)[2], '');
  assert.equal(f.events.at(-1)[3], f.guard);
  assert.equal(f.events.at(-1)[1].snapshotToken, 'BANK-one');
});
test('pending local confirmation and invalid numbers cannot start another manual save', async () => {
  const f = fixture();
  f.pending({ phase: 'unconfirmed', canRetry: true, message: 'pending' });
  assert.equal(await f.create().commands.commitManual(500), false);
  assert.deepEqual(f.events, ['capture']);
  for (const value of [NaN, Infinity, 'invalid']) {
    const f = fixture();
    await assert.rejects(f.create().commands.commitManual(value));
    assert.deepEqual(f.events, ['capture']);
  }
});
test('handoff during Shared verification fences manual candidate creation', async () => {
  const f = fixture(),
    held = gate();
  f.ports.checks.syncCloud = () => held.promise;
  const pending = f.create().commands.commitManual(500);
  f.close();
  held.resolve(true);
  await assert.rejects(pending, { code: 'FINANCE_OPERATION_SCOPE_CHANGED' });
  assert.deepEqual(f.events, ['capture']);
});
test('atomic publication strips only Main metadata and retains the real lease and receipt heads', async () => {
  const f = fixture(),
    archive = { business: { rows: [{ id: 'retained' }] } };
  const result = await f.create().commands.publishCloud(f.candidate, archive, f.lease);
  assert.deepEqual(
    f.events.map((event) => (typeof event === 'string' ? event : event[0])),
    ['atomic', 'refresh', 'archive-publish', 'data']
  );
  const wire = f.events[0];
  assert.ok(!Object.hasOwn(wire[1], 'snapshotToken'));
  assert.ok(!Object.hasOwn(wire[1], 'snapshotSeq'));
  assert.ok(!Object.hasOwn(wire[1], 'adjustments'));
  assert.deepEqual(wire.slice(2), ['BANK-one', 7, f.lease]);
  assert.equal(wire[1].feed, f.candidate.feed);
  assert.deepEqual(f.events[1][1], {
    assertCurrent: f.guard,
    minimumRevision: 4,
    minimumFinanceRevision: 9,
  });
  assert.equal(result.remoteCommitted, true);
  assert.equal(result.readoutVerified, true);
});
test('unknown atomic receipts publish no candidate and issue no second write or read', async () => {
  for (const receipt of [
    null,
    [],
    {},
    [{ kupa_revision: 4, finance_revision: 9 }, {}],
    { kupa_revision: '4', finance_revision: 9 },
  ]) {
    const f = fixture();
    f.ports.cloud.publish = async () => {
      f.events.push('atomic');
      return receipt;
    };
    await assert.rejects(f.create().commands.publishCloud(f.candidate, null, f.lease), {
      code: 'BANK_SNAPSHOT_RECEIPT_INVALID',
    });
    assert.deepEqual(f.events, ['atomic']);
  }
});
test('stale independent readout keeps a confirmed commit distinct from display freshness', async () => {
  const f = fixture();
  f.ports.cloud.refresh = async () => ({ verified: true, revision: 3, financeRevision: 9 });
  const result = await f.create().commands.publishCloud(f.candidate, null, f.lease);
  assert.equal(result.remoteCommitted, true);
  assert.equal(result.readoutVerified, false);
  assert.equal(f.events.filter((event) => event[0] === 'atomic').length, 1);
  assert.ok(!f.events.some((event) => ['bank-publish','archive-publish','data'].includes(event[0])));
});
test('scope loss during commit cannot publish and loss during readout cannot claim success', async () => {
  for (const phase of ['publish', 'refresh']) {
    const f = fixture(),
      held = gate();
    f.ports.cloud[phase] = () => held.promise;
    const pending = f.create().commands.publishCloud(f.candidate, null, f.lease);
    await Promise.resolve();
    await Promise.resolve();
    f.close();
    held.resolve(
      phase === 'publish'
        ? { kupa_revision: 4, finance_revision: 9 }
        : { verified: true, revision: 4, financeRevision: 9 }
    );
    await assert.rejects(pending, { code: 'FINANCE_OPERATION_SCOPE_CHANGED' });
    if (phase === 'publish') assert.deepEqual(f.events, []);
    else
      assert.deepEqual(
        f.events.map((event) => (typeof event === 'string' ? event : event[0])),
        ['atomic']
      );
  }
});
test('local/file publication uses only local durability and cloud mode can never select it', async () => {
  for (const mode of ['local', 'file', 'directory']) {
    const f = fixture();
    f.mode(mode);
    assert.equal(await f.create().commands.publishLocal(f.candidate, 'saved', f.guard), true);
    assert.equal(f.events.length, 1);
    assert.equal(f.events[0][0], 'local-save');
  }
  const f = fixture();
  await assert.rejects(
    f.create().commands.publishLocal(f.candidate, 'saved', f.guard),
    /local_mode_required/
  );
  assert.deepEqual(f.events, []);
});
test('a failed local durability receipt retains the existing warning without a remote fallback', async () => {
  const f = fixture();
  f.mode('file');
  f.ports.local.save = async () => false;
  await assert.rejects(f.create().commands.publishLocal(f.candidate, 'saved', f.guard), {
    message: BANK_LOCAL_SAVE_WARNING,
  });
  assert.deepEqual(f.events, []);
});
test('cloud publication requires captured write authority and a cloud mode before any IO', async () => {
  const f = fixture();
  await assert.rejects(
    f.create().commands.publishCloud(f.candidate, null, {}),
    /lease_scope_required/
  );
  assert.deepEqual(f.events, []);
  f.mode('file');
  await assert.rejects(
    f.create().commands.publishCloud(f.candidate, null, f.lease),
    /cloud_mode_required/
  );
  assert.deepEqual(f.events, []);
});
