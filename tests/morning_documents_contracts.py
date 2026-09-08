from pathlib import Path
import re

ROOT=Path(__file__).resolve().parents[1]
SITE=ROOT/'netunim-orders/site'
FUNCTION=ROOT/'netunim-orders/supabase/functions/morning-documents/index.ts'
SQL=ROOT/'netunim-orders/supabase/morning_documents.sql'
DOCS=ROOT/'netunim-orders/MORNING_SETUP.md'
errors=[]

def ok(condition,message):
    print(('PASS ' if condition else 'FAIL ')+message)
    if not condition: errors.append(message)

edge=FUNCTION.read_text(encoding='utf-8')
sql=SQL.read_text(encoding='utf-8')
documents=(SITE/'assets/js/domains/customers/documents.js').read_text(encoding='utf-8')
view=(SITE/'assets/js/domains/customers/view.js').read_text(encoding='utf-8')
editor=(SITE/'assets/js/domains/customers/editor.js').read_text(encoding='utf-8')
bulk=(SITE/'assets/js/domains/customers/bulk.js').read_text(encoding='utf-8')
composition=(SITE/'assets/js/domains/customers/composition.js').read_text(encoding='utf-8')
actions=(SITE/'assets/js/ui/actions.js').read_text(encoding='utf-8')
main=(SITE/'assets/js/main.js').read_text(encoding='utf-8')
setup=DOCS.read_text(encoding='utf-8')

ok("const DOCUMENT_TYPES=new Set([305,320,400])" in edge and "305:'חשבונית מס'" in documents and "320:'חשבונית מס / קבלה'" in documents and "400:'קבלה'" in documents,
   'Morning document types: tax invoice, invoice/receipt and receipt are explicit and consistent')
ok("const PAYMENT_TYPES=new Set([1,2,3,4])" in edge and "1:'מזומן'" in documents and "2:'צ׳ק'" in documents and "3:'כרטיס אשראי'" in documents and "4:'העברה בנקאית'" in documents,
   'Morning payment enum: cash/check/card/electronic transfer codes are fixed on both client and server')
ok("https://api.morning.co/idp/v1/oauth/token" in edge and "grant_type:'client_credentials'" in edge and "'Content-Type':'application/json'" in edge and "expiresAt" in edge and "https://api.greeninvoice.co.il/api/v1" in edge,
   'Morning auth: official OAuth 2.0 JSON client-credentials contract and token expiry are handled separately from the resource API')
ok("api.sandbox.morning.dev/idp/v1/oauth/token" in edge and "sandbox.d.greeninvoice.co.il/api/v1" in edge and "MORNING_ENV" in edge,
   'Morning auth: sandbox is a separate explicit environment with separate endpoints')
ok("MORNING_CLIENT_ID" in edge and "MORNING_CLIENT_SECRET" in edge and "MORNING_CLIENT_ID" not in ''.join(p.read_text(encoding='utf-8',errors='ignore') for p in SITE.rglob('*') if p.is_file()),
   'Morning secrets: credential names and values stay outside browser assets')
ok("requireUser(req)" in edge and "morning_cloud_auth_required" in edge and "supaFetch(BACKEND_PATH" in documents,
   'Morning security: browser uses authenticated Supabase Edge Function, never Morning directly')
ok("client:any={name:clientName,add:false}" in edge and "vatType:0" in edge and "vatType:1" in edge,
   'Morning payload: one-off client, document-default VAT and VAT-included income row are explicit')
ok("/documents/preview" in edge and "pdfBase64" in edge and "morningPreviewFrame" in documents,
   'Morning preview: PDF preview is available without creating a formal document')
reserve_pos=edge.find('reserved=await reserveOperation')
create_pos=edge.find("morningRequest('/documents'")
ok(0 <= reserve_pos < create_pos and "morning_document_operations_unresolved_fingerprint_uidx" in sql,
   'Morning idempotency: durable DB reservation and unresolved-fingerprint uniqueness precede document creation')
ok("needs_reconciliation" in edge and "morning_creation_uncertain" in edge and "RECONCILE_WINDOW_MS" in edge,
   'Morning ambiguity handling: network/server uncertainty blocks retries and enters reconciliation')
