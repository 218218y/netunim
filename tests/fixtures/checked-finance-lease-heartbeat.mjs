import { startFinanceLeaseHeartbeat } from '../../shared/finance-lease-heartbeat.js';
import { startFinanceLeaseHeartbeat as startKupa } from '../../netunim-kupa/site/assets/js/shared/finance-lease-heartbeat.js';
import { startFinanceLeaseHeartbeat as startOrders } from '../../netunim-orders/site/assets/js/shared/finance-lease-heartbeat.js';
/** @type {import('../../shared/finance-lease-heartbeat.js').HeartbeatLease} */
const lease = {
  acquired: true,
  leaseName: 'bank',
  leaseToken: 'captured',
  fenceEpoch: 7,
  assertCurrent: () => {},
};
/** @type {import('../../shared/finance-lease-heartbeat.js').LeaseClaim} */
const claim = async () => ({
  acquired: true,
  leaseName: 'bank',
  leaseToken: 'captured',
  fenceEpoch: 7,
  leasedUntil: '2030-01-01T00:00:00Z',
});
const heartbeat = startFinanceLeaseHeartbeat(lease, claim);
startKupa(lease, claim);
startOrders(lease, claim);
/** @type {Promise<void>} */
export const drained = heartbeat.stop();
// @ts-expect-error Renewal must have synchronous, captured authority.
startFinanceLeaseHeartbeat({ ...lease, assertCurrent: async () => {} }, claim);
// @ts-expect-error Missing authority cannot manufacture a cloud grant.
startKupa({ acquired: true, leaseName: 'bank', leaseToken: 'captured', fenceEpoch: 7 }, claim);
// @ts-expect-error An unknown server response is not a decoded grant.
startOrders(lease, async () => ({ acquired: true }));
// @ts-expect-error No arbitrary provider or resource name may enter renewal.
startFinanceLeaseHeartbeat({ ...lease, leaseName: 'max' }, claim);
// @ts-expect-error Serialized epochs require decoding before use.
startFinanceLeaseHeartbeat({ ...lease, fenceEpoch: '7' }, claim);
// @ts-expect-error A denied claim cannot own a heartbeat.
startFinanceLeaseHeartbeat({ ...lease, acquired: false }, claim);
// @ts-expect-error A timeout handle cannot be a formatted display identifier.
startFinanceLeaseHeartbeat(lease, claim, { setTimer: () => 'timer' });
// @ts-expect-error Cleanup completion is not a lease/publication/durability receipt.
/** @type {Promise<boolean>} */ export const notAnAck = heartbeat.stop();
startFinanceLeaseHeartbeat({ acquired: true, localOnly: true, assertCurrent: () => {} }, claim);
