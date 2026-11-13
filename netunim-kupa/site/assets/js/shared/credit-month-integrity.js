// @ts-check
/** Normalized retained records, after the current-response evidence boundary.
 * @typedef {Record<string,unknown> & {installments?:{number?:unknown,total?:unknown}|null}} Transaction
 * @typedef {{month:string,tier:string,fetchStatus:string,status:string,fetchedAt:string|null,transactions:Transaction[],lastErrorCode:string,lastErrorAt:string|null}} Month
 */
export const CREDIT_HISTORICAL_MONTH_REGRESSION='CREDIT_HISTORICAL_MONTH_REGRESSION';

/** Compare financial evidence, including multiplicity; labels/categories are
 * cosmetic. IDs alone or net sums cannot detect replacements/cancelling rows.
 * @param {Transaction} tx */
function financialKey(tx){
  return JSON.stringify([tx.id||'',tx.type,tx.status,tx.processedDate,tx.date,
    tx.chargedAmount,tx.chargedCurrency,tx.originalAmount,tx.originalCurrency,
    tx.foreignTransaction,tx.chargeAmountStatus,
    tx.installments?.number??null,tx.installments?.total??null,
    tx.id?'':tx.description]);
}

/** Calendar history is protected conservatively: the protocol has no issuer
 * statement-closed flag. Also protect completed rows whose billing day has
 * elapsed within the current month. Never infer removal authority from success,
 * recovery mode or an empty array. Late additions/refunds remain supported.
 * @param {Month|undefined} prior @param {Month} next @param {string|null} [reference]
 * @returns {Month} */
export function mergeCreditMonthSnapshot(prior,next,reference=null){
  if(next.fetchStatus!=='success')return prior&&(prior.fetchedAt||prior.transactions.length)
    ?{...prior,status:'stale',fetchStatus:next.fetchStatus,lastErrorCode:next.lastErrorCode,lastErrorAt:next.lastErrorAt}
    :{...next,status:'missing'};
  if(prior?.transactions.length){
    const at=[reference,prior.fetchedAt,next.fetchedAt].filter(Boolean).sort().at(-1)||new Date().toISOString();
    const protectedRows=prior.month<at.slice(0,7)?prior.transactions:prior.transactions.filter(tx=>
      tx.status==='completed'&&/^\d{4}-\d{2}-\d{2}/.test(String(tx.processedDate||''))&&
      String(tx.processedDate).slice(0,10)<at.slice(0,10));
    if(protectedRows.length){
      const available=new Map();
      for(const tx of next.transactions){const key=financialKey(tx);available.set(key,(available.get(key)||0)+1)}
      for(const tx of protectedRows){
        const key=financialKey(tx),count=available.get(key)||0;
        if(!count)return {...prior,status:'stale',fetchStatus:'schema_error',
          lastErrorCode:CREDIT_HISTORICAL_MONTH_REGRESSION,lastErrorAt:at};
        available.set(key,count-1);
      }
    }
  }
  return {...next,status:'fresh'};
}
