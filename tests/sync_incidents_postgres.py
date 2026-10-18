"""Real candidate PostgreSQL: atomic tombstones, authorization and version races."""
from concurrent.futures import ThreadPoolExecutor
import json
from isolated_sync_postgres import IsolatedPostgres, ROOT, OWNER, quote
from supabase_authorization import auth, denied, OTHER


def incident(number=1, **changes):
    return dict(incident_id=f'33333333-3333-4333-8333-{number:012}', client_instance_id='office-browser',
                device_label='Office', site='orders', domain='orders_main', scope_epoch='epoch-A',
                severity='warning', reason_code='stalled', evidence_kind='journal', has_pending=True,
                last_error_code='network', report_version=1, **changes)


def call(db, name, value, owner=OWNER):
    return json.loads(auth(db, owner, 'select public.' + name + '(' + quote(json.dumps(value)) + '::jsonb)'))


def run(db):
    db.sql('INSERT INTO auth.users VALUES(' + quote(OTHER) + ') ON CONFLICT DO NOTHING')
    # Resolution arrives before OPEN; even higher-version late OPEN is terminal.
    row = incident()
    closed = call(db, 'resolve_sync_incident_v1', {**row, 'report_version': 2})
    assert closed['resolution_kind'] == 'clean_verified'
    for version in [1, 2, 3, 100]:
        replay = call(db, 'report_sync_incident_v1', {**row, 'report_version': version})
        assert replay == closed
    # A separate episode, retained across arbitrarily long inactivity.
    row = incident(2)
    opened = call(db, 'report_sync_incident_v1', row)
    assert opened['resolved_at'] is None
    assert call(db, 'report_sync_incident_v1', row) == opened
    updated = call(db, 'report_sync_incident_v1', {**row, 'report_version': 5, 'reason_code': 'conflict'})
    assert updated['reason_code'] == 'conflict'
    assert call(db, 'report_sync_incident_v1', {**row, 'report_version': 3}) == updated
    assert call(db, 'resolve_sync_incident_v1', {**row, 'report_version': 4}) == updated
    db.sql("UPDATE public.sync_incidents SET first_reported_at=now()-interval '100 days',last_reported_at=now()-interval '100 days' WHERE incident_id=" + quote(row['incident_id']))
    listed = json.loads(auth(db, OWNER, 'select public.list_active_sync_incidents_v1()'))
    assert len(listed) == 1 and listed[0]['incident_id'] == row['incident_id']
    assert json.loads(auth(db, OTHER, 'select public.list_active_sync_incidents_v1()')) == []
    # Same incident id in a different account remains wholly separate.
    other_row = call(db, 'report_sync_incident_v1', row, OTHER)
    assert other_row['owner_id'] == OTHER
    assert call(db, 'resolve_sync_incident_v1', {**row, 'report_version': 6}, OTHER)['resolved_at']
    assert len(json.loads(auth(db, OWNER, 'select public.list_active_sync_incidents_v1()'))) == 1
    for field, value in [('client_instance_id', 'other-device'), ('domain', 'orders_sheet'), ('scope_epoch', 'epoch-B')]:
        denied(db, OWNER, "public.resolve_sync_incident_v1(" + quote(json.dumps({**row, field: value, 'report_version': 9})) + "::jsonb)", '22023')
    # Expected-version protection makes operator review explicit and race-safe.
    denied(db, OWNER, "public.mark_sync_incident_reviewed_v1('" + row['incident_id'] + "',4)", '40001')
    denied(db, OTHER, "public.mark_sync_incident_reviewed_v1('" + row['incident_id'] + "',5)", '40001')
    reviewed = json.loads(auth(db, OWNER, "select public.mark_sync_incident_reviewed_v1('" + row['incident_id'] + "',5)"))
    assert reviewed['resolution_kind'] == 'operator_reviewed_unverified'
    assert call(db, 'report_sync_incident_v1', {**row, 'report_version': 10}) == reviewed
    # Concurrent transport arrival order cannot defeat a terminal resolve.
    row = incident(3)
    with ThreadPoolExecutor(max_workers=4) as pool:
        tasks = [pool.submit(call, db, 'report_sync_incident_v1', {**row, 'report_version': n}) for n in range(1, 8)]
        tasks.append(pool.submit(call, db, 'resolve_sync_incident_v1', {**row, 'report_version': 8}))
        for task in tasks:
            task.result()
    assert call(db, 'report_sync_incident_v1', {**row, 'report_version': 20})['resolved_at']
    # No direct table access or internal mutation; no public/anon/null UID RPC.
    for statement in ['select count(*) from public.sync_incidents', 'delete from public.sync_incidents', "update public.sync_incidents set resolved_at=now()"]:
        denied(db, OWNER, '(' + statement + ')') if statement.startswith('select') else auth(db, OWNER, "DO $$ BEGIN " + statement + "; RAISE EXCEPTION 'unexpected access'; EXCEPTION WHEN insufficient_privilege THEN NULL; END $$")
    denied(db, OWNER, 'netunim_internal.write_sync_incident_v1(' + quote(json.dumps(row)) + '::jsonb,false)')
    for role, user in [('anon', ''), ('authenticated', '')]:
        denied(db, user, 'public.list_active_sync_incidents_v1()', role=role)
        denied(db, user, 'public.report_sync_incident_v1(' + quote(json.dumps(row)) + '::jsonb)', role=role)
        denied(db, user, 'public.resolve_sync_incident_v1(' + quote(json.dumps(row)) + '::jsonb)', role=role)
        denied(db, user, "public.mark_sync_incident_reviewed_v1('" + row['incident_id'] + "',1)", role=role)
    for changes in [{'report_version': 1.5}, {'has_pending': 'true'}, {'scope_epoch': None}, {'severity': 'ok'}, {'domain': 'kupa_main'}, {'device_label': 'x'*81}]:
        value={**incident(4), **changes}
        failed=False
        try:
            call(db, 'report_sync_incident_v1', value)
        except Exception:
            failed=True
        assert failed, changes
    # Supplying an owner field cannot choose another tenant.
    assert call(db, 'report_sync_incident_v1', {**incident(5), 'owner_id': OTHER})['owner_id'] == OWNER
    assert db.sql("select count(*) from public.sync_incidents where owner_id='" + OWNER + "' and resolved_at is not null").strip() == '3'


if __name__ == '__main__':
    with IsolatedPostgres(schema_files=sorted((ROOT/'supabase/migrations').glob('*.sql'))) as database:
        run(database)
    print('PASS sync incident PostgreSQL: tombstones, concurrent arrivals, monotonic versions, strict RPC and two-account isolation')
