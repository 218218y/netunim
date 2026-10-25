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
import signal
from pathlib import Path
import shutil
import stat
import socket
import subprocess
import tempfile
import threading
import time
import urllib.request
import urllib.parse
from acceptance_safety import browser_preflight, sandbox_config, DenyProxy, OwnedHTTPServer
from suite_process import SuiteProcess

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
            f"--remote-debugging-port={port}", f"--user-data-dir={profile}", "--profile-directory=Default",
            "--remote-allow-origins=*", "--disable-background-networking",
            "--enable-logging=stderr", "--log-level=0",
            "--no-first-run", "about:blank"]


def _devtools_urls(port: int, path: str) -> tuple[str, str]:
    # Chromium may bind only one loopback family when the other port is busy.
    return (f"http://127.0.0.1:{port}{path}", f"http://[::1]:{port}{path}")


def _bootstrap_host_state(_browser: str, seed_profile: Path) -> dict:
    """Initialize only host preferences, without launching an unseeded browser.

    No other field from Chromium's generated Local State was ever copied into a
    session. Query the same OS metadata directly before its very first launch;
    a blank browser launch added no information and could itself hang or trigger
    the Windows password check that this seed is intended to avoid.
    """
    seed_profile.mkdir(parents=True, exist_ok=True)
    cache = _windows_password_check_state()
    (seed_profile / "Local State").write_text(json.dumps({"password_manager":cache}), encoding="utf-8")
    return cache


def _seed_windows_profile(browser: str, profile: Path) -> None:
    """Copy two host preferences, preserving this owned profile on restart."""
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
            destination = profile / 'Local State'
            state = json.loads(destination.read_text(encoding='utf8')) if destination.exists() else {}
            if not isinstance(state, dict) or not isinstance(state.get('password_manager', {}), dict):
                raise RuntimeError('invalid owned Chromium Local State')
            state['password_manager'] = {**state.get('password_manager', {}), **cache}
            destination.write_text(json.dumps(state), encoding='utf8')
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


def _wait_json(url: str | tuple[str, ...], timeout: float = 10.0, *, process=None, expected_browser_path=None):
    # A cold Chromium process can publish the DevTools socket before /json/list
    # finishes its first target enumeration. A 0.5s per-request timeout makes
    # that state self-perpetuating: every poll aborts the slow first response
    # and immediately starts another one. Keep the overall deadline strict,
    # but allow an individual localhost request enough time to complete.
    urls = (url,) if isinstance(url, str) else url
    end = time.monotonic() + timeout
    last = None
    while True:
        if process is not None and process.poll() is not None:
            raise RuntimeError(f"Chrome exited before DevTools became ready (exit {process.returncode})")
        remaining = end - time.monotonic()
        if remaining <= 0:
            break
        for candidate in urls:
            remaining = end - time.monotonic()
            if remaining <= 0:
                break
            try:
                with urllib.request.urlopen(candidate, timeout=min(5.0, remaining)) as response:
                    result = json.load(response)
                    if expected_browser_path is not None:
                        actual = urllib.parse.urlsplit(result.get('webSocketDebuggerUrl', '')).path if isinstance(result, dict) else None
                        if actual != expected_browser_path:
                            raise RuntimeError('DevTools listener does not belong to the owned profile')
                    return result
            except Exception as exc:  # startup race / cold target enumeration
                last = exc
        remaining = end - time.monotonic()
        if remaining <= 0:
            break
        time.sleep(min(0.1, remaining))
    raise RuntimeError(f"Chrome DevTools did not become available: {last}")


def _wait_owned_devtools(profile, process, *, timeout=30):
    deadline = time.monotonic()+timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError('owned Chromium exited before publishing DevTools')
        try:
            lines = (profile/'DevToolsActivePort').read_text(encoding='utf8').splitlines()
            port, browser_path = int(lines[0]), lines[1]
            if not 0 < port < 65536 or not browser_path.startswith('/devtools/browser/') or urllib.parse.urlsplit(browser_path).netloc:
                raise ValueError('invalid owned DevTools identity')
            return port, browser_path
        except (OSError, ValueError, IndexError):
            time.sleep(.05)
    raise RuntimeError('owned Chromium did not publish its private DevTools identity')


