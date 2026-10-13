import test from 'node:test';
import assert from 'node:assert/strict';
import { createKupaCreditRuntime } from '../netunim-kupa/site/assets/js/composition/credit.js';

const gate = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const status = (id) => ({
  bridgeVersion: 73,
  contractVersion: 2,
  profiles: [{ profileId: id, ownerLabel: id }],
});
function fixture() {
  let token = 'A';
  const events = [],
    held = gate(),
    entered = gate(),
    model = { state: { creditSync: { profiles: [] } } };
  const bridge = {
    getBridgeToken: () => token,
    creditStatus: async () => status('current'),
    creditDiagnostics: async () => ({ events: [] }),
    creditDataDiagnostics: async () => ({ available: true, data: {}, filename: 'current.json' }),
    saveCreditProfile: async () => {},
    deleteCreditProfile: async () => events.push('delete:' + token),
  };
  const cap = createKupaCreditRuntime({
    model,
    ui: {},
    platform: {
      effects: {
        writeText: async (text) => events.push('copy:' + text),
        saveJson: () => events.push('download'),
        dispose: () => {},
      },
      preferences: {
        read: () => ({ ok: true, value: { enabled: false, mode: 'smart', attemptAt: 0 } }),
        setEnabled: () => {},
        setMode: () => {},
        markAttempt: () => {},
        reset: () => {},
      },
    },
  });
  const ports = {
    bridge,
    authority: { scope: { capture: () => () => {} }, automaticAccess: () => null },
    cloud: {
      refresh: async () => ({ verified: true, state: model.state }),
      commit: async () => ({ saved: false }),
      claimLease: async () => ({ acquired: false }),
      releaseLease: async () => true,
    },
    persistence: { save: async () => true },
    presentation: {
      toast: (message) => events.push('toast:' + message),
      render: () => events.push('render'),
      renderStatus: () => {},
      closeModal: () => events.push('close'),
      confirmDialog: async () => true,
    },
  };
  return {
    cap,
    bridge,
    ports,
    events,
    held,
    entered,
    model,
    change: () => {
      token = 'B';
    },
    bind: () => cap.bindServices(ports),
  };
}

for (const failure of [false, true])
  test(`Credit status ${failure ? 'rejection' : 'completion'} after pairing change cannot publish former-device details`, async () => {
    const f = fixture();
    f.bridge.creditStatus = () => {
      f.entered.resolve();
      return f.held.promise;
    };
    f.bind();
    const pending = f.cap.queries.refreshStatus({ quiet: false });
    await f.entered.promise;
    f.change();
    f.held.resolve(
      failure
        ? Promise.reject(Error('private former-device details'))
        : status('former-private-profile')
    );
    await pending;
    const ui = f.cap.queries.uiState();
    assert.equal(ui.status, null);
    assert.equal(ui.bridgeError, '');
    assert.deepEqual(f.events, []);
    f.cap.runtime.dispose();
  });

for (const command of ['copySafeCreditDiagnostics', 'exportCreditDataDiagnostics'])
  test(`Credit ${command} cannot export a held former-pairing result`, async () => {
    const f = fixture(),
      method =
        command === 'copySafeCreditDiagnostics' ? 'creditDiagnostics' : 'creditDataDiagnostics';
    f.bridge[method] = () => {
      f.entered.resolve();
      return f.held.promise;
    };
    f.bind();
    const pending = f.cap.commands[command]();
    await f.entered.promise;
    f.change();
    f.held.resolve({
      events: [{ private: 'former' }],
      available: true,
      data: { private: 'former' },
      filename: 'former.json',
    });
    assert.equal(await pending, false);
    assert.deepEqual(f.events, []);
    f.cap.runtime.dispose();
  });

test('Credit deletion confirmation cannot send a destructive request through a replacement pairing', async () => {
  const f = fixture();
  f.ports.presentation.confirmDialog = () => {
    f.entered.resolve();
    return f.held.promise;
  };
  f.bind();
  const pending = f.cap.commands.deleteCreditConnection('former');
  await f.entered.promise;
  f.change();
  f.held.resolve(true);
  await pending;
  assert.deepEqual(f.events, []);
  f.cap.runtime.dispose();
});

test('Credit save accepted by the former pairing cannot close or repaint the replacement UI', async () => {
  const f = fixture();
  f.bridge.saveCreditProfile = () => {
    f.entered.resolve();
    return f.held.promise;
  };
  f.bind();
  const pending = f.cap.commands.saveCreditConnection({ profileId: 'former' });
  await f.entered.promise;
  f.change();
  f.held.resolve();
  assert.equal(await pending, false);
  assert.deepEqual(f.events, []);
  f.cap.runtime.dispose();
});

