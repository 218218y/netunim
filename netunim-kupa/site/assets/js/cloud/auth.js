import {createAuthenticatedAccountScope} from '../shared/authenticated-account-scope.js';
import {createBrowserAccountObservation} from '../shared/browser-account-observation.js';
import {createAuthSessionPersistence} from './session-store.js';
import {createSyncCapabilityGate,syncRequestNeedsCapabilities} from '../shared/sync-capabilities.js';
import {supabaseConfig as SUPA_CONFIG} from '../../../supabase/config.js';
import {SUPA_SESSION_KEY, SUPA_SESSION_IDB_KEY, SUPA_EMAIL_KEY, SUPA_AUTO_KEY} from '../state/constants.js';
import {createDataApiScheduler} from '../shared/cloud-sync.js';

const SUPA_NETWORK_ATTEMPTS=3;
// A single un-retried background read timeout is not evidence that writes are unavailable.
const SUPA_BACKGROUND_FAILURES_TO_TRIP=2;
const SUPA_NETWORK_TIMEOUT_MS=20*1000;
const SUPA_BACKGROUND_TIMEOUT_MS=8*1000;
const SUPA_NETWORK_BACKOFF_MS=[500,1500];
const SUPA_DATA_API_BACKOFF_MS=[15_000,30_000,60_000,120_000];
const SUPA_DATA_API_RETRY_STATUSES=new Set([502,503,504]);
let supaDataApiFailureCount=0;
let supaDataApiBackgroundFailures=0;
let supaDataApiBlockedUntil=0;
let supaDataApiBlockCode='';
let cloudAuthInstanceSequence=0;

function isSupaDataApiPath(path){return /^\/rest\/v1(?:\/|\?|$)/.test(String(path||''))}
function responseRetryAfterMs(response){const raw=String(response?.headers?.get?.('retry-after')||'').trim();if(!raw)return 0;const seconds=Number(raw);if(Number.isFinite(seconds)&&seconds>=0)return Math.round(seconds*1000);const at=Date.parse(raw);return Number.isFinite(at)?Math.max(0,at-Date.now()):0}
function supaDataApiBlockedError(){const retryAfterMs=Math.max(0,supaDataApiBlockedUntil-Date.now()),rateLimited=supaDataApiBlockCode==='SUPABASE_DATA_API_RATE_LIMIT',e=new Error(rateLimited?`Supabase ביקש להאט בקשות. ניסיון נוסף יתבצע בעוד ${Math.max(1,Math.ceil(retryAfterMs/1000))} שניות.`:`Supabase Data API במצב התאוששות. ניסיון נוסף יתבצע בעוד ${Math.max(1,Math.ceil(retryAfterMs/1000))} שניות.`);e.code=rateLimited?'SUPABASE_DATA_API_RATE_LIMIT':'SUPABASE_DATA_API_BACKOFF';e.retryAfterMs=retryAfterMs;return e}
function resetSupaDataApiBreaker(){supaDataApiFailureCount=0;supaDataApiBackgroundFailures=0;supaDataApiBlockedUntil=0;supaDataApiBlockCode=''}
function tripSupaDataApiBreaker(){supaDataApiBackgroundFailures=0;const index=Math.min(supaDataApiFailureCount,SUPA_DATA_API_BACKOFF_MS.length-1),delay=SUPA_DATA_API_BACKOFF_MS[index];supaDataApiFailureCount=Math.min(supaDataApiFailureCount+1,SUPA_DATA_API_BACKOFF_MS.length);supaDataApiBlockedUntil=Math.max(supaDataApiBlockedUntil,Date.now()+delay);supaDataApiBlockCode='SUPABASE_DATA_API_BACKOFF';return delay}
function tripSupaDataApiRateLimit(response){supaDataApiBackgroundFailures=0;const delay=Math.max(1_000,responseRetryAfterMs(response)||SUPA_DATA_API_BACKOFF_MS[0]);supaDataApiBlockedUntil=Math.max(supaDataApiBlockedUntil,Date.now()+delay);supaDataApiBlockCode='SUPABASE_DATA_API_RATE_LIMIT';return delay}
function isSupaDataApiTransportFailure(error){return ['SUPABASE_NETWORK_TIMEOUT','SUPABASE_NETWORK_UNAVAILABLE'].includes(String(error?.code||''))}
function recordSupaDataApiTransportFailure({priority,safeRead,retried}){
  // After a fully retried read or an uncertain write failure, keep the existing immediate breaker.
  // Only a one-shot background GET/HEAD needs corroboration before blocking unrelated writes.
  if(priority==='low'&&safeRead&&!retried&&++supaDataApiBackgroundFailures<SUPA_BACKGROUND_FAILURES_TO_TRIP)return;
  tripSupaDataApiBreaker();
}
async function responseIsAppBusy(response){if(Number(response?.status)!==429)return false;try{const body=await response.clone().json();return String(body?.code||'')==='PT429'||String(body?.message||'').toLowerCase().includes('save_busy')}catch{return false}}
const supaDataApiScheduler=createDataApiScheduler({maxHighBurst:4,canRun:()=>Date.now()>=supaDataApiBlockedUntil});
async function withSupaDataApiSlot(path,request,{priority='low',coalesceKey='',safeRead=false,retried=false}={}){
  if(!isSupaDataApiPath(path))return request();
  const scheduled=supaDataApiScheduler.schedule(async()=>{
    if(Date.now()<supaDataApiBlockedUntil)throw supaDataApiBlockedError();
    try{
      const response=await request(),status=Number(response?.status);
      if(SUPA_DATA_API_RETRY_STATUSES.has(status))tripSupaDataApiBreaker();
      else if(status===429){if(await responseIsAppBusy(response))resetSupaDataApiBreaker();else tripSupaDataApiRateLimit(response)}
      else resetSupaDataApiBreaker();
      return response;
    }catch(error){if(isSupaDataApiTransportFailure(error))recordSupaDataApiTransportFailure({priority,safeRead,retried});throw error}
  },{priority,key:coalesceKey,blockedError:supaDataApiBlockedError});
  return scheduled.then(response=>typeof response?.clone==='function'?response.clone():response);
}

