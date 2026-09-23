"""Real Chromium regression for disposable profiles and Windows host state."""
from __future__ import annotations

from contextlib import ExitStack
from pathlib import Path
import tempfile

from browser_harness import BrowserSession, HOST_STATE_ROOT, _is_windows, _seed_key


with tempfile.TemporaryDirectory(prefix="netunim-browser-isolation-site-") as directory:
    site = Path(directory)
    (site / "index.html").write_text("<!doctype html><title>isolation</title>", encoding="utf-8")
    with ExitStack() as stack:
        a = stack.enter_context(BrowserSession(site, "isolation-A", instrument=False))
        b = stack.enter_context(BrowserSession(site, "isolation-B", instrument=False))
        profiles = a.profile, b.profile
        assert a.profile != b.profile
        # Use the same origin, so only the profile boundary can explain isolation.
        b.url = a.url
        b._navigate()
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
    assert all(not profile.exists() for profile in profiles)
    if _is_windows():
        assert (HOST_STATE_ROOT / _seed_key(a.browser) / "profile" / "Local State").exists()

print("PASS browser isolation: separate LocalStorage/IndexedDB, disposable profiles, persistent host seed")
