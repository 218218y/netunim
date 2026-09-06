"""Two authenticated users + anonymous/null identity against the real candidate SQL.
All writes run only in IsolatedPostgres; no production URL or credentials accepted.
"""
import json
from isolated_sync_postgres import IsolatedPostgres, ROOT, OWNER, quote

OTHER = '22222222-2222-4222-8222-222222222222'
GROUP = '33333333-3333-4333-8333-333333333333'
MAIN = '{"version":5,"credits":[],"cash":[],"rights":[],"notes":[],"notesSheet":{"rows":[],"columns":[]},"expenses":[],"cards":[],"bank":{"adjustments":[]}}'


def auth(db, owner, statement, role='authenticated'):
    return db.sql('BEGIN;SET LOCAL ROLE ' + role + ';SET LOCAL request.jwt.claim.sub=' + quote(owner) + ';' + statement + ';COMMIT;').strip()


def denied(db, owner, expression, code='42501', role='authenticated'):
    auth(db, owner, "DO $test$ BEGIN PERFORM " + expression + ";RAISE EXCEPTION 'authorization unexpectedly succeeded';EXCEPTION WHEN SQLSTATE '" + code + "' THEN NULL;END $test$", role)


def protected_rows(db, owner):
    inv = json.loads((ROOT / 'supabase/audit/production-schema.json').read_text(encoding='utf8'))
    tables = sorted({c['schema'] + '.' + c['table'] for c in inv['columns'] if c['name'] == 'owner_id'})
    return {t: json.loads(db.sql("select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from " + t + ' t where owner_id=' + quote(owner))) for t in tables}


