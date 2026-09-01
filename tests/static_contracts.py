from __future__ import annotations

from collections import Counter
from pathlib import Path
import json
import re
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
K = ROOT / "netunim-kupa"
O = ROOT / "netunim-orders"
S = O / "supabase/shared"
errors: list[str] = []


def ok(condition, message: str):
    if condition:
        print("PASS", message)
    else:
        print("FAIL", message)
        errors.append(message)


def browser_js_units(html: Path) -> list[tuple[str, str]]:
    """Return executable classic/module scripts in document order, including local src files."""
    text = html.read_text(encoding="utf-8")
    units: list[tuple[str, str]] = []
    pattern = re.compile(r"<script(?P<attrs>[^>]*)>(?P<body>.*?)</script>", re.I | re.S)
    for index, match in enumerate(pattern.finditer(text), 1):
        attrs = match.group("attrs") or ""
        script_type = re.search(r"\btype\s*=\s*[\"']([^\"']+)[\"']", attrs, re.I)
        typ = script_type.group(1).strip().lower() if script_type else ""
        if typ and typ not in ("text/javascript", "application/javascript", "module"):
            continue
        src_match = re.search(r"\bsrc\s*=\s*[\"']([^\"']+)[\"']", attrs, re.I)
        if src_match:
            src = src_match.group(1).split("?", 1)[0].split("#", 1)[0]
            if re.match(r"^[a-z][a-z0-9+.-]*:", src, re.I) or src.startswith("//"):
                continue
            target = html.parent / src.lstrip("/")
            if not target.is_file():
                units.append((f"missing:{src}", ""))
                continue
            units.append((str(target.relative_to(ROOT)), target.read_text(encoding="utf-8")))
        elif match.group("body").strip():
            units.append((f"{html.relative_to(ROOT)}:inline-{index}", match.group("body")))
    return units


def browser_code(site: Path) -> str:
    return "\n;\n".join(p.read_text(encoding='utf-8') for p in sorted(site.rglob('*.js')))

def dollar_balanced(text: str):
    tags = re.findall(r"\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$", text)
    counts = Counter(tags)
    return all(value % 2 == 0 for value in counts.values())


def funcdef(text: str, name: str):
    pattern = re.compile(
        r"create\s+(?:or\s+replace\s+)?function\s+public\."
        + re.escape(name)
        + r"\b.*?\n\$\$\s*;",
        re.I | re.S,
    )
    match = pattern.search(text)
    return match.group(0) if match else None


def norm(text: str | None):
    return re.sub(r"\s+", " ", text or "").strip().lower()


# 1. Both browser bundles must remain syntactically valid JavaScript, regardless
# of whether code is inline or stored in local script assets.
for label, site in [("kupa", K / "site"), ("orders", O / "site")]:
    units = [(str(p.relative_to(ROOT)), p.read_text(encoding='utf-8')) for p in sorted(site.rglob('*.js'))]
    parse_ok = bool(units)
    for unit_name, js in units:
        if unit_name.startswith("missing:"):
            print("MISSING", unit_name)
            parse_ok = False
            continue
        with tempfile.NamedTemporaryFile("w", suffix=".mjs", encoding="utf-8", delete=False) as handle:
            handle.write(js)
            temp_name = handle.name
        result = subprocess.run(["node", "--check", temp_name], capture_output=True, text=True)
        Path(temp_name).unlink(missing_ok=True)
        if result.returncode:
            parse_ok = False
            print(unit_name)
            print(result.stderr)
    ok(parse_ok, f"{label}: all browser JavaScript assets parse")

# 2. Current post-cutover ownership/contracts.
ks = browser_code(K / "site")
os = browser_code(O / "site")
ok("KUPA_CHECKS_TABLE" not in os and "saveChecksToKupaCloud" not in os and "reconcileKupaBankForChecks" not in os,
   "orders: legacy Kupa-as-check-owner code removed")
ok("delete x.checks" in ks, "kupa: cloud payload removes checks")
ok("delete x.checks" in os, "orders: cloud payload removes checks")
ok("shared_checks_documents" in ks and "save_shared_checks_document" in ks,
   "kupa: shared checks endpoint configured")
