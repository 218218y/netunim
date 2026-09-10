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
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
APPS = ('kupa', 'orders')
TEXT_ASSET_SUFFIXES = {'.html', '.css', '.js', '.webmanifest'}


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
        paths = list((root / 'shared').glob('*.js'))
        fixed = (
            'service-worker.js', 'index.html', 'assets/app.css', 'manifest.webmanifest',
            'supabase/config.js', 'favicon.ico', 'favicon-16x16.png', 'favicon-32x32.png',
            'apple-touch-icon.png', 'android-chrome-192x192.png', 'android-chrome-512x512.png', '_headers',
        )
        for label in APPS:
            site = root / f'netunim-{label}/site'
            paths.extend((site / 'assets').rglob('*.js'))
            paths.extend(site / relative for relative in fixed)
        self.files = {path.relative_to(root).as_posix() for path in paths if path.is_file()}

    def read(self, path: str) -> bytes:
        return (self.root / path).read_bytes()


class IndexSnapshot:
    def __init__(self, root: Path):
        self.root = root
        result = self.git('ls-files', '-z', '--cached', stdout=subprocess.PIPE)
        self.files = {item.decode('utf-8') for item in result.stdout.split(b'\0') if item}

    def git(self, *args: str, **kwargs) -> subprocess.CompletedProcess:
        return subprocess.run(
            ['git', *args], cwd=self.root, check=True, stderr=subprocess.PIPE, **kwargs
        )

    def read(self, path: str) -> bytes:
        if path not in self.files:
            raise FileNotFoundError(f'{path} is not present in the proposed commit')
        return self.git('show', f':{path}', stdout=subprocess.PIPE).stdout

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
    assets = sorted(
        path for path in snapshot.files
        if path.startswith(asset_prefix) and path.lower().endswith('.js')
    )
    shell = ['./', './index.html', './assets/app.css']
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
    digest = hashlib.sha256()
    for item in shell[1:] + ['./_headers']:
        relative = f'{site}/{item[2:]}'
        digest.update(item.encode('utf-8'))
        digest.update(asset_hash_bytes(relative, snapshot.read(relative)))
    updated, count = re.subn(
        r"const CACHE='[^']+';",
        f"const CACHE='{label}-app-shell-esm-{digest.hexdigest()[:12]}';",
        updated,
    )
    if count != 1:
        raise ValueError(f'{label}: expected exactly one CACHE declaration')
    return updated.encode('utf-8')


def plan_sync(snapshot: WorktreeSnapshot | IndexSnapshot) -> list[Change]:
    """Calculate every change before writing, so structural errors are atomic."""
    changes: list[Change] = []
    sources = direct_javascript_files(snapshot.files, 'shared')
    source_names = {PurePosixPath(path).name for path in sources}
    for label in APPS:
        target_dir = f'netunim-{label}/site/assets/js/shared'
        targets = direct_javascript_files(snapshot.files, target_dir)
        for target in sorted(targets):
            if PurePosixPath(target).name not in source_names:
                changes.append(Change(target, None, f'{label}: removed obsolete shared copy: {PurePosixPath(target).name}'))
        for source_path in sorted(sources):
            target = f'{target_dir}/{PurePosixPath(source_path).name}'
            expected = snapshot.read(source_path)
            if target not in snapshot.files or snapshot.read(target) != expected:
                changes.append(Change(target, expected, f'{label}: synchronized shared source: {PurePosixPath(source_path).name}'))

    overlay = OverlaySnapshot(snapshot, changes)
    for label in APPS:
        worker = f'netunim-{label}/site/service-worker.js'
        expected = render_worker(label, overlay, worker)
        current = overlay.read(worker)
        normalized_current = current.replace(b'\r\n', b'\n').replace(b'\r', b'\n')
        if expected != normalized_current:
            changes.append(Change(worker, expected, f'{label}: refreshed service-worker shell and cache key'))
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
    index = IndexSnapshot(ROOT)
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
