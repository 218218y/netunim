"""Export a reviewed Production-upgrade candidate from disposable PostgreSQL.

This command never connects to Production and never rewrites authenticated evidence.
It proves the current Production receipt is an exact prefix of the reviewed migration
chain, reconstructs that prefix in an isolated PostgreSQL instance, restores only the
explicitly reviewed Production-only historical relations, proves the reconstructed
state equals the authenticated Production schema, and then applies the reviewed
pending suffix to that same database.

The resulting JSON is an *expected schema for live postflight*, not deployment proof.
"""
import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'tests'))
from isolated_sync_postgres import IsolatedPostgres
from morning_schema_contract import assert_morning_schema_contract
from supabase_postflight import drift, manifest_pending_suffix, normalized_text_sha256, manifest_rows
from supabase_migration_manifest import manifest as local_manifest, verify_server_manifest
from build_schema_baseline import grants, ident

# Production intentionally retains this historical pre-hardening backup, while a
# clean migration replay cannot recreate it because it was produced by an earlier
# in-place upgrade. Candidate derivation injects this exact reviewed relation into the
# isolated prefix *before* applying pending migrations. This is materially safer than
# overlaying it on the final JSON: a future reviewed DROP/ALTER can then affect it and
# will be visible in the candidate instead of being hidden by the tooling.
PRESERVED_PRODUCTION_RELATIONS = (
    ('public', 'morning_document_operations_backup_20260908'),
)
RELATION_SECTIONS = ('tables', 'columns', 'constraints', 'indexes', 'policies', 'triggers')


def relation_identity(section, row):
    return row.get('schema'), row.get('name') if section == 'tables' else row.get('table')


def migration_files_for_deployed_prefix(receipt_manifest, reviewed_manifest):
    """Return exact local prefix and suffix attested by receipt + reviewed manifest."""
    pending = manifest_pending_suffix(receipt_manifest, reviewed_manifest)
    if pending is None:
        raise SystemExit(
            'FAIL: Production receipt is not an exact prefix of the reviewed migration chain; '
            'refusing to derive a candidate from incompatible history.'
        )
    files = sorted((ROOT/'supabase/migrations').glob('*.sql'))
    if len(files) != len(reviewed_manifest):
        raise SystemExit('FAIL: reviewed migration manifest/file count differs; run migration verification first.')
    expected_names = [f"{row['version']}_{row['name']}.sql" for row in reviewed_manifest]
    if [path.name for path in files] != expected_names:
        raise SystemExit('FAIL: local migration filenames do not match the reviewed migration manifest.')
    deployed_count = len(reviewed_manifest) - len(pending)
    return files[:deployed_count], files[deployed_count:], pending


def _single_reviewed_table(reviewed, identity):
    rows = [row for row in (reviewed.get('tables') or [])
            if (row.get('schema'), row.get('name')) == identity]
    if len(rows) != 1:
        raise SystemExit(
            f'FAIL: authenticated schema must contain exactly one preserved relation {identity[0]}.{identity[1]}.'
        )
    return rows[0]


