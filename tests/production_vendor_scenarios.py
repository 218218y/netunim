"""Real compiled document runtimes across deployment, disconnection and rollback."""
from functools import partial
import json
import os
import shutil
import time
from urllib.parse import urlparse
from browser_harness import BrowserSession, ROOT, _QuietHandler
from pwa_upgrade import wait_for_worker_control, wait_for_waiting_upgrade
from production_runtime_scenarios import documents, module_path, publish_future


def vendor_upgrade(app, ready):
    xlsx = '/assets/vendor/document-viewers/xlsx/xlsx.full.min.js'
    interrupted = '/assets/vendor/pdfjs/_runtime-manifest.txt'
    with BrowserSession(ROOT/'dist'/app, app+'-vendor-upgrade', instrument=False, service_worker=True, auto_navigate=False) as browser:
        site = browser.tmp/'site'
        isolated_config = (site/'supabase/config.js').read_bytes()
        state = {'offline': False, 'interrupt': True}
        class VendorNetwork(_QuietHandler):
            def do_GET(self):
                if state['offline']:
                    self.close_connection = True
                    return
                # Pages compares content ETags; the stdlib server only compares
                # whole-second mtimes, which can hide a rapid test deployment.
                if urlparse(self.path).path == '/service-worker.js' and 'If-Modified-Since' in self.headers:
                    del self.headers['If-Modified-Since']
                if state['interrupt'] and urlparse(self.path).path == interrupted:
                    self.send_response(200)
                    self.send_header('Content-Length', '5000')
                    self.end_headers()
                    self.wfile.write(b'partial')
                    self.close_connection = True
                    return
                super().do_GET()
        browser.httpd.RequestHandlerClass = partial(VendorNetwork, directory=str(site))
        browser._navigate()
        ready(browser)
        wait_for_worker_control(browser)
        initial = browser.evaluate("caches.keys()")
        assert not browser.evaluate("performance.getEntriesByType('resource').some(row=>row.name.includes('/assets/vendor/'))")
        browser.evaluate("localStorage.setItem('vendor-upgrade-sentinel','preserved')")
        target = browser.call('Target.createTarget', {'url': browser.url})['result']['targetId']
        state['offline'] = True
        future = publish_future(site, app, module_path(app, 'domains/documents/text-search-viewer.js'))
        browser._navigate()
        ready(browser)
        state['offline'] = False
        wait_for_waiting_upgrade(browser)
        try:
            xlsx_file = site/xlsx.lstrip('/')
            original_xlsx = xlsx_file.read_bytes()
            xlsx_file.write_bytes(b'// incompatible vendor replacement\n')
            for path in (xlsx, interrupted):
                result = browser.evaluate('(async()=>{try{const response=await fetch('+json.dumps(path)+');const bytes=await response.arrayBuffer();return {rejected:false,status:response.status,bytes:bytes.byteLength,release:response.headers.get("X-Netunim-Release")}}catch(error){return {rejected:true,error:String(error)}}})()')
                assert result['rejected'], (path, result)
                assert browser.evaluate('(async()=>{const cache=await caches.open('+json.dumps(initial[0])+');return !await cache.match('+json.dumps(path)+')})()'), path
            # A compatible older tab gets an actionable notice, without deleting
            # or navigating away from its live application state.
            deadline = time.monotonic()+5
            while time.monotonic()<deadline and not browser.evaluate("!!document.getElementById('vendor-version-notice')"):
                time.sleep(.05)
            assert browser.evaluate("document.getElementById('vendor-version-notice')?.textContent.includes('אין צורך למחוק נתונים')")
            browser.evaluate("document.getElementById('vendor-version-notice').querySelector('button').click()")
            expected_failures = browser.drain_serious_errors()
            assert all('Failed to load resource' in row or 'ERR_' in row for row in expected_failures), expected_failures
            xlsx_file.write_bytes(original_xlsx)
            state['interrupt'] = False
            assert browser.evaluate('fetch('+json.dumps(interrupted)+').then(row=>row.ok)')
            # No vendor was cached by this worker before deployment. Actual PDF,
            # DOCX and classic XLSX imports now carry the future release header.
            assert documents(browser, app) == {'pdf': True, 'wordMatches': 1, 'sheetMatches': 1}
            state['offline'] = True
            assert documents(browser, app) == {'pdf': True, 'wordMatches': 1, 'sheetMatches': 1}
            state['offline'] = False
        finally:
            browser.call('Target.closeTarget', {'targetId': target})
        browser.restart_process()
        ready(browser)
        wait_for_worker_control(browser)
        assert future in browser.evaluate('caches.keys()')
        documents(browser, app)
        assert site.resolve().is_relative_to(browser.tmp.resolve())
        shutil.rmtree(site)
        shutil.copytree(ROOT/'dist'/app, site)
        (site/'supabase/config.js').write_bytes(isolated_config)
        os.utime(site/'service-worker.js', None)
        wait_for_waiting_upgrade(browser)
        browser.restart_process()
        ready(browser)
        wait_for_worker_control(browser)
        documents(browser, app)
        assert browser.evaluate("localStorage.getItem('vendor-upgrade-sentinel')") == 'preserved'
        assert not browser.drain_serious_errors()
        return {'uncachedCompatibleVendorsAfterDeploy': True, 'changedAndInterruptedVendorsRejected': True,
                'offlineAfterFirstUse': True, 'multitabUpdateAndRollback': True, 'safeRecoveryNotice': True}
