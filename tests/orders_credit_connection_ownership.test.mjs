import test from 'node:test';
import assert from 'node:assert/strict';
import { createOrdersFinanceControllerFixture } from './orders_finance_controller_fixture.mjs';
import { createCreditConnectionView } from '../netunim-orders/site/assets/js/domains/finance/credit-connection-view.js';
import { createOrdersCreditConnectionOwner } from '../netunim-orders/site/assets/js/domains/finance/credit-connection-owner.js';

const gate = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const status = (id) => ({ bridgeVersion: 73, contractVersion: 2, profiles: [{ profileId: id }] });
function fixture() {
  let token = 'A';
  const events = [],
    held = gate(),
    entered = gate();
  const bridge = {
    getBridgeToken: () => token,
    creditStatus: async () => status('current'),
    creditDiagnostics: async () => ({ events: [] }),
    creditDataDiagnostics: async () => ({ available: true, data: {}, filename: 'current.json' }),
    saveCreditProfile: async () => {},
    deleteCreditProfile: async () => events.push('delete:' + token),
    resetCreditProfiles: async () => events.push('reset:' + token),
    bankAutoEnabled: () => false,
    creditAutoEnabled: () => false,
    creditAutoMode: () => 'smart',
  };
  const ports = {
    tab: { primaryTab: true },
    checksSession: { kupaCloudReadState: { creditSync: {}, notes: [{ id: 'retained' }] } },
    operationScope: { capture: () => () => {}, captureRead: () => () => {} },
    bridge,
    loadSession: () => null,
    toast: (message) => events.push('toast:' + message),
    effects: {
      isOnline: () => true,
      delay: async () => {},
      writeText: async (text) => events.push('copy:' + text),
      saveJson: () => events.push('download'),
    },
  };
  const controller = createOrdersFinanceControllerFixture(ports);
  return {
    controller,
    bridge,
    ports,
    events,
    held,
    entered,
    change: (value = 'B') => {
      token = value;
    },
  };
}
for (const failure of [false, true])
  test(`Orders held Credit status ${failure ? 'failure' : 'success'} cannot publish after pairing changes`, async () => {
    const f = fixture();
    f.bridge.creditStatus = () => {
      f.entered.resolve();
      return f.held.promise;
    };
    const pending = f.controller.refreshCreditBridgeStatus({ quiet: false });
    await f.entered.promise;
    f.change();
    f.held.resolve(
      failure ? Promise.reject(Error('private former-device details')) : status('former')
    );
    await pending;
    const view = f.controller.snapshot();
    assert.equal(view.creditStatus, null);
    assert.equal(view.creditBridgeError, '');
    assert.deepEqual(f.events, []);
  });
for (const command of ['copySafeCreditDiagnostics', 'exportCreditDataDiagnostics'])
  test(`Orders ${command} fences former-pairing effects`, async () => {
    const f = fixture(),
      method =
        command === 'copySafeCreditDiagnostics' ? 'creditDiagnostics' : 'creditDataDiagnostics';
    f.bridge[method] = () => {
      f.entered.resolve();
      return f.held.promise;
    };
    const pending = f.controller[command]();
    await f.entered.promise;
    f.change();
    f.held.resolve({
      events: [{ private: 'former' }],
      available: true,
      data: { private: 'former' },
    });
    assert.equal(await pending, false);
    assert.deepEqual(f.events, []);
  });
test('Orders status uses latest-started read and clears a replaced pairing', async () => {
  const f = fixture();
  f.bridge.creditStatus = () => f.held.promise;
  const pending = f.controller.refreshCreditBridgeStatus();
  f.bridge.creditStatus = async () => status('newer');
  await f.controller.refreshCreditBridgeStatus();
  f.held.resolve(status('older'));
  await pending;
  assert.equal(f.controller.snapshot().creditStatus.profiles[0].profileId, 'newer');
  f.change();
  assert.equal(f.controller.snapshot().creditStatus, null);
});

test('Orders observed A → B → A cannot revive accepted A status', async () => {
  const f = fixture();
  f.bridge.creditStatus = () => f.held.promise;
  const pending = f.controller.refreshCreditBridgeStatus();
  f.change();
  f.controller.snapshot();
  f.change('A');
  f.controller.snapshot();
  f.held.resolve(status('former'));
  assert.equal(await pending, null);
  assert.equal(f.controller.snapshot().creditStatus, null);
});
for (const failure of [false, true])
  test(`Orders disposal joins held diagnostic ${failure ? 'failure' : 'success'} and closes new work`, async () => {
    const f = fixture();
    f.bridge.creditDataDiagnostics = () => {
      f.entered.resolve();
      return f.held.promise;
    };
    const pending = f.controller.exportCreditDataDiagnostics();
    await f.entered.promise;
    assert.equal(f.controller.runtime.isPending(), true);
    assert.equal(f.controller.runtime.dispose(), true);
    assert.equal(f.controller.runtime.dispose(), false);
    let drained = false;
    const drain = f.controller.runtime.drain().then(() => {
      drained = true;
    });
    await Promise.resolve();
    assert.equal(drained, false);
    assert.equal(await f.controller.exportCreditDataDiagnostics(), false);
    f.held.resolve(
      failure
        ? Promise.reject(Error('former private failure'))
        : { available: true, data: { private: 'former' } }
    );
    assert.equal(await pending, false);
    await drain;
    assert.deepEqual(f.events, []);
    assert.equal(f.controller.runtime.isPending(), false);
  });
