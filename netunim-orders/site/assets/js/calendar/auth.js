import {googleCalendarConfig} from './config.js';

const GIS_SRC='https://accounts.google.com/gsi/client';

export function createCalendarAuth({calendarSession}){
let gisPromise=null,tokenClient=null,pendingAuth=null;
function configured(){return /^\d+-[a-z0-9-]+\.apps\.googleusercontent\.com$/i.test(String(googleCalendarConfig.clientId||''))}
function hasUsableToken(){return !!calendarSession.accessToken&&Number(calendarSession.tokenExpiresAt||0)>Date.now()+30_000}
function authRequiredError(){const error=new Error('נדרשת התחברות ליומן Google');error.code='calendar_auth_required';return error}
function clearToken(){calendarSession.accessToken='';calendarSession.tokenExpiresAt=0;calendarSession.connected=false;calendarSession.accountVerified=false}

function loadGoogleIdentity(){
  if(globalThis.google?.accounts?.oauth2)return Promise.resolve();
  if(gisPromise)return gisPromise;
  const raw=new Promise((resolve,reject)=>{
    let settled=false,timer=null;
    const finish=(error=null)=>{if(settled)return;settled=true;if(timer)clearTimeout(timer);if(error)reject(error);else resolve()};
    const attach=script=>{
      const onLoad=()=>{script.dataset.calendarGisLoaded='1';if(globalThis.google?.accounts?.oauth2)finish();else finish(new Error('שירות ההתחברות של Google נטען ללא ממשק OAuth זמין'))};
      const onError=()=>{script.remove();finish(new Error('טעינת שירות ההתחברות של Google נכשלה'))};
      script.addEventListener('load',onLoad,{once:true});
      script.addEventListener('error',onError,{once:true});
      timer=setTimeout(()=>{script.remove();finish(new Error('טעינת שירות ההתחברות של Google ארכה זמן רב מדי'))},15_000);
    };
    const existing=document.querySelector(`script[src="${GIS_SRC}"]`);
    if(existing){
      if(existing.dataset.calendarGisLoaded==='1'){if(globalThis.google?.accounts?.oauth2)finish();else{existing.remove();finish(new Error('שירות ההתחברות של Google אינו זמין'))}return}
      attach(existing);return;
    }
    const script=document.createElement('script');script.src=GIS_SRC;script.async=true;script.defer=true;attach(script);document.head.appendChild(script);
  });
  gisPromise=raw.catch(error=>{gisPromise=null;throw error});
  return gisPromise;
}

async function ensureTokenClient(){if(!configured())throw new Error('Google Calendar עדיין לא הוגדר. יש להזין OAuth Client ID בקובץ assets/js/calendar/config.js');await loadGoogleIdentity();if(tokenClient)return tokenClient;const scopes=String(googleCalendarConfig.scope||'').split(/\s+/).filter(Boolean);tokenClient=globalThis.google.accounts.oauth2.initTokenClient({client_id:googleCalendarConfig.clientId,scope:googleCalendarConfig.scope,callback:response=>{const pending=pendingAuth;pendingAuth=null;if(!pending)return;if(response?.error){const error=new Error(response.error_description||response.error||'התחברות ל-Google נכשלה');error.code=response.error;pending.reject(error);return}if(scopes.length&&globalThis.google?.accounts?.oauth2?.hasGrantedAllScopes&&!globalThis.google.accounts.oauth2.hasGrantedAllScopes(response,...scopes)){clearToken();const error=new Error('לא ניתנו כל הרשאות היומן הדרושות. יש לאשר גישה לאירועי היומן ולרשימת היומנים.');error.code='calendar_scope_denied';pending.reject(error);return}calendarSession.accessToken=String(response.access_token||'');calendarSession.tokenExpiresAt=Date.now()+Math.max(0,Number(response.expires_in||3600)*1000);calendarSession.connected=!!calendarSession.accessToken;if(calendarSession.connected)pending.resolve(calendarSession.accessToken);else pending.reject(authRequiredError())},error_callback:details=>{const pending=pendingAuth;pendingAuth=null;if(!pending)return;const type=String(details?.type||'');const error=new Error(type==='popup_closed'?'חלון ההתחברות ל-Google נסגר לפני השלמת ההתחברות':type==='popup_failed_to_open'?'הדפדפן חסם את חלון ההתחברות ל-Google':'חלון ההתחברות ל-Google נכשל');error.code=type||'calendar_oauth_popup_error';pending.reject(error)}});return tokenClient}

async function prepare(){if(!configured())return false;await ensureTokenClient();return true}
async function connect(){if(hasUsableToken())return calendarSession.accessToken;const client=await ensureTokenClient();if(pendingAuth)return pendingAuth.promise;let resolveAuth,rejectAuth;const promise=new Promise((resolve,reject)=>{resolveAuth=resolve;rejectAuth=reject});pendingAuth={promise,resolve:resolveAuth,reject:rejectAuth};try{client.requestAccessToken({prompt:''})}catch(error){pendingAuth=null;throw error}return promise}
function accessToken(){if(!hasUsableToken()){clearToken();throw authRequiredError()}return calendarSession.accessToken}
async function disconnect(){const token=calendarSession.accessToken;clearToken();if(token&&globalThis.google?.accounts?.oauth2?.revoke)await new Promise(resolve=>globalThis.google.accounts.oauth2.revoke(token,()=>resolve()))}

return {configured,hasUsableToken,prepare,connect,accessToken,clearToken,disconnect,authRequiredError};
}
