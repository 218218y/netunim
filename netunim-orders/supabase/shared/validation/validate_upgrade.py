from pathlib import Path
import re, subprocess, tempfile, json, hashlib, sys
SHARED=Path(__file__).resolve().parents[1]
ORDERS=Path(__file__).resolve().parents[3]
WORKSPACE=ORDERS.parent
K=WORKSPACE/'netunim-kupa'; O=ORDERS; S=SHARED
errors=[]; notes=[]

def ok(cond,msg):
    if cond: print('PASS',msg)
    else: print('FAIL',msg); errors.append(msg)

def extract_js(html):
    text=html.read_text(encoding='utf-8')
    out=[]
    pat=re.compile(r'<script(?P<attrs>[^>]*)>(?P<body>.*?)</script>',re.I|re.S)
    for m in pat.finditer(text):
        attrs=m.group('attrs') or ''
        mt=re.search(r'\btype\s*=\s*["\']([^"\']+)["\']',attrs,re.I)
        typ=(mt.group(1).strip().lower() if mt else '')
        if typ and typ not in ('text/javascript','application/javascript','module'):
            continue
        if re.search(r'\bsrc\s*=',attrs,re.I):
            continue
        out.append(m.group('body'))
    return '\n;\n'.join(out)

for label,p in [('kupa',K/'site/index.html'),('orders',O/'site/index.html')]:
    js=extract_js(p)
    with tempfile.NamedTemporaryFile('w',suffix='.js',encoding='utf-8',delete=False) as f:
        f.write(js); n=f.name
    r=subprocess.run(['node','--check',n],capture_output=True,text=True)
    ok(r.returncode==0,f'{label}: all inline JavaScript parses')
    if r.returncode: print(r.stderr)

ks=(K/'site/index.html').read_text(encoding='utf-8')
os=(O/'site/index.html').read_text(encoding='utf-8')
ok("KUPA_CHECKS_TABLE" not in os and "saveChecksToKupaCloud" not in os and "reconcileKupaBankForChecks" not in os,'orders: legacy Kupa-as-check-owner code removed')
ok("delete x.checks" in ks,'kupa: cloud payload removes checks')
ok("delete x.checks" in os,'orders: cloud payload removes checks')
ok("shared_checks_documents" in ks and "save_shared_checks_document" in ks,'kupa: shared checks endpoint configured')
ok("shared_checks_documents" in os and "save_shared_checks_document" in os,'orders: shared checks endpoint configured')
ok("ensureSharedChecksForNewCloud" in ks,'kupa: explicit greenfield shared-checks onboarding exists')
ok("sharedChecksBootstrapActive&&!l.length&&r.length>0&&b.length>0&&jsonEq(b,r)" in ks and "repairEmptyBootstrap" in ks and "SHARED_CHECKS_BOOT_REPAIR_KEY" not in ks,'kupa: each page bootstrap protects the shared cloud list without pending-state or stale-marker dependence')
ok("אין ליצור אותו אוטומטית" in ks and "אין ליצור אותו אוטומטית" in os,'clients: missing shared store fails safe outside greenfield setup')
ok("Array.isArray(d.bank.adjustments)" in ks,'kupa: cloud-state bank adjustments shape is validated before use')
ok("!Array.isArray(d)" in os,'orders: cloud state rejects arrays')

for label,p,cache in [
 ('kupa',K/'site/service-worker.js','kupa-app-shell-v8-ascii-local-files'),
 ('orders',O/'site/service-worker.js','orders-app-shell-v6-ascii-local-files')]:
 s=p.read_text(encoding='utf-8'); ok(cache in s,f'{label}: service-worker cache bumped for atomic deployment')

sqls={'preflight':(S/'preflight.sql').read_text(encoding='utf-8'),'shared_setup':(S/'setup.sql').read_text(encoding='utf-8'),'cutover':(S/'cutover.sql').read_text(encoding='utf-8'),'postflight':(S/'postflight.sql').read_text(encoding='utf-8'),'kupa_setup':(K/'supabase/setup.sql').read_text(encoding='utf-8'),'orders_setup':(O/'supabase/setup.sql').read_text(encoding='utf-8')}

def dollar_balanced(s):
    tags=re.findall(r'\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$',s)
    stack=[]
    # SQL dollar quotes cannot nest semantically; tags should occur in pairs. Pair-count is robust enough for our generated files.
    from collections import Counter
    c=Counter(tags)
    return all(v%2==0 for v in c.values()),c
for name,s in sqls.items():
 b,c=dollar_balanced(s); ok(b,f'{name}: dollar-quote delimiters balanced')
 ok('security definer' not in s.lower(),f'{name}: no SECURITY DEFINER')

