"""Real PostgreSQL regressions for structured check identity and deposit cycles."""
import json
from isolated_sync_postgres import OWNER, quote


def run(db):
    serial = 0
    def auth(sql):
        return db.sql("begin;set local request.jwt.claim.sub="+quote(OWNER)+";"+sql+";commit").strip()
    def checks():
        return json.loads(db.sql("select state->'checks' from public.shared_checks_documents where owner_id="+quote(OWNER)+" and document_name='main'"))
    def save(rows,deleted=None):
        rev=db.sql("select revision from public.shared_checks_documents where owner_id="+quote(OWNER)+" and document_name='main'").strip() or '0'
        if deleted:
            auth("set local role authenticated;select revision from public.save_shared_checks_document_v4('main',"+rev+","+quote(json.dumps({'checks':rows}))+"::jsonb,'item-delete-operation',"+quote(json.dumps(deleted))+"::jsonb)")
        else:
            auth("set local role authenticated;select revision from public.save_shared_checks_document('main',"+rev+","+quote(json.dumps({'checks':rows}))+"::jsonb)")
    def check(id, amount, number='', **extra):
        return dict(id=id,name=id,amount=amount,checkNumber=number,dueDate='2026-08-02',account='עסקי',status='בקופה',**extra)
    def item(number, amount, account='12345'):
        return dict(checkNumber=number,amount=amount,bankNumber='12',branchNumber='100',accountNumber=account)
    def tx(key, amount, items=None, day='2026-08-02', description='הפק.שיק בסלולר', status='completed', reference=''):
        details={} if items is None else dict(checkItems=items,checkNumbers=[x['checkNumber'] for x in items if x['checkNumber']],checkCount=len(items))
        return db.sql("insert into public.bank_transactions(owner_id,account_key,account_role,merge_key,amount,description,transaction_date,processed_date,status,presence_state,check_details,bank_reference) values("+quote(OWNER)+",'item-tests','business',"+quote(key)+","+str(amount)+","+quote(description)+","+quote(day)+","+quote(day)+","+quote(status)+",'present',"+quote(json.dumps(details))+","+quote(reference)+") returning id").strip()
    def snapshot(day='2026-08-02', fresh=True, coverage_from='2026-07-01'):
        nonlocal serial
        serial+=1
        at=day+f' 12:{serial//60:02}:{serial%60:02}Z'
        if fresh:db.sql("update public.bank_transactions set last_seen_at="+quote(at)+" where presence_state='present'")
        auth("insert into public.bank_transaction_snapshots(owner_id,account_key,account_role,snapshot_at,coverage_from,coverage_to,transaction_count,transactions) values("+quote(OWNER)+",'item-tests','business',"+quote(at)+","+quote(coverage_from)+","+quote(day)+",0,'[]') on conflict(owner_id,account_key,account_role) do update set snapshot_at=excluded.snapshot_at,coverage_from=excluded.coverage_from,coverage_to=excluded.coverage_to")
    def reset(rows):
        nonlocal serial
        serial=0
        db.sql('delete from netunim_internal.check_bank_claims;delete from public.bank_transaction_snapshots;delete from public.bank_transactions;delete from public.shared_checks_documents')
        save(rows)

    # The old whole-deposit matcher accepts swapped individual amounts merely
    # because the set of numbers and the combined sum happen to match.
    reset([check('One',830,'111'),check('Two',1000,'222')])
    tx('swapped',1830,[item('111',1000),item('222',830)]);snapshot()
    assert all(c['status']=='בקופה' for c in checks()),'A matching total cannot override contradictory per-check amounts'

    reset([check('One',830,'111'),check('Two',1000,'222')])
    deposit=tx('late-swapped',1830,status='pending');snapshot()
    rows=checks()
    for c in rows:c['bankReview']=c['bankMatch']['eventId']
    save(rows)
    db.sql("update public.bank_transactions set status='completed',check_details="+quote(json.dumps(dict(checkItems=[item('111',1000),item('222',830)],checkNumbers=['111','222'],checkCount=2)))+" where id="+deposit)
    snapshot('2026-08-03')
    assert all(c['bankMatch']['warning']=='changed' and c['status']!='נפרע' for c in checks()),'Final details contradicting provisional amounts must suspend every affected check'
    assert db.sql('select bank_members is null from netunim_internal.check_bank_claims where transaction_id='+deposit).strip()=='t','Contradictory enrichment cannot become the immutable original bank identity'
    db.sql("update public.bank_transactions set check_details="+quote(json.dumps(dict(checkItems=[item('111',830),item('222',1000)],checkNumbers=['111','222'],checkCount=2)))+" where id="+deposit)
    snapshot('2026-08-04')
    assert all(c['bankMatch']['phase']=='deposited' and not c['bankMatch'].get('warning') for c in checks()),'Corrected final evidence can recover a provisional claim for review'

    reset([check('Known',830,'111')])
    deposit=tx('partial-known',1830,[item('111',830),item('222',1000)]);snapshot()
    assert checks()[0]['status']=='הופקד - במעקב','A proven member must match even when the other bank check is not registered'
    assert checks()[0]['bankMatch']['bankItem']['checkNumber']=='111'

    reset([check('Numbered',550,'00111'),check('Unnumbered',550)])
    tx('priority',550,[item('111',550)]);snapshot()
    assert checks()[0]['status']=='הופקד - במעקב' and checks()[1]['status']=='בקופה','Number identity takes precedence over amount-only alternatives'

    reset([check('Without number',550)])
    tx('fallback',550,[item('111',550)]);snapshot()
    assert checks()[0]['status']=='הופקד - במעקב'
    assert checks()[0]['bankMatch']['matchMethod']=='amount'

    reset([check('Same1',550),check('Same2',550)])
    tx('ambiguous',550,[item('111',550)]);snapshot()
    assert all(c['status']=='בקופה' and c['bankMatch']['phase']=='ambiguous' for c in checks())

    reset([check('One',550,'111'),check('Two',550,'222')])
    deposit=tx('equal-batch',1100,[item('111',550),item('222',550)]);snapshot()
    db.sql("update public.bank_transactions set amount=550,check_details="+quote(json.dumps(dict(checkItems=[item('222',550)],checkNumbers=['222'],checkCount=1)))+" where id="+deposit)
    snapshot('2026-08-03')
    assert checks()[0]['bankMatch']['warning']=='batch_missing' and checks()[1]['bankMatch']['phase']=='deposited','Item identity resolves equal-value batch losses'

    reset([check('Missing name',550,'111'),check('Survivor',550,'222')])
    deposit=tx('old-numbered-batch',1100,[item('111',550),item('222',550)],reference='old-batch-reference');snapshot()
    db.sql("update public.bank_transactions set presence_state='missing' where id="+deposit)
    replacement=tx('new-numbered-batch',550,[item('222',550)],reference='new-batch-reference');snapshot('2026-08-03')
    assert checks()[0]['bankMatch']['warning']=='batch_missing' and checks()[1]['bankMatch']['transactionId']==int(replacement),'Exact surviving items can prove a reduced replacement despite changed aggregate reference'
    assert checks()[0]['bankMatch']['remainder']['missingMembers'][0]['name']=='Missing name'

    reset([check('Returned equal',550,'111'),check('Surviving equal',550,'222')])
    tx('equal-deposit',1100,[item('111',550),item('222',550)]);snapshot()
    tx('identified-equal-return',-550,[item('111',550)],day='2026-08-03',description='החזרת שיק');snapshot('2026-08-03')
    assert checks()[0]['status']=='חזר' and checks()[1]['bankMatch']['phase']=='deposited' and not checks()[1]['bankMatch'].get('warning'),'A numbered return must not cast doubt on the other equal-amount member'

    reset([check('One',830,'111'),check('Two',1000,'222')])
    tx('original',1830,[item('111',830),item('222',1000)]);snapshot()
    tx('returned',-830,[item('111',830)],day='2026-08-03',description='החזרת שיק');snapshot('2026-08-03')
    assert checks()[0]['status']=='חזר' and checks()[1]['status']=='הופקד - במעקב'
    second=tx('redeposited',830,[item('111',830)],day='2026-08-04',description='הצ שיק חוזר-נט');snapshot('2026-08-04')
    assert checks()[0]['status']=='הופקד - במעקב' and checks()[0]['bankMatch']['transactionId']==int(second)
    rows=checks();rows[0]['bankReview']=rows[0]['bankMatch']['eventId'];save(rows)
    snapshot('2026-08-10')
    assert checks()[0]['status']=='נפרע','An old return must not be applied to the new deposit cycle'
    db.sql("update public.bank_transactions set presence_state='missing' where id="+second);snapshot('2026-08-11')
    assert checks()[0]['bankMatch']['phase']=='missing' and checks()[0]['status']!='נפרע'

    # A fully known amount-only group can be associated as a group, but equal
    # amounts cannot identify individual missing names without check numbers.
    reset([check('No number1',550),check('No number2',550)])
    deposit=tx('unnumbered-group',1100,[item('111',550),item('222',550)]);snapshot()
    assert all(c['status']=='הופקד - במעקב' for c in checks())
    db.sql("update public.bank_transactions set amount=550,check_details="+quote(json.dumps(dict(checkItems=[item('222',550)],checkNumbers=['222'],checkCount=1)))+" where id="+deposit)
    snapshot('2026-08-03')
    assert all(c['bankMatch']['warning']=='batch_ambiguous' for c in checks())
    assert all(not c['bankMatch'].get('bankItem') for c in checks()),'A reduced equal-value deposit cannot assign the surviving bank number to both unnamed original checks'
    rows=checks();rows[0]['checkNumber']='111';rows[1]['checkNumber']='222';save(rows)
    snapshot('2026-08-04')
    assert checks()[0]['bankMatch']['warning']=='batch_missing' and checks()[1]['bankMatch']['phase']=='deposited','Completing missing manual numbers resolves an originally ambiguous equal-value group'

    # A reserved bank item cannot be reused by a new record after its matched
    # check was deleted; a previously unregistered DIFFERENT item can be added.
    reset([check('Known',830,'111')])
    tx('later-addition',1830,[item('111',830),item('222',1000)]);snapshot()
    save(checks()+[check('Added later',1000,'222')]);snapshot('2026-08-03')
    assert all(c['status']=='הופקד - במעקב' for c in checks())
    save([checks()[1],check('Replacement record',830,'111')],deleted=['Known']);snapshot('2026-08-04')
    assert checks()[1]['status']=='בקופה','Deleting the original check does not release a bank item'

    reset([check('Enrichment',550)])
    deposit=tx('enriched',550,[item('111',550)]);snapshot()
    rows=checks();rows[0]['checkNumber']='00111';save(rows)
    assert not checks()[0].get('bankAutomationDisabled'), 'Filling a matching missing number preserves tracking'
    rows=checks();rows[0]['bankReview']=rows[0]['bankMatch']['eventId'];save(rows)
    db.sql("update public.bank_transactions set check_details='{}' where id="+deposit);snapshot('2026-08-10')
    assert checks()[0]['bankMatch']['warning']=='details_unavailable' and checks()[0]['status']!='נפרע'

    reset([check('Correct account',550,'111')])
    tx('deposit-account',550,[item('111',550)]);snapshot()
    tx('other-account-return',-550,[item('111',550,account='99999')],day='2026-08-03',description='החזרת שיק');snapshot('2026-08-03')
    assert checks()[0]['status']!='חזר','Same check serial at another drawer account is not a proven return'

    reset([check('Due',550),check('Future',200)])
    rows=checks();rows[1]['dueDate']='2026-08-15';save(rows);snapshot()
    assert checks()[0]['bankMatch']['phase']=='overdue' and 'bankMatch' not in checks()[1]
    rows=checks();rows[0]['bankReview']=rows[0]['bankMatch']['eventId'];save(rows)
    assert checks()[0]['bankReview']==checks()[0]['bankMatch']['eventId'],'Acknowledgement preserves the absence evidence'
    snapshot('2026-08-03')
    assert checks()[0]['bankReview']==checks()[0]['bankMatch']['eventId'],'Unchanged absence does not create another incident'
    rows=checks();rows[0]['status']='הופקד - במעקב';save(rows);snapshot('2026-08-03')
    assert checks()[0]['bankMatch']['phase']=='unverified' and not checks()[0].get('bankAutomationDisabled')
    tx('later-arrival',550,[item('111',550)],day='2026-08-03');snapshot('2026-08-03')
    assert checks()[0]['bankMatch']['phase']=='deposited'

    # Real fenced RPC: references can change on completion; a complete, unique
    # numbered claim supplies identity even if the pending bank row has no items.
    for pending_items in (False,True):
        reset([check('Pending1',830,'111'),check('Pending2',1000,'222')])
        lease=json.loads(auth("set local role authenticated;select to_jsonb(x) from public.claim_finance_sync_lease('bank','item-rpc',60) x"))
        source=dict(mergeKey='pending-group',date='2026-08-02T09:00:00Z',processedDate='2026-08-02T09:00:00Z',amount=1830,currency='ILS',description='הפק שיק-ע.ישיר',status='pending',bankReference='unrelated-pending-reference',bankSerial='0')
        details=dict(checkItems=[item('111',830),item('222',1000)],checkNumbers=['111','222'],checkCount=2)
        if pending_items:source['checkDetails']=details
        def rpc(complete,second,payload=None):
            return auth("set local role authenticated;select to_jsonb(x) from public.sync_bank_transactions_snapshot('item-tests','business',"+quote(json.dumps([source] if payload is None else payload))+"::jsonb,'2026-08-02T12:00:"+str(second).zfill(2)+"Z','2026-07-01','2026-08-02',"+str(complete).lower()+",'bank','item-rpc',"+str(lease['fence_epoch'])+") x")
        rpc(False,1);assert all(c['status']=='בקופה' and 'bankMatch' not in c for c in checks())
        rpc(True,2)
        oldid=checks()[0]['bankMatch']['transactionId']
        rows=checks()
        for c in rows:
            assert c['bankMatch']['provisional'];c['bankReview']=c['bankMatch']['eventId']
        save(rows)
        source.update(mergeKey='completed-group',status='completed',description='הפק.שיק בסלולר',bankReference='changed-aggregate-reference',bankSerial='42',checkDetails=details)
        rpc(True,3)
        assert db.sql("select count(*) from public.bank_transactions where account_key='item-tests'").strip()=='1','Pending and final rows must collapse without counting the deposit twice'
        assert all(c['bankMatch']['phase']=='deposited' and not c['bankMatch']['provisional'] and c['bankMatch']['eventId']!=c['bankReview'] for c in checks())
        assert all(c['bankMatch']['transactionId']==oldid for c in checks())
        rpc(False,4,[]);assert all(c['bankMatch']['phase']=='deposited' for c in checks()),'An incomplete empty response is not absence evidence'
        rpc(True,5,[]);assert all(c['bankMatch']['phase']=='missing' and c['status']!='נפרע' for c in checks()),'A vanished full deposit retains every original check identity'
        rpc(True,6);assert all(c['bankMatch']['phase']=='deposited' and c['bankMatch']['eventId']!=c.get('bankReview') for c in checks()),'Reappearance needs a new acknowledgement'
    print('PASS structured check identity: per-item amounts, partial known batches, number priority, fallback, equal-value loss and redeposit cycles')
