"""Exercise metadata-only repair and stale-review rollback in an isolated cluster."""
import json
from isolated_sync_postgres import IsolatedPostgres, ROOT, quote

rows = json.loads((ROOT / 'supabase/audit/migration-history-before-normalization.json').read_text(encoding='utf8'))['migrations']
originals = json.loads((ROOT / 'supabase/audit/original-full-migration-history.json').read_text(encoding='utf8'))
old_versions = {r['version'] for r in originals}
sql = (ROOT / 'supabase/audit/normalize-migration-history.sql').read_text(encoding='utf8')
baseline = next((ROOT / 'supabase/migrations').glob('*_production_schema_baseline.sql')).name.split('_')[0]
expected = [{'version': baseline, 'name': 'production_schema_baseline'}, *[r for r in rows if r['version'] not in old_versions]]
with IsolatedPostgres(schema_files=[]) as db:
    db.sql('create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[]);' + ''.join('insert into supabase_migrations.schema_migrations(version,name) values(' + quote(r['version']) + ',' + quote(r['name']) + ');' for r in rows))
    read = "select jsonb_agg(jsonb_build_object('version',version,'name',name) order by version) from supabase_migrations.schema_migrations"
    db.sql("update supabase_migrations.schema_migrations set name='unexpected' where version=" + quote(rows[0]['version']))
    stale = db.sql(read)
    try:
        db.sql(sql)
        raise AssertionError('stale review was accepted')
    except RuntimeError as error:
        assert 'division by zero' in str(error)
    assert db.sql(read) == stale, 'failed guard partially rewrote history'
    db.sql('update supabase_migrations.schema_migrations set name=' + quote(rows[0]['name']) + ' where version=' + quote(rows[0]['version']))
    db.sql(sql)
    assert json.loads(db.sql(read)) == expected
    # A replay also fails closed rather than altering already-normalized history.
    try:
        db.sql(sql)
        raise AssertionError('duplicate repair was accepted')
    except RuntimeError as error:
        assert 'division by zero' in str(error)
    assert json.loads(db.sql(read)) == expected
print('PASS metadata normalization: preserved new migrations, exact baseline, stale/replayed repair rollback')
