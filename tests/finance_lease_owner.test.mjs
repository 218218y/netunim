import test from 'node:test';
import assert from 'node:assert/strict';
import { createFinanceLeaseOwner } from '../shared/finance-lease-owner.js';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const grant = (leaseName = 'bank', leaseToken = 'T') => ({
  acquired: true,
  leaseName,
  leaseToken,
  fenceEpoch: 7,
  leasedUntil: '2030-01-01T00:00:00Z',
});
const scopeError = (code) => Object.assign(Error(code), { code });
function fixture({ claim, release, local = false } = {}) {
  const jobs = new Map(),
    events = [];
  let id = 0,
    account = true,
    operation = true;
  const accountError = scopeError('FINANCE_OPERATION_SCOPE_CHANGED'),
    operationError = scopeError('BRIDGE_PAIRING_SCOPE_CHANGED');
  const assertOwner = () => {
      if (!account) throw accountError;
    },
    assertCurrent = () => {
      if (!operation) throw operationError;
    };
  const ports = {
    authority: { capture: () => assertOwner },
    leases: {
      claim:
        claim ??
        (async (name, token, options) => {
          options.assertCurrent();
          events.push('claim');
          return local ? { acquired: true, localOnly: true } : grant(name, token);
        }),
      release:
        release ??
        (async (_name, _token, options) => {
          options.assertCurrent();
          events.push('release');
          return true;
        }),
    },
    timers: {
      setTimeout: (run, delay) => {
        const key = id++;
        jobs.set(key, {
          run: () => {
            jobs.delete(key);
            return run();
          },
          delay,
        });
        return key;
      },
      clearTimeout: (key) => jobs.delete(key),
    },
  };
  const owner = createFinanceLeaseOwner(ports);
  return {
    owner,
    ports,
    jobs,
    events,
    accountError,
    operationError,
    accountChanged: () => {
      account = false;
    },
    pairingChanged: () => {
      operation = false;
    },
    acquire: (name = 'bank', token = 'T') => owner.commands.acquire(name, token, { assertCurrent }),
  };
}

test('a session closes once, clears timer zero and joins cleanup without supplying an ACK', async () => {
  const held = deferred(),
    f = fixture({ release: () => held.promise }),
    s = f.acquire();
  const lease = await s.ready;
  assert.equal(lease.fenceEpoch, 7);
  assert.equal(Object.isFrozen(lease), true);
  assert.equal([...f.jobs.values()][0].delay, 400000);
  const stale = [...f.jobs.values()][0].run,
    closing = s.close();
  assert.equal(s.close(), closing);
  assert.equal(f.jobs.size, 0);
  assert.throws(s.assertCurrent, { code: 'FINANCE_OPERATION_SCOPE_CHANGED' });
  let drained = false;
  const drain = f.owner.runtime.drain().then(() => {
    drained = true;
  });
  await stale();
  await Promise.resolve();
  assert.equal(drained, false);
  assert.equal(f.owner.runtime.isPending(), true);
  held.resolve(true);
  assert.equal(await closing, undefined);
  await drain;
  assert.equal(f.owner.runtime.isPending(), false);
});

test('disposal stops renewal immediately but retains the accepted operation until explicit close', async () => {
  const f = fixture(),
    s = f.acquire();
  await s.ready;
  const tick = [...f.jobs.values()][0].run;
  assert.equal(f.owner.runtime.dispose(), true);
  assert.equal(f.owner.runtime.dispose(), false);
  assert.equal(f.jobs.size, 0);
  await tick();
  assert.deepEqual(f.events, ['claim']);
  assert.equal(f.owner.runtime.isPending(), true);
  assert.throws(s.assertCurrent, { code: 'FINANCE_OPERATION_SCOPE_CHANGED' });
  assert.throws(() => f.acquire(), { code: 'FINANCE_OPERATION_SCOPE_CHANGED' });
  await s.close();
  await f.owner.runtime.drain();
  assert.deepEqual(f.events, ['claim', 'release']);
});

for (const reason of ['dispose', 'pairing', 'account'])
  test(`${reason} during acquisition retains the grant for captured cleanup and prevents timer creation`, async () => {
    const held = deferred(),
      f = fixture({ claim: () => held.promise }),
      s = f.acquire();
    let drained = false;
    const drain = f.owner.runtime.drain().then(() => {
      drained = true;
    });
    await Promise.resolve();
    assert.equal(drained, false);
    if (reason === 'dispose') f.owner.runtime.dispose();
    else if (reason === 'pairing') f.pairingChanged();
    else f.accountChanged();
    held.resolve(grant());
    await assert.rejects(s.ready, {
      code:
        reason === 'pairing' ? 'BRIDGE_PAIRING_SCOPE_CHANGED' : 'FINANCE_OPERATION_SCOPE_CHANGED',
    });
    assert.equal(f.jobs.size, 0);
    if (reason === 'account') await assert.rejects(s.close(), (e) => e === f.accountError);
    else await s.close();
    await drain;
    assert.deepEqual(f.events, reason === 'account' ? [] : ['release']);
  });

