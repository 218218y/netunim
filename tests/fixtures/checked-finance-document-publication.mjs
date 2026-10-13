// @ts-check
import { createFinanceReadoutPublication } from '../../netunim-orders/site/assets/js/domains/finance/document-publication.js';
const publication = createFinanceReadoutPublication({
  refresh: async (options) => {
    options.assertCurrent();
    options.minimumFinanceRevision?.toFixed();
    return true;
  },
});
const result = await publication(() => {}, { minimumRevision: 3, minimumFinanceRevision: 4 });
/** @type {boolean} */ const published = result.published;
/** @type {string} */ const warning = result.publicationWarning;
// @ts-expect-error authoritative document heads are numeric revisions
publication(() => {}, { minimumFinanceRevision: '4' });
// @ts-expect-error publication requires the captured operation guard
publication('current', { minimumRevision: 3 });
// @ts-expect-error a refresh port must return asynchronous confirmation evidence
createFinanceReadoutPublication({ refresh: () => true });
// @ts-expect-error a publication status is not a storage journal ACK
result.ackSeq;
void published;
void warning;
