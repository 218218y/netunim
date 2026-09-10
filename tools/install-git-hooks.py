"""Install or validate NETUNIM's repository-local Git hooks."""
from __future__ import annotations

from pathlib import Path
import argparse
import os
import stat
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'tools/git-hooks/pre-commit'
MARKER = b'NETUNIM_MANAGED_HOOK: asset-sync-v1'


def active_hook_path() -> Path:
    result = subprocess.run(
        ['git', 'rev-parse', '--git-path', 'hooks/pre-commit'],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    path = Path(result.stdout.strip())
    return path if path.is_absolute() else ROOT / path


def is_current(target: Path, expected: bytes) -> bool:
    if not target.is_file():
        return False
    executable = os.name == 'nt' or bool(target.stat().st_mode & stat.S_IXUSR)
    return executable and target.read_bytes() == expected


def install(check: bool = False) -> int:
    expected = SOURCE.read_bytes().replace(b'\r\n', b'\n').replace(b'\r', b'\n')
    target = active_hook_path()
    if is_current(target, expected):
        print(f'OK: NETUNIM pre-commit hook is installed at {target}')
        return 0
    if check:
        print(f'ERROR: NETUNIM pre-commit hook is missing or outdated: {target}', file=sys.stderr)
        print('Run: python tools/install-git-hooks.py', file=sys.stderr)
        return 1
    if target.exists() and (not target.is_file() or MARKER not in target.read_bytes()):
        print(f'ERROR: refusing to overwrite an unmanaged pre-commit hook: {target}', file=sys.stderr)
        print('Integrate tools/git-hooks/pre-commit into the existing hook manually.', file=sys.stderr)
        return 2

    target.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix='pre-commit.', dir=target.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(expected)
            stream.flush()
            os.fsync(stream.fileno())
        temporary.chmod(temporary.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)
    print(f'INSTALLED: NETUNIM pre-commit asset sync at {target}')
    return 0


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='fail unless the current managed hook is installed')
    args = parser.parse_args()
    raise SystemExit(install(check=args.check))