test('Orders view disposal drains an accepted confirmation and rejects its destructive continuation', async (t) => {
  const f = fixture(),
    ui = viewFixture(f, t),
    pending = ui.view.deleteCreditConnection('former');
  await f.entered.promise;
  ui.view.runtime.dispose();
  f.controller.runtime.dispose();
  let drained = false;
  const drain = ui.view.runtime.drain().then(() => {
    drained = true;
  });
  await Promise.resolve();
  assert.equal(drained, false);
  f.held.resolve(true);
  await pending;
  await drain;
  assert.deepEqual(f.events, []);
  assert.equal(ui.renders(), 0);
});
test('Orders reset authority is captured before confirmation, including the authenticated account', async (t) => {
  const f = fixture();
  let current = true;
  f.ports.operationScope.capture = () => () => {
    if (!current)
      throw Object.assign(Error('changed'), { code: 'FINANCE_OPERATION_SCOPE_CHANGED' });
  };
  const ui = viewFixture(f, t),
    pending = ui.view.resetCreditSync();
  await f.entered.promise;
  current = false;
  f.held.resolve(true);
  await pending;
  assert.deepEqual(f.events, []);
  assert.equal(ui.renders(), 0);
});
test('Orders stale form action cannot read the current form with an old profile identifier', async (t) => {
  const f = fixture(),
    ui = viewFixture(f, t);
  let saves = 0;
  f.bridge.saveCreditProfile = async () => {
    saves++;
  };
  ui.view.openCreditConnection();
  assert.equal(await ui.view.saveCreditConnection('former-profile'), false);
  assert.equal(saves, 0);
});
for (const [bridgeVersion, contractVersion] of [
  [72, 2],
  [73, 1],
  [73, 2],
  [74, 3],
])
  test(`Orders protocol ${bridgeVersion}/${contractVersion} retains diagnostic policy`, async () => {
    const f = fixture();
    let reads = 0;
    f.bridge.creditStatus = async () => ({ bridgeVersion, contractVersion, profiles: [] });
    f.bridge.creditDataDiagnostics = async () => {
      reads++;
      return { available: true, data: {} };
    };
    await f.controller.refreshCreditBridgeStatus();
    const supported = bridgeVersion >= 73 && contractVersion >= 2;
    assert.equal(await f.controller.exportCreditDataDiagnostics(), supported);
    assert.equal(reads, supported ? 1 : 0);
  });
test('Orders reset invalidates a status probe accepted before the vault reset completes', async () => {
  const held = gate();
  let calls = 0;
  const owner = createOrdersCreditConnectionOwner({
    pairing: { token: () => 'A' },
    transport: {
      readStatus: () => (++calls === 1 ? Promise.resolve(status('current')) : held.promise),
      readDiagnostics: async () => ({}),
      readData: async () => ({}),
      saveProfile: async () => {},
      deleteProfile: async () => {},
      resetProfiles: async () => {},
    },
    presentation: { toast: () => {} },
    effects: { writeText: async () => {}, saveJson: () => undefined },
    protocol: { minimumBridgeVersion: 73, contractVersion: 2 },
  });
  await owner.queries.refreshStatus();
  const pending = owner.queries.refreshStatus();
  await owner.commands.resetProfiles();
  held.resolve(status('removed'));
  await pending;
  assert.deepEqual(owner.queries.snapshot().status.profiles, []);
});
for (const command of ['saveCreditProfile', 'deleteCreditProfile'])
  test(`Orders ${command} cannot report success from a former pairing`, async () => {
    const f = fixture();
    f.bridge[command] = () => {
      f.entered.resolve();
      return f.held.promise;
    };
    const pending = f.controller[command]('former');
    await f.entered.promise;
    f.change();
    f.held.resolve();
    assert.equal(await pending, false);
    assert.deepEqual(f.events, []);
    assert.equal(f.controller.snapshot().creditBusy, false);
  });
