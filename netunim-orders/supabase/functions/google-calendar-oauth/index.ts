import {createClient} from 'npm:@supabase/supabase-js@2.112.4';

const CLIENT_ID='113139579639-jo09d2gts6kujig6rcaeid3bu40ojjqm.apps.googleusercontent.com';
const SCOPES='https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly';
const GOOGLE_AUTH_URL='https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL='https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL='https://oauth2.googleapis.com/revoke';
const CALENDAR_LIST_URL='https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250&showHidden=true';
const STATE_TTL_MS=10*60*1000;
const corsHeaders={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
};

function envKey(jsonName:string,legacyName:string){
  const raw=Deno.env.get(jsonName);
  if(raw){
    try{
      const parsed=JSON.parse(raw)||{};
      const value=parsed.default||Object.values(parsed).find(item=>typeof item==='string'&&item);
      if(value)return String(value);
    }catch{/* fall back to legacy key below */}
  }
  const legacy=Deno.env.get(legacyName);
  if(legacy)return legacy;
  throw new Error(`Missing ${jsonName}/${legacyName}`);
}

const SUPABASE_URL=Deno.env.get('SUPABASE_URL')||'';
const PUBLISHABLE_KEY=envKey('SUPABASE_PUBLISHABLE_KEYS','SUPABASE_ANON_KEY');
const SECRET_KEY=envKey('SUPABASE_SECRET_KEYS','SUPABASE_SERVICE_ROLE_KEY');
const GOOGLE_CLIENT_SECRET=Deno.env.get('GOOGLE_CALENDAR_CLIENT_SECRET')||'';
const REDIRECT_URI=`${SUPABASE_URL}/functions/v1/google-calendar-oauth/callback`;
const admin=createClient(SUPABASE_URL,SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});

function json(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json','Cache-Control':'no-store'}})}
function dataApiUnavailable(error:any){const status=Number(error?.status||error?.context?.status||0),code=String(error?.code||'').toUpperCase(),message=String(error?.message||'').toUpperCase();return [502,503,504].includes(status)||['PGRST002','PGRST003'].includes(code)||message.includes('PGRST002')||message.includes('PGRST003')}
function adminError(error:any,fallbackCode:string){if(dataApiUnavailable(error))return json({code:'calendar_data_api_unavailable',message:'Calendar storage is temporarily unavailable'},503);return json({code:fallbackCode,message:String(error?.message||error||fallbackCode)},500)}
function randomState(){const bytes=crypto.getRandomValues(new Uint8Array(32));return Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('')}
async function sha256(value:string){const bytes=new TextEncoder().encode(value);const digest=await crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(digest),item=>item.toString(16).padStart(2,'0')).join('')}
function appendOAuthResult(returnUrl:string,status:string,code=''){const url=new URL(returnUrl);url.searchParams.set('calendar_oauth',status);if(code)url.searchParams.set('calendar_oauth_code',code);else url.searchParams.delete('calendar_oauth_code');return url.toString()}
function safeReturnUrl(value:unknown,origin:string){const candidate=new URL(String(value||origin||''));if(!origin||candidate.origin!==origin)throw new Error('invalid_return_url');if(candidate.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(candidate.hostname))throw new Error('invalid_return_url');candidate.hash='';candidate.searchParams.delete('calendar_oauth');candidate.searchParams.delete('calendar_oauth_code');return candidate.toString()}
async function requireUser(req:Request){const authorization=req.headers.get('Authorization')||'';const token=authorization.match(/^Bearer\s+(.+)$/i)?.[1]||'';if(!token)return null;const client=createClient(SUPABASE_URL,PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:`Bearer ${token}`}}});const {data,error}=await client.auth.getUser(token);if(error||!data.user?.id)return null;return data.user}
async function googleToken(params:Record<string,string>){const body=new URLSearchParams(params);const response=await fetch(GOOGLE_TOKEN_URL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});const data=await response.json().catch(()=>({}));if(!response.ok){const error=new Error(String(data?.error_description||data?.error||'google_token_error'));(error as Error&{code?:string}).code=String(data?.error||'google_token_error');throw error}return data}
async function googleAccountId(accessToken:string){const response=await fetch(CALENDAR_LIST_URL,{headers:{Authorization:`Bearer ${accessToken}`}});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(String(data?.error?.message||'Google Calendar account verification failed'));const items=Array.isArray(data?.items)?data.items:[];const primary=items.find((item:any)=>item?.primary)||items.find((item:any)=>item?.accessRole==='owner')||items[0];const accountId=String(primary?.id||'').trim();if(!accountId)throw new Error('Google did not return an active calendar account');return accountId}
async function revokeGoogleToken(token:string){if(!token)return;try{await fetch(GOOGLE_REVOKE_URL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token})})}catch{/* local unlink must still complete */}}

