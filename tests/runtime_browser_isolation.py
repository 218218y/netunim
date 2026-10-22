"""Real Chromium regression for disposable profiles and Windows host state."""
from __future__ import annotations

from contextlib import ExitStack
from pathlib import Path
import tempfile
import http.server
import json
import threading
from acceptance_safety import write_evidence

from browser_harness import BrowserSession, HOST_STATE_ROOT, _is_windows, _seed_key, _RuntimeHTTPServer


with tempfile.TemporaryDirectory(prefix="netunim-browser-isolation-site-") as directory:
    site = Path(directory)
    (site / "index.html").write_text("<!doctype html><title>isolation</title>", encoding="utf-8")
    with ExitStack() as stack:
        a = stack.enter_context(BrowserSession(site, "isolation-A", instrument=False))
        b = stack.enter_context(BrowserSession(site, "isolation-B", instrument=False, origin_owner=a))
        profiles = a.profile, b.profile
        assert a.profile != b.profile
        # Use the same origin, so only the profile boundary can explain isolation.
        assert a.evaluate("""(async()=>{
          localStorage.setItem('harness-isolation','A');
          const db=await new Promise((resolve,reject)=>{
            const request=indexedDB.open('harness-isolation',1);
            request.onupgradeneeded=()=>request.result.createObjectStore('items');
            request.onsuccess=()=>resolve(request.result);
            request.onerror=()=>reject(request.error);
          });
          await new Promise((resolve,reject)=>{
            const tx=db.transaction('items','readwrite');
            tx.objectStore('items').put('A','owner');
            tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
          });
          db.close();return true;
        })()""") is True
        assert b.evaluate("""(async()=>({
          local:localStorage.getItem('harness-isolation'),
          databases:(await indexedDB.databases()).map(db=>db.name)
        }))()""") == {"local": None, "databases": []}
        assert a.evaluate("localStorage.getItem('harness-isolation')") == "A"
        assert a.evaluate("caches.open('isolation').then(c=>c.put('/marker',new Response('A'))).then(()=>true)")
        assert b.evaluate("caches.keys()") == []
        # A decoy represents another local service; even implicit localhost and
        # IPv6 loopback bypasses must not reach it. No installed Bridge is probed.
        hits = []
        class Decoy(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                hits.append(self.path)
                self.send_response(200)
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
            def log_message(self, *_args):
                pass
        server = _RuntimeHTTPServer(('127.0.0.1', 0), Decoy)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            for host in ('127.0.0.1', 'localhost', '[::1]', 'provider.invalid'):
                target = f'http://{host}:{server.server_port}/must-not-arrive'
                assert a.evaluate('fetch('+json.dumps(target)+').then(r=>r.ok,()=>false)') is False
            assert hits == [], hits
            assert a.network_guard.denied, 'requests did not exercise the rejecting proxy'
            assert a.evaluate("fetch('/index.html').then(r=>r.ok)") is True
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)
        # localStorage does not expose a crash-durable receipt. Establish its
        # baseline through clean shutdown before testing preservation on a kill.
        # Journal commit/kill guarantees are asserted separately by restore/SQL.
        for crash in (False, True):
            a.restart_process(crash=crash)
            assert a.evaluate("localStorage.getItem('harness-isolation')") == 'A'
            assert a.evaluate("""(async()=>{
              const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('harness-isolation',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
              try{return await new Promise((resolve,reject)=>{if(!db.objectStoreNames.contains('items'))return resolve(null);const r=db.transaction('items').objectStore('items').get('owner');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}finally{db.close()}
            })()""") == 'A'
            assert a.evaluate("caches.match('/marker').then(r=>r?.text())") == 'A'
            assert b.evaluate("localStorage.getItem('harness-isolation')") is None
            assert b.evaluate("caches.keys()") == []
    assert all(not profile.exists() for profile in profiles)
    if _is_windows():
        assert (HOST_STATE_ROOT / _seed_key(a.browser) / "profile" / "Local State").exists()

write_evidence('browser-isolation', [{'scenario': 'same-origin separate profiles and LocalStorage/IndexedDB/CacheStorage', 'status': 'PASS'},
                                   {'scenario': 'foreign HTTP and other loopback listeners denied; owned origin allowed', 'status': 'PASS'},
                                   {'scenario': 'graceful flush then hard restart retain all three stores without terminating sibling profile', 'status': 'PASS'},
                                   {'scenario': 'owned browser profiles deleted after exit', 'status': 'PASS'}])
print("PASS browser isolation: separate LocalStorage/IndexedDB/CacheStorage, owned profiles, denied foreign and loopback egress")
