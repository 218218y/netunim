import {createDocumentCommandOwner,joinDocumentReads} from '../../netunim-orders/document-bridge/document-command-owner.mjs';
const owner=createDocumentCommandOwner();
/** @type {Promise<{id:string}>} */ export const command=owner.run(async()=>({id:'captured'}));
// @ts-expect-error Work is a callable acceptance boundary, not an already running request.
owner.run(Promise.resolve(true));
// @ts-expect-error Accepted results preserve their actual shape.
const text=/** @type {Promise<string>} */(owner.run(async()=>({id:'captured'})));
export {text};
// @ts-expect-error Joined reads require asynchronous evidence.
joinDocumentReads([true]);
