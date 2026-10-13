import test from 'node:test';
import assert from 'node:assert/strict';
import { createKupaBankArchiveReadout } from '../netunim-kupa/site/assets/js/domains/bank/archive-readout.js';
const gate = () => {
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
    cloud = true,
    publications = 0;
  const reports = [],
    targets = [{ role: 'business', accountKey: 'one', syncKey: 'stamp' }];
  const ports = {
    authority: {
      captureRead: () => {
        const captured = account,
          generation = epoch;
        return () => {
          if (captured !== account || generation !== epoch)
            throw Object.assign(Error('changed'), { code: 'FINANCE_OPERATION_SCOPE_CHANGED' });
        };
      },
    },
    sources: { targets: () => targets },
    reads: {
      transactions: async () => [{ archiveId: 4, title: 'row' }],
      snapshot: async () => ({ complete: true }),
    },
    access: { cloud: () => cloud },
    publication: () => publications++,
    report: (...args) => reports.push(args),
  };
  return {
    ports,
    targets,
    reports,
    create: () => createKupaBankArchiveReadout(ports),
    handoff: () => {
      account = 'B';
      epoch++;
    },
    relogin: () => epoch++,
    mode: (value) => {
      cloud = value;
    },
    publications: () => publications,
  };
}
test('Kupa archive construction is inert and requires its exact six ports', () => {
  const f = fixture();
  f.ports.authority.captureRead = () => assert.fail('no capture during construction');
  f.create();
  assert.equal(f.publications(), 0);
  for (const [group, methods] of Object.entries({
    authority: ['captureRead'],
    sources: ['targets'],
    reads: ['transactions', 'snapshot'],
    access: ['cloud'],
  }))
    for (const method of methods) {
      const f = fixture();
      delete f.ports[group][method];
      assert.throws(f.create, TypeError);
    }
  for (const method of ['publication', 'report']) {
    const f = fixture();
    delete f.ports[method];
    assert.throws(f.create, TypeError);
  }
});
test('file/local modes issue no archive reads and cannot start cloud hydration', async () => {
  const f = fixture();
  f.mode(false);
  f.ports.reads.transactions = () => assert.fail('local archive IO');
  assert.equal(await f.create().runtime.ensure(), false);
});
test('same signature joins reads and publishes once with the all-years window', async () => {
  const f = fixture(),
    held = gate();
  let reads = 0;
  const options = [];
  f.ports.reads.transactions = (_, role, read) => {
    reads++;
    options.push([role, read.days]);
    return held.promise;
  };
  const api = f.create(),
    a = api.runtime.ensure(),
    b = api.runtime.ensure();
  assert.equal(reads, 1);
  held.resolve([{ archiveId: 4, title: 'row' }]);
  assert.equal(await a, true);
  assert.equal(await b, true);
  assert.equal(f.publications(), 1);
  assert.deepEqual(options, [['business', null]]);
  assert.equal(await api.runtime.ensure(), false);
  assert.equal(api.queries.matching('business', 'one', 'stamp').rows.length, 1);
});
test('same-account re-login starts a fresh flight and earlier cleanup cannot clear it', async () => {
  const f = fixture(),
    old = gate(),
    fresh = gate();
  let reads = 0;
  f.ports.reads.transactions = () => (++reads === 1 ? old.promise : fresh.promise);
  const api = f.create(),
    a = api.runtime.ensure();
  f.relogin();
  const b = api.runtime.ensure();
  old.resolve([{ archiveId: 1, title: 'former' }]);
  assert.equal(await a, false);
  const joining = api.runtime.ensure();
  assert.equal(reads, 2);
  fresh.resolve([{ archiveId: 2, title: 'current' }]);
  assert.equal(await b, true);
  assert.equal(await joining, true);
  assert.equal(api.queries.matching('business', 'one', 'stamp').rows[0].title, 'current');
  assert.equal(f.publications(), 1);
});
test('Kupa hydration failure holds its sibling and former-account reporting is fenced', async () => {
  const f = fixture(),
    held = gate();
  f.ports.reads.transactions = async () => {
    throw Error('private first failure');
  };
  f.ports.reads.snapshot = () => held.promise;
  const api = f.create(),
    reading = api.runtime.ensure();
  let settled = false;
  void reading.then(() => {
    settled = true;
  });
  await tick();
  assert.equal(settled, false);
  f.handoff();
  held.reject(Error('private second failure'));
  assert.equal(await reading, false);
  assert.deepEqual(f.reports, []);
  assert.equal(f.publications(), 0);
});
test('pause retains accepted work and prevents remaining role starts and stale projection', async () => {
  const f = fixture(),
    held = gate(),
    starts = [];
  f.targets.push({ role: 'home', accountKey: 'home', syncKey: 'stamp' });
  f.ports.reads.transactions = (_, role) => {
    starts.push(role);
    return held.promise;
  };
  const api = f.create(),
    reading = api.runtime.ensure();
  api.runtime.pause();
  assert.equal(await api.runtime.ensure(), false);
  held.resolve([{ archiveId: 4 }]);
  assert.equal(await reading, false);
  assert.deepEqual(starts, ['business']);
  assert.equal(api.queries.matching('business', 'one', 'stamp'), null);
  assert.equal(f.publications(), 0);
  assert.equal(api.runtime.resume(), true);
});
test('partial home failure publishes the accepted business projection once', async () => {
  const f = fixture();
  f.targets.push({ role: 'home', accountKey: 'home', syncKey: 'stamp' });
  f.ports.reads.transactions = async (_, role) => {
    if (role === 'home') throw Error('home failed');
    return [{ archiveId: 4 }];
  };
  const api = f.create();
  assert.equal(await api.runtime.ensure(), true);
  assert.equal(api.queries.matching('business', 'one', 'stamp').rows.length, 1);
  assert.equal(api.queries.matching('home', 'home', 'stamp'), null);
  assert.equal(f.reports.length, 1);
  assert.equal(f.publications(), 1);
});
test('confirmed publication is inert, retains unchanged home and invalidates old hydration', async () => {
  const f = fixture(),
    held = gate();
  f.ports.reads.transactions = () => held.promise;
  const api = f.create(),
    guard = f.ports.authority.captureRead();
  api.commands.publish({
    home: {
      accountKey: 'home',
      syncKey: 'stamp',
      rows: [{ archiveId: 8, title: 'retained' }],
      directSnapshot: null,
      assertCurrent: guard,
    },
  });
  const reading = api.runtime.ensure();
  api.commands.publish({
    business: {
      accountKey: 'one',
      syncKey: 'stamp',
      rows: [{ archiveId: 4, title: 'confirmed' }],
      directSnapshot: null,
      assertCurrent: guard,
    },
  });
  held.resolve([{ archiveId: 4, title: 'former' }]);
  assert.equal(await reading, false);
  assert.equal(f.publications(), 0);
  assert.equal(api.queries.matching('business', 'one', 'stamp').rows[0].title, 'confirmed');
  assert.equal(api.queries.matching('home', 'home', 'stamp').rows[0].title, 'retained');
});
test('publication validates both guards before replacing any projection', () => {
  const f = fixture(),
    api = f.create(),
    guard = f.ports.authority.captureRead(),
    row = {
      accountKey: 'one',
      syncKey: 'stamp',
      rows: [{ archiveId: 4, title: 'retained' }],
      directSnapshot: null,
      assertCurrent: guard,
    };
  api.commands.publish({ business: row });
  assert.throws(
    () =>
      api.commands.publish({
        business: { ...row, rows: [{ archiveId: 4, title: 'candidate' }] },
        home: {
          ...row,
          assertCurrent: () => {
            throw Error('home changed');
          },
        },
      }),
    /home changed/
  );
  assert.equal(api.queries.matching('business', 'one', 'stamp').rows[0].title, 'retained');
  assert.equal(f.publications(), 0);
});
test('acknowledgement invalidates only matching archive IDs and exact rows can be rehydrated', async () => {
  const f = fixture(),
    api = f.create(),
    guard = f.ports.authority.captureRead();
  api.commands.publish({
    business: {
      accountKey: 'one',
      syncKey: 'stamp',
      rows: [{ archiveId: 4, title: 'original' }],
      directSnapshot: { complete: true },
      assertCurrent: guard,
    },
    home: {
      accountKey: 'home',
      syncKey: 'stamp',
      rows: [{ id: 4, title: 'home' }],
      directSnapshot: null,
      assertCurrent: guard,
    },
  });
  assert.equal(api.commands.invalidate(4), true);
  assert.equal(api.queries.matching('business', 'one', 'stamp'), null);
  assert.equal(api.queries.matching('home', 'home', 'stamp').rows[0].title, 'home');
  assert.equal(f.publications(), 0);
  assert.equal(await api.runtime.ensure(), true);
  assert.equal(api.queries.matching('business', 'one', 'stamp').rows[0].title, 'row');
});
test('disposal closes reads and drains current, superseded and direct verification obligations', async () => {
  const f = fixture(),
    a = gate(),
    b = gate(),
    verification = gate();
  let reads = 0;
  f.ports.reads.transactions = () => [a.promise, b.promise, verification.promise][reads++];
  const api = f.create(),
    first = api.runtime.ensure();
  f.targets[0].syncKey = 'two';
  const second = api.runtime.ensure();
  const direct = api.queries.readSnapshot([{ role: 'home', accountKey: 'home' }], { days: 370 });
  const rejected = assert.rejects(direct, { code: 'FINANCE_OPERATION_SCOPE_CHANGED' });
  assert.equal(api.runtime.dispose(), true);
  assert.equal(api.runtime.dispose(), false);
  assert.equal(api.runtime.resume(), false);
  let drained = false;
  const draining = api.runtime.drain().then(() => {
    drained = true;
  });
  a.resolve([]);
  b.resolve([]);
  await first;
  await second;
  await tick();
  assert.equal(drained, false);
  verification.resolve([]);
  await rejected;
  await draining;
  assert.equal(drained, true);
  assert.equal(f.publications(), 0);
  assert.deepEqual(f.reports, []);
  assert.equal(await api.runtime.ensure(), false);
  assert.equal(api.commands.invalidate(4), false);
  assert.equal(api.commands.publish({}), false);
  assert.throws(() => api.queries.readSnapshot([]), { code: 'FINANCE_OPERATION_SCOPE_CHANGED' });
});
