from __future__ import annotations

import contextlib
import ctypes
import getpass
import hashlib
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
HOST_STATE_ROOT = ROOT / ".work" / "browser-host-state"


def _is_windows() -> bool:
    return os.name == "nt"


def _password_check_state(path: Path) -> dict:
    """Read only Chromium's Windows password-check cache, never profile data."""
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
        prefs = state["password_manager"]
        blank = prefs["os_password_blank"]
        changed = prefs["os_password_last_changed"]
        if isinstance(blank, bool) and isinstance(changed, (str, int)) and not isinstance(changed, bool) and int(changed) > 0:
            return {"os_password_blank": blank, "os_password_last_changed": changed}
    except (OSError, ValueError, TypeError, KeyError, AttributeError):
        pass
    raise RuntimeError(f"Invalid Chromium Windows password-check cache in {path}")


def _windows_password_check_state() -> dict:
    """Mirror Chromium's NetUserGetInfo timestamp without calling LogonUser.

    A false blank-password value is conservative: Chrome will still demand OS
    authentication if a password-manager action requests it.
    """
    from ctypes import wintypes

    class UserInfo1(ctypes.Structure):
        _fields_ = [("name", wintypes.LPWSTR), ("password", wintypes.LPWSTR),
                    ("password_age", wintypes.DWORD), ("priv", wintypes.DWORD),
                    ("home_dir", wintypes.LPWSTR), ("comment", wintypes.LPWSTR),
                    ("flags", wintypes.DWORD), ("script_path", wintypes.LPWSTR)]

    # Chromium uses NameSamCompatible and strips the domain prefix before
    # querying NetUserGetInfo. Environment USERNAME can name another account.
    username_buffer = ctypes.create_unicode_buffer(256)
    username_length = wintypes.ULONG(len(username_buffer))
    security = ctypes.WinDLL("Secur32.dll")
    security.GetUserNameExW.argtypes = [ctypes.c_int, wintypes.LPWSTR,
                                       ctypes.POINTER(wintypes.ULONG)]
    security.GetUserNameExW.restype = wintypes.BOOL
    if not security.GetUserNameExW(2, username_buffer, ctypes.byref(username_length)):
        raise RuntimeError("GetUserNameExW could not identify the current Windows account")
    username = username_buffer.value.split("\\")[-1]
    buffer = ctypes.c_void_p()
    netapi = ctypes.WinDLL("Netapi32.dll")
    netapi.NetUserGetInfo.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR,
                                      wintypes.DWORD, ctypes.POINTER(ctypes.c_void_p)]
    netapi.NetUserGetInfo.restype = wintypes.DWORD
    netapi.NetApiBufferFree.argtypes = [ctypes.c_void_p]
    status = netapi.NetUserGetInfo(None, username, 1, ctypes.byref(buffer))
    if status:
        raise RuntimeError(f"NetUserGetInfo({username!r}) failed with status {status}")
    try:
        age = ctypes.cast(buffer, ctypes.POINTER(UserInfo1)).contents.password_age
    finally:
        netapi.NetApiBufferFree(buffer)
    # Chromium stores base::Time microseconds from the Windows epoch and adds
    # one second for clock skew. Three seconds accommodates Python/API timing.
    changed = int((time.time() + 11644473600 - age + 3) * 1_000_000)
    return {"os_password_blank": False, "os_password_last_changed": str(changed)}


def _seed_key(browser: str) -> str:
    identity = "\0".join((str(Path(browser).resolve()).casefold(),
                           os.environ.get("COMPUTERNAME", ""), getpass.getuser()))
    return hashlib.sha256(identity.encode("utf-8")).hexdigest()[:24]


@contextlib.contextmanager
def _host_state_lock(root: Path):
    """Serialize seed creation across independent verification suite processes."""
    if os.name == "nt":
        import msvcrt

        def acquire(handle):
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)

        def release(handle):
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
    else:
        import fcntl

        def acquire(handle):
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)

        def release(handle):
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)

    root.mkdir(parents=True, exist_ok=True)
    with (root / "seed.lock").open("a+b") as handle:
        deadline = time.monotonic() + 60
        while True:
            try:
                acquire(handle)
                break
            except OSError:
                if time.monotonic() >= deadline:
                    raise RuntimeError("Timed out waiting for Chromium Windows host-state seed lock")
                time.sleep(0.1)
        try:
            yield
        finally:
            release(handle)


