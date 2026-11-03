"""Export a clean Git snapshot and offline runtimes, never a host profile or vault."""
from pathlib import Path, PurePosixPath
import hashlib
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import zipfile
import xml.etree.ElementTree as ET


def files(root):
    """One metadata read per entry, including Windows reparse-point rejection."""
    def inspect(path, info):
        if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & getattr(stat, 'FILE_ATTRIBUTE_REPARSE_POINT', 0):
            raise RuntimeError('package input contains a link or junction')
    inspect(root, root.lstat())
    pending = [root]
    while pending:
        with os.scandir(pending.pop()) as entries:
            for entry in entries:
                info = entry.stat(follow_symlinks=False)
                path = Path(entry.path)
                inspect(path, info)
                if stat.S_ISDIR(info.st_mode):
                    pending.append(path)
                elif stat.S_ISREG(info.st_mode):
                    yield path
                else:
                    raise RuntimeError('package contains unsupported special file')


def reject_links(root):
    for _path in files(root):
        pass


def extract_snapshot(archive, target):
    with zipfile.ZipFile(archive) as zipped:
        for info in zipped.infolist():
            name = PurePosixPath(info.filename)
            if name.is_absolute() or '..' in name.parts or '\\' in info.filename or ':' in info.filename:
                raise RuntimeError('archive path escapes snapshot')
            if stat.S_ISLNK(info.external_attr >> 16):
                raise RuntimeError('archive contains symlink')
        zipped.extractall(target)


def hashes(root):
    result = {}
    for path in files(root):
        if path == root/'package-manifest.json':
            continue
        digest = hashlib.sha256()
        with path.open('rb') as source:
            for chunk in iter(lambda: source.read(1024*1024), b''):
                digest.update(chunk)
        result[path.relative_to(root).as_posix()] = digest.hexdigest()
    return result


def verify(root):
    root = Path(root).resolve()
    expected = json.loads((root/'package-manifest.json').read_text(encoding='utf8'))
    if expected.get('format') != 1 or hashes(root) != expected.get('files'):
        raise RuntimeError('offline package bytes differ from manifest')
    return expected


def copy_runtimes(root, payload):
    runtime = payload/'runtime'
    runtime.mkdir()
    python = Path(sys.base_prefix)
    out = runtime/'python'
    out.mkdir()
    for name in ('python.exe', 'pythonw.exe', 'python3.dll'):
        shutil.copy2(python/name, out/name)
    for pattern in ('python3*.dll', 'vcruntime*.dll'):
        for path in python.glob(pattern):
            shutil.copy2(path, out/path.name)
    for folder in ('DLLs', 'Lib'):
        reject_links(python/folder)
        shutil.copytree(python/folder, out/folder,
                        ignore=shutil.ignore_patterns('site-packages', '__pycache__', 'test', 'tests', 'sitecustomize.py', 'usercustomize.py', '*.pth'))
    import websocket
    package = Path(websocket.__file__).parent
    reject_links(package)
    shutil.copytree(package, out/'Lib/site-packages/websocket', ignore=shutil.ignore_patterns('__pycache__', 'tests'))
    node = Path(shutil.which('node') or '')
    if not node.is_file() or node.name.lower() != 'node.exe':
        raise RuntimeError('Windows Node executable is required')
    (runtime/'node').mkdir()
    shutil.copy2(node, runtime/'node/node.exe')
    # Only the Git binary and its DLLs, never host config, credentials or history.
    git = Path(shutil.which('git') or '').resolve().parent.parent/'mingw64/bin'
    if not (git/'git.exe').is_file():
        raise RuntimeError('standard Git for Windows runtime is required')
    (runtime/'git').mkdir()
    for path in [git/'git.exe', *git.glob('*.dll')]:
        shutil.copy2(path, runtime/'git'/path.name)
    modules = root/'node_modules'
    reject_links(modules)
    lock = json.loads((root/'package-lock.json').read_text(encoding='utf8'))
    for name, entry in lock['packages'].items():
        if not name:
            continue
        package_json = root/name/'package.json'
        if not package_json.exists() and entry.get('optional'):
            continue
        if not package_json.is_file() or json.loads(package_json.read_text(encoding='utf8')).get('version') != entry['version']:
            raise RuntimeError('host Node dependencies differ from lockfile: '+name)
    shutil.copytree(modules, payload/'source/node_modules', ignore=shutil.ignore_patterns('.cache', '.bin'))
    from browser_harness import find_browser
    browser = Path(find_browser() or '')
    if not browser.is_file() or browser.name.lower() not in ('chrome.exe', 'msedge.exe'):
        raise RuntimeError('an installed Chrome or Edge application runtime is required')
    library = 'chrome.dll' if browser.name.lower() == 'chrome.exe' else 'msedge.dll'
    versions = [p for p in browser.parent.iterdir()
                if p.is_dir() and all(v.isdigit() for v in p.name.split('.')) and (p/library).is_file()]
    if not versions:
        raise RuntimeError('browser application version directory was not found')
    # Select executable application files only. Profiles, updater state and user
    # data are outside this allowlist, even for a per-user browser installation.
    browser_out = runtime/'browser'
    browser_out.mkdir()
    shutil.copy2(browser, browser_out/browser.name.lower())
    for version in versions:
        reject_links(version)
        shutil.copytree(version, browser_out/version.name, ignore=shutil.ignore_patterns('Installer'))


