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

    def snapshot(account, source, complete=True, at=None, role='home', coverage_from='2026-11-01'):
        nonlocal tick
        tick += 1
        return json.loads(db.auth_sql(
            "select to_jsonb(x) from public.sync_bank_transactions_snapshot_v6("
            + quote(account) + ',' + quote(role) + ',' + quote(json.dumps(source, ensure_ascii=False))
            + '::jsonb,' + quote(at or f'2026-11-20T00:{tick // 60:02}:{tick % 60:02}Z')
            + ',' + quote(coverage_from) + ",'2026-11-20'," + str(complete).lower()
            + ",'bank'," + quote(token) + ',' + str(lease['fence_epoch']) + ') x'
        ))

    def archive(account):
        return json.loads(db.sql(
            "select coalesce(jsonb_agg(to_jsonb(b) order by id),'[]') from public.bank_transactions b"
            + ' where owner_id=' + quote(OWNER) + ' and account_key=' + quote(account)
        ))

    # Production regression with synthetic cheque identity. Date, amount,
    # labels, references and balances are the verified bank observations.
    single_day = '2026-11-19T10:00:00Z'
    single_pending = dict(pending, date=single_day, processedDate=single_day, amount=570,
                          balanceAfter=11443.98, mergeKey='single-pending')
    single_final = dict(completed, date=single_day, processedDate=single_day, amount=570,
                        balanceAfter=11593.98, bankReference='3570',
                        bankSerial='1', mergeKey='serial:2026-11-19:1:570',
                        checkDetails=dict(completed['checkDetails'], checkCount=1,
                                          checkNumbers=[items[0]['checkNumber']], checkItems=items[:1]))
    account = 'single-cheque-incident'
    snapshot(account, [single_pending])
    single_id = archive(account)[0]['id']
    result = snapshot(account, [single_final])
    assert result['active_missing_count'] == 0, 'A single cheque was falsely reported missing'
    assert [(r['id'], r['status']) for r in archive(account)] == [(single_id, 'completed')]

    def transition(old_id):
        return json.loads(db.sql(
            'select to_jsonb(t) from netunim_internal.bank_cheque_deposit_transitions t '
            f'where pending_transaction_id={old_id}'
        ) or 'null')

    record = transition(single_id)
    assert record['completed_transaction_id'] == single_id
    assert record['completed_merge_key'] == single_final['mergeKey']
    assert record['pending_observation']['merge_key'] == single_pending['mergeKey']
    assert record['pending_observation']['balance_after'] == single_pending['balanceAfter']

    # An old active warning and a preexisting final are repaired by the same
    # normal complete-snapshot path, retaining the finalized ID and old evidence.
    account = 'single-cheque-healing'
    snapshot(account, [single_pending])
    snapshot(account, [])
    snapshot(account, [single_final], complete=False)
    pending_row, final_row = archive(account)
    assert pending_row['presence_state'] == 'missing'
    result = snapshot(account, [single_final])
    assert result['active_missing_count'] == 0
    assert [r['id'] for r in archive(account)] == [final_row['id']]
    assert transition(pending_row['id'])['pending_observation'] == pending_row

    # The receipt is atomic with the existing merge/source validation.
    account = 'single-cheque-invalid-source'
    snapshot(account, [single_pending])
    before = archive(account)
    unrelated = dict(pending, mergeKey='duplicate-unrelated')
    try:
        snapshot(account, [single_final, unrelated, unrelated])
    except RuntimeError as error:
        assert 'bank_archive_ambiguous_source_identity' in str(error)
    else:
        raise AssertionError('A duplicate source key was accepted')
    assert archive(account) == before and transition(before[0]['id']) is None

    # The pending action can roll onto its established Jerusalem value day.
    account = 'cheque-value-day-rollover'
    value_day = '2026-11-19T22:05:00Z'
    later = dict(single_final, date=value_day, processedDate=value_day)
    snapshot(account, [dict(single_pending, processedDate=value_day)])
    old_id = archive(account)[0]['id']
    snapshot(account, [later], coverage_from='2026-11-20')
    assert len(archive(account)) == 2, 'The original action day is outside coverage'
    snapshot(account, [later])
    assert transition(old_id)['completed_transaction_id'] == archive(account)[0]['id']
    assert len(archive(account)) == 1

    # Matching balances must never bypass completeness or archive ambiguity.
    account = 'single-cheque-partial-same-balance'
    equal_balance = dict(single_final, balanceAfter=single_pending['balanceAfter'])
    snapshot(account, [single_pending])
    snapshot(account, [equal_balance], complete=False)
    assert len(archive(account)) == 2
    assert all(r['presence_state'] == 'present' and r['missing_reason'] is None for r in archive(account))

    account = 'single-cheque-final-already-known'
    snapshot(account, [equal_balance])
    snapshot(account, [equal_balance, single_pending])
    snapshot(account, [equal_balance])
    assert len(archive(account)) == 2, 'A previously known completed deposit must keep its own identity'
    assert archive(account)[1]['missing_reason'] == 'cheque_transition_unresolved'
    snapshot(account, [single_pending, equal_balance])
    assert archive(account)[1]['missing_reason'] is None

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
    assert archive(account)[0]['missing_reason'] is None
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
    assert transition(before[0]['id'])['pending_observation'] == before[0]

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
    assert sum(r['presence_state'] == 'missing' and r['missing_reason'] == 'cheque_transition_unresolved'
               for r in archive(account)) == 2
    for order in (False, True):
        account = 'aggregate-two-final-' + str(order)
        snapshot(account, [pending])
        other = copy.deepcopy(completed)
        other.update(mergeKey='other-final', bankSerial='3', balanceAfter=pending['balanceAfter'])
        other['checkDetails']['checkItems'][0]['checkNumber'] = '99000201'
        other['checkDetails']['checkNumbers'][0] = '99000201'
        source = [completed, other]
        snapshot(account, list(reversed(source)) if order else source)
        assert len(archive(account)) == 3, 'Two equal deposits must not consume one placeholder'
        assert archive(account)[0]['missing_reason'] == 'cheque_transition_unresolved'

    # Fail closed on contradictory, incomplete or unrelated cheque evidence.
    variants = [
        dict(completed, processedDate='2026-11-15T10:00:00Z'),
        dict(completed, date='2026-11-15T10:00:00Z'),
        dict(completed, currency='USD'),
        dict(completed, description='הפק.שיק בסלולר'),
        dict(completed, bankReference='0'),
        dict(completed, status='pending'),
    ]
    for path, value in [('checkCount', 3), ('warning', 'partial'), ('checkItems', [])]:
        variant = copy.deepcopy(completed)
        variant['checkDetails'][path] = value
        variants.append(variant)
    variant = copy.deepcopy(completed)
    variant['checkDetails']['checkItems'][0]['amount'] = 500
    variants.append(variant)
    variant = copy.deepcopy(completed)
    same_cheque = variant['checkDetails']['checkItems'][0]
    same_cheque['amount'] = 500
    variant['checkDetails']['checkItems'][1] = dict(same_cheque, amount=640)
    variant['checkDetails']['checkNumbers'] = [same_cheque['checkNumber']]
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
                assert rows[0]['missing_reason'] == 'cheque_transition_unresolved'
                assert transition(old_id) is None

    for protected in ('handled-state', 'morning-link'):
        account = 'single-cheque-' + protected
        snapshot(account, [single_pending], role='business')
        old_id = archive(account)[0]['id']
        if protected == 'handled-state':
            db.sql(f'update public.bank_transactions set handled_at=now() where id={old_id}')
        else:
            operation = db.sql(
                'insert into public.morning_document_operations(operation_id,owner_id,environment,'
                'request_fingerprint,state,document_type,amount,document_date,document_id,verified_at,issuance_started_at)'
                f" values(gen_random_uuid(),{quote(OWNER)},'sandbox','synthetic','created',320,570,'2026-11-19',"
                "'synthetic-cheque-link',now(),now())"
                ' returning operation_id'
            ).strip()
            db.sql('insert into public.bank_transaction_document_links(owner_id,transaction_id,operation_id,'
                   'environment,document_id,document_type,document_amount,bank_amount,verified_at)'
                   f" values({quote(OWNER)},{old_id},{quote(operation)},'sandbox','synthetic-cheque-link',320,570,570,now())")
        snapshot(account, [single_final], role='business')
        rows = archive(account)
        assert len(rows) == 2 and rows[0]['id'] == old_id and transition(old_id) is None
        assert rows[0]['missing_reason'] == 'cheque_transition_unresolved'

    # Helper functions stay private; normal authenticated clients use only v6 RPCs.
    for signature in [
        'netunim_internal.bank_aggregate_cheque_transition_matches(public.bank_transactions,jsonb)',
        'netunim_internal.reconcile_bank_aggregate_cheque_transition(text,text,jsonb,timestamptz,date,date)',
        'netunim_internal.bank_unitemized_cheque_placeholder(public.bank_transactions)',
    ]:
        for role in ('anon', 'authenticated'):
            assert db.sql('select has_function_privilege(' + quote(role) + ',' + quote(signature)
                          + ",'EXECUTE')").strip() == 'f'
    for role in ('anon', 'authenticated'):
        assert db.sql(f"select has_table_privilege('{role}',"
                      "'netunim_internal.bank_cheque_deposit_transitions','SELECT')").strip() == 'f'
    db.auth_sql("select public.release_finance_sync_lease('bank'," + quote(token) + ')')
    print('PASS aggregate cheque transition: real RPC identity, healing, coverage, ambiguity and rollback', flush=True)


if __name__ == '__main__':
    from isolated_sync_postgres import IsolatedPostgres, ROOT
    with IsolatedPostgres(schema_files=sorted((ROOT / 'supabase/migrations').glob('*.sql'))) as database:
        run(database)
