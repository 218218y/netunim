// @ts-check
import {googleCalendarConfig} from './config.js';
/** @typedef {{owner:string|null,epoch:number}} AccountScope */
/** @typedef {{accessToken:string,tokenExpiresAt:number,connected:boolean,accountVerified:boolean,accountId:string,expectedAccountId:string}} CalendarAuthState */
/** @typedef {{assertCurrent:()=>void,accessToken:()=>string}} CalendarOperation */
/** @param {unknown} value @returns {value is Record<string,unknown>} */
function object(value){return value!==null&&typeof value==='object'&&!Array.isArray(value)}
/** @param {unknown} error */
function code(error){return object(error)?String(error.code||''):''}
/** @param {unknown} error */
function message(error){return error instanceof Error?error.message:object(error)?String(error.message||''):String(error)}
/** @param {string} text @param {string} errorCode */
function failure(text,errorCode){return Object.assign(new Error(text),{code:errorCode})}

/**
 * Credentials and recovery belong to one authenticated login epoch. Revoking
 * that epoch stops requests/publication, never deletes durable Calendar events.
 * @param {{calendarSession:CalendarAuthState,supaFetch:(path:string,options:{method:string,body:string,assertRequestScope:()=>void})=>Promise<Response>,accountScope:()=>AccountScope}} ports
 */
