"""Reconciliation regressions against the complete disposable migration chain."""
import json
from isolated_sync_postgres import OWNER, quote


def run(db):
    snapshot_number=0
    def auth(sql):
        return db.sql("begin;set local request.jwt.claim.sub="+quote(OWNER)+";"+sql+";commit;").strip()

    def checks():
        return json.loads(db.sql("select state->'checks' from public.shared_checks_documents where owner_id="+quote(OWNER)+" and document_name='main'"))

    def save(rows):
        revision=db.sql("select revision from public.shared_checks_documents where owner_id="+quote(OWNER)+" and document_name='main'").strip() or '0'
        return auth("set local role authenticated;select revision from public.save_shared_checks_document('main',"+revision+","+quote(json.dumps({'checks':rows}))+"::jsonb)")

    def tx(key,amount,description='הפק.שיק בסלולר',role='business',day='2026-08-02',status='completed',numbers=None):
        details=json.dumps({'checkNumbers':numbers}) if numbers else '{}'
        return db.sql("insert into public.bank_transactions(owner_id,account_key,account_role,merge_key,amount,description,transaction_date,processed_date,status,presence_state,last_seen_at,check_details) values("+quote(OWNER)+",'check-test',"+quote(role)+","+quote(key)+","+str(amount)+","+quote(description)+","+quote(day)+","+quote(day)+","+quote(status)+",'present','2026-08-02 12:00Z',"+quote(details)+") returning id").strip()

    def snapshot(day='2026-08-02',role='business',present=True):
        nonlocal snapshot_number
        snapshot_number+=1
        at=day+f' 12:00:{snapshot_number:02}Z'
        if present:
            db.sql("update public.bank_transactions set last_seen_at="+quote(at)+" where account_key='check-test' and presence_state='present'")
        auth("insert into public.bank_transaction_snapshots(owner_id,account_key,account_role,snapshot_at,coverage_from,coverage_to,transaction_count,transactions) values("+quote(OWNER)+",'check-test',"+quote(role)+","+quote(at)+",'2026-07-01',"+quote(day)+",0,'[]') on conflict(owner_id,account_key,account_role) do update set snapshot_at=excluded.snapshot_at,coverage_to=excluded.coverage_to")

    def check(id,amount,**kw):
        return {'id':id,'name':id,'amount':amount,'account':'עסקי','status':'בקופה','dueDate':'2026-08-01','checkNumber':id,**kw}

    def reset(rows):
        nonlocal snapshot_number
        snapshot_number=0
        db.sql("delete from netunim_internal.check_bank_claims;delete from public.bank_transaction_snapshots;delete from public.bank_transactions;delete from public.shared_checks_documents;")
        save(rows)

    save([check('a',300),check('b',700),check('home',1000,account='ביתי'),check('future',1000,dueDate='2026-08-20')])
    deposit=tx('group',1000)
    snapshot()
    rows=checks();assert [c['status'] for c in rows]==['הופקד - במעקב','הופקד - במעקב','בקופה','בקופה'],rows
    assert rows[0]['bankMatch']['checkIds']==['a','b']
    snapshot(role='home')
    assert checks()[0]['bankMatch']['phase']=='deposited','Same account key in another role cannot revoke a linked check'
    snapshot('2026-08-10');assert checks()[0]['status']=='הופקד - במעקב','No clearance before user confirms'
    rows=checks()
    for c in rows[:2]:c['bankReview']=c['bankMatch']['eventId']
    save(rows)
    snapshot('2026-08-10',present=False)
    assert checks()[0]['status']=='הופקד - במעקב','A new clock reading without fresh presence must not clear'
    snapshot('2026-08-10')
    assert checks()[0]['status']=='נפרע'
    before=checks();snapshot('2026-08-10');assert checks()==before,'Repeated snapshot is idempotent'
    db.sql("update public.bank_transactions set presence_state='missing',missing_since='2026-08-11' where id="+deposit)
    snapshot('2026-08-11')
    assert checks()[0]['status']=='הופקד - במעקב' and checks()[0]['bankMatch']['phase']=='missing'
    tx('return',-300,'החזרת שיק',day='2026-08-11',numbers=['a'])
    snapshot('2026-08-11')
    assert checks()[0]['status']=='חזר' and checks()[1]['status']!='חזר','A partial batch return must identify its cheque'
    assert not checks()[0]['bankMatch'].get('warning'),'Exact identification replaces an earlier uncertain warning'
    rows=checks();rows[1]['status']='בקופה';save(rows)
    assert checks()[1]['bankAutomationDisabled'] is True
    snapshot('2026-08-12');assert checks()[1]['status']=='בקופה','Manual correction wins'
    # Add ambiguous equal-amount and sum-vs-single candidates; do not pick one by sort order.
    rows=checks()+[check('c',400),check('d',600),check('e',1000)]
    save(rows);tx('ambiguous',1000,day='2026-08-12');snapshot('2026-08-12')
    assert all(c['status']=='בקופה' for c in checks() if c['id'] in ['c','d','e'])
    assert next(c for c in checks() if c['id']=='e')['bankMatch']['phase']=='ambiguous'
    # Source metadata cannot be manufactured by a client.
    rows=checks();rows[-1]['bankMatch']={'phase':'cleared','eventId':'forged'};save(rows)
    assert checks()[-1]['bankMatch']['eventId']!='forged'
    assert db.sql("select netunim_internal.check_bank_clear_after('2026-09-09')").strip()=='2026-09-16'
    assert db.sql("select netunim_internal.check_bank_clear_after('2028-01-01') is null").strip()=='t'
    assert db.sql("select netunim_internal.check_bank_kind('return cheque')").strip()=='return'
    # Pending age is not evidence of completed settlement age.
    reset([check('pending',345)])
    pending=tx('pending',345,status='pending');snapshot()
    rows=checks();rows[0]['bankReview']=rows[0]['bankMatch']['eventId'];save(rows)
    snapshot('2026-08-10');assert checks()[0]['status']=='הופקד - במעקב'
    db.sql("update public.bank_transactions set status='completed' where id="+pending)
    snapshot('2026-08-10');assert checks()[0]['status']=='הופקד - במעקב'
    snapshot('2026-08-16');assert checks()[0]['status']=='נפרע'

    # Two bank credits competing for one check cannot both independently claim it.
    reset([check('overlap',222)])
    tx('one',222);tx('two',222);snapshot()
    assert checks()[0]['status']=='בקופה' and checks()[0]['bankMatch']['phase']=='ambiguous'

    reset([check('small',100),check('large',300)])
    tx('small',100);tx('large',300);snapshot()
    assert all(c['status']=='הופקד - במעקב' for c in checks()),'Impossible subset members cannot manufacture cross-transaction ambiguity'

    # Currency, sign, date validation and authoritative description are mandatory.
    reset([check('invalid-date',222,dueDate='2026-02-31'),check('real',222)])
    wrong=tx('wrong-kind',222,'העברה');snapshot();assert checks()[1]['status']=='בקופה'
    db.sql("update public.bank_transactions set description='הפקדת שיק',currency='USD' where id="+wrong)
    snapshot();assert checks()[1]['status']=='בקופה'
    db.sql("update public.bank_transactions set currency='ILS',amount=-222 where id="+wrong)
    snapshot();assert checks()[1]['status']=='בקופה'
    db.sql("update public.bank_transactions set amount=222 where id="+wrong)
    snapshot();assert checks()[1]['status']=='הופקד - במעקב' and checks()[0]['status']=='בקופה'

    # Exact numbers disambiguate equal amounts; future/home checks stay isolated.
    reset([check('n1',456),check('n2',456)])
    tx('numbered',456,numbers=['n2']);snapshot()
    assert [c['status'] for c in checks()]==['בקופה','הופקד - במעקב']

    # Never search a truncated prefix and call it a unique batch.
    reset([check('limit'+str(i),1) for i in range(17)])
    tx('limit',17);snapshot();assert all(c['status']=='בקופה' for c in checks())

    # A uniquely attributable return debit identifies its missing batch member.
    reset([check('part1',300),check('part2',700)])
    tx('batch',1000);snapshot()
    rows=checks()
    for c in rows:c['bankReview']=c['bankMatch']['eventId']
    save(rows);tx('unidentified-return',-300,'החזרת שיק',day='2026-08-03');snapshot('2026-08-10')
    assert checks()[0]['bankMatch']['warning']=='batch_missing' and checks()[1]['bankMatch']['phase']=='deposited'
    assert all(c['status']=='הופקד - במעקב' for c in checks())

    # The archive's proven pending-row collapse transfers its claim before deletion.
    reset([check('alias',678)])
    oldtx=tx('old',678,status='pending');snapshot()
    newtx=tx('new',678)
    auth('select netunim_internal.move_check_bank_claim('+oldtx+','+newtx+')')
    db.sql('delete from public.bank_transactions where id='+oldtx)
    snapshot('2026-08-03')
    assert checks()[0]['bankMatch']['transactionId']==int(newtx) and checks()[0]['bankMatch']['phase']=='deposited'

    # Exercise the actual fenced archive RPC (including the pending collapse hook),
    # not just trigger calls in synthetic snapshot fixtures.
    reset([check('rpc',777)])
    lease=json.loads(auth("set local role authenticated;select to_jsonb(x) from public.claim_finance_sync_lease('bank','check-rpc',60) x"))
    source={'mergeKey':'rpc-pending','date':'2026-08-02T09:00:00Z','processedDate':'2026-08-02T09:00:00Z','amount':777,'currency':'ILS','description':'הפקדת שיק','status':'pending','bankReference':'777777','bankSerial':'0','activityTypeCode':1}
    def rpc_snapshot(complete,second):
        return auth("set local role authenticated;select to_jsonb(x) from public.sync_bank_transactions_snapshot('check-test','business',"+quote(json.dumps([source]))+"::jsonb,'2026-08-02T12:00:"+str(second).zfill(2)+"Z','2026-07-01','2026-08-02',"+str(complete).lower()+",'bank','check-rpc',"+str(lease['fence_epoch'])+") x")
    rpc_snapshot(False,1);assert checks()[0]['status']=='בקופה','Partial snapshots never authorize check transitions'
    rpc_snapshot(True,2);assert checks()[0]['status']=='הופקד - במעקב'
    oldid=checks()[0]['bankMatch']['transactionId']
    newtx=tx('rpc-posted',777)
    db.sql("update public.bank_transactions set bank_serial='42',bank_reference='777777',activity_type_code=1 where id="+newtx)
    source.update(mergeKey='rpc-posted',status='completed',bankSerial='42',description='הפק.שיק בסלולר')
    rpc_snapshot(True,3)
    assert checks()[0]['bankMatch']['transactionId']==int(newtx),'Canonical merger transfers the existing claim'
    assert db.sql('select count(*) from public.bank_transactions where id='+str(oldid)).strip()=='0'
    assert checks()[0]['status']=='הופקד - במעקב'
    db.sql("update public.bank_transactions set check_details='{\"checkNumbers\":[\"different-check\"]}' where id="+newtx)
    snapshot('2026-08-03')
    assert checks()[0]['bankMatch']['phase']=='missing','Late bank detail enrichment contradicting the match must suspend it'

    # A deposit of 100 + 200 + 400 shrinks to 600 and then 400. The original
    # membership, not the most recently surviving subset, identifies every loss.
    reset([check('Alice',100),check('Bob',200),check('Carol',400)])
    original=tx('original-batch',700);snapshot()
    db.sql('update public.bank_transactions set amount=600 where id='+original)
    snapshot('2026-08-03')
    state={c['id']:c for c in checks()}
    assert state['Alice']['bankMatch']['warning']=='batch_missing'
    assert state['Bob']['bankMatch']['phase']=='deposited'
    assert [c['name'] for c in state['Alice']['bankMatch']['remainder']['missingMembers']]==['Alice']
    db.sql('update public.bank_transactions set amount=400 where id='+original)
    snapshot('2026-08-04')
    state={c['id']:c for c in checks()}
    assert [c['name'] for c in state['Bob']['bankMatch']['remainder']['missingMembers']]==['Alice','Bob']
    assert state['Carol']['bankMatch']['phase']=='deposited'
    rows=checks();rows[2]['bankReview']=rows[2]['bankMatch']['eventId'];save(rows)
    snapshot('2026-08-11')
    assert checks()[2]['status']=='נפרע' and checks()[0]['status']!='נפרע'
    db.sql('update public.bank_transactions set amount=700 where id='+original)
    snapshot('2026-08-12');assert checks()[0]['bankMatch']['phase']=='deposited','Restored full batch must request review again'

    # Changed archive identity still points back to the unique original group.
    reset([check('Alice',100),check('Bob',200),check('Carol',400)])
    original=tx('old-aggregate',700);snapshot()
    db.sql("update public.bank_transactions set presence_state='missing' where id="+original)
    replacement=tx('new-aggregate',600);snapshot('2026-08-03')
    assert checks()[0]['bankMatch']['transactionId']==int(replacement)
    assert checks()[0]['bankMatch']['warning']=='batch_missing'

    reset([check('Alice',100),check('Bob',200),check('Carol',400)])
    original=tx('before-competing',700);snapshot()
    save(checks()+[check('Different deposit',600)])
    db.sql("update public.bank_transactions set presence_state='missing' where id="+original)
    tx('possibly-unrelated',600);snapshot('2026-08-03')
    assert not checks()[0]['bankMatch'].get('remainder'),'An unrelated open cheque competes with an amount-only replacement'

    # Equal-value members are indistinguishable from the residual amount alone.
    reset([check('Same1',100),check('Same2',100),check('Other',300)])
    original=tx('ambiguous-remainder',500);snapshot()
    db.sql('update public.bank_transactions set amount=400 where id='+original);snapshot('2026-08-03')
    assert all(c['bankMatch']['warning']=='batch_ambiguous' for c in checks())
    assert all(not c['bankMatch']['remainder'].get('missingMembers') for c in checks())

    # Two same-day bank credits explaining a missing aggregate must not pick one.
    reset([check('Alice',100),check('Bob',200),check('Carol',400)])
    original=tx('old',700);snapshot();db.sql("update public.bank_transactions set presence_state='missing' where id="+original)
    tx('replacement-one',600);tx('replacement-two',400);snapshot('2026-08-03')
    assert all(c['bankMatch']['phase']=='missing' and not c['bankMatch'].get('remainder') for c in checks())

    reset([check('Alice',100),check('Bob',200),check('Carol',400)])
    tx('credited-batch',700);snapshot();tx('returned-pair',-300,'החזרת שיק',day='2026-08-03');snapshot('2026-08-03')
    state={c['id']:c for c in checks()}
    assert [c['name'] for c in state['Bob']['bankMatch']['remainder']['missingMembers']]==['Alice','Bob']
    assert state['Carol']['bankMatch']['phase']=='deposited' and not state['Carol']['bankMatch'].get('warning')
    assert state['Alice']['bankMatch']['remainder']['evidence']=='return_debits'
    tx('returned-rest',-400,'החזרת שיק',day='2026-08-04');snapshot('2026-08-04')
    assert all(c['bankMatch']['warning']=='batch_missing' and c['bankMatch']['remainder']['observedAmount']==0 for c in checks())

    # Two return debits may describe the same member, not two distinct members.
    # Their sum must never falsely identify the other, larger check.
    reset([check('Small',100),check('Large',200)])
    tx('credit',300);snapshot()
    identified_return=tx('return-one',-100,'החזרת שיק',day='2026-08-03')
    tx('return-two',-100,'החזרת שיק',day='2026-08-03');snapshot('2026-08-10')
    assert all(c['bankMatch']['warning']=='possible_return' and not c['bankMatch'].get('remainder') for c in checks())
    db.sql("update public.bank_transactions set check_details='{\"checkNumbers\":[\"Small\"]}' where id="+identified_return)
    snapshot('2026-08-11')
    assert checks()[0]['status']=='חזר' and not checks()[0]['bankMatch'].get('warning'),'Number enrichment resolves the earlier uncertainty'

    reset([check('Equal1',100),check('Equal2',100),check('Larger',300)])
    tx('credit',500);snapshot()
    for i in range(3):tx('duplicate-return-'+str(i),-100,'החזרת שיק',day='2026-08-03')
    snapshot('2026-08-10')
    assert all(c['bankMatch']['warning']=='possible_return' and not c['bankMatch'].get('remainder') for c in checks())

    # A contested return of a SUBSET (neither the whole deposit nor one member)
    # must block both possible groups, even after both have been approved.
    reset([check('A',100),check('B',200),check('C',400),check('OtherGroup',300)])
    tx('batch',700,numbers=['A','B','C']);tx('other',300,numbers=['OtherGroup']);snapshot()
    rows=checks()
    for c in rows:c['bankReview']=c['bankMatch']['eventId']
    save(rows);tx('contested-return',-300,'החזרת שיק',day='2026-08-03');snapshot('2026-08-10')
    assert all(c['status']=='הופקד - במעקב' and c['bankMatch']['warning']=='possible_return' for c in checks())

    # Neither anonymous nor another authenticated user may call the internal writer.
    db.sql("do $$begin if has_function_privilege('authenticated','netunim_internal.move_check_bank_claim(bigint,bigint)','execute') then raise exception 'internal function exposed';end if;end$$")
    print('PASS automatic checks: groups, account/date isolation, confirmation, fresh evidence, idempotency, disappearance, exact partial returns, manual override and ambiguous matches')
