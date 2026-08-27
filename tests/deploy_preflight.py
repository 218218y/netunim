"""Read-only public-root safety gate. Never contacts Cloudflare or Supabase."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
ALLOWED={'.html','.css','.js','.webmanifest','.ico','.png'}
BLOCKED_DIRS={'.git','.wrangler','node_modules','functions','data','backups'}
for label in ('kupa','orders'):
    site=ROOT/f'netunim-{label}/site'
    for file in site.rglob('*'):
        assert not BLOCKED_DIRS.intersection(file.relative_to(site).parts), f'{label}: blocked public directory {file}'
        if not file.is_file():
            continue
        assert file.name=='_headers' or file.suffix in ALLOWED, f'{label}: unexpected deployable file {file}'
        assert file.stat().st_size<=25*1024*1024, f'{label}: oversized public asset {file}'
        if file.suffix in {'.js','.html','.css','.webmanifest'}:
            source=file.read_text(encoding='utf-8')
            assert not re.search(r'sb_secret_|SUPABASE_SERVICE_ROLE_KEY|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY',source,re.I), f'{label}: secret marker in {file}'
            assert not re.search(r'eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+',source),f'{label}: JWT embedded in {file}'
    print('PASS',label,'read-only deploy preflight: public assets only, no secrets or raw business data files')
