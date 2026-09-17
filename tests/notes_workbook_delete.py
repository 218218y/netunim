"""Workbook deletion contract against a disposable PostgreSQL database."""
import copy
import json
from isolated_sync_postgres import IsolatedPostgres, ROOT, quote


def run(db):
    state = dict(credits=[], cash=[], rights=[], notes=[], expenses=[], cards=[], bank={'adjustments': []})
    state['notesSheet'] = {
        'version': 2, 'sheets': [{'id': 'S1', 'name': 'First'}, {'id': 'S2', 'name': 'Keep'}],
        'columns': [{'id': 'C1', 'sheetId': 'S1'}, {'id': 'C2', 'sheetId': 'S2'}],
        'rows': [{'id': f'R{i}', 'sheetId': 'S1', 'cells': {'C1': str(i)}} for i in range(120)]
                + [{'id': 'keep', 'sheetId': 'S2', 'cells': {'C2': 'untouched'}}],
    }

    def save(value, revision, op, intents=None, bulk=False):
        rpc = 'bulk_delete_save_kupa_document_v5' if bulk else 'save_kupa_document_v5'
        args = [quote('workbook-delete'), str(revision), quote(json.dumps(value))+'::jsonb',
                quote(op), quote(json.dumps(intents or {}))+'::jsonb', "'{}'::jsonb"]
        return json.loads(db.auth_sql('select row_to_json(r) from public.'+rpc+'('+','.join(args)+') r'))

    save(state, 0, 'seed')
    deleted = copy.deepcopy(state)
    for part in ('sheets', 'columns', 'rows'):
        deleted['notesSheet'][part] = [row for row in deleted['notesSheet'][part]
                                      if row['id' if part == 'sheets' else 'sheetId'] != 'S1']
    intents = {'notesSheet.sheets': ['S1'], 'notesSheet.columns': ['C1'],
               'notesSheet.rows': [f'R{i}' for i in range(120)]}

    def rejects(value, op, expected, declared=None, bulk=True):
        try:
            save(value, 1, op, declared, bulk)
        except RuntimeError as error:
            assert expected in str(error), str(error)
        else:
            raise AssertionError('Invalid workbook write accepted: '+op)
        assert db.head('kupa_documents', 'workbook-delete')['revision'] == 1

    rejects(deleted, 'missing-intent', 'kupa_delete_intent_mismatch')
    rejects(deleted, 'missing-parent-intent', 'kupa_delete_intent_mismatch',
            {k: v for k, v in intents.items() if k != 'notesSheet.sheets'})
    rejects(deleted, 'not-bulk', 'mass_delete_requires_dedicated_rpc', intents, bulk=False)
    orphan = copy.deepcopy(state);orphan['notesSheet']['sheets'] = [{'id': 'S2', 'name': 'Keep'}]
    rejects(orphan, 'orphan', 'orphan_notes_sheet_entity', {'notesSheet.sheets': ['S1']})
    duplicate = copy.deepcopy(state);duplicate['notesSheet']['sheets'].append({'id': 'S1', 'name': 'Duplicate'})
    rejects(duplicate, 'duplicate', 'duplicate_entity_id')
    saved = save(deleted, 1, 'delete-sheet', intents, bulk=True)
    assert saved['revision'] == 2 and saved['state']['notesSheet'] == deleted['notesSheet']
    replay = save(deleted, 1, 'delete-sheet', intents, bulk=True)
    assert replay['operation_replayed'] and replay['revision'] == 2
    audit = json.loads(db.sql("select row_to_json(r) from (select before_counts,after_counts,delete_count from netunim_internal.document_sync_operations where document_name='workbook-delete' and operation_id='delete-sheet') r"))
    assert audit['before_counts']['notesSheet.sheets'] == 2
    assert audit['after_counts']['notesSheet.sheets'] == 1 and audit['delete_count'] == 122
    safety = json.loads(db.sql("select state from netunim_internal.safety_snapshots where document_name='workbook-delete' and operation_id='delete-sheet'"))
    assert safety['notesSheet'] == state['notesSheet']
    # Replacing the current workbook from a backup must include its parent IDs.
    restored = copy.deepcopy(state)
    for part in ('sheets', 'columns', 'rows'):
        restored['notesSheet'][part] = [row for row in restored['notesSheet'][part]
                                       if row['id' if part == 'sheets' else 'sheetId'] == 'S1']
    restore_intents = {'notesSheet.sheets': ['S2'], 'notesSheet.columns': ['C2'], 'notesSheet.rows': ['keep']}
    group_id = '22222222-2222-4222-8222-222222222222'
    args = [quote(group_id)+'::uuid', "'kupa'", "'workbook-delete'", '2',
            quote(json.dumps(restored))+'::jsonb', quote(json.dumps(restore_intents))+'::jsonb',
            'null', 'null', 'null', "'[]'::jsonb", "'restore-sheet'", 'null', "'{}'::jsonb"]
    db.auth_sql('select public.stage_restore_group_v5('+','.join(args)+')')
    db.auth_sql('select public.apply_restore_group_v5('+quote(group_id)+'::uuid)')
    restore = db.head('kupa_documents', 'workbook-delete')
    assert restore['revision'] == 3 and restore['state']['notesSheet'] == restored['notesSheet']
    db.migrate((ROOT/'supabase/migrations/20260917120000_notes_workbook_delete.sql').read_text(encoding='utf8'))
    assert db.head('kupa_documents', 'workbook-delete')['revision'] == 3
    print('PASS workbook SQL: exact parent/child intents, mass-delete guard, orphan and duplicate rejection, audit, replay, restore and migration re-run')


if __name__ == '__main__':
    with IsolatedPostgres(schema_files=sorted((ROOT/'supabase/migrations').glob('*.sql'))) as database:
        run(database)
