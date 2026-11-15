from pathlib import Path
import tempfile
import unittest
from browser_script_units import browser_js_units


class BrowserScriptUnitsTests(unittest.TestCase):
    def test_html_syntax_and_script_kinds(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'app.js').write_text('export const a=1;', encoding='utf-8')
            page = root / 'index.html'
            page.write_text('''<!-- <script>ignored()</script> -->
<SCRIPT data-note="a > b" TYPE=module SRC="app.js?v=1#main"></SCRIPT>
<script type="application/json">{"a":1}</script>
<script>const x = "<not-a-tag>";</script>
<script src="https://example.invalid/a.js"></script>
<script src="//example.invalid/b.js"></script>
<script src="missing.js"></script>''', encoding='utf-8')
            units = browser_js_units(page, root)
            self.assertEqual(units, [('app.js', 'export const a=1;'),
                                    ('index.html:inline-3', 'const x = "<not-a-tag>";'),
                                    ('missing:missing.js', '')])


if __name__ == '__main__':
    unittest.main()