def _network_failure_diagnostics(events):
    """Retain failed destinations/codes only, never headers, queries or bodies."""
    requests, failures = {}, []
    for event in events:
        method, params = event.get('method'), event.get('params', {})
        if method == 'Network.requestWillBeSent':
            requests[params['requestId']] = params.get('request', {}).get('url', '')
        elif method == 'Network.loadingFailed':
            url = urllib.parse.urlsplit(requests.get(params.get('requestId'), ''))
            failures.append({'host': url.hostname, 'port': url.port, 'path': url.path,
                'errors': re.findall(r'(?:net::)?ERR_[A-Z_]+', str(params.get('errorText', ''))),
                'blocked': params.get('blockedReason'), 'canceled': params.get('canceled', False)})
        elif method == 'Log.entryAdded':
            entry = params.get('entry', {})
            if entry.get('source') == 'network' and entry.get('level') == 'error':
                url = urllib.parse.urlsplit(entry.get('url', ''))
                failures.append({'host': url.hostname, 'port': url.port, 'path': url.path,
                    'errors': re.findall(r'(?:net::)?ERR_[A-Z_]+', str(entry.get('text', '')))})
    return failures[-20:]


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


class _RuntimeHTTPServer(OwnedHTTPServer):
    # Native ESM fans out across many local modules. Windows' small default
    # accept backlog can reset parallel requests and poison the browser module
    # cache before test assertions start. Keep accepted sockets fully threaded.
    request_queue_size = 128


def _stop_browser_process(process, graceful_close=None, *, graceful_timeout=5) -> bool:
    """Stop Chromium completely before its disposable profile is removed.

    Chrome is multi-process. Closing the browser through CDP gives all child
    processes a chance to exit together. If CDP is unavailable, keep the
    fallback bounded but always wait after terminate/kill; deleting a profile
    while Chrome is still exiting can race with late profile writes.
    """
    if process is None or process.poll() is not None:
        return True
    if graceful_close is not None:
        try:
            graceful_close()
        except Exception:
            # Browser.close can close the socket before its response arrives.
            # Still allow the accepted shutdown to flush the private profile.
            pass
        try:
            process.wait(timeout=graceful_timeout)
            return True
        except subprocess.TimeoutExpired:
            pass
    process.terminate()
    try:
        process.wait(timeout=3)
        return False
    except subprocess.TimeoutExpired:
        process.kill()
    # kill() is asynchronous too. Do not race profile deletion against exit.
    process.wait(timeout=5)
    return False


def _remove_tree_verified(path: Path, *, timeout: float = 5.0) -> None:
    """Remove a disposable runtime tree, retrying transient browser locks.

    The old harness used ignore_errors=True, which converted cleanup failures
    into a later, opaque isolation assertion. Keep cleanup failures local and
    diagnostic instead.
    """
    deadline = time.monotonic() + timeout
    last_error = None
    def clear_readonly(function, child, error):
        if os.name != 'nt' or not isinstance(error, PermissionError):
            raise error
        # copytree preserves Windows read-only attributes from checked-out site assets.
        os.chmod(child, stat.S_IWRITE)
        function(child)
    while path.exists():
        try:
            shutil.rmtree(path, onexc=clear_readonly)
        except OSError as error:
            last_error = error
        if not path.exists():
            return
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            detail = f": {last_error}" if last_error is not None else ""
            raise RuntimeError(f"Could not remove disposable browser tree {path}{detail}")
        time.sleep(min(0.1, remaining))


