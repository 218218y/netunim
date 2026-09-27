"""Contracts for the deployment-time first-party JavaScript dynamic-code guard."""
from pathlib import Path
import importlib.util
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "tools/public_js_guard.py"
spec = importlib.util.spec_from_file_location("public_js_guard", MODULE_PATH)
module = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(module)


class PublicJsGuardContracts(unittest.TestCase):
    def make_site(self):
        temporary = tempfile.TemporaryDirectory(prefix="netunim public js guard ")
        self.addCleanup(temporary.cleanup)
        site = Path(temporary.name) / "site"
        (site / "assets/js/nested").mkdir(parents=True)
        (site / "assets/vendor/package").mkdir(parents=True)
        return site

    def test_verified_vendor_subtree_is_not_scanned_as_first_party(self):
        site = self.make_site()
        (site / "assets/js/app.js").write_text("export const ok = true;\n", encoding="utf-8")
        (site / "assets/vendor/package/runtime.js").write_text("new Function('return 1')\n", encoding="utf-8")
        self.assertEqual(module.violations(site), [])

    def test_first_party_eval_and_function_constructor_are_rejected_with_spacing(self):
        site = self.make_site()
        target = site / "assets/js/nested/unsafe.js"
        target.write_text("eval ('1');\nconst f = new   Function ('return 1');\n", encoding="utf-8")
        found = module.violations(site)
        self.assertEqual([(row[0].as_posix(), row[1], row[2]) for row in found], [
            ("assets/js/nested/unsafe.js", 1, "eval"),
            ("assets/js/nested/unsafe.js", 2, "Function constructor"),
        ])

    def test_root_and_module_javascript_are_scanned_but_vendor_mjs_is_not(self):
        site = self.make_site()
        (site / "service-worker.js").write_text("eval('x')\n", encoding="utf-8")
        (site / "assets/js/nested/module.mjs").write_text("new Function('x')\n", encoding="utf-8")
        (site / "assets/vendor/package/runtime.mjs").write_text("eval('vendor')\n", encoding="utf-8")
        found = module.violations(site)
        self.assertEqual({row[0].as_posix() for row in found}, {
            "service-worker.js",
            "assets/js/nested/module.mjs",
        })


if __name__ == "__main__":
    unittest.main(verbosity=2)
