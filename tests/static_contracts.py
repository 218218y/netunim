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
        + r"\b.*?\bas\s+(?P<tag>\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$).*?(?P=tag)\s*;",
        re.I | re.S,
    )
    match = pattern.search(text)
    return match.group(0) if match else None


def norm(text: str | None):
    return re.sub(r"\s+", " ", text or "").strip().lower()


def section_between(text: str, start: str, end: str) -> str:
    """Return a static source section without turning a missing marker into a test crash."""
    start_at = text.find(start)
    if start_at < 0:
        return ""
    start_at += len(start)
    end_at = text.find(end, start_at)
    return text[start_at:] if end_at < 0 else text[start_at:end_at]


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
number_markup = ks + os + (K / "site/index.html").read_text(encoding="utf-8") + (O / "site/index.html").read_text(encoding="utf-8")
fractional_step = re.search(r'\bstep\s*=\s*"[^"]*0\.\d+[^"]*"|\bstep\s*=\s*\'[^\']*0\.\d+[^\']*\'', number_markup)
ok(fractional_step is None,
   "money number inputs: spinner increments stay on whole units; decimals remain manual-entry only")
ok("KUPA_CHECKS_TABLE" not in os and "saveChecksToKupaCloud" not in os and "reconcileKupaBankForChecks" not in os,
   "orders: legacy Kupa-as-check-owner code removed")
ok("delete x.checks" in ks, "kupa: cloud payload removes checks")
ok("delete x.checks" in os, "orders: cloud payload removes checks")
ok("shared_checks_documents" in ks and "save_shared_checks_document" in ks,
   "kupa: shared checks endpoint configured")
ok("shared_checks_documents" in os and "save_shared_checks_document" in os,
   "orders: shared checks endpoint configured")
ok("ensureSharedChecksForNewCloud" in ks, "kupa: explicit greenfield shared-checks onboarding exists")
ok("checksSession.sharedChecksBootstrapActive&&!rawLocal.length&&r.length>0&&b.length>0&&jsonEq(b,r)&&!normalizeDeleteIds(deleteIds).length" in ks and "repairedEmptyBootstrap" in ks and "SHARED_CHECKS_BOOT_REPAIR_KEY" not in ks,
   "kupa: shared bootstrap protection is state-based, not stale-marker based, and never overrides explicit deletion intent")
ok("shared_checks_missing_during_merge" in ks and "shared_checks_missing_during_merge" in os and "cutover" in ks and "cutover" in os,
   "clients: missing shared store fails safe outside greenfield setup")
ok("Array.isArray(state.bank.adjustments)" in ks, "kupa: cloud-state bank adjustments are validated")
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
ok('set "NODE_USE_SYSTEM_CA=1"' in deploy_core[:wrangler_pos]
   and 'NODE_TLS_REJECT_UNAUTHORIZED' not in deploy_core,
   "deploy core: uses trusted system certificates without disabling TLS verification")
ok(wrangler_pos >= 0, "deploy core: contains the only Wrangler Pages upload command")
ok("verify.bat" not in deploy_core.lower(), "deploy core: does not own or bypass the repository verification gate")
ok('if not "%NETUNIM_DEPLOY_VERIFIED%"=="1" (' in deploy_core,
   "deploy core: refuses accidental direct invocation without a verified parent entrypoint")
dry_run = deploy_core.find('if /I "%~6"=="--preflight-only" (')
mkdir_pos = deploy_core.find('mkdir "%DEPLOY_WORK_DIR%"')
ok(0 <= dry_run < mkdir_pos < wrangler_pos, "deploy core: read-only preflight exits before deployment setup and Wrangler")
ok('exit /b 0' in deploy_core[dry_run:mkdir_pos], "deploy core: preflight cannot fall through to upload")
database_gate_pos = deploy_core.find('supabase_deploy_gate.py"')
ok(0 <= database_gate_pos < dry_run < wrangler_pos,
   "deploy core: live database verification precedes both preflight success and upload")
ok('if errorlevel 1 (' in deploy_core[database_gate_pos:dry_run]
   and 'exit /b 2' in deploy_core[database_gate_pos:dry_run],
   "deploy core: failed database verification stops every deployment path")
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
orders_settings = (O / "site/assets/js/ui/settings.js").read_text(encoding="utf-8")
ok('<div class="brand">ניהול הזמנות</div>' not in orders_html
   and 'grid-template-areas:"nav actions"' in orders_css
   and '.topbar-nav-cluster{grid-area:nav;min-width:0;max-width:100%;display:flex;align-items:center;gap:7px;justify-self:start}' in orders_css
   and '.nav{min-width:0;max-width:100%;flex:1 1 auto;display:flex;gap:4px;margin:0;' in orders_css,
   "orders: redundant top-right title is removed and the tab cluster occupies the RTL start edge")
nav_open = orders_html.find('<nav class="nav" id="nav">')
nav_close = orders_html.find('</nav>', nav_open)
alert_slot_pos = orders_html.find('id="alertCenterSlot"')
alert_button_pos = orders_html.find('id="alertCenterButton"')
ok(-1 not in (nav_open, nav_close, alert_slot_pos, alert_button_pos)
   and nav_open < nav_close < alert_slot_pos < alert_button_pos
   and '.alert-center-slot{flex:0 0 auto;display:flex;align-items:center;padding-inline-start:7px;border-inline-start:1px solid' in orders_css
   and '.alert-center-slot[hidden]{display:none!important}' in orders_css,
   "orders warning indicator: alerts live in a dedicated non-scrolling slot beside the tabs and disappear as a unit when empty")
ok('.folder-access-slot{display:flex;flex:0 0 5rem;inline-size:5rem}' in orders_css,
   "orders: desktop folder-access slot keeps stable header geometry")
ok('.main{flex:1 1 auto;min-width:0;min-height:0;width:100%;max-width:none;margin:0;padding:0 env(safe-area-inset-right,0px) max(22px,env(safe-area-inset-bottom)) env(safe-area-inset-left,0px);overflow:hidden}' in orders_css
   and 'max-width:1900px' not in orders_css
   and '.main{padding:0 env(safe-area-inset-right,0px) max(14px,env(safe-area-inset-bottom)) env(safe-area-inset-left,0px)}' in orders_css
   and orders_css.count('.main{padding:0 env(safe-area-inset-right,0px) max(12px,env(safe-area-inset-bottom)) env(safe-area-inset-left,0px)}') == 2,
   "orders content geometry: the shared page shell reaches both viewport edges and starts directly under the top navigation at every breakpoint while preserving safe-area insets")
ok('.view-shell>.view-head>:last-child{margin-bottom:0}' in orders_css
   and '.calendar-view .view-head{padding-bottom:0}' in orders_css
   and '.settings-view-shell{padding-top:13px}' in orders_css
   and '.settings-view-shell{padding-top:10px}' in orders_css
   and '.settings-view-shell{padding-top:8px}' in orders_css,
   "orders view stack: tab command/header rows meet the top navigation and their scroll content without duplicate blank gutters, while the non-tab settings screen keeps its intentional breathing room")
ok('.customers-view{display:flex;flex-direction:column;gap:0}' in orders_css
   and '.customers-view{gap:0}.customer-command' in orders_css
   and '.customers-view{display:flex;flex-direction:column;gap:10px}' not in orders_css
   and '.customers-view{gap:8px}.customer-command' not in orders_css,
   "orders customers: debts and order tracking meet their table panel directly below the fixed command row without a leftover shell gap")
ok('הגדרות, ענן וגיבוי' not in orders_settings
   and 'נתוני ההזמנות נשמרים במסמך נפרד' not in orders_settings
   and "mountViewLayout({headCount:0,className:'settings-view-shell',scrollKey:'settings'})" in orders_settings,
   "orders settings: removed explanatory hero is not rendered, and the settings grid remains the scroll body instead of being misclassified as a fixed header")
ok('.customer-visible-total{display:inline-flex;align-items:center;gap:5px;border:' in orders_css
   and '.customer-visible-total{display:inline-flex;align-items:center;gap:5px;margin-inline-start:auto' not in orders_css,
   "orders: customer debt total stays adjacent to the add-debt button instead of being pushed to the far edge")
ok('.customer-command{position:sticky;top:69px;z-index:10;margin-bottom:0;padding:7px 8px;flex-wrap:wrap}' in orders_css
   and '.customer-command .filters{flex:0 0 auto}' in orders_css
   and '.customer-command .filters{overflow:auto}' not in orders_css,
   "orders customers: the command bar wraps naturally when zoom reduces available width, while the desktop filter group remains atomic instead of becoming its own horizontal scroller")
ok('.customer-work-panel{border-radius:14px}' in orders_css
   and '.customer-table{width:100%!important;max-width:none;min-width:0!important;table-layout:fixed;margin:0}' in orders_css
   and 'width:min(100%,1000px)' not in orders_css
   and '.customer-table th,.customer-table td{padding-inline:6px}' in orders_css
   and '.customer-table .customer-col-name{width:146px;min-width:0;padding-inline-start:10px}' in orders_css
   and '.customer-table .customer-col-paid,.customer-table .customer-col-supplied,.customer-table .customer-col-invoice{width:98px;padding-inline:4px}' in orders_css
   and '.customer-table .customer-col-state{width:96px;padding-inline:4px;text-align:center}' in orders_css
   and '.customer-table .customer-col-note{width:auto;min-width:0}' in orders_css
   and '@media(min-width:1200px){.customer-table .customer-col-name{width:17%}' in orders_css
   and 'width:min(calc(100% - 24px),1500px)' not in orders_css
   and '.customer-table .customer-col-paid,.customer-table .customer-col-supplied,.customer-table .customer-col-invoice{width:8.5%;padding-inline:4px}' in orders_css
   and '.customer-table .customer-col-note{width:22.5%}' in orders_css
   and orders_css.count('.customer-table .customer-col-actions{width:72px}') == 4
   and '.customer-table .customer-col-actions{width:5%}' not in orders_css
   and '.customer-table .customer-col-actions{width:44px}' not in orders_css
   and '.customer-table .customer-col-actions{width:40px}' not in orders_css
   and '.customer-table .customer-col-actions{width:30px}' not in orders_css
   and '@media(max-width:900px)' in orders_css
   and '.customer-table .customer-col-paid,.customer-table .customer-col-supplied,.customer-table .customer-col-invoice{width:94px;padding-inline:3px}' in orders_css
   and '@media(max-width:700px) and (min-width:601px)' in orders_css
   and '.customer-table .customer-col-paid,.customer-table .customer-col-supplied,.customer-table .customer-col-invoice{width:90px;padding-inline:1px}' in orders_css
   and '.status-toggle button{min-width:38px;padding:5px 7px' in orders_css
   and '.customers-view .view-scroll{overflow:hidden;scrollbar-gutter:auto;display:flex;flex-direction:column}' in orders_css
   and '.customers-view .customer-work-table{flex:1 1 auto;min-height:0;max-height:none;scrollbar-gutter:auto}' in orders_css
   and 'customer-work-panel{border-radius:14px;margin' not in orders_css
   and '.customer-table .status-toggle button{min-width:26px' not in orders_css,
   "orders customers: debt table keeps a continuous full available width with no desktop cap, reserves the real action-button width at every desktop breakpoint, preserves normal yes/no controls, and avoids intrinsic-content horizontal overflow")
