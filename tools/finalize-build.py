"""Generate the release from final outputs, never from the source module tree."""
import json
from pathlib import Path
import re
import subprocess
import sys
from build_release import inventory, release_id, shell_paths

ROOT = Path(__file__).resolve().parents[1]
app = sys.argv[1]
if app not in ('orders', 'kupa'):
    raise SystemExit('Unknown application')
site = ROOT / 'dist' / app
worker = site / 'service-worker.js'
source, count = re.subn(r'(const\s+SHELL\s*=\s*)\[[\s\S]*?\]',
                        lambda match: match[1] + json.dumps(shell_paths(site), ensure_ascii=True),
                        worker.read_text(encoding='utf-8'))
assert count == 1, 'Missing SHELL declaration'
worker.write_bytes(source.encode('utf-8'))
headers = site / '_headers'
header = headers.read_text(encoding='utf-8')
header += '\n/assets/build/*\n  Cache-Control: public, max-age=31536000, immutable\n'
headers.write_bytes(header.encode('utf-8'))
release = release_id(site, app)
worker.write_bytes(re.sub(r"const CACHE='[^']+';", f"const CACHE='{release}';", source).encode('utf-8'))
headers.write_bytes(re.sub(r'^  X-Netunim-Release: [^\n]+', '  X-Netunim-Release: ' + release, header, flags=re.M).encode('utf-8'))
commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
manifest = {'schema': 1, 'app': app, 'commit': commit, 'release': release, 'files': inventory(site)}
(ROOT / '.work/production' / app / 'manifest.json').write_bytes((json.dumps(manifest, indent=2) + '\n').encode())
subprocess.run([sys.executable, str(ROOT/'tools/verify-build.py'), app], cwd=ROOT, check=True)
