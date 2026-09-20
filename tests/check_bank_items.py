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
    def snapshot(day='2026-08-02', fresh=True, coverage_from='2026-07-01', role='business'):
        nonlocal serial
        serial+=1
        at=day+f' 12:{serial//60:02}:{serial%60:02}Z'
        if fresh:db.sql("update public.bank_transactions set last_seen_at="+quote(at)+" where presence_state='present'")
        auth("insert into public.bank_transaction_snapshots(owner_id,account_key,account_role,snapshot_at,coverage_from,coverage_to,transaction_count,transactions) values("+quote(OWNER)+",'item-tests',"+quote(role)+","+quote(at)+","+quote(coverage_from)+","+quote(day)+",0,'[]') on conflict(owner_id,account_key,account_role) do update set snapshot_at=excluded.snapshot_at,coverage_from=excluded.coverage_from,coverage_to=excluded.coverage_to")
    def reset(rows):
        nonlocal serial
        serial=0
        db.sql('delete from netunim_internal.check_bank_claims;delete from public.bank_transaction_snapshots;delete from public.bank_transactions;delete from public.shared_checks_documents')
        save(rows)
    def claim_bank_lease(token):
        lease=json.loads(auth("set local role authenticated;select to_jsonb(x) from public.claim_finance_sync_lease('bank',"+quote(token)+",60) x"))
        assert lease['acquired'] and lease['lease_token']==token, 'Bank RPC regression must own the finance lease before publishing'
        return lease
    def release_bank_lease(token):
        assert auth("set local role authenticated;select public.release_finance_sync_lease('bank',"+quote(token)+")")=="t", 'Bank RPC regression must release its finance lease'

    # A proven numbered match needs no manual review. Pending age still cannot
    # shorten settlement, and every change remains in server-owned history.
    reset([check('Certain',550,'00111')])
    deposit=tx('certain',550,[item('111',550)],status='pending');snapshot()
    assert checks()[0]['bankMatch'].get('autoConfirmed') is True,'Number AND individual amount should auto-confirm a unique match'
    assert len(checks()[0]['bankHistory'])==1
    snapshot('2026-08-10');assert checks()[0]['status']!='נפרע' and len(checks()[0]['bankHistory'])==1
    db.sql("update public.bank_transactions set status='completed' where id="+deposit);snapshot('2026-08-10')
    assert checks()[0]['status']!='נפרע' and len(checks()[0]['bankHistory'])==2
    snapshot('2026-08-13');assert checks()[0]['status']!='נפרע','Wait through all three additional banking days'
    snapshot('2026-08-14');assert checks()[0]['status']=='נפרע' and not checks()[0].get('bankReview')
    assert [h['phase'] for h in checks()[0]['bankHistory']]==['deposited','deposited','cleared']
    rows=checks();history=rows[0].pop('bankHistory');rows[0]['bankMatch']['autoConfirmed']=False;save(rows)
    assert checks()[0]['bankHistory']==history and checks()[0]['bankMatch']['autoConfirmed'],'Older clients cannot erase history or override server confirmation'
    rows=checks();rows[0]['bankHistory']=[{'eventId':'forged'}];save(rows);assert checks()[0]['bankHistory']==history
    db.sql("update public.bank_transactions set presence_state='missing' where id="+deposit);snapshot('2026-08-15')
    assert checks()[0]['bankMatch']['phase']=='missing' and not checks()[0]['bankMatch'].get('autoConfirmed')
    assert checks()[0]['bankHistory'][-1]['phase']=='missing'

    reset([check('Fallback still reviewed',550)])
    tx('fallback-review',550,[item('111',550)]);snapshot();snapshot('2026-08-10')
    assert not checks()[0]['bankMatch']['autoConfirmed'] and checks()[0]['status']=='הופקד - במעקב','Amount-only association cannot auto-confirm itself'
    rows=checks();rows[0]['bankReview']=rows[0]['bankMatch']['eventId'];save(rows);snapshot('2026-08-11')
    assert checks()[0]['status']=='נפרע','An explicitly reviewed fallback can still mature normally'

    reset([check('Existing reviewed fallback',550)])
    tx('legacy-reviewed',550,[item('111',550)]);snapshot()
    rows=checks();rows[0]['bankReview']=rows[0]['bankMatch']['eventId'];save(rows)
    db.sql("begin;set local app.check_bank_reconcile='1';update public.shared_checks_documents set state=state#-'{checks,0,bankMatch,autoConfirmed}';commit")
    snapshot('2026-08-03')
    assert checks()[0]['bankReview']==checks()[0]['bankMatch']['eventId'],'Installing certainty metadata must not reset an unchanged manual approval'
    snapshot('2026-08-10');assert checks()[0]['status']=='נפרע'

    reset([check('Reference only',550,'111')])
    tx('reference-not-number',550,reference='111',status='pending',description='הפק שיק-ע.ישיר');snapshot()
    assert not checks()[0]['bankMatch']['autoConfirmed'] and not checks()[0]['bankMatch'].get('provisionalReference'),'A numeric direct-deposit reference without the verified cheque/deposit shape is not a bank-supplied cheque number'

    reset([check('Group A',830,'111'),check('Group B',1000,'222')])
    tx('certain-group',1830,[item('111',830),item('222',1000)]);snapshot();snapshot('2026-08-10')
    assert all(c['bankMatch']['autoConfirmed'] and c['status']=='נפרע' and not c.get('bankReview') for c in checks())
    tx('certain-group-return',-830,[item('111',830)],day='2026-08-11',description='החזרת שיק');snapshot('2026-08-11')
    assert checks()[0]['bankMatch']['phase']=='returned' and not checks()[0]['bankMatch']['autoConfirmed']
    assert checks()[0]['bankHistory'][-1]['phase']=='returned'

    reset([check('Contested after initial match',550,'111')])
    tx('one-numbered-deposit',550,[item('111',550)]);snapshot()
    assert checks()[0]['bankMatch']['autoConfirmed']
    rows=checks();rows[0]['bankReview']=rows[0]['bankMatch']['eventId'];save(rows)
    tx('another-numbered-deposit',550,[item('111',550)]);snapshot('2026-08-10')
    assert not checks()[0]['bankMatch']['autoConfirmed'] and checks()[0]['status']!='נפרע','New competing bank evidence revokes certainty'
    assert checks()[0]['bankMatch']['warning']=='number_ambiguous','Prior approval cannot bypass a new identity conflict'

    reset([check('Contested after clearing',550,'111')])
    tx('cleared-numbered-deposit',550,[item('111',550)]);snapshot();snapshot('2026-08-10')
    assert checks()[0]['status']=='נפרע'
    duplicate=tx('late-competing-deposit',550,[item('111',550)]);snapshot('2026-08-11')
    assert checks()[0]['status']=='הופקד - במעקב' and checks()[0]['bankMatch']['warning']=='number_ambiguous'
    snapshot('2026-08-12');assert checks()[0]['status']!='נפרע','Repeated uncertain evidence remains blocked'
    db.sql('update public.bank_transactions set presence_state=\'missing\' where id='+duplicate);snapshot('2026-08-13')
    assert checks()[0]['status']!='נפרע' and 'warning' not in checks()[0]['bankMatch']
    snapshot('2026-08-14');assert checks()[0]['status']=='נפרע','Resolved conflict permits clearance after another fresh verification'

    # Manual deposit is an entry point into the same server-owned monitoring
    # lifecycle, including pending/final confirmation, settlement and disappearance.
    for role,account in [('business','עסקי'),('home','ביתי')]:
        reset([check('Manual first',550,'111')])
        rows=checks();rows[0].update(status='הופקד - במעקב',depositDate='2026-08-02',account=account);save(rows)
        deposit=tx('manual-first-'+role,550,[item('111',550)],status='pending')
        # The shared trigger is account-role scoped; exercise both roles directly.
        if role=='home':
            db.sql("update public.bank_transactions set account_role='home' where id="+deposit)
        snapshot(role=role);assert checks()[0]['bankMatch']['phase']=='deposited'
        rows=checks();rows[0]['bankReview']=rows[0]['bankMatch']['eventId'];save(rows)
        db.sql("update public.bank_transactions set status='completed' where id="+deposit);snapshot('2026-08-03',role=role)
        assert checks()[0]['bankMatch']['eventId']!=checks()[0]['bankReview']
        rows=checks();rows[0]['bankReview']=rows[0]['bankMatch']['eventId'];save(rows);snapshot('2026-08-10',role=role)
        assert checks()[0]['status']=='נפרע','A manually deposited check can mature automatically after a verified bank association'
        db.sql("update public.bank_transactions set presence_state='missing' where id="+deposit);snapshot('2026-08-11',role=role)
        assert checks()[0]['bankMatch']['phase']=='missing' and checks()[0]['status']!='נפרע'

    reset([check('Manual after ambiguity',550)])
    first=tx('ambiguous-before-manual',550);second=tx('ambiguous-other',550);snapshot()
    assert checks()[0]['bankMatch']['phase']=='ambiguous'
    rows=checks();rows[0].update(status='הופקד - במעקב',depositDate='2026-08-02');save(rows)
    assert not checks()[0].get('bankAutomationDisabled'),'An unclaimed ambiguous proposal must not make a manual deposit disable automatic tracking'
    db.sql("update public.bank_transactions set presence_state='missing' where id="+second)
    snapshot('2026-08-03');assert checks()[0]['bankMatch']['phase']=='deposited' and checks()[0]['bankMatch']['transactionId']==int(first)

    # A number edit must discard an old absence advisory, never restore a stale
    # acknowledgement through an OR-precedence error in metadata protection.
    reset([check('Advisory edit',550,'111')]);snapshot()
    rows=checks();rows[0]['bankReview']=rows[0]['bankMatch']['eventId'];rows[0]['checkNumber']='222';save(rows)
    assert 'bankMatch' not in checks()[0] and not checks()[0].get('bankAutomationDisabled')
    tx('corrected-number',550,[item('222',550)]);snapshot('2026-08-03')
    assert checks()[0]['bankMatch']['phase']=='deposited'

    # Explicit opt-out always wins. Resuming without a real claim starts a
    # search, while resuming a real claim requires a new review event.
    reset([check('Disabled',550,'111')]);snapshot()
    rows=checks();rows[0].update(status='הופקד - במעקב',bankAutomationDisabled=True);save(rows)
    tx('optout-bank',550,[item('111',550)]);snapshot('2026-08-03')
    assert checks()[0].get('bankMatch',{}).get('phase')!='deposited'
    rows=checks();rows[0]['bankAutomationDisabled']=False;save(rows)
    assert 'bankMatch' not in checks()[0],'Resume cannot create an unbacked bank association'
    snapshot('2026-08-04');assert checks()[0]['bankMatch']['phase']=='deposited'
    event=checks()[0]['bankMatch']['eventId']
    rows=checks();rows[0]['amount']=600;save(rows)
    assert checks()[0]['bankAutomationDisabled'] and checks()[0]['bankMatch']['phase']=='manual'
    rows=checks();rows[0]['amount']=550;save(rows)
    rows=checks();rows[0]['bankAutomationDisabled']=False;save(rows)
    assert checks()[0]['bankMatch']['phase']=='deposited' and checks()[0]['bankMatch']['eventId']!=event
    snapshot('2026-08-10');assert checks()[0]['status']=='נפרע' and checks()[0]['bankMatch']['autoConfirmed'],'Explicit resume can use newly verified numbered evidence without a manual approval'

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

    # Live Hapoalim contract, 2026-09-20: three checks deposited together first appear as
    # separate TODAY/pending rows. In this exact direct-deposit presentation the temporary
    # bank reference is the printed cheque number, while checkItems/checkNumbers are still empty.
    # Two rows can already carry the future value/event date, so coverage-date filtering must not
    # hide them. This identity is informational only until the completed multi-cheque row arrives.
    # Keep the regression clock safely historical. The production trigger deliberately
    # rejects snapshots more than five minutes in the future; using the live incident date
    # here made CI depend on wall-clock time on 2026-09-20. These synthetic dates preserve
    # the exact +2-day pending/value-date relationship without weakening that safety guard.
    pending_seen_day='2026-08-18'
    pending_value_day='2026-08-20'
    pending_reference_checks=[
        check('Pending reference 830',830,'4463455'),
        check('Pending reference 850',850,'1370002'),
        check('Pending reference 1000',1000,'80000072'),
    ]
    for row in pending_reference_checks:row['dueDate']=pending_seen_day
    reset(pending_reference_checks)
    lease=claim_bank_lease('pending-reference-rpc')
    empty_deposit_details=dict(kind='deposit',checkNumbers=[],checkCount=None,checkItems=[],hasDocumentReference=False,warning='')
    pending_reference_rows=[
        dict(mergeKey='pending-reference-4463455',date=pending_seen_day+'T09:00:00Z',processedDate=pending_value_day+'T09:00:00Z',amount=830,currency='ILS',description='הפק שיק-ע.ישיר',status='pending',balanceAfter=81694.41,activityTypeCode=1,bankReference='4463455',bankSerial='0',cheque=True,checkDetails=empty_deposit_details),
        dict(mergeKey='pending-reference-1370002',date=pending_value_day+'T09:00:00Z',processedDate=pending_value_day+'T09:00:00Z',amount=850,currency='ILS',description='הפק שיק-ע.ישיר',status='pending',balanceAfter=83544.41,activityTypeCode=1,bankReference='1370002',bankSerial='0',cheque=True,checkDetails=empty_deposit_details),
        dict(mergeKey='pending-reference-80000072',date=pending_value_day+'T09:00:00Z',processedDate=pending_value_day+'T09:00:00Z',amount=1000,currency='ILS',description='הפק שיק-ע.ישיר',status='pending',balanceAfter=82694.41,activityTypeCode=1,bankReference='80000072',bankSerial='0',cheque=True,checkDetails=empty_deposit_details),
    ]
    def pending_reference_rpc(payload,at,coverage_to):
        return auth("set local role authenticated;select to_jsonb(x) from public.sync_bank_transactions_snapshot('item-tests','business',"+quote(json.dumps(payload))+"::jsonb,"+quote(at)+","+quote('2026-07-20')+","+quote(coverage_to)+",true,'bank','pending-reference-rpc',"+str(lease['fence_epoch'])+") x")
    pending_reference_rpc(pending_reference_rows,pending_seen_day+'T10:30:00Z',pending_seen_day)
    rows=checks();assert len(rows)==3
    for c in rows:
        m=c['bankMatch']
        assert c['status']=='הופקד - במעקב' and c['depositDate']==pending_seen_day
        assert m['phase']=='deposited' and m['provisional'] and m['provisionalReference'] and not m.get('autoConfirmed') and not m.get('warning')
        assert m['matchMethod']=='number' and m['bankItem']['checkNumber']==c['checkNumber'] and float(m['bankItem']['amount'])==float(c['amount'])
        assert m['bankReference']==c['checkNumber'],'The strict pending direct-deposit reference is recorded as provisional cheque identity'
    assert db.sql("select count(*) from netunim_internal.check_bank_claims where owner_id="+quote(OWNER)+" and account_key='item-tests' and account_role='business'").strip()=='0','Pending reference identity must not create a durable claim before completed cheque details exist'

    # Heal the exact production state that existed before this migration: one of these rows may
    # already have been accepted as an amount/date fallback and therefore own a legacy claim.
    rows=checks();legacy=next(c for c in rows if c['checkNumber']=='4463455');legacy_tx=legacy['bankMatch']['transactionId']
    legacy_match={k:v for k,v in legacy['bankMatch'].items() if k not in ('provisionalReference','bankReference','bankItem','autoConfirmed')}
    legacy_match['matchMethod']='amount';legacy['bankMatch']=legacy_match
    db.sql("begin;set local app.check_bank_reconcile='1';update public.shared_checks_documents set state="+quote(json.dumps({'checks':rows}))+"::jsonb where owner_id="+quote(OWNER)+" and document_name='main';commit")
    db.sql("insert into netunim_internal.check_bank_claims(owner_id,document_name,transaction_id,account_key,account_role,check_ids,members,source_transaction) select owner_id,'main',id,account_key,account_role,"+quote(json.dumps([legacy['id']]))+"::jsonb,"+quote(json.dumps([dict(id=legacy['id'],name=legacy['name'],amount=legacy['amount'],dueDate=legacy['dueDate'],account=legacy['account'],status='בקופה',checkNumber=legacy['checkNumber'])]))+"::jsonb,to_jsonb(b) from public.bank_transactions b where b.id="+str(legacy_tx))
    pending_reference_rpc(pending_reference_rows,pending_seen_day+'T10:31:00Z',pending_seen_day)
    healed=next(c for c in checks() if c['checkNumber']=='4463455')
    assert healed['bankMatch']['provisionalReference'] and healed['bankMatch']['matchMethod']=='number' and not healed['bankMatch'].get('warning'),'A legacy amount/date claim is upgraded to the strict provisional number evidence'
    assert db.sql("select count(*) from netunim_internal.check_bank_claims where owner_id="+quote(OWNER)+" and transaction_id="+str(legacy_tx)).strip()=='0','The stale single-member fallback claim must be removed so the final grouped deposit can own identity'

    final_items=[item('4463455',830,'13807'),item('1370002',850,'13807'),item('80000072',1000,'13807')]
    for i in final_items:i.update(bankNumber='17',branchNumber='725')
    final_group=dict(mergeKey='final-machine-2680',date=pending_value_day+'T09:00:00Z',processedDate=pending_value_day+'T09:00:00Z',amount=2680,currency='ILS',description='הפק.שיק במכונה',status='completed',balanceAfter=83544.41,activityTypeCode=1,bankReference='-1',bankSerial='1',cheque=True,checkDetails=dict(kind='deposit',checkItems=final_items,checkNumbers=['4463455','1370002','80000072'],checkCount=3,hasDocumentReference=True,warning=''))
    pending_reference_rpc([final_group],pending_value_day+'T10:00:00Z',pending_value_day)
    rows=checks();transaction_ids={c['bankMatch']['transactionId'] for c in rows}
    assert len(transaction_ids)==1,'The completed grouped deposit becomes the one durable transaction identity for all three checks'
    for c in rows:
        m=c['bankMatch']
        assert c['status']=='הופקד - במעקב' and c['depositDate']==pending_seen_day,'Final value-date evidence must not rewrite the actual pending deposit day'
        assert m['phase']=='deposited' and not m['provisional'] and not m.get('provisionalReference') and m['autoConfirmed'] and not m.get('warning')
        assert m['matchMethod']=='number' and m['bankItem']['checkNumber']==c['checkNumber']
    claim_where="owner_id="+quote(OWNER)+" and account_key='item-tests' and account_role='business'"
    claim_row=json.loads(db.sql("select json_build_object('count',(select count(*) from netunim_internal.check_bank_claims where "+claim_where+"),'ids',coalesce((select check_ids from netunim_internal.check_bank_claims where "+claim_where+" limit 1),'[]'::jsonb))"))
    assert claim_row['count']==1 and set(claim_row['ids'])=={c['id'] for c in rows},'Only completed structured evidence creates the grouped durable claim'
    release_bank_lease('pending-reference-rpc')

    # Archive-only cheque transition: Hapoalim can replace a pending direct-deposit row
    # with a completed machine-deposit row, changing date/reference/serial/description while
    # retaining the exact amount, post-transaction balance and credit direction. No shared-check
    # claim exists here, so reconciliation must not depend on UI/check-workflow evidence.
    reset([])
    lease=claim_bank_lease('archive-transition-rpc')
    pending=dict(mergeKey='pending-direct-1710',date='2026-09-19T09:00:00Z',processedDate='2026-09-22T09:00:00Z',amount=1710,currency='ILS',description='הפק שיק-ע.ישיר',status='pending',balanceAfter=20611.29,activityTypeCode=1,bankReference='pending-placeholder',bankSerial='0')
    completed_items=[dict(checkNumber=n,amount=570,bankNumber='17',branchNumber='725',accountNumber='13807') for n in ('80020179','80020012','80020099')]
    completed=dict(mergeKey='serial:2026-09-18:1:1710',date='2026-09-18T09:00:00Z',processedDate='2026-09-18T09:00:00Z',amount=1710,currency='ILS',description='הפק.שיק במכונה',status='completed',balanceAfter=20611.29,activityTypeCode=1,bankReference='-1',bankSerial='1',checkDetails=dict(kind='deposit',checkItems=completed_items,checkNumbers=['80020179','80020012','80020099'],checkCount=3))
    def archive_rpc(payload,second,complete=True):
        return auth("set local role authenticated;select to_jsonb(x) from public.sync_bank_transactions_snapshot('item-tests','home',"+quote(json.dumps(payload))+"::jsonb,'2026-09-19T12:00:"+str(second).zfill(2)+"Z','2026-08-21','2026-09-19',"+str(complete).lower()+",'bank','archive-transition-rpc',"+str(lease['fence_epoch'])+") x")
    archive_rpc([pending],1)
    pending_id=db.sql("select id from public.bank_transactions where account_key='item-tests' and account_role='home'").strip()
    archive_rpc([completed],2)
    rows=json.loads(db.sql("select coalesce(json_agg(json_build_object('id',id,'mergeKey',merge_key,'status',status,'presence',presence_state,'description',description,'amount',amount,'balance',balance_after,'activity',activity_type_code) order by id),'[]'::json) from public.bank_transactions where account_key='item-tests' and account_role='home'"))
    assert len(rows)==1 and str(rows[0]['id'])==pending_id,'Pending direct deposit and completed machine deposit must collapse into one archived movement'
    assert rows[0]['mergeKey']==completed['mergeKey'] and rows[0]['status']=='completed' and rows[0]['presence']=='present' and rows[0]['description']==completed['description'],'The surviving row must become the exact completed bank representation instead of producing a missing warning'
    release_bank_lease('archive-transition-rpc')

    # Upgrade healing: Production may already contain the old false-positive pair (the
    # stale pending placeholder plus the completed machine-deposit row). Re-reading the completed
    # bank row after this migration must remove only the uniquely matched stale placeholder.
    reset([])
    lease=claim_bank_lease('archive-heal-rpc')
    def heal_rpc(payload,second):
        return auth("set local role authenticated;select to_jsonb(x) from public.sync_bank_transactions_snapshot('item-tests','home',"+quote(json.dumps(payload))+"::jsonb,'2026-09-19T12:30:"+str(second).zfill(2)+"Z','2026-08-21','2026-09-19',true,'bank','archive-heal-rpc',"+str(lease['fence_epoch'])+") x")
    heal_rpc([pending],1)
    pending_id=db.sql("select id from public.bank_transactions where account_key='item-tests' and account_role='home'").strip()
    db.sql("insert into public.bank_transactions(owner_id,account_key,account_role,merge_key,transaction_date,processed_date,amount,currency,description,status,presence_state,balance_after,bank_reference,bank_serial,activity_type_code,cheque,check_details) values("+quote(OWNER)+",'item-tests','home',"+quote(completed['mergeKey'])+","+quote(completed['date'])+","+quote(completed['processedDate'])+",1710,'ILS',"+quote(completed['description'])+",'completed','present',20611.29,'-1','1',1,true,"+quote(json.dumps(completed['checkDetails']))+")")
    assert db.sql("select count(*) from public.bank_transactions where account_key='item-tests' and account_role='home'").strip()=='2'
    heal_rpc([completed],2)
    assert db.sql("select count(*) from public.bank_transactions where account_key='item-tests' and account_role='home'").strip()=='1','The migration must heal an already-created pending/completed duplicate on the next complete bank sync'
    assert db.sql("select count(*) from public.bank_transactions where id="+pending_id).strip()=='0','Only the uniquely matched stale pending placeholder is removed during healing'
    release_bank_lease('archive-heal-rpc')

    # Safety guard: the semantic label rule is not a fuzzy matcher. If two pending cheque
    # deposits carry the same strong facts, ambiguity must remain unresolved rather than guessing.
    reset([])
    lease=claim_bank_lease('archive-ambiguous-rpc')
    a=dict(pending,mergeKey='pending-ambiguous-a',bankReference='pending-a')
    b=dict(pending,mergeKey='pending-ambiguous-b',bankReference='pending-b')
    def ambiguous_rpc(payload,second):
        return auth("set local role authenticated;select to_jsonb(x) from public.sync_bank_transactions_snapshot('item-tests','home',"+quote(json.dumps(payload))+"::jsonb,'2026-09-19T13:00:"+str(second).zfill(2)+"Z','2026-08-21','2026-09-19',true,'bank','archive-ambiguous-rpc',"+str(lease['fence_epoch'])+") x")
    ambiguous_rpc([a,b],1)
    ambiguous_rpc([completed],2)
    assert db.sql("select count(*) from public.bank_transactions where account_key='item-tests' and account_role='home'").strip()=='3','Ambiguous same-fact cheque deposits must stay separate; reconciliation must never guess'
    assert db.sql("select count(*) from public.bank_transactions where account_key='item-tests' and account_role='home' and status='pending' and presence_state='missing'").strip()=='2','Ambiguous stale pending rows remain visible as review evidence rather than being silently collapsed'
    release_bank_lease('archive-ambiguous-rpc')

    # Real fenced RPC: references can change on completion; a complete, unique
    # numbered claim supplies identity even if the pending bank row has no items.
    for pending_items in (False,True):
        reset([check('Pending1',830,'111'),check('Pending2',1000,'222')])
        lease=claim_bank_lease('item-rpc')
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
        rows=checks()
        for c in rows:c['bankHistoryDismiss']=[h['eventId'] for h in c['bankHistory']]
        save(rows)
        assert all(c['bankHistory']==[] and c['status']=='הופקד - במעקב' and not c.get('bankAutomationDisabled') for c in checks())
        rpc(False,4,[]);assert all(c['bankMatch']['phase']=='deposited' for c in checks()),'An incomplete empty response is not absence evidence'
        rpc(True,5,[]);assert all(c['bankMatch']['phase']=='missing' and c['status']!='נפרע' for c in checks()),'A vanished full deposit retains every original check identity'
        assert all(c['bankHistory'][-1]['phase']=='missing' and c['bankMatch']['eventId']!=c.get('bankReview') and c['bankMatch']['eventId']!=c.get('bankHistoryHiddenEvent') for c in checks()),'Removing deposit notices must not hide a fresh disappearance alert before settlement'
        rpc(True,6);assert all(c['bankMatch']['phase']=='deposited' and c['bankMatch']['eventId']!=c.get('bankReview') for c in checks()),'Reappearance needs a new acknowledgement'
        release_bank_lease('item-rpc')
    # The normal disappearance window is BEFORE clearing. A dismissed deposit
    # notice must leave both a single check and its future clearing guard intact.
    for adverse in ('missing','returned'):
        reset([check('Removed notice before settlement',550,'111')])
        deposit=tx('unsettled-after-removal',550,[item('111',550)]);snapshot()
        rows=checks();initial=rows[0]['bankMatch'];rows[0]['bankHistoryDismiss']=[initial['eventId']];save(rows)
        assert checks()[0]['bankHistory']==[] and checks()[0]['status']=='הופקד - במעקב'
        if adverse=='missing':db.sql("update public.bank_transactions set presence_state='missing' where id="+deposit)
        else:tx('return-before-settlement-after-removal',-550,[item('111',550)],day='2026-08-03',description='החזרת שיק')
        snapshot('2026-08-03');incident=checks()[0]
        assert incident['bankMatch']['phase']==adverse and incident['bankHistory'][-1]['phase']==adverse
        assert incident.get('bankReview')!=incident['bankMatch']['eventId'] and incident['bankHistoryHiddenEvent']!=incident['bankMatch']['eventId']
        snapshot('2026-08-10')
        assert checks()[0]['status']!='נפרע' and checks()[0]['bankMatch']['phase']==adverse,'Elapsed clearing time must not clear a missing or returned deposit'
    for adverse in ('missing','returned'):
        reset([check('Removed notification, live tracking',550,'111')])
        deposit=tx('tracked-after-removal',550,[item('111',550)]);snapshot()
        rows=checks();initial=rows[0]['bankMatch'];rows[0]['bankHistoryDismiss']=[initial['eventId']];save(rows)
        assert checks()[0]['bankHistory']==[] and checks()[0]['bankMatch']==initial
        assert not checks()[0].get('bankAutomationDisabled')
        snapshot('2026-08-03');assert checks()[0]['bankHistory']==[],'Unchanged bank evidence must not resurrect a removed notification'
        snapshot('2026-08-10');settled=checks()[0]
        assert settled['status']=='נפרע' and settled['bankHistory'][-1]['phase']=='cleared','Notification deletion must not prevent automatic settlement'
        rows=checks();rows[0]['bankHistoryDismiss']=[settled['bankMatch']['eventId']];save(rows)
        if adverse=='missing':db.sql("update public.bank_transactions set presence_state='missing' where id="+deposit)
        else:tx('return-after-cleared-notice-removed',-550,[item('111',550)],day='2026-08-11',description='החזרת שיק')
        snapshot('2026-08-11');incident=checks()[0]
        assert incident['bankMatch']['phase']==adverse and incident['status']!='נפרע'
        assert incident['bankHistory'][-1]['phase']==adverse and incident['bankHistoryHiddenEvent']!=incident['bankMatch']['eventId']
        assert incident.get('bankReview')!=incident['bankMatch']['eventId'],'New return/disappearance still requires user review'
    print('PASS structured check identity: per-item amounts, partial known batches, number priority, fallback, equal-value loss, redeposit cycles and full monitoring after notification deletion')
