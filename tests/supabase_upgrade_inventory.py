"""Measure legacy upgrade effects only inside the disposable baseline cluster.

This is an idempotence/effective-state audit, not evidence of execution history.
An old function superseded by v5/v6 can differ without a missing installation.
"""
import hashlib
import json
import re
import sys
from isolated_sync_postgres import IsolatedPostgres, ROOT

sys.path.insert(0, str(ROOT / 'tools'))
from supabase_postflight import application_schema

inventory_sql = (ROOT / 'supabase/schema_inventory.sql').read_text(encoding='utf8')
baseline = sorted((ROOT / 'supabase/migrations').glob('*_production_schema_baseline.sql'))
reviews = json.loads((ROOT / 'supabase/audit/upgrade-review.json').read_text(encoding='utf8'))
records = []
with IsolatedPostgres(schema_files=baseline) as db:
    initial = application_schema(json.loads(db.sql(inventory_sql)))
    for path in sorted((ROOT / 'netunim-orders/supabase').glob('*_upgrade.sql')):
        source = path.read_text(encoding='utf8')
        # Outer transaction commands only. Dollar-quoted function blocks use bare
        # BEGIN without a semicolon; originals remain untouched in the repository.
        local = re.sub(r'(?im)^\s*(?:begin|commit)\s*;\s*$', '', source)
        local = re.sub(r'(?i)create extension if not exists pg_cron\s*;', '-- local cron catalog stub', local)
        local = re.sub(r'(?i)create index concurrently', 'create index', local)
        record = {'file': str(path.relative_to(ROOT)).replace('\\', '/'), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
        copy = ROOT / 'netunim-kupa/supabase' / path.name
        record['kupa_copy'] = str(copy.relative_to(ROOT)).replace('\\', '/') if copy.exists() else None
        if copy.exists():
            assert copy.read_bytes() == path.read_bytes(), 'legacy copies differ: ' + path.name
        try:
            output = db.sql('BEGIN;\n' + local + '\n' + inventory_sql + '\nROLLBACK;')
            actual = application_schema(json.loads(next(line for line in reversed(output.splitlines()) if line.startswith('{"'))))
            changes = {}
            for section in initial:
                old = {json.dumps(x, sort_keys=True) for x in initial[section]}
                new = {json.dumps(x, sort_keys=True) for x in actual[section]}
                if old != new:
                    changes[section] = {'removed_or_changed': [json.loads(x) for x in sorted(old-new)], 'added_or_changed': [json.loads(x) for x in sorted(new-old)]}
            # Keep a compact list of changed object identities, not another copy of definitions.
            record['replay_changes'] = {k: {direction: [{x: row[x] for x in ('schema','table','name','identity','owner','type') if x in row} for row in rows] for direction, rows in value.items()} for k, value in changes.items()}
            record['effective_state'] = 'applied' if not changes else 'partially-applied'
            record['meaning'] = 'Idempotent on captured schema' if not changes else 'Replay differs from current schema; inspect superseded definitions/grants. Never replay on Production.'
        except RuntimeError as exc:
            record['effective_state'] = 'partially-applied'
            record['replay_error'] = str(exc)
            record['meaning'] = 'Historical script cannot be replayed on current schema; review object evidence and replacement chain.'
        record['replay_state'] = record.pop('effective_state')
        review = reviews[path.name]
        assert review['sha256'] == record['sha256'], 'changed upgrade needs a new review: ' + path.name
        record['effective_state'] = review['status']
        record['review_evidence'] = review['evidence']
        records.append(record)
(ROOT / 'supabase/audit/upgrade-inventory.json').write_text(json.dumps(records, indent=2, ensure_ascii=False) + '\n', encoding='utf8')
print('PASS: mapped', len(records), 'unique upgrades and verified all duplicate copies; no Production execution')
