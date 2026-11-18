"""Replay a real custom dump on another disposable PostgreSQL server."""

import hashlib
import json
import subprocess
import sys

from encrypted_backup_contracts import MANIFEST, MEMBERS, PROJECT, fixture
from isolated_sync_postgres import IsolatedPostgres, ROOT

sys.path.insert(0, str(ROOT / 'tools'))
from verify_encrypted_backup import VerificationError, verify_contents


def run():
    with IsolatedPostgres(schema_files=[]) as source:
        source.sql('''create role backup_drill_reader;
create policy fixture_reader on storage.objects for select to backup_drill_reader using (false);
insert into storage.objects (id,bucket_id,name)
values (gen_random_uuid(), 'bucket', 'folders/מסמך.pdf');''')
        pg_dump = source.bin / ('pg_dump.exe' if sys.platform == 'win32' else 'pg_dump')
        dump = subprocess.run([str(pg_dump), '-h', '127.0.0.1', '-p', str(source.port), '-U', 'postgres',
                               '-d', 'postgres', '-Fc', '--schema=storage'],
                              capture_output=True, env=source.env, check=True, timeout=60).stdout

    tables = [*MANIFEST['restored_tables'], {'schemaname': 'storage', 'tablename': 'buckets', 'count': 0}]
    manifest = {**MANIFEST, 'restored_tables': tables, 'database_sha256': hashlib.sha256(dump).hexdigest()}
    members = {**MEMBERS, 'database.dump': dump,
               'role-names.json': json.dumps([{'rolname': 'backup_drill_reader'}])}
    evidence = verify_contents(fixture(manifest, members), PROJECT, drill=True)
    assert evidence['isolated_database_restored'] and evidence['storage_objects_verified'] == 1

    wrong_row = {**MANIFEST['storage_objects'][0], 'name': 'wrong-object-name'}
    wrong = {**manifest, 'storage_objects': [wrong_row]}
    try:
        verify_contents(fixture(wrong, members), PROJECT, drill=True)
    except VerificationError as error:
        assert 'Restored Storage entries differ' in str(error)
    else:
        raise AssertionError('An object absent from the restored Storage catalog was accepted')
    print('PASS isolated PostgreSQL replay, complete table and Storage inventory, mismatched restored object rejection')


if __name__ == '__main__':
    run()
