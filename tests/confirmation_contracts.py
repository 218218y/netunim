from __future__ import annotations

from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
NATIVE_CONFIRM = re.compile(r"\b(?:window\s*\.\s*)?confirm\s*\(")


def check(condition: bool, message: str) -> bool:
    print(("PASS" if condition else "FAIL") + ": " + message)
    return condition


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def all_js(site: Path) -> str:
    return "\n".join(read(path) for path in (site / "assets/js").rglob("*.js"))


def main() -> int:
    ok = True
    apps = {
        "orders": ROOT / "netunim-orders/site",
        "kupa": ROOT / "netunim-kupa/site",
    }

    for name, site in apps.items():
        js = all_js(site)
        html = read(site / "index.html")
        modal_js = read(site / "assets/js/ui/modal.js")
        css = read(site / "assets/app.css")
        ok &= check(not NATIVE_CONFIRM.search(js), f"{name}: native browser confirm is not used")
        ok &= check('id="confirmBackdrop"' in html and 'id="confirmDialog"' in html, f"{name}: confirmation overlay exists")
        ok &= check("confirmDialog" in modal_js and "confirmQueue" in modal_js, f"{name}: confirmation service is centralized and queued")
        ok &= check(".confirm-backdrop" in css and ".confirm-dialog" in css, f"{name}: confirmation UI is styled")

    orders_modal = read(apps["orders"] / "assets/js/ui/modal.js")
    orders_actions = read(apps["orders"] / "assets/js/ui/actions.js")
    supplier_bulk = read(apps["orders"] / "assets/js/domains/suppliers/bulk.js")
    ok &= check("modalHasUnsavedDraft" in orders_modal and "dismissModal" in orders_modal, "orders: generic dirty-form dismissal guard exists")
    ok &= check("'close-modal':(element,event)=>{dismissModal()}" in orders_actions.replace(" ", ""), "orders: user close action goes through guarded dismissal")
    ok &= check("אישור העברת תנועה" in supplier_bulk and "confirmDialog" in supplier_bulk, "orders: supplier transaction move uses styled confirmation")

    kupa_modal = read(apps["kupa"] / "assets/js/ui/modal.js")
    ok &= check("armModalDraftGuard" in kupa_modal and "modalHasUnsavedDraft" in kupa_modal, "kupa: existing draft snapshot guard is preserved")
    ok &= check("confirmDialog('לצאת בלי לשמור?'" in kupa_modal, "kupa: dirty-form dismissal uses styled confirmation")

    if not ok:
        print("\nConfirmation contracts failed.")
        return 1
    print("\nALL CONFIRMATION CONTRACTS PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
