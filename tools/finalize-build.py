"""Generate the release from final outputs, never from the source module tree."""
import json
from pathlib import Path
import re
import subprocess
import sys
from build_release import inventory, release_id, shell_paths, vendor_hashes
from build_validation import require
from build_headers import production_headers

ROOT = Path(__file__).resolve().parents[1]
app = sys.argv[1]
if app not in ('orders', 'kupa'):
    raise SystemExit('Unknown application')
site = Path(sys.argv[2]).resolve()
private = Path(sys.argv[3]).resolve()
staging = ROOT / '.work/build-staging'
require(site.parent.parent == staging and site.name == 'site' and site.parent.name.startswith(app+'-'), 'Invalid build staging directory')
require(private.parent == site.parent and private.name == 'private', 'Invalid private staging directory')
worker = site / 'service-worker.js'
source, count = re.subn(r'(const\s+SHELL\s*=\s*)\[[\s\S]*?\]',
                        lambda match: match[1] + json.dumps(shell_paths(site), ensure_ascii=True),
                        worker.read_text(encoding='utf-8'))
require(count == 1, 'Missing SHELL declaration')
source, count = re.subn(r'const VENDOR_HASHES=\{[\s\S]*?\};',
                        lambda _: 'const VENDOR_HASHES='+json.dumps(vendor_hashes(site), separators=(',', ':'))+';', source)
require(count == 1, 'Missing vendor integrity declaration')
worker.write_bytes(source.encode('utf-8'))
headers = site / '_headers'
header = production_headers(headers.read_text(encoding='utf-8'), inventory(site))
headers.write_bytes(header.encode('utf-8'))
release = release_id(site, app)
worker.write_bytes(re.sub(r"const CACHE='[^']+';", f"const CACHE='{release}';", source).encode('utf-8'))
headers.write_bytes(re.sub(r'^  X-Netunim-Release: [^\n]+', '  X-Netunim-Release: ' + release, header, flags=re.M).encode('utf-8'))
commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
manifest = {'schema': 1, 'app': app, 'commit': commit, 'release': release, 'files': inventory(site)}
(private/'manifest.json').write_bytes((json.dumps(manifest, indent=2) + '\n').encode())
subprocess.run([sys.executable, str(ROOT/'tools/verify-build.py'), app, '--site', str(site), '--manifest', str(private/'manifest.json')], cwd=ROOT, check=True)
