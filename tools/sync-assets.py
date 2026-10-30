"""Synchronize deterministic public app-shell assets.

The normal mode updates the working tree, ``--check`` is the read-only CI gate,
and ``--staged`` updates the Git index from the proposed commit snapshot.  The
last mode exists for the pre-commit hook: generated files are committed without
accidentally pulling unrelated working-tree changes into a partial commit.
"""
from __future__ import annotations

from pathlib import Path, PurePosixPath
from typing import NamedTuple
import argparse
import hashlib
import json
import re
import subprocess
import sys

# Also loaded through importlib by the staged-snapshot contract suite.
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from public_asset_names import asset_name_violations

ROOT = Path(__file__).resolve().parents[1]
APPS = ('kupa', 'orders')
BRIDGE_SHARED_SOURCES = {
    'shared/document-text-search.js': 'netunim-orders/document-bridge/document-text-search.mjs',
    'shared/bank-money-value.js': 'netunim-kupa/bank-bridge/bank-money-value.mjs',
    'shared/credit-transaction-evidence.js': 'netunim-kupa/bank-bridge/credit-transaction-evidence.mjs',
    'shared/observation-time.js': 'netunim-kupa/bank-bridge/observation-time.mjs',
    'shared/credit-cooldown-policy.js': 'netunim-kupa/bank-bridge/credit-cooldown-policy.mjs',
}
TAX_SHARED_ROOT = PurePosixPath('shared/tax-calculator')
DOCUMENT_SEARCH_SHARED_ROOT = PurePosixPath('shared/document-search')
DOCUMENT_SEARCH_TARGET_ROOT = PurePosixPath('assets/js')
TEXT_ASSET_SUFFIXES = {'.html', '.css', '.js', '.mjs', '.txt', '.webmanifest'}


def asset_hash_bytes(path: str | PurePosixPath, data: bytes | None = None) -> bytes:
    """Ignore checkout newline conventions, not real content or binary bytes."""
    if data is None:
        file_path = Path(path)
        data = file_path.read_bytes()
        name = file_path.name
        suffix = file_path.suffix.lower()
    else:
        file_path = PurePosixPath(path)
        name = file_path.name
        suffix = file_path.suffix.lower()
    if suffix in TEXT_ASSET_SUFFIXES or name == '_headers':
        return data.replace(b'\r\n', b'\n').replace(b'\r', b'\n')
    return data


class Change(NamedTuple):
    path: str
    content: bytes | None
    message: str


class WorktreeSnapshot:
    def __init__(self, root: Path):
        self.root = root
        self.public_files = {
            path.relative_to(root).as_posix()
            for label in APPS for path in (root / f'netunim-{label}/site').rglob('*') if path.is_file()
        }
        paths = list((root / 'shared').glob('*.js')) + list((root / 'shared').glob('*.css'))
        paths.extend(root / target for target in BRIDGE_SHARED_SOURCES.values() if (root / target).is_file())
        document_search = root / DOCUMENT_SEARCH_SHARED_ROOT
        if document_search.is_dir():
            paths.extend(path for path in document_search.rglob('*.js') if path.is_file())
        tax_root = root / TAX_SHARED_ROOT
        if tax_root.is_dir():
            paths.extend(path for path in tax_root.rglob('*') if path.is_file() and path.suffix in {'.js', '.css'})
        fixed = (
            'service-worker.js', 'index.html', 'assets/app.css', 'manifest.webmanifest',
            'supabase/config.js', 'favicon.ico', 'favicon-16x16.png', 'favicon-32x32.png',
            'apple-touch-icon.png', 'android-chrome-192x192.png', 'android-chrome-512x512.png', '_headers',
        )
        for label in APPS:
            site = root / f'netunim-{label}/site'
            paths.extend((site / 'assets').rglob('*.js'))
            paths.extend((site / 'assets').rglob('*.css'))
            paths.extend((site / 'assets/js/shared').rglob('*.css'))
            vendor = site / 'assets/vendor'
            if vendor.is_dir():
                paths.extend(path for path in vendor.rglob('*') if path.is_file())
            paths.extend(site / relative for relative in fixed)
        self.files = {path.relative_to(root).as_posix() for path in paths if path.is_file()}

    def read(self, path: str) -> bytes:
        return (self.root / path).read_bytes()