cut=sqls['cutover']
ok(re.match(r'(?s)^\s*--.*?\nbegin;',cut) is not None,'cutover: begins with transaction')
ok(re.search(r'\bcommit\s*;',cut,re.I) is not None and cut.lower().rfind('commit;') > cut.lower().rfind('create function'),'cutover: has final COMMIT after DDL/RPC installation')
ok("lock table public.kupa_documents" in cut and "lock table public.order_management_documents" in cut,'cutover: locks both source documents')
ok("preflight_duplicate_backup_revision" in cut and "preflight_missing_backup_tables" in cut,'cutover: validates backup infrastructure before writes')
first_snapshot=cut.find('Snapshot בלתי-תלוי')
for idxname in ['kupa_document_backups_owner_doc_revision_uidx','kupa_periodic_backups_owner_doc_revision_uidx','order_management_backups_owner_doc_revision_uidx','order_management_periodic_backups_owner_doc_revision_uidx']:
 ok(0 <= cut.find(idxname) < first_snapshot,f'cutover: {idxname} exists before first source snapshot')
ok("preflight_checks_not_identical_between_sources" in cut,'cutover: refuses divergent old check copies')
ok("preflight_legacy_check_deposit_adjustment_exists" in cut,'cutover: refuses legacy duplicated bank effects')
ok("preflight_bank_snapshot_not_fresh" in cut,'cutover: requires fresh bank baseline')
ok("state = o.state - 'checks'" in cut,'cutover: removes checks from live Orders document')
ok("k.state - 'checks' - 'bank'" in cut,'cutover: removes checks from live Kupa document')
ok("'bankEvents','[]'::jsonb" in cut,'cutover: creates empty post-baseline bank event log')

pre=sqls['preflight']; post=sqls['postflight']
ok(not re.search(r'\b(insert|update|delete|alter|create|drop|truncate|grant|revoke)\b',re.sub(r'--.*','',pre),re.I),'preflight: read-only (no DML/DDL keywords)')
ok(not re.search(r'\b(insert|update|delete|alter|create|drop|truncate|grant|revoke)\b',re.sub(r'--.*','',post),re.I),'postflight: read-only (no DML/DDL keywords)')
ok('preflight_duplicate_backup_revision' in pre,'preflight: backup revision uniqueness checked')

# Compare final function contracts embedded in cutover with standalone setup files.
def funcdef(text,name):
    pat=re.compile(r'create\s+(?:or\s+replace\s+)?function\s+public\.'+re.escape(name)+r'\b.*?\n\$\$\s*;',re.I|re.S)
    m=pat.search(text)
    return m.group(0) if m else None

def norm(s): return re.sub(r'\s+',' ',s or '').strip().lower()
comparisons=[
 ('save_kupa_document',sqls['setup.sql'] if False else (K/'supabase/setup.sql').read_text(encoding='utf-8')),
 ('kupa_guard_document_write',(K/'supabase/setup.sql').read_text(encoding='utf-8')),
 ('save_order_management_document',(O/'supabase/setup.sql').read_text(encoding='utf-8')),
 ('order_management_guard_document_write',(O/'supabase/setup.sql').read_text(encoding='utf-8')),
 ('save_shared_checks_document',(S/'setup.sql').read_text(encoding='utf-8')),
 ('shared_checks_guard_document_write',(S/'setup.sql').read_text(encoding='utf-8')),
]
for name,stand in comparisons:
 a=funcdef(cut,name); b=funcdef(stand,name)
 ok(bool(a and b),f'{name}: function found in cutover and standalone setup')
 if a and b: ok(norm(a)==norm(b),f'{name}: cutover and standalone definitions are identical')
 if name.startswith('save_') and a:
  ok(not re.search(r'on\s+conflict\s*\(\s*owner_id\s*,\s*document_name\s*,\s*revision\s*\)',a,re.I),f'{name}: ON CONFLICT does not collide with the revision output parameter')

# Key bank-event semantics present in shared RPC.
shared=sqls['shared_setup']
for token,msg in [
 ("v_effect_delta := v_new_effect - v_old_effect",'amount/status changes become deltas'),
 ("'delta', -v_old_effect",'deleting a deposited check creates reversal'),
 ("nextval('public.shared_financial_event_seq')",'server allocates monotonic financial sequence'),
 ("v_check := v_check - 'depositSeq' - 'depositedAt'",'client cannot forge deposit sequencing metadata')]:
 ok(token in shared,'shared RPC: '+msg)
ok("bulk_delete_all_shared_checks_forbidden" in shared,'shared RPC: stale empty bootstrap cannot delete the complete shared list')

ksetup=(K/'supabase/setup.sql').read_text(encoding='utf-8')
ok("bank_snapshot_watermark_ahead_of_server" in ksetup and "stale_bank_snapshot_watermark" in ksetup,'kupa RPC: bank snapshot watermark validated against server')
ok("jsonb_typeof(p_state->'checks') is not null" in ksetup or "p_state ? 'checks'" in ksetup,'kupa RPC: post-cutover payload containing checks is rejected')
osetup=(O/'supabase/setup.sql').read_text(encoding='utf-8')
ok("jsonb_typeof(p_state->'checks') is not null" in osetup or "p_state ? 'checks'" in osetup,'orders RPC: post-cutover payload containing checks is rejected')

print('\nERRORS',len(errors))
if errors:
 for x in errors: print('-',x)
 sys.exit(1)
