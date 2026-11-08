import {createClient} from 'npm:@supabase/supabase-js@2.112.4';
import {readJsonBodyBounded, JsonBodyError} from '../_shared/http-input.js';
import {createGoogleHttp, GoogleHttpError} from '../_shared/google-http.js';
import {decodeGoogleToken, decodeGoogleAccount} from '../_shared/google-receipts.js';
import {createGoogleCredentialVault, GoogleCredentialError} from '../_shared/google-credentials.js';
import {googleOAuthOrigins, googleOAuthResponse} from '../_shared/google-origins.js';

const CLIENT_ID='113139579639-jo09d2gts6kujig6rcaeid3bu40ojjqm.apps.googleusercontent.com';
const SCOPES='https://www.googleapis.com/auth/drive.readonly';
const GOOGLE_AUTH_URL='https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL='https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL='https://oauth2.googleapis.com/revoke';
const DRIVE_ABOUT_URL='https://www.googleapis.com/drive/v3/about?fields=user(permissionId,emailAddress,displayName)';
const STATE_TTL_MS=10*60*1000;
const corsHeaders={
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
const GOOGLE_CLIENT_SECRET=Deno.env.get('GOOGLE_DRIVE_CLIENT_SECRET')||Deno.env.get('GOOGLE_CALENDAR_CLIENT_SECRET')||'';
const REDIRECT_URI=`${SUPABASE_URL}/functions/v1/google-drive-oauth/callback`;
const admin=createClient(SUPABASE_URL,SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const SERVICE='drive';
const allowedOrigins=googleOAuthOrigins(Deno.env.get('GOOGLE_OAUTH_ALLOWED_ORIGINS')||'');
let credentialVault;
function oauthSecurity(){return credentialVault??=createGoogleCredentialVault({keyringJson:Deno.env.get('GOOGLE_OAUTH_TOKEN_KEYS')||'',activeKeyId:Deno.env.get('GOOGLE_OAUTH_TOKEN_ACTIVE_KEY')||'',audience:SUPABASE_URL,allowLegacy:Deno.env.get('GOOGLE_OAUTH_ALLOW_LEGACY_TOKENS')==='true'})}
function ownerContext(userId:string){return {service:SERVICE,ownerId:userId}}

function json(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json','Cache-Control':'no-store'}})}
function dataApiUnavailable(error:any){const status=Number(error?.status||error?.context?.status||0),code=String(error?.code||'').toUpperCase(),message=String(error?.message||'').toUpperCase();return [502,503,504].includes(status)||['PGRST002','PGRST003'].includes(code)||message.includes('PGRST002')||message.includes('PGRST003')}
function adminError(error:any,fallbackCode:string){if(dataApiUnavailable(error))return json({code:'google_drive_data_api_unavailable',message:'Drive OAuth storage is temporarily unavailable'},503);return json({code:fallbackCode,message:'OAuth storage operation failed'},500)}
async function sha256(value:string){const bytes=new TextEncoder().encode(value);const digest=await crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(digest),item=>item.toString(16).padStart(2,'0')).join('')}
function appendOAuthResult(returnUrl:string,status:string,code=''){const url=new URL(returnUrl);url.searchParams.set('drive_oauth',status);if(code)url.searchParams.set('drive_oauth_code',code);else url.searchParams.delete('drive_oauth_code');return url.toString()}
function safeReturnUrl(value:unknown,origin:string){const candidate=new URL(String(value||origin||''));if(!origin||candidate.origin!==origin)throw new Error('invalid_return_url');if(candidate.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(candidate.hostname))throw new Error('invalid_return_url');candidate.hash='';candidate.searchParams.delete('drive_oauth');candidate.searchParams.delete('drive_oauth_code');return candidate.toString()}
async function requireUser(req:Request){const authorization=req.headers.get('Authorization')||'';const token=authorization.match(/^Bearer\s+(.+)$/i)?.[1]||'';if(!token)return null;const client=createClient(SUPABASE_URL,PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:`Bearer ${token}`}}});const {data,error}=await client.auth.getUser(token);if(error||!data.user?.id)return null;return data.user}
const googleHttp=createGoogleHttp();
async function googleToken(params:Record<string,string>){
  return decodeGoogleToken(await googleHttp(GOOGLE_TOKEN_URL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(params)}));
}
async function googleAccountId(accessToken:string){
  return decodeGoogleAccount(await googleHttp(DRIVE_ABOUT_URL,{headers:{Authorization:`Bearer ${accessToken}`}}),'drive');
}
async function revokeGoogleToken(token:string){
  if(!token)return 'not_needed';
  try{
    await googleHttp(GOOGLE_REVOKE_URL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token})},true);
    return 'confirmed';
  }catch{return 'unconfirmed'; /* local unlink must still complete */}
}
function googleFailure(error:unknown){
  return error instanceof GoogleHttpError?error.kind:'response';
}

