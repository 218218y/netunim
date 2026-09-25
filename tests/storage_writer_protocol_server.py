"""Owner-scoped post-cutover writer fence against disposable PostgreSQL only."""
import json

from isolated_sync_postgres import IsolatedPostgres, ROOT, OWNER, quote
from supabase_authorization import OTHER, MAIN, auth, denied


ORDERS = json.dumps({
    'version': 5,
    'suppliers': [], 'transactions': [], 'customerDebts': [],
    'customerOrders': [], 'serviceCalls': [], 'notes': [],
    'inventoryItems': [], 'inventoryEvents': [], 'warehouseOrders': [],
    'inventoryCategoryOrder': [],
}, separators=(',', ':'))
SHARED = '{"version":1,"checks":[],"bankEvents":[]}'
RESTORE_ID = '55555555-5555-4555-8555-555555555555'


def revision(db, owner, table, document):
    return int(auth(db, owner, 'select revision from public.' + table +
                    ' where document_name=' + quote(document)))


def document_state(domain, changed=False):
    state = json.loads({'orders': ORDERS, 'kupa': MAIN, 'shared-checks': SHARED}[domain])
    if changed:
        if domain == 'shared-checks':
            state['checks'] = [{'id': 'protocol-check', 'amount': 100,
                                'dueDate': '2026-10-10', 'status': 'בקופה'}]
        else:
            state['notes'] = [{'id': 'protocol-note', 'content': 'v2'}]
    return json.dumps(state, separators=(',', ':'))


def write(db, owner, domain, version, expected, operation, changed=False):
    if domain == 'orders':
        name, doc, deleted = 'order_management', 'suppliers', '{}'
    elif domain == 'kupa':
        name, doc, deleted = 'kupa', 'main', '{}'
    else:
        name, doc, deleted = 'shared_checks', 'main', '[]'
    state = document_state(domain, changed)
    statement = ('select revision from public.save_' + name + '_document_v' + str(version) +
                 '(' + quote(doc) + ',' + str(expected) + ',' + quote(state) + ',' +
                 quote(operation) + ',' + quote(deleted) + ",'{}')")
    return int(auth(db, owner, statement))


