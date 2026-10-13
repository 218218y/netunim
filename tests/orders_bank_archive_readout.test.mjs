import test from 'node:test';
import assert from 'node:assert/strict';
import { createOrdersBankArchiveReadout } from '../netunim-orders/site/assets/js/domains/finance/bank-archive-readout.js';
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const tick = () => new Promise((resolve) => setImmediate(resolve));
function fixture() {
  let account = 'A',
    epoch = 1,
    touches = 0,
    reads = 0;
  const reported = [],
    inline = [{ archiveId: 4, title: 'retained' }];
  const ports = {
    authority: {
      captureRead: () => {
        const owner = account,
          generation = epoch;
        return () => {
          if (account !== owner || epoch !== generation)
            throw Object.assign(Error('scope changed'), {
              code: 'FINANCE_OPERATION_SCOPE_CHANGED',
            });
        };
      },
    },
    sources: {
      targets: () => [{ role: 'business', accountKey: 'same-account', syncKey: 'one' }],
      rows: () => [inline],
    },
    reads: {
      transactions: async () => {
        reads++;
        return [{ archiveId: 4, title: 'archive' }];
      },
      snapshot: async () => ({ complete: true }),
    },
    access: { authenticated: () => true, online: () => true },
    revision: { read: () => 1, touch: () => ++touches },
    report: (role, error) => reported.push([role, error]),
  };
  return {
    ports,
    inline,
    reported,
    create: () => createOrdersBankArchiveReadout(ports),
    handoff: () => {
      account = 'B';
      epoch++;
    },
    relogin: () => epoch++,
    reads: () => reads,
    touches: () => touches,
  };
}
test('archive construction validates explicit ports and creates no reads, revisions or authority capture', () => {
  const f = fixture();
  f.ports.authority.captureRead = () => assert.fail('constructor captures no authority');
  f.create();
  assert.equal(f.reads(), 0);
  assert.equal(f.touches(), 0);
  for (const [group, methods] of Object.entries({
    authority: ['captureRead'],
    sources: ['targets', 'rows'],
    reads: ['transactions', 'snapshot'],
    access: ['authenticated', 'online'],
    revision: ['touch'],
  }))
    for (const method of methods) {
      const broken = fixture();
      delete broken.ports[group][method];
      assert.throws(broken.create, TypeError);
    }
});
test('same signature shares one scoped hydration and all-years options retain every row', async () => {
  const f = fixture(),
    held = deferred(),
    options = [];
  f.ports.reads.transactions = async (...args) => {
    options.push(args);
    return held.promise;
  };
  const api = f.create();
  const first = api.runtime.ensure(),
    second = api.runtime.ensure();
  assert.equal(options.length, 1);
  assert.equal(options[0][2].days, null);
  held.resolve([
    { archiveId: 4, title: 'one' },
    { archiveId: 5, title: 'two' },
  ]);
  assert.equal(await first, true);
  assert.equal(await second, true);
  assert.equal(api.queries.matching('business', 'same-account', 'one').rows.length, 2);
  assert.equal(api.queries.ready(), true);
  assert.equal(await api.runtime.ensure(), false);
  assert.equal(f.touches(), 1);
});
test('same-account re-login cannot join or publish a former flight and old cleanup retains the newer flight', async () => {
  const f = fixture(),
    old = deferred(),
    fresh = deferred();
  let calls = 0;
  f.ports.reads.transactions = () => (++calls === 1 ? old.promise : fresh.promise);
  const api = f.create(),
    a = api.runtime.ensure();
  f.relogin();
  const b = api.runtime.ensure();
  old.resolve([{ archiveId: 1, title: 'former' }]);
  assert.equal(await a, false);
  const join = api.runtime.ensure();
  assert.equal(calls, 2);
  fresh.resolve([{ archiveId: 2, title: 'new' }]);
  assert.equal(await b, true);
  assert.equal(await join, true);
  assert.equal(api.queries.matching('business', 'same-account', 'one').rows[0].title, 'new');
});
test('failure waits for its accepted sibling and retains the first error without adding requests', async () => {
  const f = fixture(),
    held = deferred(),
    first = Error('first'),
    second = Error('second');
  let starts = 0,
    settled = false;
  f.ports.reads.transactions = async () => {
    starts++;
    throw first;
  };
  f.ports.reads.snapshot = () => {
    starts++;
    return held.promise;
  };
  const api = f.create(),
    pending = api.queries.readSnapshot([{ role: 'business', accountKey: 'same-account' }]);
  void pending.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    }
  );
  await tick();
  assert.equal(settled, false);
  held.reject(second);
  await assert.rejects(pending, (error) => error === first);
  assert.equal(starts, 2);
  assert.equal(f.reported.length, 0);
});
test('a synchronous snapshot failure still retains the already accepted transaction read', async () => {
  const f = fixture(),
    held = deferred(),
    failure = Error('snapshot synchronous failure');
  let settled = false;
  f.ports.reads.transactions = () => held.promise;
  f.ports.reads.snapshot = () => {
    throw failure;
  };
  const api = f.create(),
    pending = api.queries.readSnapshot([{ role: 'business', accountKey: 'same-account' }]);
  void pending.catch(() => {
    settled = true;
  });
  await tick();
  assert.equal(settled, false);
  held.resolve([]);
  await assert.rejects(pending, (error) => error === failure);
});
test('a synchronous first failure starts no snapshot or later role', async () => {
  const f = fixture(),
    failure = Error('first synchronous failure');
  f.ports.reads.transactions = () => {
    throw failure;
  };
  f.ports.reads.snapshot = () => assert.fail('no later starts');
  await assert.rejects(
    f.create().queries.readSnapshot([
      { role: 'business', accountKey: 'A' },
      { role: 'home', accountKey: 'B' },
    ]),
    (error) => error === failure
  );
});
test('verification starts roles in the original order and retains every accepted role read after failure', async () => {
  const f = fixture(),
    held = deferred(),
    order = [],
    failure = Error('home rows');
  f.ports.reads.transactions = async (_, role) => {
    order.push(role + ' rows');
    if (role === 'home') throw failure;
    return [];
  };
  f.ports.reads.snapshot = (_, role) => {
    order.push(role + ' snapshot');
    return role === 'home' ? held.promise : Promise.resolve(null);
  };
  const api = f.create(),
    pending = api.queries.readSnapshot(
      [
        { role: 'business', accountKey: 'A' },
        { role: 'home', accountKey: 'B' },
      ],
      { days: 370 }
    );
  let settled = false;
  void pending.catch(() => {
    settled = true;
  });
  await tick();
  assert.equal(settled, false);
  assert.deepEqual(order, ['business rows', 'business snapshot', 'home rows', 'home snapshot']);
  held.resolve(null);
  await assert.rejects(pending, (error) => error === failure);
});
test('disposed ownership clears read models and drains both current and superseded accepted requests', async () => {
  const f = fixture(),
    a = deferred(),
    b = deferred();
  let calls = 0;
  f.ports.reads.transactions = () => (++calls === 1 ? a.promise : b.promise);
  const api = f.create(),
    first = api.runtime.ensure();
  f.ports.sources.targets = () => [
    { role: 'business', accountKey: 'same-account', syncKey: 'two' },
  ];
  const second = api.runtime.ensure();
  assert.equal(api.runtime.dispose(), true);
  assert.equal(api.runtime.dispose(), false);
  assert.equal(api.runtime.resume(), false);
  assert.equal(api.queries.ready(), false);
  let drained = false;
  const draining = api.runtime.drain().then(() => {
    drained = true;
  });
  a.resolve([]);
  await first;
  await tick();
  assert.equal(drained, false);
  b.resolve([]);
  await second;
  await draining;
  assert.equal(drained, true);
  assert.equal(f.touches(), 0);
  assert.deepEqual(f.reported, []);
  assert.equal(await api.runtime.ensure(), false);
});

