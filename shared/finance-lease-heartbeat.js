// @ts-check
/** @typedef {import('./finance-lease-receipt.js').FinanceLeaseReceipt} FinanceLeaseReceipt */
/** @typedef {()=>undefined} LeaseGuard */
/** @typedef {{acquired:true,localOnly:true}} LocalLease */
/** @typedef {({acquired:true,leaseName:'bank'|'credit',leaseToken:string,fenceEpoch:number,localOnly?:false}|LocalLease)&{assertCurrent:LeaseGuard}} HeartbeatLease */
/** @typedef {(name:'bank'|'credit',token:string,options:{ttlSeconds:number,assertCurrent:LeaseGuard})=>Promise<FinanceLeaseReceipt|LocalLease>} LeaseClaim */
/** @typedef {{setTimer?:(run:()=>Promise<void>,delay:number)=>number,clearTimer?:(timer:number)=>void,ttlSeconds?:number}} HeartbeatTimers */

/**
 * Owns one wakeup and one accepted renewal for a captured lease. Closing stops
 * future renewal immediately; its promise joins accepted work before release.
 * A renewal cannot adopt a replacement token/epoch or confirm a document ACK.
 * Explicit local grants allocate no cloud heartbeat resources.
 * @param {HeartbeatLease} lease
 * @param {LeaseClaim} claim
 * @param {HeartbeatTimers} [options]
 * @returns {{assertCurrent:()=>void,stop:()=>Promise<void>}}
 */
export function startFinanceLeaseHeartbeat(
  lease,
  claim,
  { ttlSeconds = 1200, setTimer = setTimeout, clearTimer = clearTimeout } = {}
) {
  if (lease?.acquired !== true || typeof lease.assertCurrent !== 'function') {
    throw new TypeError('finance_lease_heartbeat_authority_required');
  }
  if (
    typeof claim !== 'function' ||
    typeof setTimer !== 'function' ||
    typeof clearTimer !== 'function' ||
    !Number.isSafeInteger(ttlSeconds) ||
    ttlSeconds < 60 ||
    ttlSeconds > 1800
  ) {
    throw new TypeError('finance_lease_heartbeat_ports_required');
  }
  const assertOwner = lease.assertCurrent;
  assertOwner();
  if (lease.localOnly === true) {
    const drained = Promise.resolve();
    return { assertCurrent: assertOwner, stop: () => drained };
  }
  const { leaseName, leaseToken, fenceEpoch } = lease;
  if (
    (leaseName !== 'bank' && leaseName !== 'credit') ||
    typeof leaseToken !== 'string' ||
    !leaseToken.trim() ||
    leaseToken.length > 200 ||
    !Number.isSafeInteger(fenceEpoch) ||
    fenceEpoch < 1
  ) {
    throw new TypeError('finance_lease_heartbeat_receipt_required');
  }
  let stopped = false,
    failed = false;
  /** @type {unknown} */
  let failure;
  /** @type {{id:number|null}|null} */
  let wakeup = null;
  /** @type {Promise<void>|null} */
  let current = null;
  /** @type {Promise<void>|null} */
  let closed = null;

  /** @param {unknown} error */
  function fail(error) {
    // A late network rejection must not retain former-account diagnostics.
    try {
      assertOwner();
    } catch (scopeError) {
      error = scopeError;
    }
    failure = error;
    failed = true;
    stopped = true;
  }

  async function renew() {
    if (stopped) return;
    try {
      assertOwner();
      const next = await claim(leaseName, leaseToken, { ttlSeconds, assertCurrent: assertOwner });
      assertOwner();
      if (
        next?.acquired !== true ||
        'localOnly' in next ||
        next.leaseName !== leaseName ||
        next.leaseToken !== leaseToken ||
        next.fenceEpoch !== fenceEpoch
      ) {
        throw Object.assign(new Error('stale_finance_sync_fence'), {
          code: 'stale_finance_sync_fence',
        });
      }
    } catch (error) {
      fail(error);
    }
  }

  function schedule() {
    const scheduled = { id: /** @type {number|null} */ (null) };
    wakeup = scheduled;
    scheduled.id = setTimer(
      () => {
        // A cleared callback, including one already queued by the platform, can
        // neither overlap a renewal nor create a second scheduling chain.
        if (stopped || wakeup !== scheduled) return current || Promise.resolve();
        wakeup = null;
        current = Promise.resolve()
          .then(renew)
          .finally(() => {
            current = null;
            if (!stopped) {
              try {
                schedule();
              } catch (error) {
                wakeup = null;
                fail(error);
              }
            }
          });
        return current;
      },
      (ttlSeconds * 1000) / 3
    );
  }
  schedule();

  function assertCurrent() {
    assertOwner();
    if (failed) throw failure;
  }
  function stop() {
    if (closed) return closed;
    stopped = true;
    if (wakeup?.id !== null && wakeup?.id !== undefined) clearTimer(wakeup.id);
    wakeup = null;
    closed = current || Promise.resolve();
    return closed;
  }
  return { assertCurrent, stop };
}
