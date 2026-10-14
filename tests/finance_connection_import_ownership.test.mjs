import test from 'node:test';
import assert from 'node:assert/strict';
import { createFinanceConnectionImportCapability } from '../shared/finance-connection-import-capability.js';
import { createFinanceConnectionFileSelection } from '../shared/finance-connection-file-selection.js';
import {
  parseFinanceConnectionImportText,
  FINANCE_CONNECTION_IMPORT_MAX_BYTES,
} from '../shared/finance-connection-import.js';
const gate = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const documentValue = () => ({
  schema: 'netunim-finance-connections',
  version: 1,
  mode: 'replace',
  bank: {},
  credit: {
    profiles: [
      { provider: 'max', connectionKey: 'portable', credentials: { password: ' padded ' } },
    ],
  },
});
function fixture(t, { phase = null, version = 74, clickFailure = false } = {}) {
  let token = 'A';
  const counts = { status: 0, confirm: 0, import: 0, after: 0, inputs: 0 },
    notices = [],
    nodes = new Set(),
    entered = gate(),
    held = gate();
  const wait = async (name) => {
    if (phase === name) {
      entered.resolve();
      await held.promise;
    }
  };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement: () => {
        counts.inputs++;
        const input = new EventTarget();
        input.files = [
          {
            size: 1,
            text: async () => {
              await wait('file');
              return JSON.stringify(documentValue());
            },
          },
        ];
        input.remove = () => nodes.delete(input);
        input.click = () => {
          if (clickFailure) throw Error('native chooser click failed');
          queueMicrotask(() => input.dispatchEvent(new Event('change')));
        };
        return input;
      },
      body: { appendChild: (node) => nodes.add(node) },
    },
  });
  t.after(() => {
    held.resolve();
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else delete globalThis.document;
  });
  const bridge = {
    getBridgeToken: () => token,
    status: async () => {
      counts.status++;
      await wait('status');
      return { bridgeVersion: version };
    },
    importConnectionSettings: async () => {
      counts.import++;
      await wait('import');
      return { cleanupWarnings: [] };
    },
  };
  const ports = {
    bridge,
    getCreditProfiles: () => [],
    confirmDialog: async () => {
      counts.confirm++;
      await wait('confirm');
      return true;
    },
    toast: (value) => notices.push(value),
    afterImport: async () => {
      counts.after++;
      await wait('after');
    },
  };
  const capability = createFinanceConnectionImportCapability(ports);
  t.after(async () => {
    capability.runtime.dispose();
    await capability.runtime.drain();
  });
  return {
    run: capability.commands.importConnections,
    runtime: capability.runtime,
    ports,
    counts,
    notices,
    nodes,
    entered,
    held,
    change: (value) => {
      token = value;
    },
  };
}
for (const phase of ['status', 'file', 'confirm'])
  test(`import accepted on A cannot target B after ${phase}`, async (t) => {
    const f = fixture(t, { phase }),
      pending = f.run();
    await f.entered.promise;
    f.change('B');
    f.held.resolve();
    await pending;
    assert.equal(f.counts.import, 0, 'credentials were sent to a replacement Bridge');
    assert.equal(f.counts.after, 0);
    assert.deepEqual(f.notices, []);
  });
for (const phase of ['import', 'after'])
  test(`late import ${phase} cannot publish success to B`, async (t) => {
    const f = fixture(t, { phase }),
      pending = f.run();
    await f.entered.promise;
    f.change('B');
    f.held.resolve();
    await pending;
    if (phase === 'import') assert.equal(f.counts.after, 0);
    assert.deepEqual(f.notices, []);
  });
