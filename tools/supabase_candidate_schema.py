"""Export a reviewed migration candidate from disposable PostgreSQL, never Production.

This is an expected schema for live postflight, not deployment evidence. Existing
authenticated snapshots and receipts are never written by this command.
"""
import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'tests'))
from isolated_sync_postgres import IsolatedPostgres
from morning_schema_contract import assert_morning_schema_contract
from supabase_postflight import drift


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    if output.is_relative_to(ROOT/'supabase') or output.exists():
        parser.error('--output must be a new candidate file outside supabase/; authenticated evidence cannot be overwritten')
    target = json.loads((ROOT/'supabase/postflight-target.json').read_text(encoding='utf8'))
    reviewed = json.loads((ROOT/'supabase'/target['schema_snapshot']).read_text(encoding='utf8'))
    with IsolatedPostgres(schema_files=sorted((ROOT/'supabase/migrations').glob('*.sql'))) as db:
        actual = json.loads(db.sql((ROOT/'supabase/schema_inventory.sql').read_text(encoding='utf8')))
        # Fresh installs have no legacy ledger to back up. Existing Production's
        # retained backup is unchanged by this suffix and must still match its
        # authenticated catalog exactly during live postflight.
        backup = 'morning_document_operations_backup_20260908'
        for section in ('tables', 'columns', 'constraints', 'indexes', 'policies', 'triggers'):
            is_backup = lambda r: r.get('schema') == 'public' and r.get('table', r.get('name')) == backup
            if any(is_backup(r) for r in (actual.get(section) or [])):
                raise SystemExit('FAIL: fresh candidate unexpectedly created a legacy Morning backup.')
            actual[section] = (actual.get(section) or []) + [r for r in (reviewed.get(section) or []) if is_backup(r)]
        # This Morning release is allowed to alter only the ledger. Preserve all
        # other reviewed schema contracts before exporting a candidate expectation.
        def without_ledger(inventory):
            result = json.loads(json.dumps(inventory))
            for section in ('tables', 'columns', 'constraints', 'indexes', 'policies', 'triggers'):
                result[section] = [r for r in (result.get(section) or [])
                                   if not (r.get('schema') == 'public' and
                                           r.get('table', r.get('name')) == 'morning_document_operations')]
            return result
        differences = drift(without_ledger(reviewed), without_ledger(actual))
        if differences:
            raise SystemExit('FAIL: candidate changes objects outside the Morning ledger.\n'+'\n'.join(differences))
        assert_morning_schema_contract(actual)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open('x', encoding='utf8') as stream:
        stream.write(json.dumps(actual, ensure_ascii=False, indent=2)+'\n')
    print('PASS: isolated candidate exported. This is NOT Production evidence: '+str(output))


if __name__ == '__main__':
    main()
