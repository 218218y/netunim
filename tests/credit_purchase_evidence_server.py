"""Real v6 preservation of purchase witnesses, same-total replacement and reviewed restore."""
import argparse,json
from isolated_sync_postgres import IsolatedPostgres,ROOT,quote
p=argparse.ArgumentParser();p.add_argument('--pre-fix',action='store_true');args=p.parse_args()
boundary='20261116140000_credit_purchase_evidence.sql'
migrations=sorted((ROOT/'supabase/migrations').glob('*.sql'))
files=[p for p in migrations if p.name<boundary]
with IsolatedPostgres(schema_files=files) as db:
    db.auth_sql("select public.claim_finance_sync_lease('credit','purchase',120)")
    epoch=db.auth_sql("select fence_epoch from public.finance_sync_leases where owner_id=auth.uid() and lease_name='credit'").strip()
    a={'id':'REUSED','type':'normal','status':'completed','date':'2019-12-01T00:00:00.000Z','transactionDate':'2019-12-02T00:00:00.000Z','transactionTime':'10:01','description':'Merchant A','originalAmount':-100,'originalCurrency':'ILS','chargedAmount':-100,'chargedCurrency':'ILS'}
    b={**a,'transactionDate':'2019-12-03T00:00:00.000Z','transactionTime':'11:02','description':'Merchant B'}
    variants=[{'description':'Merchant C'},{'transactionDate':'2019-12-04T00:00:00.000Z'},{'transactionTime':'12:03'}]
    months=['2020-01',db.auth_sql("select to_char(current_timestamp at time zone 'Asia/Jerusalem','YYYY-MM')").strip(),db.auth_sql("select to_char(current_timestamp at time zone 'Asia/Jerusalem'+interval '2 months','YYYY-MM')").strip()]
    def state(rows,month,unassigned=False):
        items=[{**t,'processedDate':None if unassigned else month+'-20T00:00:00.000Z'} for t in rows]
        return {'bank':{'balance':900},'creditSync':{'version':4,'profiles':[{'profileId':'P','accounts':[{'accountNumber':'C','months':[{'month':month,'transactions':[] if unassigned else items}],'unassignedTransactions':items if unassigned else []}]}]}}
    def save(name,value,revision,operation):
        return json.loads(db.auth_sql("select row_to_json(r) from public.save_finance_sync_document_v6("+quote(name)+','+str(revision)+','+quote(json.dumps(value))+"::jsonb,"+quote(operation)+",'{}','credit','purchase',"+epoch+") r").strip())
    if not args.pre_fix:
        # Retained source correction must work through the owner-reviewed RPC,
        # while the same replacement through an ordinary refresh is refused.
        original=state([a,b],months[0]);replacement=state([b,{**a,'description':'Merchant C'}],months[0])
        assert save('legacy-correction',original,0,'original')['revision']==1
        assert save('legacy-correction',replacement,1,'old-unprotected-write')['revision']==2
        for migration in migrations:
            if migration.name>=boundary:db.migrate(migration.read_text(encoding='utf-8'))
        try:save('legacy-correction',original,2,'ordinary-correction')
        except RuntimeError as error:assert 'credit_history_regression' in str(error),error
        else:raise AssertionError('unreviewed historical correction accepted')
        replacement['bank']['balance']=950;assert save('legacy-correction',replacement,2,'bank-only')['revision']==3
        reviewed=json.loads(db.auth_sql("select row_to_json(r) from public.restore_finance_credit_version('legacy-correction',1,3,'reviewed-correction','Verified original purchase evidence','purchase',"+epoch+") r").strip())
        assert reviewed['state']['creditSync']==original['creditSync'] and reviewed['state']['bank']['balance']==950
        retained=json.loads(db.auth_sql("select row_to_json(r) from public.export_finance_document_version('legacy-correction',2) r").strip())
        assert json.loads(retained['state_text'])['creditSync']==replacement['creditSync']
    checked=0
    for mi,month in enumerate(months):
        for unassigned in [False,True]:
            for vi,change in enumerate(variants):
                name=f'purchase-{mi}-{int(unassigned)}-{vi}';old=state([a,b],month,unassigned)
                assert save(name,old,0,'seed')['revision']==1
                try:save(name,state([b,{**a,**change}],month,unassigned),1,'replacement')
                except RuntimeError as error:assert ('credit_unassigned_regression' if unassigned else 'credit_history_regression') in str(error),error
                else:raise AssertionError('equal-money purchase source replacement accepted: '+name)
                replay=save(name,state([b,a],month,unassigned),1,'reordered');assert replay['revision']==2
                current=state([{**a,'memo':'User annotation'},b],month,unassigned)
                assert save(name,current,2,'annotation')['revision']==3
                current['bank']['balance']=950;assert save(name,current,3,'bank-only')['revision']==4
                restored=json.loads(db.auth_sql("select row_to_json(r) from public.restore_finance_credit_version("+quote(name)+",1,4,'reviewed','Reviewed source evidence correction','purchase',"+epoch+") r").strip())
                assert restored['state']['creditSync']==old['creditSync'] and restored['state']['bank']['balance']==950
                checked+=1
    # Legitimate missing-money enrichment cannot authorize a source replacement.
    missing={**a,'originalCurrency':'USD','chargedAmount':None,'chargeAmountStatus':'missing'}
    assert save('missing',state([missing],months[0]),0,'seed')['revision']==1
    for i,change in enumerate(variants):
        try:save('missing',state([{**missing,'chargedAmount':-365,'chargeAmountStatus':'reported',**change}],months[0]),1,'bad-enrichment-'+str(i))
        except RuntimeError as error:assert 'credit_history_regression' in str(error),error
        else:raise AssertionError('enrichment replaced purchase source')
    assert save('missing',state([{**missing,'chargedAmount':-365,'chargeAmountStatus':'reported'}],months[0]),1,'enriched')['revision']==2
    print('PASS',checked,'closed/current/future and unassigned scenarios; source-preserving replay, annotation, Bank-only write, reviewed restore and guarded enrichment')
