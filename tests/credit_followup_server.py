"""Legacy anomalies must not block Bank-only writes; Credit changes stay guarded."""
import json
from isolated_sync_postgres import IsolatedPostgres, ROOT, quote
base=ROOT/'supabase/migrations/20261115160000_finance_credit_history.sql'
follow=ROOT/'supabase/migrations/20261115183000_credit_reconciliation_followup.sql'
with IsolatedPostgres(schema_files=[p for p in sorted(base.parent.glob('*.sql')) if p.name<base.name]) as db:
    db.auth_sql("select public.claim_finance_sync_lease('credit','followup',120)")
    epoch=db.auth_sql("select fence_epoch from public.finance_sync_leases where owner_id=auth.uid() and lease_name='credit'").strip()
    def save(value,rev,op,doc='duplicate'):
        return json.loads(db.auth_sql("select row_to_json(r) from public.save_finance_sync_document_v6("+quote(doc)+','+str(rev)+','+quote(json.dumps(value))+"::jsonb,"+quote(op)+",'{}','credit','followup',"+epoch+") r").strip())
    tx={'id':'old','date':'2020-01-01','processedDate':None,'originalAmount':-100,'originalCurrency':'USD','chargedAmount':None,'chargedCurrency':'ILS','status':'completed'}
    state={'bank':{'balance':100},'creditSync':{'profiles':[{'profileId':'P','provider':'max','accounts':[{'accountNumber':'C','unassignedTransactions':[tx], 'months':[{'month':'2020-01','transactions':[{**tx,'processedDate':'2020-01-10','chargedAmount':-365}]}]}]}]}}
    save(state,0,'legacy')
    db.migrate(base.read_text(encoding='utf-8'))
    if follow.exists(): db.migrate(follow.read_text(encoding='utf-8'))
    bank_only=json.loads(json.dumps(state));bank_only['bank']['balance']=200
    assert save(bank_only,1,'bank-only')['revision']==2
    assert json.loads(db.auth_sql("select row_to_json(r) from public.read_finance_document_version('duplicate',2) r").strip())['state']==bank_only
    altered=json.loads(json.dumps(bank_only));altered['creditSync']['extra']='changed'
    try:save(altered,2,'credit-change')
    except RuntimeError as error:assert 'credit_duplicate_placement' in str(error)
    else:raise AssertionError('Credit mutation bypassed legacy duplicate validation')
    repeated={'bank':{},'creditSync':{'profiles':[{'profileId':'P','provider':'max','accounts':[{'accountNumber':'C','months':[],'unassignedTransactions':[tx,{**tx,'chargedAmount':-365}]}]}]}}
    save(repeated,0,'repeat-start','repeated')
    same=json.loads(json.dumps(repeated));same['creditSync']['extra']='settings change'
    assert save(same,1,'repeat-identical','repeated')['revision']==2
    same['creditSync']['profiles'][0]['accounts'][0]['unassignedTransactions']=[{**tx,'chargedAmount':-365}]
    try:save(same,2,'drop-one','repeated')
    except RuntimeError as error:assert 'credit_unassigned_regression' in str(error)
    else:raise AssertionError('One new observation replaced two old source records')
    print('PASS legacy duplicate Bank-only write + snapshot, strict Credit changes, identical multiset and loss rejection')
