import {createClient} from 'npm:@supabase/supabase-js@2.112.4';
import {getMfaAssuredUser} from '../_shared/mfa-assurance.js';
import {readJsonBodyBounded, JsonBodyError} from '../_shared/http-input.js';
import {createGoogleHttp, GoogleHttpError} from '../_shared/google-http.js';
import {decodeGoogleToken} from '../_shared/google-receipts.js';
import {createGoogleCredentialVault} from '../_shared/google-credentials.js';
import {googleOAuthOrigins, googleOAuthResponse} from '../_shared/google-origins.js';
import {peopleSearchUrl, searchRows, mergeSearchRows} from './people.js';

const SERVICE = 'contacts';
const CONNECTIONS = 'google_contacts_connections';
const STATES = 'google_contacts_oauth_states';
const CONTACTS_SCOPES = ['https://www.googleapis.com/auth/contacts.readonly', 'https://www.googleapis.com/auth/contacts.other.readonly'];
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const CLIENT_ID = Deno.env.get('GOOGLE_CONTACTS_CLIENT_ID') || '';
const CLIENT_SECRET = Deno.env.get('GOOGLE_CONTACTS_CLIENT_SECRET') || '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/google-contacts-oauth/callback`;
const allowedOrigins = googleOAuthOrigins(Deno.env.get('GOOGLE_OAUTH_ALLOWED_ORIGINS') || '');

function envKey(jsonName: string, legacyName: string) {
  try {
    const keys = JSON.parse(Deno.env.get(jsonName) || '{}');
    const key = keys?.default || Object.values(keys || {}).find(value => typeof value === 'string' && value);
    if (typeof key === 'string' && key) return key;
  } catch { /* fall back to the legacy variable in older deployments */ }
  return Deno.env.get(legacyName) || '';
}

const admin = createClient(SUPABASE_URL, envKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY'), {auth: {persistSession: false, autoRefreshToken: false}});
const googleHttp = createGoogleHttp({timeoutMs: 6500});
let vault: ReturnType<typeof createGoogleCredentialVault>;
function credentials() {
  return vault ??= createGoogleCredentialVault({audience: SUPABASE_URL, keyringJson: Deno.env.get('GOOGLE_OAUTH_TOKEN_KEYS') || '', activeKeyId: Deno.env.get('GOOGLE_OAUTH_TOKEN_ACTIVE_KEY') || ''});
}
const ownerContext = (ownerId: string) => ({ownerId, service: SERVICE});
const configured = () => !!(CLIENT_ID && CLIENT_SECRET);
const hasScopes = (scope: string) => CONTACTS_SCOPES.every(required => scope.split(/\s+/).includes(required));
const storageFailure = () => json({code: 'contacts_storage_unavailable'}, 503);
const reconnect = () => json({code: 'contacts_reconnect_required'}, 409);
const changed = () => json({code: 'contacts_connection_changed'}, 409);

function json(data: unknown, status = 200) {
  return Response.json(data, {status, headers: {'Cache-Control': 'no-store'}});
}

async function requireUser(req: Request) {
  const token = req.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;
  const client = createClient(SUPABASE_URL, envKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY'), {
    auth: {persistSession: false, autoRefreshToken: false}, global: {headers: {Authorization: `Bearer ${token}`}},
  });
  return getMfaAssuredUser(client.auth, admin.auth.admin, token);
}

async function stateHash(state: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(state));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function exchange(params: Record<string, string>) {
  return decodeGoogleToken(await googleHttp(GOOGLE_TOKEN_URL, {
    method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({...params, client_id: CLIENT_ID, client_secret: CLIENT_SECRET}),
  }));
}

