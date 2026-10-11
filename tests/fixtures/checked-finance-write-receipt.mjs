import {readFinanceWriteReceipt} from '../../shared/finance-write-receipt.js';
import {readFinanceWriteReceipt as readKupa} from '../../netunim-kupa/site/assets/js/shared/finance-write-receipt.js';
import {readFinanceWriteReceipt as readOrders} from '../../netunim-orders/site/assets/js/shared/finance-write-receipt.js';
/** @type {unknown} */ const response={revision:6,state:{bank:{currentBalance:100}}};
const options={baseRevision:5,sentState:{bank:{currentBalance:100}}};
const receipt=readFinanceWriteReceipt(response,options);
readKupa(response,options);readOrders(response,options);
/** @type {number} */ const revision=receipt.revision;
// @ts-expect-error confirmation requires the captured base revision
readFinanceWriteReceipt(response,{sentState:options.sentState});
// @ts-expect-error numeric revisions cannot be mistaken for timestamps
readOrders(response,{...options,baseRevision:'5'});
// @ts-expect-error sent state cannot be a callback
readKupa(response,{...options,sentState:()=>options.sentState});
// @ts-expect-error an array is not a document
readFinanceWriteReceipt(response,{...options,sentState:[]});
// @ts-expect-error decoded revision evidence is immutable
receipt.revision=7;
// @ts-expect-error a receipt is synchronous evidence, not a Promise
/** @type {Promise<unknown>} */ const wrong=readFinanceWriteReceipt(response,options);
void revision;void wrong;