ok("shared_checks_documents" in os and "save_shared_checks_document" in os,
   "orders: shared checks endpoint configured")
ok("ensureSharedChecksForNewCloud" in ks, "kupa: explicit greenfield shared-checks onboarding exists")
ok("sharedChecksBootstrapActive&&!l.length&&r.length>0&&b.length>0&&jsonEq(b,r)" in ks and "repairEmptyBootstrap" in ks and "SHARED_CHECKS_BOOT_REPAIR_KEY" not in ks,
   "kupa: shared bootstrap protection is state-based, not stale-marker based")
ok("אין ליצור אותו אוטומטית" in ks and "אין ליצור אותו אוטומטית" in os,
   "clients: missing shared store fails safe outside greenfield setup")
ok("Array.isArray(d.bank.adjustments)" in ks, "kupa: cloud-state bank adjustments are validated")
ok("!Array.isArray(d)" in os, "orders: cloud state rejects arrays")

# 3. Repository verifier and deployment gates.
verify_text = (ROOT / "verify.bat").read_text(encoding="utf-8")
ok("tests\\run_all.py" in verify_text, "verify.bat: invokes the canonical test runner")
ok('if errorlevel 1 set "VERIFY_EXIT=1"' in verify_text, "verify.bat: captures Python failure at runtime inside batch blocks")
ok('set "VERIFY_EXIT=%ERRORLEVEL%"' not in verify_text, "verify.bat: avoids parse-time ERRORLEVEL expansion inside parenthesized blocks")

# Deployment architecture: one shared per-site engine, with verification owned by
# the public entrypoints. A standalone site verifies once; deploy_all verifies once
# for the pair and then invokes the engine twice without a verification bypass flag.
deploy_core_path = ROOT / "tools/deploy_site_core.bat"
deploy_core = deploy_core_path.read_text(encoding="utf-8")
wrangler_pos = deploy_core.lower().find("pages deploy")
ok(wrangler_pos >= 0, "deploy core: contains the only Wrangler Pages upload command")
ok("verify.bat" not in deploy_core.lower(), "deploy core: does not own or bypass the repository verification gate")
ok('if not "%NETUNIM_DEPLOY_VERIFIED%"=="1" (' in deploy_core,
   "deploy core: refuses accidental direct invocation without a verified parent entrypoint")
dry_run = deploy_core.find('if /I "%~6"=="--preflight-only" (')
mkdir_pos = deploy_core.find('mkdir "%DEPLOY_WORK_DIR%"')
ok(0 <= dry_run < mkdir_pos < wrangler_pos, "deploy core: read-only preflight exits before deployment setup and Wrangler")
ok('exit /b 0' in deploy_core[dry_run:mkdir_pos], "deploy core: preflight cannot fall through to upload")
wrangler_version_path = ROOT / "tools/wrangler-version.txt"
wrangler_version = wrangler_version_path.read_text(encoding="utf-8").strip()
ok(bool(re.fullmatch(r"\d+\.\d+\.\d+", wrangler_version)),
   "deploy core: Wrangler version is centralized as a valid stable semver")
ok('set "WRANGLER_VERSION_FILE=%~dp0wrangler-version.txt"' in deploy_core,
   "deploy core: reads the centralized Wrangler version file")
ok('wrangler@%WRANGLER_VERSION%' in deploy_core and 'wrangler@latest' not in deploy_core.lower(),
   "deploy core: uses the reviewed Wrangler pin instead of silently following latest")

package_json = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
ok(package_json.get("scripts", {}).get("wrangler:check") == "node tools/wrangler-version.mjs --check",
   "package scripts: Wrangler update check is explicit and discoverable")
ok(package_json.get("scripts", {}).get("wrangler:update") == "node tools/wrangler-version.mjs --update",
   "package scripts: Wrangler same-major update is explicit and discoverable")
for dependency in ("acorn", "eslint", "eslint-scope", "globals"):
    value = package_json.get("devDependencies", {}).get(dependency, "")
    ok(value.startswith("^"), f"package.json: {dependency} allows reviewed minor/patch npm updates")