function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms))}
function isSupaNetworkError(error){const name=String(error?.name||''),message=String(error?.message||error||'').toLowerCase();return name==='AbortError'||name==='TypeError'||message.includes('failed to fetch')||message.includes('networkerror')||message.includes('load failed')}
function supaNetworkFailure(error,{attempts=1}={}){const timedOut=String(error?.name||'')==='AbortError',repeated=attempts>1,e=new Error(timedOut?(repeated?'החיבור ל-Supabase לא הגיב בזמן גם לאחר ניסיונות חוזרים.':'החיבור ל-Supabase לא הגיב בזמן.'):(repeated?'לא ניתן להגיע כרגע ל-Supabase גם לאחר ניסיונות חוזרים.':'לא ניתן להגיע כרגע ל-Supabase.'));e.code=timedOut?'SUPABASE_NETWORK_TIMEOUT':'SUPABASE_NETWORK_UNAVAILABLE';e.cause=error;return e}
async function fetchSupaNetwork(url,options,{retry=false,timeoutMs=SUPA_NETWORK_TIMEOUT_MS,assertRequestScope}={}){
  const attempts=retry?SUPA_NETWORK_ATTEMPTS:1;let lastError=null;
  for(let attempt=0;attempt<attempts;attempt++){
    assertRequestScope?.();
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.max(1000,Number(timeoutMs)||SUPA_NETWORK_TIMEOUT_MS));
    try{return await fetch(url,{...options,signal:controller.signal})}
    catch(error){lastError=error;if(!isSupaNetworkError(error))throw error;if(attempt+1>=attempts)throw supaNetworkFailure(error,{attempts});await sleep(SUPA_NETWORK_BACKOFF_MS[Math.min(attempt,SUPA_NETWORK_BACKOFF_MS.length-1)])}
    finally{clearTimeout(timer)}
  }
  throw supaNetworkFailure(lastError,{attempts});
}

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createCloudAuth({session, idbGet, idbPut, idbDelete, supaProjectRef, setCloudHeaderStatus, assertSessionOwner=()=>true}){
let refreshFlight=null;
const credentials=createAuthSessionPersistence({
  key:SUPA_SESSION_KEY,initial:session.supaSession||null,storage:()=>localStorage,
  decode:value=>value&&typeof value==='object'&&!Array.isArray(value)?value:null,
  mirror:{read:()=>idbGet('sync',SUPA_SESSION_IDB_KEY),write:value=>idbPut('sync',SUPA_SESSION_IDB_KEY,value),remove:()=>idbDelete('sync',SUPA_SESSION_IDB_KEY)},
});
const capabilityGate=createSyncCapabilityGate(async()=>{const response=await supaRest('/rest/v1/rpc/get_netunim_sync_capabilities',{method:'POST',body:'{}',dataPriority:'high'});if(!response.ok)throw Object.assign(new Error('ה־DB אינו תואם לגרסת האתר; יש להשלים את עדכון מסד הנתונים.'),{code:'netunim_sync_capabilities_missing'});return response.json()});
async function ensureSyncCapabilities(){session.syncCapabilitiesChecking=true;try{const ready=await capabilityGate.ensure();session.syncCapabilitiesError=null;return ready}catch(error){session.syncCapabilitiesError=error;throw error}finally{session.syncCapabilitiesChecking=false}}
function supaConfigured(){return !!(SUPA_CONFIG.url&&SUPA_CONFIG.publishableKey)}

const accountScope=createAuthenticatedAccountScope({loadSession:loadSupaSession});
const cloudAuthInstance=++cloudAuthInstanceSequence;
const requestGuards=new WeakMap();let requestGuardSequence=0;
function guardCoalesceIdentity(guard){
  if(typeof guard!=='function')return 'none';
  let id=requestGuards.get(guard);
  if(!id){id=++requestGuardSequence;requestGuards.set(guard,id)}
  return String(id);
}
const accountObservation=createBrowserAccountObservation({scope:accountScope,sessionKey:SUPA_SESSION_KEY,rereadSession:()=>{session.supaSession=credentials.reread();return session.supaSession}});

function loadSupaSession(){session.supaSession=credentials.load();return session.supaSession}

async function restoreSupaSession(){session.supaSession=await credentials.restore();return session.supaSession}

function storeSupaSession(s,{refresh=false}={}){
  capabilityGate.reset();
  try{credentials.store(s||null)}
  finally{session.supaSession=credentials.load();accountScope.replace(session.supaSession,{refresh})}
}

function assertLoginCurrent(observed){
  const current=accountScope.current();
  if(current.epoch!==observed.epoch||current.owner!==observed.owner)
    throw Object.assign(new Error('ההתחברות השתנתה במהלך הבקשה. יש להתחבר מחדש.'),{code:'cloud_auth_scope_changed'});
}

function isSupabaseAuthError(e){if(['storage_owner_auth_mismatch','storage_owner_local_adoption_auth_mismatch','storage_owner_reauth_required'].includes(String(e?.code||'')))return true;const m=String(e?.message||e||'').toLowerCase();return m.includes('invalid login credentials')||m.includes('invalid_credentials')||m.includes('jwt')||m.includes('refresh token')||m.includes('פג תוקף')||m.includes('נדרשת התחברות')}

function friendlySupabaseError(e){const m=String(e?.message||e||'');if(/invalid login credentials|invalid_credentials/i.test(m))return `האימייל או הסיסמה אינם תקינים עבור פרויקט Supabase שמוגדר במערכת (${supaProjectRef()}).`;if(/email not confirmed/i.test(m))return 'חשבון Supabase קיים אך האימייל עדיין לא אושר.';if(/failed to fetch|networkerror|load failed/i.test(m))return 'לא ניתן להגיע כרגע ל-Supabase. בדוק חיבור אינטרנט ונסה שוב.';return m||'שגיאת Supabase'}

function supaBaseHeaders(token){const h={'apikey':SUPA_CONFIG.publishableKey,'Content-Type':'application/json'};if(token)h.Authorization=`Bearer ${token}`;return h}

async function supaAuthPassword(email,password){
  if(!supaConfigured())throw new Error('הגדרת Supabase חסרה');
  const observed=accountScope.current();
  const r=await fetch(`${SUPA_CONFIG.url}/auth/v1/token?grant_type=password`,{method:'POST',headers:supaBaseHeaders(),body:JSON.stringify({email,password})});
  const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j?.error_description||j?.msg||j?.message||'התחברות Supabase נכשלה');
  assertLoginCurrent(observed);
  j.expires_at=Math.floor(Date.now()/1000)+Number(j.expires_in||3600);assertSessionOwner(j);storeSupaSession(j);localStorage.setItem(SUPA_EMAIL_KEY,email);localStorage.setItem(SUPA_AUTO_KEY,'1');session.cloudAuthNoDocument=false;setCloudHeaderStatus('auth','ענן: מחובר לחשבון');return j
}

