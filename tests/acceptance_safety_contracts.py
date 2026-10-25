"""Negative safety gates execute without contacting any external resource."""
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import os
import tempfile
import unittest
import copy
import json
import http.server
import socket

from acceptance_safety import browser_preflight, contained, postgres_environment, sandbox_config, OwnedHTTPServer, DenyProxy
from isolated_supabase import IsolatedSupabase, isolated_environment, loopback_url, LABEL, NoRedirect, clean_diagnostics


class SafetyContracts(unittest.TestCase):
    def test_native_static_server_reuses_one_socket_for_multiple_assets(self):
        import functools
        import http.client
        import threading
        from browser_harness import _RuntimeHTTPServer,_QuietHandler
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp,'asset.js').write_text('export const value=1;',encoding='utf-8')
            server=_RuntimeHTTPServer(('127.0.0.1',0),functools.partial(_QuietHandler,directory=tmp))
            worker=threading.Thread(target=server.serve_forever,daemon=True);worker.start()
            connection=http.client.HTTPConnection(*server.server_address,timeout=3)
            try:
                connection.request('GET','/asset.js');first=connection.getresponse()
                self.assertEqual(first.version,11);self.assertFalse(first.will_close)
                self.assertEqual(first.read(),b'export const value=1;');owned=connection.sock
                connection.request('GET','/asset.js');second=connection.getresponse()
                self.assertEqual(second.read(),b'export const value=1;')
                self.assertIs(connection.sock,owned)
            finally:
                connection.close();server.shutdown();server.server_close();worker.join(timeout=3)

    def test_worker_netlog_extracts_only_failed_paths_and_codes(self):
        from browser_harness import _netlog_failures
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'netlog.json'
            path.write_text(json.dumps({'constants':{'logEventTypes':{'URL_REQUEST_START_JOB':1,'URL_REQUEST_FAILED':2}},'events':[
                {'source':{'id':7},'type':1,'time':'100','params':{'url':'http://127.0.0.1:1234/assets/app.js?private=value','headers':['Authorization: private']}},
                {'source':{'id':7},'type':2,'time':'110','params':{'net_error':-101,'headers':['private']}},
            ]}),encoding='utf-8')
            result=_netlog_failures(path)
        self.assertEqual(result,[{'source':7,'type':'URL_REQUEST_FAILED','time':'110','net_error':-101,'host':'127.0.0.1','port':1234,'path':'/assets/app.js'}])
        self.assertNotIn('private',json.dumps(result))

    def test_worker_evidence_retains_native_events_timestamps_and_redacts_queries(self):
        from browser_harness import BrowserSession
        browser=object.__new__(BrowserSession)
        browser.events=[];browser.worker_events=[];browser.worker_states=[]
        browser.service_worker=True;browser.browser_generation=2;browser.label='worker-test'
        browser._record_event({'method':'ServiceWorker.workerErrorReported','params':{'errorMessage':'http://127.0.0.1/service-worker.js?private=value failed'}})
        browser._record_event({'method':'Network.loadingFailed','params':{'errorText':'net::ERR_FAILED'}})
        browser._record_event({'method':'ServiceWorker.workerVersionUpdated','params':{'versions':[{'status':'redundant'}]}})
        self.assertEqual(len(browser.worker_events),3)
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, {'NETUNIM_SUITE_REPORT_DIR':tmp}), \
             patch.object(browser,'worker_state',side_effect=RuntimeError('CDP unavailable')), \
             patch.object(browser,'evaluate',side_effect=RuntimeError('CDP unavailable')):
            evidence=json.loads(browser.save_worker_evidence('worker-error').read_text())
        self.assertEqual(evidence['reason'],'worker-error')
        self.assertIsNone(evidence['cache'])
        self.assertGreater(evidence['events'][0]['observed_at_unix'],0)
        self.assertEqual(evidence['events'][0]['generation'],2)
        self.assertNotIn('private=value',json.dumps(evidence))
        self.assertIn('redundant',json.dumps(evidence))

    def test_worker_wait_reports_install_error_even_with_an_active_controller(self):
        from pwa_upgrade import wait_for_worker_control
        browser=SimpleNamespace(call=lambda *args: {},worker_state=lambda: {'registration':'scope','active':{'state':'activated'},'controller':True},
            events=[{'method':'ServiceWorker.workerErrorReported','params':{'errorMessage':'cache addAll failed'}}],
            save_worker_evidence=lambda *args,**kwargs: 'evidence.json')
        with self.assertRaisesRegex(RuntimeError,'install error.*evidence.json'):
            wait_for_worker_control(browser)

    def test_owned_site_proxy_and_offline_origin_reject_a_reusing_second_listener(self):
        from pwa_upgrade import _OfflineOrigin, _DropConnection
        site = OwnedHTTPServer(('127.0.0.1', 0), http.server.SimpleHTTPRequestHandler)
        offline = _OfflineOrigin(('127.0.0.1', 0), _DropConnection)
        proxy = DenyProxy()
        try:
            for server in (site, proxy.server, offline):
                with self.subTest(server=type(server).__name__), socket.socket(socket.AF_INET, socket.SOCK_STREAM) as intruder:
                    intruder.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                    with self.assertRaises(OSError):
                        intruder.bind(server.server_address)
        finally:
            site.server_close()
            offline.server_close()
            proxy.close()

    def test_diagnostics_redact_generated_secrets_but_keep_sql_failures(self):
        value = clean_diagnostics('API key: eyJfake.generated.secret\n'
            'postgresql://postgres:private@127.0.0.1:19471/postgres\n'
            'JWT secret: private-signing-value\n'
            'sb_secret_privateopaque\nERROR: duplicate key value violates unique constraint backup_owner_revision_key')
        for secret in ('eyJfake.generated.secret', 'postgres:private', 'sb_secret_privateopaque', 'private-signing-value'):
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
