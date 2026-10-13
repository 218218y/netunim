// @ts-check
/** @typedef {()=>undefined} BridgePairingGuard */
/** @typedef {{capture:()=>BridgePairingGuard,dispose:()=>boolean}} BridgePairingScope */
function changed() {
  return Object.assign(
    new Error(
      'החיבור המקומי ל-Bank Bridge השתנה או אינו זמין. יש לבדוק את החיבור ולנסות שוב; הנתונים הקודמים נשמרו.'
    ),
    { code: 'BRIDGE_PAIRING_SCOPE_CHANGED' }
  );
}
/**
 * Device authority is independent of cloud account/lease cleanup. Unreadable
 * token storage invalidates evidence without exposing storage error details.
 * @param {{readToken:()=>string}} port @returns {BridgePairingScope}
 */
export function createBridgePairingScope({ readToken }) {
  if (typeof readToken !== 'function') throw new TypeError('bridge_pairing_reader_required');
  let active = true,
    observed = false,
    token = '',
    available = false,
    epoch = 0;
  function observe() {
    let live = '',
      readable = true;
    try {
      live = readToken();
    } catch {
      readable = false;
    }
    if (typeof live !== 'string') readable = false;
    if (!observed || readable !== available || live !== token) {
      observed = true;
      token = typeof live === 'string' ? live : '';
      available = readable;
      epoch++;
    }
    return { token, available, epoch };
  }
  return {
    capture() {
      if (!active) throw changed();
      const permit = observe();
      if (!permit.available || !permit.token) throw changed();
      return () => {
        if (!active) throw changed();
        const live = observe();
        if (
          !live.available ||
          !live.token ||
          live.token !== permit.token ||
          live.epoch !== permit.epoch
        )
          throw changed();
      };
    },
    dispose() {
      if (!active) return false;
      active = false;
      epoch++;
      return true;
    },
  };
}
