// @ts-check
import { createKupaBankSnapshotCommands } from '../../netunim-kupa/site/assets/js/domains/bank/snapshot-commands.js';
/** @type {import('../../netunim-kupa/site/assets/js/domains/bank/snapshot-commands.js').SnapshotGuard} */
const guard = () => undefined;
/** @type {import('../../netunim-kupa/site/assets/js/domains/bank/snapshot-commands.js').BankSnapshot} */
const bank = { snapshotToken: 'BANK-one', snapshotSeq: 7, currentBalance: 500 };
/** @type {import('../../netunim-kupa/site/assets/js/domains/bank/snapshot-commands.js').SnapshotLease} */
const lease = { leaseName: 'bank', leaseToken: 'L', fenceEpoch: 3, assertCurrent: guard };
const api = createKupaBankSnapshotCommands({
  authority: { capture: () => guard },
  bank: { mode: () => 'supabase', manualCandidate: () => bank },
  checks: { hasLocalWork: () => false, saveCloud: async () => true, syncCloud: async () => true },
  local: { state: () => null, save: async () => true, retry: async () => true },
  cloud: {
    publish: async () => ({ kupa_revision: 4, finance_revision: 9 }),
    refresh: async () => ({ verified: true, revision: 4, financeRevision: 9 }),
  },
  publication: { bank: () => {}, archive: () => {}, data: () => {} },
});
await api.commands.prepare(guard);
await api.commands.commitManual('500', { bankFeed: null, message: '' });
const confirmed = await api.commands.publishCloud(bank, null, lease);
confirmed.readoutVerified.valueOf();
confirmed.receipt.finance_revision.toFixed();
// @ts-expect-error numeric command sequences cannot be presentation labels
api.commands.publishCloud({ ...bank, snapshotSeq: 'seven' }, null, lease);
// @ts-expect-error Bank snapshot tokens are strings
api.commands.publishCloud({ ...bank, snapshotToken: 7 }, null, lease);
// @ts-expect-error Bank publication requires a real captured lease, not a scope-less grant
api.commands.publishCloud(bank, null, { leaseName: 'bank', leaseToken: 'L', fenceEpoch: 3 });
// @ts-expect-error Credit leases cannot authorize Bank snapshots
api.commands.publishCloud(bank, null, { ...lease, leaseName: 'credit' });
// @ts-expect-error lease epochs are numeric
api.commands.publishCloud(bank, null, { ...lease, fenceEpoch: 'three' });
// @ts-expect-error authority must complete synchronously
api.commands.prepare(async () => {});
// @ts-expect-error imported feeds remain opaque; callers cannot invent remote receipt heads
confirmed.ackSeq;
// @ts-expect-error read confirmation is boolean, separate from operator text
confirmed.readoutVerified = 'confirmed';
/** @type {import('../../netunim-kupa/site/assets/js/domains/bank/snapshot-commands.js').SnapshotPublication<null>} */
const invalidPublication = {
  bank: () => {},
  // @ts-expect-error archive publication must finish synchronously
  archive: async () => true,
  // @ts-expect-error revision effects must finish synchronously
  data: async () => {},
};
void invalidPublication;