def _browser_args(browser: str, profile: Path, port: int) -> list[str]:
    return [browser, "--headless=new", "--no-sandbox", "--disable-gpu",
            f"--remote-debugging-port={port}", f"--user-data-dir={profile}",
            "--remote-allow-origins=*", "--disable-background-networking",
            "--no-first-run", "about:blank"]


def _bootstrap_host_state(browser: str, seed_profile: Path) -> dict:
    """Initialize a dedicated browser profile, then add only host preferences."""
    seed_profile.mkdir(parents=True, exist_ok=True)
    log_path = seed_profile.parent / "bootstrap.log"
    port = _free_port()
    with log_path.open("w", encoding="utf-8") as log:
        process = subprocess.Popen(
            _browser_args(browser, seed_profile, port),
            stdout=log, stderr=subprocess.STDOUT,
        )
        try:
            _wait_json(f"http://127.0.0.1:{port}/json/list", timeout=30, process=process)
        finally:
            # Browser.close lets Chromium flush Local State; terminate() on
            # Windows is a hard kill and can lose the preferences we need.
            if process.poll() is None:
                try:
                    version = _wait_json(f"http://127.0.0.1:{port}/json/version", timeout=3, process=process)
                    with websocket.create_connection(version["webSocketDebuggerUrl"], timeout=3) as ws:
                        ws.send(json.dumps({"id": 1, "method": "Browser.close"}))
                except Exception:
                    process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
    local_state = seed_profile / "Local State"
    state = json.loads(local_state.read_text(encoding="utf-8"))
    cache = _windows_password_check_state()
    state["password_manager"] = cache
    local_state.write_text(json.dumps(state), encoding="utf-8")
    return cache


def _seed_windows_profile(browser: str, profile: Path) -> None:
    """Copy exactly two host preferences to a disposable, otherwise empty profile."""
    if not _is_windows():
        return
    root = HOST_STATE_ROOT
    key = _seed_key(browser)
    try:
        with _host_state_lock(root):
            seed = root / key
            failed = seed / "bootstrap.failed"
            if failed.exists():
                raise RuntimeError("Earlier Chromium host-state bootstrap failed; inspect "
                                   f"{seed} and remove this seed directory only after fixing the cause")
            local_state = seed / "profile" / "Local State"
            if local_state.exists():
                cache = _password_check_state(local_state)
            else:
                seed.mkdir(parents=True, exist_ok=True)
                try:
                    cache = _bootstrap_host_state(browser, seed / "profile")
                except Exception as exc:
                    failed.write_text(str(exc), encoding="utf-8")
                    raise
            # The OS may have changed its password since the seed was made.
            # Refresh from NetUserGetInfo before each disposable browser starts.
            current = _windows_password_check_state()
            if int(current["os_password_last_changed"]) > int(cache["os_password_last_changed"]) + 2_000_000:
                cache = current
                state = json.loads(local_state.read_text(encoding="utf-8"))
                state["password_manager"] = cache
                local_state.write_text(json.dumps(state), encoding="utf-8")
            (profile / "Local State").write_text(
                json.dumps({"password_manager": cache}), encoding="utf-8"
            )
    except Exception as exc:
        raise RuntimeError(
            "Windows Chromium password-check seed is unavailable; browser launch stopped "
            "to avoid repeated Windows logon failures. " + str(exc)
        ) from exc


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


def _wait_json(url: str, timeout: float = 10.0, *, process=None):
    # A cold Chromium process can publish the DevTools socket before /json/list
    # finishes its first target enumeration. A 0.5s per-request timeout makes
    # that state self-perpetuating: every poll aborts the slow first response
    # and immediately starts another one. Keep the overall deadline strict,
    # but allow an individual localhost request enough time to complete.
    end = time.monotonic() + timeout
    last = None
    while True:
        if process is not None and process.poll() is not None:
            raise RuntimeError(f"Chrome exited before DevTools became ready (exit {process.returncode})")
        remaining = end - time.monotonic()
        if remaining <= 0:
            break
        try:
            with urllib.request.urlopen(url, timeout=min(5.0, remaining)) as response:
                return json.load(response)
        except Exception as exc:  # startup race / cold target enumeration
            last = exc
            remaining = end - time.monotonic()
            if remaining <= 0:
                break
            time.sleep(min(0.1, remaining))
    raise RuntimeError(f"Chrome DevTools did not become available: {last}")


