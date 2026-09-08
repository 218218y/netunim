"""Build final migration-chain evidence locally before applying any Production DDL."""
import json
import sys
from isolated_sync_postgres import IsolatedPostgres, ROOT
from supabase_authorization import run as authorization

sys.path.insert(0, str(ROOT / 'tools'))
from supabase_postflight import drift

target = json.loads((ROOT / 'supabase/postflight-target.json').read_text(encoding='utf8'))
reviewed = json.loads((ROOT / 'supabase' / target['candidate_snapshot']).read_text(encoding='utf8'))
with IsolatedPostgres(schema_files=sorted((ROOT / 'supabase/migrations').glob('*.sql'))) as db:
    actual = json.loads(db.sql((ROOT / 'supabase/schema_inventory.sql').read_text(encoding='utf8')))
    expected = json.loads(json.dumps(reviewed))
    # An empty installation has no previous Morning table to back up. All other
    # objects must match the independently reviewed release snapshot exactly.
    backup = 'morning_document_operations_backup_20260908'
    expected['tables'] = [row for row in expected['tables'] if row['name'] != backup]
    expected['columns'] = [row for row in expected['columns'] if row['table'] != backup]
    differences = drift(expected, actual)
    assert not differences, differences
    db.sql((ROOT / 'tests/finance_fencing_server.sql').read_text(encoding='utf8'))
    authorization(db)
print('PASS candidate clean install: full migration chain matches the reviewed release; all authorization/fence regressions pass')
