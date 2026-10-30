"""Read-only production payload gate; never trusts source paths in place of outputs."""
import argparse
import json
from pathlib import Path
import re
import subprocess
import sys
from build_release import inventory, release_id, shell_paths
from public_asset_names import asset_name_issue
from build_validation import require

ROOT = Path(__file__).resolve().parents[1]


def verify(app, site=None, manifest_path=None):
    require(app in ('orders', 'kupa'), 'Unknown application')
    if site is None:
        require(not (ROOT/'.work/build-locks'/app).exists(), 'Build is in progress or requires recovery')
    site = site or ROOT / 'dist' / app
    manifest_path = manifest_path or ROOT / '.work/production' / app / 'manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    files = inventory(site)
    require(files == manifest['files'], 'Published files differ from build manifest')
    require(0 < len(files) <= 20000, 'Cloudflare file count limit exceeded')
    release = release_id(site, app)
    require(release == manifest['release'], 'Release digest mismatch')
    worker = (site/'service-worker.js').read_text(encoding='utf-8')
    require(f"const CACHE='{release}';" in worker, 'Worker release mismatch')
    shell = json.loads(re.search(r'const SHELL=(\[[\s\S]*?\]);', worker)[1])
    require(shell == shell_paths(site), 'Incomplete offline shell')
    headers = (site/'_headers').read_text(encoding='utf-8')
    require(f'  X-Netunim-Release: {release}\n' in headers, 'Header release mismatch')
    require("script-src 'self'" in headers and "worker-src 'self'" in headers, 'Missing CSP')
    require("'unsafe-eval'" not in headers and "script-src 'self' 'unsafe-inline'" not in headers, 'Unsafe script CSP')
    require("connect-src 'self'" in headers and 'X-Frame-Options: DENY' in headers, 'Missing security headers')
    expected_headers = (ROOT/f'netunim-{app}/site/_headers').read_text(encoding='utf-8')
    expected_headers = re.sub(r'^  X-Netunim-Release: [^\n]+', '  X-Netunim-Release: '+release, expected_headers, flags=re.M)
    expected_headers += '\n/assets/build/*\n  Cache-Control: public, max-age=31536000, immutable\n'
    require(headers == expected_headers, 'Build changed source security/cache policy')
    for name in files:
        file = site/name
        require(asset_name_issue(name) is None, f'Unapproved public name: {name}')
        require(file.stat().st_size <= 25*1024*1024, f'Oversized file: {name}')
        require(not set(Path(name).parts) & {'.git', '.wrangler', 'node_modules', 'data', 'backups', 'functions'}, name)
        vendor = name.startswith('assets/vendor/')
        require(not name.endswith('.map'), 'Public sourcemap')
        if vendor:
            require(file.read_bytes() == (ROOT/f'netunim-{app}/site'/name).read_bytes(), f'Vendor changed: {name}')
        else:
            require(name == '_headers' or file.suffix in {'.js', '.css', '.html', '.webmanifest', '.ico', '.png'}, f'Unexpected public file: {name}')
        if file.suffix in {'.js', '.mjs', '.html', '.css', '.webmanifest'}:
            content = file.read_text(encoding='utf-8')
            require(not re.search(r'sb_secret_|SUPABASE_SERVICE_ROLE_KEY|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', content, re.I), f'Secret in {name}')
    for page in ('index.html', 'reset-local.html'):
        source = (site/page).read_text(encoding='utf-8')
        for reference in re.findall(r'(?:src|href)="\./([^"#?]+)"', source):
            require(reference in files, f'Missing {page} resource: {reference}')
        require(re.search(r'<script type="module" src="\./assets/build/[^\"]+\.js"', source), page)
    require('publishableKey' in (site/'supabase/config.js').read_text(encoding='utf-8'), 'Build validation failed')
    vendor_root = ROOT/f'netunim-{app}/site/assets/vendor'
    expected_vendor = {'assets/vendor/' + file.relative_to(vendor_root).as_posix()
                       for file in vendor_root.rglob('*') if file.is_file() and file.suffix != '.map'}
    require(expected_vendor == {name for name in files if name.startswith('assets/vendor/')}, 'Incomplete vendor runtime')
    subprocess.run([sys.executable, str(ROOT/'tools/public_js_guard.py'), str(site)], check=True)
    print(f'PASS {app}: verified production build, {len(files)} files, {len(shell)} offline resources, {release}', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('apps', nargs='*', choices=('orders', 'kupa'))
    parser.add_argument('--site', type=Path)
    parser.add_argument('--manifest', type=Path)
    args = parser.parse_args()
    require((args.site is None) == (args.manifest is None), 'Site and manifest must be selected together')
    require(not args.site or len(args.apps) == 1, 'Custom payload validation requires exactly one app')
    for app in args.apps or ('orders', 'kupa'):
        verify(app, args.site, args.manifest)