async function start(req:Request,userId:string,body:any){
  if(!GOOGLE_CLIENT_SECRET)return json({code:'google_drive_backend_not_configured',message:'GOOGLE_DRIVE_CLIENT_SECRET/GOOGLE_CALENDAR_CLIENT_SECRET חסר ב-Supabase Edge Function'},503);
  const origin=req.headers.get('Origin')||'';
  let returnUrl='';
  try{returnUrl=safeReturnUrl(body?.return_url,origin)}catch{return json({code:'google_drive_invalid_return_url',message:'כתובת החזרה של Google Drive אינה תקינה'},400)}
  let state,proof;
  try{const vault=oauthSecurity();state=vault.newState();proof=await vault.proof(state,ownerContext(userId),REDIRECT_URI)}catch{return json({code:'google_drive_credential_protection_unavailable'},503)}
  const stateHash=await sha256(state),expiresAt=new Date(Date.now()+STATE_TTL_MS).toISOString();
  const {error:cleanupError}=await admin.from('google_drive_oauth_states').delete().lt('expires_at',new Date().toISOString());
  if(cleanupError&&dataApiUnavailable(cleanupError))return adminError(cleanupError,'google_drive_state_cleanup_failed');
  const {error}=await admin.rpc('google_oauth_start',{p_service:'drive',p_owner_id:userId,p_state_hash:stateHash,p_return_url:returnUrl,p_expires_at:expiresAt});
  if(error)return adminError(error,'google_drive_state_store_failed');
  const url=new URL(GOOGLE_AUTH_URL);
  url.searchParams.set('client_id',CLIENT_ID);
  url.searchParams.set('redirect_uri',REDIRECT_URI);
  url.searchParams.set('response_type','code');
  url.searchParams.set('scope',SCOPES);
  url.searchParams.set('access_type','offline');
  url.searchParams.set('prompt','consent');
  url.searchParams.set('include_granted_scopes','true');
  url.searchParams.set('state',state);
  url.searchParams.set('code_challenge',proof.challenge);
  url.searchParams.set('code_challenge_method','S256');
  return json({authorize_url:url.toString()});
}


function hasRequiredScopes(value:unknown){const granted=new Set(String(value||'').split(/\s+/).filter(Boolean));return SCOPES.split(' ').every(scope=>granted.has(scope))}

async function token(userId:string){
  if(!GOOGLE_CLIENT_SECRET)return json({code:'google_drive_backend_not_configured',message:'Google Drive OAuth secret חסר ב-Supabase Edge Function'},503);
  const {data:connection,error}=await admin.from('google_drive_connections').select('google_account_id,refresh_token,scope').eq('owner_id',userId).maybeSingle();
  if(error)return adminError(error,'google_drive_connection_read_failed');
  if(!connection?.refresh_token)return json({code:'google_drive_not_connected'},404);
  if(!hasRequiredScopes(connection.scope))return json({code:'google_drive_reconnect_required',reason:'scope_upgrade_required'},409);
  let vault,refreshToken;
  try{vault=oauthSecurity();refreshToken=await vault.open(String(connection.refresh_token),ownerContext(userId))}catch{return json({code:'google_drive_credential_protection_unavailable'},503)}
  try{
    const refreshed=await googleToken({client_id:CLIENT_ID,client_secret:GOOGLE_CLIENT_SECRET,refresh_token:refreshToken,grant_type:'refresh_token'});
    if(!hasRequiredScopes(refreshed.scope))return json({code:'google_drive_reconnect_required',reason:'scope_upgrade_required'},409);
    const rotated=String(refreshed?.refresh_token||'').trim();
    if((rotated&&rotated!==refreshToken)||vault.needsRewrap(connection.refresh_token)){
      const protectedToken=await vault.seal(rotated||refreshToken,ownerContext(userId));
      const {data:rotation,error:rotationError}=await admin.from('google_drive_connections').update({refresh_token:protectedToken,updated_at:new Date().toISOString()}).eq('owner_id',userId).eq('refresh_token',connection.refresh_token).select('google_account_id').maybeSingle();
      if(rotationError)return adminError(rotationError,'google_drive_token_rotation_failed');
      if(!rotation)return json({code:'google_drive_refresh_failed',reason:'connection_changed'},409);
    }else{
      // A non-rotating refresh still needs a receipt from the captured connection.
      const {data:current,error:currentError}=await admin.from('google_drive_connections').select('google_account_id').eq('owner_id',userId).eq('refresh_token',connection.refresh_token).maybeSingle();
      if(currentError)return adminError(currentError,'google_drive_connection_read_failed');
      if(!current)return json({code:'google_drive_refresh_failed',reason:'connection_changed'},409);
    }
    return json({access_token:refreshed.access_token,expires_in:refreshed.expires_in,account_id:String(connection.google_account_id||''),scope:refreshed.scope});
  }catch(error){
    if(error instanceof GoogleCredentialError)return json({code:'google_drive_credential_protection_unavailable'},503);
    const code=String((error as Error&{code?:string})?.code||'');
    if(code==='invalid_grant'){
      const {data:deleted,error:deleteError}=await admin.from('google_drive_connections').delete().eq('owner_id',userId).eq('refresh_token',connection.refresh_token).select('google_account_id').maybeSingle();
      if(deleteError)return adminError(deleteError,'google_drive_disconnect_failed');
      if(!deleted)return json({code:'google_drive_refresh_failed',reason:'connection_changed'},409);
      return json({code:'google_drive_reconnect_required',reason:'google_invalid_grant'},409);
    }
    return json({code:'google_drive_refresh_failed',reason:googleFailure(error)},error instanceof GoogleHttpError&&error.kind==='timeout'?504:502);
  }
}

