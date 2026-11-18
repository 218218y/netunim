from copy import deepcopy
import base64
import hashlib
import io
import json
import sys
import tempfile
import unittest
import warnings
import zipfile
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from verify_encrypted_backup import MAGIC, VerificationError, verify_backup, verify_contents

PROJECT = 'synthetic-project'
PAYLOAD = b'\x00 synthetic storage object'
DUMP = b'PGDMP synthetic database archive'
MEMBERS = {
    'database.dump': DUMP,
    'google-keyring.json': '{}',
    'role-names.json': '[]',
    'storage/000000.bin': PAYLOAD,
}
MANIFEST = {
    'format': 1, 'project': PROJECT, 'source_commit': '9446b6c9',
    'database_sha256': hashlib.sha256(DUMP).hexdigest(),
    'restored_tables': [{'schemaname': 'storage', 'tablename': 'objects', 'count': 1}],
    'storage_objects': [{
        'bucket_id': 'bucket', 'name': 'folders/מסמך.pdf', 'archive_file': 'storage/000000.bin',
        'bytes': len(PAYLOAD), 'sha256': hashlib.sha256(PAYLOAD).hexdigest(),
    }],
}


def zip_bytes(members):
    result = io.BytesIO()
    with zipfile.ZipFile(result, 'w') as archive:
        for name, data in members:
            archive.writestr(name, data)
    return result.getvalue()


def fixture(manifest=MANIFEST, members=MEMBERS, extra=()):
    source = zip_bytes([('supabase/migrations/synthetic.sql', 'select 1;')])
    return zip_bytes([('manifest.json', json.dumps(manifest)), ('verified-source.zip', source),
                      *members.items(), *extra])


class ArchiveContracts(unittest.TestCase):
    def test_existing_archive_format_and_private_output(self):
        self.assertEqual(verify_contents(fixture(), PROJECT), {
            'source_commit': '9446b6c9', 'database_tables_recorded': 1, 'storage_objects_verified': 1,
        })
        manifest = {**MANIFEST, 'storage_objects': []}
        members = {key: value for key, value in MEMBERS.items() if not key.startswith('storage/')}
        self.assertEqual(verify_contents(fixture(manifest, members), PROJECT)['storage_objects_verified'], 0)

    def test_rejects_malformed_or_foreign_manifest(self):
        invalid_format = {**MANIFEST, 'format': True}
        duplicate_table = {**MANIFEST, 'restored_tables': MANIFEST['restored_tables'] * 2}
        missing_objects = {**MANIFEST, 'storage_objects': None}
        for manifest in (invalid_format, duplicate_table, missing_objects, {**MANIFEST, 'project': 'foreign'}):
            with self.subTest(manifest=manifest), self.assertRaises(VerificationError):
                verify_contents(fixture(manifest), PROJECT)

    def test_rejects_missing_extra_and_duplicate_zip_members(self):
        incomplete = {**MEMBERS}
        del incomplete['database.dump']
        with self.assertRaises(VerificationError):
            verify_contents(fixture(members=incomplete), PROJECT)
        with self.assertRaises(VerificationError):
            verify_contents(fixture(extra=[('../unexpected.bin', b'extra')]), PROJECT)
        with warnings.catch_warnings():
            warnings.simplefilter('ignore', UserWarning)
            duplicate = fixture(extra=[('database.dump', DUMP)])
        with self.assertRaises(VerificationError):
            verify_contents(duplicate, PROJECT)

    def test_rejects_wrong_payload_and_wrong_or_duplicate_identity(self):
        for name in ('database.dump', 'storage/000000.bin'):
            with self.subTest(name=name), self.assertRaisesRegex(VerificationError, 'checksum'):
                verify_contents(fixture(members={**MEMBERS, name: b'x' * len(MEMBERS[name])}), PROJECT)
        manifest = deepcopy(MANIFEST)
        manifest['storage_objects'][0]['archive_file'] = 'storage/unlisted.bin'
        with self.assertRaisesRegex(VerificationError, 'Storage object record'):
            verify_contents(fixture(manifest), PROJECT)
        manifest = deepcopy(MANIFEST)
        manifest['storage_objects'].append({**manifest['storage_objects'][0], 'archive_file': 'storage/000001.bin'})
        with self.assertRaisesRegex(VerificationError, 'Duplicate Storage identity'):
            verify_contents(fixture(manifest, {**MEMBERS, 'storage/000001.bin': PAYLOAD}), PROJECT)


class EnvelopeContracts(unittest.TestCase):
    def test_authenticates_and_rejects_wrong_key_tampering_and_truncation(self):
        with tempfile.TemporaryDirectory() as directory:
            backup = Path(directory) / 'backup.aesgcm'
            recovery = Path(directory) / 'recovery.json'
            key = AESGCM.generate_key(bit_length=256)

            def write_key(value):
                recovery.write_text(json.dumps({'format': 1, 'key_base64': base64.b64encode(value).decode()}))

            write_key(key)
            nonce = bytes(12)
            ciphertext = MAGIC + nonce + AESGCM(key).encrypt(nonce, fixture(), MAGIC)
            backup.write_bytes(ciphertext)
            self.assertTrue(verify_backup(backup, recovery, PROJECT)['archive_authenticated'])
            write_key(AESGCM.generate_key(bit_length=256))
            with self.assertRaisesRegex(VerificationError, 'authenticate'):
                verify_backup(backup, recovery, PROJECT)
            write_key(key)
            backup.write_bytes(ciphertext[:-1] + bytes([ciphertext[-1] ^ 1]))
            with self.assertRaisesRegex(VerificationError, 'authenticate'):
                verify_backup(backup, recovery, PROJECT)
            backup.write_bytes(MAGIC + nonce)
            with self.assertRaisesRegex(VerificationError, 'truncated'):
                verify_backup(backup, recovery, PROJECT)


if __name__ == '__main__':
    unittest.main()