function viewFixture(f, t) {
  let form,
    open = false,
    generation = 0,
    closes = 0,
    renders = 0;
  const fields = new Map();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      getElementById: (id) =>
        id === 'modalBackdrop'
          ? { classList: { contains: () => open } }
          : id === 'ordersCreditConnectionForm'
            ? form
            : fields.get(id),
      querySelector: () => null,
    },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else delete globalThis.document;
  });
  const view = createCreditConnectionView({
    controller: f.controller,
    modal: () => {
      open = true;
      form = {
        generation: ++generation,
        addEventListener: () => {},
        removeEventListener: () => {},
      };
      for (const id of [
        'Provider',
        'Label',
        'Owner',
        'Account',
        'Username',
        'Id',
        'Card6',
        'Password',
      ])
        fields.set('ordersCc' + id, {
          value: id === 'Provider' ? 'max' : '',
          addEventListener: () => {},
          removeEventListener: () => {},
        });
    },
    closeModal: () => {
      open = false;
      closes++;
      form = null;
    },
    render: () => {
      renders++;
    },
    confirmDialog: () => {
      f.entered.resolve();
      return f.held.promise;
    },
  });
  return {
    view,
    form: () => form,
    closes: () => closes,
    renders: () => renders,
    cancel: () => {
      open = false;
    },
  };
}
for (const command of ['deleteCreditConnection', 'resetCreditSync'])
  test(`Orders ${command} confirmation cannot authorize the replacement pairing`, async (t) => {
    const f = fixture(),
      ui = viewFixture(f, t);
    const pending = ui.view[command]('former');
    await f.entered.promise;
    f.change();
    f.held.resolve(true);
    await pending;
    assert.deepEqual(f.events, []);
    assert.equal(ui.renders(), 0);
  });
test('Orders accepted save does not close a newer connection form', async (t) => {
  const f = fixture(),
    ui = viewFixture(f, t);
  f.bridge.saveCreditProfile = () => {
    f.entered.resolve();
    return f.held.promise;
  };
  ui.view.openCreditConnection();
  const pending = ui.view.saveCreditConnection();
  await f.entered.promise;
  ui.view.openCreditConnection();
  const replacement = ui.form();
  f.held.resolve();
  await pending;
  assert.equal(ui.form(), replacement);
  assert.equal(ui.closes(), 0);
  assert.equal(ui.renders(), 0);
});

test('Orders unavailable Finance reset authority reports once without opening a confirmation', async (t) => {
  const f = fixture();
  f.ports.operationScope.capture = () => {
    throw Error('Finance authority unavailable');
  };
  const ui = viewFixture(f, t);
  assert.equal(await ui.view.resetCreditSync(), false);
  assert.deepEqual(f.events, ['toast:Finance authority unavailable']);
  assert.equal(ui.view.runtime.isPending(), false);
});

test('Orders cancelled connection form cannot submit a retained action while its DOM remains', async (t) => {
  const f = fixture(),
    ui = viewFixture(f, t);
  let writes = 0;
  f.bridge.saveCreditProfile = async () => {
    writes++;
  };
  ui.view.openCreditConnection();
  ui.cancel();
  assert.equal(await ui.view.saveCreditConnection(), false);
  assert.equal(writes, 0);
});
test('Orders accepted save cannot repaint a cancelled form whose DOM remains', async (t) => {
  const f = fixture(),
    ui = viewFixture(f, t);
  f.bridge.saveCreditProfile = () => {
    f.entered.resolve();
    return f.held.promise;
  };
  ui.view.openCreditConnection();
  const pending = ui.view.saveCreditConnection();
  await f.entered.promise;
  ui.cancel();
  f.held.resolve();
  assert.equal(await pending, false);
  assert.equal(ui.closes(), 0);
  assert.equal(ui.renders(), 0);
});

test('Orders form opened under a former pairing cannot submit credentials to its replacement', async (t) => {
  const f = fixture(),
    ui = viewFixture(f, t);
  let writes = 0;
  f.bridge.saveCreditProfile = async () => {
    writes++;
  };
  ui.view.openCreditConnection();
  f.change();
  assert.equal(await ui.view.saveCreditConnection(), false);
  assert.equal(writes, 0);
});

test('Orders unreadable pairing storage preserves readout availability and fences former-device details', async () => {
  const f = fixture(),
    reader = f.bridge.getBridgeToken;
  f.bridge.creditStatus = () => f.held.promise;
  const pending = f.controller.refreshCreditBridgeStatus({ quiet: false });
  f.bridge.getBridgeToken = () => {
    throw Object.assign(Error('private preference detail'), { name: 'SecurityError' });
  };
  const blocked = f.controller.snapshot();
  assert.equal(blocked.creditStatus, null);
  assert.equal(blocked.creditBridgeError, '');
  assert.equal(blocked.bridgeTokenConfigured, false);
  assert.equal(await f.controller.copySafeCreditDiagnostics(), false);
  f.bridge.getBridgeToken = reader;
  f.controller.snapshot();
  f.held.resolve(status('former'));
  assert.equal(await pending, null);
  assert.deepEqual(f.events, []);
  assert.equal(f.controller.snapshot().creditStatus, null);
});
