"""Negative safety gates execute without contacting any external resource."""
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import os
import tempfile
import unittest

from acceptance_safety import browser_preflight, contained, postgres_environment, sandbox_config


class SafetyContracts(unittest.TestCase):
    def test_libpq_destination_and_service_environment_cannot_escape(self):
        with patch.dict(os.environ, {'PGHOSTADDR': '192.0.2.1', 'PGSERVICE': 'production',
                                     'PGSSLCERT': '/private/cert', 'PGFUTUREOPTION': 'unsafe'}):
            env = postgres_environment()
        self.assertEqual({key: value for key, value in env.items() if key.upper().startswith('PG')},
                         {'PGCLIENTENCODING': 'UTF8'})

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