async function start(req:Request,userId:string,body:any){
  if(!GOOGLE_CLIENT_SECRET)return json({code:'calendar_backend_not_configured',message:'GOOGLE_CALENDAR_CLIENT_SECRET חסר ב-Supabase Edge Function'},503);
  const origin=req.headers.get('Origin')||'';
  let returnUrl='';
  try{returnUrl=safeReturnUrl(body?.return_url,origin)}catch{return json({code:'calendar_invalid_return_url',message:'כתובת החזרה של Google Calendar אינה תקינה'},400)}
  const state=randomState(),stateHash=await sha256(state),expiresAt=new Date(Date.now()+STATE_TTL_MS).toISOString();
  const {error:cleanupError}=await admin.from('google_calendar_oauth_states').delete().lt('expires_at',new Date().toISOString());
  if(cleanupError&&dataApiUnavailable(cleanupError))return adminError(cleanupError,'calendar_state_cleanup_failed');
  const {error}=await admin.from('google_calendar_oauth_states').insert({state_hash:stateHash,owner_id:userId,return_url:returnUrl,expires_at:expiresAt});
  if(error)return adminError(error,'calendar_state_store_failed');
  const url=new URL(GOOGLE_AUTH_URL);
  url.searchParams.set('client_id',CLIENT_ID);
  url.searchParams.set('redirect_uri',REDIRECT_URI);
  url.searchParams.set('response_type','code');
  url.searchParams.set('scope',SCOPES);
  url.searchParams.set('access_type','offline');
  url.searchParams.set('prompt','consent');
  url.searchParams.set('include_granted_scopes','true');
  url.searchParams.set('state',state);
  return json({authorize_url:url.toString()});
}

async function token(userId:string){
  if(!GOOGLE_CLIENT_SECRET)return json({code:'calendar_backend_not_configured',message:'GOOGLE_CALENDAR_CLIENT_SECRET חסר ב-Supabase Edge Function'},503);
  const {data:connection,error}=await admin.from('google_calendar_connections').select('google_account_id,refresh_token').eq('owner_id',userId).maybeSingle();
  if(error)return adminError(error,'calendar_connection_read_failed');
  if(!connection?.refresh_token)return json({code:'calendar_not_connected'},404);
  try{
    const refreshed=await googleToken({client_id:CLIENT_ID,client_secret:GOOGLE_CLIENT_SECRET,refresh_token:String(connection.refresh_token),grant_type:'refresh_token'});
    const rotated=String(refreshed?.refresh_token||'').trim();
    if(rotated&&rotated!==connection.refresh_token)await admin.from('google_calendar_connections').update({refresh_token:rotated,updated_at:new Date().toISOString()}).eq('owner_id',userId);
    return json({access_token:String(refreshed.access_token||''),expires_in:Number(refreshed.expires_in||3600),account_id:String(connection.google_account_id||''),scope:String(refreshed.scope||SCOPES)});
  }catch(error){
    const code=String((error as Error&{code?:string})?.code||'');
    if(code==='invalid_grant'){
      await admin.from('google_calendar_connections').delete().eq('owner_id',userId);
      return json({code:'calendar_reconnect_required'},409);
    }
    return json({code:'calendar_refresh_failed',message:String((error as Error)?.message||error)},502);
  }
}

