"""Upgrade a real legacy worker; old local V1 data stays non-authoritative."""
import hashlib
import json
import os
import shutil
import socket
import socketserver
import threading
import time
import urllib.parse
import urllib.request

from browser_harness import BrowserSession, ROOT


def wait_for_worker_control(browser, timeout=60):
    """Observe cold shell installation, with bounded time and useful diagnostics.

    Windows file/cache I/O can outlast a single CDP socket's short timeout while
    installing hundreds of modules. Poll native state instead of abandoning a
    still-pending Runtime.evaluate promise and desynchronizing that socket.
    """
    response = browser.call('ServiceWorker.enable')
    if response.get('error'):
        raise RuntimeError('Service Worker diagnostics unavailable: '+str(response['error']))
    started = time.monotonic()
    deadline = started+timeout
    state = None
    while time.monotonic() < deadline:
        state = browser.worker_state()
        errors = [event['params'] for event in browser.events if event.get('method')=='ServiceWorker.workerErrorReported']
        if errors:
            path=browser.save_worker_evidence('worker-error',started=started)
            raise RuntimeError('Service Worker install error: '+json.dumps({'state':state,'errors':errors,'evidence':str(path)}))
        if state['controller'] and state['active'] and state['active']['state']=='activated':
            browser.save_worker_evidence('controlled',started=started)
            return state
        time.sleep(.1)
    phase='no-registration' if not state or not state['registration'] else 'installing' if state['installing'] else 'waiting' if state['waiting'] else 'activation-or-control'
    path=browser.save_worker_evidence('deadline-'+phase,started=started)
    raise RuntimeError('Service Worker control deadline: '+json.dumps({'phase':phase,'state':state,'errors':browser.drain_serious_errors(),'evidence':str(path)}))


class _DropConnection(socketserver.BaseRequestHandler):
    def handle(self):
        self.request.close()


def wait_for_waiting_upgrade(browser, timeout=60):
    """Install one update while requiring the existing page's controller to stay."""
    assert 'error' not in browser.call('ServiceWorker.enable')
    browser.evaluate("""(async()=>{
      const registration=await navigator.serviceWorker.ready;
      window.__pwaUpgrade={registration,previous:navigator.serviceWorker.controller,error:null};
      registration.update().catch(error=>{window.__pwaUpgrade.error=String(error)});
      return true;
    })()""", timeout=10)
    deadline=time.monotonic()+timeout
    state=None
    while time.monotonic()<deadline:
        browser.worker_state()
        state=browser.evaluate("""(()=>{
          const {registration,previous,error}=window.__pwaUpgrade;
          return {sameController:navigator.serviceWorker.controller===previous,error,
            installing:registration.installing?.state||null,waiting:registration.waiting?.state||null,
            active:registration.active?.state||null};
        })()""", timeout=5)
        errors=[event['params'] for event in browser.events if event.get('method')=='ServiceWorker.workerErrorReported']
        if not state['sameController']:
            raise AssertionError('Update replaced the active page mid-session: '+json.dumps(state))
        if state['error'] or errors:
            path=browser.save_worker_evidence('update-error')
            raise RuntimeError('Service Worker update failed: '+json.dumps({'state':state,'errors':errors,'evidence':str(path)}))
        if state['waiting']=='installed':
            return True
        time.sleep(.1)
    path=browser.save_worker_evidence('update-waiting-deadline')
    raise RuntimeError('Worker waiting deadline: '+json.dumps({'state':state,'evidence':str(path)}))


