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
    # Never rewrite that evidence to look like future Production. Instead remove only
    # explicitly reviewed pending-release objects from the broad drift comparison and
    # validate each of those objects separately against its security/semantic contract.
    morning_tables = {'morning_document_operations', 'morning_document_operations_backup_20260908'}
    bank_merge_key = ('netunim_internal', 'merge_bank_transactions',
                      'p_account_key text, p_account_role text, p_transactions jsonb')

    def without_pending_release_objects(inventory):
        value = json.loads(json.dumps(inventory))
        value['tables'] = [row for row in (value.get('tables') or []) if row.get('name') not in morning_tables]
        for section in ('columns', 'constraints', 'indexes', 'policies', 'triggers'):
            value[section] = [row for row in (value.get(section) or []) if row.get('table') not in morning_tables]
        value['functions'] = [row for row in (value.get('functions') or [])
                              if (row.get('schema'), row.get('name'), row.get('identity')) != bank_merge_key]
        return value

    differences = drift(without_pending_release_objects(expected), without_pending_release_objects(actual))
    assert not differences, differences
    assert_morning_schema_contract(actual)

    def one_function(inventory, key):
        rows = [row for row in (inventory.get('functions') or [])
                if (row.get('schema'), row.get('name'), row.get('identity')) == key]
        assert len(rows) == 1, f'expected exactly one function {key}, got {len(rows)}'
        return rows[0]

    reviewed_bank_merge = one_function(expected, bank_merge_key)
    candidate_bank_merge = one_function(actual, bank_merge_key)
    reviewed_contract = {key: value for key, value in reviewed_bank_merge.items() if key != 'definition'}
    candidate_contract = {key: value for key, value in candidate_bank_merge.items() if key != 'definition'}
    assert candidate_contract == reviewed_contract, 'instant-credit migration changed merge function ACL/signature/security metadata'
    assert candidate_bank_merge['definition'] != reviewed_bank_merge['definition'], 'instant-credit migration did not replace the reviewed merge function body'
    required_bank_merge_fragments = (
        'v_amount>0', "v_description ~ 'מיידי|זה.?ב'", 'pending_party_norm', 'pending_detail_digits',
        "interval '1 day'", "position(' '||v_party_norm||' '",
        'right(v_detail_digits,least(length(v_detail_digits),length(hints.pending_detail_digits)))',
        'if v_candidates=1 then', 'delete from public.bank_transactions b',
    )
    assert all(fragment in candidate_bank_merge['definition'] for fragment in required_bank_merge_fragments), \
        'isolated candidate is missing the reviewed fail-closed instant-credit reconciliation contract'
    db.sql((ROOT / 'tests/finance_fencing_server.sql').read_text(encoding='utf8'))
    authorization(db)
print('PASS candidate clean install: full migration chain matches the reviewed release; all authorization/fence regressions pass')