class BrowserSession:
    """Real localhost + headless Chromium session with a small CDP client."""

    def __init__(self, site: Path, label: str, *, instrument=True, service_worker=False, auto_navigate=True, native_incidents=False, origin_owner=None, supabase=None):
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
        self.browser_owner = None
        self.ws = None
        self.network_guard = None
        self.seq = 0
        self.events: list[dict] = []
        self.worker_events: list[dict] = []
        self.worker_states: list[dict] = []
        self.mode = "localhost"
        self.instrument = instrument
        self.native_incidents = native_incidents
        self.service_worker = service_worker
        self.auto_navigate = auto_navigate
        self.origin_owner = origin_owner
        self.supabase = supabase
        self.browser_generation = 0

    def __enter__(self):
        try:
            self._prepare_site()
            self._start_server()
            browser_preflight(self)
            self.network_guard = DenyProxy()
            self._start_browser()
            if self.auto_navigate:
                self._navigate()
                # HTML completion does not imply completion of asynchronous recovery.
                if self.instrument:
                    self.evaluate("appReady.then(()=>true)")
            return self
        except BaseException as error:
            self.__exit__(type(error), error, error.__traceback__)
            raise

    def __exit__(self, exc_type, exc, tb):
        if exc is not None:
            if self.service_worker:
                with contextlib.suppress(Exception):
                    evidence = self.save_worker_evidence('session-failure')
                    exc.add_note('Service Worker evidence: '+str(evidence))
            with contextlib.suppress(Exception):
                version, histograms = None, []
                with contextlib.suppress(Exception):
                    version = self.call('Browser.getVersion', timeout=2).get('result', {}).get('product')
                    raw = self.call('Browser.getHistograms', {'query': 'IndexedDB'}, timeout=2).get('result', {}).get('histograms', [])
                    histograms = [{**row, 'buckets': row.get('buckets', [])[:8]} for row in raw
                        if row.get('count') and re.search(r'Open|BackingStore|LevelDB|Init', row['name'])][:15]
                lines = []
                for log in sorted(self.tmp.glob('browser*.log')):
                    for line in log.read_text(encoding='utf8', errors='replace').splitlines():
                        if re.search(r'(?i)indexed.?db|leveldb|backing.?store|quota|os_crypt|ERROR', line):
                            line = re.sub(r'eyJ[A-Za-z0-9_.-]+|sb_(?:publishable|secret)_[A-Za-z0-9_-]+', '[redacted]', line)
                            # Never retain query credentials in a browser error.
                            line = re.sub(r'(https?://[^\s?]+)\?[^\s]+', r'\1?[redacted]', line)
                            lines.append(log.name+': '+line)
                files = []
                for path in (self.profile/'Default/IndexedDB').rglob('*'):
                    with contextlib.suppress(OSError):
                        if path.is_file():
                            files.append({'path': str(path.relative_to(self.profile)), 'bytes': path.stat().st_size})
                exc.add_note('Owned Chromium failure diagnostics: '+json.dumps({
                    'stderr': [line[-700:] for line in lines[-15:]], 'indexed_db_files': files[:30],
                    'network': _network_failure_diagnostics(self.events),
                    'proxy_denied': self.network_guard.denied[-20:] if self.network_guard else [],
                    'browser': version, 'indexed_db_histograms': histograms,
                    'disk_free_bytes': shutil.disk_usage(self.profile).free}))
        cleanup_error = None
        try:
            graceful_close = None
            if self.ws:
                graceful_close = lambda: self.call("Browser.close", timeout=3)
            try:
                _stop_browser_process(self.proc, graceful_close)
            finally:
                if self.browser_owner:
                    self.browser_owner.close()
        except Exception as error:
            cleanup_error = error
        finally:
            with contextlib.suppress(Exception):
                if self.ws:
                    self.ws.close()
        if self.httpd:
            with contextlib.suppress(Exception):
                self.httpd.shutdown()
                self.httpd.server_close()
        if self.http_thread:
            self.http_thread.join(timeout=2)
        if self.network_guard:
            self.network_guard.close()
        for path in (self.profile, self.tmp):
            try:
                _remove_tree_verified(path)
            except Exception as error:
                if cleanup_error is None:
                    cleanup_error = error
        if cleanup_error is not None:
            if exc is not None and hasattr(exc, "add_note"):
                exc.add_note(f"BrowserSession cleanup also failed: {cleanup_error}")
            elif exc_type is None:
                raise cleanup_error

    def _prepare_site(self):
        shutil.copytree(self.site, self.tmp / "site", dirs_exist_ok=True)
        prepared = self.tmp / "site"
        config = prepared / "supabase/config.js"
        config.parent.mkdir(parents=True, exist_ok=True)
        # Native PWA recovery exercises real failed requests. Keep these on the
        # test origin (allowed by the unchanged production CSP), never production.
        config_url = 'location.origin' if self.service_worker else "'https://example.invalid'"
        config.write_text(
            self.supabase.browser_config() if self.supabase is not None else sandbox_config(config_url),
            encoding="utf-8",
        )
        if self.supabase is not None:
            # Tighten only the disposable copy: no production or installed Bridge
            # endpoints remain in connect-src. Other production directives stay.
            import re
            headers = prepared / '_headers'
            original = headers.read_text(encoding='utf8')
            updated, count = re.subn(r"connect-src [^;]+;", "connect-src 'self' "+self.supabase.url+';', original)
            if count != 1:
                raise RuntimeError('the test copy has no unique connect-src directive')
            headers.write_text(updated, encoding='utf8')
        # Unrelated screen/ownership fixtures mock their own backend endpoints.
        # Supply the new background service with its own transport fixture so it
        # cannot consume those mocks or escape to example.invalid. The dedicated
        # incident suite opts into the original HTTP transport and registry code.
        incident_feature=prepared / 'assets/js/shared/sync-incident-feature.js'
        if incident_feature.exists() and not self.native_incidents and not self.service_worker:
            source=incident_feature.read_text(encoding='utf-8')
            needle='const registry=createSyncIncidentRegistry({request,accountScope});'
            if source.count(needle)!=1:
                raise RuntimeError('incident transport fixture composition changed')
            fixture=(ROOT / 'tests/fixtures/sync-incident-transport.js').read_text(encoding='utf-8')
            incident_feature.write_text(source.replace(needle,fixture),encoding='utf-8')
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
        if self.origin_owner is not None:
            browser_preflight(self.origin_owner)
            self.url = self.origin_owner.url
            return
        port = _free_port()
        directory = str(self.tmp / "site")
        handler = lambda *args, **kwargs: _QuietHandler(*args, directory=directory, **kwargs)
        self.httpd = _RuntimeHTTPServer(("127.0.0.1", port), handler)
        self.http_thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.http_thread.start()
        self.url = f"http://127.0.0.1:{port}/index.html"

    def _start_browser(self):
        if self.browser_owner:
            self.browser_owner.close()
            self.browser_owner = None
        allowed = browser_preflight(self)
        _seed_windows_profile(self.browser, self.profile)
        # Let Chromium bind its own port, then trust only the browser UUID it
        # publishes inside this private profile. A free IPv4 port alone cannot
        # identify a listener when Chromium uses the IPv6 loopback family.
        (self.profile/'DevToolsActivePort').unlink(missing_ok=True)
        devtools_port = 0
        args = _browser_args(self.browser, self.profile, devtools_port)
        if self.supabase is not None:
            args.extend(self.supabase.browser_arguments())
        args.extend(self.network_guard.arguments(allowed))
        browser_log = self.tmp / 'browser.log'
        if browser_log.exists():
            browser_log.rename(self.tmp/f'browser-{self.browser_generation:03d}.log')
        self.browser_generation += 1
        if os.name == 'nt':
            # Reuse the runner's gated Job Object owner. The Python child is
            # assigned before it can create Chromium or any of its descendants.
            # This avoids taskkill's racy enumeration of a changing browser tree.
            entry = self.tmp / 'owned-browser.py'
            entry.write_text('import subprocess\nraise SystemExit(subprocess.call('+repr(args)+', stdin=subprocess.DEVNULL))\n', encoding='utf8')
            self.browser_owner = SuiteProcess(entry, browser_log, cwd=ROOT)
            self.proc = self.browser_owner.proc
        else:
            with browser_log.open('w', encoding='utf-8') as log:
                self.proc = subprocess.Popen(args, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            # A fresh CI machine can need more than 10s for its first Chrome boot.
            # Poll readiness, fail immediately on process exit, and leave application
            # assertions/timeouts unchanged. Include stderr before temp cleanup.
            # Share one cold-start budget across publication, ownership and page
            # enumeration. Windows CI logged Chrome's first startup message at
            # 29s: a separate 30s publication cutoff discarded a live cold boot
            # despite the remaining overall budget. Never restart or accept a
            # different listener to compensate for slow publication.
            deadline = time.monotonic()+60
            devtools_port, browser_path = _wait_owned_devtools(self.profile, self.proc, timeout=max(.01, deadline-time.monotonic()))
            version = _wait_json(_devtools_urls(devtools_port, '/json/version'), timeout=max(.01, deadline-time.monotonic()),
                                 process=self.proc, expected_browser_path=browser_path)
            endpoint = urllib.parse.urlsplit(version['webSocketDebuggerUrl'])
            if endpoint.hostname not in ('127.0.0.1', '::1', 'localhost') or endpoint.port != devtools_port:
                raise RuntimeError('owned DevTools endpoint escaped loopback')
            pages = _wait_json(f'http://{endpoint.netloc}/json/list', timeout=max(.01, deadline-time.monotonic()), process=self.proc)
        except Exception as error:
            diagnostics = browser_log.read_text(encoding='utf-8', errors='replace')[-8000:]
            raise RuntimeError(f"{error}\nChrome startup log:\n{diagnostics}") from error
        page = next((item for item in pages if item.get("type") == "page"), None)
        if not page:
            raise RuntimeError("Chrome DevTools did not expose a page target")
        self.devtools_url = f'http://{urllib.parse.urlsplit(page["webSocketDebuggerUrl"]).netloc}'
        self.ws = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=5)
        self.call("Runtime.enable")
        self.call("Page.enable")
        self.call("Log.enable")
        self.call("Network.enable")
        if self.service_worker:
            response = self.call('ServiceWorker.enable')
            if response.get('error'):
                raise RuntimeError('Service Worker diagnostics unavailable: '+str(response['error']))
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

    def restart_process(self, *, crash=False, navigate=True):
        """Restart this owned browser, retaining its actual on-disk profile."""
        if self.proc is None or self.proc.poll() is not None:
            raise RuntimeError('no live owned browser to restart')
        previous_pid = self.proc.pid
        if crash:
            if os.name == 'nt':
                if self.browser_owner is None:
                    raise RuntimeError('hard restart requires its owned Windows job')
                self.browser_owner.close()
                self.browser_owner = None
            else:
                os.killpg(previous_pid, signal.SIGKILL)
            self.proc.wait(timeout=10)
        else:
            if not _stop_browser_process(self.proc, lambda: self.call('Browser.close', timeout=3), graceful_timeout=30):
                raise RuntimeError('owned Chromium required forced termination during a graceful restart')
            if self.browser_owner:
                # Root exit alone does not prove storage utility processes have
                # finished. Starting again must not force-kill late flushes.
                self.browser_owner.job.wait_empty(timeout=30)
        self.ws.close()
        self.events = []
        self._start_browser()
        # A hard-killed profile needs crash recovery plus a cold module graph.
        if navigate:
            self._navigate(timeout=30 if crash else None)
            if self.instrument:
                self.evaluate('appReady.then(()=>true)')
        return {'previous_pid': previous_pid, 'new_pid': self.proc.pid, 'hard_process_failure': crash}

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
                self._record_event(message)
        finally:
            if timeout is not None:
                self.ws.settimeout(previous_timeout)

    def _navigate(self, *, timeout=None):
        # Functional loading of hundreds of cold ESM files outlasted 10s on
        # Windows CI, even before crash injection. Startup-performance probes
        # measure elapsed readiness separately; this is a transport deadline.
        if timeout is None:
            timeout = 30 if os.name == 'nt' else 10
        end = time.monotonic() + timeout
        result = self.call("Page.navigate", {"url": self.url}, timeout=timeout)
        nav = result.get("result", {})
        if nav.get("errorText"):
            raise RuntimeError('Native ESM runtime requires localhost navigation: '+nav['errorText'])
        last_error = None
        state = None
        while time.monotonic() < end:
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
        resources = None
        # Optional diagnostics must never replace the original load failure.
        with contextlib.suppress(Exception):
            resources = self.call('Runtime.evaluate', {'expression': "performance.getEntriesByType('resource').slice(-8).map(r=>({path:new URL(r.name).pathname,duration:r.duration,responseEnd:r.responseEnd}))", 'returnByValue': True}, timeout=5).get('result',{}).get('result',{}).get('value')
        raise RuntimeError(f"{self.label}: page did not finish loading at {self.url}; state: {state}; resources: {resources}; last error: {last_error}; browser errors: {self.drain_serious_errors()}")

    def _record_event(self, message):
        self.events.append(message)
        method = message.get('method', '')
        if self.service_worker and (method.startswith('ServiceWorker.') or method == 'Network.loadingFailed'
                                   or method == 'Network.responseReceived' and message.get('params', {}).get('response', {}).get('status', 0) >= 400):
            # Only disposable localhost evidence; redact queries before persisting.
            serialized = json.dumps(message)
            serialized = re.sub(r'(https?://[^\s"?]+)\?[^\s"]*', r'\1?[redacted]', serialized)
            self.worker_events.append({'observed_at_unix': time.time(), 'generation': self.browser_generation,
                                       'event': json.loads(serialized)})
            self.worker_events = self.worker_events[-200:]

    def worker_state(self):
        state = self.evaluate("""(async()=>{
          const registration=await navigator.serviceWorker.getRegistration();
          const worker=value=>value?{state:value.state,scriptURL:value.scriptURL}:null;
          return {registration:registration?.scope||null,controller:worker(navigator.serviceWorker.controller),
            active:worker(registration?.active),installing:worker(registration?.installing),waiting:worker(registration?.waiting)};
        })()""", timeout=5)
        if not self.worker_states or state != self.worker_states[-1]['state']:
            self.worker_states.append({'observed_at_unix': time.time(), 'generation': self.browser_generation, 'state': state})
            self.worker_states = self.worker_states[-100:]
        return state

    def save_worker_evidence(self, reason, *, started=None):
        cache = None
        with contextlib.suppress(Exception):
            self.worker_state()
        with contextlib.suppress(Exception):
            cache = self.evaluate("""(async()=>{
              const result=[];for(const name of await caches.keys()){
                const cache=await caches.open(name),keys=await cache.keys();
                result.push({name,entries:keys.length,paths:keys.slice(-8).map(key=>new URL(key.url).pathname)});
              }return result;
            })()""", timeout=2)
        directory = Path(os.environ.get('NETUNIM_SUITE_REPORT_DIR', ROOT/'.work/service-worker'))
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / (re.sub(r'[^A-Za-z0-9_-]', '_', self.label)+f'-worker-{os.getpid()}-{time.time_ns()}.json')
        path.write_text(json.dumps({'reason': reason, 'observed_at_unix': time.time(),
            'elapsed_seconds': time.monotonic()-started if started is not None else None,
            'browser_generation': self.browser_generation, 'states': self.worker_states,
            'events': self.worker_events, 'cache': cache}, indent=2), encoding='utf-8')
        return path

    def evaluate(self, expression: str, *, await_promise: bool = True, timeout: float | None = None, user_gesture: bool = False):
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
                "userGesture": user_gesture,
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
                self._record_event(json.loads(self.ws.recv()))
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
