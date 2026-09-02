import {supabaseConfig as SUPA_CONFIG} from '../../../supabase/config.js';
import {CLOUD_SESSION_KEY, CLOUD_EMAIL_KEY, CLOUD_AUTO_KEY} from '../state/constants.js';

const SUPA_NETWORK_ATTEMPTS=3;
const SUPA_NETWORK_TIMEOUT_MS=20*1000;
const SUPA_NETWORK_BACKOFF_MS=[500,1500];

function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms))}
function isSupaNetworkError(error){const name=String(error?.name||''),message=String(error?.message||error||'').toLowerCase();return name==='AbortError'||name==='TypeError'||message.includes('failed to fetch')||message.includes('networkerror')||message.includes('load failed')}
function supaNetworkFailure(error){const timedOut=String(error?.name||'')==='AbortError',e=new Error(timedOut?'החיבור ל-Supabase לא הגיב בזמן גם לאחר ניסיונות חוזרים.':'לא ניתן להגיע כרגע ל-Supabase גם לאחר ניסיונות חוזרים.');e.code=timedOut?'SUPABASE_NETWORK_TIMEOUT':'SUPABASE_NETWORK_UNAVAILABLE';e.cause=error;return e}
async function fetchSupaNetwork(url,options,{retry=false,timeoutMs=SUPA_NETWORK_TIMEOUT_MS}={}){const attempts=retry?SUPA_NETWORK_ATTEMPTS:1;let lastError=null;for(let attempt=0;attempt<attempts;attempt++){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.max(1000,Number(timeoutMs)||SUPA_NETWORK_TIMEOUT_MS));try{return await fetch(url,{...options,signal:controller.signal})}catch(error){lastError=error;if(!isSupaNetworkError(error)||attempt+1>=attempts)throw supaNetworkFailure(error);await sleep(SUPA_NETWORK_BACKOFF_MS[Math.min(attempt,SUPA_NETWORK_BACKOFF_MS.length-1)])}finally{clearTimeout(timer)}}throw supaNetworkFailure(lastError)}

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createCloudAuth({}){
function supaConfigured(){return /^https:\/\//.test(SUPA_CONFIG.url||'')&&String(SUPA_CONFIG.publishableKey||'').length>20}

function supaHeaders(token){return {'Content-Type':'application/json','apikey':SUPA_CONFIG.publishableKey,...(token?{'Authorization':'Bearer '+token}:{})}}

function loadSession(){try{return JSON.parse(localStorage.getItem(CLOUD_SESSION_KEY)||'null')}catch(e){return null}}

function saveSession(s){if(s)localStorage.setItem(CLOUD_SESSION_KEY,JSON.stringify(s));else localStorage.removeItem(CLOUD_SESSION_KEY)}

function cloudAuthRequired(message='נדרשת התחברות לענן'){const error=new Error(message);error.code='cloud_auth_required';return error}

async function authPassword(email,password){const r=await fetch(`${SUPA_CONFIG.url}/auth/v1/token?grant_type=password`,{method:'POST',headers:supaHeaders(),body:JSON.stringify({email,password})});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error_description||j.msg||j.message||'התחברות נכשלה');j.expires_at=Math.floor(Date.now()/1000)+Number(j.expires_in||3600);saveSession(j);localStorage.setItem(CLOUD_EMAIL_KEY,email);return j}

async function refreshSession(){const s=loadSession();if(!s?.refresh_token)throw cloudAuthRequired('נדרשת התחברות מחדש לענן');const r=await fetch(`${SUPA_CONFIG.url}/auth/v1/token?grant_type=refresh_token`,{method:'POST',headers:supaHeaders(),body:JSON.stringify({refresh_token:s.refresh_token})});const j=await r.json().catch(()=>({}));if(!r.ok){saveSession(null);throw cloudAuthRequired('פג תוקף ההתחברות לענן')};j.expires_at=Math.floor(Date.now()/1000)+Number(j.expires_in||3600);saveSession(j);return j}

async function ensureSession(){let s=loadSession();if(!s)throw cloudAuthRequired();if(Number(s.expires_at||0)<Math.floor(Date.now()/1000)+60)s=await refreshSession();return s}

async function supaFetch(path,opt={}){const {networkRetry,networkTimeoutMs,...requestOptions}=opt,method=String(requestOptions.method||'GET').toUpperCase(),retry=networkRetry===undefined?(method==='GET'||method==='HEAD'):!!networkRetry;let s=await ensureSession();let r=await fetchSupaNetwork(SUPA_CONFIG.url+path,{...requestOptions,headers:{...supaHeaders(s.access_token),...(requestOptions.headers||{})}},{retry,timeoutMs:networkTimeoutMs});if(r.status===401){s=await refreshSession();r=await fetchSupaNetwork(SUPA_CONFIG.url+path,{...requestOptions,headers:{...supaHeaders(s.access_token),...(requestOptions.headers||{})}},{retry,timeoutMs:networkTimeoutMs})}return r}

function cloudEnabled(){return localStorage.getItem(CLOUD_AUTO_KEY)==='1'&&!!loadSession()}

return { supaConfigured, supaHeaders, loadSession, saveSession, authPassword, refreshSession, ensureSession, supaFetch, cloudEnabled };
}
