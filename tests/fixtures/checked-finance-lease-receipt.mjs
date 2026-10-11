import {readFinanceLeaseReceipt} from '../../shared/finance-lease-receipt.js';
import {readFinanceLeaseReceipt as readKupa} from '../../netunim-kupa/site/assets/js/shared/finance-lease-receipt.js';
import {readFinanceLeaseReceipt as readOrders} from '../../netunim-orders/site/assets/js/shared/finance-lease-receipt.js';
/** @type {unknown} */ const response={acquired:true,lease_token:'operation',fence_epoch:1,leased_until:'2030-01-01T00:00:00Z'};
/** @type {{leaseName: 'bank', leaseToken: string}} */ const requested={leaseName:'bank',leaseToken:'operation'};
const receipt=readFinanceLeaseReceipt(response,requested);readKupa(response,requested);readOrders(response,requested);
/** @type {number} */ const epoch=receipt.fenceEpoch;
// @ts-expect-error the requested operation identity is required
readFinanceLeaseReceipt(response,{leaseName:'bank'});
// @ts-expect-error resource names cannot be arbitrary providers
readOrders(response,{...requested,leaseName:'max'});
// @ts-expect-error tokens are not numeric revisions
readKupa(response,{...requested,leaseToken:1});
// @ts-expect-error decoded evidence is immutable
receipt.fenceEpoch=2;
// @ts-expect-error an unknown body cannot be consumed as an authorized grant
/** @type {true} */ const authorized=receipt.acquired;
// @ts-expect-error evidence is synchronous, not a deferred claim
/** @type {Promise<unknown>} */ const deferred=readFinanceLeaseReceipt(response,requested);
void epoch;void authorized;void deferred;
