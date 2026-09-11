"""Build final migration-chain evidence locally before applying any Production DDL."""
import json
import sys
from isolated_sync_postgres import IsolatedPostgres, ROOT
from supabase_authorization import run as authorization
from morning_schema_contract import assert_morning_schema_contract

sys.path.insert(0, str(ROOT / 'tools'))
from supabase_candidate_schema import (
    migration_files_for_deployed_prefix,
    replay_upgrade_candidate,
)
from supabase_postflight import drift
from supabase_migration_manifest import manifest as local_manifest


def one_function(inventory, key):
    rows = [row for row in (inventory.get('functions') or [])
            if (row.get('schema'), row.get('name'), row.get('identity')) == key]
    assert len(rows) == 1, f'expected exactly one function {key}, got {len(rows)}'
    return rows[0]


target = json.loads((ROOT / 'supabase/postflight-target.json').read_text(encoding='utf8'))
reviewed = json.loads((ROOT / 'supabase' / target['schema_snapshot']).read_text(encoding='utf8'))
receipt = json.loads((ROOT / 'supabase' / target['deployment_receipt']).read_text(encoding='utf8'))
reviewed_manifest = local_manifest()
all_files = sorted((ROOT / 'supabase/migrations').glob('*.sql'))

# The planner must remain release-agnostic. Model a receipt ending immediately before
# the newest migration and verify that the exact newest file is selected as the suffix.
if reviewed_manifest:
    synthetic_receipt_manifest = reviewed_manifest[:-1]
    prefix_files, pending_files, pending = migration_files_for_deployed_prefix(
        synthetic_receipt_manifest, reviewed_manifest
    )
    assert [p.name for p in prefix_files] == [
        f"{row['version']}_{row['name']}.sql" for row in reviewed_manifest[:-1]
    ]
    assert [p.name for p in pending_files] == [
        f"{reviewed_manifest[-1]['version']}_{reviewed_manifest[-1]['name']}.sql"
    ]
    assert pending == reviewed_manifest[-1:]

# The authenticated receipt is the authority for where Production currently ends.
# Replaying the exact receipt prefix plus the explicit Production-only historical
# relation must first reproduce the authenticated schema. Only then may the reviewed
# suffix be applied in the same disposable database.
receipt_prefix_files, receipt_pending_files, receipt_pending = migration_files_for_deployed_prefix(
    receipt.get('migration_manifest', []), reviewed_manifest
)
assert len(receipt_prefix_files) + len(receipt_pending_files) == len(all_files)

deployed = replay_upgrade_candidate(receipt_prefix_files, [], reviewed)
prefix_differences = drift(reviewed, deployed)
assert not prefix_differences, prefix_differences
assert_morning_schema_contract(deployed)

candidate = replay_upgrade_candidate(receipt_prefix_files, receipt_pending_files, reviewed)
assert_morning_schema_contract(candidate)
if not receipt_pending:
    differences = drift(reviewed, candidate)
    assert not differences, differences

bank_merge_key = (
    'netunim_internal',
    'merge_bank_transactions',
    'p_account_key text, p_account_role text, p_transactions jsonb',
)
bank_merge = one_function(candidate, bank_merge_key)
reviewed_bank_merge = one_function(reviewed, bank_merge_key)
reviewed_contract = {key: value for key, value in reviewed_bank_merge.items() if key != 'definition'}
candidate_contract = {key: value for key, value in bank_merge.items() if key != 'definition'}
assert candidate_contract == reviewed_contract, \
    'instant-credit migration changed merge function ACL/signature/security metadata'

bank_migration_pending = any(row['name'] == 'bank_instant_credit_reconciliation' for row in receipt_pending)
if bank_migration_pending:
    assert bank_merge['definition'] != reviewed_bank_merge['definition'], \
        'instant-credit migration did not replace the reviewed merge function body'
else:
    assert bank_merge == reviewed_bank_merge, \
        'authenticated Production bank merge function differs from replayed candidate'

required_bank_merge_fragments = (
    'v_amount>0', "v_description ~ 'מיידי|זה.?ב'", 'pending_party_norm', 'pending_detail_digits',
    "interval '1 day'", "position(' '||v_party_norm||' '",
    'right(v_detail_digits,least(length(v_detail_digits),length(hints.pending_detail_digits)))',
    'if v_candidates=1 then', 'delete from public.bank_transactions b',
)
assert all(fragment in bank_merge['definition'] for fragment in required_bank_merge_fragments), \
    'replayed bank merge function is missing the reviewed fail-closed instant-credit reconciliation contract'

# Keep the clean-install authorization/fencing regression independent from the
# Production-only historical table. This verifies that the canonical migration chain
# still installs from scratch and preserves the RPC boundary/security contract.
with IsolatedPostgres(schema_files=all_files) as db:
    clean = json.loads(db.sql((ROOT / 'supabase/schema_inventory.sql').read_text(encoding='utf8')))
    assert_morning_schema_contract(clean)
    clean_bank_merge = one_function(clean, bank_merge_key)
    assert clean_bank_merge == bank_merge, \
        'Production-upgrade replay and clean install disagree on the bank merge function contract'
    db.sql((ROOT / 'tests/finance_fencing_server.sql').read_text(encoding='utf8'))
    authorization(db)

print('PASS candidate migration chain: authenticated prefix replay, generic pending suffix, clean install, authorization and fence regressions pass')