class _OfflineOrigin(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

    def server_bind(self):
        if os.name == 'nt':
            self.allow_reuse_address = False
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


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
        seed = ('for(const [k,v]of Object.entries('+json.dumps(self.fixture)+'))localStorage.setItem(k,JSON.stringify(v));'
                "localStorage.setItem('pwa-test-preference','retained');")
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
        # Reuse the same confirmed graceful tree shutdown as journal recovery;
        # configure offline transport before the first navigation of the new process.
        self.restart_process(navigate=False)
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
    fake_app = "globalThis.__UNRELATED_CACHE_APP_JS_EXECUTED=true;"
    fake_index = ('<!doctype html><title>Unrelated cache</title>'
                  '<body>UNRELATED_CACHE_INDEX</body><script type="module" src="./assets/app.js"></script>')
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
        browser.evaluate("""(async()=>{
          const cache=await caches.open('unrelated-cache');
          await cache.put('./assets/app.js',new Response("""+json.dumps(fake_app)+""",{headers:{'Content-Type':'text/javascript'}}));
          await cache.put('./index.html',new Response("""+json.dumps(fake_index)+""",{headers:{'Content-Type':'text/html'}}));
          return true;
        })()""")
        browser.publish_upgrade()
        check_http_headers(browser)
        waiting = wait_for_waiting_upgrade(browser)
        assert waiting, 'Update replaced the active page mid-session'
        assert 'error' not in browser.call('ServiceWorker.enable')
        browser.call('Runtime.evaluate', {'expression': 'true'})
        installed = {version['versionId'] for event in browser.events
                     if event.get('method') == 'ServiceWorker.workerVersionUpdated'
                     for version in event['params']['versions'] if version['status'] == 'installed'}
        assert installed, 'DevTools did not observe the waiting worker'
        # Closing the last scoped page permits the waiting release to activate.
        browser.call('Page.navigate', {'url': 'about:blank'})
        activation_deadline=time.monotonic()+60
        while time.monotonic()<activation_deadline:
            browser.call('Runtime.evaluate', {'expression': 'true'})
            if any(version['versionId'] in installed and version['status'] == 'activated'
                   for event in browser.events if event.get('method') == 'ServiceWorker.workerVersionUpdated'
                   for version in event['params']['versions']):
                break
            time.sleep(.05)
        else:
            raise AssertionError('Waiting worker did not activate after its last page closed')
        browser._navigate()
        upgraded = browser.evaluate("""(async()=>{
          await navigator.serviceWorker.ready;
          const active=(await navigator.serviceWorker.ready).active;
          if(active.state!=='activated')await new Promise(resolve=>active.addEventListener('statechange',()=>{if(active.state==='activated')resolve()}));
          const names=await caches.keys(),cacheName=names.find(n=>n.includes('app-shell-esm-')),cache=await caches.open(cacheName);
          const sha=async path=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await (await cache.match(path)).arrayBuffer()))).map(x=>x.toString(16).padStart(2,'0')).join('');
          return {changed:!!navigator.serviceWorker.controller,names,
            cacheName,globalEntry:await (await caches.match('./assets/app.js')).text(),
            globalIndex:await (await caches.match('./index.html')).text(),
            paths:(await cache.keys()).map(r=>new URL(r.url).pathname),
            entryHash:await sha('./assets/app.js'),mainHash:await sha('./assets/js/main.js')};
        })()""")
        assert upgraded['changed'] and old['name'] not in upgraded['names'], upgraded
        assert 'unrelated-cache' in upgraded['names'], upgraded
        assert upgraded['names'].index('unrelated-cache') < upgraded['names'].index(upgraded['cacheName']), upgraded
        assert upgraded['globalEntry'] == fake_app and 'UNRELATED_CACHE_INDEX' in upgraded['globalIndex'], upgraded
        asset_root = browser.release/'assets'
        expected = [
            '/'+p.relative_to(browser.release).as_posix()
            for p in asset_root.rglob('*.js')
            if 'vendor' not in p.relative_to(asset_root).parts
        ]
        assert set(expected).issubset(upgraded['paths']), upgraded
        assert not any(path.startswith('/assets/vendor/') for path in upgraded['paths']), upgraded
        expected_entry_hash = hashlib.sha256((browser.release/'assets/app.js').read_bytes()).hexdigest()
        assert upgraded['entryHash'] == expected_entry_hash
        assert upgraded['mainHash'] == hashlib.sha256((browser.release/'assets/js/main.js').read_bytes()).hexdigest()
        assert browser.evaluate("localStorage.getItem('pwa-test-preference')") == 'retained'
        browser.restart_offline()
        browser.evaluate("import('./assets/js/main.js').then(m=>m.appReady).then(()=>true)")
        recovered = browser.evaluate("""(async()=>{
          const kupa="""+json.dumps(label=='kupa')+""";
          const app=await fetch('./assets/app.js');
          const appHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await app.arrayBuffer()))).map(x=>x.toString(16).padStart(2,'0')).join('');
          if(kupa)document.querySelector('[data-page="cash"]').click();
          return {offline:!navigator.onLine,worker:!!navigator.serviceWorker.controller,
            currentAsset:appHash==="""+json.dumps(expected_entry_hash)+""",
            currentIndex:!document.body.textContent.includes('UNRELATED_CACHE_INDEX'),
            unrelatedScript:!globalThis.__UNRELATED_CACHE_APP_JS_EXECUTED,
            oldDataIgnored:!document.body.textContent.includes(kupa?'PWA cash recovery':'PWA supplier recovery'),
            v2:localStorage.getItem('netunim-storage-engine-version:'+(kupa?'kupa':'orders')+':local')==='2',
            preference:localStorage.getItem('pwa-test-preference')==='retained'};
        })()""")
        assert all(recovered.values()), recovered
        errors=browser.drain_serious_errors()
        assert not errors, errors
        print('PASS',label,'legacy SW upgrade, cache-scoped offline fallback, real HTTP headers/MIME, browser restart offline in',browser.offline_restart_ms,'ms with cloud-free Local V2 birth')