def verify_v6_without_public_legacy(db):
    # The V2 graph must still work when old public RPC names are absent. This
    # catches indirect V6 -> V5 -> V4 (and finance V5 -> V3) dependencies.
    legacy = (
        ('save_order_management_document_v4', 'text,bigint,jsonb,text,jsonb'),
        ('save_order_management_document_v5', 'text,bigint,jsonb,text,jsonb,jsonb'),
        ('bulk_delete_save_order_management_document_v5', 'text,bigint,jsonb,text,jsonb,jsonb'),
        ('save_kupa_document_v4', 'text,bigint,jsonb,text,jsonb'),
        ('save_kupa_document_v5', 'text,bigint,jsonb,text,jsonb,jsonb'),
        ('bulk_delete_save_kupa_document_v5', 'text,bigint,jsonb,text,jsonb,jsonb'),
        ('save_shared_checks_document_v4', 'text,bigint,jsonb,text,jsonb'),
        ('save_shared_checks_document_v5', 'text,bigint,jsonb,text,jsonb,jsonb'),
        ('bulk_delete_save_shared_checks_document_v5', 'text,bigint,jsonb,text,jsonb,jsonb'),
        ('stage_restore_group_v5', 'uuid,text,text,bigint,jsonb,jsonb,text,bigint,jsonb,jsonb,text,text,jsonb'),
        ('apply_restore_group_v5', 'uuid'),
        ('save_finance_sync_document_v3', 'text,bigint,jsonb,text'),
        ('save_finance_sync_document_v5', 'text,bigint,jsonb,text,jsonb,text,text,bigint'),
        ('merge_bank_transactions', 'text,text,jsonb,text,text,bigint'),
        ('sync_bank_transactions_snapshot', 'text,text,jsonb,timestamptz,date,date,boolean,text,text,bigint'),
        ('save_bank_sync_snapshot', 'text,jsonb,text,bigint,text,text,bigint'),
    )
    for index, (name, signature) in enumerate(legacy):
        db.sql('alter function public.' + name + '(' + signature + ') rename to disabled_legacy_' + str(index))
    capabilities = json.loads(auth(db, OWNER, 'select public.get_netunim_sync_capabilities()'))
    assert capabilities['storageWriterProtocol'] == 2 and capabilities['restoreGroups'] == 5
    assert capabilities['sharedChecksIntegrity'] == 5 and capabilities['financeFencing'] == 2

    for domain, table, document, rpc in (
        ('orders', 'order_management_documents', 'suppliers', 'order_management'),
        ('kupa', 'kupa_documents', 'main', 'kupa'),
        ('shared-checks', 'shared_checks_documents', 'main', 'shared_checks'),
    ):
        current = json.loads(auth(db, OWNER, 'select state::text from public.' + table +
                                  ' where owner_id=auth.uid() and document_name=' + quote(document)))
        if domain == 'shared-checks':
            assert current['checks']
            current['checks'][0]['amount'] += 1
        else:
            current['notes'].append({'id': 'detached-note-' + domain, 'content': 'first'})
        before = revision(db, OWNER, table, document)
        intents = '[]' if domain == 'shared-checks' else '{}'
        args = ('(' + quote(document) + ',' + str(before) + ',' + quote(json.dumps(current)) + ',' +
                quote('detached-v6-' + domain) + ',' + quote(intents) + ",'{}')")
        saved = int(auth(db, OWNER, 'select revision from public.save_' + rpc + '_document_v6' + args))
        assert saved == before + 1, (domain, before, saved)
        if domain == 'shared-checks':
            current['checks'][0]['amount'] += 1
        else:
            current['notes'][-1]['content'] = 'second'
        bulk = 'public.bulk_delete_save_' + rpc + '_document_v6'
        bulk_args = ('(' + quote(document) + ',' + str(before + 1) + ',' + quote(json.dumps(current)) + ',' +
                     quote('detached-bulk-' + domain) + ',' + quote(intents) + ",'{}')")
        assert int(auth(db, OWNER, 'select revision from ' + bulk + bulk_args)) == before + 2

    restore_id = '55555555-5555-4555-8555-555555555556'
    orders_state = auth(db, OWNER, "select state::text from public.order_management_documents where owner_id=auth.uid() and document_name='suppliers'")
    orders_revision = revision(db, OWNER, 'order_management_documents', 'suppliers')
    auth(db, OWNER, "select * from public.stage_restore_group_v6('" + restore_id + "','orders','suppliers'," +
         str(orders_revision) + ',' + quote(orders_state) + ",'{}','main',null,null,'[]','detached-restore-main','detached-restore-checks','{}')")
    assert '|completed|' in auth(db, OWNER, "select * from public.apply_restore_group_v6('" + restore_id + "')")

    auth(db, OWNER, "select acquired from public.claim_finance_sync_lease('credit','credit-v6-lease',600)")
    credit_epoch = auth(db, OWNER, 'select fence_epoch from public.finance_sync_leases where owner_id=auth.uid() and lease_name=\'credit\'')
    finance_state = json.loads(auth(db, OWNER, "select state::text from public.finance_sync_documents where owner_id=auth.uid() and document_name='main'"))
    finance_state.setdefault('creditSync', {})['syncedAt'] = 'detached-v6'
    finance_revision = revision(db, OWNER, 'finance_sync_documents', 'main')
    assert int(auth(db, OWNER, "select revision from public.save_finance_sync_document_v6('main'," +
                    str(finance_revision) + ',' + quote(json.dumps(finance_state)) + ",'detached-credit','{}','credit','credit-v6-lease'," + credit_epoch + ')')) == finance_revision + 1
    auth(db, OWNER, "select acquired from public.claim_finance_sync_lease('bank','bank-v6-lease',600)")
    bank_epoch = auth(db, OWNER, "select fence_epoch from public.finance_sync_leases where owner_id=auth.uid() and lease_name='bank'")
    assert int(auth(db, OWNER, "select total_count from public.merge_bank_transactions_v6('account','business','[]','bank','bank-v6-lease'," + bank_epoch + ')')) == 0
    assert int(auth(db, OWNER, "select total_count from public.sync_bank_transactions_snapshot_v6('account','business','[]',now(),null,null,false,'bank','bank-v6-lease'," + bank_epoch + ')')) == 0
    auth(db, OWNER, "select kupa_revision from public.save_bank_sync_snapshot_v6('main','{\"currentBalance\":123}','detached-bank',0,'bank','bank-v6-lease'," + bank_epoch + ')')