async function supaAuthPasswordForLocalReset(email,password){
  if(!supaConfigured())throw new Error('הגדרת Supabase חסרה');
  const r=await fetch(`${SUPA_CONFIG.url}/auth/v1/token?grant_type=password`,{method:'POST',headers:supaBaseHeaders(),body:JSON.stringify({email,password})});
  const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j?.error_description||j?.msg||j?.message||'התחברות Supabase נכשלה');
  if(!String(j?.access_token||'').trim())throw new Error('Supabase לא החזיר token תקין לאימות האיפוס');
  j.expires_at=Math.floor(Date.now()/1000)+Number(j.expires_in||3600);return j
}

async function localResetReadOnlyFetch(resetSession,path){
  const token=String(resetSession?.access_token||'').trim(),safePath=String(path||'');
  if(!token)throw Object.assign(new Error('נדרשת התחברות מחדש לענן לצורך האיפוס'),{code:'local_reset_auth_required'});
  if(!safePath.startsWith('/rest/v1/')||safePath.includes('/rpc/'))throw new Error('local_reset_read_only_path_rejected');
  const r=await fetchSupaNetwork(`${SUPA_CONFIG.url}${safePath}`,{method:'GET',headers:supaBaseHeaders(token)},{retry:true,timeoutMs:SUPA_NETWORK_TIMEOUT_MS});
  if(r.status===401)throw Object.assign(new Error('פג תוקף אימות הענן לצורך האיפוס'),{code:'local_reset_auth_required'});
  return r
}

