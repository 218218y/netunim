#!/usr/bin/env python3
"""Maintain the minimal Linux-x64 offline verification toolchain for NETUNIM.

The online maintenance commands (download/update) may run on any OS. Installation
and execution intentionally fail closed outside Linux x86_64 + glibc because the
vendored Node runtime is prepared specifically for the ChatGPT repair environment.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "tools" / "offline-deps.json"
LOCK_PATH = ROOT / "package-lock.json"
VENDOR = ROOT / "vendor" / "offline"
MANIFEST_PATH = VENDOR / "manifest.json"
INSTALL_ROOT = ROOT / ".offline"
NODE_MODULES = ROOT / "node_modules"
NODE_MODULES_MARKER = NODE_MODULES / ".netunim-offline-managed.json"
USER_AGENT = "netunim-offline-deps/1"


class OfflineDepsError(RuntimeError):
    pass


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temp, path)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def lock_sha256() -> str:
    return hashlib.sha256(LOCK_PATH.read_bytes()).hexdigest()


def config_sha256() -> str:
    return hashlib.sha256(CONFIG_PATH.read_bytes()).hexdigest()


def npm_name(lock_path: str) -> str:
    return lock_path.rsplit("node_modules/", 1)[-1]


def npm_filename(name: str, version: str) -> str:
    safe = name.lstrip("@").replace("/", "__")
    return f"{safe}-{version}.tgz"


def npm_targets(lock: dict) -> list[dict]:
    targets = []
    for lock_path, entry in sorted(lock.get("packages", {}).items()):
        if not lock_path.startswith("node_modules/"):
            continue
        resolved = entry.get("resolved")
        integrity = entry.get("integrity")
        version = entry.get("version")
        if not (isinstance(resolved, str) and resolved.startswith("https://registry.npmjs.org/")):
            raise OfflineDepsError(f"unsupported npm resolved URL at {lock_path}: {resolved!r}")
        if not (isinstance(integrity, str) and "-" in integrity):
            raise OfflineDepsError(f"missing npm integrity at {lock_path}")
        if not isinstance(version, str):
            raise OfflineDepsError(f"missing npm version at {lock_path}")
        name = npm_name(lock_path)
        targets.append({
            "lockPath": lock_path,
            "name": name,
            "version": version,
            "url": resolved,
            "integrity": integrity,
            "file": f"npm/{npm_filename(name, version)}",
        })
    if not targets:
        raise OfflineDepsError("package-lock.json contains no npm development packages")
    return targets


def verify_integrity(path: Path, integrity: str) -> None:
    algorithm, expected = integrity.split("-", 1)
    try:
        h = hashlib.new(algorithm)
    except ValueError as exc:
        raise OfflineDepsError(f"unsupported integrity algorithm: {algorithm}") from exc
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    actual = base64.b64encode(h.digest()).decode("ascii")
    if actual != expected:
        raise OfflineDepsError(f"integrity mismatch: {path}")


def download(url: str, target: Path) -> None:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    target.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(request, timeout=90) as response, target.open("wb") as out:
        shutil.copyfileobj(response, out)


def acquire(url: str, target: Path, current: Path | None, verifier) -> None:
    if current and current.is_file():
        try:
            verifier(current)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(current, target)
            print(f"reuse  {target.relative_to(target.parents[2])}")
            return
        except OfflineDepsError:
            pass
    print(f"fetch  {url}")
    download(url, target)
    verifier(target)


def pypi_wheel(project: str, version: str, filename: str) -> tuple[str, str]:
    url = f"https://pypi.org/pypi/{project}/{version}/json"
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        payload = json.load(response)
    for item in payload.get("urls", []):
        if item.get("filename") == filename and item.get("packagetype") == "bdist_wheel":
            digest = item.get("digests", {}).get("sha256")
            if not digest:
                raise OfflineDepsError(f"PyPI returned no SHA256 for {filename}")
            return item["url"], digest
    raise OfflineDepsError(f"PyPI wheel not found: {project} {version} / {filename}")


def manifest_for(stage: Path, config: dict, lock: dict) -> dict:
    node = config["node"]
    result = {
        "schema": 1,
        "profile": config["profile"],
        "platform": config["platform"],
        "packageLockSha256": lock_sha256(),
        "configSha256": config_sha256(),
        "node": {
            "version": node["version"],
            "file": f"node/{node['file']}",
            "url": node["url"],
            "sha256": node["sha256"],
        },
        "npm": npm_targets(lock),
        "python": [],
    }
    for item in config["python"]:
        wheel_url, wheel_sha = pypi_wheel(item["project"], item["version"], item["wheel"])
        result["python"].append({**item, "file": f"python/{item['wheel']}", "url": wheel_url, "sha256": wheel_sha})
    return result


def refresh_vendor() -> None:
    config = read_json(CONFIG_PATH)
    lock = read_json(LOCK_PATH)
    VENDOR.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=".offline-stage-", dir=VENDOR.parent))
    try:
        node = config["node"]
        node_rel = Path("node") / node["file"]
        acquire(
            node["url"], stage / node_rel,
            VENDOR / node_rel,
            lambda p: (_ for _ in ()).throw(OfflineDepsError(f"SHA256 mismatch: {p}")) if sha256_file(p) != node["sha256"] else None,
        )
        for item in npm_targets(lock):
            rel = Path(item["file"])
            acquire(item["url"], stage / rel, VENDOR / rel, lambda p, i=item: verify_integrity(p, i["integrity"]))

        manifest = manifest_for(stage, config, lock)
        for item in manifest["python"]:
            rel = Path(item["file"])
            acquire(
                item["url"], stage / rel, VENDOR / rel,
                lambda p, expected=item["sha256"]: (_ for _ in ()).throw(OfflineDepsError(f"SHA256 mismatch: {p}")) if sha256_file(p) != expected else None,
            )
        write_json(stage / "manifest.json", manifest)
        readme = VENDOR / "README.md"
        if readme.is_file():
            shutil.copy2(readme, stage / "README.md")
        backup = VENDOR.with_name(".offline-previous")
        shutil.rmtree(backup, ignore_errors=True)
        moved_old = False
        if VENDOR.exists():
            os.replace(VENDOR, backup)
            moved_old = True
        try:
            os.replace(stage, VENDOR)
        except BaseException:
            if moved_old and backup.exists() and not VENDOR.exists():
                os.replace(backup, VENDOR)
            raise
        shutil.rmtree(backup, ignore_errors=True)
        print(f"OK: offline vendor refreshed ({len(manifest['npm'])} npm archives, {len(manifest['python'])} Python wheel, Node {manifest['node']['version']})")
    except BaseException:
        shutil.rmtree(stage, ignore_errors=True)
        raise


def check_platform() -> None:
    config = read_json(CONFIG_PATH)
    if platform.system() != config["platform"]["system"] or platform.machine().lower() not in {"x86_64", "amd64"}:
        raise OfflineDepsError("offline install supports the ChatGPT Linux x86_64 environment only")
    libc_name, _ = platform.libc_ver()
    if libc_name and libc_name.lower() != "glibc":
        raise OfflineDepsError(f"offline install requires glibc; found {libc_name}")


def check_vendor(*, quiet: bool = False) -> dict:
    if not MANIFEST_PATH.is_file():
        raise OfflineDepsError("offline vendor is missing; run: npm run offline:download")
    manifest = read_json(MANIFEST_PATH)
    if manifest.get("packageLockSha256") != lock_sha256():
        raise OfflineDepsError("offline vendor is stale for package-lock.json; run: npm run offline:download")
    if manifest.get("configSha256") != config_sha256():
        raise OfflineDepsError("offline vendor is stale for tools/offline-deps.json; run: npm run offline:download")
    node = manifest["node"]
    node_path = VENDOR / node["file"]
    if not node_path.is_file() or sha256_file(node_path) != node["sha256"]:
        raise OfflineDepsError("vendored Node archive is missing or corrupt")
    for item in manifest["npm"]:
        path = VENDOR / item["file"]
        if not path.is_file():
            raise OfflineDepsError(f"missing npm archive: {item['file']}")
        verify_integrity(path, item["integrity"])
    for item in manifest["python"]:
        path = VENDOR / item["file"]
        if not path.is_file() or sha256_file(path) != item["sha256"]:
            raise OfflineDepsError(f"missing/corrupt Python wheel: {item['file']}")
    if not quiet:
        print(f"OK: offline vendor verified ({len(manifest['npm'])} npm + {len(manifest['python'])} Python + Node {node['version']})")
    return manifest


def safe_member(name: str, strip_first: bool) -> Path | None:
    pure = PurePosixPath(name)
    if pure.is_absolute():
        raise OfflineDepsError(f"unsafe absolute archive path: {name}")
    parts = list(pure.parts)
    if strip_first and parts:
        parts = parts[1:]
    if not parts:
        return None
    if any(part in {"", ".", ".."} for part in parts):
        raise OfflineDepsError(f"unsafe archive path: {name}")
    return Path(*parts)


def extract_node_runtime(archive: Path, destination: Path) -> Path:
    """Extract only the Node executable; npm/corepack symlinks are unnecessary here."""
    with tarfile.open(archive, "r:*") as tar:
        candidates = [member for member in tar.getmembers() if member.isfile() and member.name.endswith("/bin/node")]
        if len(candidates) != 1:
            raise OfflineDepsError(f"expected exactly one bin/node in {archive.name}; found {len(candidates)}")
        member = candidates[0]
        target = destination / "bin" / "node"
        target.parent.mkdir(parents=True, exist_ok=True)
        src = tar.extractfile(member)
        if src is None:
            raise OfflineDepsError("could not read Node executable from archive")
        with src, target.open("wb") as out:
            shutil.copyfileobj(src, out)
        target.chmod(0o755)
        return target


def extract_tar(archive: Path, destination: Path, *, strip_first: bool) -> None:
    with tarfile.open(archive, "r:*") as tar:
        for member in tar.getmembers():
            rel = safe_member(member.name, strip_first)
            if rel is None:
                continue
            target = destination / rel
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            elif member.isfile():
                target.parent.mkdir(parents=True, exist_ok=True)
                src = tar.extractfile(member)
                if src is None:
                    raise OfflineDepsError(f"could not read archive member: {member.name}")
                with src, target.open("wb") as out:
                    shutil.copyfileobj(src, out)
                try:
                    target.chmod(member.mode & 0o777)
                except OSError:
                    pass
            elif member.issym() or member.islnk():
                raise OfflineDepsError(f"links are not accepted in offline archives: {member.name}")


def extract_wheel(archive: Path, destination: Path) -> None:
    with zipfile.ZipFile(archive) as wheel:
        for info in wheel.infolist():
            rel = safe_member(info.filename, False)
            if rel is None:
                continue
            target = destination / rel
            if info.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with wheel.open(info) as src, target.open("wb") as out:
                    shutil.copyfileobj(src, out)


def offline_managed_node_modules() -> bool:
    return NODE_MODULES_MARKER.is_file()


def remove_generated_install() -> None:
    shutil.rmtree(INSTALL_ROOT, ignore_errors=True)
    if offline_managed_node_modules():
        shutil.rmtree(NODE_MODULES, ignore_errors=True)


def install() -> dict:
    check_platform()
    manifest = check_vendor(quiet=True)
    stamp_value = hashlib.sha256(MANIFEST_PATH.read_bytes()).hexdigest()
    stamp_path = INSTALL_ROOT / "stamp.json"
    if stamp_path.is_file() and NODE_MODULES_MARKER.is_file():
        try:
            stamp = read_json(stamp_path)
            marker = read_json(NODE_MODULES_MARKER)
            if (stamp.get("manifestSha256") == stamp_value and marker.get("manifestSha256") == stamp_value
                    and (INSTALL_ROOT / "node" / "bin" / "node").is_file()
                    and (NODE_MODULES / "eslint" / "bin" / "eslint.js").is_file()):
                return manifest
        except Exception:
            pass
    if NODE_MODULES.exists() and not offline_managed_node_modules():
        raise OfflineDepsError(
            "node_modules exists and is not managed by the offline toolchain; remove/rename it first, "
            "or keep using the normal npm workflow"
        )

    shutil.rmtree(INSTALL_ROOT, ignore_errors=True)
    INSTALL_ROOT.mkdir(parents=True, exist_ok=True)
    (INSTALL_ROOT / "node").mkdir(parents=True, exist_ok=True)
    node_executable = extract_node_runtime(VENDOR / manifest["node"]["file"], INSTALL_ROOT / "node")
    version_check = subprocess.run([str(node_executable), "--version"], capture_output=True, text=True)
    expected_version = f"v{manifest['node']['version']}"
    if version_check.returncode or version_check.stdout.strip() != expected_version:
        raise OfflineDepsError(
            f"vendored Node runtime version mismatch: expected {expected_version}, got {version_check.stdout.strip()!r}"
        )

    node_stage = INSTALL_ROOT / "node_modules-stage"
    node_stage.mkdir(parents=True, exist_ok=True)
    for item in manifest["npm"]:
        lock_path = PurePosixPath(item["lockPath"])
        if not lock_path.parts or lock_path.parts[0] != "node_modules":
            raise OfflineDepsError(f"unexpected npm lock path: {item['lockPath']}")
        target = node_stage.joinpath(*lock_path.parts[1:])
        target.mkdir(parents=True, exist_ok=True)
        extract_tar(VENDOR / item["file"], target, strip_first=True)
    write_json(node_stage / ".netunim-offline-managed.json", {"manifestSha256": stamp_value})

    python_site = INSTALL_ROOT / "python"
    python_site.mkdir(parents=True, exist_ok=True)
    for item in manifest["python"]:
        extract_wheel(VENDOR / item["file"], python_site)

    old_modules = INSTALL_ROOT / "node_modules-old"
    if NODE_MODULES.exists():
        os.replace(NODE_MODULES, old_modules)
    try:
        os.replace(node_stage, NODE_MODULES)
    except BaseException:
        if old_modules.exists() and not NODE_MODULES.exists():
            os.replace(old_modules, NODE_MODULES)
        raise
    shutil.rmtree(old_modules, ignore_errors=True)
    write_json(stamp_path, {"manifestSha256": stamp_value})
    print("OK: offline dependencies installed into generated local folders")
    return manifest


def offline_env() -> dict[str, str]:
    env = os.environ.copy()
    node_bin = str(INSTALL_ROOT / "node" / "bin")
    env["PATH"] = node_bin + os.pathsep + env.get("PATH", "")
    python_site = str(INSTALL_ROOT / "python")
    env["PYTHONPATH"] = python_site + (os.pathsep + env["PYTHONPATH"] if env.get("PYTHONPATH") else "")
    env["NETUNIM_OFFLINE"] = "1"
    return env


def run_offline(command: list[str]) -> int:
    install()
    result = subprocess.run(command, cwd=ROOT, env=offline_env())
    return result.returncode


def browser_probe() -> int:
    install()
    return subprocess.run(
        [sys.executable, str(ROOT / "tests" / "offline_environment_probe.py")],
        cwd=ROOT,
        env=offline_env(),
    ).returncode


def chat_test() -> int:
    probe_rc = browser_probe()
    env = offline_env()
    if probe_rc == 0:
        print("OK: browser runtime is usable; running the complete offline verification gate", flush=True)
        return subprocess.run([sys.executable, str(ROOT / "tests" / "run_all.py")], cwd=ROOT, env=env).returncode
    if probe_rc == 3:
        print(
            "WARNING: browser runtime is unavailable in this host; running core repair verification only. "
            "Use test:offline for the strict full gate.",
            flush=True,
        )
        return subprocess.run(
            [sys.executable, str(ROOT / "tests" / "run_all.py"), "--core-only"],
            cwd=ROOT,
            env=env,
        ).returncode
    return probe_rc


def latest_python_version(project: str, specifier: str) -> str:
    request = urllib.request.Request(f"https://pypi.org/pypi/{project}/json", headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        payload = json.load(response)
    match = re.fullmatch(r">=(\d+)\.(\d+),<(\d+)", specifier.replace(" ", ""))
    if not match:
        raise OfflineDepsError(f"unsupported Python update specifier: {specifier}")
    low = (int(match.group(1)), int(match.group(2)), 0)
    high_major = int(match.group(3))
    versions = []
    for text in payload.get("releases", {}):
        m = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)", text)
        if not m:
            continue
        value = tuple(map(int, m.groups()))
        if value >= low and value[0] < high_major:
            versions.append((value, text))
    if not versions:
        raise OfflineDepsError(f"no stable PyPI release satisfies {project} {specifier}")
    return max(versions)[1]


def update() -> None:
    original_lock = LOCK_PATH.read_bytes()
    original_config = CONFIG_PATH.read_bytes()
    try:
        npm = shutil.which("npm")
        if not npm:
            raise OfflineDepsError("npm is required for online dependency maintenance")
        print("update npm lockfile within reviewed package.json ranges")
        result = subprocess.run([npm, "update", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"], cwd=ROOT)
        if result.returncode:
            raise OfflineDepsError("npm update failed")
        config = read_json(CONFIG_PATH)
        for item in config["python"]:
            version = latest_python_version(item["project"], item["specifier"])
            item["version"] = version
            normalized = item["project"].replace("-", "_")
            item["wheel"] = f"{normalized}-{version}-py3-none-any.whl"
            print(f"python {item['project']} -> {version}")
        write_json(CONFIG_PATH, config)
        refresh_vendor()
        remove_generated_install()
        print("OK: dependency metadata updated; fresh offline archives replaced old archives only after full verification")
    except BaseException:
        LOCK_PATH.write_bytes(original_lock)
        CONFIG_PATH.write_bytes(original_config)
        raise


def clean() -> None:
    remove_generated_install()
    print("OK: generated offline installations removed; regular npm node_modules (if any) was left untouched")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("download", help="download/refresh the complete ChatGPT offline vendor transactionally")
    check_parser = sub.add_parser("check", help="verify every offline archive against its lock/hash")
    check_parser.add_argument("--quiet", action="store_true")
    sub.add_parser("doctor", help="verify installed offline tools and real localhost browser capability")
    sub.add_parser("install", help="install the vendored Linux dependencies without network access")
    sub.add_parser("test", help="install as needed and run the complete verification gate offline")
    sub.add_parser("chat-test", help="run full verification when browser works, otherwise explicit core-only repair checks")
    sub.add_parser("lint", help="install as needed and run ESLint offline")
    sub.add_parser("update", help="update reviewed dependency ranges, redownload, then delete superseded vendor files")
    sub.add_parser("clean", help="remove generated installed dependencies but keep the offline vendor")
    args = parser.parse_args(argv)
    try:
        if args.command == "download":
            refresh_vendor()
        elif args.command == "check":
            check_vendor(quiet=args.quiet)
        elif args.command == "doctor":
            return browser_probe()
        elif args.command == "install":
            install()
        elif args.command == "test":
            return run_offline([sys.executable, str(ROOT / "tests" / "run_all.py")])
        elif args.command == "chat-test":
            return chat_test()
        elif args.command == "lint":
            node = INSTALL_ROOT / "node" / "bin" / "node"
            install()
            return subprocess.run([str(node), str(NODE_MODULES / "eslint" / "bin" / "eslint.js"), "."], cwd=ROOT, env=offline_env()).returncode
        elif args.command == "update":
            update()
        elif args.command == "clean":
            clean()
    except (OfflineDepsError, OSError, ValueError, json.JSONDecodeError, urllib.error.URLError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
