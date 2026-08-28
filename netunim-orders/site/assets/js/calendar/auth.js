import {googleCalendarConfig} from './config.js';

export function createCalendarAuth({calendarSession,supaFetch}){
let pendingRestore=null;
function configured(){return typeof supaFetch==='function'&&/^\/functions\/v1\//.test(String(googleCalendarConfig.backendPath||''))}
function hasUsableToken(){return !!calendarSession.accessToken&&Number(calendarSession.tokenExpiresAt||0)>Date.now()+30_000}
function authRequiredError(){const error=new Error('נדרשת התחברות ליומן Google');error.code='calendar_auth_required';return error}
function clearToken(){calendarSession.accessToken='';calendarSession.tokenExpiresAt=0;calendarSession.connected=false;calendarSession.accountVerified=false}
function backendError(data,status){const code=String(data?.code||'calendar_oauth_backend_error');let message=String(data?.message||'').trim();if(code==='calendar_not_connected')message='יומן Google עדיין לא חובר לחשבון המשתמש הזה';else if(code==='calendar_reconnect_required')message='ההרשאה ל-Google פגה או בוטלה. יש לבצע חיבור חד-פעמי מחדש.';else if(status===401||code==='calendar_cloud_auth_required')message='נדרשת התחברות לענן לפני חיבור Google Calendar';else if(!message)message='שירות החיבור ל-Google Calendar אינו זמין';const error=new Error(message);error.code=code;error.status=status;return error}
async function backend(action,payload={}){if(!configured())throw new Error('Google Calendar backend אינו מוגדר');let response;try{response=await supaFetch(googleCalendarConfig.backendPath,{method:'POST',body:JSON.stringify({action,...payload})})}catch(error){if(String(error?.message||'').includes('לענן')){const wrapped=new Error('נדרשת התחברות לענן לפני חיבור Google Calendar');wrapped.code='calendar_cloud_auth_required';throw wrapped}throw error}const data=await response.json().catch(()=>({}));if(!response.ok)throw backendError(data,response.status);return data}
function acceptToken(data){const token=String(data?.access_token||'');if(!token)throw authRequiredError();const expiresIn=Math.max(0,Number(data?.expires_in||3600));const accountId=String(data?.account_id||'').trim();calendarSession.accessToken=token;calendarSession.tokenExpiresAt=Date.now()+expiresIn*1000;calendarSession.connected=true;calendarSession.accountVerified=false;if(accountId){calendarSession.accountId=accountId;calendarSession.expectedAccountId=accountId}return token}
async function restore(){if(hasUsableToken())return calendarSession.accessToken;if(pendingRestore)return pendingRestore;pendingRestore=backend('token').then(acceptToken).catch(error=>{clearToken();throw error}).finally(()=>{pendingRestore=null});return pendingRestore}
async function beginConnect({returnUrl=''}={}){clearToken();const data=await backend('start',{return_url:String(returnUrl||globalThis.location?.href||'')});const url=String(data?.authorize_url||'');if(!/^https:\/\/accounts\.google\.com\//.test(url)){const error=new Error('שירות החיבור ל-Google לא החזיר כתובת הרשאה תקינה');error.code='calendar_oauth_start_invalid';throw error}globalThis.location.assign(url);return false}
function accessToken(){if(!hasUsableToken()){clearToken();throw authRequiredError()}return calendarSession.accessToken}
async function disconnect(){await backend('disconnect');clearToken()}
async function prepare(){return configured()}
function ready(){return configured()}
return {configured,hasUsableToken,prepare,ready,restore,beginConnect,accessToken,clearToken,disconnect,authRequiredError};
}
