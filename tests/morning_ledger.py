"""Real isolated PostgreSQL safety/idempotency tests. No live credentials accepted."""
from isolated_sync_postgres import IsolatedPostgres, ROOT, OWNER

MIGRATION=next((ROOT/'supabase/migrations').glob('*_morning_operation_ledger.sql'))
HARDENING=next((ROOT/'supabase/migrations').glob('*_morning_verified_creation.sql'))
GLOBAL_IDEMPOTENCY=next((ROOT/'supabase/migrations').glob('*_morning_global_idempotency.sql'))
OWNER_RETENTION=next((ROOT/'supabase/migrations').glob('*_morning_ledger_owner_retention.sql'))
PREISSUE=next((ROOT/'supabase/migrations').glob('*_morning_preissue_reservation.sql'))
OTHER_OWNER='22222222-2222-4222-8222-222222222222'
legacy=(ROOT/'tests/fixtures/morning_legacy.sql').read_text(encoding='utf-8')
rollback=(ROOT/'netunim-orders/supabase/morning_rollback.sql').read_text(encoding='utf-8')
assert "'reserved','created','created_unverified','pending','needs_reconciliation'" in rollback

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
    # Simulate a success from the previous Edge version: it has a known ID, but no proof that canonical GET succeeded.
    legacy_created=f"insert into public.morning_document_operations(owner_id,operation_id,environment,request_fingerprint,state,document_type,amount,document_date,document_id) values('{OWNER}','00000000-0000-4000-8000-000000000001','sandbox','same','created',305,1,current_date,'00000000-0000-4000-8000-000000000010')"
    db.sql(legacy_created)
    db.migrate(HARDENING.read_text(encoding='utf-8'))
    assert db.sql("select state from public.morning_document_operations where operation_id='00000000-0000-4000-8000-000000000001'").strip()=='created_unverified'
    assert db.sql("select verified_at is null from public.morning_document_operations where operation_id='00000000-0000-4000-8000-000000000001'").strip()=='t'
    assert db.sql("select count(*) from information_schema.columns where table_name='morning_document_operations' and column_name='verified_at'").strip()=='1'
    insert=f"insert into public.morning_document_operations(owner_id,operation_id,environment,request_fingerprint,state,document_type,amount,document_date) values('{OWNER}','00000000-0000-4000-8000-000000000002','sandbox','same','pending',305,1,current_date)"
    try:
        db.sql(insert)
        raise AssertionError('Known-but-unverified fingerprint was released')
    except RuntimeError as error:
        assert 'morning_document_operations_unresolved_fingerprint_uidx' in str(error)
    db.sql("update public.morning_document_operations set state='created', verified_at=now() where operation_id='00000000-0000-4000-8000-000000000001'")
    db.sql(f"insert into auth.users values('{OTHER_OWNER}')")
    db.migrate(GLOBAL_IDEMPOTENCY.read_text(encoding='utf-8'))
    db.migrate(OWNER_RETENTION.read_text(encoding='utf-8'))
    assert db.sql("select count(*) from pg_constraint where conrelid='public.morning_document_operations'::regclass and contype='f'").strip()=='0'
    db.migrate(PREISSUE.read_text(encoding='utf-8'))
    assert db.sql("select count(*) from information_schema.columns where table_name='morning_document_operations' and column_name='issuance_started_at'").strip()=='1'
    assert db.sql("select issuance_started_at is not null from public.morning_document_operations where operation_id='00000000-0000-4000-8000-000000000001'").strip()=='t'
    db.sql(f"insert into public.morning_document_operations(owner_id,operation_id,environment,request_fingerprint,state,document_type,amount,document_date) values('{OTHER_OWNER}','00000000-0000-4000-8000-000000000006','sandbox','reserved-only','reserved',305,1,current_date)")
    assert db.sql("select issuance_started_at is null from public.morning_document_operations where operation_id='00000000-0000-4000-8000-000000000006'").strip()=='t'
    # A verified operation is exactly-once by operation_id, but its business content is not
    # permanently unique: two legitimate documents can have identical customer/amount/date data.
    db.sql(f"insert into public.morning_document_operations(owner_id,operation_id,environment,request_fingerprint,state,document_type,amount,document_date) values('{OWNER}','00000000-0000-4000-8000-000000000002','sandbox','same','pending',305,1,current_date)")
    # While that second operation is unresolved, the same fingerprint is protected account-wide.
    try:
        db.sql(f"insert into public.morning_document_operations(owner_id,operation_id,environment,request_fingerprint,state,document_type,amount,document_date) values('{OTHER_OWNER}','00000000-0000-4000-8000-000000000005','sandbox','same','pending',305,1,current_date)")
        raise AssertionError('Unresolved Morning fingerprint was not protected across app users')
    except RuntimeError as error:
        assert 'morning_document_operations_unresolved_fingerprint_uidx' in str(error)
    # Environment isolation remains explicit; sandbox uncertainty cannot block production.
    db.sql(insert.replace('000000000002','000000000003').replace("'sandbox'","'production'"))
    # The same Morning document cannot be claimed by another operation/user, even in a race.
    try:
        db.sql(f"insert into public.morning_document_operations(owner_id,operation_id,environment,request_fingerprint,state,document_type,amount,document_date,document_id,verified_at) values('{OTHER_OWNER}','00000000-0000-4000-8000-000000000004','sandbox','different','created',305,1,current_date,'00000000-0000-4000-8000-000000000010',now())")
        raise AssertionError('Duplicate Morning document ID was allowed across app users')
    except RuntimeError as error:
        assert 'morning_document_operations_document_uidx' in str(error)
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
    assert db.sql('select count(*) from public.morning_document_operations_rollback_20260908').strip()=='2'
    assert db.sql("select debt_id from public.morning_document_operations").strip()=='legacy-failed'
    assert db.sql("select count(*) from information_schema.columns where table_name='morning_document_operations' and column_name in ('state','document_type','amount') and is_nullable='NO'").strip()=='3'
    assert db.sql("select count(*) from pg_constraint where conrelid='public.morning_document_operations'::regclass and contype='c'").strip()=='3'
with IsolatedPostgres(schema_files=[MIGRATION,HARDENING,GLOBAL_IDEMPOTENCY,OWNER_RETENTION,PREISSUE]) as db:
    assert db.sql("select count(*) from public.morning_document_operations").strip()=='0'
    assert db.sql("select count(*) from information_schema.columns where table_name='morning_document_operations' and column_name='verified_at'").strip()=='1'
print('PASS Morning SQL: migration guard, verification hardening, account-wide fingerprint/document uniqueness, owner-retained issuance evidence, atomic pre-issue reservation, fresh install, environments and permissions')
