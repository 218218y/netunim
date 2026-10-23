"""Fail-closed guards for disposable tests, never production configuration."""
from pathlib import Path
import http.server
import hashlib
import json
import os
import subprocess
import tempfile
import threading
import urllib.parse


def write_evidence(name, scenarios):
    root = Path(__file__).resolve().parents[1]
    def git(*args):
        return subprocess.check_output(['git', *args], cwd=root, text=True, encoding='utf8').strip()
    sources = ['tests/acceptance_safety.py', 'tests/browser_harness.py', 'tests/isolated_sync_postgres.py']
    report = {'source_sha': git('rev-parse', 'HEAD'), 'source_tree': git('rev-parse', 'HEAD^{tree}'),
              'dirty': bool(git('status', '--porcelain', '--untracked-files=no')),
              'platform': os.name, 'synthetic_only': True,
              'harness_sha256': {name: hashlib.sha256((root/name).read_bytes()).hexdigest() for name in sources},
              'scenarios': scenarios}
    directory = Path(os.environ.get('NETUNIM_SUITE_REPORT_DIR', root/'.work/acceptance'))
    directory.mkdir(parents=True, exist_ok=True)
    (directory/(name+'.json')).write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf8')
    return report


def temporary_root(path, prefix):
    supplied = Path(path).absolute()
    root = supplied.resolve()
    if supplied.is_symlink() or root.parent != Path(tempfile.gettempdir()).resolve() or not root.name.startswith(prefix):
        raise RuntimeError('unowned test root')
    return root


def contained(root, path):
    root, path = Path(root).resolve(), Path(path).resolve()
    if path == root or not path.is_relative_to(root):
        raise RuntimeError('test storage escapes its owned root')
    return path


def browser_preflight(session):
    root = temporary_root(session.tmp, 'netunim-')
    temporary_root(session.profile, 'netunim-')
    contained(root, session.downloads)
    site = contained(root, root / 'site')
    config = contained(root, site / 'supabase/config.js')
    expected = 'location.origin' if session.service_worker else "'https://example.invalid'"
    stack = getattr(session, 'supabase', None)
    config_source = sandbox_config(expected)
    if stack is not None:
        from isolated_supabase import IsolatedSupabase
        if not isinstance(stack, IsolatedSupabase):
            raise RuntimeError('unrecognized isolated Supabase owner')
        config_source = stack.browser_config()
    if config.read_text(encoding='utf-8') != config_source:
        raise RuntimeError('test Supabase configuration is not the isolated fixture')
    url = urllib.parse.urlsplit(session.url)
    if url.scheme != 'http' or url.hostname != '127.0.0.1' or not url.port or url.port in (8765, 8766) or url.username or url.password:
        raise RuntimeError('test origin is not an ephemeral loopback listener')
    listener = session.origin_owner or session
    if listener.httpd is None or listener.httpd.server_address != ('127.0.0.1', url.port):
        raise RuntimeError('test origin does not match its owned listener')
    allowed = f'127.0.0.1:{url.port}'
    if stack is not None:
        allowed += f';127.0.0.1:{stack.api_port}'
    return allowed


def sandbox_config(url):
    return "export const supabaseConfig=Object.freeze({url:" + url + ",publishableKey:'test'});\n"


def postgres_environment():
    # PGHOSTADDR overrides the network destination even with psql -h. Service,
    # auth, SSL and future libpq settings must not leak from a working account.
    return {**{key: value for key, value in os.environ.items() if not key.upper().startswith('PG')},
            'PGCLIENTENCODING': 'UTF8', 'PGPASSFILE': os.devnull}


class DenyProxy:
    """A real non-forwarding proxy. Chromium bypasses only its owned test port.

    Explicit <-loopback> removes Chrome's implicit bypass for installed Bridges.
    This applies to fetch, navigations, workers and WebSocket handshakes, even if
    application code or CSP accidentally retains a production endpoint.
    """
    def __init__(self):
        self.denied = []
        denied = self.denied

        class Handler(http.server.BaseHTTPRequestHandler):
            def reject(self):
                # Keep only origin-level evidence, never credentials/query data.
                target = urllib.parse.urlsplit(self.path if '://' in self.path else 'https://' + self.path)
                denied.append({'method': self.command, 'host': target.hostname, 'port': target.port})
                self.send_response(403)
                self.send_header('Content-Length', '0')
                self.end_headers()

            do_CONNECT = do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = do_OPTIONS = do_HEAD = reject

            def log_message(self, *_args):
                pass

        self.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def arguments(self, allowed):
        return [f'--proxy-server=http://127.0.0.1:{self.server.server_port}',
                f'--proxy-bypass-list=<-loopback>;{allowed}',
                '--disable-quic', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp']

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