async function disconnect(userId:string){
  // Commit local unlink and fence callbacks before waiting on Google revocation.
  const {data:credential,error}=await admin.rpc('google_oauth_disconnect',{p_service:'drive',p_owner_id:userId});
  if(error)return adminError(error,'google_drive_disconnect_failed');
  let revocation='not_needed';
  if(credential){
    try{revocation=await revokeGoogleToken(await oauthSecurity().open(String(credential),ownerContext(userId)))}catch{revocation='unconfirmed'}
  }
  return json({ok:true,revocation});
}

async function callback(url:URL){
  const state=String(url.searchParams.get('state')||''),stateHash=state?await sha256(state):'';
  if(!stateHash)return new Response('Invalid OAuth state',{status:400});
  // DELETE RETURNING is the single-use authority, including across Edge isolates.
  const {data:stateRow,error:stateError}=await admin.from('google_drive_oauth_states').delete().eq('state_hash',stateHash).select('owner_id,return_url,expires_at').maybeSingle();
  if(stateError)return adminError(stateError,'google_drive_state_consume_failed');
  if(!stateRow)return new Response('Invalid or expired OAuth state',{status:400});
  const returnUrl=String(stateRow.return_url||'');
  if(new Date(String(stateRow.expires_at||0)).getTime()<Date.now())return Response.redirect(appendOAuthResult(returnUrl,'error','state_expired'),303);
  const oauthError=String(url.searchParams.get('error')||'');
  if(oauthError)return Response.redirect(appendOAuthResult(returnUrl,'error',oauthError),303);
  const code=String(url.searchParams.get('code')||'');
  if(!code)return Response.redirect(appendOAuthResult(returnUrl,'error','missing_code'),303);
  if(!GOOGLE_CLIENT_SECRET)return Response.redirect(appendOAuthResult(returnUrl,'error','backend_not_configured'),303);
  try{
    const vault=oauthSecurity(),proof=await vault.proof(state,ownerContext(stateRow.owner_id),REDIRECT_URI);
    const exchanged=await googleToken({code,code_verifier:proof.verifier,client_id:CLIENT_ID,client_secret:GOOGLE_CLIENT_SECRET,redirect_uri:REDIRECT_URI,grant_type:'authorization_code'});
    const refreshToken=String(exchanged?.refresh_token||'').trim(),accessToken=String(exchanged?.access_token||'').trim(),grantedScope=String(exchanged?.scope||'');
    if(!refreshToken||!accessToken)throw new Error('Google did not return the required offline credentials');
    if(!hasRequiredScopes(grantedScope))throw new Error('Google did not grant the required Drive read-only scope');
    const accountId=await googleAccountId(accessToken);
    const protectedToken=await vault.seal(refreshToken,ownerContext(stateRow.owner_id));
    const {data:published,error:upsertError}=await admin.rpc('google_oauth_publish',{p_service:'drive',p_owner_id:stateRow.owner_id,p_state_hash:stateHash,p_account_id:accountId,p_refresh_token:protectedToken,p_scope:grantedScope});
    if(upsertError){if(dataApiUnavailable(upsertError))return adminError(upsertError,'google_drive_connection_store_failed');throw new Error(upsertError.message)}
    if(published!==true)return Response.redirect(appendOAuthResult(returnUrl,'error','connection_changed'),303);
    // Google revocation is project-wide: revoking the previous credential here
    // can invalidate the newly verified grant (and the sibling integration).
    return Response.redirect(appendOAuthResult(returnUrl,'connected'),303);
  }catch(error){console.error('google drive oauth callback',googleFailure(error));return Response.redirect(appendOAuthResult(returnUrl,'error',error instanceof GoogleHttpError?'google_'+error.kind:'exchange_failed'),303)}
}

async function handle(req:Request){
  const origin=req.headers.get('Origin');
  if(origin&&!allowedOrigins.has(origin))return json({code:'google_drive_origin_not_allowed'},403);
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  const url=new URL(req.url);
  if(url.pathname.endsWith('/callback')&&req.method==='GET')return callback(url);
  if(req.method!=='POST')return json({code:'method_not_allowed'},405);
  const user=await requireUser(req);
  if(!user)return json({code:'google_drive_cloud_auth_required'},401);
  let body;
  try { body=await readJsonBodyBounded(req,16*1024); }
  catch(error) { if(error instanceof JsonBodyError)return json({code:error.code},error.status);throw error; }
  const action=String(body.action||'');
  if(action==='start')return start(req,user.id,body);
  if(action==='token')return token(user.id);
  if(action==='disconnect')return disconnect(user.id);
  return json({code:'google_drive_unknown_action'},400);
}
Deno.serve(async(req:Request)=>googleOAuthResponse(req,await handle(req),allowedOrigins));
