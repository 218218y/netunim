"""Read-only production payload gate; never trusts source paths in place of outputs."""
import json
from pathlib import Path
import re
import subprocess
import sys
from build_release import inventory, release_id, shell_paths
from public_asset_names import asset_name_issue

ROOT = Path(__file__).resolve().parents[1]


def verify(app):
    assert app in ('orders', 'kupa'), 'Unknown application'
    site = ROOT / 'dist' / app
    manifest = json.loads((ROOT / '.work/production' / app / 'manifest.json').read_text(encoding='utf-8'))
    files = inventory(site)
    assert files == manifest['files'], 'Published files differ from build manifest'
    assert 0 < len(files) <= 20000, 'Cloudflare file count limit exceeded'
    release = release_id(site, app)
    assert release == manifest['release'], 'Release digest mismatch'
    worker = (site/'service-worker.js').read_text(encoding='utf-8')
    assert f"const CACHE='{release}';" in worker, 'Worker release mismatch'
    shell = json.loads(re.search(r'const SHELL=(\[[\s\S]*?\]);', worker)[1])
    assert shell == shell_paths(site), 'Incomplete offline shell'
    headers = (site/'_headers').read_text(encoding='utf-8')
    assert f'  X-Netunim-Release: {release}\n' in headers, 'Header release mismatch'
    assert "script-src 'self'" in headers and "worker-src 'self'" in headers, 'Missing CSP'
    assert "'unsafe-eval'" not in headers and "script-src 'self' 'unsafe-inline'" not in headers, 'Unsafe script CSP'
    assert "connect-src 'self'" in headers and 'X-Frame-Options: DENY' in headers, 'Missing security headers'
    for name in files:
        file = site/name
        assert asset_name_issue(name) is None, f'Unapproved public name: {name}'
        assert file.stat().st_size <= 25*1024*1024, f'Oversized file: {name}'
        assert not set(Path(name).parts) & {'.git', '.wrangler', 'node_modules', 'data', 'backups', 'functions'}, name
        vendor = name.startswith('assets/vendor/')
        assert not name.endswith('.map'), 'Public sourcemap'
        if vendor:
            assert file.read_bytes() == (ROOT/f'netunim-{app}/site'/name).read_bytes(), f'Vendor changed: {name}'
        else:
            assert name == '_headers' or file.suffix in {'.js', '.css', '.html', '.webmanifest', '.ico', '.png'}, f'Unexpected public file: {name}'
        if file.suffix in {'.js', '.mjs', '.html', '.css', '.webmanifest'}:
            content = file.read_text(encoding='utf-8')
            assert not re.search(r'sb_secret_|SUPABASE_SERVICE_ROLE_KEY|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', content, re.I), f'Secret in {name}'
    for page in ('index.html', 'reset-local.html'):
        source = (site/page).read_text(encoding='utf-8')
        for reference in re.findall(r'(?:src|href)="\./([^"#?]+)"', source):
            assert reference in files, f'Missing {page} resource: {reference}'
        assert re.search(r'<script type="module" src="\./assets/build/[^\"]+\.js"', source), page
    assert 'publishableKey' in (site/'supabase/config.js').read_text(encoding='utf-8')
    vendor_root = ROOT/f'netunim-{app}/site/assets/vendor'
    expected_vendor = {'assets/vendor/' + file.relative_to(vendor_root).as_posix()
                       for file in vendor_root.rglob('*') if file.is_file() and file.suffix != '.map'}
    assert expected_vendor == {name for name in files if name.startswith('assets/vendor/')}, 'Incomplete vendor runtime'
    subprocess.run([sys.executable, str(ROOT/'tools/public_js_guard.py'), str(site)], check=True)
    print(f'PASS {app}: verified production build, {len(files)} files, {len(shell)} offline resources, {release}', flush=True)


if __name__ == '__main__':
    for app in sys.argv[1:] or ('orders', 'kupa'):
        verify(app)
