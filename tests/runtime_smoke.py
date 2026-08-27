from pathlib import Path
import json
import sys

from browser_harness import BrowserSession, ROOT

apps = [
    ("kupa", ROOT / "netunim-kupa/site"),
    ("orders", ROOT / "netunim-orders/site"),
]
all_ok = True
for label, site in apps:
    try:
        with BrowserSession(site, label) as browser:
            state = browser.evaluate(
                "({ready:document.readyState,title:document.title,body:!!document.body,"
                "shared:typeof saveSharedChecksToCloud==='function',"
                "normalize:typeof normalizeSharedChecks==='function'})"
            )
            errors = browser.drain_serious_errors()
            print(label, json.dumps({"state": state, "exceptions": errors}, ensure_ascii=False))
            good = bool(state and state.get("ready") == "complete" and state.get("body") and state.get("shared") and state.get("normalize") and not errors)
            if not good:
                all_ok = False
    except Exception as exc:
        print(label, "FAIL", exc)
        all_ok = False

raise SystemExit(0 if all_ok else 1)