def sandbox_config(payload, evidence):
    xml = ET.Element('Configuration')
    for tag in ('VGpu', 'Networking', 'AudioInput', 'VideoInput', 'PrinterRedirection', 'ClipboardRedirection'):
        ET.SubElement(xml, tag).text = 'Disable'
    ET.SubElement(xml, 'MemoryInMB').text = '4096'
    folders = ET.SubElement(xml, 'MappedFolders')
    for host, guest, readonly in [(payload, 'C:\\NetunimLabPackage', 'true'),
                                 (evidence, 'C:\\NetunimLabEvidence', 'false')]:
        folder = ET.SubElement(folders, 'MappedFolder')
        ET.SubElement(folder, 'HostFolder').text = str(host)
        ET.SubElement(folder, 'SandboxFolder').text = guest
        ET.SubElement(folder, 'ReadOnly').text = readonly
    ET.SubElement(ET.SubElement(xml, 'LogonCommand'), 'Command').text = (
        'powershell.exe -NoProfile -ExecutionPolicy Bypass -File '
        'C:\\NetunimLabPackage\\source\\tools\\start-test-lab.ps1')
    return ET.tostring(xml, encoding='unicode')


def prepare(root):
    if os.name != 'nt':
        raise RuntimeError('offline Windows preparation requires a Windows host')
    def git(*args):
        return subprocess.check_output(['git', *args], cwd=root, text=True, encoding='utf8').strip()
    if git('status', '--porcelain'):
        raise RuntimeError('commit the reviewed source before preparing the lab')
    directory = Path(tempfile.mkdtemp(prefix='netunim-windows-lab-')).resolve()
    payload, evidence = directory/'payload', directory/'evidence'
    payload.mkdir()
    evidence.mkdir()
    identity = {'format': 1, 'source_sha': git('rev-parse', 'HEAD'), 'source_tree': git('rev-parse', 'HEAD^{tree}'),
                'synthetic_only': True, 'networking': 'disabled'}
    (directory/'lab-owner.json').write_text(json.dumps(identity), encoding='utf8')
    (evidence/'lab-owner.json').write_text(json.dumps(identity), encoding='utf8')
    archive = directory/'source.zip'
    subprocess.run(['git', 'archive', '--format=zip', '-o', str(archive), 'HEAD'], cwd=root, check=True)
    extract_snapshot(archive, payload/'source')
    archive.unlink()
    copy_runtimes(root, payload)
    (payload/'package-source.json').write_text(json.dumps(identity), encoding='utf8')
    manifest = {'format': 1, 'files': hashes(payload)}
    (payload/'package-manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf8')
    verify(payload)
    (directory/'NetunimLab.wsb').write_text(sandbox_config(payload, evidence), encoding='utf8')
    return directory/'NetunimLab.wsb'


if __name__ == '__main__':
    if len(sys.argv) != 3 or sys.argv[1] != '--verify':
        raise SystemExit('usage: test_lab_package.py --verify PACKAGE')
    verify(Path(sys.argv[2]))
    print('PASS offline package manifest')
