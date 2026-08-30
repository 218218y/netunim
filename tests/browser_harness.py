from __future__ import annotations

import contextlib
import http.server
import json
import os
import re
import secrets
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
    override = os.environ.get("NETUNIM_BROWSER", "").strip()
    if override:
        explicit = Path(override).expanduser()
        if explicit.is_file():
            return str(explicit.resolve())
        resolved = shutil.which(override)
        if resolved:
            return resolved
        return None

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
    # Some Windows hosts allocate low ephemeral ports, including Chromium's
    # forbidden service ports (ERR_UNSAFE_PORT). Use the dynamic/private range.
    for _ in range(100):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            port = 49152 + secrets.randbelow(16384)
            try:
                sock.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    raise RuntimeError('No free localhost port in the dynamic range')


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

    def end_headers(self):
        # Exercise the same security headers as the static deployment.
        headers = Path(self.directory) / '_headers'
        if headers.is_file():
            for line in headers.read_text(encoding='utf-8').splitlines():
                if line.startswith('  ') and ':' in line:
                    name, value = line.strip().split(':', 1)
                    self.send_header(name, value.strip())
        super().end_headers()


class BrowserSession:
    """Real localhost + headless Chromium session with a small CDP client."""

    def __init__(self, site: Path, label: str, *, instrument=True, service_worker=False):
        self.site = Path(site)
        self.label = label
        self.browser = find_browser()
        if not self.browser:
            raise RuntimeError("Chrome/Edge/Chromium was not found")
        self.tmp = Path(tempfile.mkdtemp(prefix=f"netunim-{label}-runtime-"))
        self.downloads = self.tmp / 'downloads'
        self.downloads.mkdir(parents=True, exist_ok=True)
        self.profile = Path(tempfile.mkdtemp(prefix=f"netunim-{label}-chrome-"))
        self.httpd = None
        self.http_thread = None
        self.proc = None
        self.ws = None
        self.seq = 0
        self.events: list[dict] = []
        self.mode = "localhost"
        self.instrument = instrument
        self.service_worker = service_worker

    def __enter__(self):
        try:
            self._prepare_site()
            self._start_server()
            self._start_browser()
            self._navigate()
            # HTML completion does not imply completion of asynchronous recovery.
            if self.instrument:
                self.evaluate("appReady.then(()=>true)")
            return self
        except BaseException:
            self.__exit__(None, None, None)
            raise

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
        # Native PWA recovery exercises real failed requests. Keep these on the
        # test origin (allowed by the unchanged production CSP), never production.
        config_url = 'location.origin' if self.service_worker else "'https://example.invalid'"
        config.write_text(
            "export const supabaseConfig=Object.freeze({url:"+config_url+",publishableKey:'test'});\n",
            encoding="utf-8",
        )
        # Service Worker behavior has its own contract tests. Runtime tests disable
        # registration inside JavaScript assets so an old worker from a previous local
        # run cannot affect results after the browser code was externalized from HTML.
        needle = "navigator.serviceWorker.register('./service-worker.js')"
        replacement = "Promise.resolve({scope:'runtime-test'})"
        for js_path in prepared.rglob("*.js"):
            source = js_path.read_text(encoding="utf-8")
            if needle in source and not self.service_worker:
                js_path.write_text(source.replace(needle, replacement), encoding="utf-8")
        self.probe_names = self._module_probe({'mode':'instrument','site':str(prepared)}) if self.instrument else []

    def _module_probe(self, payload):
        result = subprocess.run(
            ['node', str(ROOT / 'tests/module_probe.cjs')],
            input=json.dumps(payload), capture_output=True, text=True, encoding='utf-8',
            cwd=ROOT, check=True,
        )
        return json.loads(result.stdout)

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
        self.devtools_url = f'http://127.0.0.1:{devtools_port}'
        page = next((item for item in pages if item.get("type") == "page"), None)
        if not page:
            raise RuntimeError("Chrome DevTools did not expose a page target")
        self.ws = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=5)
        self.call("Runtime.enable")
        self.call("Page.enable")
        self.call("Log.enable")
        # Runtime workflows intentionally exercise production download actions (for
        # example, the safety JSON created before a restore). Keep every browser
        # download inside this disposable session so tests can never pollute the
        # user's real Downloads folder; __exit__ removes it with self.tmp.
        download_behavior = self.call(
            "Browser.setDownloadBehavior",
            {"behavior": "allow", "downloadPath": str(self.downloads.resolve())},
        )
        if download_behavior.get("error"):
            raise RuntimeError(
                f"{self.label}: Chromium refused isolated download directory: "
                + str(download_behavior["error"])
            )

    @contextlib.contextmanager
    def second_tab(self):
        target = self.call('Target.createTarget', {'url':'about:blank'})['result']['targetId']
        pages = _wait_json(self.devtools_url+'/json/list')
        page = next(p for p in pages if p['id']==target)
        original = self.ws, self.seq, self.events
        self.ws = websocket.create_connection(page['webSocketDebuggerUrl'], timeout=10)
        self.seq, self.events = 0, []
        try:
            self.call('Runtime.enable')
            self.call('Page.enable')
            self.call('Log.enable')
            self._navigate()
            self.evaluate("import('./assets/js/main.js').then(m=>m.appReady).then(()=>true)")
            yield self
        finally:
            self.ws.close()
            self.ws, self.seq, self.events = original
            self.call('Target.closeTarget', {'targetId':target})

    def call(self, method: str, params: dict | None = None, *, timeout: float | None = None):
        self.seq += 1
        ident = self.seq
        previous_timeout = self.ws.gettimeout()
        if timeout is not None:
            self.ws.settimeout(timeout)
        try:
            self.ws.send(json.dumps({"id": ident, "method": method, "params": params or {}}))
            while True:
                message = json.loads(self.ws.recv())
                if message.get("id") == ident:
                    return message
                self.events.append(message)
        finally:
            if timeout is not None:
                self.ws.settimeout(previous_timeout)

    def _navigate(self):
        result = self.call("Page.navigate", {"url": self.url})
        nav = result.get("result", {})
        if nav.get("errorText"):
            raise RuntimeError('Native ESM runtime requires localhost navigation: '+nav['errorText'])
        end = time.time() + 10
        while time.time() < end:
            try:
                state = self.evaluate("({ready:document.readyState,href:location.href})")
                if state and state.get("href", "").startswith(self.url) and state.get("ready") == "complete":
                    return
            except Exception:
                pass
            time.sleep(0.05)
        raise RuntimeError(f"{self.label}: page did not finish loading at {self.url}")

    def evaluate(self, expression: str, *, await_promise: bool = True, timeout: float | None = None):
        if self.instrument:
            expression = self._module_probe({'mode':'expression','expression':expression,'names':self.probe_names})
        if '__netunimProbe.' in expression:
            expression = "(async()=>{const {bindings:__netunimProbe}=await import('./test-access.js');return ("+expression+")})()"
        response = self.call(
            "Runtime.evaluate",
            {
                "expression": expression,
                "returnByValue": True,
                "awaitPromise": await_promise,
            },
            timeout=timeout,
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
