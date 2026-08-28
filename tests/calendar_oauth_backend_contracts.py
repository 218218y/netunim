from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
FUNCTION=ROOT/'netunim-orders/supabase/functions/google-calendar-oauth/index.ts'
SQL=ROOT/'netunim-orders/supabase/google_calendar_oauth.sql'
CONFIG=ROOT/'netunim-orders/supabase/config.toml'
errors=[]
def ok(condition,message):
    print(('PASS ' if condition else 'FAIL ')+message)
    if not condition: errors.append(message)

source=FUNCTION.read_text(encoding='utf-8')
sql=SQL.read_text(encoding='utf-8')
config=CONFIG.read_text(encoding='utf-8')
ok("access_type','offline'" in source and "prompt','consent'" in source,'calendar oauth backend requests offline access and a refresh token')
ok('GOOGLE_CALENDAR_CLIENT_SECRET' in source and 'client_secret:GOOGLE_CLIENT_SECRET' in source,'calendar oauth backend keeps the Google client secret server-side')
ok("url.pathname.endsWith('/callback')" in source and 'requireUser(req)' in source,'calendar oauth backend exposes only the Google callback without user JWT and authenticates user actions itself')
ok('[functions.google-calendar-oauth]' in config and 'verify_jwt = false' in config,'calendar oauth function configuration keeps the Google callback reachable while code enforces JWT on user actions')
ok('stateHash=await sha256(state)' in source and "delete().eq('state_hash',stateHash)" in source,'calendar oauth callback uses hashed one-time state and consumes it')
ok("google_calendar_connections" in source and "owner_id',userId" in source,'calendar oauth refresh credentials are keyed by the authenticated Supabase user')
ok('GOOGLE_REVOKE_URL' in source and "action==='disconnect'" in source,'calendar oauth disconnect revokes the server refresh token')
ok('create table if not exists public.google_calendar_connections' in sql and 'create table if not exists public.google_calendar_oauth_states' in sql,'calendar oauth SQL creates isolated credential/state tables')
ok('enable row level security' in sql and 'revoke all on table public.google_calendar_connections from public, anon, authenticated' in sql,'calendar oauth SQL enables RLS and denies browser roles')
ok('grant select, insert, update, delete on table public.google_calendar_connections to service_role' in sql,'calendar oauth tables are writable only by the server role')
if errors:
    print('\nERRORS',len(errors))
    raise SystemExit(1)
print('\nALL CALENDAR OAUTH BACKEND CONTRACTS PASSED')
