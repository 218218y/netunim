"""Reject accidental public backup/copy artifacts without banning compatibility code."""
from pathlib import Path, PurePosixPath
import re

BACKUP_ENDING = re.compile(r'(?:\.(?:bak|backup|old|orig|rej|tmp|temp|swp|swo|save)|~)$', re.I)
BACKUP_STEM = re.compile(r'\.(?:bak|backup|old|orig|rej|tmp|temp)$', re.I)
NUMBERED_COPY = re.compile(r'\s*\(\d+\)$')
NAMED_COPY = re.compile(r'(?:\s+-\s+(?:copy|עותק)(?:\s*\(\d+\))?|\s+copy)$', re.I)


def asset_name_issue(relative: str | PurePosixPath) -> str | None:
    """Check a site-relative file name; version/legacy paths remain intentional."""
    path = PurePosixPath(str(relative).replace('\\', '/'))
    name = path.name
    if BACKUP_ENDING.search(name) or BACKUP_STEM.search(path.stem):
        return 'editor or backup artifact'
    if NUMBERED_COPY.search(path.stem) or NAMED_COPY.search(path.stem):
        return 'unapproved duplicate copy'
    if name.startswith('.#') or (name.startswith('#') and name.endswith('#')):
        return 'editor recovery artifact'
    if len(path.parts) == 1 and name.casefold().startswith('service-worker') and path.suffix.casefold() in {'.js', '.mjs', '.cjs'} and name != 'service-worker.js':
        return 'noncanonical root service worker'
    return None


def asset_name_violations(paths) -> list[tuple[str, str]]:
    found = []
    for path in sorted(paths, key=str):
        issue = asset_name_issue(path)
        if issue:
            found.append((str(path), issue))
    return found


def site_name_violations(site: Path) -> list[tuple[str, str]]:
    return asset_name_violations(path.relative_to(site).as_posix() for path in site.rglob('*') if path.is_file())
