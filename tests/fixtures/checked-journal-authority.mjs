import {captureStorageJournalOperation} from '../../shared/storage-journal-authority.js';
import {captureStorageCloudBase,captureStorageRecoveryHead} from '../../shared/storage-journal-authority.js';
/** @type {unknown} */ const input={};
const command=captureStorageJournalOperation(input,'A:orders','E');
/** @type {number} */ const seq=command.data.seq;
/** @type {string} */ const operationId=command.data.operationId;
// @ts-expect-error journal authority cannot accept a coercible owner
captureStorageJournalOperation(input,['A:orders'],'E');
// @ts-expect-error a checked sequence cannot become text authority
/** @type {string} */ const invalid=command.data.seq;
// @ts-expect-error business content is not inferred from the operation envelope
command.data.changes[0].record.text.toUpperCase();
void [seq,operationId,invalid];
const base=captureStorageCloudBase(input),head=captureStorageRecoveryHead(input);
/** @type {number} */ const revision=base.data.revision;
/** @type {number} */ const ack=head.ackSeq;
// @ts-expect-error revision evidence cannot become text
/** @type {string} */ const invalidBase=base.data.revision;
// @ts-expect-error sequence evidence cannot become a boolean
/** @type {boolean} */ const invalidHead=head.seq;
void [revision,ack,invalidBase,invalidHead];
