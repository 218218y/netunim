import { createKupaBankConnectionOwner } from '../../netunim-kupa/site/assets/js/domains/bank/connection-owner.js';
/** @type {Parameters<typeof createKupaBankConnectionOwner>[0]} */
const ports = {
  pairing: { read: () => 'opaque', write: () => {} },
  transport: {
    readStatus: async () => ({ bridgeVersion: 74 }),
    configure: async () => ({}),
    selectAccount: async () => ({}),
    deleteCredentials: async () => ({}),
    readDiagnostics: async () => ({}),
  },
  presentation: { toast: () => {}, changed: () => {} },
  effects: { saveJson: () => undefined },
  clock: { now: () => 0 },
  protocol: { minimumBridgeVersion: 74, statusCacheMs: 15000 },
};
const bank = createKupaBankConnectionOwner(ports);
/** @type {boolean} */ const accepted = await bank.commands.configure({
  password: ' p ',
  businessAccountNumber: '0012',
});
/** @type {Promise<void>} */ const drain = bank.runtime.drain();
/** @type {number} */ const version = bank.queries.snapshot().bridgeVersion;
void accepted;
void drain;
void version;
createKupaBankConnectionOwner({
  ...ports,
  // @ts-expect-error opaque pairing must remain text
  pairing: { read: () => ({ owner: 'A' }), write: () => {} },
});
createKupaBankConnectionOwner({
  ...ports,
  // @ts-expect-error synchronous download acceptance is required
  effects: { saveJson: async () => {} },
});
// @ts-expect-error leading zeroes are meaningful identifiers
bank.commands.configure({ businessAccountNumber: 123 });
// @ts-expect-error selection requires an account
bank.commands.selectAccount('home', '012');
// @ts-expect-error an asynchronous callback cannot grant authority
bank.commands.recordScan({}, async () => {});
// @ts-expect-error acceptance is a boolean
/** @type {string} */ const confirmation = await bank.commands.deleteCredentials();
void confirmation;
