"""Negative safety gates execute without contacting any external resource."""
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import os
import tempfile
import unittest
import copy
import json

from acceptance_safety import browser_preflight, contained, postgres_environment, sandbox_config
from isolated_supabase import IsolatedSupabase, isolated_environment, loopback_url, LABEL, NoRedirect, clean_diagnostics


class SafetyContracts(unittest.TestCase):
    def test_diagnostics_redact_generated_secrets_but_keep_sql_failures(self):
        value = clean_diagnostics('API key: eyJfake.generated.secret\n'
            'postgresql://postgres:private@127.0.0.1:19471/postgres\n'
            'sb_secret_privateopaque\nERROR: duplicate key value violates unique constraint backup_owner_revision_key')
        for secret in ('eyJfake.generated.secret', 'postgres:private', 'sb_secret_privateopaque'):
            self.assertNotIn(secret, value)
        self.assertIn('duplicate key value', value)

    def test_full_stack_refuses_workstation_before_creating_resources(self):
        with patch.dict(os.environ, {'GITHUB_ACTIONS': 'false'}), \
             patch('isolated_supabase.tempfile.mkdtemp', side_effect=AssertionError('must not allocate')):
            with self.assertRaisesRegex(RuntimeError, 'disposable'):
                IsolatedSupabase()

    def test_stack_strips_remote_credentials_and_targets(self):
        with patch.dict(os.environ, {'SUPABASE_ACCESS_TOKEN': 'real', 'DOCKER_CONTEXT': 'remote',
            'DOCKER_HOST': 'tcp://production:2375', 'AWS_SECRET_ACCESS_KEY': 'real', 'S3_KEY': 'real',
            'SMTP_PASSWORD': 'real', 'PGHOSTADDR': '192.0.2.1', 'HTTPS_PROXY': 'http://external'}):
            env = isolated_environment(Path('/disposable'))
        self.assertEqual(env['DOCKER_HOST'], 'unix:///var/run/docker.sock')
        self.assertEqual(env['HOME'], str(Path('/disposable')/'home'))
        for key in ('SUPABASE_ACCESS_TOKEN', 'DOCKER_CONTEXT', 'AWS_SECRET_ACCESS_KEY', 'S3_KEY',
                    'SMTP_PASSWORD', 'PGHOSTADDR', 'HTTPS_PROXY'):
            self.assertNotIn(key, env)
        for value in ('https://production.supabase.co', 'https://127.0.0.1:8765',
                      'http://127.0.0.1:19471', 'https://localhost:19471',
                      'https://127.0.0.1:19471@production.supabase.co', 'https://127.0.0.1:19471/path'):
            with self.subTest(value=value), self.assertRaises(RuntimeError):
                loopback_url(value, 19471)
        with self.assertRaisesRegex(RuntimeError, 'redirect'):
            NoRedirect().redirect_request(None, None, 302, '', {}, 'https://production.supabase.co')

    def test_actual_container_mount_network_and_binding_must_be_owned(self):
        with tempfile.TemporaryDirectory(prefix='netunim-supabase-') as directory:
            root = Path(directory)
            stack = IsolatedSupabase.__new__(IsolatedSupabase)
            stack.root, stack.project, stack.network = root, 'owned', 'owned-network'
            stack.containers = {'supabase_db_owned': 'owned-id', 'supabase_kong_owned': 'kong-id'}
            stack.db_port, stack.api_port = 19471, 19472
            network = {'Labels': {LABEL: 'owned'}, 'Internal': True,
                       'Options': {'com.docker.network.bridge.host_binding_ipv4': '127.0.0.1'}}
            item = {'Config': {'Labels': {LABEL: 'owned'}}, 'NetworkSettings': {'Networks': {'owned-network': {}},
                    'Ports': {'5432/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '19471'}]}},
                    'HostConfig': {'Privileged': False, 'PortBindings': {'5432/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '19471'}]}},
                    'Mounts': [{'Type': 'bind', 'Source': str(root/'new-db')}]}
            kong = copy.deepcopy(item)
            kong['NetworkSettings']['Ports']['5432/tcp'][0]['HostPort'] = '19472'
            def run(*args):
                return json.dumps([network if args[1] == 'network' else kong if args[-1] == 'kong-id' else current])
            current = item
            with patch.object(stack, 'run', side_effect=run), patch.object(stack, 'firewall'):
                stack.attest_resources()
                for mutate in (
                    lambda x: x['Mounts'][0].update(Source=str(root.parent/'real-data')),
                    lambda x: x['Config']['Labels'].update({LABEL: 'foreign'}),
                    lambda x: x['NetworkSettings']['Ports']['5432/tcp'][0].update(HostIp='0.0.0.0'),
                    lambda x: x['NetworkSettings']['Ports']['5432/tcp'][0].update(HostPort='19473'),
                    lambda x: x['NetworkSettings']['Networks'].update({'external-network': {}}),
                    lambda x: x['HostConfig'].update(Privileged=True)):
                    current = copy.deepcopy(item)
                    mutate(current)
                    with self.assertRaises(RuntimeError):
                        stack.attest_resources()
                current = item
                network['EnableIPv6'] = True
                with self.assertRaises(RuntimeError):
                    stack.attest_resources()

    def test_libpq_destination_and_service_environment_cannot_escape(self):
        with patch.dict(os.environ, {'PGHOSTADDR': '192.0.2.1', 'PGSERVICE': 'production',
                                     'PGSSLCERT': '/private/cert', 'PGFUTUREOPTION': 'unsafe',
                                     'PGPASSFILE': '/private/passwords'}):
            env = postgres_environment()
        self.assertEqual({key: value for key, value in env.items() if key.upper().startswith('PG')},
                         {'PGCLIENTENCODING': 'UTF8', 'PGPASSFILE': os.devnull})

    def test_config_origin_profile_and_storage_are_checked_before_launch(self):
        with tempfile.TemporaryDirectory(prefix='netunim-safety-') as directory, \
             tempfile.TemporaryDirectory(prefix='netunim-profile-') as profile:
            root = Path(directory).resolve()
            config = root / 'site/supabase/config.js'
            config.parent.mkdir(parents=True)
            expected = sandbox_config("'https://example.invalid'")
            config.write_text(expected, encoding='utf8')
            session = SimpleNamespace(tmp=root, profile=Path(profile).resolve(), downloads=root/'downloads',
                                      service_worker=False, url='http://127.0.0.1:19471/index.html',
                                      origin_owner=None, httpd=SimpleNamespace(server_address=('127.0.0.1', 19471)))
            self.assertEqual(browser_preflight(session), '127.0.0.1:19471')
            production = Path(__file__).resolve().parents[1]/'netunim-kupa/site/supabase/config.js'
            config.write_text(production.read_text(encoding='utf8'), encoding='utf8')
            with self.assertRaisesRegex(RuntimeError, 'Supabase'):
                browser_preflight(session)
            config.write_text(expected, encoding='utf8')
            for field, unsafe in [('url', 'https://test.supabase.co'), ('url', 'http://127.0.0.1:8765'),
                                  ('url', 'http://127.0.0.1:19472'), ('profile', root.parent),
                                  ('downloads', root.parent/'Downloads')]:
                original = getattr(session, field)
                setattr(session, field, unsafe)
                with self.subTest(field=field, unsafe=str(unsafe)), self.assertRaises(RuntimeError):
                    browser_preflight(session)
                setattr(session, field, original)
            with self.assertRaisesRegex(RuntimeError, 'escapes'):
                contained(root, root/'..'/'outside')


if __name__ == '__main__':
    unittest.main()