async function start(owner: string, origin: string | null) {
  if (!origin || !allowedOrigins.has(origin)) return json({code: 'contacts_origin_not_allowed'}, 403);
  const protection = credentials(), state = protection.newState();
  const proof = await protection.proof(state, ownerContext(owner), REDIRECT_URI);
  const {error: cleanupError} = await admin.from(STATES).delete().lt('expires_at', new Date().toISOString());
  if (cleanupError) return storageFailure();
  const {error} = await admin.rpc('google_oauth_start', {
    p_service: SERVICE, p_owner_id: owner, p_state_hash: await stateHash(state), p_return_url: origin,
    p_expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  });
  if (error) return storageFailure();
  const url = new URL(GOOGLE_AUTH_URL);
  url.search = new URLSearchParams({client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: 'code',
    scope: ['openid', 'email', ...CONTACTS_SCOPES].join(' '), access_type: 'offline', prompt: 'consent select_account',
    state, code_challenge: proof.challenge, code_challenge_method: 'S256'}).toString();
  return json({authorize_url: url.toString()});
}

function callbackResult(connected: boolean) {
  const title = connected ? 'אנשי הקשר של Google חוברו' : 'חיבור אנשי הקשר לא הושלם';
  const instructions = connected ? 'חזרו לטופס Morning ולחצו על „בדוק חיבור” כדי להמשיך בחיפוש.' : 'חזרו לטופס Morning ונסו לחבר את Google שוב. בעת החיבור אשרו גישה לאנשי קשר ולאנשי קשר אחרים.';
  return new Response(`${title}\n\n${instructions}`, {
    status: connected ? 200 : 400,
    headers: {'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff'},
  });
}

async function callback(url: URL) {
  const state = url.searchParams.get('state') || '';
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,31}\.[a-f0-9]{64}$/.test(state)) return callbackResult(false);
  const hash = await stateHash(state);
  const {data: intent, error} = await admin.from(STATES).delete().eq('state_hash', hash).select('owner_id,expires_at').maybeSingle();
  const code = url.searchParams.get('code');
  if (error || !intent || !(Date.parse(intent.expires_at) > Date.now()) || !code || url.searchParams.has('error') || !configured()) return callbackResult(false);
  try {
    const protection = credentials(), context = ownerContext(intent.owner_id);
    const proof = await protection.proof(state, context, REDIRECT_URI);
    const token = await exchange({code, code_verifier: proof.verifier, redirect_uri: REDIRECT_URI, grant_type: 'authorization_code'});
    if (!token.refresh_token || !hasScopes(token.scope)) return callbackResult(false);
    const identity = await googleHttp(GOOGLE_USERINFO_URL, {headers: {Authorization: `Bearer ${token.access_token}`}});
    const email = identity.email;
    if (identity.email_verified !== true || typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(email)) return callbackResult(false);
    const {data: published, error: publishError} = await admin.rpc('google_oauth_publish', {
      p_service: SERVICE, p_owner_id: intent.owner_id, p_state_hash: hash, p_account_id: email,
      p_refresh_token: await protection.seal(token.refresh_token, context), p_scope: token.scope,
    });
    return callbackResult(!publishError && published === true);
  } catch { return callbackResult(false); }
}

async function status(owner: string) {
  const {data, error} = await admin.from(CONNECTIONS).select('google_account_id,grant_id,scope').eq('owner_id', owner).maybeSingle();
  if (error) return storageFailure();
  return json({account: data?.google_account_id || '', grant: data?.grant_id || '', reconnect: !!data && !hasScopes(data.scope)});
}

