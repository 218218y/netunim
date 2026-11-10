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

const TERMINAL_REFRESH_CODES = new Set([
  'refresh_token_not_found', 'refresh_token_already_used', 'session_expired', 'session_not_found',
]);

// Supabase documents these codes as evidence that the credential or session
// is gone. Keep the login on all other failures, including unknown 4xx.
// https://supabase.com/docs/guides/auth/debugging/error-codes
/** @param {Response} response @param {{error_code?:string,code?:string}|null} body */
export function recoverableAuthRefreshError(response, body) {
  const status = response.status;
  const reason = body?.error_code ?? body?.code ?? '';
  const timedOut = status === 408 || reason === 'request_timeout';
  if ([400, 401, 403].includes(status) && TERMINAL_REFRESH_CODES.has(reason)) return null;
  const code = timedOut ? 'SUPABASE_NETWORK_TIMEOUT' :
    status === 429 || reason === 'over_request_rate_limit' ? 'SUPABASE_AUTH_REFRESH_RATE_LIMIT' :
    'SUPABASE_AUTH_REFRESH_UNAVAILABLE';
  return Object.assign(authRefreshFailure(code), {
    status, response: {status, headers: response.headers},
  });
}

/** @param {string} code */
function authRefreshFailure(code) {
  return Object.assign(new Error('חידוש ההתחברות לענן אינו זמין כרגע. אפשר לנסות שוב.'), {code});
}

// One attempt, with a deadline covering headers and the entire body. The
// caller may recover on a later sync/reconnect. Supabase can recover a lost
// rotation receipt when the token presented is the active token's parent.
// https://supabase.com/docs/guides/auth/sessions#what-is-refresh-token-reuse-detection-and-what-does-it-protect-from
/**
 * @param {string} baseUrl @param {HeadersInit} headers @param {string} refreshToken
 * @param {{fetchRequest:typeof fetch, createController:()=>AbortController,
 *   setTimer:typeof setTimeout, clearTimer:typeof clearTimeout}} ports
 */
export async function requestAuthRefresh(baseUrl, headers, refreshToken, {fetchRequest, createController, setTimer, clearTimer}) {
  const controller = createController();
  /** @type {ReturnType<typeof setTimer> | undefined} */
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimer(() => {
      reject(authRefreshFailure('SUPABASE_NETWORK_TIMEOUT'));
      controller.abort();
    }, 20_000);
  });
  const request = async () => {
    try {
      const response = await fetchRequest(`${baseUrl}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST', headers, body: JSON.stringify({refresh_token: refreshToken}), signal: controller.signal,
      });
      const body = await response.json().catch(error => {
        if (!(error instanceof SyntaxError)) throw error;
        return null;
      });
      return {response, body};
    } catch {
      throw authRefreshFailure('SUPABASE_NETWORK_UNAVAILABLE');
    }
  };
  try {
    return await Promise.race([request(), deadline]);
  } finally {
    clearTimer(timer);
  }
}

/** @param {unknown} previous @param {unknown} current */
export function assertRefreshTokenCurrent(previous, current) {
  if (previous !== current) {
    throw Object.assign(new Error('ההתחברות לענן השתנתה במהלך חידוש ההתחברות.'), {
      code: 'cloud_auth_scope_changed',
    });
  }
}

/** @param {{user?:{id?:string},access_token?:unknown,refresh_token?:unknown}|null} session @param {string|null} owner */
export function assertRefreshReceipt(session, owner) {
  if (!session || session.user?.id !== owner || typeof session.access_token !== 'string' || !session.access_token.trim() ||
      typeof session.refresh_token !== 'string' || !session.refresh_token.trim()) {
    throw Object.assign(new Error('חידוש ההתחברות לענן החזיר תשובה לא תקינה. אפשר לנסות שוב.'), {
      code: 'SUPABASE_AUTH_REFRESH_UNAVAILABLE',
    });
  }
}
