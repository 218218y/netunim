import { createCreditConnectionOwner } from '../../netunim-kupa/site/assets/js/domains/credit/connection-owner.js';
/** @type {Parameters<typeof createCreditConnectionOwner>[0]} */
const ports = {
  protocol:{minimumBridgeVersion:73,contractVersion:2},
  pairing: { token: () => 'local' },
  transport: {
    readStatus: async () => ({ bridgeVersion: 73, contractVersion: 2 }),
    readDiagnostics: async () => ({ events: [] }),
    readData: async () => ({ available: true, data: {} }),
    saveProfile: async () => {},
    deleteProfile: async () => {},
  },
  effects: { writeText: async () => {}, saveJson: () => {} },
  profiles: { read: () => [] },
  presentation: {
    toast: () => {},
    render: () => {},
    confirmDialog: async () => true,
  },
};
const api = createCreditConnectionOwner(ports);
// @ts-expect-error Protocol versions are validated numeric metadata.
createCreditConnectionOwner({...ports,protocol:{minimumBridgeVersion:73,contractVersion:'2'}});
/** @type {()=>undefined} */ export const captured = api.queries.capture();
/** @type {Promise<void>} */ export const drained = api.runtime.drain();
/** @type {Promise<boolean>} */ export const copied = api.commands.copyDiagnostics();
// @ts-expect-error A device token is a local identity, not a document revision.
createCreditConnectionOwner({ ...ports, pairing: { token: () => 42 } });
createCreditConnectionOwner({
  ...ports,
  // @ts-expect-error A diagnostic read is asynchronous and supplies an unknown decoded value.
  transport: { ...ports.transport, readData: () => ({ data: {} }) },
});
createCreditConnectionOwner({
  ...ports,
  // @ts-expect-error Confirmations must supply an asynchronous boolean answer.
  presentation: { ...ports.presentation, confirmDialog: async () => 'yes' },
});
// @ts-expect-error Downloads start synchronously in the resource adapter.
createCreditConnectionOwner({ ...ports, effects: { ...ports.effects, saveJson: async () => {} } });
// @ts-expect-error Cloud profiles are a projection, not a mutable model context.
createCreditConnectionOwner({ ...ports, profiles: { read: () => ({ creditSync: {} }) } });
// @ts-expect-error Opaque profile identities cannot be coerced to numeric account IDs.
api.commands.deleteConnection(42);
// @ts-expect-error Only explicit view options are accepted by the read query.
api.queries.refreshStatus({ quiet: 'true' });
// @ts-expect-error A local diagnostic command does not return Finance lease evidence.
/** @type {Promise<{acquired:true}>} */ export const notALease = api.commands.exportData();
// @ts-expect-error Drain completion is not a journal ACK.
/** @type {Promise<boolean>} */ export const notAnAck = api.runtime.drain();
