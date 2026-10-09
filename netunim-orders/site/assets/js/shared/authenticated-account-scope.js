// @ts-check

/**
 * @typedef {{user?:{id?:string}}|null|undefined} AccountSession
 * @typedef {{owner:string|null,epoch:number}} AccountIdentity
 */

// Access-token refresh keeps the login scope. Explicit login/logout replaces
// it, even if the next login belongs to the same user.
/** @param {{loadSession: () => AccountSession}} ports */
export function createAuthenticatedAccountScope({loadSession}){
  /** @type {string|null} */
  let owner=null;
  let epoch=0;
  /** @param {AccountSession} value */
  const identity=value=>String(value?.user?.id||'').trim()||null;
  /** @param {AccountSession} value @returns {AccountIdentity} */
  function observe(value){const live=identity(value);if(live!==owner){owner=live;epoch+=1}return {owner,epoch}}
  function current(){return observe(loadSession())}
  /** @param {AccountSession} value @param {{refresh?:boolean}} [options] */
  function replace(value,{refresh=false}={}){
    const live=identity(value);
    if(!refresh||live!==owner)epoch+=1;
    owner=live;
  }
  /** @param {AccountIdentity} observed */
  function assertCurrent(observed){
    const live=current();
    if(!live.owner||live.owner!==observed.owner||live.epoch!==observed.epoch)
      throw Object.assign(new Error('ההתחברות לענן השתנתה במהלך הבקשה. יש לבצע את הפעולה מחדש.'),{code:'cloud_auth_scope_changed'});
  }
  return {current,replace,assertCurrent};
}