ok('.supplier-view-shell .view-scroll{overflow:hidden;scrollbar-gutter:auto}' in orders_css
   and '.warehouse-view-shell .view-scroll{scrollbar-gutter:auto}' in orders_css
   and '.warehouse-view-shell .view-scroll::-webkit-scrollbar{width:8px;height:8px}' in orders_css,
   "orders supplier/warehouse width: RTL view shells do not reserve an unused left scrollbar gutter, and the warehouse scrollbar uses the compact 8px track instead of consuming extra content width")
orders_layout = (O / "site/assets/js/ui/layout.js").read_text(encoding="utf-8")
ok('afterLastRow=6' in orders_layout and 'afterLastRow=24' not in orders_layout,
   "orders supplier opening position: the default end-of-transactions target leaves only a 6px tail after the final transaction before the financial summary")
ok('.notes-view{width:100%;max-width:none;margin:0}' in orders_css
   and '.warehouse-attention{width:100%;max-width:none;margin:0}' in orders_css,
   "orders wide views: notes and warehouse attention no longer recenter into capped columns on wide screens")
ok('@media(min-width:701px){.customers-view .customer-work-table,.supplier-view-shell .supplier-table-panel .table-wrap{background:linear-gradient(to bottom,#f8f5f2 0 35px,#e3ddd7 35px 36px,#fff 36px) top/100% 100% no-repeat}}' in orders_css,
   "orders customer/supplier table headers: the sticky header paint spans the full scroll viewport without widening either table or changing horizontal overflow")
ok('--scroll-track:#eee7e1;--scroll-thumb:#b8a69a;--scroll-thumb-hover:#9f8b7d' in orders_css
   and '*{scrollbar-width:thin;scrollbar-color:var(--scroll-thumb) var(--scroll-track)}' in orders_css
   and '*::-webkit-scrollbar-track{background:var(--scroll-track);border-radius:999px}' in orders_css
   and '*::-webkit-scrollbar-thumb:hover{background:var(--scroll-thumb-hover);background-clip:content-box}' in orders_css,
   "orders scrollbars: table and view scroll tracks/thumbs use opaque shared colors in Firefox and WebKit")
orders_supplier_view = (O / "site/assets/js/domains/suppliers/view.js").read_text(encoding="utf-8")
orders_supplier_model = (O / "site/assets/js/domains/suppliers/model.js").read_text(encoding="utf-8")
orders_actions = (O / "site/assets/js/ui/actions.js").read_text(encoding="utf-8")
ok('data-action="filter-mode-4"' not in orders_supplier_view
   and "filterMode==='hm'" not in orders_supplier_view
   and "'filter-mode-4':" not in orders_actions
   and "filterMode==='hm'" not in orders_supplier_model,
   "orders suppliers: obsolete H.M. workflow filter is removed from UI, action routing, and row filtering while the H.M. transaction field remains available")
ok('@media(min-width:621px){.customer-orders-table .customer-order-actions .row-actions{justify-content:flex-end;padding-inline-end:6px}}' in orders_css,
   "orders tracking: desktop urgent/delete row controls align near the visual left table edge without shrinking the action header column")

ok('.col-row-actions{width:78px}' in orders_css
   and '.col-row-actions{width:78px;position:sticky' not in orders_css
   and 'th.col-row-actions{background:#f8f5f2!important;z-index:3}' in orders_css
   and 'td.col-row-actions{position:sticky;left:0;z-index:2;background:transparent!important;pointer-events:none}' in orders_css
   and 'td.col-row-actions .row-actions{pointer-events:auto}' in orders_css
   and 'td.col-row-actions .icon-btn{background:#fff;border-color:#eadfd6;box-shadow:0 1px 3px rgba(70,50,36,.08)}' in orders_css
   and 'td.col-row-actions{background:#fff}' not in orders_css
   and 'tr.pending td.col-row-actions{background:var(--marker-yellow)}' not in orders_css,
   "orders supplier table: only body action controls stay horizontally sticky; the empty header cell does not cover the note heading, and the sticky body cell is transparent/click-through so note text remains visible and usable beneath the buttons")

# Orders Kupa UI owns the financial surface; checks and balance are embedded children,
# while Bank/Credit continue to use the one shared Kupa document rather than copied state.
orders_main = (O / "site/assets/js/main.js").read_text(encoding="utf-8")
ok("getChecksPending:(...args)=>storageChecks.getChecksPending(...args)" in orders_main[orders_main.find("const syncChecks=createSyncChecks({"):orders_main.find("const domainsFinanceController=createDomainsFinanceController({")],
   "orders cloud sync composition: shared-checks durable outbox reader is injected into createSyncChecks")
orders_finance_view = (O / "site/assets/js/domains/finance/view.js").read_text(encoding="utf-8")
orders_bank_connection_view = (O / "site/assets/js/domains/finance/bank-connection-view.js").read_text(encoding="utf-8")
orders_credit_detail_view = (O / "site/assets/js/domains/finance/credit-detail-view.js").read_text(encoding="utf-8")
orders_checks_view = (O / "site/assets/js/domains/checks/view.js").read_text(encoding="utf-8")
orders_dashboard_view = (O / "site/assets/js/domains/dashboard/view.js").read_text(encoding="utf-8")
kupa_checks_view = (K / "site/assets/js/domains/checks/view.js").read_text(encoding="utf-8")
kupa_dashboard_view = (K / "site/assets/js/domains/dashboard/view.js").read_text(encoding="utf-8")
kupa_credit_view = (K / "site/assets/js/domains/credit/view.js").read_text(encoding="utf-8")
kupa_css = (K / "site/assets/app.css").read_text(encoding="utf-8")
orders_contexts = (O / "site/assets/js/state/contexts.js").read_text(encoding="utf-8")
orders_finance_controller = (O / "site/assets/js/domains/finance/controller.js").read_text(encoding="utf-8")
ok('data-view="kupa"' in orders_html and 'data-view="checks"' not in orders_html and 'data-view="summary"' not in orders_html,
   "orders Kupa UI: one top-level Kupa tab replaces standalone checks and balance tabs")
ok("const KUPA_SECTIONS=['bank','credit','checks','summary']" in orders_finance_view
   and all(label in orders_finance_view for label in ("bank:'בנק'","credit:'אשראי'","checks:'צ׳קים'","summary:'מאזן'")),
   "orders Kupa UI: Bank, Credit, Checks and Balance are explicit internal sections")
ok('<section class="kupa-hero">${kupaTabsMarkup()}${headerContextMarkup(s)}</section>' in orders_finance_view
   and "if(section==='bank')return bankCommandMarkup(s)" in orders_finance_view
   and "if(section==='credit')return creditCommandMarkup(s)" in orders_finance_view
   and "if(section==='checks')return checksView.checksHeaderContextMarkup()" in orders_finance_view
   and '<h1>קופה</h1>' not in orders_finance_view
   and 'בנק, אשראי, צ׳קים ומאזן במקום אחד.' not in orders_finance_view
   and '.kupa-hero{display:flex;align-items:center;justify-content:flex-start;gap:8px;margin-bottom:8px;padding:0 2px}' in orders_css
   and '.kupa-hero>.finance-sync-section{flex:1 1 auto;min-width:0;border:0;border-radius:0;background:transparent;box-shadow:none;overflow:visible}' in orders_css
   and '.kupa-hero>.finance-sync-section .finance-command-row{min-height:36px;padding:0;background:transparent;align-items:center}' in orders_css
   and '.kupa-subtabs{display:flex;align-items:center;flex:0 0 auto;height:36px;gap:3px;padding:2px' in orders_css
   and '.kupa-hero .finance-view-tools{height:36px;min-height:36px;padding:0;border:0;border-radius:0;background:transparent}' in orders_css
   and '.kupa-hero .finance-search,.kupa-hero .finance-sync-toggle,.kupa-hero .finance-sync-refresh,.kupa-hero .bank-account-tab{height:36px}' in orders_css,
   "orders Kupa UI: internal tabs stay at the RTL start and all finance header controls share the compact 36px rhythm without redundant nested frames")
ok('class="credit-filter-separator"' in orders_finance_view
   and 'class="credit-provider-filter-chips"' in orders_finance_view
   and orders_finance_view.index('class="credit-account-filter-chips"') < orders_finance_view.index('class="credit-filter-separator"') < orders_finance_view.index('class="credit-provider-filter-chips"')
   and 'class="credit-filter-card-row"' in orders_finance_view
   and 'credit-filter-chip-stack' not in orders_finance_view
   and '.credit-filter-separator{flex:0 0 1px;width:1px;height:24px' in orders_css
   and '.credit-filter-card-row{display:grid;grid-template-columns:70px minmax(0,1fr)' in orders_css,
   "orders credit filters: account and provider chips share one row with a visual divider, while card chips open on a dedicated second row only for a selected provider")
ok('creditFilteredSummary' in orders_finance_view
   and 'creditFiltersMarkup(s,filtered)' in orders_finance_view
   and 'creditUnassignedNotice(filtered)' in orders_finance_view,
   "orders credit filters: displayed totals, partial counts and unassigned warnings obey the same active account/provider/card scope as the main forecast")
