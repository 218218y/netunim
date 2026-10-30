"""Release identity is a function of every published byte, including lazy vendors."""
import hashlib
from pathlib import Path
import re
from build_validation import require


def inventory(site: Path) -> dict[str, str]:
    require(site.is_dir() and not site.is_symlink() and not getattr(site, 'is_junction', lambda: False)(), f'Invalid payload directory: {site}')
    found = {}
    for path in sorted(site.rglob('*'), key=lambda path: path.relative_to(site).as_posix()):
        require(not path.is_symlink() and not getattr(path, 'is_junction', lambda: False)(), f'Linked public asset: {path}')
        if path.is_file():
            found[path.relative_to(site).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
    return found


def release_id(site: Path, app: str) -> str:
    digest = hashlib.sha256()
    for name in inventory(site):
        content = (site / name).read_bytes()
        if name == '_headers':
            content = re.sub(rb'^  X-Netunim-Release: [^\n]+\n?', b'', content, flags=re.M)
        elif name == 'service-worker.js':
            content = re.sub(rb"const CACHE='[^']+';", b"const CACHE='derived';", content)
        # Length delimiters prevent ambiguity between paths and payloads.
        for value in (name.encode('utf-8'), content):
            digest.update(len(value).to_bytes(8, 'big'))
            digest.update(value)
    return f'{app}-app-shell-build-{digest.hexdigest()[:24]}'


def shell_paths(site: Path) -> list[str]:
    return ['./'] + ['./' + name for name in inventory(site)
                     if name not in ('_headers', 'service-worker.js') and not name.startswith('assets/vendor/')]
