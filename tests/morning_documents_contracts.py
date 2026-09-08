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
ok(0 <= reserve_pos < create_pos and "morning_document_operations_unresolved_debt_uidx" in sql,
   'Morning idempotency: durable DB reservation and unresolved-debt uniqueness precede document creation')
ok("needs_reconciliation" in edge and "morning_creation_uncertain" in edge and "RECONCILE_RELEASE_AGE_MS" in edge,
   'Morning ambiguity handling: network/server uncertainty blocks retries and enters reconciliation')
ok("validateLinkedDocument(ownerId,input)" in edge and ".eq('debt_id',input.debtId)" in edge and ".eq('document_type',305)" in edge,
   'Morning receipt linking: linked tax invoice must be a created document for the same owner and debt')
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
for action in ('open-morning-document','morning-document-type','morning-payment-type','morning-preview','morning-create','morning-open-document','morning-reconcile'):
    ok(f"'{action}':" in actions, f'Morning UI action registered: {action}')
ok("MORNING_CLIENT_SECRET" in setup and "PDF" in setup and "needs_reconciliation" in setup,
   'Morning setup: deployment, storage and uncertain-create recovery are documented')
ok("MORNING_ENV_RAW" in edge and "MORNING_ENV_VALID" in edge and "invalid_environment" in edge,
   'Morning environment: only production/sandbox are accepted; typos fail closed instead of silently using production')
ok("dueDate" in documents and "morningDueDate" in documents and "payload.dueDate=dueDate" in edge and "payload.remarks=remarks" in edge,
   'Morning document details: due date and remarks are supported and validated through the existing date editor')
ok("allocation_number text" in sql and "allocation_checked_at timestamptz" in sql and "allocationNumber" in edge and "refreshCreatedAllocations" in edge and "morning-allocation" in documents,
   'Israel Invoices: compact allocation-number metadata is read back from Morning, persisted and displayed')
ok("const detail=await morningRequest(`/documents/${encodeURIComponent(doc.id)}`" in edge and "canonical read-back failed" in edge,
   'Morning post-create verification: the formal document is re-read after creation without converting a read-back failure into a second create')
ok("Edge Function אחת בלבד" in setup and "אינם שלוש פונקציות" in setup and "supabase functions deploy morning-documents" in setup,
   'Morning setup: deployment guide explicitly documents one Edge Function and three environment variables')
ok("מעל 5,000" in setup and "allocationNumber" in setup and "אין להוסיף לקוד API Key נוסף של רשות המסים" in setup,
   'Morning setup: current 2026 allocation flow and no duplicate direct Tax Authority integration are documented')
ok('5000' not in edge and '5,000' not in documents,
   'Israel Invoices: regulatory allocation threshold is not hard-coded into runtime logic; Morning remains the compliance authority')

ok("async function openDocument(ownerId:string" in edge and ".eq('owner_id',ownerId)" in edge and "morning_document_not_owned" in edge and "openDocument(user.id,body)" in edge,
   'Morning document open: document IDs are owner-scoped before Morning is queried')
config=(ROOT/'netunim-orders/supabase/config.toml').read_text(encoding='utf-8')
ok('[functions.morning-documents]' in config and 'verify_jwt = true' in config.split('[functions.morning-documents]',1)[1],
   'Morning function auth: platform JWT verification remains enabled for signed-in browser calls')
facade='const renderCustomers=(...args)=>domainsCustomersView.renderCustomers(...args);'
ok(facade in main and main.find(facade) < main.find('const uiNavigation=createUiNavigation') < main.find('=createDomainsCustomers({'),
   'Customer composition: renderCustomers facade is a top-level deferred binding visible to runtime probes without changing initialization order')
customer_facades=(
  'setCustomerTab','toggleCustomerBulkMode','toggleCustomerBulkRow','toggleCustomerBulkVisible','deleteSelectedCustomerRows',
  'addCustomerOrder','saveCustomerOrderField','deleteCustomerOrder','setCustomerFlag','saveDebtNote','openDebtModal','saveDebt','deleteDebt',
  'openMorningDocument','syncMorningDocumentType','syncMorningPaymentType','previewMorningDocument','createMorningDocument','openMorningExistingDocument','reconcileMorningDocument',
)
composition=(ROOT/'netunim-orders/site/assets/js/domains/customers/composition.js').read_text(encoding='utf-8')
customer_create=main[main.find('const {',main.find(facade)):main.find('}=createDomainsCustomers({')+2]
customer_actions=main[main.find('  setCustomerTab,'):main.find('  toggleServiceBulkMode:',main.find('  setCustomerTab,'))]
ok(all(f'{name}:(...args)=>' in composition for name in customer_facades)
   and all(name in customer_create for name in customer_facades)
   and all(f'  {name},' in customer_actions for name in customer_facades),
   'Customer composition: the complete customer/debt/Morning action facade is flattened into stable top-level bindings for runtime probes and UI actions')

if errors:
    print('\nERRORS',len(errors))
    raise SystemExit(1)

print('\nALL MORNING DOCUMENT CONTRACTS PASSED')