def run(db, verify_without_legacy=True):
    db.sql('insert into auth.users values(' + quote(OTHER) + ')')
    for owner in (OWNER, OTHER):
        for domain in ('orders', 'kupa', 'shared-checks'):
            assert write(db, owner, domain, 5, 0, 'seed-' + domain) == 1
    capabilities = json.loads(auth(db, OWNER, 'select public.get_netunim_sync_capabilities()'))
    assert capabilities['storageWriterProtocol'] == 2, capabilities
    assert json.loads(auth(db, OWNER, 'select public.get_storage_protocol_state()')) == {
        'orders': 1, 'kupa': 1, 'sharedChecks': 1}
    denied(db, OWNER, 'public.activate_storage_protocol_v2(2,1,1)', 'PT409')
    assert json.loads(auth(db, OWNER, 'select public.activate_storage_protocol_v2(1,1,1)')) == {
        'orders': 2, 'kupa': 2, 'sharedChecks': 2}
    # A browser role cannot mint a trusted v6 invocation, even when it can
    # supply an arbitrary custom GUC in SQL. No permit survives an RPC call.
    denied(db, OWNER, "netunim_internal.enter_storage_writer_v2('orders')", '42501')
    assert db.sql('select count(*) from netunim_internal.storage_writer_invocations').strip() == '0'
    # The marker belongs to the authenticated owner; an unrelated account can
    # still use the compatibility writer until its own explicit activation.
    assert json.loads(auth(db, OTHER, 'select public.get_storage_protocol_state()')) == {
        'orders': 1, 'kupa': 1, 'sharedChecks': 1}
    assert write(db, OTHER, 'orders', 5, 1, 'unfenced-other', changed=True) == 2

    for domain, table, doc in (
        ('orders', 'order_management_documents', 'suppliers'),
        ('kupa', 'kupa_documents', 'main'),
        ('shared-checks', 'shared_checks_documents', 'main'),
    ):
        # A new operation from an old tab must fail before it can move a head.
        name = {'orders': 'order_management', 'kupa': 'kupa', 'shared-checks': 'shared_checks'}[domain]
        state = document_state(domain, changed=True)
        deleted = '[]' if domain == 'shared-checks' else '{}'
        old = ('public.save_' + name + '_document_v5(' + quote(doc) + ',1,' +
               quote(state) + ',' + quote('old-' + domain) + ',' + quote(deleted) + ",'{}')")
        denied(db, OWNER, old, 'PT426')
        auth(db, OWNER, "DO $test$ BEGIN PERFORM set_config('app.netunim_storage_writer_protocol','2',true); " +
             'PERFORM ' + old + "; RAISE EXCEPTION 'guc_bypass_succeeded'; EXCEPTION WHEN SQLSTATE 'PT426' THEN NULL; END $test$")
        for legacy in (
            'public.save_' + name + '_document(' + quote(doc) + ',1,' + quote(state) + ')',
            'public.save_' + name + '_document_v3(' + quote(doc) + ',1,' + quote(state) +
            ',' + quote('old-v3-' + domain) + ')',
            'public.save_' + name + '_document_v4(' + quote(doc) + ',1,' + quote(state) +
            ',' + quote('old-v4-' + domain) + ',' + quote(deleted) + ')',
        ):
            denied(db, OWNER, legacy, 'PT426')
        assert revision(db, OWNER, table, doc) == 1
        # Direct table grants cannot bypass the existing RPC guard or the new
        # protocol trigger. No owner or state is changed by the rejected write.
        auth(db, OWNER, "DO $test$ BEGIN UPDATE public." + table +
             " SET state=state WHERE owner_id=auth.uid() AND document_name='" + doc +
             "'; RAISE EXCEPTION 'direct_write_succeeded'; EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END $test$")
        assert revision(db, OWNER, table, doc) == 1
        assert write(db, OWNER, domain, 6, 1, 'v2-' + domain, changed=True) == 2
        assert db.sql('select count(*) from netunim_internal.storage_writer_invocations').strip() == '0'

    # Restore is a separate public mutation entrypoint. A stale tab cannot
    # even stage a group for a newer client to pick up later.
    restore_state = json.loads(document_state('kupa', changed=True))
    restore_state['notes'].append({'id': 'restore-note', 'content': 'restored'})
    stage = ("public.stage_restore_group_v5('" + RESTORE_ID + "','kupa','main',2," +
             quote(json.dumps(restore_state, separators=(',', ':'))) +
             ",'{}','main',null,null,'[]','restore-main','restore-checks','{}')")
    denied(db, OWNER, stage, 'PT426')
    auth(db, OWNER, 'select * from ' + stage.replace('stage_restore_group_v5', 'stage_restore_group_v6'))
    denied(db, OWNER, "public.apply_restore_group_v5('" + RESTORE_ID + "')", 'PT426')
    assert revision(db, OWNER, 'kupa_documents', 'main') == 2
    assert '|completed|' in auth(db, OWNER, "select * from public.apply_restore_group_v6('" + RESTORE_ID + "')")
    assert revision(db, OWNER, 'kupa_documents', 'main') == 3
    # A v6 function's protocol context must be restored before another RPC in
    # the same transaction. An old writer cannot borrow the preceding call.
    next_orders = json.loads(document_state('orders', changed=True))
    next_orders['notes'].append({'id': 'next-note', 'content': 'v6'})
    stale_orders = json.loads(json.dumps(next_orders))
    stale_orders['notes'].append({'id': 'stale-note', 'content': 'v5'})
    v6 = "public.save_order_management_document_v6('suppliers',2," + quote(json.dumps(next_orders)) + ",'v6-same-transaction','{}','{}')"
    v5 = "public.save_order_management_document_v5('suppliers',3," + quote(json.dumps(stale_orders)) + ",'v5-same-transaction','{}','{}')"
    auth(db, OWNER, 'select revision from ' + v6 + '; DO $test$ BEGIN PERFORM ' + v5 +
         "; RAISE EXCEPTION 'legacy_context_leaked'; EXCEPTION WHEN SQLSTATE 'PT426' THEN NULL; END $test$")
    assert revision(db, OWNER, 'order_management_documents', 'suppliers') == 3
    assert json.loads(auth(db, OWNER, 'select public.activate_storage_protocol_v2(1,1,1)')) == {
        'orders': 2, 'kupa': 2, 'sharedChecks': 2}
    denied(db, '', 'public.get_storage_protocol_state()')
    denied(db, '', 'public.activate_storage_protocol_v2(1,1,1)')
    # Financial writes share Kupa business state. The bank snapshot updates
    # both finance and Kupa in one transaction; credit updates finance only.
    # Old financial RPCs must not bypass the account's Storage V2 fence.
    capabilities = json.loads(auth(db, OWNER, 'select public.get_netunim_sync_capabilities()'))
    assert capabilities['financeFencing'] == 2, capabilities
    auth(db, OWNER, "select acquired from public.claim_finance_sync_lease('bank','bank-v6-lease',600)")
    bank_epoch = auth(db, OWNER, "select fence_epoch from public.finance_sync_leases where owner_id=auth.uid() and lease_name='bank'")
    archive_args = "'account','business','[]',now(),null,null,false,'bank','bank-v6-lease'," + bank_epoch
    old_archive = 'public.sync_bank_transactions_snapshot(' + archive_args + ')'
    new_archive = 'public.sync_bank_transactions_snapshot_v6(' + archive_args + ')'
    denied(db, OWNER, old_archive, 'PT426')
    assert int(auth(db, OWNER, 'select total_count from ' + new_archive)) == 0
    merge_args = "'account','business','[]','bank','bank-v6-lease'," + bank_epoch
    denied(db, OWNER, 'public.merge_bank_transactions(' + merge_args + ')', 'PT426')
    assert int(auth(db, OWNER, 'select total_count from public.merge_bank_transactions_v6(' + merge_args + ')')) == 0
    assert db.sql('select count(*) from netunim_internal.storage_writer_invocations').strip() == '0'
    bank_args = "'main','{\"currentBalance\":123,\"source\":\"hapoalim\"}','bank-v6-snapshot',0,'bank','bank-v6-lease'," + bank_epoch
    old_bank = 'public.save_bank_sync_snapshot(' + bank_args + ')'
    new_bank = 'public.save_bank_sync_snapshot_v6(' + bank_args + ')'
    denied(db, OWNER, old_bank, 'PT426')
    assert int(auth(db, OWNER, 'select kupa_revision from ' + new_bank)) == 4
    assert int(auth(db, OWNER, 'select kupa_revision from ' + new_bank)) == 4  # lost ACK replay
    denied(db, OWNER, old_bank, 'PT426')  # old replay is rejected too
    assert db.sql('select count(*) from netunim_internal.storage_writer_invocations').strip() == '0'
    auth(db, OWNER, "select acquired from public.claim_finance_sync_lease('credit','credit-v6-lease',600)")
    credit_epoch = auth(db, OWNER, "select fence_epoch from public.finance_sync_leases where owner_id=auth.uid() and lease_name='credit'")
    credit_state = '{\"bank\":{\"currentBalance\":123},\"creditSync\":{\"syncedAt\":\"v6\"}}'
    credit_args = "'main',1," + quote(credit_state) + ",'credit-v6-operation','{}','credit','credit-v6-lease'," + credit_epoch
    old_credit = 'public.save_finance_sync_document_v5(' + credit_args + ')'
    new_credit = 'public.save_finance_sync_document_v6(' + credit_args + ')'
    denied(db, OWNER, old_credit, 'PT426')
    assert int(auth(db, OWNER, 'select revision from ' + new_credit)) == 2
    assert int(auth(db, OWNER, 'select revision from ' + new_credit)) == 2  # operation replay
    denied(db, OWNER, old_credit, 'PT426')
    assert db.sql('select count(*) from netunim_internal.storage_writer_invocations').strip() == '0'
    # The lease still fences an old worker even through the new V2 entrypoint.
    denied(db, OWNER, "public.save_bank_sync_snapshot_v6('main','{}','bad-bank-lease',0,'bank','wrong'," + bank_epoch + ')', 'PT409')
    denied(db, OWNER, "public.save_finance_sync_document_v6('main',2,'{}','bad-credit-lease','{}','credit','wrong'," + credit_epoch + ')', 'PT409')
    # A direct financial write or a legacy RPC cannot borrow a completed V6
    # invocation, including another call in the same database transaction.
    auth(db, OWNER, "DO $test$ BEGIN UPDATE public.finance_sync_documents SET state=state WHERE owner_id=auth.uid(); RAISE EXCEPTION 'direct_finance_write_succeeded'; EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END $test$")
    later_credit = "public.save_finance_sync_document_v5('main',2," + quote(credit_state) + ",'credit-legacy-later','{}','credit','credit-v6-lease'," + credit_epoch + ')'
    auth(db, OWNER, 'select revision from ' + new_credit + '; DO $test$ BEGIN PERFORM ' + later_credit + "; RAISE EXCEPTION 'legacy_finance_context_leaked'; EXCEPTION WHEN SQLSTATE 'PT426' THEN NULL; END $test$")
    assert int(auth(db, OWNER, "select revision from public.finance_sync_documents where owner_id=auth.uid() and document_name='main'")) == 2
    # Protocol activation is owner-scoped; other owners retain their legacy
    # finance path until their own cutover.
    auth(db, OTHER, "select acquired from public.claim_finance_sync_lease('bank','other-bank-lease',600)")
    other_epoch = auth(db, OTHER, "select fence_epoch from public.finance_sync_leases where owner_id=auth.uid() and lease_name='bank'")
    other_before = revision(db, OTHER, 'kupa_documents', 'main')
    assert int(auth(db, OTHER, "select kupa_revision from public.save_bank_sync_snapshot('main','{}','other-bank',0,'bank','other-bank-lease'," + other_epoch + ')')) == other_before + 1
    if verify_without_legacy:
        verify_v6_without_public_legacy(db)


