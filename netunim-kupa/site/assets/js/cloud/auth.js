import {supabaseConfig as SUPA_CONFIG} from '../../../supabase/config.js';
import {SUPA_SESSION_KEY, SUPA_SESSION_IDB_KEY, SUPA_EMAIL_KEY, SUPA_AUTO_KEY} from '../state/constants.js';
import {createDataApiScheduler} from '../shared/cloud-sync.js';

const SUPA_NETWORK_ATTEMPTS=3;
const SUPA_NETWORK_TIMEOUT_MS=20*1000;
const SUPA_BACKGROUND_TIMEOUT_MS=8*1000;
const SUPA_NETWORK_BACKOFF_MS=[500,1500];
const SUPA_DATA_API_BACKOFF_MS=[15_000,30_000,60_000,120_000];
const SUPA_DATA_API_RETRY_STATUSES=new Set([502,503,504]);
let supaDataApiFailureCount=0;
let supaDataApiBlockedUntil=0;
let refreshPromise=null;

function isSupaDataApiPath(path){return /^\/rest\/v1(?:\/|\?|$)/.test(String(path||''))}
function supaDataApiBackoffError(){const retryAfterMs=Math.max(0,supaDataApiBlockedUntil-Date.now()),e=new Error(`Supabase Data API במצב התאוששות. ניסיון נוסף יתבצע בעוד ${Math.max(1,Math.ceil(retryAfterMs/1000))} שניות.`);e.code='SUPABASE_DATA_API_BACKOFF';e.retryAfterMs=retryAfterMs;return e}
function resetSupaDataApiBreaker(){supaDataApiFailureCount=0;supaDataApiBlockedUntil=0}
function tripSupaDataApiBreaker(){const index=Math.min(supaDataApiFailureCount,SUPA_DATA_API_BACKOFF_MS.length-1),delay=SUPA_DATA_API_BACKOFF_MS[index];supaDataApiFailureCount=Math.min(supaDataApiFailureCount+1,SUPA_DATA_API_BACKOFF_MS.length);supaDataApiBlockedUntil=Math.max(supaDataApiBlockedUntil,Date.now()+delay);return delay}
function isSupaDataApiTransportFailure(error){return ['SUPABASE_NETWORK_TIMEOUT','SUPABASE_NETWORK_UNAVAILABLE'].includes(String(error?.code||''))}
const supaDataApiScheduler=createDataApiScheduler({maxHighBurst:4,canRun:()=>Date.now()>=supaDataApiBlockedUntil});
async function withSupaDataApiSlot(path,request,{priority='low',coalesceKey=''}={}){
  if(!isSupaDataApiPath(path))return request();
  const scheduled=supaDataApiScheduler.schedule(async()=>{
    if(Date.now()<supaDataApiBlockedUntil)throw supaDataApiBackoffError();
    try{
      const response=await request();
      if(SUPA_DATA_API_RETRY_STATUSES.has(Number(response?.status)))tripSupaDataApiBreaker();else resetSupaDataApiBreaker();
      return response;
    }catch(error){if(isSupaDataApiTransportFailure(error))tripSupaDataApiBreaker();throw error}
  },{priority,key:coalesceKey,blockedError:supaDataApiBackoffError});
  return scheduled.then(response=>typeof response?.clone==='function'?response.clone():response);
}

