"""Actual PostgreSQL constraints and service-role access; no external services."""
from isolated_sync_postgres import IsolatedPostgres, OWNER

with IsolatedPostgres(schema_files=['supabase/migrations/20261026080000_morning_expense_operations.sql', 'supabase/migrations/20261026100000_morning_expense_recovery.sql']) as db:
    def insert(operation, identity='a', owner=OWNER, environment='sandbox', state='reserved'):
        return ("insert into public.morning_expense_operations(operation_id,owner_id,environment,invoice_identity,request_fingerprint,state,payload) "
                f"values('{operation}','{owner}','{environment}','{identity * 64}','{'b' * 64}','{state}','{{}}')")

    def rejects(sql, expected):
        try:
            db.sql(sql)
        except RuntimeError as error:
            assert expected in str(error), error
        else:
            raise AssertionError('Unexpected SQL success')

    operation = 'aaaaaaaa-aaaa-4aaa-aaaa-000000000001'
    other = 'aaaaaaaa-aaaa-4aaa-aaaa-000000000002'
    db.sql(insert(operation))
    rejects(insert(operation, identity='c'), 'duplicate key')
    rejects(insert(other, owner=other), 'duplicate key')
    rejects(insert(other, identity='c', state='created'), 'check constraint')
    db.sql(insert(other, environment='production'))
    for role in ['anon', 'authenticated']:
        rejects(f'set role {role}; select * from public.morning_expense_operations', 'permission denied')
        rejects(f'set role {role}; ' + insert('aaaaaaaa-aaaa-4aaa-aaaa-000000000003', identity='d'), 'permission denied')
    # The fixture service_role has no BYPASSRLS by default; Supabase's role does.
    db.sql('alter role service_role bypassrls')
    assert db.sql('set role service_role; select count(*) from public.morning_expense_operations').strip() == '2'
    rejects('set role service_role; delete from public.morning_expense_operations', 'permission denied')
    assert db.sql("select relrowsecurity from pg_class where oid='public.morning_expense_operations'::regclass").strip() == 't'
    assert db.sql("select count(*) from pg_constraint where conrelid='public.morning_expense_operations'::regclass and contype='f'").strip() == '0'
    db.sql(f"update public.morning_expense_operations set state='cancelled',cancelled_at=now() where operation_id='{operation}' and state='reserved' and sent_at is null and expense_id is null")
    assert not db.sql(f"update public.morning_expense_operations set state='pending',sent_at=now() where operation_id='{operation}' and state='reserved' returning operation_id").strip()
    third = 'aaaaaaaa-aaaa-4aaa-aaaa-000000000003'
    db.sql(insert(third))
    rejects(insert(operation, identity='c'), 'duplicate key')
    db.sql(f"update public.morning_expense_operations set state='pending',sent_at=now() where operation_id='{third}'")
    assert not db.sql(f"update public.morning_expense_operations set state='cancelled',cancelled_at=now() where operation_id='{third}' and state='reserved' and sent_at is null returning operation_id").strip()
    rejects(f"update public.morning_expense_operations set state='cancelled',cancelled_at=now() where operation_id='{third}'", 'check constraint')
    rejects(f"update public.morning_expense_operations set file_state='prepared' where operation_id='{third}'", 'check constraint')
with IsolatedPostgres(schema_files=['supabase/migrations/20261027110000_morning_expense_ocr_operations.sql']) as db:
    operation = 'aaaaaaaa-aaaa-4aaa-aaaa-000000000010'
    def ocr_insert(operation_id=operation, owner=OWNER):
        return ("insert into public.morning_expense_ocr_operations(operation_id,owner_id,environment,file_sha256,file_size,content_type) "
                f"values('{operation_id}','{owner}','sandbox','{'a'*64}',790,'application/pdf')")
    def ocr_rejects(sql, expected):
        try:
            db.sql(sql)
        except RuntimeError as error:
            assert expected in str(error), error
        else:
            raise AssertionError('Unexpected OCR SQL success')
    db.sql(ocr_insert())
    ocr_rejects(ocr_insert('aaaaaaaa-aaaa-4aaa-aaaa-000000000011', 'aaaaaaaa-aaaa-4aaa-aaaa-000000000012'), 'duplicate key')
    for role in ['anon', 'authenticated']:
        for command in ['select * from', 'delete from']:
            ocr_rejects(f'set role {role}; {command} public.morning_expense_ocr_operations', 'permission denied')
    db.sql('alter role service_role bypassrls')
    assert db.sql('set role service_role; select count(*) from public.morning_expense_ocr_operations').strip() == '1'
    ocr_rejects('set role service_role; delete from public.morning_expense_ocr_operations', 'permission denied')
    db.sql(f"update public.morning_expense_ocr_operations set state='issuing',revision=1 where operation_id='{operation}' and revision=0")
    assert not db.sql(f"update public.morning_expense_ocr_operations set state='issuing',revision=1 where operation_id='{operation}' and revision=0 returning operation_id").strip()
    ocr_rejects(f"update public.morning_expense_ocr_operations set state='ticket_issued' where operation_id='{operation}'", 'check constraint')
    db.sql(f"update public.morning_expense_ocr_operations set state='ticket_issued',business_id='{OWNER}',ticket_issued_at=now() where operation_id='{operation}'")
    ocr_rejects(f"update public.morning_expense_ocr_operations set draft_id='{OWNER}' where operation_id='{operation}'", 'check constraint')
    db.sql(f"update public.morning_expense_ocr_operations set state='review_required',draft_id='{OWNER}',source_verified_at=now() where operation_id='{operation}'")
    ocr_rejects('update public.morning_expense_ocr_operations set poll_count=21', 'check constraint')
    assert db.sql("select relrowsecurity from pg_class where oid='public.morning_expense_ocr_operations'::regclass").strip() == 't'
print('PASS Morning expense and OCR ledgers: isolated identities, source proof constraints, CAS, RLS and service-only access')
