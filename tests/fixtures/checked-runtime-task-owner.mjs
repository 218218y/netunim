import {createRuntimeTaskOwner} from '../../shared/runtime-task-owner.js';

const owner=createRuntimeTaskOwner();
/** @type {Promise<boolean>} */
export const accepted=owner.run(async()=>true);
/** @type {Promise<void>} */
export const drained=owner.drain();
/** @type {boolean} */
export const closed=owner.close();
/** @type {boolean} */
export const pending=owner.isPending();

// @ts-expect-error Work must be callable; a received promise cannot submit it.
owner.run(Promise.resolve(true));
/** @type {Promise<boolean>} */
// @ts-expect-error Drain proves completion, not a durable/cloud receipt.
export const invalidReceipt=owner.drain();
/** @type {Promise<number>} */
// @ts-expect-error Task result types must survive the owner boundary.
export const wrongResult=owner.run(async()=>true);
