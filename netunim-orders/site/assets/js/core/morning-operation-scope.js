// @ts-check
/**
 * @typedef {{account:{owner:string|null,epoch:number},storageOwner:string,readable:boolean,writable:boolean}} MorningAccess
 * @typedef {()=>undefined} MorningAssertion
 * @typedef {{capture:()=>MorningAssertion,captureRead:()=>MorningAssertion}} MorningOperationScope
 */

// A token refresh preserves the login epoch. A new login, even for the same
// user, cannot inherit an earlier issuance/recovery/publication continuation.
/** @param {{readAccess:()=>MorningAccess}} ports @returns {MorningOperationScope} */
export function createMorningOperationScope({readAccess}){
  if(typeof readAccess!=='function')throw new TypeError('morning_operation_access_required');
  const failure=()=>Object.assign(new Error('ההתחברות או הרשאת הכתיבה השתנתה. ניסיון Morning נשמר לבדיקה בחשבון המקורי; אין להפיק שוב לפני בדיקת מצב ההפקה.'),{code:'MORNING_OPERATION_SCOPE_CHANGED'});
  /** @param {boolean} readOnly */
  function observe(readOnly){
    const access=readAccess(),account=access.account;
    if(!(readOnly?access.readable:access.writable)||!account.owner||account.owner!==access.storageOwner||!Number.isSafeInteger(account.epoch)||account.epoch<0)throw failure();
    return {owner:account.owner,epoch:account.epoch};
  }
  /** @param {boolean} readOnly @returns {MorningAssertion} */
  function capture(readOnly){const observed=observe(readOnly);return ()=>{const live=observe(readOnly);if(live.owner!==observed.owner||live.epoch!==observed.epoch)throw failure()}}
  return {capture:()=>capture(false),captureRead:()=>capture(true)};
}
