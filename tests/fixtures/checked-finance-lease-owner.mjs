import { createFinanceLeaseOwner } from '../../shared/finance-lease-owner.js';
import { createFinanceLeaseOwner as createKupa } from '../../netunim-kupa/site/assets/js/shared/finance-lease-owner.js';
import { createFinanceLeaseOwner as createOrders } from '../../netunim-orders/site/assets/js/shared/finance-lease-owner.js';
/** @type {import('../../shared/finance-lease-owner.js').LeaseOwnerPorts} */
const ports = {
  leases: {
    claim: async (leaseName, leaseToken) => ({
      acquired: true,
      leaseName,
      leaseToken,
      fenceEpoch: 1,
      leasedUntil: '2030-01-01T00:00:00Z',
    }),
    release: async () => true,
  },
  authority: { capture: () => () => {} },
};
const owner = createFinanceLeaseOwner(ports),
  session = owner.commands.acquire('bank', 'captured', { assertCurrent: () => {} });
createKupa(ports);
createOrders(ports);
/** @type {Promise<void>} */
export const closed = session.close();
/** @type {Promise<void>} */
export const drained = owner.runtime.drain();
createFinanceLeaseOwner({
  ...ports,
  // @ts-expect-error Unknown responses cannot authorize a lease session.
  leases: { ...ports.leases, claim: async () => ({ acquired: true }) },
});
// @ts-expect-error Cleanup must capture synchronous account/storage authority.
createKupa({ ...ports, authority: { capture: () => async () => {} } });
// @ts-expect-error Component/pairing guards cannot be asynchronous.
owner.commands.acquire('credit', 'captured', { assertCurrent: async () => {} });
// @ts-expect-error Provider identifiers are not financial lease kinds.
owner.commands.acquire('max', 'captured', { assertCurrent: () => {} });
// @ts-expect-error Tokens are identifiers rather than numeric counters.
owner.commands.acquire('credit', 7, { assertCurrent: () => {} });
// @ts-expect-error Session completion supplies no durability or document ACK.
/** @type {Promise<boolean>} */ export const notAnAck = session.close();
// @ts-expect-error Lifecycle closure is not a server grant.
/** @type {import('../../shared/finance-lease-receipt.js').FinanceLeaseReceipt} */ export const notAGrant =
  owner.runtime.dispose();