class IndexSnapshot:
    def __init__(self, root: Path):
        self.root = root
        result = self.git('ls-files', '--stage', '-z', stdout=subprocess.PIPE)
        self.objects: dict[str, bytes] = {}
        for entry in result.stdout.split(b'\0'):
            if not entry:
                continue
            metadata, path = entry.split(b'\t', 1)
            _, oid, stage = metadata.split()
            if stage != b'0':
                raise ValueError('asset synchronization requires a resolved Git index')
            self.objects[path.decode('utf-8')] = oid
        self.files = set(self.objects)
        self.contents: dict[bytes, bytes] = {}
        self.reader = None

    def __enter__(self):
        # Object IDs capture the proposed commit independently of later index or
        # worktree edits. One reader serves every asset; shared blobs are reused.
        self.reader = subprocess.Popen(
            ['git', 'cat-file', '--batch'], cwd=self.root,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        )
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        reader = self.reader
        if reader is None:
            return
        try:
            try:
                reader.stdin.close()
            except BrokenPipeError:
                pass
            try:
                result = reader.wait(timeout=10)
            except subprocess.TimeoutExpired:
                reader.kill()
                reader.wait()
                raise OSError('Git asset reader did not close')
            if result and exc_type is None:
                raise subprocess.CalledProcessError(result, reader.args)
        finally:
            reader.stdout.close()
            self.reader = None

    def git(self, *args: str, **kwargs) -> subprocess.CompletedProcess:
        return subprocess.run(
            ['git', *args], cwd=self.root, check=True, stderr=subprocess.PIPE, **kwargs
        )

    def read(self, path: str) -> bytes:
        if path not in self.files:
            raise FileNotFoundError(f'{path} is not present in the proposed commit')
        oid = self.objects[path]
        if oid not in self.contents:
            if self.reader is None:
                raise ValueError('Git asset snapshot must be read inside its context')
            self.reader.stdin.write(oid + b'\n')
            self.reader.stdin.flush()
            header = self.reader.stdout.readline().split()
            if len(header) != 3 or header[:2] != [oid, b'blob']:
                raise ValueError('Git asset reader returned an invalid blob header')
            size = int(header[2])
            if size < 0:
                raise ValueError('Git asset reader returned an invalid blob size')
            content = self.reader.stdout.read(size)
            if len(content) != size or self.reader.stdout.read(1) != b'\n':
                raise ValueError('Git asset reader returned a truncated blob')
            self.contents[oid] = content
        return self.contents[oid]

    def apply(self, changes: list[Change]) -> None:
        """Write all object blobs first, then update the index under one lock."""
        records = bytearray()
        for change in changes:
            encoded_path = change.path.encode('utf-8')
            if change.content is None:
                records.extend(b'0 ' + (b'0' * 40) + b'\t' + encoded_path + b'\0')
                continue
            oid = self.git('hash-object', '-w', '--stdin', input=change.content, stdout=subprocess.PIPE).stdout.strip()
            records.extend(b'100644 ' + oid + b'\t' + encoded_path + b'\0')
        if records:
            self.git('-c', 'core.quotepath=false', 'update-index', '-z', '--index-info', input=bytes(records))


class OverlaySnapshot:
    def __init__(self, base: WorktreeSnapshot | IndexSnapshot, changes: list[Change]):
        self.base = base
        self.overlay = {change.path: change.content for change in changes}
        self.files = (base.files - {path for path, content in self.overlay.items() if content is None}) | {
            path for path, content in self.overlay.items() if content is not None
        }

    def read(self, path: str) -> bytes:
        if path in self.overlay:
            content = self.overlay[path]
            if content is None:
                raise FileNotFoundError(path)
            return content
        return self.base.read(path)


def direct_javascript_files(files: set[str], directory: str) -> set[str]:
    parent = PurePosixPath(directory)
    return {
        path for path in files
        if PurePosixPath(path).parent == parent and PurePosixPath(path).suffix.lower() == '.js'
    }


