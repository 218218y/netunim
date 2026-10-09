import {readBankSnapshotReceipt,bankSnapshotReadoutIsCurrent} from '../../shared/bank-snapshot-receipt.js';
import {readBankSnapshotReceipt as readKupa} from '../../netunim-kupa/site/assets/js/shared/bank-snapshot-receipt.js';
import {readBankSnapshotReceipt as readOrders} from '../../netunim-orders/site/assets/js/shared/bank-snapshot-receipt.js';
/** @type {unknown} */ const response={finance_revision:9,kupa_revision:4};
const receipt=readBankSnapshotReceipt(response);
readKupa(response);readOrders(response);
/** @type {number} */ const finance=receipt.finance_revision;
/** @type {number} */ const main=receipt.kupa_revision;
bankSnapshotReadoutIsCurrent(receipt,{verified:true,revision:4,financeRevision:9});
// @ts-expect-error callers cannot provide an incomplete commit receipt
bankSnapshotReadoutIsCurrent({finance_revision:9},{verified:true});
// @ts-expect-error the Finance and Main heads are independent numeric evidence
bankSnapshotReadoutIsCurrent({finance_revision:'9',kupa_revision:4},null);
// @ts-expect-error decoded receipts are immutable evidence
receipt.kupa_revision=5;
// @ts-expect-error a remote Finance revision cannot be used as text
/** @type {string} */ const invalid=readOrders(response).finance_revision;
void finance;void main;void invalid;
