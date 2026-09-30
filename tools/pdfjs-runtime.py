"""Install and verify the pinned browser PDF.js runtime used by Orders.

The application is intentionally a native-ESM static site, so runtime libraries are
vendored as public assets instead of being loaded from a CDN.  ``install`` downloads
one exact npm tarball, verifies its published SHA-512 integrity, and atomically
extracts only the browser files we deploy.  ``check`` is network-free and verifies
the installed manifest and every vendored file digest.
"""
from __future__ import annotations

from pathlib import Path, PurePosixPath
import argparse
import base64
import hashlib
import io
import os
import shutil
import tarfile
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
VERSION = "6.3.289"
PACKAGE = "pdfjs-dist"
TARBALL_URL = f"https://registry.npmjs.org/{PACKAGE}/-/{PACKAGE}-{VERSION}.tgz"
TARBALL_INTEGRITY = "sha512-ZHjSVpDa3D6izMq8/04lvkhkATUmL9px6ChPaXc1k6nU2Mrhlg1/7F0bdUqCwUjw3NsPTfPZsMDUU6ZIcRaeQw=="
DESTINATIONS = tuple(ROOT / f"netunim-{app}/site/assets/vendor/pdfjs" for app in ("orders", "kupa"))
DESTINATION = DESTINATIONS[0]
MANIFEST_NAME = "_runtime-manifest.txt"

REQUIRED_FILES = {
    "build/pdf.mjs",
    "build/pdf.worker.min.mjs",
    "legacy/build/pdf.mjs",
    "legacy/build/pdf.worker.min.mjs",
    "web/pdf_viewer.mjs",
    "web/pdf_viewer.css",
    "LICENSE",
}
OPTIONAL_FILES = set()
API_CONTRACT_SNIPPETS = {
    "build/pdf.mjs": (
        "convertToViewportPoint(x, y)",
    ),
    "web/pdf_viewer.mjs": (
        "class PDFFindController",
        "get pageMatches()",
        "get pageMatchesLength()",
        "get selected()",
        "match(query, pageContent, pageIndex)",
        "scrollMatchIntoView({",
        "class PDFViewer",
        "getPageView(index)",
    ),
}
REQUIRED_PREFIXES = (
    "web/images/",
    "cmaps/",
    "iccs/",
    "standard_fonts/",
    "wasm/",
    "image_decoders/",
)


def integrity_digest(value: str = TARBALL_INTEGRITY) -> bytes:
    algorithm, encoded = value.split("-", 1)
    if algorithm != "sha512":
        raise ValueError(f"unsupported PDF.js integrity algorithm: {algorithm}")
    return base64.b64decode(encoded, validate=True)


def verify_archive(data: bytes, expected_integrity: str = TARBALL_INTEGRITY) -> None:
    expected = integrity_digest(expected_integrity)
    actual = hashlib.sha512(data).digest()
    if actual != expected:
        raise ValueError("PDF.js archive integrity mismatch; refusing to install unverified runtime")


def selected_relative(member_name: str) -> str | None:
    path = PurePosixPath(member_name)
    if not path.parts or path.parts[0] != "package":
        return None
    relative = PurePosixPath(*path.parts[1:]).as_posix()
    if relative in REQUIRED_FILES or relative in OPTIONAL_FILES or any(relative.startswith(prefix) for prefix in REQUIRED_PREFIXES):
        return relative
    return None


def safe_member(member: tarfile.TarInfo) -> bool:
    path = PurePosixPath(member.name)
    return not path.is_absolute() and ".." not in path.parts and (member.isfile() or member.isdir())


def digest_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_manifest(destination: Path) -> None:
    files = sorted(path for path in destination.rglob("*") if path.is_file() and path.name != MANIFEST_NAME)
    lines = [
        f"package={PACKAGE}",
        f"version={VERSION}",
        f"source={TARBALL_URL}",
        f"integrity={TARBALL_INTEGRITY}",
        f"files={len(files)}",
        "",
    ]
    for path in files:
        relative = path.relative_to(destination).as_posix()
        lines.append(f"{digest_file(path)}  {relative}")
    (destination / MANIFEST_NAME).write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")


def build_runtime(archive_bytes: bytes, destination: Path, *, expected_integrity: str = TARBALL_INTEGRITY) -> None:
    verify_archive(archive_bytes, expected_integrity)
    destination.parent.mkdir(parents=True, exist_ok=True)
    staging: Path | None = Path(tempfile.mkdtemp(prefix=".pdfjs-runtime-", dir=destination.parent))
    try:
        seen: set[str] = set()
        with tarfile.open(fileobj=io.BytesIO(archive_bytes), mode="r:gz") as archive:
            for member in archive.getmembers():
                if not safe_member(member):
                    raise ValueError(f"unsafe PDF.js archive member: {member.name}")
                relative = selected_relative(member.name)
                if relative is None or not member.isfile():
                    continue
                source = archive.extractfile(member)
                if source is None:
                    raise ValueError(f"could not read PDF.js archive member: {member.name}")
                target = staging / PurePosixPath(relative)
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(source.read())
                seen.add(relative)
        missing = sorted(REQUIRED_FILES - seen)
        for prefix in REQUIRED_PREFIXES:
            if not any(item.startswith(prefix) for item in seen):
                missing.append(prefix + "*")
        if missing:
            raise ValueError("PDF.js archive is missing required runtime assets: " + ", ".join(missing))
        write_manifest(staging)
        backup = destination.with_name(destination.name + ".previous")
        if backup.exists():
            shutil.rmtree(backup)
        if destination.exists():
            os.replace(destination, backup)
        try:
            os.replace(staging, destination)
            staging = None
        except Exception:
            if backup.exists() and not destination.exists():
                os.replace(backup, destination)
            raise
        finally:
            if backup.exists():
                shutil.rmtree(backup)
    finally:
        if staging is not None and staging.exists():
            shutil.rmtree(staging, ignore_errors=True)