def render_worker(label: str, snapshot: OverlaySnapshot, worker_path: str) -> bytes:
    raw_source = snapshot.read(worker_path)
    source = raw_source.decode('utf-8').replace('\r\n', '\n').replace('\r', '\n')
    site = f'netunim-{label}/site'
    asset_prefix = f'{site}/assets/'
    # Third-party runtimes are intentionally lazy.  Pre-caching the complete
    # PDF.js vendor tree made every service-worker install download hundreds of
    # files before the user had ever opened a PDF.  Runtime assets are cached on
    # first use by the worker instead of being part of the installation shell.
    assets = sorted(
        path for path in snapshot.files
        if path.startswith(asset_prefix) and path.lower().endswith(('.js', '.css'))
        and not path.startswith(asset_prefix+'vendor/')
    )
    shell = ['./', './index.html', './reset-local.html']
    shell += ['./' + PurePosixPath(path).relative_to(site).as_posix() for path in assets]
    shell += [
        './manifest.webmanifest', './supabase/config.js', './favicon.ico',
        './favicon-16x16.png', './favicon-32x32.png', './apple-touch-icon.png',
        './android-chrome-192x192.png', './android-chrome-512x512.png',
    ]
    updated, count = re.subn(
        r'(const\s+SHELL\s*=\s*)\[[\s\S]*?\]',
        lambda match: match[1] + '[\n' + ',\n'.join('  ' + repr(path) for path in shell) + '\n]',
        source,
    )
    if count != 1:
        raise ValueError(f'{label}: expected exactly one SHELL declaration')
    vendor_prefix = f'{site}/assets/vendor/'
    vendors = {'./'+PurePosixPath(path).relative_to(site).as_posix(): hashlib.sha256(snapshot.read(path)).hexdigest()
               for path in sorted(snapshot.files) if path.startswith(vendor_prefix)}
    updated, count = re.subn(r'const VENDOR_HASHES=\{[\s\S]*?\};',
                            lambda _: 'const VENDOR_HASHES='+json.dumps(vendors, separators=(',', ':'))+';', updated)
    if count != 1:
        raise ValueError(f'{label}: expected exactly one vendor integrity declaration')
    digest = hashlib.sha256()
    for item in shell[1:] + ['./_headers']:
        relative = f'{site}/{item[2:]}'
        digest.update(item.encode('utf-8'))
        content = asset_hash_bytes(relative, snapshot.read(relative))
        if item == './_headers':
            # The derived release header must not hash itself.
            content = re.sub(rb'^  X-Netunim-Release: [^\n]+\n?', b'', content, flags=re.MULTILINE)
        digest.update(content)
    # Worker behavior is part of a release, too. Ignore only its derived key.
    digest.update(re.sub(r"const CACHE='[^']+';", "const CACHE='derived';", updated).encode('utf-8'))
    # Vendor trees are lazy-cached, but runtime upgrades must still rotate the
    # app cache so an offline session cannot combine a new adapter with stale
    # third-party code. Hash every deterministic vendor runtime manifest.
    vendor_prefix=f'{site}/assets/vendor/'
    vendor_manifests=sorted(path for path in snapshot.files if path.startswith(vendor_prefix) and PurePosixPath(path).name=='_runtime-manifest.txt')
    for vendor_manifest in vendor_manifests:
        digest.update(vendor_manifest.encode('utf-8'))
        digest.update(asset_hash_bytes(vendor_manifest, snapshot.read(vendor_manifest)))
    updated, count = re.subn(
        r"const CACHE='[^']+';",
        f"const CACHE='{label}-app-shell-esm-{digest.hexdigest()[:12]}';",
        updated,
    )
    if count != 1:
        raise ValueError(f'{label}: expected exactly one CACHE declaration')
    return updated.encode('utf-8')