async function search(owner: string, grant: string, query: string) {
  const {data: connection, error} = await admin.from(CONNECTIONS).select('grant_id,refresh_token,scope').eq('owner_id', owner).maybeSingle();
  if (error) return storageFailure();
  if (!connection || connection.grant_id !== grant) return changed();
  if (!hasScopes(connection.scope)) return reconnect();
  const {data: admitted, error: limitError} = await admin.rpc('take_google_contacts_search_slot', {p_owner_id: owner, p_grant_id: grant});
  if (limitError) return storageFailure();
  if (admitted !== true) return json({code: 'contacts_search_limit'}, 429);

  const protection = credentials(), context = ownerContext(owner);
  const storedToken = connection.refresh_token;
  const credential = await protection.open(storedToken, context);
  let token;
  try {
    token = await exchange({refresh_token: credential, grant_type: 'refresh_token'});
  } catch (error) {
    if (!(error instanceof GoogleHttpError) || error.code !== 'invalid_grant') throw error;
    // Preserve account identity for reconnect/disconnect and avoid deleting a newer grant.
    const {data, error: receiptError} = await admin.from(CONNECTIONS).select('grant_id').eq('owner_id', owner).eq('grant_id', grant).eq('refresh_token', storedToken).maybeSingle();
    if (receiptError) return storageFailure();
    return data ? reconnect() : changed();
  }
  if (!hasScopes(token.scope)) return reconnect();
  if ((token.refresh_token && token.refresh_token !== credential) || protection.needsRewrap(storedToken)) {
    const {data, error: rotationError} = await admin.from(CONNECTIONS).update({
      refresh_token: await protection.seal(token.refresh_token || credential, context), updated_at: new Date().toISOString(),
    }).eq('owner_id', owner).eq('grant_id', grant).eq('refresh_token', storedToken).select('grant_id').maybeSingle();
    if (rotationError) return storageFailure();
    if (!data) return changed();
  }

  const sources = ['contacts', 'other'];
  const matches = await Promise.allSettled(sources.map(async source => {
    const result = await googleHttp(peopleSearchUrl(source, query), {headers: {Authorization: `Bearer ${token.access_token}`}});
    return query ? searchRows(source, result) : [];
  }));
  const {data: current, error: receiptError} = await admin.from(CONNECTIONS).select('grant_id').eq('owner_id', owner).eq('grant_id', grant).maybeSingle();
  if (receiptError) return storageFailure();
  if (!current) return changed();
  const missing = sources.filter((_, index) => matches[index].status === 'rejected');
  if (missing.length === sources.length) {
    if (matches.every(result => result.status === 'rejected' && result.reason instanceof GoogleHttpError && result.reason.status === 401)) return reconnect();
    return json({code: 'contacts_provider_unavailable'}, 502);
  }
  return json({results: mergeSearchRows(matches.flatMap(result => result.status === 'fulfilled' ? [result.value] : []), query), missing, grant});
}

async function handle(req: Request) {
  const origin = req.headers.get('Origin');
  if (origin && !allowedOrigins.has(origin)) return json({code: 'contacts_origin_not_allowed'}, 403);
  if (req.method === 'OPTIONS') return new Response(null, {status: 204, headers: {'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS'}});
  const url = new URL(req.url);
  if (req.method === 'GET' && url.pathname.endsWith('/callback')) return callback(url);
  if (req.method !== 'POST') return json({code: 'method_not_allowed'}, 405);
  const user = await requireUser(req);
  if (!user) return json({code: 'contacts_cloud_auth_required'}, 401);
  const body = await readJsonBodyBounded(req, 2048);
  if (body.action === 'disconnect') {
    // Provider revocation is project-wide. Unlink this service via the existing intent authority.
    const {error} = await admin.rpc('google_oauth_disconnect', {p_service: SERVICE, p_owner_id: user.id});
    return error ? storageFailure() : json({ok: true});
  }
  if (!configured()) return json({code: 'contacts_not_configured'}, 503);
  if (body.action === 'status') return status(user.id);
  if (body.action === 'start') return start(user.id, origin);
  if (body.action === 'search' || body.action === 'prepare') {
    const query = body.action === 'prepare' ? '' : typeof body.query === 'string' ? body.query.trim() : '';
    if (typeof body.grant !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(body.grant) ||
        body.action === 'search' && (query.length < 2 || query.length > 180 || /[\x00-\x1f\x7f]/.test(query))) return json({code: 'contacts_invalid_search'}, 400);
    return search(user.id, body.grant, query);
  }
  return json({code: 'contacts_unknown_action'}, 400);
}

Deno.serve(async (req: Request) => {
  try { return googleOAuthResponse(req, await handle(req), allowedOrigins); }
  catch (error) {
    const response = error instanceof JsonBodyError ? json({code: error.code}, error.status)
      : error instanceof GoogleHttpError ? json({code: 'contacts_provider_unavailable'}, error.kind === 'timeout' ? 504 : 502)
      : json({code: 'contacts_unavailable'}, 503);
    return googleOAuthResponse(req, response, allowedOrigins);
  }
});
