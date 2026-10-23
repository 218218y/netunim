"""Disposable full Supabase, restricted to an ephemeral GitHub Linux runner.

No linked project, inherited login, remote Docker context, imported data or keys.
Start the empty platform first; attest its actual containers before app migrations.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import socket
import ssl
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

from acceptance_safety import contained, temporary_root

ROOT = Path(__file__).resolve().parents[1]
LABEL = 'com.supabase.cli.project'
CLI_VERSION = '2.121.0'


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        raise RuntimeError('local Supabase attempted an unverified redirect')


def isolated_environment(root):
    # Do not depend on recognizing every future provider credential variable.
    env = {k: os.environ[k] for k in ('PATH', 'LD_LIBRARY_PATH', 'LANG', 'LC_ALL', 'TERM', 'NO_COLOR') if k in os.environ}
    env.update(HOME=str(root/'home'), XDG_CONFIG_HOME=str(root/'home/config'),
               DOCKER_HOST='unix:///var/run/docker.sock', DOCKER_CONFIG=str(root/'docker-config'),
               SUPABASE_TELEMETRY_DISABLED='true', PGCLIENTENCODING='UTF8', PGPASSFILE=os.devnull)
    return env


def loopback_url(value, port):
    url = urllib.parse.urlsplit(value)
    if (url.scheme != 'https' or url.hostname != '127.0.0.1' or url.port != port
            or url.username or url.password or url.path not in ('', '/') or url.query or url.fragment
            or port in (8765, 8766)):
        raise RuntimeError('Supabase target is not its owned HTTPS listener')
    return value.rstrip('/')


def clean_diagnostics(value):
    # CLI start/status can print generated keys, DB credentials and mail links.
    value = re.sub(r'eyJ[A-Za-z0-9_.-]+', '[redacted JWT]', value)
    value = re.sub(r'sb_(?:publishable|secret)_[A-Za-z0-9_-]+', '[redacted API key]', value)
    value = re.sub(r'(?i)(postgres(?:ql)?://)[^\s]+', r'\1[redacted]', value)
    return '\n'.join(line for line in value.splitlines()
                     if not re.search(r'(?i)api.?key|secret.?key|jwt.?secret|access.?token|refresh.?token|'
                                      r'publishable.?key|service.?role.?key|password\s*[:=]|credential\s*[:=]', line))[-4000:]


class IsolatedSupabase:
    def __init__(self):
        if (os.name != 'posix' or os.environ.get('GITHUB_ACTIONS') != 'true'
                or os.environ.get('RUNNER_ENVIRONMENT') != 'github-hosted'
                or os.environ.get('RUNNER_OS') != 'Linux'):
            raise RuntimeError('full Supabase acceptance requires a disposable GitHub-hosted Linux runner')
        self.root = Path(tempfile.mkdtemp(prefix='netunim-supabase-'))
        self.project = 'netunim-acceptance-' + secrets.token_hex(10)
        self.network = self.project
        self.env = isolated_environment(self.root)
        for path in ('home/config', 'docker-config', 'certs'):
            (self.root/path).mkdir(parents=True)
        self.started = False
        self.network_created = False
        self.firewall_created = False
        self.chain = 'NETUNIM_'+secrets.token_hex(6)
        self.containers = {}
        self.anon = self.service = ''
        self.db_password = ''
        self.marker = secrets.token_hex(32)
        self.migrations = {}

    def run(self, *args, input=None, timeout=180):
        result = subprocess.run(args, input=input, capture_output=True, text=True,
                                encoding='utf8', env=self.env, cwd=self.root, timeout=timeout)
        if result.returncode:
            raise RuntimeError(f'{args[0]} {args[1]} failed ({result.returncode}): '
                               + clean_diagnostics(result.stdout+'\n'+result.stderr))
        return result.stdout.strip()

    def cli(self, *args, **kwargs):
        return self.run('supabase', *args, '--workdir', str(self.root), **kwargs)

    def __enter__(self):
        try:
            self.start()
            return self
        except BaseException:
            self.__exit__(None, None, None)
            raise

    def start(self):
        temporary_root(self.root, 'netunim-supabase-')
        if self.run('supabase', '--version') != CLI_VERSION:
            raise RuntimeError('Supabase CLI version differs from the reviewed pin')
        if not Path('/var/run/docker.sock').is_socket():
            raise RuntimeError('the local Docker Unix socket is unavailable')
        # No resources may predate this run's random identity.
        for kind in ('container', 'volume', 'network'):
            if self.run('docker', kind, 'ls', '-q', '--filter', f'label={LABEL}={self.project}'):
                raise RuntimeError('Supabase project identity is already in use')
        self.cli('init')
        ports = []
        for _ in range(5):
            with socket.socket() as listener:
                listener.bind(('127.0.0.1', 0))
                port = listener.getsockname()[1]
            if port in ports or port in (8765, 8766):
                raise RuntimeError('test port allocation collided')
            ports.append(port)
        self.api_port, self.db_port, shadow, studio, mail = ports
        self.url = loopback_url(f'https://127.0.0.1:{self.api_port}', self.api_port)
        cert = self.root/'certs/cert.pem'
        key = self.root/'certs/key.pem'
        self.run('openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2',
                 '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1',
                 '-keyout', str(key), '-out', str(cert))
        os.chmod(key, 0o600)
        pub = self.run('openssl', 'x509', '-in', str(cert), '-pubkey', '-noout')
        der = subprocess.check_output(['openssl', 'pkey', '-pubin', '-outform', 'DER'],
                                      input=pub.encode(), env=self.env, cwd=self.root)
        self.spki = base64.b64encode(hashlib.sha256(der).digest()).decode()
        self.opener = urllib.request.build_opener(NoRedirect(), urllib.request.ProxyHandler({}),
            urllib.request.HTTPSHandler(context=ssl.create_default_context(cafile=str(cert))))
        # A fresh minimal local project: no remote ref, no production .env/config,
        # no provider credentials, seeding, edge functions, analytics or AI.
        (self.root/'supabase/config.toml').write_text(f'''project_id = "{self.project}"
[api]
enabled = true
port = {self.api_port}
schemas = ["public", "graphql_public"]
extra_search_path = ["public", "extensions"]
max_rows = 1000
[api.tls]
enabled = true
cert_path = "../certs/cert.pem"
key_path = "../certs/key.pem"
[db]
port = {self.db_port}
shadow_port = {shadow}
major_version = 17
[db.seed]
enabled = false
[db.pooler]
enabled = false
[realtime]
enabled = false
[studio]
enabled = false
port = {studio}
[local_smtp]
enabled = false
port = {mail}
[storage]
enabled = true
file_size_limit = "5MiB"
[storage.vector]
enabled = false
[auth]
enabled = true
site_url = "http://127.0.0.1"
additional_redirect_urls = []
enable_signup = false
enable_refresh_token_rotation = true
refresh_token_reuse_interval = 0
[auth.email]
enable_signup = true
enable_confirmations = false
[analytics]
enabled = false
''', encoding='utf8')
        # Docker does not publish ports on an internal-only network. Use its
        # ordinary loopback-published bridge with an owned egress firewall chain.
        # Image pulls are performed by the host daemon, outside this bridge.
        self.run('docker', 'network', 'create', '--label', f'{LABEL}={self.project}',
                 '-o', 'com.docker.network.bridge.host_binding_ipv4=127.0.0.1', self.network)
        self.network_created = True
        network = json.loads(self.run('docker', 'network', 'inspect', self.network))[0]
        self.bridge = 'br-'+network['Id'][:12]
        self.subnet = network['IPAM']['Config'][0]['Subnet']
        self.firewall('new')
        self.started = True  # cleanup partial starts too
        print('Starting the empty isolated Supabase platform', flush=True)
        self.cli('start', '--network-id', self.network, '-x',
                 'realtime,studio,imgproxy,mailpit,postgres-meta,edge-runtime,logflare,vector,supavisor', timeout=900)
        ids = self.run('docker', 'ps', '-aq', '--filter', f'label={LABEL}={self.project}').splitlines()
        for cid in ids:
            item = json.loads(self.run('docker', 'inspect', cid))[0]
            self.containers[item['Name'].removeprefix('/')] = cid
        self.db = self.containers.get('supabase_db_'+self.project)
        if not self.db:
            raise RuntimeError('the owned database container is missing')
        self.attest_resources()
        self._sql("create schema netunim_acceptance; create table netunim_acceptance.identity(marker text); "
                  +"insert into netunim_acceptance.identity values ('"+self.marker+"');")
        self.preflight()
        status = json.loads(self.cli('status', '-o', 'json'))
        if loopback_url(status['API_URL'], self.api_port) != self.url:
            raise RuntimeError('CLI reported a different API listener')
        self.anon, self.service = status['ANON_KEY'], status['SERVICE_ROLE_KEY']
        database_url = urllib.parse.urlsplit(status['DB_URL'])
        if (database_url.hostname != '127.0.0.1' or database_url.port != self.db_port
                or database_url.username != 'postgres' or database_url.path != '/postgres'):
            raise RuntimeError('CLI database URL differs from the owned listener')
        self.db_password = urllib.parse.unquote(database_url.password or '')
        if len(self.anon) < 30 or self.anon == self.service:
            raise RuntimeError('the local stack did not provide distinct API roles')
        print('Applying the original migration chain to the attested empty platform', flush=True)
        destination = contained(self.root, self.root/'supabase/migrations')
        destination.mkdir(exist_ok=True)
        self.postgres_was_superuser = self._sql("select rolsuper from pg_roles where rolname='postgres';")
        # This historical catalog reconstruction includes platform-owned default
        # ACLs and a postgres-owned event trigger. A restore needs bootstrap
        # superuser authority, but the HTTP/runtime tests must use the platform's
        # original role attributes. No migration SQL is rewritten or omitted.
        self._sql('alter role postgres superuser;', role='supabase_admin')
        try:
            for source in sorted((ROOT/'supabase/migrations').glob('*.sql')):
                shutil.copyfile(source, destination/source.name)
                self.migrations[source.name] = hashlib.sha256(source.read_bytes()).hexdigest()
                print('Replay', source.name, flush=True)
                self._sql(source.read_text(encoding='utf8'))
        finally:
            if self.postgres_was_superuser == 'f':
                self._sql('alter role postgres nosuperuser;', role='supabase_admin')
        if self._sql("select rolsuper from pg_roles where rolname='postgres';") != self.postgres_was_superuser:
            raise RuntimeError('bootstrap privileges were not restored before runtime acceptance')
        self._sql("notify pgrst, 'reload schema';")
        # PostgREST's schema cache notification is asynchronous.
        for _ in range(60):
            code, _ = self.request('/rest/v1/rpc/get_netunim_sync_capabilities', {}, token=self.service)
            if code != 404:
                break
            time.sleep(.5)
        else:
            raise RuntimeError('PostgREST did not load the migrated RPC catalog')

    def attest_resources(self):
        temporary_root(self.root, 'netunim-supabase-')
        network = json.loads(self.run('docker', 'network', 'inspect', self.network))[0]
        if (network.get('Labels', {}).get(LABEL) != self.project or network.get('EnableIPv6')
                or network['Options'].get('com.docker.network.bridge.host_binding_ipv4') != '127.0.0.1'):
            raise RuntimeError('Docker network isolation cannot be proven')
        self.firewall('check')
        published = set()
        for name, cid in self.containers.items():
            item = json.loads(self.run('docker', 'inspect', cid))[0]
            if (item['Config']['Labels'].get(LABEL) != self.project or not name.endswith('_'+self.project)
                    or set(item['NetworkSettings']['Networks']) != {self.network}
                    or item['HostConfig']['Privileged'] or item['HostConfig'].get('PidMode') == 'host'):
                raise RuntimeError('a Supabase container escaped its project')
            # HostConfig stores requested defaults (often HostIp=''); inspect
            # the actual published mapping after Docker applies network options.
            for bindings in item['NetworkSettings']['Ports'].values():
                for binding in bindings or []:
                    if binding['HostIp'] not in ('127.0.0.1', '::1') or int(binding['HostPort']) in (8765, 8766):
                        raise RuntimeError('Supabase published a non-isolated port')
                    published.add((name, int(binding['HostPort'])))
            for mount in item['Mounts']:
                if mount['Type'] == 'bind':
                    contained(self.root, mount['Source'])
                elif mount['Type'] == 'volume':
                    volume = json.loads(self.run('docker', 'volume', 'inspect', mount['Name']))[0]
                    if (volume.get('Labels') or {}).get(LABEL) != self.project:
                        raise RuntimeError('Supabase reused an unowned volume')
                elif mount['Type'] != 'tmpfs':
                    raise RuntimeError('unrecognized Supabase storage destination')
        if not {('supabase_db_'+self.project, self.db_port),
                ('supabase_kong_'+self.project, self.api_port)} <= published:
            raise RuntimeError('the actual API/database port mapping is not owned by this stack')
        if (self.root/'supabase/.temp/project-ref').exists():
            raise RuntimeError('a linked remote project was found')

    def firewall(self, action):
        rules = [
            (self.chain, '-m', 'conntrack', '--ctstate', 'ESTABLISHED,RELATED', '-j', 'RETURN'),
            (self.chain, '-d', self.subnet, '-j', 'RETURN'),
            (self.chain, '-j', 'REJECT'),
            ('DOCKER-USER', '-i', self.bridge, '-j', self.chain),
            ('INPUT', '-i', self.bridge, '-m', 'conntrack', '--ctstate', 'NEW', '-j', 'REJECT'),
        ]
        if action == 'new':
            self.run('sudo', '-n', 'iptables', '-w', '-N', self.chain)
            self.firewall_created = True
        for rule in (reversed(rules) if action == 'remove' else rules):
            operation = '-C' if action == 'check' else '-D' if action == 'remove' else '-I' if rule[0] in ('DOCKER-USER', 'INPUT') else '-A'
            self.run('sudo', '-n', 'iptables', '-w', operation, *rule)
        if action == 'remove':
            self.run('sudo', '-n', 'iptables', '-w', '-X', self.chain)

    def _sql(self, sql, *, role='postgres'):
        # Retention's inet_server_port() contract must observe the real server
        # port; a Unix socket returns NULL. Keep SQL inside the attested DB
        # container, using only its newly generated local connection secret.
        tcp = role == 'postgres' and self.db_password
        environment = ['-e', 'PGPASSWORD='+self.db_password] if tcp else []
        connection = ['-h', '127.0.0.1', '-p', '5432'] if tcp else []
        return self.run('docker', 'exec', '-i', *environment, self.db, 'psql', '-X', '-A', '-t', *connection,
                        '-v', 'ON_ERROR_STOP=1', '-U', role, '-d', 'postgres', input=sql)

    def preflight(self):
        self.attest_resources()
        if self._sql('select marker from netunim_acceptance.identity;') != self.marker:
            raise RuntimeError('database challenge does not match its owned container')
        return self.url

    def browser_config(self):
        self.preflight()
        loopback_url(self.url, self.api_port)
        if not self.anon:
            raise RuntimeError('the stack is not ready for a browser')
        return 'export const supabaseConfig=Object.freeze('+json.dumps(
            {'url': self.url, 'publishableKey': self.anon}, separators=(',', ':'))+');\n'

    def browser_arguments(self):
        self.preflight()
        return ['--ignore-certificate-errors-spki-list='+self.spki]

    def sql(self, sql):
        self.preflight()
        return self._sql(sql)

    def request(self, path, body=None, *, token=None, method=None, raw=False, content_type='application/json'):
        if not path.startswith(('/auth/v1/', '/rest/v1/', '/storage/v1/')) or '..' in path:
            raise RuntimeError('unrecognized local Supabase API path')
        loopback_url(self.url, self.api_port)
        self.preflight()
        headers = {'apikey': self.anon, 'Content-Type': content_type}
        if token:
            headers['Authorization'] = 'Bearer '+token
        data = body if isinstance(body, bytes) else json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(self.url+path, data=data, headers=headers, method=method)
        try:
            response = self.opener.open(request, timeout=30)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            payload = response.read()
            return response.status, payload if raw else json.loads(payload) if payload else None

    def evidence(self):
        self.preflight()
        return {'kind': 'real-local-supabase', 'project': self.project, 'api': self.url,
                'container_egress_firewall': True, 'certificate_spki': self.spki,
                'cli_version': CLI_VERSION, 'migration_sha256': self.migrations,
                'migration_bootstrap': 'temporarily elevated local postgres for original catalog restore; no migration rewriting',
                'runtime_postgres_superuser': self._sql("select rolsuper from pg_roles where rolname='postgres';"),
                'original_postgres_superuser': self.postgres_was_superuser,
                'images': {name.split('_'+self.project)[0]:
                    {key: value for key, value in json.loads(self.run('docker', 'inspect', cid))[0].items()
                     if key == 'Image'} | {'tag': json.loads(self.run('docker', 'inspect', cid))[0]['Config']['Image']}
                    for name, cid in self.containers.items()},
                'harness_sha256': {name: hashlib.sha256((ROOT/'tests'/name).read_bytes()).hexdigest()
                    for name in ('isolated_supabase.py', 'runtime_supabase_stack.py')},
                'postgres': self._sql('show server_version;'),
                'realtime': 'NOT APPLICABLE: application uses BroadcastChannel, no Supabase Realtime calls',
                'isolation_boundary': 'owned Docker bridge with verified egress firewall and browser deny proxy; not an OS sandbox'}

    def __exit__(self, *_args):
        try:
            if self.started:
                # CLI is scoped by our generated config identity, never --all.
                self.cli('stop', '--no-backup', timeout=180)
            if self.network_created:
                remaining = self.run('docker', 'network', 'ls', '-q', '--filter', f'label={LABEL}={self.project}')
                if remaining:
                    self.run('docker', 'network', 'rm', self.network)
            for kind in ('container', 'volume', 'network'):
                if self.run('docker', kind, 'ls', '-q', '--filter', f'label={LABEL}={self.project}'):
                    raise RuntimeError('owned Supabase resources remained after cleanup')
        finally:
            try:
                if self.firewall_created:
                    self.firewall('remove')
            finally:
                root = temporary_root(self.root, 'netunim-supabase-')
                shutil.rmtree(root)