def plan_sync(snapshot: WorktreeSnapshot | IndexSnapshot) -> list[Change]:
    # Inspect all public names, including untracked root files outside the shell
    # inventory. The staged snapshot instead checks the exact proposed Git tree.
    public_files = getattr(snapshot, 'public_files', snapshot.files)
    for label in APPS:
        prefix = f'netunim-{label}/site/'
        found = asset_name_violations(path[len(prefix):] for path in public_files if path.startswith(prefix))
        if found:
            raise ValueError(f'{label}: unapproved public asset names: {found}')
    """Calculate every change before writing, so structural errors are atomic."""
    changes: list[Change] = []
    for source, target in BRIDGE_SHARED_SOURCES.items():
        if source not in snapshot.files:
            if target in snapshot.files:
                changes.append(Change(target, None, f'bridge: removed obsolete generated copy: {target}'))
            continue
        expected = snapshot.read(source)
        # Canonical shared modules use .js; the installed Bridge uses .mjs.
        for dependency, generated in BRIDGE_SHARED_SOURCES.items():
            expected = expected.replace(
                ("'./" + PurePosixPath(dependency).name + "'").encode(),
                ("'./" + PurePosixPath(generated).name + "'").encode())
        if target not in snapshot.files or asset_hash_bytes(target, snapshot.read(target)) != asset_hash_bytes(source, expected):
            changes.append(Change(target, expected, f'bridge: synchronized canonical source: {source}'))
    sources = direct_javascript_files(snapshot.files, 'shared') | {path for path in snapshot.files if str(PurePosixPath(path).parent) == 'shared' and path.endswith('.css')}
    # Classic workers cannot import ESM. This generated script changes only the
    # module envelope; matching logic stays byte-for-byte canonical.
    search_source = 'shared/document-text-search.js'
    worker_name = 'document-text-search-worker.js'
    source_names = {PurePosixPath(path).name for path in sources}
    if search_source in snapshot.files:
        source_names.add(worker_name)
    for label in APPS:
        target_dir = f'netunim-{label}/site/assets/js/shared'
        targets = direct_javascript_files(snapshot.files, target_dir) | {path for path in snapshot.files if str(PurePosixPath(path).parent) == target_dir and path.endswith('.css')}
        for target in sorted(targets):
            if PurePosixPath(target).name not in source_names:
                changes.append(Change(target, None, f'{label}: removed obsolete shared copy: {PurePosixPath(target).name}'))
        for source_path in sorted(sources):
            target = f'{target_dir}/{PurePosixPath(source_path).name}'
            expected = snapshot.read(source_path)
            if target not in snapshot.files or snapshot.read(target) != expected:
                changes.append(Change(target, expected, f'{label}: synchronized shared source: {PurePosixPath(source_path).name}'))
        if search_source in snapshot.files:
            canonical = asset_hash_bytes(search_source, snapshot.read(search_source))
            expected = re.sub(rb'^export (?=function )', b'', canonical, flags=re.MULTILINE)
            target = f'{target_dir}/{worker_name}'
            if target not in snapshot.files or asset_hash_bytes(target, snapshot.read(target)) != expected:
                changes.append(Change(target, expected, f'{label}: generated classic text-search worker module'))

    tax_sources = sorted(path for path in snapshot.files if PurePosixPath(path).is_relative_to(TAX_SHARED_ROOT) and PurePosixPath(path).suffix in {'.js', '.css'})
    for label in APPS:
        target_root = PurePosixPath(f'netunim-{label}/site/assets/js/shared/tax-calculator')
        expected_targets = {(target_root / PurePosixPath(path).relative_to(TAX_SHARED_ROOT)).as_posix() for path in tax_sources}
        managed_targets = {path for path in snapshot.files if PurePosixPath(path).is_relative_to(target_root) and PurePosixPath(path).suffix in {'.js', '.css'}}
        for target in sorted(managed_targets - expected_targets):
            changes.append(Change(target, None, f'{label}: removed obsolete calculator asset'))
        for source in tax_sources:
            target = (target_root / PurePosixPath(source).relative_to(TAX_SHARED_ROOT)).as_posix()
            expected = snapshot.read(source)
            if target not in snapshot.files or snapshot.read(target) != expected:
                changes.append(Change(target, expected, f'{label}: synchronized calculator asset: {PurePosixPath(source).name}'))

    document_sources = sorted(
        path for path in snapshot.files
        if PurePosixPath(path).is_relative_to(DOCUMENT_SEARCH_SHARED_ROOT) and path.endswith('.js')
    )
    document_relatives = {
        PurePosixPath(path).relative_to(DOCUMENT_SEARCH_SHARED_ROOT).as_posix()
        for path in document_sources
    }
    for label in APPS:
        site_root = PurePosixPath(f'netunim-{label}/site')
        target_root = site_root / DOCUMENT_SEARCH_TARGET_ROOT
        managed_targets = {
            path for path in snapshot.files
            if (
                PurePosixPath(path).parent == target_root / 'domains/documents'
                or (
                    PurePosixPath(path).parent == target_root / 'integrations'
                    and PurePosixPath(path).name.startswith('document-')
                )
                or (
                    PurePosixPath(path).parent == target_root / 'ui'
                    and PurePosixPath(path).name.startswith('document-')
                )
            ) and path.endswith('.js')
        }
        expected_targets = {(target_root / relative).as_posix() for relative in document_relatives}
        for target in sorted(managed_targets - expected_targets):
            relative = PurePosixPath(target).relative_to(target_root)
            changes.append(Change(target, None, f'{label}: removed obsolete shared document search: {relative.as_posix()}'))
        for source_path in document_sources:
            relative = PurePosixPath(source_path).relative_to(DOCUMENT_SEARCH_SHARED_ROOT)
            target = (target_root / relative).as_posix()
            expected = snapshot.read(source_path)
            if target not in snapshot.files or snapshot.read(target) != expected:
                changes.append(Change(target, expected, f'{label}: synchronized shared document search: {relative.as_posix()}'))

    overlay = OverlaySnapshot(snapshot, changes)
    for label in APPS:
        worker = f'netunim-{label}/site/service-worker.js'
        expected = render_worker(label, overlay, worker)
        current = overlay.read(worker)
        normalized_current = current.replace(b'\r\n', b'\n').replace(b'\r', b'\n')
        if expected != normalized_current:
            changes.append(Change(worker, expected, f'{label}: refreshed service-worker shell and cache key'))
        release = re.search(rb"const CACHE='([^']+)'", expected)[1]
        headers = f'netunim-{label}/site/_headers'
        current_headers = asset_hash_bytes(headers, overlay.read(headers))
        clean_headers = re.sub(rb'^  X-Netunim-Release: [^\n]+\n?', b'', current_headers, flags=re.MULTILINE)
        # Insert into the global rule without changing any other bytes. Trimming
        # trailing lines here would make the hashed source differ from output.
        expected_headers, count = re.subn(rb'^/\*\n', lambda match: match[0]+b'  X-Netunim-Release: '+release+b'\n',
                                         clean_headers, count=1, flags=re.MULTILINE)
        if count != 1:
            raise ValueError(f'{label}: expected a global response header rule')
        if current_headers != expected_headers:
            changes.append(Change(headers, expected_headers, f'{label}: refreshed release response header'))
    return changes