ok("if(section==='bank')return `${bankSyncPanelMarkup(s,{open:ui.bankSyncOpen===true})}${bankMarkup(s)}`" in orders_finance_view
   and 'id="ordersBankSyncPanel"' in orders_bank_connection_view
   and "if(section==='credit')return `${creditSyncPanelMarkup(s)}${creditMarkup(s)}`" in orders_finance_view
   and '.finance-sync-settings-body[hidden]{display:none}' in orders_css
   and '.finance-sync-settings-page{min-width:0;border:1px solid #dbe3e8' in orders_css
   and 'max-height:52vh' not in orders_css and 'max-height:52dvh' not in orders_css,
   "orders Kupa sync disclosure: settings live in the main scroll surface, close reliably, and never create a nested vertical scroller")
ok("checksView.checksMarkup({embedded:true,showEmbeddedStatus:false,showBankActivity:false})" in orders_finance_view and "dashboardView.summaryMarkup({embedded:true})" in orders_finance_view
   and "if(section==='checks')return checksView.checksHeaderContextMarkup()" in orders_finance_view
   and 'function checksHeaderContextMarkup()' in orders_checks_view
   and 'class="checks-header-activity"' in orders_checks_view
   and orders_checks_view.index('class="checks-header-activity"') < orders_checks_view.index('${checksCloudLabel()}</div>`;', orders_checks_view.index('function checksHeaderContextMarkup'))
   and "checksMarkup({embedded=false,showEmbeddedStatus=true,showBankActivity=true}" in orders_checks_view and "summaryMarkup({embedded=false}" in orders_dashboard_view,
   "orders Kupa Checks header: the live bank-activity disclosure moves beside the shared-checks source label while embedded content omits the duplicate body disclosure")
credit_markup_block = orders_finance_view.split('function creditMarkup(s)', 1)[1].split('function headerContextMarkup', 1)[0]
ok('class="kupa-subcontent kupa-subcontent-${currentSection()}"' in orders_finance_view
   and '.kupa-subcontent-credit{gap:6px}' in orders_css
   and 'class="credit-primary-report"' in credit_markup_block
   and credit_markup_block.index('creditFiltersMarkup(s,filtered)') < credit_markup_block.index('creditDetailSectionMarkup(s,summary)') < credit_markup_block.index('creditForecastSectionMarkup(s)') < credit_markup_block.index('creditLiveMarkup(summary)')
   and '.credit-primary-report{display:grid;gap:0;overflow:hidden;border:1px solid #dbe3e8;border-radius:15px' in orders_css
   and '.credit-primary-report>.credit-filter-toolbar,.credit-primary-report>.credit-detail-section{border:0;border-radius:0;box-shadow:none}' in orders_css
   and '.credit-primary-report>.credit-filter-toolbar{border-bottom:1px solid #dbe3e8}' in orders_css
   and '.checks-page-embedded{gap:0}' in orders_css
   and '.checks-page-embedded>.check-bank-review{margin-block:0}' in orders_css
   and '.checks-page-embedded #checkGroups>.checks-month:first-child{margin-top:0}' in orders_css
   and '.checks-page-embedded>.checks-toolbar{padding:5px 7px;gap:6px}' in orders_css
   and '.checks-page-embedded>.checks-toolbar .checks-segmented button{padding:5px 10px;line-height:1.15}' in orders_css
   and '.checks-page-embedded>.checks-toolbar input,.checks-page-embedded>.checks-toolbar select{min-height:32px;padding:5px 8px}' in orders_css
   and '.checks-header-activity>.check-bank-activity>.section-body{position:absolute;' in orders_css,
   "orders Kupa compact rhythm: Credit keeps its joined report layout, while embedded Checks use a lower filter row and zero empty spacing from filters to monthly disclosure to the first month")
kupa_credit_render = section_between(kupa_credit_view, 'function renderCreditContent(){', 'function creditLocalProfileRow')
ok('function renderCredit(...args){return runFinance(()=>renderCreditContent(...args))}' in kupa_credit_view
   and 'class="credit-report-stack"' in kupa_credit_render
   and 'class="credit-primary-report"' in kupa_credit_render
   and kupa_credit_render.index('class="toolbar credit-filter-toolbar"') < kupa_credit_render.index('${creditTransactionSectionsMarkup()}') < kupa_credit_render.index('class="section credit-forecast-section forecast-disclosure-section"') < kupa_credit_render.index("${summary.hasData?renderSyncedAccounts(summary):''}")
   and 'style="margin-top:16px"' not in kupa_credit_view
   and '.credit-report-stack{display:grid;gap:6px;min-width:0}' in kupa_css
   and '.credit-primary-report>#credit-transaction-sections>.credit-detail-section{margin:0;border:0;border-radius:0;box-shadow:none}' in kupa_css
   and 'class="checks-page-compact"' in kupa_checks_view
   and '.checks-page-compact{display:flex;flex-direction:column;gap:6px;min-width:0}' in kupa_css
   and '.checks-page-compact>.check-bank-review,.checks-page-compact>.check-bank-activity{margin-block:0}' in kupa_css
   and '.checks-page-compact>.checks-forecast{margin-bottom:0}' in kupa_css,
   "standalone Kupa compact rhythm: shared Credit and Checks surfaces follow the same ordering and spacing principles as Orders without inheriting unrelated Orders page geometry")
orders_alert_center = (O / "site/assets/js/ui/alert-center.js").read_text(encoding="utf-8")
ok('data-action="check-tab">הכל</button>' in orders_checks_view
   and 'data-action="check-tab">הכל</button>' in kupa_checks_view
   and 'data-action="check-tab-4"' not in orders_checks_view and 'data-action="check-tab-4"' not in kupa_checks_view
   and "if(ui.checkTab==='open')rows=rows.filter(x=>!checkIsClosedStatus(x.status))" in orders_checks_view
   and "if(ui.checkTab==='open')rows=rows.filter(x=>!checkIsClosedStatus(x.status))" in kupa_checks_view
   and 'data-action="mark-alert-check-deposited"' in orders_alert_center
   and 'class="alert-center-check-actions"' in orders_alert_center
   and '.alert-center-check-card{display:grid;grid-template-columns:minmax(0,1fr) auto;padding:0;align-items:stretch;gap:0;overflow:hidden}' in orders_css
   and '.alert-center-check-open{display:flex;align-items:flex-start;gap:12px;min-width:0;width:auto;' in orders_css
   and '.alert-center-check-actions{display:flex;align-items:center;justify-content:center;' in orders_css
   and '@media(max-width:480px){.alert-center-check-card{grid-template-columns:1fr}' in orders_css,
   "checks workflow: the first tab is the non-closed all view, and due-check direct deposit has its own collision-free responsive action rail")
ok("checkForecastMarkup()" in orders_checks_view
   and "futureCheckMonthsData(model.state,{fromMonth:checkMonthKey(checkTodayISO()),year:ui.checkYear,account:ui.checkAccount})" in orders_checks_view
   and "תצוגת צ׳קים לפי חודש" in orders_checks_view and "תצוגת צ׳קים לפי חודש" in kupa_checks_view
   and 'data-action="toggle-checks-forecast"' in orders_checks_view and 'data-action="toggle-checks-forecast"' in kupa_checks_view
   and 'id="checksForecastBody"' in orders_checks_view and 'id="checksForecastBody"' in kupa_checks_view
   and "checksForecastOpen:false" in (ROOT/'netunim-orders/site/assets/js/state/contexts.js').read_text(encoding='utf-8') and "checksForecastOpen:false" in (ROOT/'netunim-kupa/site/assets/js/state/contexts.js').read_text(encoding='utf-8')
   and '.forecast-disclosure-head{display:flex;align-items:center;min-height:38px' in orders_css and '.forecast-disclosure-toggle.open .forecast-disclosure-chevron{transform:rotate(180deg)}' in orders_css
   and '.checks-forecast-columns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px 28px}' in orders_css
   and '@media(max-width:620px){.checks-forecast-columns{grid-template-columns:1fr}' in orders_css
   and (ROOT / "shared/check-forecast.js").read_text(encoding="utf-8") == (K / "site/assets/js/shared/check-forecast.js").read_text(encoding="utf-8") == (O / "site/assets/js/shared/check-forecast.js").read_text(encoding="utf-8"),
   "shared checks forecast: Orders Kupa and Kupa use the same month-range model behind a compact disclosure collapsed by default, preserving responsive two-column presentation when opened")
ok("checkAccount:'all'" in (ROOT/'netunim-kupa/site/assets/js/state/contexts.js').read_text(encoding='utf-8')
   and "checkAccount:'all'" in (ROOT/'netunim-orders/site/assets/js/state/contexts.js').read_text(encoding='utf-8')
   and 'data-click-arg0="all">הכל</button>' in kupa_checks_view
   and 'data-click-arg0="all">הכל</button>' in orders_checks_view
   and "ui.checkAccount==='all'||checkBelongsToAccountData" in kupa_checks_view
   and "ui.checkAccount==='all'||checkBelongsToAccountData" in orders_checks_view
   and "account==='all'?'all'" in (ROOT/'shared/check-forecast.js').read_text(encoding='utf-8'),
   "checks account display: all is the default in both apps and combines business/home rows only at the display/forecast filter boundary")
credit_detail_controls=(ROOT/'shared/credit-detail-controls.js').read_text(encoding='utf-8')
ok('aria-label="טווח תצוגת אשראי" data-change="credit-view"' in (K/'site/assets/js/domains/credit/view.js').read_text(encoding='utf-8')
   and 'data-change="orders-credit-view"' in (O/'site/assets/js/domains/finance/view.js').read_text(encoding='utf-8').split('function creditFiltersMarkup',1)[1].split('function creditForecastMarkup',1)[0]
   and 'creditHistoryMenuMarkup' in (K/'site/assets/js/domains/credit/view.js').read_text(encoding='utf-8')
   and 'creditHistoryMenuMarkup' in (O/'site/assets/js/domains/finance/view.js').read_text(encoding='utf-8')
   and 'creditFutureMenuMarkup' in (K/'site/assets/js/domains/credit/view.js').read_text(encoding='utf-8')
   and 'creditFutureMenuMarkup' in (O/'site/assets/js/domains/finance/view.js').read_text(encoding='utf-8')
   and 'credit-history-menu' in credit_detail_controls
   and 'credit-future-menu' in credit_detail_controls
   and 'credit-detail-month-tabs' not in credit_detail_controls
   and 'creditViewAllowsMonth' in credit_detail_controls
   and credit_detail_controls == (K/'site/assets/js/shared/credit-detail-controls.js').read_text(encoding='utf-8') == (O/'site/assets/js/shared/credit-detail-controls.js').read_text(encoding='utf-8'),
   "credit horizon and detail controls: future months share the toolbar range while prior and next months use compact menus with no horizontal month rail")
