"""Provision a fresh isolated project without replaying platform-owner ACLs.

Applied production migrations stay immutable. Supabase forbids a project's
postgres role from changing supabase_admin defaults, so the historical dump's
15 platform-owner ACL statements are excluded only from the fresh staging copy.
Every application definition/grant and every later migration remains unchanged.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
from supabase_migration_manifest import manifest, split_sql_statements, verify_server_manifest
from supabase_postflight import migration_manifest_sql

ROOT = Path(__file__).resolve().parents[1]
BASELINE = '20260906200304_production_schema_baseline.sql'
MANAGED = re.compile(r'^ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" (?:REVOKE ALL ON (?:SEQUENCES|FUNCTIONS|TABLES) FROM [^;\n]+|GRANT [A-Z, ]+ ON (?:SEQUENCES|FUNCTIONS|TABLES) TO "(?:postgres|anon|authenticated|service_role)");\n', re.M)

def portable_baseline(source):
    portable, count = MANAGED.subn('', source)
    if count != 15 or 'ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin"' in portable:
        raise ValueError('Review changed platform-owner defaults before staging bootstrap')
    return portable

def staging_project(config):
    match = re.fullmatch(r'https://([a-z]{20})\.supabase\.co', config['url'])
    if not match or match[1] == 'bupoidcurcxuypfrjqio':
        raise ValueError('Refusing production or invalid staging target')
    return match[1]


def verify_staging_manifest(server, reviewed):
    if len(server) > len(reviewed):
        raise ValueError('Staging ledger contains unreviewed migrations')
    if server:
        first, expected = server[0], reviewed[0]
        if any(first.get(key) != expected[key] for key in ('version', 'name')):
            raise ValueError('Staging ledger does not start at the reviewed baseline')
        source = (ROOT/'supabase/migrations'/BASELINE).read_text(encoding='utf8')
        if hashlib.sha256(source.encode('utf8')).hexdigest() != expected['sha256']:
            raise ValueError('Local staging baseline differs from the reviewed source')
        portable = portable_baseline(source)
        encodings = (portable, '\n'.join(split_sql_statements(portable)))
        if first.get('sha256') not in {hashlib.sha256(value.encode('utf8')).hexdigest() for value in encodings}:
            raise ValueError('Staging SQL differs from the reviewed portable baseline')
        verify_server_manifest(server[1:], reviewed[1:len(server)])
    return reviewed[len(server):]


def staging_manifest(target, scratch):
    def query(sql):
        path = scratch/'ledger.sql'
        path.write_text(sql, encoding='utf8')
        result = subprocess.run(
            ['supabase', 'db', 'query', '--file', str(path), '--read-only',
             '--agent=no', '--output', 'json', '--remote='+target],
            capture_output=True, encoding='utf8', timeout=90,
        )
        if result.returncode:
            raise ValueError('Could not read the authenticated staging migration ledger')
        payload = json.loads(result.stdout)
        rows = payload.get('rows') if isinstance(payload, dict) else payload
        if not isinstance(rows, list) or len(rows) != 1 or not isinstance(rows[0], dict):
            raise ValueError('Unexpected staging catalog response')
        return rows[0]

    available = query("select to_regclass('supabase_migrations.schema_migrations') is not null as available;")
    if available.get('available') is False:
        return []
    if available.get('available') is not True:
        raise ValueError('Staging ledger presence could not be verified')
    statement = migration_manifest_sql().removesuffix(';')
    rows = query('select ('+statement+') as manifest;').get('manifest')
    if not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows):
        raise ValueError('Unexpected staging migration manifest')
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--apply', action='store_true', help='Apply the reviewed suffix; the default is a dry run')
    mode.add_argument('--verify', action='store_true', help='Check installed SQL hashes and require the complete reviewed ledger')
    args = parser.parse_args()
    target = staging_project(json.loads((ROOT/'config/staging-supabase.json').read_text(encoding='utf-8')))
    projects = json.loads(subprocess.check_output(['supabase','projects','list','--output','json'], text=True))
    if not any(p['id'] == target and p['name'] == 'netunim-staging' for p in projects):
        raise ValueError('Staging identity was not confirmed by the authenticated CLI')
    reviewed = json.loads((ROOT/'supabase/canonical-migration-manifest.json').read_text(encoding='utf8'))
    if manifest() != reviewed:
        raise ValueError('Local migrations differ from the reviewed manifest')
    parent = ROOT/'.work/staging-bootstrap'
    parent.mkdir(parents=True, exist_ok=True)
    scratch = Path(tempfile.mkdtemp(prefix='netunim-staging-', dir=parent)).resolve()
    try:
        pending = verify_staging_manifest(staging_manifest(target, scratch), reviewed)
        print(f'Staging {target}: verified {len(reviewed)-len(pending)} migrations, {len(pending)} pending.', flush=True)
        if args.verify:
            if pending:
                raise SystemExit('FAIL: Staging has pending reviewed migrations')
            return
        (scratch/'supabase').mkdir()
        shutil.copy2(ROOT/'supabase/config.toml', scratch/'supabase/config.toml')
        shutil.copytree(ROOT/'supabase/migrations', scratch/'supabase/migrations')
        baseline = scratch/'supabase/migrations'/BASELINE
        baseline.write_text(portable_baseline(baseline.read_text(encoding='utf-8')), encoding='utf-8')
        command = ['supabase','db','push','--workdir',str(scratch),'--skip-vault','--yes','--remote='+target]
        if not args.apply: command.append('--dry-run')
        subprocess.run(command, check=True)
        if args.apply:
            if verify_staging_manifest(staging_manifest(target, scratch), reviewed):
                raise SystemExit('FAIL: Staging migration ledger is incomplete after push')
            print(f'PASS: verified all {len(reviewed)} deployed staging SQL hashes.')
    finally:
        # Validate the absolute owned target before Windows recursive cleanup.
        if scratch.parent != parent.resolve() or not scratch.name.startswith('netunim-staging-') or scratch.is_symlink():
            raise RuntimeError('Unsafe staging scratch cleanup target')
        shutil.rmtree(scratch)

if __name__ == '__main__': main()
