"""Aggregate Hapoalim placeholders must become their fully itemized deposits.

Real fenced snapshot RPCs in disposable PostgreSQL only. Amounts/labels/balances
reproduce the November incident; cheque/account identities are synthetic.
"""
import copy
import json

from isolated_sync_postgres import OWNER, quote


def run(db):
    token = 'aggregate-cheque-transition'
    lease = json.loads(db.auth_sql(
        "select to_jsonb(x) from public.claim_finance_sync_lease('bank'," + quote(token) + ",60) x"
    ))
    assert lease['acquired']
    pending = dict(
        mergeKey='aggregate-pending', date='2026-11-16T10:00:00Z',
        processedDate='2026-11-16T10:00:00Z', amount=1140, currency='ILS',
        description='הפק שיק-ע.ישיר', status='pending', balanceAfter=11101.98,
        activityTypeCode=1, bankReference='0', bankSerial='0', cheque=True,
        checkDetails=dict(kind='deposit', checkCount=None, checkNumbers=[],
                          checkItems=[], hasDocumentReference=False, warning=''),
    )
    items = [dict(checkNumber=n, amount=570, bankNumber='17', branchNumber='725',
                  accountNumber='90001') for n in ('99000101', '99000102')]
    completed = dict(
        pending, mergeKey='serial:2026-11-16:2:1140', status='completed',
        description='הפק.שיק במכונה', balanceAfter=11141.98,
        bankReference='-1', bankSerial='2',
        checkDetails=dict(kind='deposit', checkCount=2, checkNumbers=[i['checkNumber'] for i in items],
                          checkItems=items, hasDocumentReference=True, warning=''),
    )
    tick = 0

    def snapshot(account, source, complete=True, at=None, role='home'):
        nonlocal tick
        tick += 1
        return json.loads(db.auth_sql(
            "select to_jsonb(x) from public.sync_bank_transactions_snapshot_v6("
            + quote(account) + ',' + quote(role) + ',' + quote(json.dumps(source, ensure_ascii=False))
            + '::jsonb,' + quote(at or f'2026-11-17T00:{tick // 60:02}:{tick % 60:02}Z')
            + ",'2026-11-01','2026-11-17'," + str(complete).lower()
            + ",'bank'," + quote(token) + ',' + str(lease['fence_epoch']) + ') x'
        ))

    def archive(account):
        return json.loads(db.sql(
            "select coalesce(jsonb_agg(to_jsonb(b) order by id),'[]') from public.bank_transactions b"
            + ' where owner_id=' + quote(OWNER) + ' and account_key=' + quote(account)
        ))

    account = 'aggregate-incident'
    snapshot(account, [pending])
    original_id = archive(account)[0]['id']
    result = snapshot(account, [completed])
    rows = archive(account)
    assert len(rows) == 1, 'Aggregate placeholder was falsely retained as a disappeared deposit'
    assert rows[0]['id'] == original_id, 'A newly finalized deposit must retain its archive identity'
    assert rows[0]['status'] == 'completed' and rows[0]['presence_state'] == 'present'
    assert rows[0]['balance_after'] == completed['balanceAfter']
    assert rows[0]['check_details'] == completed['checkDetails']
    assert result['missing_count'] == result['active_missing_count'] == 0
    # The finalized row remains subject to real disappearance/reappearance checks.
    result = snapshot(account, [])
    assert result['active_missing_count'] == 1
    result = snapshot(account, [completed])
    assert result['active_missing_count'] == 0 and len(archive(account)) == 1
    snapshot(account, [completed])
    assert archive(account)[0]['id'] == original_id, 'Replay must be idempotent'

    # An incomplete response cannot prove that a placeholder has disappeared.
    account = 'aggregate-healing'
    snapshot(account, [pending])
    snapshot(account, [completed], complete=False)
    rows = archive(account)
    assert len(rows) == 2 and all(r['presence_state'] == 'present' for r in rows)
    final_id = next(r['id'] for r in rows if r['status'] == 'completed')
    db.sql("update public.bank_transactions set presence_state='missing',missing_since='2026-11-17',"
           "missing_acknowledged_at='2026-11-17' where account_key=" + quote(account) + " and status='pending'")
    before = archive(account)
    try:
        snapshot(account, [completed], at='2026-11-16T00:00:00Z')
    except RuntimeError as error:
        assert 'bank_snapshot_stale' in str(error), str(error)
    else:
        raise AssertionError('A stale full snapshot must be rejected')
    assert archive(account) == before, 'A rejected snapshot must roll back all reconciliation'
    result = snapshot(account, [completed])
    rows = archive(account)
    assert len(rows) == 1 and rows[0]['id'] == final_id
    assert result['missing_count'] == result['active_missing_count'] == 0

    # Both source orders must retain an overlap. A later full scan can resolve it.
    for order in (False, True):
        account = 'aggregate-overlap-' + str(order)
        snapshot(account, [pending])
        source = [pending, completed]
        snapshot(account, list(reversed(source)) if order else source)
        assert len(archive(account)) == 2
        snapshot(account, [completed])
        assert len(archive(account)) == 1

    # Neither historical nor source ambiguity may be resolved by loop order.
    account = 'aggregate-two-pending'
    snapshot(account, [pending, dict(pending, mergeKey='other-pending', balanceAfter=12241.98)])
    snapshot(account, [completed])
    assert len(archive(account)) == 3
    assert sum(r['presence_state'] == 'missing' for r in archive(account)) == 2
    for order in (False, True):
        account = 'aggregate-two-final-' + str(order)
        snapshot(account, [pending])
        other = copy.deepcopy(completed)
        other.update(mergeKey='other-final', bankSerial='3', balanceAfter=12281.98)
        other['checkDetails']['checkItems'][0]['checkNumber'] = '99000201'
        other['checkDetails']['checkNumbers'][0] = '99000201'
        source = [completed, other]
        snapshot(account, list(reversed(source)) if order else source)
        assert len(archive(account)) == 3, 'Two equal deposits must not consume one placeholder'

    # Fail closed on contradictory, incomplete or unrelated cheque evidence.
    variants = [
        dict(completed, processedDate='2026-11-15T10:00:00Z'),
        dict(completed, date='2026-11-15T10:00:00Z'),
        dict(completed, currency='USD'),
        dict(completed, description='הפק.שיק בסלולר'),
        dict(completed, bankReference='123456'),
        dict(completed, status='pending'),
    ]
    for path, value in [('checkCount', 3), ('warning', 'partial'), ('checkItems', [])]:
        variant = copy.deepcopy(completed)
        variant['checkDetails'][path] = value
        variants.append(variant)
    variant = copy.deepcopy(completed)
    variant['checkDetails']['checkItems'][0]['amount'] = 500
    variants.append(variant)
    for index, variant in enumerate(variants):
        account = 'aggregate-unsafe-' + str(index)
        snapshot(account, [pending])
        snapshot(account, [variant])
        assert len(archive(account)) == 2, f'Unsafe completed evidence consumed placeholder: {index}'
    for index, change in enumerate([
        dict(bankReference='99000101'), dict(cheque=False), dict(bankSerial='8'),
        dict(description='הפקדת שיק'),
    ]):
        account = 'aggregate-unsafe-pending-' + str(index)
        snapshot(account, [dict(pending, **change)])
        snapshot(account, [completed])
        assert len(archive(account)) == 2, f'Unrelated pending evidence consumed: {index}'

    # Same amount on another account/role is never a candidate.
    snapshot('aggregate-scope-a', [pending])
    snapshot('aggregate-scope-b', [completed])
    assert archive('aggregate-scope-a')[0]['status'] == 'pending'
    snapshot('aggregate-scope-a', [completed], role='business')
    assert len(archive('aggregate-scope-a')) == 2

    # Provisional workflow claims survive only when their numbered members agree
    # with the final bank items. Never discard a contradictory user obligation.
    for heal in (False, True):
        for compatible in (False, True):
            account = f'aggregate-claim-{heal}-{compatible}'
            snapshot(account, [pending])
            old_id = archive(account)[0]['id']
            if heal:
                snapshot(account, [completed], complete=False)
            members = copy.deepcopy(items)
            for index, member in enumerate(members):
                member.update(id='member-' + str(index), name='Synthetic cheque')
            if not compatible:
                members[0]['checkNumber'] = '99000999'
            db.sql("insert into netunim_internal.check_bank_claims("
                   "owner_id,document_name,transaction_id,account_key,account_role,check_ids,members,source_transaction)"
                   " select owner_id,'aggregate-tests',id,account_key,account_role,'[\"member-0\",\"member-1\"]',"
                   + quote(json.dumps(members)) + "::jsonb,to_jsonb(b) from public.bank_transactions b where id=" + str(old_id))
            snapshot(account, [completed])
            rows = archive(account)
            assert len(rows) == (1 if compatible else 2), 'Contradictory cheque claims must fail closed'
            claim = json.loads(db.sql(
                'select to_jsonb(l) from netunim_internal.check_bank_claims l where account_key=' + quote(account)))
            if compatible:
                assert claim['transaction_id'] == rows[0]['id']
                assert (str(old_id) in claim['previous_transaction_ids']) == heal
            else:
                assert claim['transaction_id'] == old_id and not claim['conflicted']

    # Helper functions stay private; normal authenticated clients use only v6 RPCs.
    for signature in [
        'netunim_internal.bank_aggregate_cheque_transition_matches(public.bank_transactions,jsonb)',
        'netunim_internal.reconcile_bank_aggregate_cheque_transition(text,text,jsonb,date,date)',
    ]:
        for role in ('anon', 'authenticated'):
            assert db.sql('select has_function_privilege(' + quote(role) + ',' + quote(signature)
                          + ",'EXECUTE')").strip() == 'f'
    db.auth_sql("select public.release_finance_sync_lease('bank'," + quote(token) + ')')
    print('PASS aggregate cheque transition: real RPC identity, healing, coverage, ambiguity and rollback', flush=True)


if __name__ == '__main__':
    from isolated_sync_postgres import IsolatedPostgres, ROOT
    with IsolatedPostgres(schema_files=sorted((ROOT / 'supabase/migrations').glob('*.sql'))) as database:
        run(database)
