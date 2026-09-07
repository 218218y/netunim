"""Emit the read-only SQL for a fresh authenticated Supabase connector capture.

Execute the emitted SQL through the authorized connector; save its returned row
as JSON and pass that to supabase_postflight.py --capture. This command itself does
not connect, attest to Production, or generate evidence from saved snapshots.
"""
import json
from supabase_postflight import ROOT, build_fingerprint, migration_manifest_sql


def query():
    target = json.loads((ROOT / 'supabase/postflight-target.json').read_text(encoding='utf8'))
    literal = lambda value: "'" + value.replace("'", "''") + "'"
    sql = (ROOT / 'supabase/schema_inventory.sql').read_text(encoding='utf8')
    history = "select coalesce(jsonb_agg(jsonb_build_object('version',version,'name',name) order by version),'[]') from supabase_migrations.schema_migrations"
    extra = ', clock_timestamp() as captured_at, ' + literal(target['project_id']) + ' as project_id'
    extra += ', ' + literal(build_fingerprint()) + ' as build_fingerprint'
    extra += ', (' + history + ') as migrations'
    extra += ', (' + migration_manifest_sql().rstrip(';') + ') as manifest;'
    assert sql.count(') as inventory;') == 1
    return 'BEGIN READ ONLY;\n' + sql.replace(') as inventory;', ') as inventory' + extra) + '\nROLLBACK;'


if __name__ == '__main__':
    print(query())