function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms))}
function isSupaNetworkError(error){const name=String(error?.name||''),message=String(error?.message||error||'').toLowerCase();return name==='AbortError'||name==='TypeError'||message.includes('failed to fetch')||message.includes('networkerror')||message.includes('load failed')}
function supaNetworkFailure(error){const timedOut=String(error?.name||'')==='AbortError',e=new Error(timedOut?'החיבור ל-Supabase לא הגיב בזמן גם לאחר ניסיונות חוזרים.':'לא ניתן להגיע כרגע ל-Supabase גם לאחר ניסיונות חוזרים.');e.code=timedOut?'SUPABASE_NETWORK_TIMEOUT':'SUPABASE_NETWORK_UNAVAILABLE';e.cause=error;return e}
async function fetchSupaNetwork(url,options,{retry=false,timeoutMs=SUPA_NETWORK_TIMEOUT_MS}={}){
  const attempts=retry?SUPA_NETWORK_ATTEMPTS:1;let lastError=null;
  for(let attempt=0;attempt<attempts;attempt++){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.max(1000,Number(timeoutMs)||SUPA_NETWORK_TIMEOUT_MS));
    try{return await fetch(url,{...options,signal:controller.signal})}
    catch(error){lastError=error;if(!isSupaNetworkError(error)||attempt+1>=attempts)throw supaNetworkFailure(error);await sleep(SUPA_NETWORK_BACKOFF_MS[Math.min(attempt,SUPA_NETWORK_BACKOFF_MS.length-1)])}
    finally{clearTimeout(timer)}
  }
  throw supaNetworkFailure(lastError);
}

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createCloudAuth({session, idbGet, idbPut, idbDelete, supaProjectRef, setCloudHeaderStatus}){
function supaConfigured(){return !!(SUPA_CONFIG.url&&SUPA_CONFIG.publishableKey)}

function loadSupaSession(){if(session.supaSession)return session.supaSession;try{session.supaSession=JSON.parse(localStorage.getItem(SUPA_SESSION_KEY)||'null')}catch(e){session.supaSession=null}return session.supaSession}

async function restoreSupaSession(){let s=loadSupaSession();if(s)return s;try{s=await idbGet('sync',SUPA_SESSION_IDB_KEY);if(s){session.supaSession=s;try{localStorage.setItem(SUPA_SESSION_KEY,JSON.stringify(s))}catch(e){}}}catch(e){}return s||null}

function storeSupaSession(s){session.supaSession=s||null;try{if(s)localStorage.setItem(SUPA_SESSION_KEY,JSON.stringify(s));else localStorage.removeItem(SUPA_SESSION_KEY)}catch(e){};if(s)idbPut('sync',SUPA_SESSION_IDB_KEY,s).catch(()=>{});else idbDelete('sync',SUPA_SESSION_IDB_KEY).catch(()=>{})}

function isSupabaseAuthError(e){const m=String(e?.message||e||'').toLowerCase();return m.includes('invalid login credentials')||m.includes('invalid_credentials')||m.includes('jwt')||m.includes('refresh token')||m.includes('פג תוקף')||m.includes('נדרשת התחברות')}

function friendlySupabaseError(e){const m=String(e?.message||e||'');if(/invalid login credentials|invalid_credentials/i.test(m))return `האימייל או הסיסמה אינם תקינים עבור פרויקט Supabase שמוגדר במערכת (${supaProjectRef()}).`;if(/email not confirmed/i.test(m))return 'חשבון Supabase קיים אך האימייל עדיין לא אושר.';if(/failed to fetch|networkerror|load failed/i.test(m))return 'לא ניתן להגיע כרגע ל-Supabase. בדוק חיבור אינטרנט ונסה שוב.';return m||'שגיאת Supabase'}

function supaBaseHeaders(token){const h={'apikey':SUPA_CONFIG.publishableKey,'Content-Type':'application/json'};if(token)h.Authorization=`Bearer ${token}`;return h}

async function supaAuthPassword(email,password){
  if(!supaConfigured())throw new Error('הגדרת Supabase חסרה');
  const r=await fetch(`${SUPA_CONFIG.url}/auth/v1/token?grant_type=password`,{method:'POST',headers:supaBaseHeaders(),body:JSON.stringify({email,password})});
  const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j?.error_description||j?.msg||j?.message||'התחברות Supabase נכשלה');
  j.expires_at=Math.floor(Date.now()/1000)+Number(j.expires_in||3600);storeSupaSession(j);localStorage.setItem(SUPA_EMAIL_KEY,email);localStorage.setItem(SUPA_AUTO_KEY,'1');session.cloudAuthNoDocument=false;setCloudHeaderStatus('auth','ענן: מחובר לחשבון');return j
}

async function supaRefresh({force=true,observedAccessToken=''}={}){if(refreshPromise)return refreshPromise;refreshPromise=(async()=>{const refresh=async()=>{const s=loadSupaSession();if(!s?.refresh_token)throw new Error('נדרשת התחברות מחדש לענן');if(observedAccessToken&&s.access_token&&s.access_token!==observedAccessToken)return s;if(!force&&Number(s.expires_at||0)>Math.floor(Date.now()/1000)+60)return s;const r=await fetch(`${SUPA_CONFIG.url}/auth/v1/token?grant_type=refresh_token`,{method:'POST',headers:supaBaseHeaders(),body:JSON.stringify({refresh_token:s.refresh_token})});const j=await r.json().catch(()=>({}));if(!r.ok){storeSupaSession(null);setCloudHeaderStatus('off','ענן: נדרשת התחברות');throw new Error('פג תוקף ההתחברות לענן')};j.expires_at=Math.floor(Date.now()/1000)+Number(j.expires_in||3600);storeSupaSession(j);setCloudHeaderStatus('auth','ענן: מחובר לחשבון');return j};return globalThis.navigator?.locks?.request?navigator.locks.request('netunim-kupa-auth-refresh',{mode:'exclusive'},refresh):refresh()})().finally(()=>{refreshPromise=null});return refreshPromise}

async function supaEnsureSession(){let s=loadSupaSession();if(!s)throw new Error('נדרשת התחברות לענן');if(Number(s.expires_at||0)<=Math.floor(Date.now()/1000)+60)s=await supaRefresh({force:false,observedAccessToken:s.access_token});return s}

async function supaRest(path,options={}){
  const {networkRetry,networkTimeoutMs,dataPriority,coalesceKey,...requestOptions}=options,method=String(requestOptions.method||'GET').toUpperCase(),safeRead=method==='GET'||method==='HEAD',priority=dataPriority||(safeRead?'low':'high'),retry=networkRetry===undefined?(safeRead&&priority==='high'):!!networkRetry,timeoutMs=networkTimeoutMs??(priority==='low'?SUPA_BACKGROUND_TIMEOUT_MS:SUPA_NETWORK_TIMEOUT_MS);
  const request=async()=>{
    let s=await supaEnsureSession(),r=await fetchSupaNetwork(`${SUPA_CONFIG.url}${path}`,{...requestOptions,headers:{...supaBaseHeaders(s.access_token),...(requestOptions.headers||{})}},{retry,timeoutMs});
    if(r.status===401){const observed=s.access_token;s=await supaRefresh({force:true,observedAccessToken:observed});r=await fetchSupaNetwork(`${SUPA_CONFIG.url}${path}`,{...requestOptions,headers:{...supaBaseHeaders(s.access_token),...(requestOptions.headers||{})}},{retry,timeoutMs})}
    return r
  };
  return withSupaDataApiSlot(path,request,{priority,coalesceKey:coalesceKey||(priority==='low'&&safeRead?`${method}:${path}`:'')})
}

return { supaConfigured, loadSupaSession, restoreSupaSession, storeSupaSession, isSupabaseAuthError, friendlySupabaseError, supaBaseHeaders, supaAuthPassword, supaRefresh, supaEnsureSession, supaRest };
}