ok('.credit-cycle-menu{position:relative' in orders_css
   and '.credit-cycle-menu{position:relative' in (K/'site/assets/app.css').read_text(encoding='utf-8')
   and '.credit-detail-title-row{flex-wrap:wrap;min-width:0;max-width:100%}' in orders_css
   and '.credit-detail-title-row{flex-wrap:wrap;min-width:0;max-width:100%}' in (K/'site/assets/app.css').read_text(encoding='utf-8')
   and '.credit-detail-month-tabs{' not in orders_css
   and '.credit-detail-month-tabs{' not in (K/'site/assets/app.css').read_text(encoding='utf-8')
   and 'creditDetailChargeHeadingMarkup' in credit_detail_controls
   and 'data-column-label="חיוב בחודש"' in (K/'site/assets/js/domains/credit/view.js').read_text(encoding='utf-8')
   and 'data-column-label="חיוב בחודש"' in (O/'site/assets/js/domains/finance/view.js').read_text(encoding='utf-8'),
   "credit detail heading: previous and next charges use compact menus, the heading wraps inside the viewport, and the visible list exposes a semantically stable charge label with its total")
kupa_css=(K/'site/assets/app.css').read_text(encoding='utf-8')
ok(all('grid-template-columns:minmax(0,1fr) 68px' in css
       and 'grid-template-columns:repeat(2,minmax(0,1fr))' in css
       and 'inset-inline-start:0;inset-inline-end:auto' in css
       and '.credit-future-menu .credit-cycle-menu-popover' not in css
       and 'background:#fff6d8' in css
       and 'width:fit-content;max-width:100%' in css
       and 'min-width:0;flex:1 1 auto' in css
       and 'flex:0 0 auto;white-space:nowrap' in css
       and 'min-height:0;height:100%' in css
       and 'padding-inline-start:9px;padding-inline-end:0' in css
       and 'padding-inline-end:6px;overflow-y:auto' in css
       and 'scrollbar-width:thin' in css
       for css in (orders_css,kupa_css))
   and 'height:38px' in orders_css
   and '.credit-detail-cycle-divider td{padding:5px 11px!important' in orders_css
   and '.credit-detail-cycle-divider td b{font-size:12px;font-weight:900}' in orders_css
   and '.credit-cycle-menu-trigger{box-sizing:border-box;width:168px;height:38px' in kupa_css
   and '.credit-cycle-selector{box-sizing:border-box;display:inline-grid;grid-template-columns:minmax(0,1fr) 68px;width:168px;min-width:168px;height:38px' in kupa_css
   and '.credit-detail-cycle-divider td{padding:5px 11px!important' in kupa_css
   and '.credit-detail-cycle-divider td b{font-size:12px;font-weight:900}' in kupa_css,
   "credit cycle controls: both apps keep the same compact 38px controls, 10/15 choices, billing dividers and RTL menu behavior")
ok('.credit-filter-toolbar{display:grid;gap:8px;padding:5px 10px}' in orders_css
   and '.credit-primary-report .credit-detail-section-head{padding:6px 11px}' in orders_css
   and '.credit-cycle-menu-trigger{box-sizing:border-box;width:168px;height:38px' in orders_css
   and '.credit-cycle-selector{box-sizing:border-box;display:inline-grid;grid-template-columns:minmax(0,1fr) 68px;width:168px;min-width:168px;height:38px' in orders_css
   and '.credit-cycle-selector-header{width:168px;min-width:168px;height:38px' in orders_css
   and '.credit-filter-toolbar{display:grid;grid-template-columns:1fr;gap:8px;padding:5px 10px' in kupa_css
   and '.credit-primary-report .credit-detail-section-head{padding:6px 11px}' in kupa_css
   and '.credit-cycle-menu-trigger{box-sizing:border-box;width:168px;height:38px' in kupa_css
   and '.credit-cycle-selector{box-sizing:border-box;display:inline-grid;grid-template-columns:minmax(0,1fr) 68px;width:168px;min-width:168px;height:38px' in kupa_css
   and '.credit-cycle-selector-header{width:168px;min-width:168px;height:38px' in kupa_css,
   "shared credit density: Orders and standalone Kupa use matching compact filter padding, Transactions header spacing and 38px billing-cycle controls")
ok('.credit-cycle-selector:hover,.credit-cycle-selector:focus-within' in orders_css
   and '.credit-cycle-selector:hover,.credit-cycle-selector:focus-within' in (ROOT/'netunim-kupa/site/assets/app.css').read_text(encoding='utf-8')
   and '.credit-forecast-month:hover,.credit-forecast-month:focus-within' in orders_css
   and '.credit-forecast-month:hover,.credit-forecast-month:focus-within' in (ROOT/'netunim-kupa/site/assets/app.css').read_text(encoding='utf-8'),
   "credit month affordance: transaction month frames and future forecast month frames expose whole-frame hover/focus feedback in both apps")
ok("6 חודשים קדימה — אשראי עסקי והוצאות" not in kupa_dashboard_view
   and "monthSumBusinessInstallments" not in kupa_dashboard_view
   and "monthSumExpenses" not in kupa_dashboard_view,
   "kupa dashboard: obsolete six-month business-credit-and-expenses panel is removed at the source")
ok('> הוצאות</button>' in (K / "site/index.html").read_text(encoding="utf-8")
   and "credit:['הוצאות','']" in (K / "site/assets/js/state/constants.js").read_text(encoding="utf-8")
   and 'data-action="expenses-hub-tab"' in kupa_credit_view
   and 'data-click-arg0="credit">אשראי</button>' in kupa_credit_view
   and 'data-click-arg0="expenses">הוצאות</button>' in kupa_credit_view
   and "ui.expensesTab==='expenses'" in kupa_credit_view,
   "kupa expenses hub: the former Credit navigation is labeled Expenses and defaults to an internal Credit/Expenses surface")
expense_view=(K / "site/assets/js/domains/expenses/view.js").read_text(encoding="utf-8")
bank_view=(K / "site/assets/js/domains/bank/view.js").read_text(encoding="utf-8")
orders_bank_detail_view=(O / "site/assets/js/domains/finance/bank-transaction-detail-view.js").read_text(encoding="utf-8")
orders_actions=(O / "site/assets/js/ui/actions.js").read_text(encoding="utf-8")
kupa_actions=(K / "site/assets/js/ui/actions.js").read_text(encoding="utf-8")
ok(all('כל התנועות' in source and 'class="bank-date-menu"' in source and "'bank-date-from'" in source and "'bank-date-to'" in source and 'class="btn primary bank-date-apply"' in source and '<select class="bank-date-mode"' not in source for source in (orders_finance_view,bank_view))
   and "setOrdersBankDateMode('range',host?.querySelector('[data-bank-date-from]')?.value||'',host?.querySelector('[data-bank-date-to]')?.value||'')" in orders_actions
   and "setBankDateMode('range',host?.querySelector('[data-bank-date-from]')?.value||'',host?.querySelector('[data-bank-date-to]')?.value||'')" in kupa_actions,
   "bank date scope: both apps use a compact disclosure menu, call the all-time option 'כל התנועות', and apply the two date fields atomically instead of rerendering after each field change")
ok('.bank-date-menu{position:absolute' in orders_css and '.bank-transactions-region{overflow:visible}' in orders_css and 'flex-wrap:wrap;overflow:visible' in orders_css
   and '.bank-date-menu{position:absolute' in (K / 'site/assets/app.css').read_text(encoding='utf-8') and '.bank-transactions-caption{position:relative;overflow:visible}' in (K / 'site/assets/app.css').read_text(encoding='utf-8'),
   "bank date scope layout: the date picker is an anchored floating panel that cannot consume caption-row width or be clipped behind balance/cashflow content")
kupa_compact_css=(K / 'site/assets/app.css').read_text(encoding='utf-8')
ok(kupa_dashboard_view.count('class="bank-account-overview ')==2 and kupa_dashboard_view.count('class="bank-account-metrics"')==2
   and bank_view.count('class="bank-account-overview ')==0 and bank_view.count('class="bank-account-metrics"')==0
   and '.bank-account-overview-body{display:grid;grid-template-columns:minmax(270px,1.25fr) minmax(0,3.75fr)' in kupa_compact_css
   and '.bank-account-metrics{min-width:0;display:grid;grid-template-columns:repeat(5,minmax(0,1fr))' in kupa_compact_css
   and '.kpi{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:13px 14px' in kupa_compact_css
   and '.dashboard-net-summary{grid-template-columns:repeat(3,minmax(0,1fr))' in kupa_compact_css
   and 'grid-template-columns:minmax(260px,1.15fr) repeat(3,minmax(150px,.75fr))' not in kupa_compact_css,
   "kupa compact UI: business/home bank overviews live once at the start of Dashboard with five-metric strips, while Bank stays transaction-focused and dashboard KPIs stay compact")
ok('הוצאות לפי חשבון' in expense_view and 'הגדרת הוצאות קבועות ונוספות' in expense_view and '+ הוצאה חדשה' in expense_view
   and "cycleAccountRows('עסקי',businessCycle)" in expense_view and "cycleAccountRows('ביתי',homeCycle)" in expense_view
   and 'הגדרת הוצאות קבועות ונוספות' not in bank_view and '<div class="net-summary">' not in bank_view,
   "kupa expense ownership: editable expense sections live in the Expenses domain and render explicit business/home groups instead of depending on Bank markup")
