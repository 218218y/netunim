"""Verify a Netunim V1 recovery archive without extracting its contents."""

import argparse
import base64
import hashlib
import io
import json
import re
import subprocess
import sys
import zipfile
from pathlib import Path


MAGIC = b'NETUNIM_BACKUP_V1\n'
NONCE_BYTES = 12
TAG_BYTES = 16
CORE_FILES = frozenset({
    'manifest.json', 'database.dump', 'google-keyring.json',
    'role-names.json', 'verified-source.zip',
})
BACKUP_SCHEMAS = "('public','netunim_internal','auth','storage','supabase_migrations')"


class VerificationError(ValueError):
    """A verification failure whose message contains no archive data."""


def integer_count(value):
    return type(value) is int and value >= 0


def checksum_matches(archive, name, expected, size=None):
    if not isinstance(expected, str) or not re.fullmatch('[a-f0-9]{64}', expected):
        return False
    if size is not None and archive.getinfo(name).file_size != size:
        return False
    with archive.open(name) as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest() == expected


def verify_contents(data, expected_project, *, drill=False):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        all_names = archive.namelist()
        names = set(all_names)
        if len(names) != len(all_names) or not CORE_FILES <= names:
            raise VerificationError('Missing or duplicate core archive members.')

        manifest = json.loads(archive.read('manifest.json'))
        if (not isinstance(manifest, dict) or type(manifest.get('format')) is not int
                or manifest['format'] != 1 or manifest.get('project') != expected_project
                or not isinstance(manifest.get('source_commit'), str)
                or not re.fullmatch('[a-f0-9]{7,40}', manifest['source_commit'])):
            raise VerificationError('Unexpected archive format, project or source revision.')

        tables = manifest.get('restored_tables')
        if (not isinstance(tables, list) or not tables
                or any(not isinstance(row, dict) or not integer_count(row.get('count'))
                       or not isinstance(row.get('schemaname'), str) or not row['schemaname']
                       or not isinstance(row.get('tablename'), str) or not row['tablename']
                       for row in tables)
                or len({(row['schemaname'], row['tablename']) for row in tables}) != len(tables)):
            raise VerificationError('Invalid restored table inventory.')

        objects = manifest.get('storage_objects')
        if not isinstance(objects, list):
            raise VerificationError('Missing Storage object inventory.')
        identities = set()
        object_files = set()
        for index, row in enumerate(objects):
            name = f'storage/{index:06d}.bin'
            if (not isinstance(row, dict) or row.get('archive_file') != name
                    or not isinstance(row.get('bucket_id'), str) or not row['bucket_id']
                    or not isinstance(row.get('name'), str) or not row['name']
                    or not integer_count(row.get('bytes'))):
                raise VerificationError('Invalid Storage object record.')
            identity = (row['bucket_id'], row['name'])
            if identity in identities or name not in names:
                raise VerificationError('Duplicate Storage identity or missing object file.')
            if not checksum_matches(archive, name, row.get('sha256'), row['bytes']):
                raise VerificationError('Storage object checksum or length differs.')
            identities.add(identity)
            object_files.add(name)
        if names != CORE_FILES | object_files:
            raise VerificationError('The archive contains members outside its inventory.')

        if not checksum_matches(archive, 'database.dump', manifest.get('database_sha256')):
            raise VerificationError('Database dump checksum differs.')
        with archive.open('database.dump') as database:
            if database.read(5) != b'PGDMP':
                raise VerificationError('The database member is not a PostgreSQL custom dump.')
        roles = json.loads(archive.read('role-names.json'))
        if (not isinstance(json.loads(archive.read('google-keyring.json')), dict)
                or not isinstance(roles, list)
                or any(not isinstance(row, dict) or not isinstance(row.get('rolname'), str)
                       or not row['rolname'] or '\x00' in row['rolname'] for row in roles)
                or len({row['rolname'] for row in roles}) != len(roles)):
            raise VerificationError('Invalid recovery metadata.')
        with zipfile.ZipFile(io.BytesIO(archive.read('verified-source.zip'))) as source:
            if not source.namelist() or source.testzip() is not None:
                raise VerificationError('The source snapshot is empty or has a damaged member.')

        evidence = {'source_commit': manifest['source_commit'],
                    'database_tables_recorded': len(tables), 'storage_objects_verified': len(objects)}
        if drill:
            restored_tables, restored_objects = inspect_restored_database(archive.read('database.dump'), roles)
            expected_counts = {(row['schemaname'], row['tablename']): row['count'] for row in tables}
            restored_counts = {(row['schemaname'], row['tablename']): row['count'] for row in restored_tables}
            if restored_counts != expected_counts:
                raise VerificationError('Restored table inventory or row counts differ from the archive manifest.')
            restored_identities = {(row['bucket_id'], row['name']) for row in restored_objects}
            if len(restored_objects) != len(identities) or restored_identities != identities:
                raise VerificationError('Restored Storage entries differ from the archive inventory.')
            evidence['isolated_database_restored'] = True
        return evidence


