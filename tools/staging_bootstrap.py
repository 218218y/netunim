"""Provision a fresh isolated project without replaying platform-owner ACLs.

Applied production migrations stay immutable. Supabase forbids a project's
postgres role from changing supabase_admin defaults, so the historical dump's
15 platform-owner ACL statements are excluded only from the fresh staging copy.
Every application definition/grant and every later migration remains unchanged.
"""
import argparse
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

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

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Apply; the default is a dry run')
    args = parser.parse_args()
    target = staging_project(json.loads((ROOT/'config/staging-supabase.json').read_text(encoding='utf-8')))
    projects = json.loads(subprocess.check_output(['supabase','projects','list','--output','json'], text=True))
    if not any(p['id'] == target and p['name'] == 'netunim-staging' for p in projects):
        raise ValueError('Staging identity was not confirmed by the authenticated CLI')
    parent = ROOT/'.work/staging-bootstrap'
    parent.mkdir(parents=True, exist_ok=True)
    scratch = Path(tempfile.mkdtemp(prefix='netunim-staging-', dir=parent)).resolve()
    try:
        (scratch/'supabase').mkdir()
        shutil.copy2(ROOT/'supabase/config.toml', scratch/'supabase/config.toml')
        shutil.copytree(ROOT/'supabase/migrations', scratch/'supabase/migrations')
        baseline = scratch/'supabase/migrations'/BASELINE
        baseline.write_text(portable_baseline(baseline.read_text(encoding='utf-8')), encoding='utf-8')
        command = ['supabase','db','push','--project-ref',target,'--workdir',str(scratch),'--skip-vault','--yes']
        if not args.apply: command.append('--dry-run')
        subprocess.run(command, check=True)
    finally:
        # Validate the absolute owned target before Windows recursive cleanup.
        if scratch.parent != parent.resolve() or not scratch.name.startswith('netunim-staging-') or scratch.is_symlink():
            raise RuntimeError('Unsafe staging scratch cleanup target')
        shutil.rmtree(scratch)

if __name__ == '__main__': main()