ok(package_json.get("engines", {}).get("node") == "^22.13.0 || >=24",
   "package.json: Node requirement matches current ESLint/Wrangler tooling")

for label, path in [("kupa", K / "deploy_site.bat"), ("orders", O / "deploy_site.bat")]:
    text = path.read_text(encoding="utf-8")
    verify_pos = text.lower().find("verify.bat")
    core_pos = text.lower().find("deploy_site_core.bat")
    ok(verify_pos >= 0, f"{label}: standalone deploy invokes repository verify gate")
    ok(core_pos >= 0 and verify_pos < core_pos, f"{label}: verification runs before the shared deploy core")
    ok('call "%~dp0..\\verify.bat" --no-pause' in text, f"{label}: standalone deploy runs the canonical verifier exactly once")
    ok("pages deploy" not in text.lower(), f"{label}: Wrangler implementation is centralized in the shared deploy core")
    ok("if errorlevel 1" in text[verify_pos:core_pos], f"{label}: failed verification stops deployment before the core")
    ok(not re.search(r'"\d+\.\d+\.\d+"', text),
       f"{label}: standalone deploy does not duplicate a hard-coded Wrangler version")
    gate_pos = text.find('set "NETUNIM_DEPLOY_VERIFIED=1"')
    ok(verify_pos < gate_pos < core_pos, f"{label}: internal deploy authorization is set only after verification")

combined = (ROOT / "deploy_all.bat").read_text(encoding="utf-8")
combined_verify = combined.find('call "%~dp0verify.bat" --no-pause')
combined_orders = combined.find('bargig-orders')
combined_kupa = combined.find('bargig-kupa')
ok(combined_verify >= 0 and combined.count('call "%~dp0verify.bat" --no-pause') == 1,
   "deploy_all: repository verifier is invoked exactly once")
ok(combined_orders > combined_verify and combined_kupa > combined_orders,
   "deploy_all: both site deployments start only after the single verification gate")
ok(not re.search(r'"\d+\.\d+\.\d+"', combined),
   "deploy_all: combined deploy does not duplicate a hard-coded Wrangler version")
combined_gate = combined.find('set "NETUNIM_DEPLOY_VERIFIED=1"')
ok(combined_verify < combined_gate < combined_orders,
   "deploy_all: shared deploy authorization is established only after the single verification succeeds")
ok(combined.lower().count("deploy_site_core.bat") == 2,
   "deploy_all: invokes the shared per-site deployment engine once for each site")
ok("--skip-verify" not in combined.lower() and "--skip-verify" not in deploy_core.lower(),
   "deployment: no public skip-verification switch was introduced")

# Header geometry: the folder permission control has a deliberately reserved desktop slot
# so async IndexedDB permission discovery cannot move the centered navigation. In RTL the
# slot must live immediately to the visual right of the local-save pill, never between the
# two persistent action buttons where its hidden state would look like a missing button.
orders_html = (O / "site/index.html").read_text(encoding="utf-8")
folder_slot_pos = orders_html.find('class="folder-access-slot"')
save_pill_pos = orders_html.find('id="savePill"')
cloud_pill_pos = orders_html.find('id="cloudPill"')
save_now_pos = orders_html.find('id="saveNowButton"')
settings_pos = orders_html.find('id="settingsTopButton"')
ok(-1 not in (folder_slot_pos, save_pill_pos, cloud_pill_pos, save_now_pos, settings_pos)
   and folder_slot_pos < save_pill_pos < cloud_pill_pos < save_now_pos < settings_pos,
   "orders: reserved folder-access slot is beside local-save status, not between action buttons")
orders_css = (O / "site/assets/app.css").read_text(encoding="utf-8")
ok('.folder-access-slot{display:flex;flex:0 0 5rem;inline-size:5rem}' in orders_css,
   "orders: desktop folder-access slot keeps stable header geometry")
ok('.customer-visible-total{display:inline-flex;align-items:center;gap:5px;border:' in orders_css
   and '.customer-visible-total{display:inline-flex;align-items:center;gap:5px;margin-inline-start:auto' not in orders_css,
   "orders: customer debt total stays adjacent to the add-debt button instead of being pushed to the far edge")

