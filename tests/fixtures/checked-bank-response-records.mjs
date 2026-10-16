import {readBankAcknowledgementReceipt,readBankHandledReceipt} from '../../shared/bank-response-records.js';
import {readBankArchiveSyncReceipt} from '../../shared/bank-response-records.js';
/** @type {unknown} */ const input=[];
const ack=readBankAcknowledgementReceipt(input,77,'missing');
/** @type {string} */ const at=ack.acknowledged_at;
// @ts-expect-error remote identity is already numeric
readBankAcknowledgementReceipt(input,'77','missing');
// @ts-expect-error unsupported warning cannot be acknowledged
readBankAcknowledgementReceipt(input,77,'anything');
// @ts-expect-error evidence is immutable
ack.acknowledged_at=at;
const handled=readBankHandledReceipt(input,77,false);
/** @type {string|null} */ const handledAt=handled.handled_at;
void handledAt;
const reconciliation=readBankArchiveSyncReceipt(input,false);
/** @type {number} */ const total=reconciliation.total_count;
// @ts-expect-error reconciliation counts cannot become string authority
/** @type {string} */ const invalidTotal=reconciliation.total_count;
void [total,invalidTotal];
