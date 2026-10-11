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
  /** @type {Set<(scope:AccountIdentity)=>void>} */
  const listeners=new Set();
  function publish(){const value={owner,epoch};for(const listener of listeners){try{listener(value)}catch(error){console.error('account scope observer',error)}}}
  /** @param {AccountSession} value */
  const identity=value=>String(value?.user?.id||'').trim()||null;
  /** @param {AccountSession} value @returns {AccountIdentity} */
  function observe(value){const live=identity(value);if(live!==owner){owner=live;epoch+=1;publish()}return {owner,epoch}}
  function current(){return observe(loadSession())}
  /** @param {AccountSession} value @param {{refresh?:boolean}} [options] */
  function replace(value,{refresh=false}={}){
    const live=identity(value);
    const changed=!refresh||live!==owner;
    if(changed)epoch+=1;
    owner=live;
    if(changed)publish();
  }
  /** @param {AccountIdentity} observed */
  function assertCurrent(observed){
    const live=current();
    if(!live.owner||live.owner!==observed.owner||live.epoch!==observed.epoch)
      throw Object.assign(new Error('ההתחברות לענן השתנתה במהלך הבקשה. יש לבצע את הפעולה מחדש.'),{code:'cloud_auth_scope_changed'});
  }
  /** @param {(scope:AccountIdentity)=>void} listener */
  function subscribe(listener){current();listeners.add(listener);return ()=>{listeners.delete(listener)}}
  return {current,replace,assertCurrent,subscribe};
}