test('Credit command acceptance captures pairing before another microtask can replace it', async () => {
  const f = fixture();
  f.bridge.saveCreditProfile = async () => {
    f.events.push('write:' + f.bridge.getBridgeToken());
  };
  f.bind();
  const pending = f.cap.commands.saveCreditConnection({ profileId: 'accepted' });
  f.change();
  await pending;
  assert.deepEqual(f.events, ['write:A']);
  f.cap.runtime.dispose();
});

test('older parallel Credit status cannot replace the latest completed observation', async () => {
  const f = fixture();
  let reads = 0;
  f.bridge.creditStatus = async () => (++reads === 1 ? f.held.promise : status('latest'));
  f.bind();
  const older = f.cap.queries.refreshStatus();
  await f.cap.queries.refreshStatus();
  f.held.resolve(status('older'));
  await older;
  assert.equal(f.cap.queries.uiState().status.profiles[0].profileId, 'latest');
  f.cap.runtime.dispose();
});

test('pairing handoff invalidates cached local profiles while retaining current cloud profile fallback', async () => {
  const f = fixture();
  f.model.state.creditSync.profiles = [{ profileId: 'cloud', provider: 'max', accounts: [] }];
  f.bind();
  await f.cap.queries.refreshStatus();
  assert.equal(f.cap.queries.uiState().status.profiles[0].profileId, 'current');
  f.change();
  assert.equal(f.cap.queries.uiState().status, null);
  f.cap.runtime.dispose();
});

test('accepted clipboard write is drained after pairing handoff without a late notification', async () => {
  const f = fixture();
  f.ports.presentation.toast = (message) => f.events.push('toast:' + message);
  // The effect has already been accepted; ownership prevents later presentation.
  const effects = {
    writeText: () => {
      f.entered.resolve();
      return f.held.promise;
    },
    saveJson: () => {},
    dispose: () => {},
  };
  const { createCreditConnectionOwner } = await import(
    '../netunim-kupa/site/assets/js/domains/credit/connection-owner.js'
  );
  const api = createCreditConnectionOwner({
    protocol: { minimumBridgeVersion: 73, contractVersion: 2 },
    pairing: { token: f.bridge.getBridgeToken },
    transport: {
      readStatus: f.bridge.creditStatus,
      readDiagnostics: f.bridge.creditDiagnostics,
      readData: f.bridge.creditDataDiagnostics,
      saveProfile: f.bridge.saveCreditProfile,
      deleteProfile: f.bridge.deleteCreditProfile,
    },
    presentation: f.ports.presentation,
    effects,
    profiles: { read: () => [] },
  });
  const pending = api.commands.copyDiagnostics();
  await f.entered.promise;
  f.change();
  let drained = false;
  const drain = api.runtime.drain().then(() => {
    drained = true;
  });
  await Promise.resolve();
  assert.equal(drained, false);
  f.held.resolve();
  assert.equal(await pending, false);
  await drain;
  assert.deepEqual(f.events, []);
  api.runtime.dispose();
});

test('Credit provider result from a former pairing cannot be committed under current Finance authority', async () => {
  const f = fixture();
  f.ports.cloud.claimLease = async (leaseName, leaseToken) => ({
    acquired: true,
    leaseName,
    leaseToken,
    fenceEpoch: 1,
  });
  f.ports.cloud.commit = async () => {
    f.events.push('cloud write');
    return { saved: false };
  };
  f.bridge.syncCreditCards = () => {
    f.entered.resolve();
    return f.held.promise;
  };
  f.bind();
  const pending = f.cap.commands.refreshCreditSync();
  await f.entered.promise;
  f.change();
  f.held.resolve({
    attemptedCount: 1,
    profiles: [{ profileId: 'former', provider: 'max', accounts: [] }],
    errors: [],
  });
  await pending;
  assert.ok(!f.events.includes('cloud write'));
  f.cap.runtime.dispose();
});

test('Credit full-reset confirmation cannot reset profiles through replacement pairing', async () => {
  const f = fixture();
  f.ports.presentation.confirmDialog = () => {
    f.entered.resolve();
    return f.held.promise;
  };
  f.bridge.resetCreditProfiles = async () => f.events.push('reset:' + f.bridge.getBridgeToken());
  f.bind();
  const pending = f.cap.commands.resetCreditSync();
  await f.entered.promise;
  f.change();
  f.held.resolve(true);
  await pending;
  assert.ok(!f.events.some((value) => value.startsWith('reset:')));
  f.cap.runtime.dispose();
});
