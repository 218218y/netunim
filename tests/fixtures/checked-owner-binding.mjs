import {createStorageOwnerBinding,readStorageOwnerBinding,readStorageOwnerRecord} from '../../shared/storage-owner-binding.js';
/** @type {unknown} */ const external={owner:'A'};
const row=readStorageOwnerBinding(external,'orders');
// @ts-expect-error A persisted generation has numeric authority only after decoding.
row.generation='2';
// @ts-expect-error Unknown durable input is not a binding.
external.owner;
// @ts-expect-error The checked implementation requires explicit storage/database/clock ports.
createStorageOwnerBinding({app:'orders'});
const handoff=readStorageOwnerRecord(external,'orders');
// @ts-expect-error Historical/absent handoffs must be checked before use.
handoff.targetOwner;
/** @param {import('../../shared/storage-owner-binding.js').BindingOptions} ports */
export async function consumer(ports){const owner=createStorageOwnerBinding(ports);await owner.hydrate();return owner.status()}
