import test from 'node:test';
import assert from 'node:assert/strict';
import { createOrdersFinanceControllerFixture } from './orders_finance_controller_fixture.mjs';
import { createOrdersBankConnectionOwner } from '../netunim-orders/site/assets/js/domains/finance/bank-connection-owner.js';
import { createBankConnectionCommands } from '../netunim-orders/site/assets/js/domains/finance/bank-connection-commands.js';
const gate = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
function fixture() {
  let token = 'A';
  const events = [],
    held = gate(),
    entered = gate();
  const bridge = {
    getBridgeToken: () => token,
    bankAutoEnabled: () => false,
    creditAutoEnabled: () => false,
    creditAutoMode: () => 'smart',
    status: async () => ({ bridgeVersion: 74, configured: true }),
    configureCredentials: async () => ({ configured: true }),
    selectAccount: async () => ({ configured: true }),
    deleteCredentials: async () => {},
    bankDiagnostics: async () => ({ available: true, data: {}, filename: 'current.json' }),
  };
  const ports = {
    tab: { primaryTab: true },
    checksSession: { kupaCloudReadState: { notes: [{ id: 'retained' }] } },
    operationScope: { capture: () => () => {}, captureRead: () => () => {} },
    bridge,
    loadSession: () => null,
    toast: (message) => events.push('toast:' + message),
    effects: {
      isOnline: () => true,
      delay: async () => {},
      writeText: async () => {},
      saveJson: () => events.push('download'),
    },
  };
  const controller = createOrdersFinanceControllerFixture(ports);
  return {
    controller,
    bridge,
    events,
    ports,
    held,
    entered,
    change: () => {
      token = 'B';
    },
  };
}
for (const failure of [false, true])
  test(`held Bank status ${failure ? 'error' : 'success'} cannot publish after pairing replacement`, async () => {
    const f = fixture();
    f.bridge.status = () => {
      f.entered.resolve();
      return f.held.promise;
    };
    const pending = f.controller.refreshBankBridgeStatus({ quiet: false });
    await f.entered.promise;
    f.change();
    f.held.resolve(
      failure
        ? Promise.reject(Error('private former device'))
        : { bridgeVersion: 74, configured: true, private: 'former' }
    );
    await pending;
    assert.equal(f.controller.snapshot().bankStatus, null);
    assert.equal(f.controller.snapshot().bankBridgeError, '');
    assert.deepEqual(f.events, []);
  });
test('held Bank diagnostic cannot download former-pairing information', async () => {
  const f = fixture();
  f.bridge.bankDiagnostics = () => {
    f.entered.resolve();
    return f.held.promise;
  };
  const pending = f.controller.exportBankChequeDiagnostics();
  await f.entered.promise;
  f.change();
  f.held.resolve({ available: true, data: { private: 'former' }, filename: 'former.json' });
  assert.equal(await pending, false);
  assert.deepEqual(f.events, []);
});

