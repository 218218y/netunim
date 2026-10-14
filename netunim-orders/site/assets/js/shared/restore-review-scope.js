// @ts-check

/** @typedef {{owner:string,generation:number}} RestoreReviewScope */
/**
 * @param {{owner:()=>string,generation:()=>number,writable:()=>boolean}} access
 */
export function createRestoreReviewScope({owner,generation,writable}){
  /** @returns {RestoreReviewScope} */
  function capture(){return {owner:owner(),generation:generation()}}

  /** @param {RestoreReviewScope} review @returns {true} */
  function assertCurrent(review){
    if(!writable()||review.owner!==owner()||review.generation!==generation()){
      throw Object.assign(new Error('הנתונים או החשבון השתנו מאז פתיחת האישור. פתח מחדש את השחזור ובדוק את הגיבוי.'),{code:'backup_restore_scope_changed'});
    }
    return true;
  }

  return {capture,assertCurrent};
}
