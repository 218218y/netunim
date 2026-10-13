import test from 'node:test';
import assert from 'node:assert/strict';
import { startFinanceLeaseHeartbeat } from '../shared/finance-lease-heartbeat.js';
import { createCloudTransport } from '../netunim-kupa/site/assets/js/cloud/transport.js';
import * as retiredFence from '../shared/finance-fence.js';

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const lease = () => ({
  acquired: true,
  leaseName: 'credit',
  leaseToken: 'captured',
  fenceEpoch: 7,
  assertCurrent: () => {},
});
const receipt = () => ({ ...lease(), leasedUntil: '2030-01-01T00:00:00Z' });

test('the retired fence module does not retain a heartbeat facade', () => {
  assert.equal('startFinanceLeaseHeartbeat' in retiredFence, false);
});

test('a stopped queued callback cannot start a new lease request; closing is idempotent even for timer zero', async () => {
  let tick,
    claims = 0;
  const cancelled = [];
  const heartbeat = startFinanceLeaseHeartbeat(
    lease(),
    async () => {
      claims++;
      return receipt();
    },
    {
      setTimer: (fn) => {
        tick = fn;
        return 0;
      },
      clearTimer: (id) => cancelled.push(id),
    }
  );
  const first = heartbeat.stop();
  assert.equal(heartbeat.stop(), first);
  await tick();
  await first;
  assert.deepEqual(cancelled, [0]);
  assert.equal(claims, 0);
});

test('duplicate or stale timer callbacks cannot overlap renewal or create another renewal chain', async () => {
  const held = deferred();
  let tick,
    claims = 0,
    scheduled = 0;
  const heartbeat = startFinanceLeaseHeartbeat(
    lease(),
    async () => {
      claims++;
      await held.promise;
      return receipt();
    },
    {
      setTimer: (fn) => {
        tick = fn;
        return ++scheduled;
      },
      clearTimer: () => {},
    }
  );
  const old = tick,
    first = old(),
    duplicate = old();
  assert.equal(first, duplicate);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(claims, 1);
  held.resolve();
  await first;
  assert.equal(scheduled, 2);
  await old();
  assert.equal(claims, 1);
  await heartbeat.stop();
  await tick();
  assert.equal(claims, 1);
});

test('an explicit local grant schedules no remote renewal resources', async () => {
  let valid = true;
  const heartbeat = startFinanceLeaseHeartbeat(
    {
      acquired: true,
      localOnly: true,
      assertCurrent: () => {
        if (!valid) throw Error('changed owner');
      },
    },
    async () => assert.fail('local cloud renewal'),
    {
      setTimer: () => assert.fail('local timer'),
      clearTimer: () => assert.fail('local cancellation'),
    }
  );
  heartbeat.assertCurrent();
  await heartbeat.stop();
  valid = false;
  assert.throws(heartbeat.assertCurrent, /changed owner/);
});

for (const [name, changed] of [
  ['denied', { acquired: false }],
  ['token', { leaseToken: 'replacement' }],
  ['epoch', { fenceEpoch: 8 }],
  ['kind', { leaseName: 'bank' }],
  ['undecoded', { fenceEpoch: '7' }],
  ['local', { localOnly: true }],
]) {
  test(`a ${name} renewal cannot authorize publication or rearm the heartbeat`, async () => {
    let tick,
      scheduled = 0;
    const heartbeat = startFinanceLeaseHeartbeat(
      lease(),
      async () => ({ ...receipt(), ...changed }),
      {
        setTimer: (fn) => {
          tick = fn;
          return ++scheduled;
        },
        clearTimer: () => {},
      }
    );
    await tick();
    assert.throws(heartbeat.assertCurrent, { code: 'stale_finance_sync_fence' });
    assert.equal(scheduled, 1);
    await heartbeat.stop();
  });
}

