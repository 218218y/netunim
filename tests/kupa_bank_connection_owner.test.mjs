import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'acorn';
import { analyze } from 'eslint-scope';
import { createKupaBankConnectionOwner } from '../netunim-kupa/site/assets/js/domains/bank/connection-owner.js';
const gate = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
function fixture(t) {
  let token = 'A',
    now = 10000,
    reads = 0;
  const events = [];
  const ports = {
    pairing: {
      read: () => token,
      write: (value) => {
        token = value;
      },
    },
    transport: {
      readStatus: async () => {
        reads++;
        return { bridgeVersion: 74, configured: true };
      },
      configure: async () => ({}),
      selectAccount: async () => ({}),
      deleteCredentials: async () => ({}),
      readDiagnostics: async () => ({}),
    },
    presentation: { toast: (value) => events.push(value), changed: () => {} },
    effects: { saveJson: () => undefined },
    clock: { now: () => now },
    protocol: { minimumBridgeVersion: 74, statusCacheMs: 15000 },
  };
  const owner = createKupaBankConnectionOwner(ports);
  t.after(async () => {
    owner.runtime.dispose();
    await owner.runtime.drain();
  });
  return {
    owner,
    ports,
    events,
    token: (value) => {
      token = value;
    },
    clock: (value) => {
      now = value;
    },
    reads: () => reads,
  };
}
test('Kupa local owner is inert and uses six required effect/resource ports', () => {
  const source = readFileSync(
      new URL('../netunim-kupa/site/assets/js/domains/bank/connection-owner.js', import.meta.url),
      'utf8'
    ),
    tree = parse(source, { ecmaVersion: 'latest', sourceType: 'module', ranges: true });
  const factory = tree.body.find(
    (row) => row.declaration?.id?.name === 'createKupaBankConnectionOwner'
  ).declaration;
  assert.deepEqual(
    factory.params[0].properties.map((row) => row.key.name),
    ['pairing', 'transport', 'presentation', 'effects', 'clock', 'protocol']
  );
  const forbidden = new Set([
    'window',
    'document',
    'navigator',
    'fetch',
    'globalThis',
    'localStorage',
    'sessionStorage',
    'setTimeout',
    'setInterval',
    'console',
  ]);
  assert.deepEqual(
    analyze(tree, { ecmaVersion: 2022, sourceType: 'module' })
      .globalScope.through.filter((ref) => forbidden.has(ref.identifier.name))
      .map((ref) => ref.identifier.name),
    []
  );
  assert.ok(!source.includes('Math.max('), 'a vault acknowledgement cannot fabricate a version');
});
test('Kupa status TTL is device-scoped, includes failures and treats clock rollback as expiry', async (t) => {
  const f = fixture(t);
  assert.equal(f.reads(), 0);
  await f.owner.queries.refreshStatus({ force: false });
  await f.owner.queries.refreshStatus({ force: false });
  assert.equal(f.reads(), 1);
  f.clock(25000);
  await f.owner.queries.refreshStatus({ force: false });
  assert.equal(f.reads(), 2);
  f.clock(24000);
  await f.owner.queries.refreshStatus({ force: false });
  assert.equal(f.reads(), 3);
  f.token('B');
  await f.owner.queries.refreshStatus({ force: false });
  assert.equal(f.reads(), 4);
  f.ports.transport.readStatus = async () => {
    throw Error('offline');
  };
  await f.owner.queries.refreshStatus();
  assert.equal(f.owner.queries.snapshot().availabilityError, 'offline');
  f.ports.transport.readStatus = async () => assert.fail('cached failure retried early');
  await f.owner.queries.refreshStatus({ force: false });
});
test('Kupa replacement-device status runs independently of accepted former-device requests', async (t) => {
  const f = fixture(t),
    old = gate();
  f.ports.transport.readStatus = () => old.promise;
  const pending = f.owner.queries.refreshStatus();
  f.token('B');
  f.ports.transport.readStatus = async () => ({
    bridgeVersion: 75,
    configured: true,
    accountNumber: 'B',
  });
  await f.owner.queries.refreshStatus();
  old.resolve({ bridgeVersion: 74, configured: true, accountNumber: 'A' });
  await pending;
  assert.equal(f.owner.queries.snapshot().accountNumber, 'B');
  assert.equal(f.owner.queries.snapshot().bridgeVersion, 75);
});
for (const phase of ['before', 'during'])
  test(`Kupa vault acknowledgement supersedes status accepted ${phase} the write`, async (t) => {
    const f = fixture(t),
      status = gate(),
      write = gate();
    f.ports.transport.readStatus = () => status.promise;
    f.ports.transport.deleteCredentials = () => write.promise;
    let pending;
    if (phase === 'before') pending = f.owner.queries.refreshStatus();
    const deleting = f.owner.commands.deleteCredentials();
    if (phase === 'during') pending = f.owner.queries.refreshStatus();
    write.resolve({});
    await deleting;
    status.resolve({ bridgeVersion: 74, configured: true, accountNumber: 'deleted' });
    await pending;
    assert.equal(f.owner.queries.snapshot().configured, false);
    assert.equal(f.owner.queries.snapshot().accountNumber, '');
  });
