import { createFinanceConnectionImportRuntime } from '../../shared/finance-connection-import-runtime.js';
import { createFinanceConnectionFileSelection } from '../../shared/finance-connection-file-selection.js';
/** @type {Parameters<typeof createFinanceConnectionImportRuntime>[0]} */
const ports = {
  pairing: { token: () => 'opaque' },
  transport: { status: async () => ({ bridgeVersion: 74 }), replace: async () => ({}) },
  selection: {
    choose: async () => null,
    runtime: { isPending: () => false, drain: async () => {}, dispose: () => true },
  },
  document: {
    prepare: (payload) => ({ payload, summary: { bankAccountCount: 2, creditProfileCount: 1 } }),
  },
  presentation: {
    confirmDialog: async () => true,
    toast: () => {},
    publish: async (_result, guard) => {
      guard();
    },
  },
  protocol: { minimumBridgeVersion: 66 },
};
const owner = createFinanceConnectionImportRuntime(ports);
/** @type {Promise<boolean>} */ const imported = owner.commands.importConnections();
/** @type {Promise<void>} */ const drained = owner.runtime.drain();
void imported;
void drained;
createFinanceConnectionImportRuntime({
  ...ports,
  // @ts-expect-error pairing identities cannot be cloud records
  pairing: { token: () => ({ owner: 'A' }) },
});
createFinanceConnectionImportRuntime({
  ...ports,
  // @ts-expect-error confirmation is explicit boolean evidence
  presentation: { ...ports.presentation, confirmDialog: async () => undefined },
});
createFinanceConnectionImportRuntime({
  ...ports,
  document: {
    prepare: (payload) => ({
      payload,
      // @ts-expect-error prepared summaries preserve numeric counts
      summary: { bankAccountCount: 'two', creditProfileCount: 1 },
    }),
  },
});
// @ts-expect-error import completion is neither display text nor a durable receipt
/** @type {Promise<string>} */ const invalidReceipt = owner.commands.importConnections();
void invalidReceipt;
const selection = createFinanceConnectionFileSelection({
  decode: (raw) => JSON.parse(raw),
  maxBytes: 32768,
});
// The real native owner must also satisfy the real orchestration consumer.
const withNativeSelection = createFinanceConnectionImportRuntime({ ...ports, selection });
/** @type {Promise<void>} */ const joined = withNativeSelection.runtime.drain();
void joined;
/** @type {Promise<unknown|null>} */ const chosen = selection.choose();
void chosen;
createFinanceConnectionFileSelection({
  decode: (raw) => raw,
  // @ts-expect-error a native byte budget is numeric
  maxBytes: '32768',
});
// @ts-expect-error drain proves completion, not a confirmation
/** @type {Promise<boolean>} */ const incorrect = selection.runtime.drain();
void incorrect;