# Orders Kupa UI owns the financial surface; checks and balance are embedded children,
# while Bank/Credit continue to use the one shared Kupa document rather than copied state.
orders_main = (O / "site/assets/js/main.js").read_text(encoding="utf-8")
orders_finance_view = (O / "site/assets/js/domains/finance/view.js").read_text(encoding="utf-8")
orders_checks_view = (O / "site/assets/js/domains/checks/view.js").read_text(encoding="utf-8")
orders_dashboard_view = (O / "site/assets/js/domains/dashboard/view.js").read_text(encoding="utf-8")
orders_contexts = (O / "site/assets/js/state/contexts.js").read_text(encoding="utf-8")
orders_finance_controller = (O / "site/assets/js/domains/finance/controller.js").read_text(encoding="utf-8")
ok('data-view="kupa"' in orders_html and 'data-view="checks"' not in orders_html and 'data-view="summary"' not in orders_html,
   "orders Kupa UI: one top-level Kupa tab replaces standalone checks and balance tabs")
ok("const KUPA_SECTIONS=['bank','credit','checks','summary']" in orders_finance_view
   and all(label in orders_finance_view for label in ("bank:'בנק'","credit:'אשראי'","checks:'צ׳קים'","summary:'מאזן'")),
   "orders Kupa UI: Bank, Credit, Checks and Balance are explicit internal sections")
ok("checksView.checksMarkup({embedded:true})" in orders_finance_view and "dashboardView.summaryMarkup({embedded:true})" in orders_finance_view
   and "checksMarkup({embedded=false}" in orders_checks_view and "summaryMarkup({embedded=false}" in orders_dashboard_view,
   "orders Kupa UI: existing Checks and Balance views are embedded instead of duplicated")
ok("createDomainsFinanceView" in orders_main and "renderKupa" in orders_main and "kupaSubView:'bank'" in orders_contexts,
   "orders Kupa UI: composition root and state own the new financial surface")
ok("const BANK_BRIDGE_VERSION=21" in orders_finance_controller,
   "orders Kupa UI: bank controls require the current Bridge v21 contract")
ok("תוספת ידנית · קריאה בלבד" in orders_finance_view and "+ תוספת ידנית" not in orders_finance_view
   and "toggle-credit-selection" not in orders_finance_view,
   "orders Kupa UI: manual credit rows are read-only and manual-add/bulk-delete controls stay Kupa-only")
ok("kupa_documents" in os and "rpcSaveKupaDocument" in orders_main,
   "orders Kupa UI: Bank/Credit writes remain on the shared Kupa document")

# 4. SQL and migration contracts.
sqls = {
    "preflight": (S / "preflight.sql").read_text(encoding="utf-8"),
    "shared_setup": (S / "setup.sql").read_text(encoding="utf-8"),
    "cutover": (S / "cutover.sql").read_text(encoding="utf-8"),
    "postflight": (S / "postflight.sql").read_text(encoding="utf-8"),
    "kupa_setup": (K / "supabase/setup.sql").read_text(encoding="utf-8"),
    "orders_setup": (O / "supabase/setup.sql").read_text(encoding="utf-8"),
}
for name, text in sqls.items():
    ok(dollar_balanced(text), f"{name}: dollar-quote delimiters balanced")
    ok("security definer" not in text.lower(), f"{name}: no SECURITY DEFINER")

cut = sqls["cutover"]
ok(re.match(r"(?s)^\s*--.*?\nbegin;", cut) is not None, "cutover: begins with transaction")
ok(re.search(r"\bcommit\s*;", cut, re.I) is not None and cut.lower().rfind("commit;") > cut.lower().rfind("create function"),
   "cutover: final COMMIT is after DDL/RPC installation")
ok("lock table public.kupa_documents" in cut and "lock table public.order_management_documents" in cut,
   "cutover: locks both source documents")
ok("preflight_duplicate_backup_revision" in cut and "preflight_missing_backup_tables" in cut,
   "cutover: validates backup infrastructure before writes")