test('disposal drains direct verification reads for both roles before rejecting publication authority', async () => {
  const f = fixture(),
    business = deferred(),
    home = deferred();
  f.ports.reads.snapshot = (_, role) => (role === 'business' ? business.promise : home.promise);
  const api = f.create(),
    pending = api.queries.readSnapshot([
      { role: 'business', accountKey: 'A' },
      { role: 'home', accountKey: 'B' },
    ]);
  const rejected = assert.rejects(pending, { code: 'FINANCE_OPERATION_SCOPE_CHANGED' });
  api.runtime.dispose();
  let drained = false;
  const draining = api.runtime.drain().then(() => {
    drained = true;
  });
  business.resolve(null);
  await tick();
  assert.equal(drained, false);
  home.resolve(null);
  await rejected;
  await draining;
  assert.equal(drained, true);
  assert.equal(f.touches(), 0);
});
test('Bank publication invalidates prior hydration, retains unchanged home state and patches only archive IDs', async () => {
  const f = fixture(),
    held = deferred();
  f.ports.reads.transactions = () => held.promise;
  const api = f.create(),
    guard = f.ports.authority.captureRead();
  api.commands.publish({
    home: {
      accountKey: 'home',
      syncKey: 'home-sync',
      rows: [{ archiveId: 9, title: 'home' }],
      directSnapshot: null,
      assertCurrent: guard,
    },
  });
  const old = api.runtime.ensure();
  api.runtime.pause();
  assert.equal(await api.runtime.ensure(), false);
  api.commands.publish({
    business: {
      accountKey: 'same-account',
      syncKey: 'one',
      rows: [
        { archiveId: 4, title: 'confirmed' },
        { id: 4, title: 'not an archive ID' },
      ],
      directSnapshot: null,
      assertCurrent: guard,
    },
  });
  held.resolve([{ archiveId: 4, title: 'uncommitted' }]);
  assert.equal(await old, false);
  api.runtime.resume();
  assert.equal(api.queries.matching('home', 'home', 'home-sync').rows[0].title, 'home');
  assert.equal(
    api.commands.update(4, (row) => {
      row.title = 'acknowledged';
    }),
    true
  );
  assert.equal(
    api.queries.matching('business', 'same-account', 'one').rows[0].title,
    'acknowledged'
  );
  assert.equal(
    api.queries.matching('business', 'same-account', 'one').rows[1].title,
    'not an archive ID'
  );
  assert.equal(f.inline[0].title, 'acknowledged');
  api.runtime.dispose();
  assert.equal(
    api.commands.update(4, (row) => {
      row.title = 'late';
    }),
    false
  );
  assert.equal(f.inline[0].title, 'acknowledged');
});
test('partial home failure preserves the verified business archive and invalidates readiness', async () => {
  const f = fixture();
  f.ports.sources.targets = () => [
    { role: 'business', accountKey: 'A', syncKey: 'one' },
    { role: 'home', accountKey: 'B', syncKey: 'one' },
  ];
  f.ports.reads.transactions = async (_, role) => {
    if (role === 'home') throw Error('home failed');
    return [{ archiveId: 4, title: 'business' }];
  };
  const api = f.create();
  assert.equal(await api.runtime.ensure(), true);
  assert.equal(api.queries.matching('business', 'A', 'one').rows.length, 1);
  assert.equal(api.queries.ready(), false);
  assert.equal(f.reported.length, 1);
  assert.equal(f.reported[0][0], 'home');
});

test('paused hydration retains its accepted read but starts no remaining home reads', async () => {
  const f = fixture(),
    held = deferred(),
    starts = [];
  f.ports.sources.targets = () => [
    { role: 'business', accountKey: 'A', syncKey: 'one' },
    { role: 'home', accountKey: 'B', syncKey: 'one' },
  ];
  f.ports.reads.transactions = (_, role) => {
    starts.push(role);
    return held.promise;
  };
  const api = f.create(),
    pending = api.runtime.ensure();
  api.runtime.pause();
  held.resolve([]);
  assert.equal(await pending, false);
  assert.deepEqual(starts, ['business']);
  assert.equal(f.touches(), 0);
  assert.deepEqual(f.reported, []);
  await api.runtime.drain();
});
test('auth change fences rejected verification and emits no former-account diagnostics', async () => {
  const f = fixture(),
    held = deferred();
  f.ports.reads.transactions = () => held.promise;
  const api = f.create(),
    reading = api.runtime.ensure();
  f.handoff();
  held.reject(Error('private former account'));
  assert.equal(await reading, false);
  assert.deepEqual(f.reported, []);
  assert.equal(f.touches(), 0);
});