async function disconnect(userId:string){
  const {data:connection,error:readError}=await admin.from('google_calendar_connections').select('refresh_token').eq('owner_id',userId).maybeSingle();
  if(readError)return adminError(readError,'calendar_connection_read_failed');
  if(connection?.refresh_token)await revokeGoogleToken(String(connection.refresh_token));
  const {error}=await admin.from('google_calendar_connections').delete().eq('owner_id',userId);
  if(error)return adminError(error,'calendar_disconnect_failed');
  return json({ok:true});
}

async function callback(url:URL){
  const state=String(url.searchParams.get('state')||''),stateHash=state?await sha256(state):'';
  if(!stateHash)return new Response('Invalid OAuth state',{status:400});
  const {data:stateRow,error:stateError}=await admin.from('google_calendar_oauth_states').select('owner_id,return_url,expires_at').eq('state_hash',stateHash).maybeSingle();
  if(stateError){if(dataApiUnavailable(stateError))return json({code:'calendar_data_api_unavailable',message:'Calendar storage is temporarily unavailable'},503);return new Response('Invalid or expired OAuth state',{status:400})}
  if(!stateRow)return new Response('Invalid or expired OAuth state',{status:400});
  const {error:consumeError}=await admin.from('google_calendar_oauth_states').delete().eq('state_hash',stateHash);
  if(consumeError)return adminError(consumeError,'calendar_state_consume_failed');
  const returnUrl=String(stateRow.return_url||'');
  if(new Date(String(stateRow.expires_at||0)).getTime()<Date.now())return Response.redirect(appendOAuthResult(returnUrl,'error','state_expired'),303);
  const oauthError=String(url.searchParams.get('error')||'');
  if(oauthError)return Response.redirect(appendOAuthResult(returnUrl,'error',oauthError),303);
  const code=String(url.searchParams.get('code')||'');
  if(!code)return Response.redirect(appendOAuthResult(returnUrl,'error','missing_code'),303);
  if(!GOOGLE_CLIENT_SECRET)return Response.redirect(appendOAuthResult(returnUrl,'error','backend_not_configured'),303);
  try{
    const exchanged=await googleToken({code,client_id:CLIENT_ID,client_secret:GOOGLE_CLIENT_SECRET,redirect_uri:REDIRECT_URI,grant_type:'authorization_code'});
    const refreshToken=String(exchanged?.refresh_token||'').trim(),accessToken=String(exchanged?.access_token||'').trim();
    if(!refreshToken||!accessToken)throw new Error('Google did not return the required offline credentials');
    const accountId=await googleAccountId(accessToken);
    const {data:previous,error:previousError}=await admin.from('google_calendar_connections').select('refresh_token').eq('owner_id',stateRow.owner_id).maybeSingle();
    if(previousError)return adminError(previousError,'calendar_connection_read_failed');
    const {error:upsertError}=await admin.from('google_calendar_connections').upsert({owner_id:stateRow.owner_id,google_account_id:accountId,refresh_token:refreshToken,scope:String(exchanged?.scope||SCOPES),updated_at:new Date().toISOString()},{onConflict:'owner_id'});
    if(upsertError){if(dataApiUnavailable(upsertError))return json({code:'calendar_data_api_unavailable',message:'Calendar storage is temporarily unavailable'},503);throw new Error(upsertError.message)}
    if(previous?.refresh_token&&previous.refresh_token!==refreshToken)await revokeGoogleToken(String(previous.refresh_token));
    return Response.redirect(appendOAuthResult(returnUrl,'connected'),303);
  }catch(error){
    console.error('google calendar oauth callback',error);
    return Response.redirect(appendOAuthResult(returnUrl,'error','exchange_failed'),303);
  }
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  const url=new URL(req.url);
  if(url.pathname.endsWith('/callback')&&req.method==='GET')return callback(url);
  if(req.method!=='POST')return json({code:'method_not_allowed'},405);
  const user=await requireUser(req);
  if(!user)return json({code:'calendar_cloud_auth_required'},401);
  const body=await req.json().catch(()=>({}));
  const action=String(body?.action||'');
  if(action==='start')return start(req,user.id,body);
  if(action==='token')return token(user.id);
  if(action==='disconnect')return disconnect(user.id);
  return json({code:'calendar_unknown_action'},400);
});