test('closing during acquisition joins it before releasing and blocks new renewal', async () => {
  const held = deferred(),
    f = fixture({ claim: () => held.promise }),
    s = f.acquire(),
    closing = s.close();
  assert.equal(f.owner.runtime.isPending(), true);
  assert.deepEqual(f.events, []);
  held.resolve(grant());
  await assert.rejects(s.ready, { code: 'FINANCE_OPERATION_SCOPE_CHANGED' });
  await closing;
  assert.deepEqual(f.events, ['release']);
  assert.equal(f.jobs.size, 0);
});

for (const reason of ['dispose', 'pairing', 'account', 'renewal failure'])
  test(`${reason} joins an accepted renewal before release`, async () => {
    const held = deferred(),
      entered = deferred();
    let claims = 0;
    const f = fixture({
        claim: async (name, token) => {
          if (++claims === 2) {
            entered.resolve();
            await held.promise;
            if (reason === 'renewal failure') throw Error('renewal failed');
          }
          return grant(name, token);
        },
      }),
      s = f.acquire();
    await s.ready;
    const tick = [...f.jobs.values()][0].run,
      renewal = tick();
    await entered.promise;
    if (reason === 'dispose') f.owner.runtime.dispose();
    else if (reason === 'pairing') f.pairingChanged();
    else if (reason === 'account') f.accountChanged();
    const closing = s.close();
    void closing.catch(() => {});
    await Promise.resolve();
    assert.deepEqual(f.events, []);
    held.resolve();
    await renewal;
    if (reason === 'account') await assert.rejects(closing, (e) => e === f.accountError);
    else await closing;
    assert.deepEqual(f.events, reason === 'account' ? [] : ['release']);
    assert.equal(f.jobs.size, 0);
    assert.equal(claims, 2);
  });

test('account scope has priority over a late acquisition transport error', async () => {
  const held = deferred(),
    f = fixture({ claim: () => held.promise }),
    s = f.acquire();
  f.accountChanged();
  held.reject(Error('private former-account error'));
  await assert.rejects(s.ready, (e) => e === f.accountError);
  await s.close();
  assert.deepEqual(f.events, []);
});

test('a refused grant creates no renewal or cleanup obligation', async () => {
  const f = fixture({
      claim: async () => ({ ...grant(), acquired: false, leaseToken: 'another holder' }),
    }),
    s = f.acquire();
  assert.equal((await s.ready).acquired, false);
  assert.equal(f.jobs.size, 0);
  await s.close();
  assert.deepEqual(f.events, []);
});

test('an explicit local lease allocates no heartbeat resources and follows local adapter cleanup', async () => {
  const f = fixture({ local: true }),
    s = f.acquire();
  assert.equal((await s.ready).localOnly, true);
  assert.equal(f.jobs.size, 0);
  f.owner.runtime.dispose();
  await s.close();
  assert.deepEqual(f.events, ['claim', 'release']);
});

for (const [label, value] of [
  ['missing', { acquired: true }],
  ['wrong token', { ...grant(), leaseToken: 'other' }],
  ['wrong kind', grant('credit')],
  ['serialized epoch', { ...grant(), fenceEpoch: '7' }],
])
  test(`${label} grant cannot authorize a provider or allocate renewal`, async () => {
    const f = fixture({ claim: async () => value }),
      s = f.acquire();
    await assert.rejects(s.ready, /finance_lease_/);
    assert.equal(f.jobs.size, 0);
    await s.close();
  });

test('release failure settles ownership without manufacturing cleanup success or retrying', async () => {
  let releases = 0;
  const error = Error('release response lost'),
    f = fixture({
      release: async () => {
        releases++;
        throw error;
      },
    }),
    s = f.acquire();
  await s.ready;
  const closing = s.close();
  await assert.rejects(closing, (e) => e === error);
  assert.equal(s.close(), closing);
  await f.owner.runtime.drain();
  assert.equal(releases, 1);
  assert.equal(f.owner.runtime.isPending(), false);
});

test('separate Bank/Credit sessions never clear another session timer', async () => {
  const f = fixture(),
    bank = f.acquire(),
    credit = f.acquire('credit', 'C');
  await Promise.all([bank.ready, credit.ready]);
  assert.equal(f.jobs.size, 2);
  await bank.close();
  assert.equal(f.jobs.size, 1);
  credit.assertCurrent();
  await credit.close();
  assert.equal(f.jobs.size, 0);
});