def run(db):
    db.sql('INSERT INTO auth.users VALUES(' + quote(OTHER) + ');')
    for owner in (OWNER, OTHER):
        auth(db, owner, "select * from public.save_kupa_document_v5('main',0," + quote(MAIN) + ",'seed','{}','{}')")
        auth(db, owner, "select * from public.save_shared_checks_document_v5('main',0,'{\"version\":1,\"checks\":[],\"bankEvents\":[]}','seed-checks','[]','{}')")
    tx = db.sql("insert into public.bank_transactions(owner_id,account_key,account_role,merge_key,amount,presence_state) values(" + quote(OWNER) + ",'same-account','business','same-merge-key',10,'missing') returning id").strip()
    stage = "public.stage_restore_group_v5('" + GROUP + "','kupa','main',1," + quote(MAIN) + ",'{}','main',null,null,'[]','restore-main','restore-checks','{}')"
    auth(db, OWNER, 'select * from ' + stage)
    for kind in ('bank', 'credit'):
        auth(db, OWNER, "select * from public.claim_finance_sync_lease('" + kind + "','A-" + kind + "',60)")
    before = protected_rows(db, OWNER)
    # Guessing another user's IDs, restore UUID or lease token grants no authority.
    denied(db, OTHER, "public.acknowledge_bank_transaction_alert(" + tx + ",'returned_cheque')", 'P0002')
    denied(db, OTHER, 'public.acknowledge_bank_transaction_missing(' + tx + ')', 'P0002')
    denied(db, OTHER, "public.apply_restore_group_v5('" + GROUP + "')", 'P0002')
    assert auth(db, OTHER, "select public.release_finance_sync_lease('bank','A-bank')") == 'f'
    denied(db, OTHER, "netunim_internal.capture_safety_snapshot(" + quote(OWNER) + ",'kupa','main','attack','restore',null)")
    denied(db, OTHER, "netunim_internal.record_operation_audit(" + quote(OWNER) + ",'kupa','main','seed','{}','{}','{}','{}',null)")
    writes = [
        "public.merge_bank_transactions('same-account','business','[]','bank','A-bank',1)",
        "public.sync_bank_transactions_snapshot('same-account','business','[]',now(),null,null,false,'bank','A-bank',1)",
        "public.save_bank_sync_snapshot('main','{}','snapshot',0,'bank','A-bank',1)",
        "public.save_finance_sync_document_v5('main',0,'{}','credit-write','{}','credit','A-credit',1)",
    ]
    for expression in writes:
        denied(db, OTHER, expression, 'PT409')
    # Same natural keys and group UUID can coexist for B without exposing/updating A.
    for kind in ('bank', 'credit'):
        auth(db, OTHER, "select * from public.claim_finance_sync_lease('" + kind + "','B-" + kind + "',60)")
    auth(db, OTHER, 'select * from ' + stage)
    auth(db, OTHER, "select * from public.apply_restore_group_v5('" + GROUP + "')")
    # Both optional-check branches and the completed/idempotent branch must work.
    replay = auth(db, OTHER, "select * from public.apply_restore_group_v5('" + GROUP + "')")
    assert '|completed|' in replay
    with_checks = '44444444-4444-4444-8444-444444444444'
    main_revision = auth(db, OTHER, "select revision from public.kupa_documents where document_name='main'")
    auth(db, OTHER, "select * from public.stage_restore_group_v5('" + with_checks + "','kupa','main'," + main_revision + ',' + quote(MAIN) + ",'{}','main',1,'{\"version\":1,\"checks\":[],\"bankEvents\":[]}','[]','restore-both-main','restore-both-checks','{}')")
    auth(db, OTHER, "select * from public.apply_restore_group_v5('" + with_checks + "')")
    assert '|completed|' in auth(db, OTHER, "select * from public.apply_restore_group_v5('" + with_checks + "')")
    transaction = '[{"mergeKey":"same-merge-key","amount":25,"description":"B","status":"completed"}]'
    auth(db, OTHER, "select * from public.merge_bank_transactions('same-account','business'," + quote(transaction) + ",'bank','B-bank',1)")
    auth(db, OTHER, "select * from public.sync_bank_transactions_snapshot('same-account','business'," + quote(transaction) + ",now(),null,null,false,'bank','B-bank',1)")
    auth(db, OTHER, "select * from public.save_bank_sync_snapshot('main','{\"currentBalance\":25}','B-snapshot',0,'bank','B-bank',1)")
    revision = auth(db, OTHER, "select revision from public.finance_sync_documents where document_name='main'")
    auth(db, OTHER, "select * from public.save_finance_sync_document_v5('main'," + revision + ",'{}','B-credit','{}','credit','B-credit',1)")
    btx = auth(db, OTHER, "select id from public.bank_transactions where account_key='same-account'")
    auth(db, OTHER, "select * from public.acknowledge_bank_transaction_alert(" + btx + ",'returned_cheque')")
    db.sql("update public.bank_transactions set presence_state='missing' where owner_id=" + quote(OTHER))
    auth(db, OTHER, 'select * from public.acknowledge_bank_transaction_missing(' + btx + ')')
    auth(db, OTHER, "select netunim_internal.capture_safety_snapshot(" + quote(OTHER) + ",'kupa','main','B-snapshot','restore',null)")
    auth(db, OTHER, "select netunim_internal.record_operation_audit(" + quote(OTHER) + ",'kupa','main','seed','{}','{}','{}','{}',null)")
    assert auth(db, OTHER, "select public.release_finance_sync_lease('bank','B-bank')") == 't'
    assert protected_rows(db, OWNER) == before, 'B modified or deleted A business/backups/lease/audit rows'
    assert auth(db, OTHER, 'select count(*) from public.bank_transactions where id=' + tx) == '0', 'cross-user RLS read'
    # All exposed privileged entrypoints deny a nullable JWT identity, including
    # wrappers whose UID guard resides in assert_finance_sync_fence.
    calls = [stage, "public.apply_restore_group_v5('" + GROUP + "')",
             "public.claim_finance_sync_lease('bank','x',60)", "public.release_finance_sync_lease('bank','x')",
             'public.acknowledge_bank_transaction_missing(' + tx + ')',
             "public.acknowledge_bank_transaction_alert(" + tx + ",'returned_cheque')",
             "netunim_internal.capture_safety_snapshot(" + quote(OWNER) + ",'kupa','main','x','restore',null)",
             "netunim_internal.record_operation_audit(" + quote(OWNER) + ",'kupa','main','seed','{}','{}','{}','{}',null)", *writes]
    for expression in calls:
        denied(db, '', expression)
        denied(db, '', expression, role='anon')
    capabilities = auth(db, OTHER, 'select public.get_netunim_sync_capabilities()')
    assert json.loads(capabilities)['financeFencing'] == 1
    assert auth(db, OWNER, 'select public.get_netunim_sync_capabilities()') == capabilities
    denied(db, '', 'public.get_netunim_sync_capabilities()', role='anon')
    # Internal implementation and fence helper grants never expose an unfenced path.
    inventory = json.loads((ROOT / 'supabase/audit/production-schema.json').read_text(encoding='utf8'))
    for f in inventory['functions']:
        if f['schema'] == 'netunim_internal' and f['name'].startswith(('fenced_impl_', 'assert_finance_sync_fence')):
            assert not f['authenticated'] and not f['anon'], f['name']


if __name__ == '__main__':
    with IsolatedPostgres(schema_files=sorted((ROOT / 'supabase/migrations').glob('*.sql'))) as db:
        run(db)
    print('PASS all 13 reviewed RPC/helper authorizations: two users, null UID, anon, owner isolation and finance fences')
