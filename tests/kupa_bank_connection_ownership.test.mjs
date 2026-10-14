import test from 'node:test';
import assert from 'node:assert/strict';
import { createKupaBankControllerFixture } from './kupa_bank_controller_fixture.mjs';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixture(t) {
  let token = 'device-A';
  const notices = [],
    downloads = [],
    calls = [];
  const bridge = {
    getBridgeToken: () => token,
    setBridgeToken: (value) => {
      token = value;
    },
    autoEnabled: () => false,
    status: async () => ({ bridgeVersion: 74, configured: true }),
    configureCredentials: async (payload) => {
      calls.push(['configure', payload]);
      return {};
    },
    selectAccount: async (payload) => {
      calls.push(['select', payload]);
      return {};
    },
    deleteCredentials: async () => {
      calls.push(['delete']);
      return {};
    },
    bankDiagnostics: async () => ({ available: true, data: { private: 'device-A' } }),
  };
  const api = createKupaBankControllerFixture({
    model: { state: { bank: {}, checks: [] } },
    session: {},
    bridge,
    autoScope: () => null,
    operationScope: { capture: () => () => {}, captureRead: () => () => {} },
    sharedChecksObservedSequence: () => 0,
    saveState: async () => true,
    toast: (value) => notices.push(value),
    render: () => {},
    effects: {
      saveJson: (...args) => {
        downloads.push(args);
      },
    },
  });
  t.after(async () => {
    api.runtime.dispose();
    await api.runtime.drain();
  });
  return {
    api,
    bridge,
    notices,
    downloads,
    calls,
    change: (value) => {
      token = value;
    },
  };
}
for (const failed of [false, true])
  test(`Kupa former-device status ${failed ? 'failure' : 'success'} cannot publish`, async (t) => {
    const f = fixture(t),
      gate = deferred();
    f.bridge.status = () => gate.promise;
    const pending = f.api.refreshBankBridgeStatus();
    f.change('device-B');
    f.api.bankBridgeUiState();
    if (failed) gate.reject(Error('private device-A failure'));
    else gate.resolve({ bridgeVersion: 74, configured: true, accountNumber: 'private-A' });
    await pending;
    const readout = f.api.bankBridgeUiState();
    assert.equal(readout.checked, false);
    assert.equal(readout.accountNumber, '');
    assert.equal(readout.availabilityError, '');
    assert.deepEqual(f.notices, []);
  });
test('Kupa diagnostics received after a pairing change cannot download', async (t) => {
  const f = fixture(t),
    gate = deferred();
  f.bridge.bankDiagnostics = () => gate.promise;
  const pending = f.api.exportBankChequeDiagnostics();
  f.change('device-B');
  gate.resolve({ available: true, data: { private: 'device-A' } });
  assert.equal(await pending, false);
  assert.deepEqual(f.downloads, []);
  assert.deepEqual(f.notices, []);
});
for (const command of ['configure', 'select', 'delete'])
  test(`Kupa late ${command} cannot publish to another device`, async (t) => {
    const f = fixture(t),
      gate = deferred();
    let pending;
    if (command === 'configure') {
      f.bridge.configureCredentials = () => gate.promise;
      pending = f.api.configureBankBridge({ userCode: 'user', password: ' pass ' });
    } else if (command === 'select') {
      f.bridge.selectAccount = () => gate.promise;
      pending = f.api.selectBankBridgeAccount('business', '123', '456');
    } else {
      f.bridge.deleteCredentials = () => gate.promise;
      pending = f.api.deleteBankBridgeCredentials();
    }
    f.change('device-B');
    gate.resolve({ branchNumber: 'private-A', accountNumber: 'private-A' });
    await pending;
    assert.equal(f.api.bankBridgeUiState().configured, false);
    assert.equal(f.api.bankBridgeUiState().accountNumber, '');
    assert.deepEqual(f.notices, []);
  });
test('Kupa credential acknowledgement cannot invent the minimum Bridge version', async (t) => {
  const f = fixture(t);
  f.bridge.status = async () => ({ bridgeVersion: 73, configured: false });
  await f.api.refreshBankBridgeStatus();
  await f.api.configureBankBridge({ userCode: 'user', password: ' pass ' });
  assert.equal(f.api.bankBridgeUiState().bridgeVersion, 73);
  assert.equal(f.api.bankBridgeUiState().upgradeRequired, true);
  assert.equal(f.calls[0][1].password, ' pass ');
});
test('Kupa vault mutations have one in-flight owner', async (t) => {
  const f = fixture(t),
    gate = deferred();
  f.bridge.configureCredentials = () => gate.promise;
  const pending = f.api.configureBankBridge({ userCode: 'user', password: 'pass' });
  try {
    await f.api.deleteBankBridgeCredentials();
    assert.deepEqual(f.calls, [], 'delete cannot overlap accepted configure');
  } finally {
    gate.resolve({});
    await pending;
  }
});
