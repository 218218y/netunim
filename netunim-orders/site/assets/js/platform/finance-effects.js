/**
 * @typedef {{setTimeout:(run:()=>void,delay:number)=>number,clearTimeout:(timer:number)=>void}} FinanceTimers
 * @typedef {{navigator:{onLine?:boolean,clipboard?:{writeText:(text:string)=>Promise<void>}},document:Pick<Document,'createElement'|'body'>,URL:Pick<typeof URL,'createObjectURL'|'revokeObjectURL'>,Blob:typeof Blob}} FinanceBrowser
 * @typedef {{isOnline:()=>boolean,writeText:(text:string)=>Promise<void>,saveJson:(filename:unknown,data:unknown,fallbackName:string)=>void,delay:(milliseconds:number)=>Promise<void>,dispose:()=>boolean}} FinanceEffects
 */

// Temporary download resources belong to this adapter. A delay already awaited
// by an operation remains alive through disposal; its operation guard owns what
// may happen afterwards. Construction performs no browser work.
/** @param {{environment?:FinanceBrowser,timers?:FinanceTimers}} [ports] @returns {FinanceEffects} */
export function createFinanceBrowserEffects({environment=globalThis, timers=globalThis}={}) {
  /** @type {Set<()=>void>} */
  const downloads = new Set();
  let disposed = false;
  function assertActive() { if (disposed) throw new Error('finance_effects_disposed'); }

  /** @param {string} text */
  async function writeText(text) {
    assertActive();
    const clipboard = environment.navigator.clipboard;
    if (!clipboard?.writeText) throw new Error('הדפדפן אינו מאפשר העתקה מאובטחת ללוח');
    await clipboard.writeText(text);
  }

  /** @param {unknown} filename @param {unknown} data @param {string} fallbackName */
  function saveJson(filename, data, fallbackName) {
    assertActive();
    const name = /^[A-Za-z0-9._-]+$/.test(String(filename || '')) ? String(filename) : fallbackName;
    const blob = new environment.Blob([JSON.stringify(data ?? {}, null, 2) + '\n'], {type:'application/json;charset=utf-8'});
    const url = environment.URL.createObjectURL(blob);
    /** @type {HTMLAnchorElement|null} */
    let anchor = null;
    /** @type {number|null} */
    let timer = null;
    let released = false;
    function release() {
      if (released) return;
      released = true;
      downloads.delete(release);
      try {
        if (timer !== null) timers.clearTimeout(timer);
        anchor?.remove();
      } finally { environment.URL.revokeObjectURL(url); }
    }
    downloads.add(release);
    try {
      anchor = environment.document.createElement('a');
      anchor.href = url;
      anchor.download = name;
      environment.document.body.appendChild(anchor);
      anchor.click();
      timer = timers.setTimeout(release, 1000);
    } catch (error) {
      release();
      throw error;
    }
  }

  /** @param {number} milliseconds @returns {Promise<void>} */
  function delay(milliseconds) {
    assertActive();
    if (!Number.isFinite(milliseconds) || milliseconds < 0) throw new TypeError('finance_delay_required');
    return new Promise(resolve => timers.setTimeout(resolve, milliseconds));
  }

  function dispose() {
    if (disposed) return false;
    disposed = true;
    for (const release of [...downloads]) release();
    return true;
  }

  return {isOnline:() => !disposed && environment.navigator.onLine === true, writeText, saveJson, delay, dispose};
}