ok('class="net-summary dashboard-net-summary"' in kupa_dashboard_view
   and all(label in kupa_dashboard_view for label in ('חשבון עסקי','חשבון ביתי','אשראי עסקי עד אופק התזרים','הוצאות עסקיות עד אופק התזרים','עו״ש עסקי באופק','אשראי ביתי עד אופק התזרים','הוצאות ביתיות עד אופק התזרים','עו״ש ביתי באופק','סה״כ קופה','חוב לקוחות פתוח','נטו ספקים','מאזן כולל נטו'))
   and all(label not in kupa_dashboard_view for label in ('עו״ש עסקי מעודכן','כל האשראי העסקי שנותר','הוצאות עסקיות חודש אחד'))
   and 'עו״ש עסקי − כל האשראים העסקיים העתידיים − חודש הוצאות עסקיות + קופה + חוב לקוחות פתוח + נטו ספקים' in kupa_dashboard_view
   and 'class="grid kpis"' not in kupa_dashboard_view
   and 'forecastIncomplete' in kupa_dashboard_view and 'מבוסס על סכומי ₪ הידועים כרגע' in kupa_dashboard_view and 'partialFacts' in kupa_dashboard_view,
   "kupa dashboard: the canonical bank/cashflow overview replaces duplicate business KPI cards, while cash/customer/supplier net position remains compact and incomplete credit is visibly partial")
bank_model=(K / "site/assets/js/domains/bank/model.js").read_text(encoding="utf-8")
shared_kupa_cashflow=(ROOT / "shared/kupa-cashflow.js").read_text(encoding="utf-8")
shared_credit_cycles=(ROOT / "shared/credit-billing-cycles.js").read_text(encoding="utf-8")
orders_bank_readout=(O / "site/assets/js/domains/bank/readout.js").read_text(encoding="utf-8")
orders_dashboard_view=(O / "site/assets/js/domains/dashboard/view.js").read_text(encoding="utf-8")
orders_finance_shared=(ROOT / "shared/orders-finance.js").read_text(encoding="utf-8")
kupa_dashboard_controller=(K / "site/assets/js/domains/dashboard/controller.js").read_text(encoding="utf-8")
kupa_cloud_transport=(K / "site/assets/js/cloud/transport.js").read_text(encoding="utf-8")
kupa_sync_document=(K / "site/assets/js/sync/document.js").read_text(encoding="utf-8")
kupa_css=(K / "site/assets/app.css").read_text(encoding="utf-8")
ok("sharedKupaAccountCashflowData({...kupa,checks},'עסקי',checkTodayISO())" in orders_bank_readout
   and 'net:cashflow.projected' in orders_bank_readout and 'kupa:cashflow.checks' in orders_bank_readout
   and "עו״ש − אשראי והוצאות עד האופק + צ'קים עד האופק" in orders_dashboard_view
   and "קופה מזומן וצ'קים" not in orders_dashboard_view,
   "Orders balance: the primary dashboard delegates exact-horizon business cash-flow to the shared engine, excludes cash and includes shared checks")
ok("ordersFinanceSummaryData" in orders_finance_shared
   and (K / "site/assets/js/shared/orders-finance.js").read_text(encoding="utf-8") == orders_finance_shared
   and (O / "site/assets/js/shared/orders-finance.js").read_text(encoding="utf-8") == orders_finance_shared
   and "ORDERS_TABLE='order_management_documents'" in kupa_cloud_transport
   and 'readOrdersReadOnlyMeta' in kupa_cloud_transport and 'readOrdersReadOnlyCloud' in kupa_cloud_transport
   and 'ordersFinanceSummaryData(row.state)' in kupa_dashboard_controller,
   "cross-app dashboard balances: Kupa reads Orders read-only and both apps share one customer/supplier summary definition")
ok("bankAccountNextCycleCommitmentsData" in bank_model and "kupaAccountCashflowData(state,account,reference)" in bank_model
   and "from '../../shared/kupa-cashflow.js'" in bank_model and "from '../../shared/kupa-cashflow.js'" in orders_bank_readout
   and "account.months" in shared_credit_cycles and "creditCyclesThroughHorizonData" in shared_kupa_cashflow and "bankHomeNextCycleCommitmentsData" in bank_model and "bankHomeProjectedThisMonthData" in bank_model
   and all(label in kupa_dashboard_view for label in ('חשבון עסקי','חשבון ביתי','אשראי עסקי עד אופק התזרים','הוצאות עסקיות עד אופק התזרים','עו״ש עסקי באופק','אשראי ביתי עד אופק התזרים','הוצאות ביתיות עד אופק התזרים','עו״ש ביתי באופק'))
   and '.bank-account-summary-label' in kupa_css and '.expense-account-divider' in kupa_css,
   "kupa account ownership: business/home bank, credit and expenses use one role-aware exact-horizon model and render as two explicit five-metric Dashboard groups with separated expense tables")
ok("function applyKupaCoreState" in kupa_sync_document
   and "function applyAcknowledgedCoreState" in kupa_sync_document
   and "const next=applyKupaCoreState(snapshot,model.state.checks)" in kupa_sync_document
   and "businessChanged=applyAcknowledgedCoreState(authoritative)" in kupa_sync_document
   and "businessChanged=applyAcknowledgedCoreState(newest.snapshot)" in kupa_sync_document
   and "applyKupaCoreState(pending.snapshot" in kupa_sync_document
   and "applyKupaCoreState(newest?.snapshot||authoritative" in kupa_sync_document,
   "kupa save ownership: normal ACK and recovery paths reapply Kupa-only responses through the finance-preserving overlay without forcing an unchanged render")
kupa_actions=(K / "site/assets/js/ui/actions.js").read_text(encoding="utf-8")
kupa_navigation=(K / "site/assets/js/ui/navigation.js").read_text(encoding="utf-8")
ok('button data-action="set-page"' in kupa_dashboard_view
   and 'dashboard-go' not in kupa_dashboard_view and 'dashboard-keyboard' not in kupa_dashboard_view
   and 'dashboard-go' not in kupa_actions and 'dashboard-keyboard' not in kupa_actions
   and 'dashboardGo' not in kupa_navigation,
   "kupa dashboard events: current quick navigation uses a native button and obsolete clickable-KPI keyboard plumbing is removed")
ok("refreshFinanceOperation('bank',()=>controller.refreshBank({interactive}))" in orders_finance_view
   and "refreshFinanceOperation('credit',()=>controller.refreshCredit({interactive,syncMode}))" in orders_finance_view
   and 'const task=start();refreshFinanceStatus(section);' in (ROOT/'netunim-orders/site/assets/js/domains/finance/status-view.js').read_text(encoding='utf-8')
   and 'if(command)replacePanel(command,headerContextMarkup(data)' in (ROOT/'netunim-orders/site/assets/js/domains/finance/status-view.js').read_text(encoding='utf-8'),
   "orders Kupa sync feedback: controller work starts before the immediate status-region update; busy feedback does not rebuild the business view")
ok(".filter(month=>Math.round(month.total*100)!==0||month.partial)" in (O / "site/assets/js/domains/finance/reporting.js").read_text(encoding="utf-8")
   and ".filter(month=>Math.round(month.total*100)!==0||month.partial)" in (K / "site/assets/js/domains/credit/view.js").read_text(encoding="utf-8"),
   "credit forecast UI: Orders and Kupa omit empty zero-total months but retain partial cycles whose ILS amount is still unknown")
ok("tr.pending td{background:var(--marker-yellow)}" in orders_css
   and "tr.pending:hover td{background:var(--marker-yellow-hover)}" in orders_css
   and ".credit-pending-detail-row td{background:var(--marker-yellow)}" in orders_css
   and ".credit-pending-detail-row:hover td{background:var(--marker-yellow-hover)}" in orders_css
   and ".bank-transaction-pending{display:inline-flex;padding:2px 6px;border-radius:999px;background:var(--warn-soft);color:var(--warn)" in orders_css
   and ".credit-transaction-pending{background:var(--warn-soft);color:var(--warn)}" in orders_css
   and ".bank-transactions-table tbody tr.pending td{background:#fffdf8}" in kupa_css
   and ".credit-detail-table tbody tr.credit-pending-detail-row td{background:#fffdf8}" in kupa_css
   and ".credit-detail-table tbody tr.credit-pending-detail-row:hover td{background:#fffdf8}" in kupa_css
   and ".bank-transaction-pending{display:inline-flex;align-items:center;padding:3px 6px;border-radius:999px;background:#fff3d8;color:#866622" in kupa_css
   and ".credit-transaction-pending{background:#fff3d8;color:#866622}" in kupa_css,
   "credit pending visual parity: each app reuses its bank pending row and badge styling instead of a separate credit-only yellow")
ok("createDomainsFinanceView" in orders_main and "renderKupa" in orders_main and "kupaSubView:'bank'" in orders_contexts,
   "orders Kupa UI: composition root and state own the new financial surface")
bank_image_runtime_pos=orders_main.find('const bankChequeImages=createOrdersBankChequeImageRuntime')
checks_editor_pos=orders_main.find('const domainsChecksEditor=createDomainsChecksEditor({')
finance_view_pos=orders_main.find('const domainsFinanceView=createDomainsFinanceView({')
checks_editor_end=orders_main.find('const syncChecksPersistence=createSyncChecksPersistence({',checks_editor_pos)
finance_view_end=orders_main.find('const uiAlertCenter=createUiAlertCenter({',finance_view_pos)
ok(bank_image_runtime_pos>=0 and bank_image_runtime_pos<checks_editor_pos<finance_view_pos
   and 'downloadBankChequeImage:bankChequeImages.download' not in orders_main[checks_editor_pos:checks_editor_end]
   and 'downloadBankChequeImage:bankChequeImages.download' in orders_main[finance_view_pos:finance_view_end]
   and orders_main.count('const bankChequeImages=createOrdersBankChequeImageRuntime')==1,
   'orders cheque-image composition: runtime is initialized before use, Checks Editor stays uninvolved, and Finance View owns image download wiring')
ok("const BANK_BRIDGE_VERSION=55" in orders_finance_controller,
   "orders Kupa UI: bank controls require the current Bridge v55 contract")
ok((ROOT / 'netunim-orders/site/assets/js/domains/finance/bank-connection-view.js').exists() and "from './bank-connection-view.js'" in (ROOT / 'netunim-orders/site/assets/js/domains/finance/view.js').read_text(encoding='utf-8'),
   'orders finance UI: bank connection/settings rendering is split from the main finance view responsibility')
ok("מספרי שיקים שלא שויכו לשורה" in orders_bank_detail_view and "מספרי שיקים שלא שויכו לשורה" in bank_view,
   "bank cheque UI: bank-supplied identifiers that cannot be safely attached to a specific row remain visible instead of being hidden or guessed")
