"""Occurrence, anonymous-placement and amount-enrichment parity on actual v6 writes."""
import json
from isolated_sync_postgres import IsolatedPostgres,ROOT,quote
with IsolatedPostgres(schema_files=sorted((ROOT/'supabase/migrations').glob('*.sql'))) as db:
    db.auth_sql("select public.claim_finance_sync_lease('credit','occurrence',120)")
    epoch=db.auth_sql("select fence_epoch from public.finance_sync_leases where owner_id=auth.uid() and lease_name='credit'").strip()
    tx={'id':'REUSED','type':'normal','status':'completed','date':'2026-11-10T00:00:00.000Z','transactionDate':'2026-11-10T00:00:00.000Z','processedDate':'2026-11-20T00:00:00.000Z','description':'Merchant A','originalAmount':-100,'originalCurrency':'ILS','chargedAmount':-100,'chargedCurrency':'ILS','foreignTransaction':False}
    def state(rows=(),unassigned=()):
        return {'bank':{'balance':900},'creditSync':{'version':4,'profiles':[{'profileId':'P','accounts':[{'accountNumber':'C','months':[{'month':'2026-11','transactions':list(rows)}],'unassignedTransactions':list(unassigned)}]}],'cardMappings':{'P:C':{'included':True}}}}
    def save(document,value,revision,operation):
        return json.loads(db.auth_sql("select row_to_json(r) from public.save_finance_sync_document_v6("+quote(document)+','+str(revision)+','+quote(json.dumps(value))+"::jsonb,"+quote(operation)+",'{}','credit','occurrence',"+epoch+") r").strip())
    def reject(document,value,revision,error):
        try:save(document,value,revision,'rejected')
        except RuntimeError as exc:assert error in str(exc),exc
        else:raise AssertionError('Unsafe mutation accepted: '+document)
    repeated=state([tx,{**tx,'description':'Merchant B','chargedAmount':-200,'originalAmount':-200}])
    assert save('reused',repeated,0,'seed')['revision']==1
    restored=json.loads(db.auth_sql("select row_to_json(r) from public.restore_finance_credit_version('reused',1,1,'restore','Reviewed occurrence evidence','occurrence',"+epoch+") r").strip())
    assert len(restored['state']['creditSync']['profiles'][0]['accounts'][0]['months'][0]['transactions'])==2
    anonymous={**tx,'id':'','processedDate':None}
    reject('overlap',state([{**anonymous,'processedDate':tx['processedDate']}],[anonymous]),0,'credit_duplicate_placement')
    assert save('downgrade',state([], [{**tx,'processedDate':None}]),0,'seed')['revision']==1
    reject('downgrade',state([{**tx,'status':'pending'}]),1,'credit_unassigned_regression')
    precise={**anonymous,'transactionTime':'12:34'}
    assert save('anonymous',state([], [precise]),0,'seed')['revision']==1
    assert save('anonymous',state([{**precise,'processedDate':tx['processedDate']}]),1,'transfer')['revision']==2
    assert save('ambiguous',state([], [anonymous]),0,'seed')['revision']==1
    reject('ambiguous',state([{**anonymous,'processedDate':tx['processedDate']}]),1,'credit_unassigned_regression')
    missing={**tx,'originalAmount':-50,'originalCurrency':'USD','chargedAmount':None,'chargeAmountStatus':'missing','foreignTransaction':True}
    assert save('enrichment',state([missing]),0,'seed')['revision']==1
    reported={**missing,'chargedAmount':-180,'chargeAmountStatus':'reported'}
    assert save('enrichment',state([reported]),1,'enrich')['revision']==2
    reject('enrichment',state([{**reported,'chargedAmount':-190}]),2,'credit_history_regression')
    reject('enrichment',state([]),2,'credit_history_regression')
    # Snapshot trigger captured the old unknown amount as audit evidence.
    archive=json.loads(db.auth_sql("select row_to_json(r) from public.export_finance_document_version('enrichment',1) r").strip())
    assert json.loads(archive['state_text'])['creditSync']['profiles'][0]['accounts'][0]['months'][0]['transactions'][0]['chargedAmount'] is None
    for evidence in [dict(chargedAmount=None,chargeAmountStatus='reported'),dict(chargedAmount=-1,chargeAmountStatus='missing'),dict(chargedAmount=-1,chargeAmountStatus='not_billed'),dict(foreignTransaction='true')]:
        invalid=state([{**tx,**evidence}])
        try:db.sql('select netunim_internal.require_credit_restore_integrity('+quote(json.dumps(invalid['creditSync']))+'::jsonb)')
        except RuntimeError as exc:assert 'invalid_evidence' in str(exc),exc
        else:raise AssertionError('Invalid monetary evidence accepted')
    print('PASS actual writes, repeated-ID restore, anonymous ambiguity/transfer, enrichment audit and immutable known money')
