"""Business regressions against PostgreSQL, including the real V2 write boundary."""
import json
import time
from concurrent.futures import ThreadPoolExecutor
from isolated_sync_postgres import OWNER, quote


def run(db):
    jobs=json.loads(db.sql("select json_agg(json_build_object('name',jobname,'schedule',schedule,'command',command,'active',active)) from cron.job where jobname in ('check-bank-refresh','morning-check-registration')"))
    assert len(jobs)==2 and all(job['schedule']=='* * * * *' and job['active'] for job in jobs),jobs
    assert {job['command'] for job in jobs}=={'select netunim_internal.run_check_bank_refresh_queue()','select netunim_internal.retry_morning_check_registrations()'}
    def scalar(sql):
        return db.sql(sql).strip()

    def rows():
        return json.loads(scalar("select state->'checks' from public.shared_checks_documents where owner_id="+quote(OWNER)+" and document_name='main'"))

    def save(checks, precision=True, deleted=None):
        revision=scalar("select revision from public.shared_checks_documents where owner_id="+quote(OWNER)+" and document_name='main'") or '0'
        audit={'checkAmountPrecision':2} if precision else {}
        return db.auth_sql("select revision from public.save_shared_checks_document_v6('main',"+revision+","+quote(json.dumps({'version':1,'checks':checks,'bankEvents':[]}))+"::jsonb,"+quote('upgrade-save-'+scalar('select gen_random_uuid()'))+","+quote(json.dumps(deleted or []))+"::jsonb,"+quote(json.dumps(audit))+"::jsonb)")

    def refresh():
        revision=scalar("select revision from public.shared_checks_documents where owner_id="+quote(OWNER)+" and document_name='main'")
        return json.loads(db.auth_sql("select public.refresh_check_bank_matches("+revision+")"))

    # Activate the exact protection used by deployed Storage V2 accounts.
    db.sql("insert into netunim_internal.storage_writer_protocol(owner_id,domain,min_writer_protocol,activated_revision,activated_by) values("+quote(OWNER)+",'shared-checks',2,0,"+quote(OWNER)+") on conflict(owner_id,domain) do update set min_writer_protocol=2")
    save([])
    assert refresh()['status']=='no_checks'
    # A saved bank snapshot exists BEFORE the cheque is entered.
    db.sql("insert into public.bank_transactions(owner_id,account_key,account_role,merge_key,amount,description,transaction_date,processed_date,status,presence_state,last_seen_at,check_details) values("+quote(OWNER)+",'upgrade','business','upgrade',123.45,'הפקדת שיק','2026-08-02','2026-08-02','completed','present','2026-08-10 12:00Z','{\"checkNumbers\":[\"987\"]}')")
    db.sql("begin;set local request.jwt.claim.sub="+quote(OWNER)+";insert into public.bank_transaction_snapshots(owner_id,account_key,account_role,snapshot_at,coverage_from,coverage_to,transaction_count,transactions) values("+quote(OWNER)+",'upgrade','business','2026-08-10 12:00Z','2026-07-01','2026-08-10',0,'[]');commit;")
    check={'id':'late','name':'Late','account':'עסקי','amount':123.45,'dueDate':'2026-08-01','status':'בקופה','checkNumber':'987'}
    save([check]);assert rows()[0]['status']=='בקופה'
    result=refresh();assert result['changed']==1,result
    assert rows()[0]['status']=='הופקד - במעקב' and rows()[0]['amount']==123.45
    before=scalar("select revision||':'||state::text from public.shared_checks_documents where owner_id="+quote(OWNER))
    for _ in range(3):
        assert refresh()['status']=='unchanged'
    assert before==scalar("select revision||':'||state::text from public.shared_checks_documents where owner_id="+quote(OWNER)), 'A no-op replay must not write'
    # Replaying a mature stored snapshot, even after manual acceptance, cannot clear.
    current=rows();current[0]['bankReview']=current[0]['bankMatch']['eventId'];save(current)
    refresh();assert rows()[0]['status']=='הופקד - במעקב'
    # Editing names/notes is not matching work.
    current=rows();current[0]['note']='memo';save(current)
    assert scalar("select requested_at is null from netunim_internal.check_bank_refresh_state where owner_id="+quote(OWNER))=='t'
    # Legacy clients cannot silently overwrite cents with a rounded value.
    current=rows();current[0]['amount']=123
    try:
        save(current,False);raise AssertionError('legacy rounding accepted')
    except RuntimeError as error:
        assert 'check_precision_upgrade_required' in str(error),str(error)
    assert rows()[0]['amount']==123.45
    try:
        save(current,True);raise AssertionError('upgrading an old pending payload authorized a rounded amount')
    except RuntimeError as error:
        assert 'check_precision_upgrade_required' in str(error)
    # Only an actual later bank observation may prove elapsed clearing days.
    db.sql("begin;set local request.jwt.claim.sub="+quote(OWNER)+";select netunim_internal.enter_storage_writer_operation_v2('bank-archive-snapshot');update public.bank_transactions set last_seen_at='2026-08-16 12:00Z' where account_key='upgrade';update public.bank_transaction_snapshots set snapshot_at='2026-08-16 12:00Z',coverage_to='2026-08-16' where account_key='upgrade';select netunim_internal.leave_storage_writer_operation_v2('bank-archive-snapshot');commit;")
    assert rows()[0]['status']=='נפרע',rows()[0]
    current=rows();current[0]['amount']=124.45;current[0]['amountEditId']='explicit-ui-amount-edit';save(current)
    assert rows()[0]['amount']==124.45,'An explicit amount edit by the updated editor remains possible'
    # Exact revision and owner scoping are enforced server-side.
    try:
        db.auth_sql('select public.refresh_check_bank_matches(0)');raise AssertionError('stale refresh accepted')
    except RuntimeError as error:
        assert 'revision_conflict' in str(error)
    assert scalar("select has_function_privilege('anon','public.refresh_check_bank_matches(bigint)','execute')")=='f'
    assert scalar("select has_function_privilege('authenticated','netunim_internal.refresh_check_bank_matches(uuid,bigint)','execute')")=='f'

    # Multiple similar cheques retain separate payment indices and exact cents.
    intent=[{'paymentIndex':i,'name':'Client','amount':100.25,'dueDate':'2026-09-01','checkNumber':'111',
             'bankName':'Test','bankNumber':'12','branchNumber':'123','accountNumber':'000456'} for i in (0,2)]
    operation='00000000-0000-4000-8000-000000000901'
    def insert(op, payload):
        db.sql("insert into public.morning_document_operations(owner_id,environment,operation_id,request_fingerprint,state,document_type,amount,document_date,client_name,description,check_intent) values("+quote(OWNER)+",'sandbox',"+quote(op)+","+quote(op)+",'reserved',400,200.5,'2026-08-02','Client','Test',"+quote(json.dumps(payload))+"::jsonb)")
    insert(operation,intent)
    count=len(rows())
    db.sql("update public.morning_document_operations set state='pending',issuance_started_at=now() where operation_id="+quote(operation))
    assert len(rows())==count,'No import before verified issuance'
    # Force the follow-up to fail while preserving official-document success.
    db.sql("create function netunim_internal.test_import_failure() returns trigger language plpgsql as $$begin raise exception 'test_import_failure';end$$;create trigger test_import_failure before insert on netunim_internal.morning_check_registrations for each row execute function netunim_internal.test_import_failure()")
    db.sql("update public.morning_document_operations set check_payment_evidence='matched',state='created',document_id='verified-901',document_number='901',verified_at=now() where operation_id="+quote(operation))
    assert scalar("select state||':'||checks_registration_error from public.morning_document_operations where operation_id="+quote(operation))=='created:test_import_failure'
    assert scalar("select checks_registration_attempts from public.morning_document_operations where operation_id="+quote(operation))=='1'
    assert len(rows())==count and scalar('select count(*) from netunim_internal.morning_check_registrations')=='0'
    db.sql('drop trigger test_import_failure on netunim_internal.morning_check_registrations;drop function netunim_internal.test_import_failure()')
    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(lambda _:db.sql('select netunim_internal.register_morning_checks('+quote(operation)+')'),range(2)))
    for _ in range(3):
        db.sql('select netunim_internal.retry_morning_check_registrations()')
    imported=[c for c in rows() if c.get('morningSource')]
    assert len(imported)==2, scalar("select checks_registration_error from public.morning_document_operations where operation_id="+quote(operation))
    assert [c['morningSource']['paymentIndex'] for c in imported]==[0,2]
    assert all(c['amount']==100.25 and c['name']=='Client' and c['account']=='עסקי' and c['accountNumber']=='000456' for c in imported)
    # A replay after user edits does not overwrite the edited row or recreate deleted rows.
    current=rows();current[-1]['note']='edited';current[-1].pop('morningSource');save(current)
    assert rows()[-1]['morningSource']['documentId']=='verified-901'
    db.sql('select netunim_internal.retry_morning_check_registrations()')
    assert rows()[-1]['note']=='edited' and len(rows())==count+2
    second='00000000-0000-4000-8000-000000000902'
    insert(second,intent)
    db.sql("update public.morning_document_operations set check_payment_evidence='matched',state='created',issuance_started_at=now(),document_id='verified-902',document_number='902',verified_at=now() where operation_id="+quote(second))
    assert len(rows())==count+4,'Two intentionally similar official documents have independent payment identities'
    removed=rows()[-1]['id'];save([c for c in rows() if c['id']!=removed],deleted=[removed])
    db.sql('select netunim_internal.register_morning_checks('+quote(second)+');select netunim_internal.retry_morning_check_registrations()')
    assert removed not in [c['id'] for c in rows()],'An explicitly deleted imported cheque is not resurrected'
    db.sql("update netunim_internal.check_bank_refresh_state set requested_at=clock_timestamp()-interval '5 seconds'")
    db.sql('select netunim_internal.run_check_bank_refresh_queue()')
    assert scalar("select requested_at is null and error is null from netunim_internal.check_bank_refresh_state where owner_id="+quote(OWNER))=='t'
    revision=scalar("select revision from public.shared_checks_documents where owner_id="+quote(OWNER))
    db.sql('select netunim_internal.run_check_bank_refresh_queue()')
    assert scalar("select revision from public.shared_checks_documents where owner_id="+quote(OWNER))==revision
    try:
        db.sql("update public.morning_document_operations set check_intent='[]' where operation_id="+quote(operation));raise AssertionError('intent was mutable')
    except RuntimeError as error:
        assert 'morning_check_intent_immutable' in str(error)
    # Completion survives user deletion; the provenance is issuance evidence too.
    assert scalar("select count(*) from pg_constraint where conrelid='netunim_internal.morning_check_registrations'::regclass and confrelid='auth.users'::regclass")=='0'
    # Coordinated restores retain exact cents, with capability frozen at staging.
    from storage_writer_protocol_server import ORDERS
    db.auth_sql("select revision from public.save_order_management_document_v6('suppliers',0,"+quote(ORDERS)+"::jsonb,'checks-upgrade-main','{}','{}')")
    target=rows();target[0]['amount']=123.45
    for precision in (False,True):
        group_id=scalar('select gen_random_uuid()')
        revision=scalar("select revision from public.shared_checks_documents where owner_id="+quote(OWNER))
        audit={'checkAmountPrecision':2} if precision else {}
        db.auth_sql("select phase from public.stage_restore_group_v6("+quote(group_id)+",'orders','suppliers',1,"+quote(ORDERS)+"::jsonb,'{}','main',"+revision+","+quote(json.dumps({'version':1,'checks':target,'bankEvents':[]}))+"::jsonb,'[]',"+quote('restore-main-'+group_id)+","+quote('restore-checks-'+group_id)+","+quote(json.dumps(audit))+"::jsonb)")
        if not precision:
            try:
                db.auth_sql('select phase from public.apply_restore_group_v6('+quote(group_id)+')');raise AssertionError('legacy restore rounded cents')
            except RuntimeError as error:
                assert 'check_precision_upgrade_required' in str(error),str(error)
            assert rows()[0]['amount']==124.45
            # Remove only the failed fixture group so the new approved restore can stage.
            db.sql('delete from netunim_internal.restore_operation_groups where restore_group_id='+quote(group_id))
        else:
            assert 'completed' in db.auth_sql('select phase from public.apply_restore_group_v6('+quote(group_id)+')')
            assert rows()[0]['amount']==123.45
    # The verified bank source can identify an older archived deposit outside the
    # ordinary discovery window, but still needs current snapshot presence/details.
    details={'kind':'deposit','checkCount':1,'checkNumbers':['222'],'checkItems':[{'checkNumber':'222','bankNumber':'12','branchNumber':'123','accountNumber':'000456','amount':50.25}]}
    transaction=scalar("insert into public.bank_transactions(owner_id,account_key,account_role,merge_key,amount,description,transaction_date,processed_date,status,presence_state,last_seen_at,check_details) values("+quote(OWNER)+",'source-upgrade','business','source-upgrade',50.25,'הפקדת שיק','2026-07-01','2026-07-01','completed','present','2026-08-16 12:00Z',"+quote(json.dumps(details))+"::jsonb) returning id")
    db.sql("begin;set local request.jwt.claim.sub="+quote(OWNER)+";select netunim_internal.enter_storage_writer_operation_v2('bank-archive-snapshot');insert into public.bank_transaction_snapshots(owner_id,account_key,account_role,snapshot_at,coverage_from,coverage_to,transaction_count,transactions) values("+quote(OWNER)+",'source-upgrade','business','2026-08-16 12:00Z','2026-07-01','2026-08-16',0,'[]');select netunim_internal.leave_storage_writer_operation_v2('bank-archive-snapshot');commit;")
    source_operation='00000000-0000-4000-8000-000000000903'
    source_intent=[{**intent[0],'amount':50.25,'dueDate':'2026-07-01','checkNumber':'222','bankSourceKey':'check:12:123:000456:222:5025'}]
    insert(source_operation,source_intent)
    db.sql("update public.morning_document_operations set check_payment_evidence='matched',state='created',issuance_started_at=now(),source_kind='bank',source_bank_transaction_id="+transaction+",document_id='verified-903',document_number='903',verified_at=now() where operation_id="+quote(source_operation))
    refresh()
    source_check=next(c for c in rows() if c.get('morningSource',{}).get('documentId')=='verified-903')
    assert source_check['status']=='הופקד - במעקב',source_check
    assert str(source_check['bankMatch']['transactionId'])==transaction
    # An official document without payment rows is valid, but not cheque proof.
    evidence_operation='00000000-0000-4000-8000-000000000905'
    insert(evidence_operation,intent)
    count=len(rows())
    db.sql("update public.morning_document_operations set state='created',check_payment_evidence='missing',issuance_started_at=now(),document_id='verified-905',verified_at=now() where operation_id="+quote(evidence_operation))
    db.sql('select netunim_internal.retry_morning_check_registrations()')
    assert len(rows())==count
    assert scalar("select state||':'||checks_registration_attempts from public.morning_document_operations where operation_id="+quote(evidence_operation))=='created:0'
    db.sql("update public.morning_document_operations set check_payment_evidence='matched' where operation_id="+quote(evidence_operation))
    assert len(rows())==count+2
    # Both background entry points use the established financial-write lock.
    # Busy work remains durable; neither path waits while holding document locks.
    busy_operation='00000000-0000-4000-8000-000000000904'
    insert(busy_operation,intent)
    count=len(rows())
    revision=scalar("select revision from public.shared_checks_documents where owner_id="+quote(OWNER))
    with ThreadPoolExecutor(max_workers=1) as pool:
        held=pool.submit(db.sql,"begin;set local application_name='checks-upgrade-lock';select pg_advisory_xact_lock(hashtextextended('netunim_financial_write:"+OWNER+"',0));select pg_sleep(5);commit;")
        deadline=time.monotonic()+10
        while scalar("select exists(select 1 from pg_locks l join pg_stat_activity a using(pid) where l.locktype='advisory' and l.granted and a.application_name='checks-upgrade-lock')")!='t':
            assert time.monotonic()<deadline,'Fixture financial lock was not acquired'
            time.sleep(.03)
        assert refresh()['status']=='busy'
        db.sql("update public.morning_document_operations set check_payment_evidence='matched',state='created',issuance_started_at=now(),document_id='verified-904',document_number='904',verified_at=now() where operation_id="+quote(busy_operation))
        assert len(rows())==count
        assert scalar("select state||':'||checks_registration_error from public.morning_document_operations where operation_id="+quote(busy_operation))=='created:save_busy'
        assert scalar("select revision from public.shared_checks_documents where owner_id="+quote(OWNER))==revision
        held.result()
    db.sql('select netunim_internal.retry_morning_check_registrations()')
    assert len(rows())==count,'Busy work obeys its retry delay'
    assert scalar("select checks_registration_attempts from public.morning_document_operations where operation_id="+quote(busy_operation))=='0'
    db.sql("update public.morning_document_operations set verified_at=verified_at where operation_id="+quote(busy_operation))
    assert len(rows())==count+2,'The existing status recheck safely retries the verified follow-up'
    db.sql("update netunim_internal.check_bank_refresh_state set requested_at=clock_timestamp()-interval '5 seconds';select netunim_internal.run_check_bank_refresh_queue()")
    assert scalar("select requested_at is null and error is null from netunim_internal.check_bank_refresh_state where owner_id="+quote(OWNER))=='t'
    # Persistent failures remain diagnosable and retryable; no intent/document loss.
    failed_operation='00000000-0000-4000-8000-000000000906'
    insert(failed_operation,intent);count=len(rows())
    db.sql("create function netunim_internal.test_import_failure() returns trigger language plpgsql as $$begin raise exception 'persistent_fixture';end$$;create trigger test_import_failure before insert on netunim_internal.morning_check_registrations for each row execute function netunim_internal.test_import_failure()")
    db.sql("update public.morning_document_operations set check_payment_evidence='matched',state='created',issuance_started_at=now(),document_id='verified-906',verified_at=now() where operation_id="+quote(failed_operation))
    for _ in range(4):
        db.sql("update public.morning_document_operations set checks_registration_next_retry_at=clock_timestamp()-interval '1 second' where operation_id="+quote(failed_operation)+";select netunim_internal.retry_morning_check_registrations()")
    assert scalar("select state||':'||checks_registration_attempts from public.morning_document_operations where operation_id="+quote(failed_operation))=='created:5'
    assert scalar("select checks_registration_next_retry_at>clock_timestamp()+interval '14 minutes' from public.morning_document_operations where operation_id="+quote(failed_operation))=='t'
    db.sql('select netunim_internal.retry_morning_check_registrations()')
    assert scalar("select checks_registration_attempts from public.morning_document_operations where operation_id="+quote(failed_operation))=='5'
    assert len(rows())==count
    db.sql('drop trigger test_import_failure on netunim_internal.morning_check_registrations;drop function netunim_internal.test_import_failure()')
    db.sql("update public.morning_document_operations set verified_at=verified_at where operation_id="+quote(failed_operation))
    assert len(rows())==count+2
    assert scalar("select checks_registered_at is not null and checks_registration_error is null from public.morning_document_operations where operation_id="+quote(failed_operation))=='t'
    print('PASS cheque upgrade: stored evidence replay, cents, V2 scope, no-op revisions, verified-only import, atomic failure, durable retry and payment-index idempotency')
