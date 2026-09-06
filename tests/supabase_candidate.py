"""Build final migration-chain evidence locally before applying any Production DDL."""
import json
import sys
from isolated_sync_postgres import IsolatedPostgres, ROOT
from supabase_authorization import run as authorization

sys.path.insert(0, str(ROOT / 'tools'))
from supabase_postflight import drift

baseline = json.loads((ROOT / 'supabase/audit/production-schema.json').read_text(encoding='utf8'))
with IsolatedPostgres(schema_files=sorted((ROOT / 'supabase/migrations').glob('*.sql'))) as db:
    actual = json.loads(db.sql((ROOT / 'supabase/schema_inventory.sql').read_text(encoding='utf8')))
    expected = json.loads(json.dumps(baseline))
    # Exactly two reviewed function changes and one index, no other schema drift.
    for function in expected['functions']:
        if function['schema'] == 'public' and function['name'] in ('get_netunim_sync_capabilities', 'apply_restore_group_v5'):
            replacement = next(f for f in actual['functions'] if (f['schema'], f['name'], f['identity']) == (function['schema'], function['name'], function['identity']))
            if function['name'] == 'get_netunim_sync_capabilities':
                assert not replacement['security_definer']
                assert replacement['authenticated'] and not replacement['anon']
                assert replacement['config'] == function['config']
                assert replacement['acl'] == function['acl']
            else:
                assert replacement['security_definer'] and replacement['acl'] == function['acl']
                assert replacement['config'] == function['config']
            function.update(replacement)
    index = next(i for i in actual['indexes'] if i['name'] == 'google_calendar_oauth_states_owner_id_idx')
    assert index['definition'] == 'CREATE INDEX google_calendar_oauth_states_owner_id_idx ON public.google_calendar_oauth_states USING btree (owner_id)'
    expected['indexes'].append(index)
    assert not drift(expected, actual), 'unexpected candidate schema changes'
    (ROOT / 'supabase/audit/candidate-schema.json').write_text(json.dumps(actual, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    db.sql((ROOT / 'tests/finance_fencing_server.sql').read_text(encoding='utf8'))
    authorization(db)
print('PASS candidate clean install: only the two reviewed function changes and missing OAuth index; all authorization/fence regressions pass')
