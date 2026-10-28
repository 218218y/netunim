"""Actual PostgreSQL constraints and service-role access; no external services."""
from isolated_sync_postgres import IsolatedPostgres, OWNER

with IsolatedPostgres(schema_files=['supabase/migrations/20261026080000_morning_expense_operations.sql', 'supabase/migrations/20261026100000_morning_expense_recovery.sql',
                                  'supabase/migrations/20261028180000_morning_expense_recent_index.sql']) as db:
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
    plan = db.sql(f"set enable_seqscan=off; explain select operation_id,expense_id,payload,sent_at,verified_at from public.morning_expense_operations where owner_id='{OWNER}' and environment='sandbox' and state='created' order by sent_at desc,operation_id desc limit 10")
    assert 'morning_expense_recent_created_idx' in plan, plan
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
with IsolatedPostgres(schema_files=['supabase/migrations/'+name for name in [
    '20261026080000_morning_expense_operations.sql','20261026100000_morning_expense_recovery.sql',
    '20261027110000_morning_expense_ocr_operations.sql','20261027150000_morning_expense_source_intent.sql']]) as db:
    import json
    import time
    from concurrent.futures import ThreadPoolExecutor
    def uid(n): return f'aaaaaaaa-aaaa-4aaa-aaaa-{n:012d}'
    def expense(n, source=None, number=None, environment='sandbox'):
        payload={'supplier':{'taxId':'123456789'},'documentType':305,'pcnClassification':'P','date':'2026-10-20','number':number or str(n)}
        columns='operation_id,owner_id,environment,invoice_identity,request_fingerprint,state,payload'
        values=f"'{uid(n)}','{OWNER}','{environment}','{n:064x}','{'b'*64}','reserved','{json.dumps(payload)}'"
        if source is not None:
            columns+=',source_metadata'
            values+=f",'{json.dumps(source)}'"
        return f'insert into public.morning_expense_operations({columns}) values({values})'
    def source(n): return {'sha256':f'{n:064x}','size':100,'contentType':'application/pdf'}
    def ocr(n, source_hash, environment='sandbox'):
        return ("insert into public.morning_expense_ocr_operations(operation_id,owner_id,environment,file_sha256,file_size,content_type) "
                f"values('{uid(n)}','{OWNER}','{environment}','{source_hash}',100,'application/pdf')")
    def execute(sql):
        try: db.sql(sql); return True
        except RuntimeError as error:
            assert any(message in str(error) for message in ['already reserved','duplicate key','check constraint','immutable','permission denied']),error
            return False
    # Legacy financial rows remain readable and their canonical identities still
    # arbitrate new workers, even when the original hash used another spelling.
    db.sql(expense(101,number='000000123'))
    assert not execute(expense(102,number='123'))
    db.sql(expense(103,number='123',environment='production'))
    for invalid in [{}, {**source(1),'size':0}, {**source(1),'contentType':'text/html'}]:
        assert not execute(expense(104,invalid))
    db.sql(expense(105,source(105)))
    assert not execute(f"update public.morning_expense_operations set source_metadata='{json.dumps(source(106))}' where operation_id='{uid(105)}'")
    assert not execute(ocr(106,source(105)['sha256']))
    db.sql(ocr(107,source(107)['sha256']))
    assert not execute(expense(108,source(107)))
    # Test both paths racing on real independent PostgreSQL connections. An
    # uncommitted first reservation must block the second, not merely hide it.
    with ThreadPoolExecutor(max_workers=2) as pool:
        for financial_first, base in [(True,120),(False,130)]:
            financial=expense(base,source(base));scan=ocr(base+1,source(base)['sha256'])
            first,second=(financial,scan) if financial_first else (scan,financial)
            future=pool.submit(execute,'begin;'+first+';select pg_sleep(0.5);commit;')
            time.sleep(0.15)
            assert not execute(second)
            assert future.result()
        first=pool.submit(execute,'begin;'+expense(140,number='000000456')+';select pg_sleep(0.5);commit;')
        time.sleep(0.15)
        assert not execute(expense(141,number='456'))
        assert first.result()
    # Reviewed supplier-specific rules: no global prefix removal or change to
    # submitted zeroes; the function returns a comparison key only.
    policies=[('519266a7d546c1393e9f392d2eeadb67d07a80a60c91a223fa7b94878fcfa5f2','SI00123','00123'),
              ('4ea2a48a89e99699f3d5ae50253ed265790f8292c5bba3b30e58a04d10c80b85','CR00123','00123'),
              ('3048278b3ec7b2841cccebb31ce17340d5ea09b4d3f4ce0b9c4defa89d70c9b5','s00123','123'),
              ('unknown','SI00123','SI00123')]
    for issuer,number,expected in policies:
        assert db.sql(f"select public.morning_expense_number_key('{issuer}','T','{number}')").strip()==expected
    for role in ['anon','authenticated']:
        assert not execute(f"set role {role};select public.morning_expense_number_key('unknown','T','123')")
        assert not execute(f'set role {role};select source_metadata from public.morning_expense_operations')
    db.sql('alter role service_role bypassrls')
    assert db.sql('set role service_role;select count(*) from public.morning_expense_operations').strip()=='5'
print('PASS Morning expense and OCR ledgers: source intent, cross-path races, legacy aliases, CAS, RLS and service-only access')
