from __future__ import annotations

import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
APPS = {
    "kupa": ROOT / "netunim-kupa",
    "orders": ROOT / "netunim-orders",
}
errors: list[str] = []


def ok(condition, message: str):
    if condition:
        print("PASS", message)
    else:
        print("FAIL", message)
        errors.append(message)


def executable_inline_scripts(html: str) -> list[str]:
    found = []
    for match in re.finditer(r"<script(?P<attrs>[^>]*)>(?P<body>.*?)</script>", html, re.I | re.S):
        attrs = match.group("attrs") or ""
        if re.search(r"\bsrc\s*=", attrs, re.I):
            continue
        script_type = re.search(r"\btype\s*=\s*[\"']([^\"']+)[\"']", attrs, re.I)
        typ = script_type.group(1).strip().lower() if script_type else ""
        if typ and typ not in ("text/javascript", "application/javascript", "module"):
            continue
        if match.group("body").strip():
            found.append(match.group("body"))
    return found


for label, project in APPS.items():
    site = project / "site"
    index = site / "index.html"
    html = index.read_text(encoding="utf-8")
    app_js = site / "assets/app.js"
    app_css = site / "assets/app.css"
    headers = (site / "_headers").read_text(encoding="utf-8")
    deploy = (ROOT / "tools/deploy_site_core.bat").read_text(encoding="utf-8")
    script_policy = re.search(r'\bscript-src\s+([^;\n]+)', headers)
    ok(bool(script_policy) and "'unsafe-inline'" not in script_policy[1] and "'unsafe-eval'" not in script_policy[1],
       f'{label}: script CSP forbids inline execution and dynamic code')
    style_elem_policy = re.search(r'\bstyle-src-elem\s+([^;\n]+)', headers)
    ok(bool(style_elem_policy) and style_elem_policy[1].strip() == "'self'" and
       "object-src 'none'" in headers and "frame-ancestors 'none'" in headers and "base-uri 'none'" in headers,
       f'{label}: element styles are self-only and object, frame and base policies are retained')

    ok(app_js.is_file() and app_js.stat().st_size > 0, f"{label}: JavaScript entrypoint exists in site/assets/app.js")
    ok(app_css.is_file() and app_css.stat().st_size > 1000, f"{label}: stylesheet exists in site/assets/app.css")
    ok('<script type="module" src="./assets/app.js"></script>' in html, f"{label}: index loads the native ESM entrypoint")
    ok('<link rel="stylesheet" href="./assets/app.css"' in html, f"{label}: index loads the external stylesheet")
    ok(not re.search(r"<style\b", html, re.I), f"{label}: index contains no embedded style block")
    ok(not executable_inline_scripts(html), f"{label}: index contains no executable inline script blocks")

    reset_html_path = site / "reset-local.html"
    reset_html = reset_html_path.read_text(encoding="utf-8") if reset_html_path.is_file() else ""
    ok(bool(reset_html) and '<script type="module" src="./assets/js/shared/local-site-reset-page.js"></script>' in reset_html,
       f"{label}: reset-only page exists and loads only the shared reset controller")
    ok(bool(reset_html) and not executable_inline_scripts(reset_html),
       f"{label}: reset-only page contains no executable inline script")

    script_srcs = re.findall(r"<script[^>]*\bsrc\s*=\s*[\"']([^\"']+)[\"'][^>]*>\s*</script>", html, re.I | re.S)
    ok(script_srcs == ["./assets/app.js"], f"{label}: entrypoint explicitly imports configuration")
    ok('export const supabaseConfig = Object.freeze(' in (site/'supabase/config.js').read_text(encoding='utf-8'),
       f'{label}: configuration is an immutable module export')
    ok(any("navigator.serviceWorker.register('./service-worker.js')" in p.read_text(encoding="utf-8") for p in (site/'assets').rglob('*.js')),
       f"{label}: service-worker registration moved with the application entrypoint")

    # Scan the complete source tree, including fragments inside JS strings and
    # templates. Never make this conditional on the current CSP allowance.
    for asset in [index, *sorted(site.rglob('*.js'))]:
        source = asset.read_text(encoding='utf-8')
        ok(not re.search(r'\bon[a-z]+\s*=\s*["\'`]', source, re.I),
           f'{label}: no executable event attributes in {asset.relative_to(site)}')
        ok(not re.search(r'\bsetAttribute\s*\(\s*["\']on[a-z]+', source, re.I),
           f'{label}: no event attributes assigned as strings in {asset.relative_to(site)}')

    ok("assets\\app.css" in deploy and "assets\\app.js" in deploy,
       f"{label}: deploy preflight requires both external assets")
    ok('findstr /S /M /C:"eval(" /C:"new Function(" "%SITE_DIR%\\*.js"' in deploy,
       f"{label}: deploy scans the external JavaScript tree for dynamic-code regressions")

# Orders deliberately keeps its empty portable seed as inert JSON in HTML. It is data,
# not executable JavaScript, and the deploy policy intentionally rejects standalone .json
# files from the public site.
orders_html = (APPS["orders"] / "site/index.html").read_text(encoding="utf-8")
seed_match = re.search(r'<script\s+id="initialState"\s+type="application/json">(.*?)</script>', orders_html, re.I | re.S)
ok(bool(seed_match), "orders: inert portable initialState seed remains embedded")
if seed_match:
    try:
        seed = json.loads(seed_match.group(1))
        empty_lists = [
            "suppliers", "transactions", "customerDebts", "customerOrders", "serviceCalls",
            "inventoryItems", "inventoryCategoryOrder", "inventoryEvents", "warehouseOrders",
            "checks", "notes",
        ]
        ok(seed.get("_meta", {}).get("format") == "order-management-portable" and
           all(seed.get(name) == [] for name in empty_lists),
           "orders: embedded portable seed is data-free and structurally valid")
    except Exception as exc:
        print("  seed parse error:", exc)
        ok(False, "orders: embedded portable seed parses as JSON")