ok('data-action="export-orders-bank-cheque-diagnostics"' in orders_bank_connection_view and "'export-orders-bank-cheque-diagnostics'" in orders_actions and 'exportBankChequeDiagnostics' in orders_finance_controller and "request('/bank/diagnostics'" in (O/'site/assets/js/domains/finance/bridge.js').read_text(encoding='utf-8') and 'exportOrdersBankChequeDiagnostics' in orders_main,
   "Orders bank diagnostics: synchronization options export the same authenticated local cheque TXT evidence without cloud persistence")
ok("const CREDIT_BRIDGE_VERSION=56" in orders_finance_controller and "CREDIT_CONNECTOR_CONTRACT_VERSION" in orders_finance_controller and "return version>=CREDIT_BRIDGE_VERSION&&contract>=CREDIT_CONNECTOR_CONTRACT_VERSION" in orders_finance_controller and 'data-action="export-orders-credit-data-diagnostics"' in orders_finance_view and "exportOrdersCreditDataDiagnostics" in orders_main and "creditDataDiagnostics" in (O/'site/assets/js/domains/finance/bridge.js').read_text(encoding='utf-8'),
   "orders Kupa UI: credit controls require Bridge v56 / Credit Connector contract v2 and expose the separate local credit data diagnostic export")
ok("browserEngine:['chromium','camoufox'].includes" in (O / "site/assets/js/domains/finance/credit-feed.js").read_text(encoding="utf-8") and 'דפדפן:' in orders_finance_view,
   "orders credit diagnostics: browser-engine provenance survives normalization and is visible for engine-scoped cooldowns")
ok("תוספת ידנית · קריאה בלבד" in orders_credit_detail_view and "+ תוספת ידנית" not in orders_finance_view
   and "toggle-credit-selection" not in orders_finance_view,
   "orders Kupa UI: manual credit rows are read-only and manual-add/bulk-delete controls stay Kupa-only")
ok("kupa_documents" in os and "rpcSaveKupaDocument" in orders_main,
   "orders Kupa UI: Bank/Credit writes remain on the shared Kupa document")

kupa_main=(K / "site/assets/js/main.js").read_text(encoding="utf-8")
kupa_transport=(K / "site/assets/js/cloud/transport.js").read_text(encoding="utf-8")
kupa_sync_document=(K / "site/assets/js/sync/document.js").read_text(encoding="utf-8")
kupa_bank_controller=(K / "site/assets/js/domains/bank/controller.js").read_text(encoding="utf-8")
kupa_credit_controller=(K / "site/assets/js/domains/credit/controller.js").read_text(encoding="utf-8")
kupa_cloud_auth=(K / "site/assets/js/cloud/auth.js").read_text(encoding="utf-8")
orders_cloud_auth=(O / "site/assets/js/cloud/auth.js").read_text(encoding="utf-8")
orders_transport=(O / "site/assets/js/cloud/transport.js").read_text(encoding="utf-8")
orders_bank_cache=(O / "site/assets/js/domains/bank/cache.js").read_text(encoding="utf-8")
ok("lastSync=summary?.sync?.syncedAt||null" in kupa_credit_view and "lastSync=syncUi?.status?.lastSyncAt||summary?.sync?.syncedAt||null" not in kupa_credit_view,
   "credit status ownership: Kupa headline uses the shared cloud sync timestamp instead of stale local Bridge history")
ok("row.financeRevision=Number(financeResult.value.revision||0)" in kupa_transport
   and "financeChanged=!!row&&Number(row.financeRevision||0)>Number(session.financeRevision||0)" in kupa_sync_document
   and "applyFinanceOnlyRow(row)" in kupa_sync_document
   and "financeChanged=Number(row.financeRevision||0)>Number(session.financeRevision||0)" in kupa_main,
   "Kupa finance freshness: finance_sync_documents has an independent revision and finance-only updates wake an already-open Kupa without overwriting pending Kupa edits")
ok("financeReadRevision" in orders_bank_cache and "financeRev<=Number(checksSession.financeReadRevision||0)" in orders_bank_cache
   and "row.financeRevision=Number(finance?.revision||0)" in orders_transport,
   "Orders finance freshness: read-only Kupa cache tracks finance_sync_documents revision independently of kupa_documents")
for controller, kind, bridge_call in ((kupa_bank_controller,"bank","bridge.fetchBalance"),(kupa_credit_controller,"credit","bridge.syncCreditCards"),(orders_finance_controller,"bank","bridge.fetchBalance"),(orders_finance_controller,"credit","bridge.syncCreditCards")):
    claim=f"claimFinanceSyncLease('{kind}'"
    ok(claim in controller and controller.index(claim)<controller.index(bridge_call),
       f"distributed finance lease: {kind} claim happens before opening the local Bridge session")
ok("claimSharedFinanceSyncLease" in kupa_main and "remoteFinanceLeaseTokens" in kupa_main
   and "claimFinanceSyncLease:(...args)=>cloudTransport.claimFinanceSyncLease(...args)" in orders_main,
   "distributed finance lease: both composition roots wire the shared Supabase lease and Kupa preserves local-only mode")
ok("SUPA_NETWORK_ATTEMPTS=3" in kupa_cloud_auth and "fetchSupaNetwork" in kupa_cloud_auth and "method==='GET'||method==='HEAD'" in kupa_cloud_auth
   and kupa_transport.count("networkRetry:true")>=2,
   "Kupa cloud transport: transient Supabase reads and same-token lease RPCs retry with bounded network timeouts; arbitrary writes are not globally retried")
ok("SUPA_NETWORK_ATTEMPTS=3" in orders_cloud_auth and "fetchSupaNetwork" in orders_cloud_auth and "method==='GET'||method==='HEAD'" in orders_cloud_auth
   and orders_transport.count("networkRetry:true")>=2,
   "Orders cloud transport: transient Supabase reads and same-token lease RPCs retry with bounded network timeouts; arbitrary writes are not globally retried")
for label,auth in (("Kupa",kupa_cloud_auth),("Orders",orders_cloud_auth)):
    ok("SUPA_DATA_API_BACKOFF_MS=[15_000,30_000,60_000,120_000]" in auth
       and "createDataApiScheduler" in auth
       and "maxHighBurst:4" in auth
       and "SUPA_DATA_API_RETRY_STATUSES=new Set([502,503,504])" in auth
       and "withSupaDataApiSlot" in auth
       and "SUPA_BACKGROUND_TIMEOUT_MS=8*1000" in auth
       and "SUPABASE_DATA_API_BACKOFF" in auth
       and "SUPABASE_DATA_API_RATE_LIMIT" in auth
       and "responseIsAppBusy" in auth
       and "tripSupaDataApiRateLimit" in auth
       and "retry-after" in auth.lower(),
       f"{label} Data API resilience: one priority lane, service breaker and Retry-After rate-limit gate protect PostgREST from retry storms")
orders_ui_cloud=(O / "site/assets/js/ui/cloud.js").read_text(encoding="utf-8")
kupa_ui_cloud=(K / "site/assets/js/ui/cloud.js").read_text(encoding="utf-8")
for label,ui_cloud in (("Kupa",kupa_ui_cloud),("Orders",orders_ui_cloud)):
    ok("CLOUD_RECOVERY_DELAYS_MS=[15_000,30_000,60_000,120_000]" in ui_cloud
       and "scheduleCloudRecovery" in ui_cloud and "cloudRecoveryTimer" in ui_cloud,
       f"{label} cloud startup: transient Data API failure schedules bounded automatic recovery instead of requiring a reload")
kupa_sync_checks=(K / "site/assets/js/sync/checks.js").read_text(encoding="utf-8")
kupa_cloud_policy=(K / "site/assets/js/shared/cloud-sync.js").read_text(encoding="utf-8")
ok(kupa_sync_document.count("runBusyCloudWriteWithPolicy(()=>rpcSaveCloud")>=2
   and kupa_sync_checks.count("runBusyCloudWriteWithPolicy(()=>rpcSaveSharedChecks")>=2
   and "runBusyCloudWriteWithPolicy(()=>rpcSaveFinanceSync" in kupa_transport
   and "attempts=CLOUD_WRITE_POLICY.busyAttempts" in kupa_cloud_policy
   and "if(normalizeCloudError(result).kind!=='busy')return result" in kupa_cloud_policy
   and "if(saveBusy(res))throw new Error('save_busy')" in kupa_sync_document
   and "if(!revisionConflict(res))throw cloudWriteError(res,em)" in kupa_sync_document,
   "Kupa cloud writes: the shared save_busy policy is bounded and only revision conflicts trigger revision reads/merges")

# Header cloud status is scoped by data ownership. Finance refreshes must never advance or degrade
# the Orders/Kupa top header; finance keeps its own status inside Bank/Credit.
orders_status = (O / "site/assets/js/ui/status.js").read_text(encoding="utf-8")
orders_cloud_ui = (O / "site/assets/js/ui/cloud.js").read_text(encoding="utf-8")
kupa_transport = (K / "site/assets/js/cloud/transport.js").read_text(encoding="utf-8")
kupa_sync_document = (K / "site/assets/js/sync/document.js").read_text(encoding="utf-8")
ok("const HEADER_DOMAIN_ORDER=['orders','checks'];" in orders_status
   and 'latestCloudUpdatedAt(session.cloudUpdatedAt,checksSession.checksCloudUpdatedAt)' in orders_status
   and 'latestCloudUpdatedAt(session.cloudUpdatedAt,checksSession.checksCloudUpdatedAt,checksSession.financeReadUpdatedAt)' not in orders_status
   and "HEADER_DOMAIN_ORDER.filter(domain=>domains[domain].required)" in orders_status,
   "orders cloud header: only Orders + shared checks own the top status timestamp/state")
ok("setCloud('ענן: מסנכרן בנק ואשראי…')" not in orders_cloud_ui
   and "finance readout unavailable after orders cloud open; header status remains scoped to orders + checks" in orders_cloud_ui
   and "finance readout unavailable after orders cloud enable; header status remains scoped to orders + checks" in orders_cloud_ui,
   "orders cloud hydration: finance remains loaded but cannot turn the top header into a financial status indicator")