async function supaRefresh({force=true,observedAccessToken=''}={}){
  const scope=accountScope.current();
  if(refreshFlight?.scope.owner===scope.owner&&refreshFlight.scope.epoch===scope.epoch)return refreshFlight.promise;
  const refresh=async()=>{
    // Capture before waiting for the browser lock, which may outlive this login.
    accountScope.assertCurrent(scope);
    const s=loadSupaSession();
    if(!s?.refresh_token)throw new Error('נדרשת התחברות מחדש לענן');
    assertSessionOwner(s);
    if(observedAccessToken&&s.access_token&&s.access_token!==observedAccessToken)return s;
    if(!force&&Number(s.expires_at||0)>Math.floor(Date.now()/1000)+60)return s;
    const r=await fetch(`${SUPA_CONFIG.url}/auth/v1/token?grant_type=refresh_token`,{
      method:'POST',headers:supaBaseHeaders(),body:JSON.stringify({refresh_token:s.refresh_token}),
    });
    const j=await r.json().catch(()=>({}));
    accountScope.assertCurrent(scope);
    if(!r.ok){
      storeSupaSession(null);
      setCloudHeaderStatus('off','ענן: נדרשת התחברות');
      throw new Error('פג תוקף ההתחברות לענן');
    }
    j.expires_at=Math.floor(Date.now()/1000)+Number(j.expires_in||3600);
    assertSessionOwner(j);
    storeSupaSession(j,{refresh:true});
    setCloudHeaderStatus('auth','ענן: מחובר לחשבון');
    return j;
  };
  const flight={scope,promise:null};
  flight.promise=(globalThis.navigator?.locks?.request
    ?navigator.locks.request('netunim-kupa-auth-refresh',{mode:'exclusive'},refresh):refresh())
    .finally(()=>{if(refreshFlight===flight)refreshFlight=null});
  refreshFlight=flight;
  return flight.promise;
}

