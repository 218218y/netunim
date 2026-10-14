// @ts-check
import { startFinanceLeaseHeartbeat } from './finance-lease-heartbeat.js';

/** @typedef {import('./finance-lease-receipt.js').FinanceLeaseName} LeaseName */
/** @typedef {import('./finance-lease-heartbeat.js').LeaseGuard} LeaseGuard */
/** @typedef {import('./finance-lease-receipt.js').FinanceLeaseReceipt | import('./finance-lease-heartbeat.js').LocalLease} LeaseGrant */
/** @typedef {LeaseGrant & {assertCurrent:LeaseGuard}} OperationLease */
/** @typedef {{ready:Promise<OperationLease>,assertCurrent:LeaseGuard,close:()=>Promise<void>}} LeaseSession */
/** @typedef {{leases:{claim:(name:LeaseName,token:string,options:{assertCurrent:LeaseGuard,ttlSeconds?:number})=>Promise<LeaseGrant>,release:(name:LeaseName,token:string,options:{assertCurrent:LeaseGuard})=>Promise<unknown>},authority:{capture:()=>LeaseGuard},timers?:{setTimeout:(run:()=>Promise<void>,delay:number)=>number,clearTimeout:(id:number)=>void}}} LeaseOwnerPorts */

/**
 * Each accepted operation owns acquisition, one heartbeat and one cleanup.
 * Disposal stops renewal immediately, while close joins accepted acquisition
 * and renewal before releasing. The caller closes after its provider/commit
 * settles; disposing never releases a lease underneath accepted provider work.
 * Account/storage authority is captured independently of component lifetime
 * and device pairing, so cleanup cannot borrow a new login's authorization.
 * Neither a ready lease nor a drained runtime confirms a document write.
 * @param {LeaseOwnerPorts} ports
 */
export function createFinanceLeaseOwner({ leases, authority, timers = globalThis }) {
  for (const method of /** @type {const} */ (['claim', 'release']))
    if (typeof leases?.[method] !== 'function')
      throw new TypeError(`finance_lease_${method}_required`);
  if (typeof authority?.capture !== 'function')
    throw new TypeError('finance_lease_authority_required');
  for (const method of /** @type {const} */ (['setTimeout', 'clearTimeout']))
    if (typeof timers?.[method] !== 'function')
      throw new TypeError(`finance_lease_timer_${method}_required`);
  let disposed = false;
  /** @type {Set<{stop:()=>void,finished:Promise<void>}>} */
  const sessions = new Set();
  const scopeError = () =>
    Object.assign(new Error('פעולת הסנכרון נסגרה. הנתונים הקודמים נשמרו; יש לרענן שוב.'), {
      code: 'FINANCE_OPERATION_SCOPE_CHANGED',
    });

  /** @param {LeaseName} name @param {string} token @param {{assertCurrent:LeaseGuard}} options @returns {LeaseSession} */
  function acquire(name, token, { assertCurrent: assertOperation }) {
    if (disposed) throw scopeError();
    if (
      (name !== 'bank' && name !== 'credit') ||
      typeof token !== 'string' ||
      !token.trim() ||
      token.length > 200
    )
      throw new TypeError('finance_lease_request_required');
    if (typeof assertOperation !== 'function')
      throw new TypeError('finance_lease_operation_required');
    const assertOwner = authority.capture();
    if (typeof assertOwner !== 'function')
      throw new TypeError('finance_lease_captured_authority_required');
    assertOwner();
    assertOperation();
    let held = false;
    /** @type {ReturnType<typeof startFinanceLeaseHeartbeat>|null} */
    let heartbeat = null;
    /** @type {Promise<void>|null} */
    let closing = null;
    /** @type {()=>void} */
    let finish = () => {};
    const finished = new Promise(
      /** @param {(value?:void)=>void} resolve */ (resolve) => {
        finish = resolve;
      }
    );
    const record = {
      stop: () => {
        void heartbeat?.stop();
      },
      finished,
    };
    sessions.add(record);

    function assertCurrent() {
      assertOwner();
      assertOperation();
      if (disposed || closing) throw scopeError();
      heartbeat?.assertCurrent();
      return undefined;
    }

    const ready = (async () => {
      try {
        const grant = await leases.claim(name, token, { assertCurrent: assertOwner });
        if (grant?.acquired === true) {
          if (
            !('localOnly' in grant && grant.localOnly === true) &&
            (!('leaseName' in grant) || grant.leaseName !== name || grant.leaseToken !== token)
          )
            throw new TypeError('finance_lease_grant_identity_invalid');
          held = true;
        } else if (grant?.acquired !== false) throw new TypeError('finance_lease_grant_required');
        assertCurrent();
        if (grant.acquired === true)
          heartbeat = startFinanceLeaseHeartbeat(
            { ...grant, assertCurrent: assertOwner },
            leases.claim,
            {
              setTimer: timers.setTimeout.bind(timers),
              clearTimer: timers.clearTimeout.bind(timers),
            }
          );
        return Object.freeze({ ...grant, assertCurrent });
      } catch (error) {
        // A late transport failure cannot publish diagnostics from a retired
        // account, pairing or component, even if the transport omitted a guard.
        assertCurrent();
        throw error;
      }
    })();
    // Closing is valid even when ready was never awaited by the caller.
    void ready.catch(() => {});

    function close() {
      if (closing) return closing;
      record.stop();
      closing = (async () => {
        try {
          await Promise.allSettled([ready]);
          await heartbeat?.stop();
          if (held) {
            assertOwner();
            await leases.release(name, token, { assertCurrent: assertOwner });
          }
        } finally {
          sessions.delete(record);
          finish();
        }
      })();
      return closing;
    }
    return { ready, assertCurrent, close };
  }
  const runtime = {
    isPending: () => sessions.size > 0,
    async drain() {
      while (sessions.size) await Promise.all([...sessions].map((record) => record.finished));
    },
    dispose() {
      if (disposed) return false;
      disposed = true;
      for (const record of sessions) record.stop();
      return true;
    },
  };
  return { commands: { acquire }, runtime };
}
