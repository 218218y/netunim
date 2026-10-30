"""Operator-only public Preview probe; never authenticates or uses a real profile.

The normal localhost acceptance preflight remains strict. This separate session
permits exactly one byte-audited immutable Pages host; its deny proxy blocks all
other destinations, including Production Supabase and installed local Bridges.
"""
import argparse
import json
import sys
import time
from urllib.parse import urlsplit, urljoin
from acceptance_safety import temporary_root, contained
from browser_harness import BrowserSession, ROOT
from pwa_upgrade import wait_for_worker_control
from production_runtime_scenarios import documents

sys.path.insert(0, str(ROOT/'tools'))
from pages_preview_audit import audit, preview_origin
from build_validation import require


class PreviewSession(BrowserSession):
    def __init__(self, app, report, manifest):
        self.app, self.audit, self.manifest = app, report, manifest
        super().__init__(ROOT/'dist'/app, app+'-public-preview', instrument=False,
                         service_worker=True, auto_navigate=False)

    def _prepare_site(self):
        # The deployed bytes stay untouched. This owned directory contains no
        # account/profile configuration and is never used as a web server.
        pass

    def _start_server(self):
        self.url = preview_origin(self.app, self.audit['origin'])+'/'

    def _network_preflight(self):
        temporary_root(self.tmp, 'netunim-')
        temporary_root(self.profile, 'netunim-')
        contained(self.tmp, self.downloads)
        origin = preview_origin(self.app, self.audit['origin'])
        require(self.url == origin+'/' and self.httpd is None and self.supabase is None,
                'Preview session origin/configuration changed')
        require(self.audit.get('staticIntegrityPassed') is True and self.audit['app'] == self.app and
                self.audit['release'] == self.manifest['release'] and self.audit['commit'] == self.manifest['commit'],
                'Preview browser requires a successful matching byte/header audit')
        expected = {path: digest for path, digest in self.manifest['files'].items() if path != '_headers'}
        require({row['path']: row['sha256'] for row in self.audit['files']} == expected,
                'Preview audit does not cover the complete payload')
        return urlsplit(origin).hostname+':443'


def ready(browser):
    deadline = time.monotonic()+45
    while time.monotonic() < deadline:
        marks = browser.evaluate("performance.getEntriesByType('mark').map(row=>row.name)")
        if 'netunim-startup:boot-complete' in marks:
            return
        time.sleep(.1)
    raise AssertionError('Preview did not reach boot-complete: '+json.dumps(marks))


def cdp(browser, method, params=None, session=None):
    result = browser.call(method, params, session_id=session, timeout=30)
    require('error' not in result, method+' failed: '+str(result.get('error')))
    return result['result']


def offline_probe(browser):
    # Emulating only the page does not disconnect the worker's own fetches.
    # Attach the running worker too, keep it alive, and prove a real network
    # request fails inside that execution context before testing cached startup.
    targets = cdp(browser, 'Target.getTargets')['targetInfos']
    workers = [row for row in targets if row['type'] == 'service_worker' and row['url'] == urljoin(browser.url, 'service-worker.js')]
    require(len(workers) == 1, 'Expected exactly one Preview worker')
    session = cdp(browser, 'Target.attachToTarget', {'targetId': workers[0]['targetId'], 'flatten': True})['sessionId']
    condition = {'offline': True, 'latency': 0, 'downloadThroughput': -1, 'uploadThroughput': -1}
    try:
        cdp(browser, 'Network.enable', session=session)
        cdp(browser, 'Network.emulateNetworkConditions', condition, session=session)
        canary = cdp(browser, 'Runtime.evaluate', {'expression': "fetch(new URL('assets/vendor/_runtime-manifest.txt?offline-canary',self.registration.scope),{cache:'no-store'}).then(r=>r.arrayBuffer()).then(()=>false,()=>true)",
                    'awaitPromise': True, 'returnByValue': True}, session=session)
        require(canary.get('result', {}).get('value') is True, 'Worker network is still online')
        require(any(row.get('sessionId') == session and row.get('method') == 'Network.loadingFailed' and
                    row.get('params', {}).get('errorText') == 'net::ERR_INTERNET_DISCONNECTED' for row in browser.events),
                'Missing native worker-offline failure evidence')
        cdp(browser, 'Network.emulateNetworkConditions', condition)
        browser._navigate(timeout=45)
        ready(browser)
        require(browser.evaluate("localStorage.getItem('preview-sentinel')") == 'preserved', 'Offline local state changed')
        require(any(row.get('method') == 'Network.responseReceived' and row.get('params', {}).get('type') == 'Document' and
                    row['params']['response'].get('fromServiceWorker') is True for row in browser.events),
                'Offline document was not served by its installed worker')
        return {'workerNetworkDisconnected': True, 'cachedBootComplete': True, 'localStatePreserved': True}
    finally:
        cdp(browser, 'Network.emulateNetworkConditions', {**condition, 'offline': False}, session=session)
        cdp(browser, 'Network.emulateNetworkConditions', {**condition, 'offline': False})
        cdp(browser, 'Target.detachFromTarget', {'sessionId': session})


def run(app, url):
    manifest = json.loads((ROOT/'.work/production'/app/'manifest.json').read_text(encoding='utf-8'))
    report = audit(app, url, manifest)
    directory = ROOT/'.work/pages-preview'/app
    directory.mkdir(parents=True, exist_ok=True)
    (directory/'http-audit.json').write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
    with PreviewSession(app, report, manifest) as browser:
        browser._navigate(timeout=45)
        ready(browser)
        wait_for_worker_control(browser)
        require(browser.evaluate('document.querySelectorAll("#sw-version-fence,#vendor-version-notice").length') == 0,
                'Preview displayed a release fence')
        browser.evaluate("localStorage.setItem('preview-sentinel','preserved')")
        report['documents'] = documents(browser, app)
        browser.events.clear()
        report['offline'] = offline_probe(browser)
        report['browser'] = cdp(browser, 'Browser.getVersion')['product']
        report['backendAccess'] = 'blocked by an origin-only deny proxy; fresh unauthenticated profile'
        report['businessOrOAuthAcceptance'] = 'not performed; requires a separately isolated test account'
    (directory/'browser-audit.json').write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
    print('PASS immutable Preview Chromium startup, document viewers and genuine worker-offline startup:', app)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('app', choices=('orders', 'kupa'))
    parser.add_argument('url')
    args = parser.parse_args()
    run(args.app, args.url)
