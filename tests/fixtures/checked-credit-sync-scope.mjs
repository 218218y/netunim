// @ts-check
import {
  creditSyncScope,
  normalizeCreditSyncMode,
} from '../../netunim-kupa/bank-bridge/credit-sync-scope.mjs';
/** @type {import('../../netunim-kupa/bank-bridge/credit-sync-scope.mjs').CreditSyncScope} */
const scope = creditSyncScope({ syncMode: normalizeCreditSyncMode('full'), now: new Date() });
scope.startDate.toISOString();
/** @type {1|12} */
const horizon = scope.futureMonths;
void horizon;
// @ts-expect-error the scope requires a date, not presentation text
creditSyncScope({ now: '2026-10-13' });
// @ts-expect-error an asynchronous browser query is not a clock value
creditSyncScope({ now: Promise.resolve(new Date()) });
/** @type {'full'} */
// @ts-expect-error the returned mode cannot remain the historical input alias
const alias = scope.syncMode;
void alias;
/** @type {string} */
// @ts-expect-error the horizon cannot become a label
const label = scope.futureMonths;
void label;
