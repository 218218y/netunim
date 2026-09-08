"""Build final migration-chain evidence locally before applying any Production DDL."""
import json
import sys
from isolated_sync_postgres import IsolatedPostgres, ROOT
from supabase_authorization import run as authorization
from morning_schema_contract import assert_morning_schema_contract

sys.path.insert(0, str(ROOT / 'tools'))
from supabase_postflight import drift

target = json.loads((ROOT / 'supabase/postflight-target.json').read_text(encoding='utf8'))
reviewed = json.loads((ROOT / 'supabase' / target['schema_snapshot']).read_text(encoding='utf8'))
with IsolatedPostgres(schema_files=sorted((ROOT / 'supabase/migrations').glob('*.sql'))) as db:
    actual = json.loads(db.sql((ROOT / 'supabase/schema_inventory.sql').read_text(encoding='utf8')))
    expected = json.loads(json.dumps(reviewed))

    # The checked-in full schema snapshot is authenticated Production evidence.
    # While a reviewed DB release is pending, never rewrite that evidence to look
    # like future Production. Instead prove that the migration chain changes only
    # the Morning ledger, then validate that ledger by semantic catalog invariants.
    morning_tables = {'morning_document_operations', 'morning_document_operations_backup_20260908'}
    def without_morning(inventory):
        value = json.loads(json.dumps(inventory))
        value['tables'] = [row for row in (value.get('tables') or []) if row.get('name') not in morning_tables]
        for section in ('columns', 'constraints', 'indexes', 'policies', 'triggers'):
            value[section] = [row for row in (value.get(section) or []) if row.get('table') not in morning_tables]
        return value

    differences = drift(without_morning(expected), without_morning(actual))
    assert not differences, differences
    assert_morning_schema_contract(actual)
    db.sql((ROOT / 'tests/finance_fencing_server.sql').read_text(encoding='utf8'))
    authorization(db)
print('PASS candidate clean install: full migration chain matches the reviewed release; all authorization/fence regressions pass')