def print_changes(changes: list[Change], prefix: str) -> None:
    for change in changes:
        print(f'{prefix} {change.message} ({change.path})')


def apply_worktree(changes: list[Change]) -> None:
    for change in changes:
        path = ROOT / change.path
        if change.content is None:
            path.unlink(missing_ok=True)
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(change.content)


def sync(check: bool = False) -> bool:
    changes = plan_sync(WorktreeSnapshot(ROOT))
    if not changes:
        return True
    if check:
        print_changes(changes, 'FAIL')
    else:
        apply_worktree(changes)
        print_changes(changes, 'SYNCED')
    return False


def sync_staged() -> bool:
    """Fix the proposed commit and separately keep the full working tree derived."""
    with IndexSnapshot(ROOT) as index:
        index_changes = plan_sync(index)
    worktree_changes = plan_sync(WorktreeSnapshot(ROOT))
    # Both plans are fully validated before either mutable surface is touched.
    apply_worktree(worktree_changes)
    index.apply(index_changes)
    print_changes(index_changes, 'STAGED')
    unstaged_paths = {change.path for change in worktree_changes} - {change.path for change in index_changes}
    if unstaged_paths:
        print('NOTE working-tree-only asset changes remain unstaged, preserving the commit selection.')
    return not index_changes


def main() -> int:
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--check', action='store_true', help='report drift without modifying files')
    mode.add_argument('--staged', action='store_true', help='synchronize the proposed Git commit and working tree')
    args = parser.parse_args()
    try:
        if args.staged:
            sync_staged()
            return 0
        return 1 if not sync(args.check) and args.check else 0
    except subprocess.CalledProcessError as error:
        detail = error.stderr.decode('utf-8', errors='replace').strip() if isinstance(error.stderr, bytes) else error.stderr
        print(f'ERROR: asset synchronization Git operation failed: {detail or error}', file=sys.stderr)
        return 2
    except (OSError, UnicodeError, ValueError) as error:
        print(f'ERROR: asset synchronization failed: {error}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