def download_archive() -> bytes:
    request = urllib.request.Request(
        TARBALL_URL,
        headers={"User-Agent": f"netunim-pdfjs-vendor/{VERSION}", "Accept": "application/octet-stream"},
    )
    with urllib.request.urlopen(request, timeout=90) as response:
        data = response.read()
    if not data:
        raise OSError("downloaded PDF.js archive is empty")
    return data


def parse_manifest(destination: Path) -> tuple[dict[str, str], dict[str, str]]:
    manifest = destination / MANIFEST_NAME
    if not manifest.is_file():
        raise FileNotFoundError(f"missing {manifest.relative_to(ROOT)}")
    metadata: dict[str, str] = {}
    files: dict[str, str] = {}
    for raw in manifest.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line:
            continue
        if "  " in line and len(line.split("  ", 1)[0]) == 64:
            digest, relative = line.split("  ", 1)
            files[relative] = digest
        elif "=" in line:
            key, value = line.split("=", 1)
            metadata[key] = value
        else:
            raise ValueError(f"invalid PDF.js runtime manifest line: {raw!r}")
    return metadata, files


def check_runtime(destination: Path = DESTINATION) -> list[str]:
    errors: list[str] = []
    try:
        metadata, expected_files = parse_manifest(destination)
    except (OSError, UnicodeError, ValueError) as error:
        return [str(error)]
    expected_metadata = {
        "package": PACKAGE,
        "version": VERSION,
        "source": TARBALL_URL,
        "integrity": TARBALL_INTEGRITY,
    }
    for key, value in expected_metadata.items():
        if metadata.get(key) != value:
            errors.append(f"manifest {key} mismatch: expected {value!r}, got {metadata.get(key)!r}")
    try:
        expected_count = int(metadata.get("files", "-1"))
    except ValueError:
        expected_count = -1
    if expected_count != len(expected_files):
        errors.append(f"manifest file count mismatch: header={expected_count}, entries={len(expected_files)}")
    actual_files = {
        path.relative_to(destination).as_posix(): path
        for path in destination.rglob("*")
        if path.is_file() and path.name != MANIFEST_NAME
    }
    missing = sorted(set(expected_files) - set(actual_files))
    extra = sorted(set(actual_files) - set(expected_files))
    if missing:
        errors.append("missing vendored files: " + ", ".join(missing[:12]) + (" …" if len(missing) > 12 else ""))
    if extra:
        errors.append("unexpected vendored files: " + ", ".join(extra[:12]) + (" …" if len(extra) > 12 else ""))
    for relative in sorted(set(expected_files) & set(actual_files)):
        if digest_file(actual_files[relative]) != expected_files[relative]:
            errors.append(f"vendored file digest mismatch: {relative}")
    for required in sorted(REQUIRED_FILES):
        if required not in actual_files:
            errors.append(f"required PDF.js runtime file is missing: {required}")
    for prefix in REQUIRED_PREFIXES:
        if not any(relative.startswith(prefix) for relative in actual_files):
            errors.append(f"required PDF.js runtime directory is empty: {prefix}")
    for relative, snippets in API_CONTRACT_SNIPPETS.items():
        path = actual_files.get(relative)
        if path is None:
            continue
        try:
            source = path.read_text(encoding="utf-8")
        except (OSError, UnicodeError) as error:
            errors.append(f"could not inspect PDF.js API contract in {relative}: {error}")
            continue
        for snippet in snippets:
            if snippet not in source:
                errors.append(f"PDF.js API contract mismatch in {relative}: missing {snippet!r}")
    return errors


def install(archive: Path | None = None, destination: Path | None = None) -> None:
    archive_bytes = archive.read_bytes() if archive else download_archive()
    destinations = (destination,) if destination is not None else DESTINATIONS
    for target in destinations:
        build_runtime(archive_bytes, target)


def main() -> int:
    parser = argparse.ArgumentParser(description="Install/check the pinned PDF.js browser runtime")
    subparsers = parser.add_subparsers(dest="command", required=True)
    install_parser = subparsers.add_parser("install", help="download/verify and vendor PDF.js")
    install_parser.add_argument("--archive", type=Path, help="use an already-downloaded npm .tgz instead of the network")
    subparsers.add_parser("check", help="verify the already-vendored runtime without network access")
    args = parser.parse_args()
    try:
        if args.command == "install":
            install(args.archive)
            locations=', '.join(str(path.relative_to(ROOT)) for path in DESTINATIONS)
            print(f"PDF.js {VERSION} runtime installed in {locations}")
            return 0
        failures=[]
        for destination in DESTINATIONS:
            failures.extend(f"{destination.relative_to(ROOT)}: {error}" for error in check_runtime(destination))
        if failures:
            print("PDF.js runtime verification failed:")
            for error in failures:
                print("-", error)
            print("Run: npm run pdfjs:install")
            return 1
        locations=', '.join(str(path.relative_to(ROOT)) for path in DESTINATIONS)
        print(f"PDF.js {VERSION} runtime verified ({locations})")
        return 0
    except (OSError, ValueError, tarfile.TarError) as error:
        print(f"ERROR: PDF.js runtime operation failed: {error}")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