function ownerFixture() {
  let token = 'A',
    blocked = false;
  const events = [],
    requests = [];
  const ports = {
    pairing: {
      token: () => {
        if (blocked) throw Error('private storage failure');
        return token;
      },
    },
    transport: {
      readStatus: async () => ({ bridgeVersion: 74, configured: true }),
      configure: async (payload) => {
        requests.push(payload);
        return { configured: true };
      },
      selectAccount: async (payload) => {
        requests.push(payload);
        return { configured: true };
      },
      deleteCredentials: async () => {
        requests.push('delete');
      },
      readDiagnostics: async () => ({ available: true, data: {}, filename: 'fixture.json' }),
    },
    presentation: { toast: (message) => events.push(message) },
    effects: { saveJson: () => events.push('download') },
    protocol: { minimumBridgeVersion: 74 },
  };
  const owner = createOrdersBankConnectionOwner(ports);
  return {
    owner,
    ports,
    events,
    requests,
    change: (value) => {
      token = value;
    },
    block: (value) => {
      blocked = value;
    },
  };
}
test('superseded Bank probe cannot notify an older failure after a newer success', async () => {
  const f = ownerFixture(),
    held = gate();
  let count = 0;
  f.ports.transport.readStatus = () =>
    ++count === 1 ? held.promise : Promise.resolve({ bridgeVersion: 74, current: true });
  const previous = f.owner.queries.refreshStatus({ quiet: false });
  await f.owner.queries.refreshStatus();
  held.resolve(Promise.reject(Error('superseded failure')));
  await previous;
  assert.equal(f.owner.queries.snapshot().status.current, true);
  assert.deepEqual(f.events, []);
});
test('a Bank write preserves unknown status evidence until a real probe and missing pairing cannot enter selection', async () => {
  const f = ownerFixture();
  await f.owner.commands.configure({});
  assert.equal(f.owner.queries.snapshot().checked, false);
  assert.equal(f.owner.queries.snapshot().status.bridgeVersion, undefined);
  const c = fixture();
  c.change();
  c.bridge.getBridgeToken = () => '';
  const view = createBankConnectionCommands({
    controller: c.controller,
    confirmDialog: async () => true,
    render: () => {},
    isActive: () => true,
  });
  assert.equal(await view.selectBankAccount('home', '1', '2'), false);
  assert.deepEqual(c.events, []);
});
test('Bank status construction is inert, passive pairing is checked and storage failure is sanitized', async () => {
  const f = ownerFixture();
  let reads = 0;
  f.ports.transport.readStatus = async () => {
    reads++;
    return { bridgeVersion: 74 };
  };
  assert.equal(reads, 0);
  f.change('');
  assert.equal(await f.owner.queries.refreshStatus(), null);
  assert.equal(reads, 0);
  assert.equal(f.owner.queries.snapshot().checked, true);
  f.change('A');
  assert.equal(f.owner.queries.snapshot().checked, false);
  await f.owner.queries.refreshStatus();
  assert.equal(reads, 1);
  f.block(true);
  assert.deepEqual(f.owner.queries.snapshot(), { status: null, checked: false, bridgeError: '' });
  assert.equal(await f.owner.queries.refreshStatus({ quiet: false }), null);
  assert.equal(reads, 1);
  assert.deepEqual(f.events, []);
});
test('latest Bank status and successful vault command supersede older probes', async () => {
  const f = ownerFixture(),
    old = gate();
  let calls = 0;
  f.ports.transport.readStatus = () =>
    ++calls === 1 ? old.promise : Promise.resolve({ bridgeVersion: 74, current: true });
  const first = f.owner.queries.refreshStatus();
  await f.owner.queries.refreshStatus();
  old.resolve({ bridgeVersion: 72, former: true });
  await first;
  assert.equal(f.owner.queries.snapshot().status.current, true);
  const held = gate();
  f.ports.transport.readStatus = () => held.promise;
  const probe = f.owner.queries.refreshStatus();
  await f.owner.commands.deleteCredentials();
  held.resolve({ bridgeVersion: 74, configured: true });
  await probe;
  assert.equal(f.owner.queries.snapshot().status.configured, false);
});
test('Bank credential and selection payloads preserve whitespace, leading zeroes and wire fields', async () => {
  const f = ownerFixture();
  await f.owner.commands.configure({
    userCode: ' user ',
    password: ' p ',
    businessBranchNumber: '00-12',
    businessAccountNumber: '00 45',
    homeBranchNumber: '0006',
    homeAccountNumber: '0078',
  });
  assert.deepEqual(f.requests[0], {
    userCode: 'user',
    password: ' p ',
    businessBranchNumber: '0012',
    businessAccountNumber: '0045',
    homeBranchNumber: '0006',
    homeAccountNumber: '0078',
  });
  assert.equal(f.owner.queries.snapshot().status.bridgeVersion, undefined);
  await f.owner.queries.refreshStatus();
  await f.owner.commands.configure({ password: ' new ' });
  assert.equal(f.owner.queries.snapshot().status.bridgeVersion, 74);
  await f.owner.commands.selectAccount('home', '00-12', '0034');
  await f.owner.commands.selectAccount('unknown', '0001', '0002');
  assert.deepEqual(f.requests.slice(-2), [
    { role: 'home', branchNumber: '0012', accountNumber: '0034' },
    { role: 'business', branchNumber: '0001', accountNumber: '0002' },
  ]);
});
test('Bank direct read rejects former device error and observed A to B to A work', async () => {
  const f = ownerFixture(),
    held = gate();
  f.ports.transport.readStatus = () => held.promise;
  const pending = f.owner.queries.readStatus();
  f.change('B');
  f.owner.queries.snapshot();
  f.change('A');
  held.resolve(Promise.reject(Error('private former device')));
  await assert.rejects(
    pending,
    (error) => error.code === 'BRIDGE_PAIRING_SCOPE_CHANGED' && !error.message.includes('private')
  );
  assert.equal(f.owner.queries.snapshot().status, null);
});
for (const method of ['configure', 'deleteCredentials', 'readDiagnostics'])
  test(`Bank disposal drains accepted ${method} and suppresses completion effects`, async () => {
    const f = ownerFixture(),
      held = gate();
    f.ports.transport[method] = () => held.promise;
    const pending =
      method === 'readDiagnostics'
        ? f.owner.commands.exportDiagnostics()
        : method === 'configure'
          ? f.owner.commands.configure({})
          : f.owner.commands.deleteCredentials();
    assert.equal(f.owner.runtime.isPending(), true);
    assert.equal(f.owner.runtime.dispose(), true);
    assert.equal(f.owner.runtime.dispose(), false);
    let done = false;
    const drain = f.owner.runtime.drain().then(() => {
      done = true;
    });
    await Promise.resolve();
    assert.equal(done, false);
    held.resolve({ available: true, data: {}, configured: true });
    await pending;
    await drain;
    assert.deepEqual(f.events, []);
    assert.equal(f.owner.runtime.isPending(), false);
    assert.deepEqual(f.owner.queries.snapshot(), { status: null, checked: false, bridgeError: '' });
    assert.deepEqual(await f.owner.commands.configure({}), { ok: false });
  });
