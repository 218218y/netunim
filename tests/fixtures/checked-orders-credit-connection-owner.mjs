import { createOrdersCreditConnectionOwner } from '../../netunim-orders/site/assets/js/domains/finance/credit-connection-owner.js';
/** @type {Parameters<typeof createOrdersCreditConnectionOwner>[0]} */
const ports = {
  pairing: { token: () => 'fixture' },
  transport: {
    readStatus: async () => ({}),
    readDiagnostics: async () => ({}),
    readData: async () => ({}),
    saveProfile: async () => {},
    deleteProfile: async () => {},
    resetProfiles: async () => {},
  },
  presentation: { toast: () => {} },
  effects: { writeText: async () => {}, saveJson: () => undefined },
  protocol: { minimumBridgeVersion: 73, contractVersion: 2 },
};
const connection = createOrdersCreditConnectionOwner(ports);
/** @type {Promise<void>} */ const drained = connection.runtime.drain();
/** @type {boolean} */ const checked = connection.queries.snapshot().checked;
/** @type {boolean} */ const ok = (await connection.commands.saveProfile({})).ok;
void drained;
void checked;
void ok;
// @ts-expect-error pairing identity is local opaque text, never an account record
createOrdersCreditConnectionOwner({ ...ports, pairing: { token: () => ({ owner: 'A' }) } });
createOrdersCreditConnectionOwner({
  ...ports,
  // @ts-expect-error protocol evidence is numeric
  protocol: { minimumBridgeVersion: '73', contractVersion: 2 },
});
createOrdersCreditConnectionOwner({
  ...ports,
  // @ts-expect-error download acceptance is synchronous; its resource lifetime belongs to effects
  effects: { ...ports.effects, saveJson: async () => {} },
});
// @ts-expect-error profile command results are confirmed booleans, not display strings
const confirmed = /** @type {string} */ ((await connection.commands.saveProfile({})).ok);
void confirmed;
