"""Real isolated PostgreSQL safety/idempotency tests. No live credentials accepted."""
from isolated_sync_postgres import IsolatedPostgres, ROOT, OWNER

MIGRATION=next((ROOT/'supabase/migrations').glob('*_morning_operation_ledger.sql'))
legacy=(ROOT/'tests/fixtures/morning_legacy.sql').read_text(encoding='utf-8')
rollback=(ROOT/'netunim-orders/supabase/morning_rollback.sql').read_text(encoding='utf-8')

with IsolatedPostgres(schema_files=[]) as db:
    db.migrate(legacy)
    for state in ('created','pending','needs_reconciliation'):
        db.sql(f"insert into public.morning_document_operations(owner_id,operation_id,debt_id,request_fingerprint,state,document_type,amount,document_date) values('{OWNER}','00000000-0000-4000-8000-000000000099','fixture','fixture','{state}',305,1,current_date)")
        try:
            db.migrate(MIGRATION.read_text(encoding='utf-8'))
            raise AssertionError('Migration did not refuse '+state)
        except RuntimeError as error:
            assert 'Important Morning operations exist' in str(error)
        assert db.sql('select count(*) from public.morning_document_operations').strip()=='1'
        assert db.sql("select to_regclass('public.morning_document_operations_backup_20260908') is null").strip()=='t'
        db.sql('delete from public.morning_document_operations')
    db.sql(f"insert into public.morning_document_operations(owner_id,operation_id,debt_id,request_fingerprint,state,document_type,amount,document_date) values('{OWNER}','00000000-0000-4000-8000-000000000098','legacy-failed','fixture','failed',305,1,current_date)")
    db.migrate(MIGRATION.read_text(encoding='utf-8'))
    assert db.sql('select count(*) from public.morning_document_operations_backup_20260908').strip()=='1'
    assert db.sql("select count(*) from information_schema.columns where table_name='morning_document_operations' and column_name in ('debt_id','document_url')").strip()=='0'
    assert db.sql("select to_regclass('public.morning_document_operations_backup_20260908') is not null").strip()=='t'
    insert=f"insert into public.morning_document_operations(owner_id,operation_id,environment,request_fingerprint,state,document_type,amount,document_date) values('{OWNER}','00000000-0000-4000-8000-000000000001','sandbox','same','pending',305,1,current_date)"
    db.sql(insert)
    try:
        db.sql(insert.replace('000000000001','000000000002'))
        raise AssertionError('Duplicate unresolved fingerprint allowed')
    except RuntimeError as error:
        assert 'morning_document_operations_unresolved_fingerprint_uidx' in str(error)
    db.sql("update public.morning_document_operations set state='created'")
    db.sql(insert.replace('000000000001','000000000002'))
    db.sql(insert.replace('000000000001','000000000003').replace("'sandbox'","'production'"))
    assert db.sql('select count(*) from public.morning_document_operations').strip()=='3'
    for role in ('anon','authenticated'):
        assert db.sql(f"select has_table_privilege('{role}','public.morning_document_operations','select')").strip()=='f'
        assert db.sql(f"select has_table_privilege('{role}','public.morning_document_operations_backup_20260908','select')").strip()=='f'
    assert db.sql("select relrowsecurity from pg_class where oid='public.morning_document_operations'::regclass").strip()=='t'
    try:
        db.migrate(rollback)
        raise AssertionError('Rollback erased new important operations')
    except RuntimeError as error:
        assert 'preserve new Morning operations' in str(error)
    db.sql("update public.morning_document_operations set state='failed'")
    db.migrate(rollback)
    assert db.sql('select count(*) from public.morning_document_operations_rollback_20260908').strip()=='3'
    assert db.sql("select debt_id from public.morning_document_operations").strip()=='legacy-failed'
    assert db.sql("select count(*) from information_schema.columns where table_name='morning_document_operations' and column_name in ('state','document_type','amount') and is_nullable='NO'").strip()=='3'
    assert db.sql("select count(*) from pg_constraint where conrelid='public.morning_document_operations'::regclass and contype='c'").strip()=='3'
with IsolatedPostgres(schema_files=[MIGRATION]) as db:
    assert db.sql("select count(*) from public.morning_document_operations").strip()=='0'
print('PASS Morning SQL: important-row guard, transactional backup, fresh install, fingerprint uniqueness, intentional duplicates, environments and permissions')
