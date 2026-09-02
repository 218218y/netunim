import {supabaseConfig as SUPA_CONFIG} from '../../../supabase/config.js';
import {SUPA_SESSION_KEY, SUPA_SESSION_IDB_KEY, SUPA_EMAIL_KEY, SUPA_AUTO_KEY} from '../state/constants.js';

const SUPA_NETWORK_ATTEMPTS=3;
const SUPA_NETWORK_TIMEOUT_MS=20*1000;
const SUPA_NETWORK_BACKOFF_MS=[500,1500];

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

async function supaRefresh(){
  const s=loadSupaSession();if(!s?.refresh_token)throw new Error('נדרשת התחברות מחדש לענן');
  const r=await fetch(`${SUPA_CONFIG.url}/auth/v1/token?grant_type=refresh_token`,{method:'POST',headers:supaBaseHeaders(),body:JSON.stringify({refresh_token:s.refresh_token})});
  const j=await r.json().catch(()=>({}));if(!r.ok){storeSupaSession(null);setCloudHeaderStatus('off','ענן: נדרשת התחברות');throw new Error('פג תוקף ההתחברות לענן')};j.expires_at=Math.floor(Date.now()/1000)+Number(j.expires_in||3600);storeSupaSession(j);setCloudHeaderStatus('auth','ענן: מחובר לחשבון');return j
}

async function supaEnsureSession(){let s=loadSupaSession();if(!s)throw new Error('נדרשת התחברות לענן');if(Number(s.expires_at||0)<=Math.floor(Date.now()/1000)+60)s=await supaRefresh();return s}

async function supaRest(path,options={}){
  const {networkRetry,networkTimeoutMs,...requestOptions}=options,method=String(requestOptions.method||'GET').toUpperCase(),retry=networkRetry===undefined?(method==='GET'||method==='HEAD'):!!networkRetry;
  let s=await supaEnsureSession(),r=await fetchSupaNetwork(`${SUPA_CONFIG.url}${path}`,{...requestOptions,headers:{...supaBaseHeaders(s.access_token),...(requestOptions.headers||{})}},{retry,timeoutMs:networkTimeoutMs});
  if(r.status===401){s=await supaRefresh();r=await fetchSupaNetwork(`${SUPA_CONFIG.url}${path}`,{...requestOptions,headers:{...supaBaseHeaders(s.access_token),...(requestOptions.headers||{})}},{retry,timeoutMs:networkTimeoutMs})}
  return r
}

return { supaConfigured, loadSupaSession, restoreSupaSession, storeSupaSession, isSupabaseAuthError, friendlySupabaseError, supaBaseHeaders, supaAuthPassword, supaRefresh, supaEnsureSession, supaRest };
}