def preserved_relation_sql(reviewed, identity):
    """Render one explicitly allowed Production-only plain table, fail closed otherwise."""
    table = _single_reviewed_table(reviewed, identity)
    if table.get('kind') != 'r' or table.get('view') is not None or table.get('options'):
        raise SystemExit(f'FAIL: preserved relation {identity[0]}.{identity[1]} has unsupported table metadata.')

    dependencies = {}
    for section in ('constraints', 'indexes', 'policies', 'triggers'):
        rows = [row for row in (reviewed.get(section) or []) if relation_identity(section, row) == identity]
        if rows:
            dependencies[section] = rows
    if dependencies:
        raise SystemExit(
            f'FAIL: preserved relation {identity[0]}.{identity[1]} gained dependent objects; '
            'candidate renderer must be reviewed before continuing.'
        )

    columns = sorted(
        [row for row in (reviewed.get('columns') or []) if relation_identity('columns', row) == identity],
        key=lambda row: row.get('position', 0),
    )
    if not columns:
        raise SystemExit(f'FAIL: preserved relation {identity[0]}.{identity[1]} has no reviewed columns.')

    definitions = []
    for column in columns:
        if column.get('generated') or column.get('collation') or column.get('acl'):
            raise SystemExit(
                f"FAIL: preserved relation column {identity[0]}.{identity[1]}.{column.get('name')} has unsupported metadata."
            )
        definition = ident(column['name']) + ' ' + column['type']
        identity_mode = column.get('identity') or ''
        if identity_mode:
            if identity_mode not in ('a', 'd'):
                raise SystemExit('FAIL: unsupported identity mode on preserved relation.')
            definition += ' GENERATED ' + ('ALWAYS' if identity_mode == 'a' else 'BY DEFAULT') + ' AS IDENTITY'
        if column.get('default') is not None:
            definition += ' DEFAULT ' + column['default']
        if column.get('not_null'):
            definition += ' NOT NULL'
        definitions.append(definition)

    qualified = ident(identity[0]) + '.' + ident(identity[1])
    lines = [
        'CREATE TABLE ' + qualified + ' (\n  ' + ',\n  '.join(definitions) + '\n);',
        'ALTER TABLE ' + qualified + ' OWNER TO ' + ident(table['owner']) + ';',
        'ALTER TABLE ' + qualified + (' ENABLE' if table.get('rls') else ' DISABLE') + ' ROW LEVEL SECURITY;',
    ]
    if table.get('force_rls'):
        lines.append('ALTER TABLE ' + qualified + ' FORCE ROW LEVEL SECURITY;')
    lines.extend(grants(table.get('acl'), 'TABLE ' + qualified, table['owner']))
    return '\n'.join(lines) + '\n'


def inject_preserved_production_relations(db, reviewed):
    """Restore only the explicitly reviewed historical schema objects into the fixture."""
    before = json.loads(db.sql((ROOT/'supabase/schema_inventory.sql').read_text(encoding='utf8')))
    for identity in PRESERVED_PRODUCTION_RELATIONS:
        for section in RELATION_SECTIONS:
            if any(relation_identity(section, row) == identity for row in (before.get(section) or [])):
                raise SystemExit(
                    'FAIL: clean receipt-prefix replay unexpectedly created Production-only relation '
                    f'{identity[0]}.{identity[1]} in {section}.'
                )
        db.migrate(preserved_relation_sql(reviewed, identity))


def validate_authenticated_receipt(target, receipt, reviewed_manifest):
    """Validate the evidence used as the immutable Production baseline, allowing a suffix."""
    errors = []
    if receipt.get('project_id') != target.get('project_id'):
        errors.append('receipt targets a different Supabase project')
    if receipt.get('production_postflight') != 'PASS':
        errors.append('receipt does not record a successful Production postflight')
    if receipt.get('text_hash_normalization') != 'lf-v1':
        errors.append('receipt text-hash normalization contract is missing or unsupported')
    if receipt.get('schema_snapshot') != target.get('schema_snapshot'):
        errors.append('receipt schema snapshot differs from postflight target')
    else:
        schema_path = ROOT/'supabase'/target['schema_snapshot']
        if not schema_path.is_file():
            errors.append('authenticated Production schema snapshot is missing')
        elif normalized_text_sha256(schema_path) != receipt.get('schema_snapshot_sha256'):
            errors.append('authenticated Production schema snapshot changed since the receipt')

    source_rel = receipt.get('source_audit')
    source_hash = receipt.get('source_audit_sha256')
    audit = None
    if not source_rel or not source_hash:
        errors.append('receipt is missing its authenticated source-audit binding')
    else:
        source_path = ROOT/'supabase'/source_rel
        if not source_path.is_file():
            errors.append('receipt source audit is missing')
        elif normalized_text_sha256(source_path) != source_hash:
            errors.append('receipt source audit changed since it was recorded')
        else:
            try:
                audit = json.loads(source_path.read_text(encoding='utf8'))
            except json.JSONDecodeError:
                errors.append('receipt source audit is not valid JSON')
    if audit is not None:
        if audit.get('project_id') != target.get('project_id') or audit.get('production_postflight') != 'PASS':
            errors.append('receipt source audit is not a successful postflight for this project')
        if audit.get('schema_drift') != []:
            errors.append('receipt source audit contains unexplained schema drift')
        if manifest_rows(audit.get('migration_manifest', [])) != manifest_rows(receipt.get('migration_manifest', [])):
            errors.append('receipt migration manifest is not bound to its source audit')
        if 'server_migration_manifest' in audit:
            try:
                verify_server_manifest(audit['server_migration_manifest'], audit.get('migration_manifest', []))
            except (ValueError, OSError) as exc:
                errors.append('receipt source audit server SQL hashes are invalid: ' + str(exc))

    pending = manifest_pending_suffix(receipt.get('migration_manifest', []), reviewed_manifest)
    if pending is None:
        errors.append('receipt migration manifest is not an exact prefix of the reviewed chain')
    if errors:
        raise SystemExit('FAIL: cannot authenticate the Production baseline for candidate derivation.\n- ' + '\n- '.join(errors))
    return pending


