// @ts-check
import { createOrdersBankArchiveReadout } from '../../netunim-orders/site/assets/js/domains/finance/bank-archive-readout.js';
/** @type {import('../../netunim-orders/site/assets/js/domains/finance/bank-archive-readout.js').ArchiveGuard} */
const guard = () => undefined;
/** @type {import('../../netunim-orders/site/assets/js/domains/finance/bank-archive-readout.js').ArchiveTarget[]} */
const targets = [{ role: 'business', accountKey: 'A', syncKey: 'one' }];
const api = createOrdersBankArchiveReadout({
  authority: { captureRead: () => guard },
  sources: { targets: () => targets, rows: () => [[{ archiveId: 4, title: 'row' }]] },
  reads: {
    transactions: async (_account, _role, options) => {
      options.assertCurrent();
      return [{ archiveId: 4, title: 'row' }];
    },
    snapshot: async () => null,
  },
  access: { authenticated: () => true, online: () => true },
  revision: { read: () => 1, touch: () => 2 },
  report: () => {},
});
const records = await api.queries.readSnapshot(targets, { days: 370, assertCurrent: guard });
records[0]?.rows[0]?.title.toUpperCase();
await api.runtime.ensure();
await api.runtime.drain();
api.commands.update(4, (row) => {
  row.title = 'acknowledged';
});
// @ts-expect-error normalized account keys are strings
api.queries.readSnapshot([{ role: 'business', accountKey: 4 }]);
// @ts-expect-error archive roles do not accept issuer names
api.queries.matching('max', 'A', 'one');
// @ts-expect-error query windows are days or all-years null
api.queries.readSnapshot(targets, { days: 'all' });
// @ts-expect-error authority must be synchronous
api.queries.readSnapshot(targets, { assertCurrent: async () => {} });
// @ts-expect-error in-memory patches must complete synchronously
api.commands.update(4, async (row) => {
  row.title = 'late';
});
// @ts-expect-error read evidence cannot grant a storage journal ACK
records[0]?.ackSeq;
// @ts-expect-error read projections do not expose their private authority guard
api.queries.matching('business', 'A', 'one')?.assertCurrent;
