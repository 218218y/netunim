from __future__ import annotations

import contextlib
import http.server
import json
import os
import re
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import urllib.request

try:
    import websocket
except ImportError as exc:  # pragma: no cover - handled by run_all.py first
    raise SystemExit(
        "Missing Python dependency 'websocket-client'. "
        "Install tests/requirements.txt before running browser tests."
    ) from exc

ROOT = Path(__file__).resolve().parents[1]


def find_browser() -> str | None:
    for name in ("chromium", "chromium-browser", "google-chrome", "chrome", "msedge"):
        path = shutil.which(name)
        if path:
            return path
    if os.name == "nt":
        roots = [
            Path(os.environ.get("PROGRAMFILES", "")),
            Path(os.environ.get("PROGRAMFILES(X86)", "")),
            Path(os.environ.get("LOCALAPPDATA", "")),
        ]
        candidates = []
        for root in roots:
            if not str(root):
                continue
            candidates.extend(
                [
                    root / "Google/Chrome/Application/chrome.exe",
                    root / "Microsoft/Edge/Application/msedge.exe",
                    root / "Chromium/Application/chrome.exe",
                ]
            )
        for path in candidates:
            if path.is_file():
                return str(path)
    return None


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _wait_json(url: str, timeout: float = 10.0):
    end = time.time() + timeout
    last = None
    while time.time() < end:
        try:
            with urllib.request.urlopen(url, timeout=0.5) as response:
                return json.load(response)
        except Exception as exc:  # startup race
            last = exc
            time.sleep(0.1)
    raise RuntimeError(f"Chrome DevTools did not become available: {last}")


class _QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, _format, *_args):
        pass