export function createCalendarAuth({calendarSession,supaFetch,accountScope}){
  if(typeof accountScope!=='function')throw new TypeError('calendar_account_scope_required');
  /** @type {string|null} */ let owner=null;
  /** @type {number|null} */ let authEpoch=null;
  let epoch=0,recoveryFailures=0,recoveryBlockedUntil=0;
  const recoveryDelays=[15_000,30_000,60_000,120_000];
  /** @type {{promise:Promise<string>}|null} */ let pendingRestore=null;
  function configured(){return typeof supaFetch==='function'&&/^\/functions\/v1\//.test(String(googleCalendarConfig.backendPath||''))}
  function clearAccess(){calendarSession.accessToken='';calendarSession.tokenExpiresAt=0;calendarSession.connected=false;calendarSession.accountVerified=false}
  function resetRecovery(){recoveryFailures=0;recoveryBlockedUntil=0}
  function invalidate(){epoch++;clearAccess();pendingRestore=null;resetRecovery()}
  function observe(){
    const scope=accountScope();
    if(!scope||!Number.isSafeInteger(scope.epoch)||scope.epoch<0||!(scope.owner===null||typeof scope.owner==='string'))throw new TypeError('calendar_account_scope_invalid');
    const live=String(scope.owner||'').trim()||null;
    if(live!==owner||scope.epoch!==authEpoch){owner=live;authEpoch=scope.epoch;invalidate()}
    return {owner,epoch};
  }
  function enter(){
    const observed=observe();
    if(!observed.owner)throw failure('נדרשת התחברות לענן לפני חיבור Google Calendar','calendar_cloud_auth_required');
    return ()=>{const live=observe();if(!live.owner||live.owner!==observed.owner||live.epoch!==observed.epoch)throw failure('חשבון הענן או חיבור היומן השתנה במהלך הפעולה. השינויים הממתינים נשמרו; יש להתחבר מחדש ולרענן.','CALENDAR_OPERATION_SCOPE_CHANGED')};
  }
  function hasUsableToken(){observe();return !!owner&&!!calendarSession.accessToken&&calendarSession.tokenExpiresAt>Date.now()+30_000}
  function authRequiredError(){return failure('נדרשת התחברות ליומן Google','calendar_auth_required')}
  function clearToken(){observe();invalidate()}
  /** A late 401 revokes only the credential actually sent. @param {string} token */
  function rejectToken(token){observe();if(calendarSession.accessToken===token)clearAccess()}
  /** @param {Record<string,unknown>} data @param {number} status */
  function backendError(data,status){
    const errorCode=String(data.code||'calendar_oauth_backend_error');let text=String(data.message||'').trim();
    if(errorCode==='calendar_not_connected')text='יומן Google עדיין לא חובר לחשבון המשתמש הזה';
    else if(errorCode==='calendar_reconnect_required')text=data.reason==='google_invalid_grant'?'Google דחתה את ה-Refresh Token. אם הפרויקט מוגדר Testing, הרשאות בדיקה פגות אחרי 7 ימים; יש להעביר את Google Auth Platform ל-In production ואז לבצע חיבור חד-פעמי מחדש.':'ההרשאה ל-Google פגה או בוטלה. יש לבצע חיבור חד-פעמי מחדש.';
    else if(errorCode==='calendar_data_api_unavailable')text='שירות נתוני היומן אינו זמין זמנית; החיבור יתחדש אוטומטית';
    else if(status===401||errorCode==='calendar_cloud_auth_required')text='נדרשת התחברות לענן לפני חיבור Google Calendar';
    else if(!text)text='שירות החיבור ל-Google Calendar אינו זמין';
    return Object.assign(failure(text,errorCode),{status});
  }
  function recoveryError(){return Object.assign(backendError({code:'calendar_data_api_unavailable'},503),{retryAfterMs:Math.max(0,recoveryBlockedUntil-Date.now())})}
  function tripRecovery(){const delay=recoveryDelays[Math.min(recoveryFailures,recoveryDelays.length-1)]||120_000;recoveryFailures=Math.min(recoveryFailures+1,recoveryDelays.length);recoveryBlockedUntil=Math.max(recoveryBlockedUntil,Date.now()+delay)}
  /** @param {()=>void} assertCurrent @param {string} action @param {Record<string,unknown>} [payload] @param {{background?:boolean}} [options] */
  async function backend(assertCurrent,action,payload={},{background=false}={}){
    assertCurrent();if(!configured())throw new Error('Google Calendar backend אינו מוגדר');
    if(background&&Date.now()<recoveryBlockedUntil)throw recoveryError();
    let response;
    try{response=await supaFetch(googleCalendarConfig.backendPath,{method:'POST',body:JSON.stringify({action,...payload}),assertRequestScope:assertCurrent})}
    catch(error){
      assertCurrent();
      if(code(error)==='cloud_auth_required'||message(error).includes('לענן'))throw failure('נדרשת התחברות לענן לפני חיבור Google Calendar','calendar_cloud_auth_required');
      if(background){tripRecovery();throw Object.assign(error instanceof Error?error:new Error(message(error)),{retryAfterMs:Math.max(0,recoveryBlockedUntil-Date.now())})}
      throw error;
    }
    assertCurrent();const raw=await response.json().catch(()=>null);assertCurrent();const data=object(raw)?raw:{};
    if(!response.ok){const error=backendError(data,response.status);if(background&&(error.code==='calendar_data_api_unavailable'||[502,503,504].includes(response.status))){tripRecovery();throw Object.assign(error,{retryAfterMs:Math.max(0,recoveryBlockedUntil-Date.now())})}throw error}
    resetRecovery();return data;
  }
  /** @param {Record<string,unknown>} data */
  function acceptToken(data){
    const token=typeof data.access_token==='string'?data.access_token:'';if(!token)throw authRequiredError();
    const expiresIn=Number(data.expires_in??3600),expiresAt=Date.now()+expiresIn*1000;
    if(!Number.isFinite(expiresIn)||expiresIn<=0||!Number.isFinite(expiresAt))throw failure('שירות היומן החזיר תוקף הרשאה לא תקין','calendar_oauth_token_invalid');
    calendarSession.accessToken=token;calendarSession.tokenExpiresAt=expiresAt;calendarSession.connected=true;calendarSession.accountVerified=false;
    const accountId=typeof data.account_id==='string'?data.account_id.trim():'';if(accountId){calendarSession.accountId=accountId;calendarSession.expectedAccountId=accountId}
    return token;
  }
  async function restore(){
    const assertCurrent=enter();if(hasUsableToken())return calendarSession.accessToken;if(pendingRestore)return pendingRestore.promise;
    const task={promise:backend(assertCurrent,'token',{}, {background:true}).then(data=>{assertCurrent();return acceptToken(data)})
      .catch(error=>{assertCurrent();clearAccess();throw error}).finally(()=>{if(pendingRestore===task)pendingRestore=null})};
    pendingRestore=task;
    return task.promise;
  }
  async function beginConnect({returnUrl=''}={}){
    clearToken();const assertCurrent=enter(),data=await backend(assertCurrent,'start',{return_url:String(returnUrl||globalThis.location?.href||'')});assertCurrent();
    const url=String(data.authorize_url||'');if(!/^https:\/\/accounts\.google\.com\//.test(url))throw failure('שירות החיבור ל-Google לא החזיר כתובת הרשאה תקינה','calendar_oauth_start_invalid');
    globalThis.location.assign(url);return false;
  }
  function accessToken(){enter();if(!hasUsableToken())throw authRequiredError();return calendarSession.accessToken}
  /** @returns {CalendarOperation} */
  function captureOperation(){const assertCurrent=enter();return {assertCurrent,accessToken:()=>{assertCurrent();return accessToken()}}}
  async function disconnect(){const assertCurrent=enter();await backend(assertCurrent,'disconnect');assertCurrent();clearToken()}
  async function prepare(){return configured()}
  function ready(){return configured()}
  return {configured,hasUsableToken,prepare,ready,restore,beginConnect,accessToken,captureOperation,rejectToken,clearToken,disconnect,authRequiredError};
}
