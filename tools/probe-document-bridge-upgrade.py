"""Run owned historical Bridge listeners on a disposable loopback port."""
import argparse
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import tempfile
import time
import zipfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path)
parser.add_argument('--from-revision', help='Test one pinned existing runtime instead of repeating the historical chain')
args = parser.parse_args()
if os.name != 'nt':
    parser.error('This opt-in native listener probe requires Windows.')
if not __debug__:
    parser.error('Run without Python optimization so ownership assertions remain active.')
ROOT = Path(__file__).resolve().parents[1]
(ROOT / '.work').mkdir(exist_ok=True)
output = args.output or ROOT / '.work/native-upgrade-evidence.json'
SOURCE = ROOT / 'netunim-orders/document-bridge'
PREFIX = 'netunim-orders/document-bridge/'
HISTORY = [('38', 'cbe8f80a0fecf7644ff35a4e08cdff0ddca037a5'),
           ('39', '530ea4832d094d84b5ffd3e9718e355fbf5f2cef'),
           ('40', 'b062c1cccbc77ade2b2dc2cca5cb053621bf66db')]
report = {'kind': 'isolated-native-listener-upgrade', 'stages': [],
          'installerExecuted': False, 'providersUsed': False}
children = []

def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)

def sha(data):
    return hashlib.sha256(data).hexdigest()

