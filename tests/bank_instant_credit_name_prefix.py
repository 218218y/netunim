"""Real PostgreSQL reconciliation cases for an observed Hapoalim instant-credit variant.

Run only against the disposable, fully migrated candidate database. No live credentials.
"""

import json

from isolated_sync_postgres import OWNER, quote


def run(db):
    lease = json.loads(db.auth_sql(
        "select to_jsonb(x) from public.claim_finance_sync_lease('bank','instant-name-prefix-proof',60) x"
    ))
    assert lease['acquired'], 'bank test needs a real lease and fenced RPC'

    pending = {
        'mergeKey': 'pending:88811223', 'date': '2026-11-05T10:00:00Z',
        'processedDate': '2026-11-05T10:00:00Z', 'amount': 1470,
        'currency': 'ILS', 'description': 'זיכוי מיידי', 'status': 'pending',
        'balanceAfter': 20001.42, 'activityTypeCode': 1,
        'bankReference': '88811223', 'bankSerial': '0', 'cheque': False,
        'partyName': 'מפלוני דנה ויעל', 'messageDetail': '020-570-000123456',
        'memo': 'המבצע: מפלוני דנה ויעל עבור: 020-570-000123456',
    }
    completed = {
        **pending, 'mergeKey': 'serial:2026-11-05:1:1470',
        'description': 'זיכוי מהמזרחי', 'status': 'completed',
        'bankReference': '77733445', 'bankSerial': '1',
        'partyName': 'פלוני דנה ויעל',
        'messageDetail': 'תודה רבה מח-ן:000123456',
        'memo': 'המבצע: פלוני דנה ויעל עבור: תודה רבה מח-ן:000123456',
    }

    stamp = 0

    def snapshot(account, source):
        nonlocal stamp
        stamp += 1
        at = f'2026-11-06T03:26:{stamp:02d}Z'
        return json.loads(db.auth_sql(
            "select to_jsonb(x) from public.sync_bank_transactions_snapshot_v6("
            + quote(account) + ",'business'," + quote(json.dumps(source, ensure_ascii=False))
            + "::jsonb," + quote(at) + ",'2026-11-01','2026-11-06',true,"
            + "'bank','instant-name-prefix-proof'," + str(lease['fence_epoch']) + ") x"
        ))

    def archive(account):
        return json.loads(db.sql(
            "select coalesce(jsonb_agg(jsonb_build_object("
            "'id',id,'mergeKey',merge_key,'description',description,'status',status,"
            "'presence',presence_state,'missingSince',missing_since,'reference',bank_reference"
            ") order by id),'[]'::jsonb) from public.bank_transactions where "
            "owner_id=" + quote(OWNER) + " and account_key=" + quote(account)
            + " and account_role='business'"
        ))

    # Actual incident: a single prefixed surname on the pending representation;
    # identical amount, balance, bank day, direction and nine-digit account suffix.
    snapshot('prefix-observed', [pending])
    original = archive('prefix-observed')[0]['id']
    snapshot('prefix-observed', [completed])
    rows = archive('prefix-observed')
    assert len(rows) == 1 and rows[0]['id'] == original, rows
    assert (rows[0]['status'], rows[0]['presence'], rows[0]['reference']) == (
        'completed', 'present', '77733445'
    ), rows
    snapshot('prefix-observed', [completed])
    assert archive('prefix-observed') == rows, 'refresh must be idempotent'

    # Existing production archive may already contain the final row plus the
    # historical stale pending warning. Re-reading the final row must heal only
    # that exact, unique obsolete placeholder and keep the completed ID.
    snapshot('prefix-existing', [completed])
    final_id = archive('prefix-existing')[0]['id']
    stale_id = db.sql(
        "insert into public.bank_transactions(owner_id,account_key,account_role,"
        "merge_key,transaction_date,processed_date,amount,currency,description,memo,"
        "party_name,message_detail,status,balance_after,bank_reference,bank_serial,"
        "activity_type_code,presence_state,missing_since) values("
        + quote(OWNER) + ",'prefix-existing','business',"
        + quote(pending['mergeKey']) + "," + quote(pending['date']) + ","
        + quote(pending['processedDate']) + ",1470,'ILS',"
        + quote(pending['description']) + "," + quote(pending['memo']) + ","
        + quote(pending['partyName']) + "," + quote(pending['messageDetail'])
        + ",'pending',20001.42,'88811223','0',1,'missing','2026-11-06T03:25:00Z')"
        " returning id"
    ).strip()
    assert len(archive('prefix-existing')) == 2
    snapshot('prefix-existing', [completed])
    assert len(archive('prefix-existing')) == 1
    assert archive('prefix-existing')[0]['id'] == final_id
    assert archive('prefix-existing')[0]['id'] != int(stale_id)

    # A prefix variation alone must never outrank conflicting financial facts.
    for label, changes in (
        ('unrelated-name', {'partyName': 'מפלוני דנה ושמואל'}),
        ('different-account', {'messageDetail': '020-570-000123457'}),
        ('different-balance', {'balanceAfter': 20001.43}),
        ('different-direction', {'activityTypeCode': 2}),
        ('different-bank-day', {'date': '2026-11-04T10:00:00Z'}),
        ('missing-balance', {'balanceAfter': None}),
    ):
        account = 'prefix-negative-' + label
        old = {**pending, **changes}
        snapshot(account, [old])
        snapshot(account, [completed])
        rows = archive(account)
        assert len(rows) == 2, (label, rows)
        assert sorted(row['presence'] for row in rows) == ['missing', 'present'], (label, rows)

    # Multiple equally plausible pending candidates: preserve review evidence.
    other = {**pending, 'mergeKey': 'pending:another', 'bankReference': '88811224'}
    snapshot('prefix-ambiguous', [pending, other])
    snapshot('prefix-ambiguous', [completed])
    rows = archive('prefix-ambiguous')
    assert len(rows) == 3 and sum(row['presence'] == 'missing' for row in rows) == 2, rows

    # Both versions can be genuinely present in one source snapshot. Do not
    # replace/delete an observed pending bank row even with a unique match.
    snapshot('prefix-both-visible', [pending])
    snapshot('prefix-both-visible', [pending, completed])
    rows = archive('prefix-both-visible')
    assert len(rows) == 2 and all(row['presence'] == 'present' for row in rows), rows

    # The match is always owner/account/role scoped.
    snapshot('prefix-separate-account', [pending])
    snapshot('prefix-different-account', [completed])
    assert len(archive('prefix-separate-account')) == 1
    assert archive('prefix-separate-account')[0]['status'] == 'pending'
    assert len(archive('prefix-different-account')) == 1

    print('PASS instant-credit pending/completed name-prefix reconciliation', flush=True)
