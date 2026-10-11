// @ts-check
/** @typedef {import('./authenticated-account-scope.js').AccountIdentity} AccountIdentity */
/** @typedef {import('./authenticated-account-scope.js').AccountSession} AccountSession */
/** @typedef {ReturnType<typeof import('./authenticated-account-scope.js').createAuthenticatedAccountScope>} AccountScope */
// Auth owns credentials and epochs; browser notifications trigger a fresh read,
// never an adoption of event.newValue or a write to an outbox/credential store.
/** @param {{scope:AccountScope,sessionKey:string,rereadSession:()=>AccountSession,windowTarget?:Window,documentTarget?:Document}} ports */
export function createBrowserAccountObservation({scope,sessionKey,rereadSession,windowTarget=globalThis.window,documentTarget=globalThis.document}){
  /** @type {Set<(scope:AccountIdentity)=>void>} */
  const listeners=new Set();
  /** @type {(()=>void)|null} */
  let unsubscribe=null;
  /** @param {string|null} raw */
  const owner=raw=>{try{return String(JSON.parse(raw||'null')?.user?.id||'').trim()||null}catch{return null}};
  /** @param {StorageEvent} event */
  function storage(event){
    if(event.key!==sessionKey&&event.key!==null)return;
    if(event.storageArea&&event.storageArea!==windowTarget.localStorage)return;
    // Token refresh within one owner preserves its login epoch. Logout/login
    // events advance it even if the current persisted value already is A again.
    const oldOwner=owner(event.oldValue),newOwner=owner(event.newValue);
    scope.replace(rereadSession(),{refresh:event.key!==null&&!!oldOwner&&oldOwner===newOwner});
  }
  function recheck(){rereadSession();scope.current()}
  function visibility(){if(!documentTarget.hidden)recheck()}
  function start(){
    recheck();
    unsubscribe=scope.subscribe(value=>{for(const listener of listeners){try{listener(value)}catch(error){console.error('browser account observer',error)}}});
    windowTarget?.addEventListener('storage',storage);
    windowTarget?.addEventListener('focus',recheck);
    documentTarget?.addEventListener('visibilitychange',visibility);
  }
  function stop(){
    unsubscribe?.();unsubscribe=null;
    windowTarget?.removeEventListener('storage',storage);
    windowTarget?.removeEventListener('focus',recheck);
    documentTarget?.removeEventListener('visibilitychange',visibility);
  }
  /** @param {(scope:AccountIdentity)=>void} listener */
  function subscribe(listener){
    if(typeof listener!=='function')throw new Error('account_scope_listener_required');
    if(!listeners.size)start();listeners.add(listener);
    let removed=false;
    return ()=>{if(removed)return;removed=true;listeners.delete(listener);if(!listeners.size)stop()};
  }
  return {subscribe};
}