def verify_legacy_revoke(db):
    # An unfenced owner cannot use the old RPCs after retirement either.
    # Checking effective privileges also catches EXECUTE inherited from PUBLIC.
    legacy = (
        'save_order_management_document(text,bigint,jsonb)',
        'save_order_management_document_v3(text,bigint,jsonb,text)',
        'save_order_management_document_v4(text,bigint,jsonb,text,jsonb)',
        'save_order_management_document_v5(text,bigint,jsonb,text,jsonb,jsonb)',
        'bulk_delete_save_order_management_document_v5(text,bigint,jsonb,text,jsonb,jsonb)',
        'save_kupa_document(text,bigint,jsonb)',
        'save_kupa_document_v3(text,bigint,jsonb,text)',
        'save_kupa_document_v4(text,bigint,jsonb,text,jsonb)',
        'save_kupa_document_v5(text,bigint,jsonb,text,jsonb,jsonb)',
        'bulk_delete_save_kupa_document_v5(text,bigint,jsonb,text,jsonb,jsonb)',
        'save_shared_checks_document(text,bigint,jsonb)',
        'save_shared_checks_document_v3(text,bigint,jsonb,text)',
        'save_shared_checks_document_v4(text,bigint,jsonb,text,jsonb)',
        'save_shared_checks_document_v5(text,bigint,jsonb,text,jsonb,jsonb)',
        'bulk_delete_save_shared_checks_document_v5(text,bigint,jsonb,text,jsonb,jsonb)',
        'stage_restore_group_v5(uuid,text,text,bigint,jsonb,jsonb,text,bigint,jsonb,jsonb,text,text,jsonb)',
        'apply_restore_group_v5(uuid)',
        'save_finance_sync_document(text,bigint,jsonb)',
        'save_finance_sync_document_v3(text,bigint,jsonb,text)',
        'save_finance_sync_document_v5(text,bigint,jsonb,text,jsonb,text,text,bigint)',
        'merge_bank_transactions(text,text,jsonb,text,text,bigint)',
        'sync_bank_transactions_snapshot(text,text,jsonb,timestamptz,date,date,boolean,text,text,bigint)',
        'save_bank_sync_snapshot(text,jsonb,text,bigint,text,text,bigint)',
    )
    for signature in legacy:
        for role in ('anon', 'authenticated'):
            privilege = db.sql("select has_function_privilege('" + role + "','public." +
                               signature + "','EXECUTE')").strip()
            assert privilege == 'f', (role, signature, privilege)
    for table in ('order_management_documents', 'kupa_documents',
                  'shared_checks_documents', 'finance_sync_documents'):
        for privilege in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'):
            allowed = db.sql("select has_table_privilege('authenticated','public." +
                             table + "','" + privilege + "')").strip()
            assert allowed == 'f', (table, privilege, allowed)
    denied(db, OTHER, "public.save_order_management_document_v5('suppliers',2,'{}','retired','{}','{}')", '42501')
    capabilities = json.loads(auth(db, OWNER, 'select public.get_netunim_sync_capabilities()'))
    assert capabilities['storageWriterProtocol'] == 2 and capabilities['financeFencing'] == 2
    verify_v6_without_public_legacy(db)


if __name__ == '__main__':
    migrations = sorted((ROOT/'supabase/migrations').glob('*.sql'))
    with IsolatedPostgres(schema_files=migrations[:-2], demotable_postgres=True) as database:
        # Supabase's migration postgres role is not a superuser. Installing the
        # new migration after demotion catches privileged function SET clauses.
        database.sql('grant create on schema public to postgres; grant authenticated to postgres; '
                     'alter role postgres nosuperuser bypassrls;')
        database.migrate(migrations[-2].read_text(encoding='utf-8-sig'))
        run(database, verify_without_legacy=False)
        database.migrate(migrations[-1].read_text(encoding='utf-8-sig'))
        verify_legacy_revoke(database)
    print('PASS Storage V2 server fence: legacy grants revoked, v6/restore/finance allowed, owner isolation')