test('Kupa observed A to B to A pairing invalidates accepted status even after the token returns', async (t) => {
  const f = fixture(t),
    held = gate();
  f.ports.transport.readStatus = () => held.promise;
  const pending = f.owner.queries.refreshStatus();
  f.token('B');
  f.owner.queries.snapshot();
  f.token('A');
  held.resolve({ bridgeVersion: 74, configured: true, accountNumber: 'old-A' });
  await pending;
  assert.equal(f.owner.queries.snapshot().checked, false);
});
test('Kupa unreadable token storage invalidates readout without exposing storage errors', async (t) => {
  const f = fixture(t);
  await f.owner.queries.refreshStatus();
  f.ports.pairing.read = () => {
    throw Error('private token storage details');
  };
  // The scope reads through the adapter captured at construction.
  const broken = createKupaBankConnectionOwner(f.ports);
  try {
    const value = await broken.queries.refreshStatus();
    assert.equal(value.tokenConfigured, false);
    assert.equal(value.availabilityError, '');
    assert.deepEqual(f.events, []);
  } finally {
    broken.runtime.dispose();
    await broken.runtime.drain();
  }
});
test('Kupa typed-token credential bootstrap preserves whitespace and unknown version evidence', async (t) => {
  const f = fixture(t);
  f.token('');
  let payload;
  f.ports.transport.configure = async (input) => {
    payload = input;
    return { branchNumber: '0012', accountNumber: '0034' };
  };
  assert.equal(
    await f.owner.commands.configure({
      token: ' new ',
      userCode: ' user ',
      password: ' padded ',
      businessBranchNumber: '0012',
      businessAccountNumber: '0034',
    }),
    true
  );
  assert.equal(payload.password, ' padded ');
  assert.equal(payload.userCode, 'user');
  assert.equal(payload.token, 'new');
  assert.equal(payload.businessAccountNumber, '0034');
  assert.equal(f.owner.queries.snapshot().bridgeVersion, 0);
  assert.equal(f.owner.queries.snapshot().checked, false);
});
test('Kupa closed local owner retains accepted requests through idempotent drain', async (t) => {
  const f = fixture(t),
    held = gate();
  f.ports.transport.deleteCredentials = () => held.promise;
  const pending = f.owner.commands.deleteCredentials();
  assert.equal(f.owner.runtime.dispose(), true);
  assert.equal(f.owner.runtime.dispose(), false);
  assert.equal(f.owner.runtime.isPending(), true);
  let drained = false;
  const drain = f.owner.runtime.drain().then(() => {
    drained = true;
  });
  await Promise.resolve();
  assert.equal(drained, false);
  held.resolve({});
  assert.equal(await pending, false);
  await drain;
  assert.equal(f.owner.runtime.isPending(), false);
  assert.deepEqual(f.events, []);
  assert.equal(await f.owner.commands.configure({}), false);
});
for (const command of ['saveToken', 'configure'])
  test(`Kupa ${command} rejects token storage that becomes unreadable during synchronous acceptance`, async (t) => {
    const f = fixture(t);
    let blocked = false,
      reads = 0;
    f.ports.pairing.read = () => {
      if (blocked || (command === 'configure' && ++reads === 2))
        throw Error('private token storage failure');
      return 'A';
    };
    f.ports.pairing.write = () => {
      blocked = true;
    };
    f.ports.transport.configure = async () => assert.fail('unreadable pairing sent credentials');
    const owner = createKupaBankConnectionOwner(f.ports);
    t.after(async () => {
      owner.runtime.dispose();
      await owner.runtime.drain();
    });
    const pending =
      command === 'saveToken'
        ? owner.commands.saveToken('B')
        : owner.commands.configure({ userCode: 'user', password: 'pass' });
    assert.equal(await pending, false);
    assert.ok(!f.events.some((value) => value.includes('private token storage')));
  });