test('closing joins a failed accepted request without manufacturing success or masking cleanup', async () => {
  const held = deferred(),
    entered = deferred();
  let tick;
  const error = Error('renewal response lost');
  const heartbeat = startFinanceLeaseHeartbeat(
    lease(),
    async () => {
      entered.resolve();
      await held.promise;
      throw error;
    },
    {
      setTimer: (fn) => {
        tick = fn;
        return 1;
      },
      clearTimer: () => {},
    }
  );
  const accepted = tick();
  await entered.promise;
  let settled = false;
  const closing = heartbeat.stop();
  void closing.then(() => {
    settled = true;
  });
  await Promise.resolve();
  assert.equal(settled, false);
  held.resolve();
  assert.equal(await closing, undefined);
  await accepted;
  assert.throws(heartbeat.assertCurrent, (e) => e === error);
});

test('scope loss takes priority over a late renewal network error', async () => {
  const held = deferred(),
    entered = deferred();
  let tick,
    valid = true;
  const scopeError = Object.assign(Error('changed owner'), {
    code: 'FINANCE_OPERATION_SCOPE_CHANGED',
  });
  const heartbeat = startFinanceLeaseHeartbeat(
    {
      ...lease(),
      assertCurrent: () => {
        if (!valid) throw scopeError;
      },
    },
    async () => {
      entered.resolve();
      await held.promise;
      throw Error('private former-account error');
    },
    {
      setTimer: (fn) => {
        tick = fn;
        return 1;
      },
      clearTimer: () => {},
    }
  );
  const accepted = tick();
  await entered.promise;
  valid = false;
  held.resolve();
  await accepted;
  await heartbeat.stop();
  assert.throws(heartbeat.assertCurrent, (e) => e === scopeError);
});

for (const invalid of [
  { acquired: true },
  { ...lease(), assertCurrent: undefined },
  { ...lease(), fenceEpoch: 0 },
  { ...lease(), leaseToken: '' },
]) {
  test('unconfirmed heartbeat input cannot allocate a timer or invoke a provider', () => {
    assert.throws(
      () =>
        startFinanceLeaseHeartbeat(invalid, async () => assert.fail('invalid claim'), {
          setTimer: () => assert.fail('invalid timer'),
        }),
      /finance_lease_heartbeat_/
    );
  });
}

test('stopping a lease heartbeat joins its accepted renewal before releasing the server lease', async () => {
  const held = deferred(),
    entered = deferred(),
    events = [];
  let tick,
    active = true;
  const send = async (path, options) => {
    const body = JSON.parse(options.body);
    if (path.endsWith('/claim_finance_sync_lease')) {
      entered.resolve();
      await held.promise;
      active = true;
      events.push('renewed');
      return new Response(
        JSON.stringify({
          acquired: true,
          lease_token: body.p_lease_token,
          fence_epoch: 7,
          leased_until: '2030-01-01T00:00:00Z',
        })
      );
    }
    assert.ok(path.endsWith('/release_finance_sync_lease'));
    active = false;
    events.push('released');
    return new Response('true');
  };
  const api = createCloudTransport({ supaRest: send, supaFetch: send });
  const lease = {
    acquired: true,
    leaseName: 'bank',
    leaseToken: 'operation',
    fenceEpoch: 7,
    assertCurrent: () => {},
  };
  const heartbeat = startFinanceLeaseHeartbeat(lease, api.claimFinanceSyncLease, {
    setTimer: (fn) => {
      tick = fn;
      return 1;
    },
    clearTimer: () => {},
  });
  const renewal = tick();
  await entered.promise;
  const cleanup = (async () => {
    await heartbeat.stop();
    await api.releaseFinanceSyncLease('bank', 'operation');
  })();
  try {
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(events, [], 'release overtook an already accepted renewal');
  } finally {
    held.resolve();
    await renewal;
    await cleanup;
  }
  assert.deepEqual(events, ['renewed', 'released']);
  assert.equal(active, false);
});
