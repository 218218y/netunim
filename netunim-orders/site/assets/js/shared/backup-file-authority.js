// @ts-check
/** @typedef {import('./authenticated-account-scope.js').AccountIdentity} AccountIdentity */
/** @typedef {'restore'|'download'} BackupFileIntent */
/** @typedef {{assertCurrent:()=>true}} BackupFileAuthority */
/** @param {{owner:()=>string,generation:()=>number,account:()=>AccountIdentity,writable:()=>boolean}} ports */
export function createBackupFileAuthority({owner,generation,account,writable}){
  /** @param {BackupFileIntent} intent @returns {BackupFileAuthority} */
  function capture(intent){
    if(intent!=='restore'&&intent!=='download')throw new TypeError('backup_file_intent_required');
    const capturedOwner=owner(),capturedGeneration=generation(),capturedAccount=account();
    const accountOwner=capturedAccount.owner,loginEpoch=capturedAccount.epoch;
    /** @returns {true} */
    function assertCurrent(){
      const liveAccount=account();
      if(!capturedOwner||owner()!==capturedOwner||liveAccount.owner!==accountOwner||liveAccount.epoch!==loginEpoch||(intent==='restore'&&(generation()!==capturedGeneration||writable()!==true))){
        throw Object.assign(new Error('החשבון, האחסון או הנתונים השתנו מאז פתיחת קובץ הגיבוי. יש לפתוח אותו מחדש.'),{code:'backup_file_scope_changed'});
      }
      return true;
    }
    assertCurrent();return {assertCurrent};
  }
  return {capture};
}
