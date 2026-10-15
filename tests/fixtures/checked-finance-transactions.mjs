import {createFinanceLeaseTransport,readFinanceLeaseRelease} from '../../shared/finance-lease-transport.js';
import {createFinanceLeaseTransport as createKupa} from '../../netunim-kupa/site/assets/js/shared/finance-lease-transport.js';
import {createFinanceLeaseTransport as createOrders} from '../../netunim-orders/site/assets/js/shared/finance-lease-transport.js';
import {createFinanceManualQueue,financeFencePayload,createFinanceOperationScope} from '../../shared/finance-fence.js';
/** @type {import('../../shared/finance-lease-transport.js').LeaseFetch} */
const request=async()=>({ok:true,text:async()=> '{}'});
const api=createFinanceLeaseTransport({request});createKupa({request});createOrders({request});
/** @type {Promise<boolean>} */ const release=api.releaseFinanceSyncLease('credit','operation',{assertCurrent:()=>{}});
/** @type {Promise<import('../../shared/finance-lease-receipt.js').FinanceLeaseReceipt>} */
const receipt=api.claimFinanceSyncLease('bank','operation');
// @ts-expect-error Request success cannot replace unknown response text with a grant.
createFinanceLeaseTransport({request:async()=>({ok:true,text:async()=>({acquired:true})})});
// @ts-expect-error An asynchronous guard cannot capture transaction authority.
api.claimFinanceSyncLease('credit','operation',{assertCurrent:async()=>{}});
// @ts-expect-error Providers are not SQL lease names.
api.releaseFinanceSyncLease('max','operation');
// @ts-expect-error A release receipt supplies no document write ACK or revision.
/** @type {{revision:number}} */ const notAWrite=readFinanceLeaseRelease(true);
const queue=createFinanceManualQueue({claim:api.claimFinanceSyncLease,release:api.releaseFinanceSyncLease,createToken:()=> 'operation'});
/** @type {Promise<number>} */ const saved=queue(lease=>{
 const fence=financeFencePayload(lease);void fence;
 /** @type {true} */ const acquired=lease.acquired;void acquired;
 return 1;
},{assertCurrent:()=>{}});
// @ts-expect-error The queue result preserves the actual command result.
/** @type {Promise<boolean>} */ const notSaved=queue(()=>42);
// @ts-expect-error The caller must provide a captured synchronous authority.
queue(()=>true,{assertCurrent:async()=>{}});
// @ts-expect-error A claim result is unknown until runtime validation.
createFinanceManualQueue({claim:async()=>({acquired:true}),release:async()=>true,createToken:()=>7});
// @ts-expect-error A server fence is a numeric epoch, not a diagnostic string.
financeFencePayload({fenceEpoch:'7'});
const scope=createFinanceOperationScope({readAccess:()=>({connectionMode:'local',storageOwner:'local',readable:true,writable:true})});
/** @type {()=>undefined} */ const guard=scope.capture();void guard;
// @ts-expect-error Readiness is a literal capability fact, not a promise.
createFinanceOperationScope({readAccess:()=>({connectionMode:'local',storageOwner:'local',readable:true,writable:Promise.resolve(true)})});
void receipt;void release;void saved;void notSaved;void notAWrite;