class _QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, _format, *_args):
        pass

    def handle(self):
        try:
            super().handle()
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            # Headless Chromium can cancel or close an idle localhost request while
            # tabs/targets are being torn down. That is a normal client disconnect,
            # not a server or application failure; unexpected exceptions still escape.
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


class _RuntimeHTTPServer(http.server.ThreadingHTTPServer):
    # Native ESM fans out across many local modules. Windows' small default
    # accept backlog can reset parallel requests and poison the browser module
    # cache before test assertions start. Keep accepted sockets fully threaded.
    request_queue_size = 128


class BrowserSession:
    """Real localhost + headless Chromium session with a small CDP client."""

    def __init__(self, site: Path, label: str, *, instrument=True, service_worker=False, auto_navigate=True):
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
        self.auto_navigate = auto_navigate

    def __enter__(self):
        try:
            self._prepare_site()
            self._start_server()
            self._start_browser()
            if self.auto_navigate:
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
        self.httpd = _RuntimeHTTPServer(("127.0.0.1", port), handler)
        self.http_thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.http_thread.start()
        self.url = f"http://127.0.0.1:{port}/index.html"

    def _start_browser(self):
        _seed_windows_profile(self.browser, self.profile)
        devtools_port = _free_port()
        args = _browser_args(self.browser, self.profile, devtools_port)
        browser_log = self.tmp / 'browser.log'
        with browser_log.open('w', encoding='utf-8') as log:
            self.proc = subprocess.Popen(args, stdout=log, stderr=subprocess.STDOUT)
        try:
            # A fresh CI machine can need more than 10s for its first Chrome boot.
            # Poll readiness, fail immediately on process exit, and leave application
            # assertions/timeouts unchanged. Include stderr before temp cleanup.
            pages = _wait_json(f"http://127.0.0.1:{devtools_port}/json/list", timeout=30, process=self.proc)
        except Exception as error:
            diagnostics = browser_log.read_text(encoding='utf-8', errors='replace')[-8000:]
            raise RuntimeError(f"{error}\nChrome startup log:\n{diagnostics}") from error
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
        last_error = None
        state = None
        while time.time() < end:
            try:
                # Loading-state inspection must not import test-access.js into a
                # document which may still be navigating/reloading.
                response = self.call('Runtime.evaluate', {'expression': '({ready:document.readyState,href:location.href})', 'returnByValue': True})
                state = response.get('result', {}).get('result', {}).get('value')
                if state and state.get("href", "").startswith(self.url) and state.get("ready") == "complete":
                    return
            except Exception as error:
                last_error = error
            time.sleep(0.05)
        raise RuntimeError(f"{self.label}: page did not finish loading at {self.url}; state: {state}; last error: {last_error}; browser errors: {self.drain_serious_errors()}")

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

class LegacyBrowserSession(BrowserSession):
    """Exercise the retained V1 drain/compatibility path in a disposable site.

    Production fresh installs now commit local V2 birth before any business
    write. Older fault-injection suites deliberately call V1 writers directly;
    keep those tests meaningful without teaching production to downgrade. The
    separate runtime_local_birth_gate suite runs the unmodified production site.
    """

    def _prepare_site(self):
        super()._prepare_site()
        prepared = self.tmp / 'site/assets/js/lifecycle.js'
        source = prepared.read_text(encoding='utf-8')
        if 'netunim-orders' in str(self.site):
            start = source.index('  if(localOwner){\n    try{\n      if(!localEngineActive)')
            end = source.index('\n\n  if(!tab.primaryTab){', start)
            source = (source[:start] +
                "  try{await restoreBrowserStateFallback()}catch(e){if(cutoverActive||localEngineActive)throw e;console.error('browser state recovery',e)}" +
                source[end:])
        elif 'netunim-kupa' in str(self.site):
            start = source.index('  // Birth is a durable transition, and its Main checkpoint')
            end = source.index("  document.getElementById('chooseFolder')", start)
            source = source[:start] + source[end:]
        else:
            raise ValueError('LegacyBrowserSession requires a supported site')
        prepared.write_text(source, encoding='utf-8')