ok('select=*' in kupa_transport
   and 'row.coreUpdatedAt=resolveKupaCoreUpdatedAt(row,row.financeUpdatedAt,financeAvailable)' in kupa_transport
   and 'if(row?.core_updated_at)return row.core_updated_at;' in kupa_transport
   and "if(financeResult.status!=='fulfilled')throw financeResult.reason" not in kupa_transport
   and "row.financeAvailable=financeAvailable" in kupa_transport
   and "financeAvailable?applyKupaCloudState(row.state,localChecks):applyKupaCoreState(row.state,localChecks,model.state)" in kupa_sync_document
   and 'lastSavedAt:row.coreUpdatedAt||session.serverInfo?.lastSavedAt||null' in kupa_sync_document,
   "kupa cloud header: core/check status and state hydration remain independent from finance reads and finance/bookkeeping updated_at")

# 4. SQL and migration contracts.
sqls = {
    "preflight": (S / "preflight.sql").read_text(encoding="utf-8"),
    "shared_setup": (S / "setup.sql").read_text(encoding="utf-8"),
    "cutover": (S / "cutover.sql").read_text(encoding="utf-8"),
    "postflight": (S / "postflight.sql").read_text(encoding="utf-8"),
    "kupa_setup": (K / "supabase/setup.sql").read_text(encoding="utf-8"),
    "orders_setup": (O / "supabase/setup.sql").read_text(encoding="utf-8"),
    "kupa_finance_lease": (K / "supabase/financial_sync_distributed_lease_upgrade.sql").read_text(encoding="utf-8"),
    "orders_finance_lease": (O / "supabase/financial_sync_distributed_lease_upgrade.sql").read_text(encoding="utf-8"),
    "kupa_finance_archive": (K / "supabase/financial_sync_archive_upgrade.sql").read_text(encoding="utf-8"),
    "orders_finance_archive": (O / "supabase/financial_sync_archive_upgrade.sql").read_text(encoding="utf-8"),
    "kupa_finance_integrity": (K / "supabase/financial_sync_integrity_v2_upgrade.sql").read_text(encoding="utf-8"),
    "orders_finance_integrity": (O / "supabase/financial_sync_integrity_v2_upgrade.sql").read_text(encoding="utf-8"),
    "kupa_contention_hardening": (K / "supabase/core_rpc_contention_hardening_upgrade.sql").read_text(encoding="utf-8"),
    "orders_contention_hardening": (O / "supabase/core_rpc_contention_hardening_upgrade.sql").read_text(encoding="utf-8"),
}
for name, text in sqls.items():
    ok(dollar_balanced(text), f"{name}: dollar-quote delimiters balanced")
    ok("security definer" not in text.lower(), f"{name}: no SECURITY DEFINER")

kupa_header_status = (K / "supabase/cloud_header_status_v1_upgrade.sql").read_text(encoding="utf-8")
orders_header_status = (O / "supabase/cloud_header_status_v1_upgrade.sql").read_text(encoding="utf-8")
ok(kupa_header_status == orders_header_status,
   "cloud header status migration: Kupa and Orders ship the exact same additive migration")
ok("add column if not exists core_updated_at timestamptz" in kupa_header_status
   and "kupa_header_owned_state" in kupa_header_status
   and "- 'bank' - 'creditSync' - 'checks'" in kupa_header_status
   and "coalesce(p_state #> '{bank,adjustments}', '[]'::jsonb)" in kupa_header_status
   and "new.core_updated_at := old.core_updated_at" in kupa_header_status
   and "before insert or update of state, updated_at on public.kupa_documents" in kupa_header_status,
   "cloud header status migration: financial bookkeeping preserves the Kupa-owned clock while user-owned state advances it")

lease_sql=sqls["kupa_finance_lease"]
ok(lease_sql==sqls["orders_finance_lease"], "distributed finance lease migration: Kupa and Orders ship the exact same additive migration")
ok("primary key(owner_id,lease_name)" in lease_sql
   and "on conflict(owner_id,lease_name) do update" in lease_sql
   and "where lease.leased_until<=v_now or lease.lease_token=excluded.lease_token" in lease_sql
   and "clock_timestamp()" in lease_sql
   and "p_ttl_seconds<60 or p_ttl_seconds>1800" in lease_sql,
   "distributed finance lease SQL: claim is server-clock, atomic per user/kind, renewable only by its token, and bounded to 20-minute max TTL")
ok("enable row level security" in lease_sql.lower()
   and 'finance_sync_leases_select_own' in lease_sql
   and 'finance_sync_leases_insert_own' in lease_sql
   and 'finance_sync_leases_update_own' in lease_sql
   and "auth.uid()" in lease_sql,
   "distributed finance lease SQL: RLS confines lease rows to the authenticated owner")
ok(all(fragment in sqls["kupa_setup"] and fragment in sqls["orders_setup"] for fragment in ("create table if not exists public.finance_sync_leases","create or replace function public.claim_finance_sync_lease","create or replace function public.release_finance_sync_lease")),
   "distributed finance lease SQL: clean installations include the same lock table and RPCs as the additive upgrade")
ok(all(fragment in sqls["kupa_setup"] and fragment in sqls["orders_setup"] for fragment in ("create table if not exists public.bank_transaction_snapshots","create or replace function public.sync_bank_transactions_snapshot","create or replace function public.acknowledge_bank_transaction_missing","bank_transactions_owner_missing_idx")),
   "bank snapshot reconciliation SQL: clean installations include durable snapshots, presence tracking and manual acknowledgement RPCs")
contention_sql=sqls["orders_contention_hardening"]
ok(contention_sql==sqls["kupa_contention_hardening"],
   "core RPC contention hardening: Kupa and Orders ship the exact same final migration")
ok("create schema if not exists netunim_internal" in contention_sql
   and contention_sql.count("raise exception 'save_busy'")>=6
   and contention_sql.count("errcode='PT429'")>=6
   and "hashtextextended('order_management:'" in contention_sql
   and contention_sql.count("hashtextextended('netunim_financial_write:'")>=5
   and contention_sql.count("set_config('lock_timeout','100ms',true)")>=6
   and "notify pgrst,'reload schema'" in contention_sql,
   "core RPC contention hardening: public writers fail fast, financial writers share a deterministic gate, row locks are bounded, and PostgREST schema cache reload is explicit")
contention_without_comments=re.sub(r"--.*", "", contention_sql)
ok(not re.search(r"(?im)^\s*(insert|update|delete)\s", contention_without_comments),
   "core RPC contention hardening: migration changes RPC plumbing only and does not mutate application rows")

# Authoritative/setup SQL must remain safe even before/after the additive wrapper migration.
financial_source_contracts = [
    ("kupa setup", sqls["kupa_setup"], ("save_kupa_document","save_finance_sync_document","save_bank_sync_snapshot","merge_bank_transactions")),
    ("orders setup", sqls["orders_setup"], ("save_finance_sync_document","save_bank_sync_snapshot","merge_bank_transactions")),
    ("shared setup", sqls["shared_setup"], ("save_shared_checks_document",)),
    ("cutover financial RPCs", sqls["cutover"], ("save_shared_checks_document","save_kupa_document")),
    ("kupa finance archive upgrade", sqls["kupa_finance_archive"], ("save_finance_sync_document","merge_bank_transactions")),
    ("orders finance archive upgrade", sqls["orders_finance_archive"], ("save_finance_sync_document","merge_bank_transactions")),
    ("kupa finance integrity upgrade", sqls["kupa_finance_integrity"], ("save_kupa_document","save_bank_sync_snapshot","merge_bank_transactions")),
    ("orders finance integrity upgrade", sqls["orders_finance_integrity"], ("save_kupa_document","save_bank_sync_snapshot","merge_bank_transactions")),
]
for label, source, names in financial_source_contracts:
    for name in names:
        definition=funcdef(source,name)
        ok(bool(definition)
           and "hashtextextended('netunim_financial_write:'" in definition
           and "raise exception 'save_busy'" in definition
           and "errcode = 'PT429'" in definition
           and "set_config('lock_timeout', '100ms', true)" in definition,
           f"{label}: {name} has fail-fast shared financial writer protection in the source-of-truth SQL")

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

checks_delete_v4=(O/'supabase/shared_checks_delete_intent_v4_upgrade.sql').read_text(encoding='utf-8')
kupa_checks_delete_v4=(K/'supabase/shared_checks_delete_intent_v4_upgrade.sql').read_text(encoding='utf-8')
ok(checks_delete_v4 == kupa_checks_delete_v4, 'shared-check delete-intent migration is byte-identical across Orders and Kupa')
for token,message in [
    ('shared_checks_delete_intent_guard','low-level trigger guards every shared-check document update'),
    ('shared_checks_delete_intent_required','deletions without explicit intent fail closed'),
    ('shared_checks_delete_intent_mismatch','declared delete IDs must exactly match removed records'),
    ('save_shared_checks_document_v4','v4 RPC carries explicit deletion intent'),
    ("set_config('app.shared_checks_delete_ids'",'v4 RPC passes delete intent transaction-locally to the trigger'),
    ("nullif(current_setting(''app.shared_checks_delete_ids'', true), '''') is null",'legacy all-delete guard remains for old clients but yields to validated v4 intent'),
]: ok(token in checks_delete_v4, 'shared checks v4: '+message)

ksetup = sqls["kupa_setup"]
ok("bank_snapshot_watermark_ahead_of_server" in ksetup and "stale_bank_snapshot_watermark" in ksetup,
   "kupa RPC: bank snapshot watermark validated against server")
ok("jsonb_typeof(p_state->'checks') is not null" in ksetup or "p_state ? 'checks'" in ksetup,
   "kupa RPC: post-cutover payload containing checks is rejected")
osetup = sqls["orders_setup"]
ok("jsonb_typeof(p_state->'checks') is not null" in osetup or "p_state ? 'checks'" in osetup,
   "orders RPC: post-cutover payload containing checks is rejected")
order_save_func=funcdef(osetup, "save_order_management_document")
ok("pg_try_advisory_xact_lock" in order_save_func and "hashtextextended('order_management:'" in order_save_func
   and "raise exception 'save_busy'" in order_save_func and "errcode = 'PT429'" in order_save_func
   and "for update nowait" in order_save_func.lower()
   and order_save_func.index("pg_try_advisory_xact_lock") < order_save_func.lower().index("for update nowait"),
   "orders RPC: busy writers are distinct from revision conflicts and both advisory/row locks fail fast before they can exhaust PostgREST")

