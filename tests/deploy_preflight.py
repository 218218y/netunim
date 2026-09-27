"""Read-only public-root safety gate. Never contacts Cloudflare or Supabase."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
ALLOWED={'.html','.css','.js','.webmanifest','.ico','.png'}
VENDOR_ALLOWED={'.mjs','.js','.css','.bcmap','.wasm','.ttf','.pfb','.svg','.gif','.icc','.map','.txt'}
VENDOR_LICENSE_NAMES={'LICENSE','LICENSE_LIBERATION','LICENSE_FOXIT','LICENSE_PDFJS_QCMS','LICENSE_OPENJPEG','LICENSE_PDFJS_OPENJPEG','LICENSE_QCMS','LICENSE_PDFJS_JBIG2','LICENSE_JBIG2'}
BLOCKED_DIRS={'.git','.wrangler','node_modules','functions','data','backups'}
for label in ('kupa','orders'):
    site=ROOT/f'netunim-{label}/site'
    for file in site.rglob('*'):
        assert not BLOCKED_DIRS.intersection(file.relative_to(site).parts), f'{label}: blocked public directory {file}'
        if not file.is_file():
            continue
        relative=file.relative_to(site)
        vendor_pdfjs=relative.parts[:3]==('assets','vendor','pdfjs')
        allowed_vendor=vendor_pdfjs and (file.suffix.lower() in VENDOR_ALLOWED or file.name in VENDOR_LICENSE_NAMES)
        assert file.name=='_headers' or file.suffix in ALLOWED or allowed_vendor, f'{label}: unexpected deployable file {file}'
        assert file.stat().st_size<=25*1024*1024, f'{label}: oversized public asset {file}'
        if file.suffix in {'.js','.mjs','.html','.css','.webmanifest'}:
            source=file.read_text(encoding='utf-8')
            assert not re.search(r'sb_secret_|SUPABASE_SERVICE_ROLE_KEY|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY',source,re.I), f'{label}: secret marker in {file}'
            assert not re.search(r'eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+',source),f'{label}: JWT embedded in {file}'
    print('PASS',label,'read-only deploy preflight: public assets only, no secrets or raw business data files')