test('late former-device import error cannot leak', async (t) => {
  const f = fixture(t, { phase: 'confirm' });
  f.ports.bridge.importConnectionSettings = async () => {
    f.change('B');
    throw Error('private former-device vault details');
  };
  const pending = f.run();
  await f.entered.promise;
  f.held.resolve();
  await pending;
  assert.deepEqual(f.notices, []);
});
test('one import owner serializes selection and confirmation', async (t) => {
  const f = fixture(t, { phase: 'confirm' }),
    pending = f.run();
  await f.entered.promise;
  const sibling = f.run();
  try {
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(
      f.counts.status,
      1,
      'second import started during accepted selection/confirmation'
    );
  } finally {
    f.held.resolve();
    await pending;
    await sibling;
  }
});
test('unknown Bridge version cannot grant import authority', async (t) => {
  const f = fixture(t, { version: 'unknown' });
  await f.run();
  assert.equal(f.counts.import, 0);
  assert.equal(f.counts.inputs, 0);
});
test('a coercible array cannot stand in for a Bridge version', async (t) => {
  const f = fixture(t, { version: [74] });
  await f.run();
  assert.equal(f.counts.import, 0);
  assert.equal(f.counts.inputs, 0);
});
test('native chooser click failure releases the appended input', async (t) => {
  const f = fixture(t, { clickFailure: true }),
    selection = createFinanceConnectionFileSelection({
      decode: parseFinanceConnectionImportText,
      maxBytes: FINANCE_CONNECTION_IMPORT_MAX_BYTES,
    });
  t.after(() => selection.runtime.dispose());
  await assert.rejects(selection.choose(), /native chooser click failed/);
  assert.equal(f.nodes.size, 0);
});
test('an open native picker is accepted work until cancellation or disposal', async (t) => {
  const f = fixture(t);
  const nativeCreate = document.createElement;
  document.createElement = () => {
    const input = nativeCreate();
    input.click = () => {};
    return input;
  };
  const selection = createFinanceConnectionFileSelection({
      decode: parseFinanceConnectionImportText,
      maxBytes: FINANCE_CONNECTION_IMPORT_MAX_BYTES,
    }),
    pending = selection.choose();
  let drained = false;
  const drain = selection.runtime.drain().then(() => {
    drained = true;
  });
  try {
    await Promise.resolve();
    assert.equal(drained, false, 'file selection drain abandoned an open picker');
  } finally {
    selection.runtime.dispose();
    assert.equal(await pending, null);
    await drain;
  }
  assert.equal(f.nodes.size, 0);
});
for (const phase of ['status', 'file', 'confirm', 'import', 'after'])
  test(`import disposal retains accepted ${phase} through drain without foreign effects`, async (t) => {
    const f = fixture(t, { phase }),
      pending = f.run();
    await f.entered.promise;
    assert.equal(f.runtime.isPending(), true);
    assert.equal(f.runtime.dispose(), true);
    assert.equal(f.runtime.dispose(), false);
    let drained = false;
    const drain = f.runtime.drain().then(() => {
      drained = true;
    });
    try {
      await Promise.resolve();
      assert.equal(drained, false);
    } finally {
      f.held.resolve();
      await pending;
      await drain;
    }
    assert.equal(f.runtime.isPending(), false);
    assert.deepEqual(f.notices, []);
    assert.equal(f.nodes.size, 0);
    assert.equal(await f.run(), false);
  });
test('import requires explicit approval and preserves the existing cancellation policy', async (t) => {
  const f = fixture(t);
  f.ports.confirmDialog = async () => undefined;
  const cap = createFinanceConnectionImportCapability(f.ports);
  t.after(() => cap.runtime.dispose());
  assert.equal(await cap.commands.importConnections(), false);
  assert.equal(f.counts.import, 0);
});
test('current-device success keeps one portable payload and the cleanup warning outcome', async (t) => {
  const f = fixture(t);
  let received;
  f.ports.bridge.importConnectionSettings = async (payload) => {
    received = payload;
    f.counts.import++;
    return { cleanupWarnings: ['retention cleanup failed'] };
  };
  const pending = f.run();
  assert.equal(f.runtime.isPending(), true);
  assert.equal(await pending, true);
  await f.runtime.drain();
  assert.equal(f.counts.import, 1);
  assert.equal(f.counts.after, 1);
  assert.equal(received.credit.profiles[0].connectionKey, 'portable');
  assert.equal(received.credit.profiles[0].credentials.password, ' padded ');
  assert.equal(f.notices.length, 1);
  assert.match(f.notices[0], /ניקוי/);
  assert.equal(f.nodes.size, 0);
});
test('unreadable pairing stops import with a safe local message', async (t) => {
  const f = fixture(t);
  f.ports.bridge.getBridgeToken = () => {
    throw Error('private storage details');
  };
  assert.equal(await f.run(), false);
  assert.equal(f.counts.status, 0);
  assert.equal(f.counts.import, 0);
  assert.ok(!f.notices.join(' ').includes('private storage details'));
});
test('a false approval never enters the local vault endpoint', async (t) => {
  const f = fixture(t);
  f.ports.confirmDialog = async () => false;
  const cap = createFinanceConnectionImportCapability(f.ports);
  t.after(() => cap.runtime.dispose());
  assert.equal(await cap.commands.importConnections(), false);
  assert.equal(f.counts.import, 0);
  assert.equal(f.nodes.size, 0);
});
