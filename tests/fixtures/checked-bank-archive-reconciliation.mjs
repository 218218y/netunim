// @ts-check
import { createBankArchiveReconciliation } from '../../shared/bank-archive-reconciliation.js';
import { readBankBalanceResult } from '../../shared/bank-balance-result.js';
import { verifyBankArchiveCoverage } from '../../shared/bank-archive-policy.js';
/** @type {import('../../shared/bank-archive-reconciliation.js').ArchiveGuard} */
const guard = () => undefined;
/** @type {import('../../shared/bank-archive-reconciliation.js').ReconciliationPorts} */
const ports = {
  transactions: { reconcile: async () => ({ sourcePayload: [], result: { total_count: 0 } }) },
  images: { sync: async () => ({ warnings: [] }) },
  archive: { read: async () => [] },
  authority: { captureRead: () => guard },
};
const core = createBankArchiveReconciliation(ports);
/** @type {import('../../shared/bank-archive-reconciliation.js').BankLease} */
const lease = { leaseName: 'bank', leaseToken: 'L', fenceEpoch: 1, assertCurrent: guard };
const decoded = readBankBalanceResult({ balance: 500 });
const input = {
  business: decoded.business,
  home: decoded.home,
  fetchedAt: '2026-10-14T10:00:00Z',
  historyDays: 30,
  lease,
};
const result = await core.commands.sync(input);
result.archiveAudit.version.toFixed();
result.imageSyncWarning.trim();
await core.runtime.drain();
const audit = verifyBankArchiveCoverage(null, [], { requireExactCount: false });
audit.sourceCount.toFixed();
audit.exactCount.valueOf();
// @ts-expect-error unvalidated financial objects cannot replace branded Bank accounts
core.commands.sync({ ...input, business: { balance: 500 } });
// @ts-expect-error only a Bank lease can authorize Bank archive writes
core.commands.sync({ ...input, lease: { ...lease, leaseName: 'credit' } });
// @ts-expect-error synchronous authority cannot be replaced with a pending permission
core.commands.sync({ ...input, lease: { ...lease, assertCurrent: async () => {} } });
// @ts-expect-error required captured lease cannot be a display boolean
core.commands.sync({ ...input, lease: true });
// @ts-expect-error archive rows cannot be an HTTP status code
ports.archive.read = async () => 200;
// @ts-expect-error audit counts cannot be UI labels
audit.sourceCount = 'confirmed';
// @ts-expect-error audit exact count cannot be a display label
audit.exactCount = 'verified';
// @ts-expect-error drain must join accepted asynchronous work
core.runtime.drain = () => true;
// @ts-expect-error verified archive readback is not an atomic document ACK
result.kupa_revision;
