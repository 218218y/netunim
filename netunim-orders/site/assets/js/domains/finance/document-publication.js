// @ts-check

/** @typedef {() => void} FinanceGuard */
/** @typedef {{minimumRevision?:number,minimumFinanceRevision?:number}} FinanceReadoutHeads */
/** @typedef {{force:true,renderIfChanged:true,assertCurrent:FinanceGuard} & FinanceReadoutHeads} FinanceReadoutRequest */
/** @typedef {{published:boolean,publicationWarning:string}} FinancePublication */

export const FINANCE_PUBLICATION_WARNING =
  'הנתונים נשמרו בענן, אך רענון התצוגה לאחר השמירה לא אומת. יש לרענן שוב.';

/** @param {{refresh:(options:FinanceReadoutRequest)=>Promise<unknown>}} ports */
export function createFinanceReadoutPublication({ refresh }) {
  if (typeof refresh !== 'function') throw new TypeError('orders_finance_readout_refresh_required');
  const refreshKupaReadout = refresh,
    publicationWarning = FINANCE_PUBLICATION_WARNING;
  /** @param {FinanceGuard} assertCurrent @param {FinanceReadoutHeads} minimumHeads @returns {Promise<FinancePublication>} */
  async function confirmCommittedReadout(assertCurrent, minimumHeads) {
    const published =
      (await refreshKupaReadout({
        force: true,
        renderIfChanged: true,
        assertCurrent,
        ...minimumHeads,
      })) === true;
    assertCurrent();
    return { published, publicationWarning: published ? '' : publicationWarning };
  }
  return confirmCommittedReadout;
}
