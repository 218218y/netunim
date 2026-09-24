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


def run(db):
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


if __name__ == '__main__':
    with IsolatedPostgres(schema_files=sorted((ROOT/'supabase/migrations').glob('*.sql'))) as database:
        run(database)
    print('PASS Storage V2 server fence: old RPC/direct write blocked, v6/restore allowed, owner isolation')