async function supaEnsureSession(){let s=loadSupaSession();if(!s)throw new Error('נדרשת התחברות לענן');assertSessionOwner(s);if(Number(s.expires_at||0)<=Math.floor(Date.now()/1000)+60)s=await supaRefresh({force:false,observedAccessToken:s.access_token});return s}

async function supaRest(path,options={}){
  // Capture the caller's login before any asynchronous capability/session work.
  // Neither a queued request nor an in-flight response may cross a login epoch.
  const requestScope=accountScope.current(),assertRequestScope=options.assertRequestScope;
  const assertCurrent=()=>{
    // Caller-owned cancellation keeps its specific error semantics.
    assertRequestScope?.();
    // With no session, preserve the normal 'login required' path; still fence any later login.
    if(requestScope.owner||accountScope.current().epoch!==requestScope.epoch)accountScope.assertCurrent(requestScope);
  };
  if(syncRequestNeedsCapabilities(path,options.method))await ensureSyncCapabilities();
  assertCurrent();
  const {networkRetry,networkTimeoutMs,dataPriority,coalesceKey,assertRequestScope:_callerGuard,...requestOptions}=options,
    method=String(requestOptions.method||'GET').toUpperCase(),safeRead=method==='GET'||method==='HEAD',
    priority=dataPriority||(safeRead?'low':'high'),retry=networkRetry===undefined?(safeRead&&priority==='high'):!!networkRetry,
    timeoutMs=networkTimeoutMs??(priority==='low'?SUPA_BACKGROUND_TIMEOUT_MS:SUPA_NETWORK_TIMEOUT_MS);
  const request=async()=>{
    assertCurrent();let s=await supaEnsureSession();assertCurrent();
    let r=await fetchSupaNetwork(`${SUPA_CONFIG.url}${path}`,{...requestOptions,headers:{...supaBaseHeaders(s.access_token),...(requestOptions.headers||{})}},{retry,timeoutMs,assertRequestScope:assertCurrent});
    assertCurrent();
    if(r.status===401){const observed=s.access_token;s=await supaRefresh({force:true,observedAccessToken:observed});assertCurrent();r=await fetchSupaNetwork(`${SUPA_CONFIG.url}${path}`,{...requestOptions,headers:{...supaBaseHeaders(s.access_token),...(requestOptions.headers||{})}},{retry,timeoutMs,assertRequestScope:assertCurrent});assertCurrent()}
    return r;
  };
  // De-duplicate only for the same login AND operation guard, including explicit keys.
  const key=coalesceKey||(priority==='low'&&safeRead?`${method}:${path}`:'');
  const scopedKey=key?`${cloudAuthInstance}:${requestScope.epoch}:${requestScope.owner||''}:${guardCoalesceIdentity(assertRequestScope)}:${key}`:'';
  return withSupaDataApiSlot(path,request,{priority,safeRead,retried:retry,coalesceKey:scopedKey});
}

return { getAccountScope:accountScope.current, subscribeAccountScope:accountObservation.subscribe, ensureSyncCapabilities, supaConfigured, loadSupaSession, restoreSupaSession, storeSupaSession, isSupabaseAuthError, friendlySupabaseError, supaBaseHeaders, supaAuthPassword, supaAuthPasswordForLocalReset, localResetReadOnlyFetch, supaRefresh, supaEnsureSession, supaRest };
}