# Local-site reset is a recovery boundary, not a partial key cleanup. Keep its
# destructive path centralized and prove both application composition roots
# expose exactly that shared implementation.
reset_source = (ROOT / "shared/local-site-reset.js").read_text(encoding="utf-8")
ok("indexedDb.databases" in reset_source and "localStorageObject?.clear?.()" in reset_source and
   "sessionStorageObject?.clear?.()" in reset_source and "cacheStorage.delete" in reset_source and
   "registration.unregister" in reset_source,
   "local reset: shared implementation inventories and clears every browser storage layer")
ok("local_site_reset_idb_remaining" in reset_source and "local_site_reset_cache_remaining" in reset_source and
   "local_site_reset_web_storage_remaining" in reset_source,
   "local reset: durable browser storage completion is verified instead of assumed")

for label, project in APPS.items():
    site = project / "site"
    deployed_reset = (site / "assets/js/shared/local-site-reset.js").read_text(encoding="utf-8")
    settings = (site / "assets/js/ui/settings.js").read_text(encoding="utf-8")
    actions = (site / "assets/js/ui/actions.js").read_text(encoding="utf-8")
    main = (site / "assets/js/main.js").read_text(encoding="utf-8")
    cloud = (site / "assets/js/ui/cloud.js").read_text(encoding="utf-8")
    composition = (site / "assets/js/composition/cloud.js").read_text(encoding="utf-8")
    cloud_auth = (site / "assets/js/cloud/auth.js").read_text(encoding="utf-8")
    cloud_transport = (site / "assets/js/cloud/transport.js").read_text(encoding="utf-8")
    ok(deployed_reset == reset_source, f"{label}: deployed local reset helper is generated from the shared source")
    ok('data-action="reset-local-site-storage"' in settings, f"{label}: Supabase settings expose the local-storage reset action")
    ok("'reset-local-site-storage'" in actions and "resetLocalSiteStorage" in actions,
       f"{label}: reset action is wired through the UI action map")
    ok("installLocalSiteResetPeerListener" in main and "resetLocalSiteStorage:(...args)=>uiCloud.resetLocalSiteStorage(...args)" in main,
       f"{label}: composition root parks peer tabs and supplies the reset recovery port")
    ok("confirmDialog('איפוס אחסון מקומי'" in cloud and "beginLocalSiteResetNavigation" in cloud,
       f"{label}: reset requires explicit destructive confirmation before leaving the live app")
    ok("verifyLocalResetCloud" in cloud and "verifyLocalResetCloud" in composition and "verifyLocalResetCloud" in cloud_transport,
       f"{label}: reset preflight uses a dedicated read-only cloud verifier")
    ok("localResetReadOnlyFetch" in cloud_auth and "safePath.startsWith('/rest/v1/')" in cloud_auth and
       "safePath.includes('/rpc/')" in cloud_auth and "method:'GET'" in cloud_auth,
       f"{label}: reset cloud transport is structurally limited to authenticated REST GET requests")
    if label == "orders":
        ok("authPasswordForLocalReset" in cloud_auth and "authPasswordForLocalReset" in composition and
           "loginModal('reset')" in cloud and "finishLocalResetLogin" in cloud and
           "'finish-local-reset-login'" in actions and "finishLocalResetLogin" in main,
           "orders: reset-only auth is separate from owner adoption and remains reachable during recovery")
        reset_auth_body=cloud_auth.split("async function authPasswordForLocalReset",1)[1].split("async function localResetReadOnlyFetch",1)[0]
        ok("assertSessionOwner" not in reset_auth_body and "saveSession" not in reset_auth_body and "localStorage" not in reset_auth_body,
           "orders: reset-only authentication neither asserts nor persists the stale local owner")
    else:
        ok("if(name==='reset-local-site-storage')return true;" in main,
           "kupa: reset recovery remains reachable while an interrupted storage protocol blocks ordinary edits")
        reset_auth_branch="if(mode==='reset'){const resetSession=await supaAuthPasswordForLocalReset(email,password);closeModal();return resetLocalSiteStorage({allowAuthPrompt:false,resetSession})}"
        connect_start=cloud.index("async function connectSupabaseFromLogin(mode)")
        reset_branch_pos=cloud.find(reset_auth_branch,connect_start)
        normal_auth_pos=cloud.find("await supaAuthPassword(email,password);",connect_start)
        transition_pos=cloud.find("if(storageTransitionPreparing())",connect_start)
        ok("openSupabaseLoginModal('reset')" in cloud and reset_branch_pos >= 0 and normal_auth_pos >= 0 and transition_pos >= 0 and
           reset_branch_pos < normal_auth_pos < transition_pos,
           "kupa: reset-only authentication exits before normal owner checks, storage transition, merge or upload logic")
        reset_auth_body=cloud_auth.split("async function supaAuthPasswordForLocalReset",1)[1].split("async function localResetReadOnlyFetch",1)[0]
        ok("assertSessionOwner" not in reset_auth_body and "storeSupaSession" not in reset_auth_body and "localStorage" not in reset_auth_body,
           "kupa: reset-only authentication neither asserts nor persists the stale local owner")

sync_assets = (ROOT / "tools/sync-assets.py").read_text(encoding="utf-8")
ok("'./reset-local.html'" in sync_assets,
   "local reset: reset-only page is part of the generated offline application shell")

if errors:
    print("\nERRORS", len(errors))
    for item in errors:
        print("-", item)
    sys.exit(1)
print("\nALL ASSET ARCHITECTURE CONTRACTS PASSED")