def replay_upgrade_candidate(prefix_files, pending_files, reviewed):
    """Reconstruct authenticated Production schema, then apply pending suffix in-place."""
    with IsolatedPostgres(schema_files=prefix_files) as db:
        inject_preserved_production_relations(db, reviewed)
        deployed = json.loads(db.sql((ROOT/'supabase/schema_inventory.sql').read_text(encoding='utf8')))
        differences = drift(reviewed, deployed)
        if differences:
            raise SystemExit(
                'FAIL: receipt-prefix replay does not reproduce the authenticated Production schema; '
                'candidate derivation is unsafe.\n' + '\n'.join(differences)
            )
        assert_morning_schema_contract(deployed)
        for path in pending_files:
            db.migrate(path.read_text(encoding='utf-8-sig'))
        actual = json.loads(db.sql((ROOT/'supabase/schema_inventory.sql').read_text(encoding='utf8')))
    assert_morning_schema_contract(actual)
    return actual


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    if output.is_relative_to(ROOT/'supabase') or output.exists():
        parser.error('--output must be a new candidate file outside supabase/; authenticated evidence cannot be overwritten')

    target = json.loads((ROOT/'supabase/postflight-target.json').read_text(encoding='utf8'))
    reviewed = json.loads((ROOT/'supabase'/target['schema_snapshot']).read_text(encoding='utf8'))
    receipt = json.loads((ROOT/'supabase'/target['deployment_receipt']).read_text(encoding='utf8'))
    reviewed_manifest = json.loads((ROOT/'supabase'/target['manifest_snapshot']).read_text(encoding='utf8'))
    local = local_manifest()
    if local != reviewed_manifest:
        raise SystemExit('FAIL: local migration files differ from the reviewed migration manifest; no candidate exported.')

    pending = validate_authenticated_receipt(target, receipt, reviewed_manifest)
    prefix_files, pending_files, planned_pending = migration_files_for_deployed_prefix(
        receipt.get('migration_manifest', []), reviewed_manifest
    )
    if manifest_rows(pending) != manifest_rows(planned_pending):
        raise SystemExit('FAIL: inconsistent pending-suffix derivation; refusing candidate export.')

    actual = replay_upgrade_candidate(prefix_files, pending_files, reviewed)
    if not pending:
        differences = drift(reviewed, actual)
        if differences:
            raise SystemExit('FAIL: current migration replay differs from authenticated Production.\n' + '\n'.join(differences))

    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open('x', encoding='utf8') as stream:
        stream.write(json.dumps(actual, ensure_ascii=False, indent=2)+'\n')
    if pending:
        labels = ', '.join(f"{row['version']}_{row['name']}" for row in pending)
        print('PASS: authenticated Production prefix reproduced in isolated PostgreSQL.')
        print('PASS: isolated Production-upgrade candidate exported from reviewed suffix: ' + labels)
    else:
        print('PASS: isolated replay matches authenticated Production; no database migration is pending.')
    print('INFO: candidate is NOT Production evidence: ' + str(output))


if __name__ == '__main__':
    main()