def inspect_restored_database(dump, roles, *, check_restored=None):
    """Replay only into a fresh verified loopback cluster using its clean environment."""
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tests'))
    from isolated_sync_postgres import IsolatedPostgres

    def identifier(value):
        return '"' + value.replace('"', '""') + '"'

    with IsolatedPostgres(schema_files=[]) as cluster:
        existing_roles = set(json.loads(cluster.sql('select json_agg(rolname) from pg_roles;')))
        for role in {row['rolname'] for row in roles} - existing_roles:
            cluster.sql(f'create role {identifier(role)};')
        cluster.sql('create database netunim_backup_drill;')
        target = ('-h', '127.0.0.1', '-p', str(cluster.port), '-U', 'postgres', '-d', 'netunim_backup_drill')

        def query(source):
            return cluster.run('psql', *target, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', input=source)

        query('''drop schema public; create schema extensions;
create extension pgcrypto with schema extensions;
create extension "uuid-ossp" with schema extensions;
create extension pg_trgm with schema extensions;''')
        restore = cluster.bin / ('pg_restore.exe' if sys.platform == 'win32' else 'pg_restore')
        result = subprocess.run([str(restore), *target, '--no-owner', '--no-privileges', '--exit-on-error'],
                                input=dump, capture_output=True, env=cluster.env, timeout=300)
        if result.returncode:
            raise VerificationError('Isolated PostgreSQL restore failed.')

        tables = json.loads(query(f'''select json_agg(t) from (
select schemaname,tablename from pg_tables where schemaname in {BACKUP_SCHEMAS} order by 1,2) t;'''))
        if not isinstance(tables, list) or not tables:
            raise VerificationError('The restored archive has no backed-up tables.')
        for row in tables:
            schema = identifier(row['schemaname'])
            table = identifier(row['tablename'])
            row['count'] = int(query(f'select count(*) from {schema}.{table};'))
        objects = json.loads(query('''select coalesce(json_agg(t),'[]') from (
select bucket_id,name from storage.objects order by bucket_id,name) t;'''))
        if check_restored is not None:
            check_restored(query)
        return tables, objects


def read_key(recovery_key_path):
    key_document = json.loads(recovery_key_path.read_text(encoding='utf-8-sig'))
    if (not isinstance(key_document, dict) or type(key_document.get('format')) is not int
            or key_document['format'] != 1 or not isinstance(key_document.get('key_base64'), str)):
        raise VerificationError('Unknown recovery key format.')
    key = base64.b64decode(key_document['key_base64'], validate=True)
    if len(key) != 32:
        raise VerificationError('Expected a 256-bit recovery key.')
    return key


def verify_backup(backup_path, recovery_key_path, expected_project, *, drill=False):
    from cryptography.exceptions import InvalidTag
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    key = read_key(recovery_key_path)
    encoded = backup_path.read_bytes()
    ciphertext_start = len(MAGIC) + NONCE_BYTES
    if not encoded.startswith(MAGIC) or len(encoded) < ciphertext_start + TAG_BYTES:
        raise VerificationError('Unknown or truncated backup envelope.')
    try:
        data = AESGCM(key).decrypt(encoded[len(MAGIC):ciphertext_start], encoded[ciphertext_start:], MAGIC)
    except InvalidTag:
        raise VerificationError('The recovery key could not authenticate this archive.') from None
    return {**verify_contents(data, expected_project, drill=drill), 'archive_authenticated': True,
            'ciphertext_sha256': hashlib.sha256(encoded).hexdigest()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--backup', type=Path, required=True)
    parser.add_argument('--recovery-key', type=Path, required=True)
    parser.add_argument('--project', required=True, help='Expected Supabase project reference')
    parser.add_argument('--drill', action='store_true', help='Restore the database into a disposable local cluster')
    args = parser.parse_args()
    try:
        evidence = verify_backup(args.backup, args.recovery_key, args.project, drill=args.drill)
    except VerificationError as error:
        parser.exit(1, f'{error}\n')
    except ImportError:
        parser.exit(1, 'The cryptography package is required to verify the archive.\n')
    except (OSError, ValueError, RuntimeError, OverflowError, zipfile.BadZipFile, subprocess.TimeoutExpired) as error:
        parser.exit(1, f'Archive verification stopped ({type(error).__name__}).\n')
    print(json.dumps(evidence, sort_keys=True))


if __name__ == '__main__':
    main()
