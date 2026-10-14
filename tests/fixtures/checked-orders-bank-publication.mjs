// @ts-check
import { createOrdersBankSnapshotPublication } from '../../netunim-orders/site/assets/js/domains/finance/bank-snapshot-publication.js';
/** @type {import('../../netunim-orders/site/assets/js/domains/finance/bank-snapshot-publication.js').SnapshotGuard} */
const guard = () => undefined;
/** @type {import('../../netunim-orders/site/assets/js/domains/finance/bank-snapshot-publication.js').SnapshotPorts} */
const ports = {
  checks: {
    hasLocalWork: () => false,
    save: async () => true,
    refresh: async () => true,
    read: () => ({ kupa: {}, bankEvents: [] }),
  },
  transactions: { reconcile: async () => ({}) },
  images: { sync: async () => ({ warnings: [] }) },
  archive: { read: async () => [], publish: () => true },
  publication: { save: async () => ({ published: true }) },
  policy: {
    accountId: () => '',
    coverage: () => ({ complete: false, from: null, to: null, days: null, warning: '' }),
    transactions: () => [],
    audit: () => ({}),
    build: () => ({ bank: {}, snapshotToken: 'BANK-one', snapshotSeq: 7 }),
  },
  authority: { captureRead: () => guard },
};
const api = createOrdersBankSnapshotPublication(ports);
/** @type {import('../../netunim-orders/site/assets/js/domains/finance/bank-snapshot-publication.js').SnapshotLease} */
const lease = { leaseName: 'bank', leaseToken: 'L', fenceEpoch: 1, assertCurrent: guard };
await api.commands.prepare(guard);
const result = await api.commands.publish(null, {
  financeRow: {},
  historyDays: 30,
  archiveReady: true,
  archiveVersion: 2,
  lease,
});
result.published.valueOf();
await api.runtime.drain();
api.commands.publish(null, {
  financeRow: {},
  historyDays: 30,
  archiveReady: true,
  archiveVersion: 2,
  // @ts-expect-error a Credit lease cannot authorize a Bank publication
  lease: { ...lease, leaseName: 'credit' },
});
// @ts-expect-error synchronous authority cannot be replaced by a pending promise
api.commands.prepare(async () => {});
api.commands.publish(null, {
  financeRow: {},
  historyDays: 30,
  archiveReady: true,
  archiveVersion: 2,
  // @ts-expect-error a grant without an account/device guard cannot authorize publication
  lease: { leaseName: 'bank', leaseToken: 'L', fenceEpoch: 1 },
});
api.commands.publish(null, {
  financeRow: {},
  historyDays: 30,
  archiveReady: true,
  archiveVersion: 2,
  // @ts-expect-error a token cannot be a numeric revision
  lease: { ...lease, leaseToken: 7 },
});
// @ts-expect-error confirmation cannot be an operator label
ports.publication.save = async () => ({ published: 'saved' });
// @ts-expect-error archive transactions cannot be an HTTP status
ports.archive.read = async () => 200;
// @ts-expect-error display publication must complete synchronously before command completion
ports.archive.publish = async () => true;
// @ts-expect-error numeric check sequence cannot be a display label
ports.policy.build = () => ({ bank: {}, snapshotToken: 'BANK-one', snapshotSeq: 'seven' });
// @ts-expect-error a completed drain is asynchronous, not a fabricated confirmation
api.runtime.drain = () => true;
// @ts-expect-error display publication cannot invent a journal ACK
result.ackSeq;
