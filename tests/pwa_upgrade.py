"""Upgrade a real legacy worker on the same origin; restart Chromium offline."""
import contextlib
import hashlib
import json
import os
import shutil
import socketserver
import threading
import time
import urllib.parse
import urllib.request

from browser_harness import BrowserSession, ROOT


class _DropConnection(socketserver.BaseRequestHandler):
    def handle(self):
        self.request.close()


class _OfflineOrigin(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


class UpgradeBrowser(BrowserSession):
    def __init__(self, label, fixture):
        super().__init__(ROOT / f'netunim-{label}/site', label+'-upgrade', instrument=False, service_worker=True)
        self.app = label
        self.fixture = fixture

    def _prepare_site(self):
        super()._prepare_site()
        prepared = self.tmp / 'site'
        self.release = self.tmp / 'release'
        shutil.copytree(prepared, self.release)
        shutil.copyfile(ROOT / f'tests/fixtures/legacy-workers/{self.app}.js', prepared / 'service-worker.js')
        (prepared / 'index.html').write_text(
            '<!doctype html><html><head><meta charset="utf-8">'
            '<script defer src="./assets/app.js"></script></head>'
            '<body><main>Legacy classic shell</main></body></html>', encoding='utf-8')
        seed = 'for(const [k,v]of Object.entries('+json.dumps(self.fixture)+'))localStorage.setItem(k,JSON.stringify(v));'
        (prepared / 'assets/app.js').write_text(
            seed+"window.addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js'));", encoding='utf-8')

    def publish_upgrade(self):
        prepared = self.tmp / 'site'
        # SimpleHTTP uses Last-Modified rather than content ETags. Ensure this
        # new deployment is newer even when the test copies within one second.
        modified = (prepared / 'service-worker.js').stat().st_mtime + 2
        for source in self.release.rglob('*'):
            if source.is_file():
                target = prepared / source.relative_to(self.release)
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source, target)
                os.utime(target, (modified, modified))

    def restart_offline(self):
        # Stop the real HTTP origin as well as enabling CDP offline mode. Cached
        # code must survive a browser-process restart, not just a page reload.
        self.httpd.shutdown()
        self.httpd.server_close()
        self.http_thread.join(timeout=2)
        self.httpd = self.http_thread = None
        # A closed localhost port can take tens of seconds to fail on some
        # Windows/Chrome combinations. Accepting and dropping TCP immediately
        # supplies no HTTP bytes but makes the offline failure deterministic.
        port = urllib.parse.urlsplit(self.url).port
        self.httpd = _OfflineOrigin(('127.0.0.1', port), _DropConnection)
        self.http_thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.http_thread.start()
        with contextlib.suppress(Exception):
            self.call('Browser.close')
        self.ws.close()
        self.proc.wait(timeout=10)
        self.events = []
        self._start_browser()
        self.call('Network.enable')
        offline = {
            'offline': True,
            'latency': 0,
            'downloadThroughput': -1,
            'uploadThroughput': -1,
            'connectionType': 'none',
        }
        assert 'error' not in self.call('Network.emulateNetworkConditions', offline)
        started = time.monotonic()
        navigation = self.call('Page.navigate', {'url': self.url}).get('result', {})
        if navigation.get('errorText'):
            raise RuntimeError('offline navigation failed before Service Worker fallback: '+navigation['errorText'])
        deadline = started + 30
        state = None
        while time.monotonic() < deadline:
            state=self.evaluate("({ready:document.readyState,url:location.href,resources:performance.getEntriesByType('resource').map(x=>x.name)})")
            if state['url'].startswith(self.url) and state['ready']=='complete':
                self.offline_restart_ms = round((time.monotonic() - started) * 1000)
                break
            time.sleep(.1)
        else:
            diagnostics = {
                'page': state,
                'cacheNames': self.evaluate('caches.keys()'),
                'errors': self.drain_serious_errors(),
            }
            raise RuntimeError('offline restart did not complete: '+json.dumps(diagnostics))
        assert 'error' not in self.call('Network.overrideNetworkState', offline)