with tempfile.TemporaryDirectory(prefix='bridge-upgrade-', dir=ROOT / '.work') as folder:
    app = Path(folder).resolve()
    assert app.parent == (ROOT / '.work').resolve()
    with socket.socket() as reserved:
        reserved.bind(('127.0.0.1', 0))
        port = reserved.getsockname()[1]
    report['disposablePort'] = port
    private_name = 'node-v24.21.0-win-x64-20261022-000000-1-1234abcd'
    private = app / private_name
    private.mkdir()
    with zipfile.ZipFile(SOURCE / 'node-v24.21.0-win-x64.zip') as archive:
        binary = archive.read('node-v24.21.0-win-x64/node.exe')
    expected = re.search(r"BRIDGE_NODE_WIN_X64_SHA256='([a-f0-9]+)'", (SOURCE / 'lib.mjs').read_text(encoding='utf8')).group(1)
    assert sha(binary) == expected
    executable = private / 'node.exe'
    executable.write_bytes(binary)
    (app / 'node-runtime.txt').write_text(private_name, encoding='utf8')
    fake_es = app / 'not-everything.exe'
    shutil.copyfile(executable, fake_es)
    env = {**os.environ, 'NETUNIM_DOCUMENT_BRIDGE_HOME': str(app),
           'NETUNIM_EVERYTHING_ES_PATH': str(fake_es)}
    report['privateNodeSha256'] = sha(binary)
    report['portSubstitution'] = 'Only the disposable lib.mjs BRIDGE_PORT was changed.'
    report['currentSource'] = git('rev-parse', 'HEAD').decode().strip()
    report['dirty'] = bool(git('status', '--porcelain').strip())

    def request():
        connection = http.client.HTTPConnection('127.0.0.1', port, timeout=2)
        try:
            connection.request('GET', '/health')
            response = connection.getresponse()
            assert response.status == 200
            return json.loads(response.read())
        finally:
            connection.close()

    def command(runtime, *args, success=True):
        result = subprocess.run([str(executable), str(runtime / 'server.mjs'), *args],
                                env=env, cwd=app, capture_output=True, timeout=20,
                                creationflags=subprocess.CREATE_NO_WINDOW)
        if success:
            assert result.returncode == 0, result.stderr.decode('utf8', errors='replace')
        else:
            assert result.returncode != 0
            assert b'HEALTHCHECK_FAILED' in result.stderr or b'health check failed' in result.stderr
        return result.returncode

    previous = None
    token_digest = None
    try:
        current_version = re.search(r'BRIDGE_VERSION=(\d+);', (SOURCE / 'lib.mjs').read_text(encoding='utf8')).group(1)
        history = HISTORY
        if args.from_revision:
            revision = git('rev-parse', '--verify', args.from_revision + '^{commit}').decode().strip()
            old_lib = git('show', revision + ':' + PREFIX + 'lib.mjs').decode('utf8')
            old_version = re.search(r'BRIDGE_VERSION=(\d+);', old_lib).group(1)
            assert int(old_version) < int(current_version), 'replacement must advance the runtime version'
            history = [(old_version, revision)]
        for version, revision in [*history, (current_version, None)]:
            runtime = app / ('app-v' + version)
            runtime.mkdir()
            if revision:
                names = git('ls-tree', '--name-only', revision + ':' + PREFIX.rstrip('/')).decode().splitlines()
                sources = {name: git('show', revision + ':' + PREFIX + name)
                           for name in names if name.endswith('.mjs')}
            else:
                sources = {path.name: path.read_bytes() for path in SOURCE.glob('*.mjs')}
            original_lib = sources['lib.mjs']
            assert f'BRIDGE_VERSION={version};'.encode() in original_lib
            assert original_lib.count(b'BRIDGE_PORT=8766;') == 1
            sources['lib.mjs'] = original_lib.replace(b'BRIDGE_PORT=8766;', f'BRIDGE_PORT={port};'.encode())
            for name, data in sources.items():
                (runtime / name).write_bytes(data)
            stage = {'version': int(version), 'revision': revision or report['currentSource'],
                     'originalLibSha256': sha(original_lib), 'modules': len(sources),
                     'stagedModulesSha256': sha(b''.join(name.encode()+b'\0'+sources[name] for name in sorted(sources)))}
            command(runtime, '--init')
            current_digest = sha((app / 'bridge-token.txt').read_bytes())
            if token_digest is None:
                token_digest = current_digest
            assert current_digest == token_digest
            config_digest = sha((app / 'config.json').read_bytes())
            if previous:
                # Check the owned listener immediately before invoking the real
                # replacement CLI. No command ever targets the installed port.
                assert request()['pid'] == previous.pid
                stage['oldVersionCheckRejected'] = command(runtime, '--check-running', success=False) != 0
                command(runtime, '--stop-existing')
                previous.communicate(timeout=10)
                assert previous.returncode == 0
                stage['oldOwnedProcessExitedCleanly'] = True
            child = subprocess.Popen([str(executable), str(runtime / 'server.mjs')],
                                     env=env, cwd=app, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                     creationflags=subprocess.CREATE_NO_WINDOW)
            children.append(child)
            deadline = time.monotonic() + 10
            while True:
                try:
                    health = request()
                    break
                except OSError:
                    if child.poll() is not None or time.monotonic() >= deadline:
                        raise RuntimeError('owned Bridge did not become ready')
                    time.sleep(.025)
            assert health['pid'] == child.pid
            assert health['service'] == 'netunim-orders-document-bridge'
            assert health['version'] == int(version)
            command(runtime, '--check-running')
            assert sha((app / 'bridge-token.txt').read_bytes()) == token_digest
            assert sha((app / 'config.json').read_bytes()) == config_digest
            stage.update({'newVersionCheckPassed': True, 'tokenPreserved': True, 'configurationPreserved': True})
            report['stages'].append(stage)
            previous = child
        assert request()['pid'] == previous.pid
        command(runtime, '--stop-existing')
        previous.communicate(timeout=10)
        assert previous.returncode == 0
        report['finalShutdownClean'] = True
    finally:
        for child in children:
            if child.poll() is None:
                child.kill()
                child.communicate(timeout=10)
        report['allOwnedProcessesExited'] = all(child.poll() is not None for child in children)
        output.write_text(json.dumps(report, indent=2) + '\n', encoding='utf8')
print(json.dumps(report, indent=2))
