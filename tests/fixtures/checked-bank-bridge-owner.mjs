import {createBridgeOperationOwner} from '../../netunim-kupa/bank-bridge/operation-owner.mjs';
const owner=createBridgeOperationOwner();
/** @type {Promise<{committed:boolean}>} */
const receipt=owner.configuration(async()=>({committed:true}));
/** @type {Promise<number>} */
const provider=owner.provider(()=>42);
/** @type {Promise<string>} */
const query=owner.read(()=> 'configured');
void receipt;void provider;void query;
// @ts-expect-error owner requires a command, not an already started operation
owner.configuration(Promise.resolve(42));
// @ts-expect-error provider result must retain the command's actual type
/** @type {Promise<number>} */ const wrong=owner.provider(()=> 'finished');
void wrong;
// @ts-expect-error ownership is private and cannot be overwritten by callers
owner.providerActive=false;