def check_http_headers(browser):
    origin = browser.url.removesuffix('/index.html')
    for relative in ('index.html', 'assets/app.js', 'assets/js/main.js', 'service-worker.js'):
        with urllib.request.urlopen(origin+'/'+relative) as response:
            assert response.status == 200
            assert response.headers['X-Content-Type-Options'] == 'nosniff'
            assert response.headers['X-Frame-Options'] == 'DENY'
            csp = response.headers['Content-Security-Policy']
            script = next(part.strip() for part in csp.split(';') if part.strip().startswith('script-src '))
            assert "'unsafe-inline'" not in script and "'unsafe-eval'" not in script
            assert "object-src 'none'" in csp and "base-uri 'none'" in csp and "frame-ancestors 'none'" in csp
            assert response.headers['Cache-Control'] == 'no-cache'
            if relative.endswith('.js'):
                assert response.headers.get_content_type() in ('text/javascript', 'application/javascript')


def test_worker_upgrade(label, fixture):
    with UpgradeBrowser(label, fixture) as browser:
        browser.ws.settimeout(25)
        old = browser.evaluate("""(async()=>{
          await navigator.serviceWorker.ready;
          if(!navigator.serviceWorker.controller)await new Promise(r=>navigator.serviceWorker.addEventListener('controllerchange',r,{once:true}));
          const names=await caches.keys(),cache=await caches.open(names[0]);
          return {name:names[0],paths:(await cache.keys()).map(r=>new URL(r.url).pathname)};
        })()""")
        assert 'external-assets' in old['name'], old
        assert not any('/assets/js/' in p for p in old['paths']), old
        before = browser.evaluate('JSON.stringify({...localStorage})')
        browser.evaluate("caches.open('unrelated-cache').then(()=>true)")
        browser.publish_upgrade()
        check_http_headers(browser)
        upgraded = browser.evaluate("""(async()=>{
          const previous=navigator.serviceWorker.controller;
          const changed=new Promise((resolve,reject)=>{
            const timer=setTimeout(()=>reject(new Error('Worker upgrade timed out')),15000);
            navigator.serviceWorker.addEventListener('controllerchange',()=>{clearTimeout(timer);resolve()},{once:true});
          });
          await (await navigator.serviceWorker.ready).update();
          await changed;
          const active=(await navigator.serviceWorker.ready).active;
          if(active.state!=='activated')await new Promise(resolve=>active.addEventListener('statechange',()=>{if(active.state==='activated')resolve()}));
          const names=await caches.keys(),cache=await caches.open(names.find(n=>n.includes('app-shell-esm-')));
          const sha=async path=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await (await cache.match(path)).arrayBuffer()))).map(x=>x.toString(16).padStart(2,'0')).join('');
          return {changed:navigator.serviceWorker.controller!==previous,names,
            paths:(await cache.keys()).map(r=>new URL(r.url).pathname),
            entryHash:await sha('./assets/app.js'),mainHash:await sha('./assets/js/main.js')};
        })()""")
        assert upgraded['changed'] and old['name'] not in upgraded['names'], upgraded
        assert 'unrelated-cache' in upgraded['names'], upgraded
        expected = ['/'+p.relative_to(browser.release).as_posix() for p in (browser.release/'assets').rglob('*.js')]
        assert set(expected).issubset(upgraded['paths']), upgraded
        assert upgraded['entryHash'] == hashlib.sha256((browser.release/'assets/app.js').read_bytes()).hexdigest()
        assert upgraded['mainHash'] == hashlib.sha256((browser.release/'assets/js/main.js').read_bytes()).hexdigest()
        assert browser.evaluate('JSON.stringify({...localStorage})') == before
        browser.restart_offline()
        browser.evaluate("import('./assets/js/main.js').then(m=>m.appReady).then(()=>true)")
        recovered = browser.evaluate("""(()=>{
          const kupa="""+json.dumps(label=='kupa')+""";
          if(kupa)document.querySelector('[data-page="cash"]').click();
          return {offline:!navigator.onLine,worker:!!navigator.serviceWorker.controller,
            data:document.body.textContent.includes(kupa?'PWA cash recovery':'PWA supplier recovery'),
            pending:!!localStorage.getItem(kupa?'kupa.cloud.pending.local.v1':'orders.supabase.pending.v1')};
        })()""")
        assert all(recovered.values()), recovered
        errors=browser.drain_serious_errors()
        assert not errors, errors
        print('PASS',label,'legacy SW upgrade, full module cache, real HTTP headers/MIME, browser restart offline in',browser.offline_restart_ms,'ms and pending recovery')