# Compact module navigation and toolbar contracts.
orders_index=(ROOT/'netunim-orders/site/index.html').read_text(encoding='utf-8')
orders_navigation=(ROOT/'netunim-orders/site/assets/js/ui/navigation.js').read_text(encoding='utf-8')
orders_customer_bulk=(ROOT/'netunim-orders/site/assets/js/domains/customers/bulk.js').read_text(encoding='utf-8')
orders_service_view=(ROOT/'netunim-orders/site/assets/js/domains/service/view.js').read_text(encoding='utf-8')
orders_warehouse_view=(ROOT/'netunim-orders/site/assets/js/domains/warehouse/view.js').read_text(encoding='utf-8')
orders_finance_view=(ROOT/'netunim-orders/site/assets/js/domains/finance/view.js').read_text(encoding='utf-8')
orders_finance_controller=(ROOT/'netunim-orders/site/assets/js/domains/finance/controller.js').read_text(encoding='utf-8')
orders_actions=(ROOT/'netunim-orders/site/assets/js/ui/actions.js').read_text(encoding='utf-8')
kupa_credit_view=(ROOT/'netunim-kupa/site/assets/js/domains/credit/view.js').read_text(encoding='utf-8')
kupa_credit_editor=(ROOT/'netunim-kupa/site/assets/js/domains/credit/editor.js').read_text(encoding='utf-8')
kupa_actions=(ROOT/'netunim-kupa/site/assets/js/ui/actions.js').read_text(encoding='utf-8')
kupa_index=(ROOT/'netunim-kupa/site/index.html').read_text(encoding='utf-8')
kupa_contexts=(ROOT/'netunim-kupa/site/assets/js/state/contexts.js').read_text(encoding='utf-8')
kupa_checks_view=(ROOT/'netunim-kupa/site/assets/js/domains/checks/view.js').read_text(encoding='utf-8')
kupa_notes_model=(ROOT/'shared/notes-sheet-model.js').read_text(encoding='utf-8')
kupa_notes_controller=(ROOT/'shared/notes-workbook.js').read_text(encoding='utf-8')
ok('data-view="customers">לקוחות וחובות</button>' in orders_index and 'data-view="customer-orders">מעקב הזמנות</button>' in orders_index and orders_index.index('data-view="customers"') < orders_index.index('data-view="customer-orders"') < orders_index.index('data-view="warehouse"') and "ui.currentView==='customers'||ui.currentView==='customer-orders'" in orders_navigation and "customerUi.customerTab='orders'" in orders_navigation and 'onTabChange(tab)' in orders_customer_bulk, 'orders navigation: order tracking has a direct main tab and stays synchronized with the existing inner customer tabs')
ok('<h1>קריאות שירות</h1>' not in orders_service_view and 'module-toolbar service-toolbar' in orders_service_view and 'module-toolbar-actions' in orders_service_view and "headCount:1,className:'service-view-shell'" in orders_service_view, 'orders service: search, filters, selection and open-call action share one fixed toolbar without the redundant title row')
ok('<h1>מחסן ומלאי</h1>' not in orders_warehouse_view and 'module-toolbar warehouse-toolbar' in orders_warehouse_view and 'open-inventory-item-modal-2' in orders_warehouse_view and 'open-warehouse-order-modal' in orders_warehouse_view and "headCount:1,className:'warehouse-view-shell'" in orders_warehouse_view, 'orders warehouse: search, tabs and item/customer actions share one fixed toolbar without the redundant title row')
ok(all('credit-account-filter-chips' in source and 'data-click-arg0="all">הכל</button>' in source and 'data-click-arg0="עסקי">עסקי</button>' in source and 'data-click-arg0="ביתי">ביתי</button>' in source and 'עסקי + ביתי' not in source for source in (orders_finance_view,kupa_credit_view)) and "element.dataset.clickArg0||element.value||'all'" in kupa_actions and "element.dataset.clickArg0||element.value||'all'" in orders_actions, 'credit account scope: embedded Orders Kupa and standalone Kupa both use three direct chip buttons backed by the existing all/business/home filter state')

ok('data-action="copy-orders-safe-credit-diagnostics"' in orders_finance_view and 'copySafeCreditDiagnostics' in orders_finance_controller and "JSON.stringify({contractVersion:result?.contractVersion||CREDIT_CONNECTOR_CONTRACT_VERSION,events}" in orders_finance_controller and "'copy-orders-safe-credit-diagnostics'" in orders_actions, 'Orders credit diagnostics: the UI copies only sanitized loopback events and their contract version')
ok('data-action="refresh-orders-credit-daily"' in orders_finance_view and "refreshOrdersCredit(false,'full')" in orders_actions and "refreshOrdersCredit(false,'daily')" in orders_actions and "syncMode:auto?bridge.creditAutoMode():syncMode==='full'?'full':'daily'" in orders_finance_controller and "selection:creditSyncScrapeSelection(checksSession.kupaCloudReadState?.creditSync)" in orders_finance_controller and "body:{interactive:!!interactive,syncMode:mode,selection:Array.isArray(selection)?selection:[]}" in (O/'site/assets/js/domains/finance/bridge.js').read_text(encoding='utf-8'), 'Orders credit workload controls: main manual full and advanced daily modes are explicit from UI action through the local bridge request')
ok('data-action="open-credit-modal"' not in kupa_credit_view and "'open-credit-modal':" not in kupa_actions and "if(!id)return toast('הוספה ידנית לאשראי הוסרה" in kupa_credit_editor and 'data-action="open-credit-modal-2"' in kupa_credit_view,
   'kupa credit: new manual credit creation is removed end-to-end while legacy manual records remain editable/deletable')
ok('id="quickAddCheck"' not in kupa_index and 'data-action="open-check-modal"' in kupa_checks_view and 'data-action="open-check-modal"' not in (ROOT/'netunim-kupa/site/assets/js/domains/dashboard/view.js').read_text(encoding='utf-8'),
   'kupa checks: the new-check control exists only inside the Checks page, not in the fixed header or dashboard quick actions')
ok("currentPage:'cash'" in kupa_contexts and 'data-page="cash" class="active"' in kupa_index and 'data-page="checks" class="active"' not in kupa_index,
   'kupa startup: Cash is the single default/active page instead of Checks')
ok('NOTES_SHEET_DEFAULT_WIDTH=90' in kupa_notes_model and 'const width=isWorkbook?clampNotesSheetWidth(item.width):NOTES_SHEET_DEFAULT_WIDTH' in kupa_notes_model and 'data-action="add-notes-sheet"' in kupa_notes_controller and 'data-action="set-active-notes-sheet"' in kupa_notes_controller and 'data-blur="rename-notes-sheet"' in kupa_notes_controller,
   'kupa notes workbook: legacy widths reset to the compact 90px default and named multi-sheet tabs are first-class UI controls')

print("\nERRORS", len(errors))
if errors:
    for item in errors:
        print("-", item)
    sys.exit(1)

# 17. Date entry is centralized on the two-digit-year editor. Native date inputs
# remain only as hidden calendar-picker plumbing, never as keyboard-entry fields.
for label, site in [("kupa", K / "site"), ("orders", O / "site")]:
    visible_native_dates = []
    for path in site.rglob("*.js"):
        text = path.read_text(encoding="utf-8")
        for match in re.finditer(r"type\s*=\s*[\"']date[\"']", text):
            line = text[text.rfind("\n", 0, match.start()) + 1:text.find("\n", match.end()) if "\n" in text[match.end():] else len(text)]
            if "data-date-picker" not in line or "aria-hidden=\"true\"" not in line:
                visible_native_dates.append(str(path.relative_to(ROOT)))
    ok(not visible_native_dates,
       f"{label}: keyboard date entry never uses native four-digit-year inputs")

for label, module_path in [
    ("kupa", "./netunim-kupa/site/assets/js/ui/date-editor.js"),
    ("orders", "./netunim-orders/site/assets/js/ui/date-editor.js"),
]:
    script = f"""
      import {{twoDigitDatePartsToIso}} from {module_path!r};
      const cases = [
        ['1','9','26','2026-09-01'],
        ['01','09','26','2026-09-01'],
        ['31','12','99','2099-12-31'],
        ['29','02','24','2024-02-29'],
        ['31','02','26',''],
        ['1','9','2',''],
      ];
      for (const [d,m,y,want] of cases) {{
        const got = twoDigitDatePartsToIso(d,m,y);
        if (got !== want) throw new Error(`${{d}}/${{m}}/${{y}} => ${{got}}, wanted ${{want}}`);
      }}
    """
    result = subprocess.run(["node", "--input-type=module", "-e", script], cwd=ROOT, capture_output=True, text=True)
    if result.returncode:
        print(result.stderr)
    ok(result.returncode == 0, f"{label}: two-digit year entry resolves to 20xx and validates calendar dates")

kupa_date_sources = "\n".join((K / "site/assets/js/domains" / rel).read_text(encoding="utf-8") for rel in [
    "cash/view.js", "cash/editor.js", "expenses/editor.js", "bank/view.js", "credit/editor.js"
])
orders_date_sources = "\n".join((O / "site/assets/js/domains" / rel).read_text(encoding="utf-8") for rel in [
    "finance/view.js", "calendar/controller.js", "service/editor.js"
])
ok(all(token in kupa_date_sources for token in ["dateEditorMarkup('mDate'", "dateEditorMarkup('eDate'", "dateEditorMarkup('cTx'", "dateEditorMarkup('cFirst'", "'bank-date-from'", "'bank-date-to'", "set-rights-last-calculated-date"]),
   "kupa: all editable date surfaces use the centralized editor")
ok(all(token in orders_date_sources for token in ["dateEditorMarkup('calendarStartDate'", "dateEditorMarkup('calendarEndDate'", "dateEditorMarkup('svcOpened'", "dateEditorMarkup('svcNext'", "'bank-date-from'", "'bank-date-to'"]),
   "orders: all editable date surfaces use the centralized editor")
if errors:
    print("\nERRORS", len(errors))
    for item in errors:
        print("-", item)
    sys.exit(1)

print("\nALL STATIC CONTRACTS PASSED")
