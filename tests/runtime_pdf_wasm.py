"""Source viewer: real network denial, actionable notice and safe normal retry."""
from functools import partial
from urllib.parse import urlparse
from browser_harness import BrowserSession, ROOT, _QuietHandler
from pwa_upgrade import wait_for_worker_control
from pdf_wasm_scenarios import render_colors, wasm_runtime
from pages_preview_browser import offline_probe

MODULE = './assets/js/domains/documents/pdf-search-viewer.js'
QCMS = '/assets/vendor/pdfjs/wasm/qcms_bg.wasm'

for app in ('orders', 'kupa'):
    with BrowserSession(ROOT/f'netunim-{app}/site', app+'-pdf-wasm', instrument=False, service_worker=True, auto_navigate=False) as browser:
        state = {'deny': True}; requests = []
        class FilteredNetwork(_QuietHandler):
            def do_GET(self):
                if urlparse(self.path).path == QCMS:
                    requests.append(self.path)
                    if state['deny']:
                        self.send_response(418); self.end_headers(); self.wfile.write(b'Blocked by test network filter'); return
                super().do_GET()
        browser.httpd.RequestHandlerClass = partial(FilteredNetwork, directory=str(browser.tmp/'site'))
        browser._navigate()
        browser.evaluate("import('./assets/js/main.js').then(m=>m.appReady).then(()=>true)")
        wait_for_worker_control(browser)
        browser.evaluate("localStorage.setItem('pdf-denial-sentinel','preserved')")
        blocked = render_colors(browser, MODULE, verify_color=False)
        assert 'HTTP 418' in blocked['notice'] and QCMS in blocked['notice'] and 'ספק הסינון' in blocked['notice'], blocked
        assert len(requests) == 1, 'Denied bytes must not be retried on alternative routes'
        assert browser.evaluate("(async()=>{for(const name of await caches.keys()){if(await(await caches.open(name)).match('"+QCMS+"'))return false}return true})()")
        browser.evaluate("document.getElementById('vendor-version-notice').querySelector('button').click()")
        denied_errors = browser.drain_serious_errors()
        assert all('vendor_unavailable' in row or 'Failed to load resource' in row or 'ERR_' in row for row in denied_errors), denied_errors
        state['deny'] = False
        report = wasm_runtime(browser, MODULE)
        assert len(requests) == 2, 'The next document opening retries the same verified vendor transport'
        assert browser.evaluate("localStorage.getItem('pdf-denial-sentinel')") == 'preserved'
        start = len(browser.events)
        render_colors(browser, MODULE, long_name=True)
        assert not browser.drain_serious_errors()
        assert any('Name token is longer than allowed by the spec: 1111' in event.get('params', {}).get('entry', {}).get('text', '') for event in browser.events[start:]), 'The internal PDF name warning must be observable even though no filename is supplied'
        browser.evaluate("localStorage.setItem('preview-sentinel','preserved')")
        offline_probe(browser, lambda: render_colors(browser, MODULE))
        print('PASS', app, '418 denied, no cache poisoning or bypass, normal retry; ICC/PostScript/WASM with JS eval blocked', report, flush=True)
