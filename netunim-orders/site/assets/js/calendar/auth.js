import {googleCalendarConfig} from './config.js';

const GIS_SRC='https://accounts.google.com/gsi/client';

export function createCalendarAuth({calendarSession}){
let gisPromise=null,tokenClient=null,pendingAuth=null;
function configured(){return /^\d+-[a-z0-9-]+\.apps\.googleusercontent\.com$/i.test(String(googleCalendarConfig.clientId||''))}
function hasUsableToken(){return !!calendarSession.accessToken&&Number(calendarSession.tokenExpiresAt||0)>Date.now()+30_000}
function authRequiredError(){const error=new Error('נדרשת התחברות ליומן Google');error.code='calendar_auth_required';return error}
function clearToken(){calendarSession.accessToken='';calendarSession.tokenExpiresAt=0;calendarSession.connected=false;calendarSession.accountVerified=false}
function oauthResponseError(response){const code=String(response?.error||'calendar_oauth_error'),description=String(response?.error_description||'').trim();let message=description||'התחברות ל-Google נכשלה';if(code==='access_denied')message='Google דחתה את ההרשאה לחשבון שנבחר. אם האפליקציה נמצאת במצב Testing, יש להוסיף את החשבון המדויק ב-Google Auth Platform תחת Audience → Test users ולנסות שוב. אם החשבון כבר נוסף, בדוק שאין עליו מגבלת ארגון או חשבון.';const error=new Error(message);error.code=code;return error}
function popupFlowError(details){const type=String(details?.type||'');let message='חלון ההתחברות ל-Google נכשל';if(type==='popup_failed_to_open')message='הדפדפן חסם את חלון ההתחברות ל-Google';else if(type==='popup_closed')message='חלון ההתחברות ל-Google נסגר לפני שהתקבל אישור. אם הופיע בו 403 access_denied בזמן שהאפליקציה במצב Testing, יש להוסיף את החשבון המדויק תחת Google Auth Platform → Audience → Test users.';const error=new Error(message);error.code=type||'calendar_oauth_popup_error';return error}

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

async function ensureTokenClient(){if(!configured())throw new Error('Google Calendar עדיין לא הוגדר. יש להזין OAuth Client ID בקובץ assets/js/calendar/config.js');await loadGoogleIdentity();if(tokenClient)return tokenClient;const scopes=String(googleCalendarConfig.scope||'').split(/\s+/).filter(Boolean);tokenClient=globalThis.google.accounts.oauth2.initTokenClient({client_id:googleCalendarConfig.clientId,scope:googleCalendarConfig.scope,callback:response=>{const pending=pendingAuth;pendingAuth=null;if(!pending)return;if(response?.error){clearToken();pending.reject(oauthResponseError(response));return}if(scopes.length&&globalThis.google?.accounts?.oauth2?.hasGrantedAllScopes&&!globalThis.google.accounts.oauth2.hasGrantedAllScopes(response,...scopes)){clearToken();const error=new Error('לא ניתנו כל הרשאות היומן הדרושות. יש לאשר גישה לאירועי היומן ולרשימת היומנים.');error.code='calendar_scope_denied';pending.reject(error);return}calendarSession.accessToken=String(response.access_token||'');calendarSession.tokenExpiresAt=Date.now()+Math.max(0,Number(response.expires_in||3600)*1000);calendarSession.connected=!!calendarSession.accessToken;if(calendarSession.connected)pending.resolve(calendarSession.accessToken);else pending.reject(authRequiredError())},error_callback:details=>{const pending=pendingAuth;pendingAuth=null;if(!pending)return;clearToken();pending.reject(popupFlowError(details))}});return tokenClient}

async function prepare(){if(!configured())return false;await ensureTokenClient();return true}
function ready(){return !!tokenClient}
function requestToken(client,{loginHint='',prompt=''}={}){if(pendingAuth)return pendingAuth.promise;let resolveAuth,rejectAuth;const promise=new Promise((resolve,reject)=>{resolveAuth=resolve;rejectAuth=reject});pendingAuth={promise,resolve:resolveAuth,reject:rejectAuth};const request={prompt:String(prompt??'')};const hint=String(loginHint||'').trim();if(hint)request.login_hint=hint;try{client.requestAccessToken(request)}catch(error){pendingAuth=null;throw error}return promise}
function connect(options={}){if(hasUsableToken())return Promise.resolve(calendarSession.accessToken);if(tokenClient)return requestToken(tokenClient,options);return ensureTokenClient().then(client=>requestToken(client,options))}
function accessToken(){if(!hasUsableToken()){clearToken();throw authRequiredError()}return calendarSession.accessToken}
async function disconnect(){const token=calendarSession.accessToken;clearToken();if(token&&globalThis.google?.accounts?.oauth2?.revoke)await new Promise(resolve=>globalThis.google.accounts.oauth2.revoke(token,()=>resolve()))}

return {configured,hasUsableToken,prepare,ready,connect,accessToken,clearToken,disconnect,authRequiredError};
}
