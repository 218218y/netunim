// @ts-check

// This name identifies the physical Calendar queue, not a login or an instance.
// All tabs on this origin must serialize delivery even when their scopes differ.
const DELIVERY_LOCK='netunim-orders-calendar-delivery';

/**
 * @param {{locks?:Pick<LockManager,'request'>|null}} [ports]
 */
export function createCalendarDeliveryOwner({locks=globalThis.navigator?.locks}={}){
  /**
   * Hold ownership through the entire remote request and durable queue ACK.
   * Logout/dispose is checked again when a queued request gets the lock. Once
   * work starts, cleanup cannot release the lock ahead of that work's settlement.
   * @template T
   * @param {()=>void} assertCurrent
   * @param {()=>Promise<T>} work
   * @param {{signal?:AbortSignal}} [options]
   * @returns {Promise<T>}
   */
  async function run(assertCurrent,work,{signal}={}){
    assertCurrent();
    if(typeof locks?.request!=='function'){
      throw Object.assign(new Error('הדפדפן אינו מאפשר בעלות בטוחה על שליחת היומן. השינויים נשארו בתור המקומי; פתח את האתר בחיבור מאובטח בדפדפן Chrome או Edge מעודכן.'),{code:'CALENDAR_DELIVERY_UNAVAILABLE'});
    }
    // Native cancellation removes only an ungranted request. It never aborts a
    // started delivery or frees ownership while that delivery is still running.
    return locks.request(DELIVERY_LOCK,{mode:'exclusive',...(signal?{signal}:{})},async lock=>{
      assertCurrent();
      if(!lock)throw Object.assign(new Error('לא התקבלה בעלות על שליחת היומן. השינויים נשארו בתור המקומי.'),{code:'CALENDAR_DELIVERY_UNAVAILABLE'});
      return work();
    });
  }
  return {run};
}
