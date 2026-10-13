// @ts-check
import { createKupaBankArchiveReadout } from '../../netunim-kupa/site/assets/js/domains/bank/archive-readout.js';
/** @type {import('../../shared/bank-archive-read-batch.js').ArchiveGuard} */ const guard = () =>
  undefined;
const api = createKupaBankArchiveReadout({
  authority: { captureRead: () => guard },
  sources: { targets: () => [{ role: 'business', accountKey: 'A', syncKey: 'one' }] },
  reads: { transactions: async () => [{ archiveId: 4, title: 'row' }], snapshot: async () => null },
  access: { cloud: () => true },
  publication: () => {},
  report: () => {},
});
await api.runtime.ensure();
const rows = await api.queries.readSnapshot([{ role: 'home', accountKey: 'B' }], {
  days: 370,
  assertCurrent: guard,
});
rows[0]?.rows[0]?.title.toUpperCase();
api.commands.invalidate(4);
api.runtime.dispose();
await api.runtime.drain();
// @ts-expect-error roles are business or home
api.queries.matching('credit', 'A', 'one');
// @ts-expect-error account identity is normalized before reading
api.queries.readSnapshot([{ role: 'business', accountKey: 4 }]);
api.queries.readSnapshot([{ role: 'business', accountKey: 'A' }], {
  // @ts-expect-error authority is synchronous
  assertCurrent: async () => {},
});
// @ts-expect-error numeric archive IDs cannot be display labels
api.commands.invalidate('four');
// @ts-expect-error read projections keep authority private
api.queries.matching('business', 'A', 'one')?.assertCurrent;
// @ts-expect-error read results do not grant journal ACKs
rows[0]?.ackSeq;
api.commands.publish({
  business: {
    accountKey: 'A',
    syncKey: 'one',
    // @ts-expect-error publication rows must retain their real row type
    rows: [4],
    directSnapshot: null,
    assertCurrent: guard,
  },
});