first_snapshot = cut.find("Snapshot בלתי-תלוי")
for index_name in [
    "kupa_document_backups_owner_doc_revision_uidx",
    "kupa_periodic_backups_owner_doc_revision_uidx",
    "order_management_backups_owner_doc_revision_uidx",
    "order_management_periodic_backups_owner_doc_revision_uidx",
]:
    ok(0 <= cut.find(index_name) < first_snapshot, f"cutover: {index_name} exists before first source snapshot")
ok("preflight_checks_not_identical_between_sources" in cut, "cutover: refuses divergent old check copies")
ok("preflight_legacy_check_deposit_adjustment_exists" in cut, "cutover: refuses legacy duplicated bank effects")
ok("preflight_bank_snapshot_not_fresh" in cut, "cutover: requires fresh bank baseline")
ok("state = o.state - 'checks'" in cut, "cutover: removes checks from live Orders document")
ok("k.state - 'checks' - 'bank'" in cut, "cutover: removes checks from live Kupa document")
ok("'bankEvents','[]'::jsonb" in cut, "cutover: initializes empty post-baseline bank event log")

pre = sqls["preflight"]
post = sqls["postflight"]
for label, text in [("preflight", pre), ("postflight", post)]:
    without_comments = re.sub(r"--.*", "", text)
    ok(not re.search(r"\b(insert|update|delete|alter|create|drop|truncate|grant|revoke)\b", without_comments, re.I),
       f"{label}: read-only (no DML/DDL keywords)")
ok("preflight_duplicate_backup_revision" in pre, "preflight: backup revision uniqueness checked")

comparisons = [
    ("save_kupa_document", sqls["kupa_setup"]),
    ("kupa_guard_document_write", sqls["kupa_setup"]),
    ("save_order_management_document", sqls["orders_setup"]),
    ("order_management_guard_document_write", sqls["orders_setup"]),
    ("save_shared_checks_document", sqls["shared_setup"]),
    ("shared_checks_guard_document_write", sqls["shared_setup"]),
]
for name, standalone in comparisons:
    in_cutover = funcdef(cut, name)
    in_setup = funcdef(standalone, name)
    ok(bool(in_cutover and in_setup), f"{name}: function exists in cutover and standalone setup")
    if in_cutover and in_setup:
        ok(norm(in_cutover) == norm(in_setup), f"{name}: cutover and standalone definitions are identical")
    if name.startswith("save_") and in_cutover:
        ok(not re.search(r"on\s+conflict\s*\(\s*owner_id\s*,\s*document_name\s*,\s*revision\s*\)", in_cutover, re.I),
           f"{name}: ON CONFLICT does not collide with revision output parameter")

shared = sqls["shared_setup"]
for token, message in [
    ("v_effect_delta := v_new_effect - v_old_effect", "amount/status changes become deltas"),
    ("'delta', -v_old_effect", "deleting a deposited check creates reversal"),
    ("nextval('public.shared_financial_event_seq')", "server allocates monotonic financial sequence"),
    ("v_check := v_check - 'depositSeq' - 'depositedAt'", "client cannot forge deposit sequencing metadata"),
]:
    ok(token in shared, "shared RPC: " + message)
ok("bulk_delete_all_shared_checks_forbidden" in shared,
   "shared RPC: stale empty bootstrap cannot delete the complete shared list")

ksetup = sqls["kupa_setup"]
ok("bank_snapshot_watermark_ahead_of_server" in ksetup and "stale_bank_snapshot_watermark" in ksetup,
   "kupa RPC: bank snapshot watermark validated against server")
ok("jsonb_typeof(p_state->'checks') is not null" in ksetup or "p_state ? 'checks'" in ksetup,
   "kupa RPC: post-cutover payload containing checks is rejected")
osetup = sqls["orders_setup"]
ok("jsonb_typeof(p_state->'checks') is not null" in osetup or "p_state ? 'checks'" in osetup,
   "orders RPC: post-cutover payload containing checks is rejected")

print("\nERRORS", len(errors))
if errors:
    for item in errors:
        print("-", item)
    sys.exit(1)
