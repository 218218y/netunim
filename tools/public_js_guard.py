"""Reject dynamic-code execution in first-party public JavaScript.

Vendored browser runtimes are verified byte-for-byte by their dedicated runtime
manifests before this guard runs.  This scanner deliberately excludes only the
structural ``assets/vendor`` subtree and scans every other public .js/.mjs/.cjs
file without relying on Windows command-line path filtering.
"""
from __future__ import annotations

from pathlib import Path
import argparse
import re

SCRIPT_SUFFIXES = {".js", ".mjs", ".cjs"}
PATTERNS = (
    ("eval", re.compile(r"\beval\s*\(")),
    ("Function constructor", re.compile(r"\bnew\s+Function\s*\(")),
)


def is_vendor(relative: Path) -> bool:
    parts = tuple(part.casefold() for part in relative.parts)
    return len(parts) >= 2 and parts[0] == "assets" and parts[1] == "vendor"


def violations(site_dir: Path) -> list[tuple[Path, int, str]]:
    site_dir = site_dir.resolve()
    found: list[tuple[Path, int, str]] = []
    for path in sorted(site_dir.rglob("*"), key=lambda item: item.as_posix().casefold()):
        if not path.is_file() or path.suffix.casefold() not in SCRIPT_SUFFIXES:
            continue
        relative = path.relative_to(site_dir)
        if is_vendor(relative):
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError as error:
            raise ValueError(f"first-party JavaScript is not valid UTF-8: {relative.as_posix()}") from error
        for line_number, line in enumerate(text.splitlines(), 1):
            for label, pattern in PATTERNS:
                if pattern.search(line):
                    found.append((relative, line_number, label))
    return found


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Check first-party public JavaScript for dynamic-code execution")
    parser.add_argument("site_dir", type=Path)
    args = parser.parse_args(argv)
    site_dir = args.site_dir
    if not site_dir.is_dir():
        print(f"ERROR: public site directory was not found: {site_dir}")
        return 2
    try:
        found = violations(site_dir)
    except (OSError, ValueError) as error:
        print(f"ERROR: public JavaScript guard failed: {error}")
        return 2
    if found:
        for relative, line_number, label in found:
            print(f"ERROR: public JavaScript contains dynamic code ({label}): {relative.as_posix()}:{line_number}")
        return 1
    print("PASS public JavaScript dynamic-code guard")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