class BrowserSession:
    """Real localhost + headless Chromium session with a small CDP client."""

    def __init__(self, site: Path, label: str):
        self.site = Path(site)
        self.label = label
        self.browser = find_browser()
        if not self.browser:
            raise RuntimeError("Chrome/Edge/Chromium was not found")
        self.tmp = Path(tempfile.mkdtemp(prefix=f"netunim-{label}-runtime-"))
        self.profile = Path(tempfile.mkdtemp(prefix=f"netunim-{label}-chrome-"))
        self.httpd = None
        self.http_thread = None
        self.proc = None
        self.ws = None
        self.seq = 0
        self.events: list[dict] = []
        self.mode = "localhost"

    def __enter__(self):
        self._prepare_site()
        self._start_server()
        self._start_browser()
        self._navigate()
        return self

    def __exit__(self, exc_type, exc, tb):
        with contextlib.suppress(Exception):
            if self.ws:
                self.ws.close()
        if self.proc:
            with contextlib.suppress(Exception):
                self.proc.terminate()
                self.proc.wait(timeout=3)
            if self.proc.poll() is None:
                with contextlib.suppress(Exception):
                    self.proc.kill()
        if self.httpd:
            with contextlib.suppress(Exception):
                self.httpd.shutdown()
                self.httpd.server_close()
        if self.http_thread:
            self.http_thread.join(timeout=2)
        shutil.rmtree(self.profile, ignore_errors=True)
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _prepare_site(self):
        shutil.copytree(self.site, self.tmp / "site", dirs_exist_ok=True)
        prepared = self.tmp / "site"
        config = prepared / "supabase/config.js"
        config.parent.mkdir(parents=True, exist_ok=True)
        config.write_text(
            "window.KUPA_SUPABASE_CONFIG={url:'https://example.invalid',publishableKey:'test'};"
            "window.ORDER_SUPABASE_CONFIG={url:'https://example.invalid',publishableKey:'test'};\n",
            encoding="utf-8",
        )
        # Service Worker behavior has its own contract tests. Runtime tests disable
        # registration inside JavaScript assets so an old worker from a previous local
        # run cannot affect results after the browser code was externalized from HTML.
        needle = "navigator.serviceWorker.register('./service-worker.js')"
        replacement = "Promise.resolve({scope:'runtime-test'})"
        for js_path in prepared.rglob("*.js"):
            source = js_path.read_text(encoding="utf-8")
            if needle in source:
                js_path.write_text(source.replace(needle, replacement), encoding="utf-8")

    def _start_server(self):
        port = _free_port()
        directory = str(self.tmp / "site")
        handler = lambda *args, **kwargs: _QuietHandler(*args, directory=directory, **kwargs)
        self.httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
        self.http_thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.http_thread.start()
        self.url = f"http://127.0.0.1:{port}/index.html"

    def _start_browser(self):
        devtools_port = _free_port()
        args = [
            self.browser,
            "--headless=new",
            "--no-sandbox",
            "--disable-gpu",
            f"--remote-debugging-port={devtools_port}",
            f"--user-data-dir={self.profile}",
            "--remote-allow-origins=*",
            "--disable-background-networking",
            "--no-first-run",
            "about:blank",
        ]
        self.proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        pages = _wait_json(f"http://127.0.0.1:{devtools_port}/json/list")
        page = next((item for item in pages if item.get("type") == "page"), None)
        if not page:
            raise RuntimeError("Chrome DevTools did not expose a page target")
        self.ws = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=5)
        self.call("Runtime.enable")
        self.call("Page.enable")
        self.call("Log.enable")

    def call(self, method: str, params: dict | None = None):
        self.seq += 1
        ident = self.seq
        self.ws.send(json.dumps({"id": ident, "method": method, "params": params or {}}))
        while True:
            message = json.loads(self.ws.recv())
            if message.get("id") == ident:
                return message
            self.events.append(message)

    def _storage_shim(self) -> str:
        return r"""(()=>{
          const makeStorage=()=>{const m=new Map();return {
            getItem:k=>m.has(String(k))?m.get(String(k)):null,
            setItem:(k,v)=>m.set(String(k),String(v)),
            removeItem:k=>m.delete(String(k)),clear:()=>m.clear(),
            key:i=>[...m.keys()][i]??null,get length(){return m.size}
          }};
          try{Object.defineProperty(window,'localStorage',{value:makeStorage(),configurable:true})}catch(e){}
          try{Object.defineProperty(window,'sessionStorage',{value:makeStorage(),configurable:true})}catch(e){}
          const dbs=new Map();
          const asyncCall=fn=>setTimeout(fn,0);
          const ensureDb=name=>{if(!dbs.has(name))dbs.set(name,{stores:new Map()});return dbs.get(name)};
          const request=()=>({result:undefined,error:null,onsuccess:null,onerror:null,onupgradeneeded:null});
          const objectStoreNames=db=>({contains:name=>db.stores.has(String(name))});
          const makeStore=(store,tx=null)=>{
            const run=fn=>{const q=request();if(tx)tx._pending++;asyncCall(()=>{try{fn(q);q.onsuccess&&q.onsuccess({target:q})}catch(e){q.error=e;q.onerror&&q.onerror({target:q})}finally{if(tx){tx._pending--;tx._finish()}}});return q};
            return {
              put(value,key){return run(q=>{store.set(String(key),structuredClone(value));q.result=key})},
              get(key){return run(q=>{q.result=store.has(String(key))?structuredClone(store.get(String(key))):undefined})},
              delete(key){return run(q=>{store.delete(String(key));q.result=undefined})}
            }
          };
          const makeDb=(name,raw)=>({
            name,close(){},get objectStoreNames(){return objectStoreNames(raw)},
            createObjectStore(storeName){const n=String(storeName);if(!raw.stores.has(n))raw.stores.set(n,new Map());return makeStore(raw.stores.get(n))},
            transaction(storeName){const n=String(storeName),tx={oncomplete:null,onerror:null,onabort:null,error:null,_pending:0,_scheduled:false};
              if(!raw.stores.has(n))raw.stores.set(n,new Map());
              tx._finish=()=>{if(tx._pending===0&&!tx._scheduled){tx._scheduled=true;asyncCall(()=>{tx._scheduled=false;if(tx._pending===0)tx.oncomplete&&tx.oncomplete({target:tx})})}};
              tx.objectStore=()=>makeStore(raw.stores.get(n),tx);
              asyncCall(()=>tx._finish());return tx}
          });
          const indexed={open(name){const q=request();asyncCall(()=>{const existed=dbs.has(String(name)),raw=ensureDb(String(name)),db=makeDb(String(name),raw);q.result=db;if(!existed&&q.onupgradeneeded)q.onupgradeneeded({target:q});asyncCall(()=>q.onsuccess&&q.onsuccess({target:q}))});return q}};
          try{Object.defineProperty(window,'indexedDB',{value:indexed,configurable:true})}catch(e){}
        })()"""

    def _prepared_html(self) -> str:
        """Inline local CSS/JS only for the isolated-DOM fallback.

        Normal runtime tests load the real files over localhost. Managed browsers can
        block loopback navigation; in that case Page.setDocumentContent has an
        about:blank origin and cannot resolve our external app assets. Inlining the
        already-prepared local files preserves document order and keeps the fallback
        semantically equivalent without weakening the production site structure.
        """
        site = self.tmp / "site"
        html = (site / "index.html").read_text(encoding="utf-8")

        def local_file(url: str) -> Path | None:
            clean = url.split("?", 1)[0].split("#", 1)[0]
            if re.match(r"^[a-z][a-z0-9+.-]*:", clean, re.I) or clean.startswith("//"):
                return None
            relative = clean[2:] if clean.startswith("./") else clean.lstrip("/")
            target = site / relative
            try:
                target.resolve().relative_to(site.resolve())
            except Exception:
                return None
            return target if target.is_file() else None

        link_re = re.compile(r"<link\b(?P<attrs>[^>]*)>", re.I)
        def inline_stylesheet(match):
            attrs = match.group("attrs") or ""
            rel = re.search(r"\brel\s*=\s*[\"']([^\"']+)[\"']", attrs, re.I)
            href = re.search(r"\bhref\s*=\s*[\"']([^\"']+)[\"']", attrs, re.I)
            if not rel or "stylesheet" not in rel.group(1).lower().split() or not href:
                return match.group(0)
            target = local_file(href.group(1))
            if not target:
                return match.group(0)
            css = target.read_text(encoding="utf-8").replace("</style", "<\\/style")
            return f'<style data-runtime-source="{href.group(1)}">{css}</style>'
        html = link_re.sub(inline_stylesheet, html)

        script_re = re.compile(
            r"<script(?P<before>[^>]*)\bsrc\s*=\s*[\"'](?P<src>[^\"']+)[\"'](?P<after>[^>]*)>\s*</script>",
            re.I | re.S,
        )
        def inline_script(match):
            target = local_file(match.group("src"))
            if not target:
                return match.group(0)
            source = target.read_text(encoding="utf-8").replace("</script", "<\\/script")
            attrs = (match.group("before") or "") + (match.group("after") or "")
            return f"<script{attrs}>{source}</script>"
        return script_re.sub(inline_script, html)

    def _navigate(self):
        result = self.call("Page.navigate", {"url": self.url})
        nav = result.get("result", {})
        if nav.get("errorText"):
            # Managed Chrome installations can block loopback/file navigation. Keep
            # the suite portable by falling back to an isolated about:blank document
            # with complete in-memory localStorage/sessionStorage/IndexedDB shims.
            self.mode = "isolated-dom"
            self.call("Page.navigate", {"url": "about:blank"})
            time.sleep(0.05)
            self.call("Runtime.evaluate", {"expression": self._storage_shim()})
            tree = self.call("Page.getFrameTree")["result"]["frameTree"]
            frame_id = tree["frame"]["id"]
            self.events.clear()
            self.call("Page.setDocumentContent", {"frameId": frame_id, "html": self._prepared_html()})
            end = time.time() + 10
            while time.time() < end:
                try:
                    state = self.evaluate("document.readyState")
                    if state == "complete":
                        time.sleep(0.25)
                        return
                except Exception:
                    pass
                time.sleep(0.05)
            raise RuntimeError(f"{self.label}: isolated document did not finish loading")
        end = time.time() + 10
        while time.time() < end:
            try:
                state = self.evaluate("({ready:document.readyState,href:location.href})")
                if state and state.get("href", "").startswith(self.url) and state.get("ready") == "complete":
                    time.sleep(0.25)
                    return
            except Exception:
                pass
            time.sleep(0.05)
        raise RuntimeError(f"{self.label}: page did not finish loading at {self.url}")

    def evaluate(self, expression: str, *, await_promise: bool = True):
        response = self.call(
            "Runtime.evaluate",
            {
                "expression": expression,
                "returnByValue": True,
                "awaitPromise": await_promise,
            },
        )
        payload = response.get("result", {})
        if "exceptionDetails" in payload:
            details = payload["exceptionDetails"]
            exception = details.get("exception", {})
            description = exception.get("description") or exception.get("value") or details.get("text")
            raise RuntimeError(str(description))
        return payload.get("result", {}).get("value")

    def drain_serious_errors(self) -> list[str]:
        self.ws.settimeout(0.1)
        try:
            while True:
                self.events.append(json.loads(self.ws.recv()))
        except Exception:
            pass
        finally:
            self.ws.settimeout(5)
        errors = []
        for event in self.events:
            method = event.get("method")
            params = event.get("params", {})
            if method == "Runtime.exceptionThrown":
                details = params.get("exceptionDetails", {})
                exc = details.get("exception", {})
                errors.append(str(exc.get("description") or exc.get("value") or details.get("text") or "exception"))
            elif method == "Log.entryAdded" and params.get("entry", {}).get("level") == "error":
                text = str(params["entry"].get("text", "log error"))
                if "Failed to load resource" not in text and "ERR_" not in text:
                    errors.append(text)
        return errors