test('Bank vault owner serializes writes and preserves a confirmed delete against a probe started during the write', async () => {
  const f = ownerFixture(),
    write = gate(),
    probe = gate();
  f.ports.transport.deleteCredentials = () => write.promise;
  const pending = f.owner.commands.deleteCredentials();
  assert.deepEqual(await f.owner.commands.configure({}), { ok: false });
  assert.deepEqual(f.requests, []);
  f.ports.transport.readStatus = () => probe.promise;
  const stale = f.owner.queries.refreshStatus();
  write.resolve();
  await pending;
  probe.resolve({ bridgeVersion: 74, configured: true });
  await stale;
  assert.equal(f.owner.queries.snapshot().status.configured, false);
});
for (const transition of ['pairing', 'dispose', 'cancel'])
  test(`Bank confirmation is accepted and fenced after ${transition}`, async () => {
    const f = fixture(),
      confirm = gate();
    let renders = 0;
    const view = createBankConnectionCommands({
      controller: f.controller,
      confirmDialog: () => confirm.promise,
      render: () => renders++,
      isActive: () => true,
    });
    let deletes = 0;
    f.bridge.deleteCredentials = async () => {
      deletes++;
    };
    const pending = view.deleteBankCredentials();
    assert.equal(view.runtime.isPending(), true);
    if (transition === 'pairing') f.change();
    if (transition === 'dispose') view.runtime.dispose();
    let done = false;
    const drain = view.runtime.drain().then(() => {
      done = true;
    });
    await Promise.resolve();
    assert.equal(done, false);
    confirm.resolve(transition !== 'cancel');
    assert.equal(await pending, false);
    await drain;
    assert.equal(deletes, 0);
    assert.equal(renders, 0);
  });
test('Bank credentials form captures pairing and releases its submit listener on replacement and disposal', async (t) => {
  const f = fixture(),
    fields = { ordersBankUserCode: ' user ', ordersBankPassword: ' p ' };
  let attached = 0,
    released = 0;
  const form = {
    addEventListener: () => attached++,
    removeEventListener: () => released++,
    querySelector: (selector) => ({ value: fields[selector.slice(1)] || '' }),
  };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { getElementById: () => form },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else delete globalThis.document;
  });
  const view = createBankConnectionCommands({
    controller: f.controller,
    confirmDialog: async () => true,
    render: () => {},
    isActive: () => true,
  });
  view.bind();
  f.change();
  assert.equal(await view.configureBank(), false);
  assert.deepEqual(f.events, []);
  view.bind();
  assert.equal(attached, 2);
  assert.equal(released, 1);
  view.runtime.dispose();
  view.runtime.dispose();
  assert.equal(released, 2);
});
for (const [command, transport, args] of [
  ['configureBankBridge', 'configureCredentials', [{ userCode: 'x', password: ' p ' }]],
  ['selectBankBridgeAccount', 'selectAccount', ['business', '1', '2']],
  ['deleteBankBridgeCredentials', 'deleteCredentials', []],
])
  test(`${command} cannot publish after pairing replacement`, async () => {
    const f = fixture();
    f.bridge[transport] = () => {
      f.entered.resolve();
      return f.held.promise;
    };
    const pending = f.controller[command](...args);
    await f.entered.promise;
    f.change();
    f.held.resolve({ configured: true, private: 'former' });
    assert.equal(await pending, false);
    assert.equal(f.controller.snapshot().bankStatus, null);
    assert.deepEqual(f.events, []);
  });
test('successful credential write cannot certify an unobserved Bridge version', async () => {
  const f = fixture();
  await f.controller.configureBankBridge({ userCode: 'x', password: 'p' });
  assert.notEqual(f.controller.snapshot().bankStatus?.bridgeVersion, 74);
});
