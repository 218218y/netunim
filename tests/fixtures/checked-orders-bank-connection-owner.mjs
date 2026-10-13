import { createOrdersBankConnectionOwner } from '../../netunim-orders/site/assets/js/domains/finance/bank-connection-owner.js';
/** @type {Parameters<typeof createOrdersBankConnectionOwner>[0]} */
const ports = {
  pairing: { token: () => 'opaque' },
  transport: {
    readStatus: async () => ({ bridgeVersion: 74 }),
    configure: async () => ({}),
    selectAccount: async () => ({}),
    deleteCredentials: async () => {},
    readDiagnostics: async () => ({}),
  },
  presentation: { toast: () => {} },
  effects: { saveJson: () => undefined },
  protocol: { minimumBridgeVersion: 74 },
};
const bank = createOrdersBankConnectionOwner(ports);
/** @type {Promise<void>} */ const drain = bank.runtime.drain();
/** @type {boolean} */ const paired = bank.queries.snapshot().checked;
/** @type {boolean} */ const saved = (await bank.commands.configure({ password: ' p ' })).ok;
void drain;
void paired;
void saved;
createOrdersBankConnectionOwner({
  ...ports,
  // @ts-expect-error local identity is opaque text, never a cloud record
  pairing: { token: () => ({ owner: 'A' }) },
});
createOrdersBankConnectionOwner({
  ...ports,
  // @ts-expect-error download acceptance is synchronous
  effects: { saveJson: async () => {} },
});
// @ts-expect-error numeric account fields erase leading zeroes
bank.commands.configure({ businessAccountNumber: 123 });
// @ts-expect-error selection requires an account identifier
bank.commands.selectAccount('home', '012');
// @ts-expect-error asynchronous work cannot grant current device authority
bank.commands.recordScan({}, async () => {});
// @ts-expect-error command confirmation is a boolean
/** @type {string} */ const confirmation = (await bank.commands.deleteCredentials()).ok;
void confirmation;
