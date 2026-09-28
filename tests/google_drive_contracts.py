from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
SITE=ROOT/'netunim-orders/site'
FUNCTION=ROOT/'netunim-orders/supabase/functions/google-drive-oauth/index.ts'
SQL=ROOT/'netunim-orders/supabase/google_drive_oauth.sql'
MIGRATION=ROOT/'supabase/migrations/20260927121000_google_drive_oauth_search.sql'
CONFIGS=[ROOT/'netunim-orders/supabase/config.toml',ROOT/'supabase/config.toml']
SETUP=ROOT/'netunim-orders/GOOGLE_DRIVE_SEARCH_SETUP.txt'
errors=[]

def ok(condition,message):
    print(('PASS ' if condition else 'FAIL ')+message)
    if not condition: errors.append(message)

source=FUNCTION.read_text(encoding='utf-8')
client=(SITE/'assets/js/domains/documents/google-drive.js').read_text(encoding='utf-8')
selector=(SITE/'assets/js/domains/documents/search-source.js').read_text(encoding='utf-8')
main=(SITE/'assets/js/main.js').read_text(encoding='utf-8')
ui=(ROOT/'shared/global-document-search.js').read_text(encoding='utf-8')
view=(SITE/'assets/js/ui/document-search-view.js').read_text(encoding='utf-8')
pdf_viewer=(SITE/'assets/js/domains/documents/pdf-search-viewer.js').read_text(encoding='utf-8')
css=(ROOT/'shared/global-document-search.css').read_text(encoding='utf-8')
sql=SQL.read_text(encoding='utf-8')
migration=MIGRATION.read_text(encoding='utf-8')
headers=(SITE/'_headers').read_text(encoding='utf-8')