ok("validateLinkedDocument(input)" in edge and "Number(detail?.type)!==305" in edge and "Number(detail?.status)!==0" in edge,
   'Morning receipt linking: linked tax invoice is verified directly in the current Morning business, including manual invoices')
ok("morningRequest(`/documents/${encodeURIComponent(id)}`" in edge and "matchesCandidate(detail,row,true)" in edge,
   'Morning reconciliation: ambiguous search candidates are re-read as full documents before linking')
ok("local_link_pending:true" in edge and "Morning document created but metadata persistence failed" in edge,
   'Morning post-create durability: a DB metadata failure cannot turn a confirmed Morning success into a retryable failure')
ok("revoke all on table public.morning_document_operations from public, anon, authenticated" in sql and "grant select,insert,update,delete on table public.morning_document_operations to service_role" in sql,
   'Morning ledger: RLS plus browser-role revocation keeps write authority server-side')
ok(not re.search(r'\b(pdf|base64|blob|document_content)\b\s+(?:text|jsonb|bytea)',sql,re.I),
   'Morning storage: ledger schema does not store PDF/base64/document bodies')
ok("createDomainsCustomers" in composition and "openMorningDocument" in main and main.count("./domains/customers/") <= 1 and len(main.encode('utf-8')) < 60_000,
   'Customer composition: Morning stays behind one customer-domain composition boundary and main.js remains below the architecture size limit')
for action in ('open-morning-document','open-morning-standalone','morning-document-type','morning-payment-type','morning-preview','morning-create','morning-open-document','morning-reconcile'):
    ok(f"'{action}':" in actions, f'Morning UI action registered: {action}')

ok("openMorningDocumentModal({prefill:null})" in documents and "openStandaloneMorningDocument" in documents and "debt_id" not in documents and "open-morning-standalone" in view,
   'Morning standalone documents: general document creation shares the prefill flow and has no debt scope')
ok('ללא חוב מקושר' not in documents,
   'Morning standalone document UI: redundant unlinked-debt hero copy stays removed')
ok("customer-morning-add-btn" in view and view.find('customer-visible-total') < view.find('customer-morning-add-btn') and 'data-action="open-debt-modal-2"' in view and view.find('data-action="open-debt-modal-2"') < view.find('${morningDocumentButton(d)}'),
   'Customer Morning UI: standalone document action is at the toolbar edge and debt-row edit precedes Morning in RTL flow')
ok("debt_id" not in sql and "debt_id" not in edge and 'morning_document_operations' not in editor and 'morning_document_operations' not in bulk,
   'Morning retention: deleting a local debt cannot cascade into or explicitly delete the Morning document ledger')
ok("MORNING_CLIENT_SECRET" in setup and "PDF" in setup and "needs_reconciliation" in setup,
   'Morning setup: deployment, storage and uncertain-create recovery are documented')
ok("MORNING_ENV_RAW" in edge and "MORNING_ENV_VALID" in edge and "invalid_environment" in edge,
   'Morning environment: only production/sandbox are accepted; typos fail closed instead of silently using production')
ok("dueDate" in documents and "morningDueDate" in documents and "payload.dueDate=dueDate" in edge and "payload.remarks=remarks" in edge,
   'Morning document details: due date and remarks are supported and validated through the existing date editor')
ok("allocation_number text" in sql and "allocation_checked_at timestamptz" in sql and "allocationNumber" in edge and "refreshCreatedAllocation" in edge and "morning-allocation" in documents,
   'Israel Invoices: compact allocation-number metadata is read back from Morning, persisted and displayed')
ok("const detail=await morningRequest(`/documents/${encodeURIComponent(doc.id)}`" in edge and "canonical read-back failed" in edge,
   'Morning post-create verification: the formal document is re-read after creation without converting a read-back failure into a second create')
ok("Edge Function אחת בלבד" in setup and "אינם שלוש פונקציות" in setup and "supabase functions deploy morning-documents" in setup,
   'Morning setup: deployment guide explicitly documents one Edge Function and three environment variables')
