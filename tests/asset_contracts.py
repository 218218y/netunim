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
    ok("style-src-elem 'self'" in headers and "object-src 'none'" in headers and "frame-ancestors 'none'" in headers and "base-uri 'none'" in headers,
       f'{label}: strict stylesheet, object, frame and base policies are retained')

    ok(app_js.is_file() and app_js.stat().st_size > 0, f"{label}: JavaScript entrypoint exists in site/assets/app.js")
    ok(app_css.is_file() and app_css.stat().st_size > 1000, f"{label}: stylesheet exists in site/assets/app.css")
    ok('<script type="module" src="./assets/app.js"></script>' in html, f"{label}: index loads the native ESM entrypoint")
    ok('<link rel="stylesheet" href="./assets/app.css"' in html, f"{label}: index loads the external stylesheet")
    ok(not re.search(r"<style\b", html, re.I), f"{label}: index contains no embedded style block")
    ok(not executable_inline_scripts(html), f"{label}: index contains no executable inline script blocks")

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
    ok('for /R "%SITE_DIR%" %%F in (*.js)' in deploy and 'findstr /C:"eval(" "%%F"' in deploy,
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

if errors:
    print("\nERRORS", len(errors))
    for item in errors:
        print("-", item)
    sys.exit(1)
print("\nALL ASSET ARCHITECTURE CONTRACTS PASSED")