ok("const SCOPES='https://www.googleapis.com/auth/drive.readonly'" in source and "REQUIRED_SCOPE='https://www.googleapis.com/auth/drive.readonly'" in source,'Drive OAuth requests read-only content access required for in-site preview')
ok("alt:'media'" in client and '/export?' in client and 'MAX_PREVIEW_BYTES' in client,'Drive preview downloads blob files and exports Workspace documents with bounded client-side preview limits')
ok("access_type','offline'" in source and "prompt','consent'" in source,'Drive OAuth backend requests an offline refresh token on interactive connect')
ok('scope_upgrade_required' in source and 'hasRequiredScope(connection.scope)' in source,'existing metadata-only Drive connections are forced through an explicit scope upgrade')
ok('SUPABASE_PUBLISHABLE_KEYS' in source and 'SUPABASE_SECRET_KEYS' in source,'Drive Edge Function follows the current Supabase key environment convention')
ok('GOOGLE_DRIVE_CLIENT_SECRET' in source and 'GOOGLE_CALENDAR_CLIENT_SECRET' in source and 'client_secret:GOOGLE_CLIENT_SECRET' in source,'Drive OAuth secret remains server-side and can reuse the existing OAuth web client secret')
ok("url.pathname.endsWith('/callback')" in source and 'requireUser(req)' in source,'Drive callback is public only at the gateway while user actions validate Supabase JWT in code')
ok('stateHash=state?await sha256(state)' in source and "delete().eq('state_hash',stateHash)" in source,'Drive OAuth uses hashed one-time callback state')
ok("action==='disconnect'" in source and 'GOOGLE_REVOKE_URL' in source,'Drive disconnect revokes and deletes server credentials')
ok(all('[functions.google-drive-oauth]' in path.read_text(encoding='utf-8') and 'verify_jwt = false' in path.read_text(encoding='utf-8') for path in CONFIGS),'both Supabase configs expose the Google callback with verify_jwt=false')
ok('create table if not exists public.google_drive_connections' in sql.lower() and 'google_drive_oauth_states' in sql,'Drive SQL creates isolated connection/state tables')
ok('enable row level security' in sql.lower() and 'revoke all on table public.google_drive_connections from public, anon, authenticated' in sql.lower(),'Drive OAuth tables enable RLS and deny browser roles')
ok('service_role' in sql and 'google_drive_connections' in migration and 'google_drive_oauth_states' in migration,'Drive OAuth migration mirrors the reviewed server-only table contract')
ok('fullText' in client and 'name' in client and "corpora:'user'" in client and "includeItemsFromAllDrives:'true'" in client,'Drive client searches indexed content and filenames across user-visible Drive items')
ok("mimeType != '${FOLDER_MIME}'" in client and 'nextPageToken' in client and 'MAX_LIST_PAGES' in client,'Drive content search excludes folders and consumes paginated results')
ok("kind:'binary'" in client and "kind:'structured'" in client and "kind:'cloud'" in client and 'webViewLink' in client and 'safeGoogleDriveViewUrl' in client,'Drive results use local preview kinds when possible and retain validated official Google links as fallback')
ok("provider:'google-drive'" in client and '/\\bAndroid\\b/i' in client and 'LOCAL_FALLBACK_CODES' in selector and 'withFallback' in selector and "local:'local:'" in selector and "drive:'drive:'" in selector,'Android uses Drive while Windows prefers local search and has namespaced Drive failover')
ok('createDomainsGoogleDriveSearch' in main and 'createDomainsDocumentSearch' in main and 'documentBridge:domainsDocumentBridge' in main,'application composition routes both sources through the existing unified-search port')
kupa_site=ROOT/'netunim-kupa/site'
kupa_main=(kupa_site/'assets/js/main.js').read_text(encoding='utf-8')
kupa_html=(kupa_site/'index.html').read_text(encoding='utf-8')
kupa_headers=(kupa_site/'_headers').read_text(encoding='utf-8')
ok('createDomainsGoogleDriveSearch' in kupa_main and 'createDomainsDocumentSearch' in kupa_main and 'documentBridge:domainsDocumentBridge' in kupa_main,'Kupa composition uses the same local/Drive document-search source')
ok(all(token in kupa_html for token in ('globalSearchFilterAll','globalSearchFilterFiles','globalSearchFilterContent','globalSearchDocumentPreview')),'Kupa exposes the same advanced full-page search controls and preview surface')
ok('https://www.googleapis.com' in kupa_headers and 'http://127.0.0.1:8766' in kupa_headers and "worker-src 'self' blob:" in kupa_headers,'Kupa CSP permits the same Drive, bridge and local preview runtime capabilities')
ok('data-document-open-link' in ui and 'פתח את הקובץ ב-Google Drive' in ui and 'document-preview-open' in css and 'document-provider-notice' in css,'Drive preview keeps a touch-friendly open fallback and Windows failover notice')
ok('createPdfSearchViewer' in ui and 'createDocxSearchViewer' in ui and 'createSpreadsheetSearchViewer' in ui and 'showNativePreview' in ui,'new Drive integration preserves the newer Windows local preview pipeline')
ok('document-search-view.js' in ui and 'documentResultsTableHtml' in ui and 'documentIconKind' in view and 'previewDetailsHtml' in view,'global search delegates document presentation helpers instead of growing one oversized UI responsibility')
ok('ENABLE_FORMS' in pdf_viewer and 'interactiveForms?' in pdf_viewer and 'interactiveForms:!isGoogleDriveResult(id)' in ui,'Drive PDF preview uses static form appearances while local PDF preview preserves its existing interactive/copyable fields')
ok('https://www.googleapis.com' in headers,'CSP permits direct Drive API calls without adding a remote script source')
ok(SETUP.is_file() and 'drive.readonly' in SETUP.read_text(encoding='utf-8') and 'alt=media' in SETUP.read_text(encoding='utf-8') and 'files.export' in SETUP.read_text(encoding='utf-8'),'Drive deployment instructions cover scope upgrade, direct preview and Workspace export')

if errors:
    print('\nERRORS',len(errors))
    for item in errors: print('-',item)
    raise SystemExit(1)
print('\nALL GOOGLE DRIVE SEARCH/OPEN CONTRACTS PASSED')