ok("מעל 5,000" in setup and "allocationNumber" in setup and "אין להוסיף לקוד API Key נוסף של רשות המסים" in setup,
   'Morning setup: current 2026 allocation flow and no duplicate direct Tax Authority integration are documented')
ok('5000' not in edge and '5,000' not in documents,
   'Israel Invoices: regulatory allocation threshold is not hard-coded into runtime logic; Morning remains the compliance authority')

ok("async function getDocument(body:any" in edge and "document_links" in edge and "getDocument(body,true)" in edge,
   'Morning document open: document IDs are checked with the authenticated current Morning business')
config=(ROOT/'netunim-orders/supabase/config.toml').read_text(encoding='utf-8')
ok('[functions.morning-documents]' in config and 'verify_jwt = true' in config.split('[functions.morning-documents]',1)[1],
   'Morning function auth: platform JWT verification remains enabled for signed-in browser calls')
ok('const domainsCustomers=createDomainsCustomers({' in main and 'const renderCustomers=' not in main
   and 'renderCustomers:(...args)=>domainsCustomers.renderCustomers(...args)' in main,
   'Customer composition: deferred navigation uses the public domain API without a test-only lexical facade')
customer_actions=(
  'setCustomerTab','toggleCustomerBulkMode','toggleCustomerBulkRow','toggleCustomerBulkVisible','deleteSelectedCustomerRows',
  'addCustomerOrder','saveCustomerOrderField','deleteCustomerOrder','setCustomerFlag','saveDebtNote','openDebtModal','saveDebt','deleteDebt',
  'openMorningDocument','openStandaloneMorningDocument','syncMorningDocumentType','syncMorningPaymentType','previewMorningDocument','createMorningDocument','openMorningExistingDocument','reconcileMorningDocument',
)
composition=(ROOT/'netunim-orders/site/assets/js/domains/customers/composition.js').read_text(encoding='utf-8')
ok(all(f'{name}:(...args)=>' in composition for name in customer_actions)
   and all(f'{name}:(...args)=>domainsCustomers.{name}(...args)' in main for name in customer_actions),
   'Customer composition: customer/debt/Morning actions are wired through the same public API used by tests')


browser=(SITE/'assets/js/domains/customers/documents-browser.js').read_text(encoding='utf-8')
migration=next((ROOT/'supabase/migrations').glob('*_morning_operation_ledger.sql')).read_text(encoding='utf-8')
ok(all(name not in documents for name in ('applyCreatedOperations','scheduleSave','renderCustomers','__standalone__','activeScopeId')) and 'customerDebts' not in edge and 'customerDebts' not in migration,
   'Morning cannot change debt flags, amounts or debt storage')
ok('operation_id uuid primary key' in sql and 'owner_id,environment,request_fingerprint' in sql and 'document_url' not in sql,
   'Ledger has globally unique operation IDs, environment isolation and no signed URL column')
ok('lock table' in migration and migration.index('raise exception') < migration.index('create table public.morning_document_operations_backup_20260908') < migration.index('drop table public.morning_document_operations;'),
   'Migration locks and guards important rows before backup and DROP; backup is retained')
ok('from.setDate(from.getDate()-90)' in browser and 'page:0,pageSize:25' in browser and "order:'DESC'" in browser and 'CACHE_TTL_MS=90_000' in browser,
   'Document browser defaults to 90 days, 25 per page and bounded memory cache')
ok(all(action in edge for action in ('search_documents','get_document','document_links')) and 'morning_documents' not in sql,
   'Live search and on-demand details/links share one Edge Function without document synchronization')
ok('Number.isSafeInteger(page)' in edge and 'pageSize>50' in edge and 'SEARCH_TYPES.has(v)' in edge and 'SEARCH_STATUSES.has(v)' in edge and 'clientName.length>160' in edge,
   'Search uses a server whitelist for dates, pagination, types, statuses, client and sort')
ok('localStorage' not in browser and 'sessionStorage' not in browser and 'document_links' in browser and 'noopener noreferrer' in browser,
   'Browser requests fresh document links and never persists documents or signed URLs')

if errors:
    print('\nERRORS',len(errors))
    raise SystemExit(1)

print('\nALL MORNING DOCUMENT CONTRACTS PASSED')
