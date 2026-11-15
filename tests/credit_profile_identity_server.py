"""Prove SQL cannot consume two profile histories through a weak suffix alias."""
import argparse
import json
from isolated_sync_postgres import IsolatedPostgres, ROOT, quote
parser=argparse.ArgumentParser();parser.add_argument('--pre-fix',action='store_true');args=parser.parse_args()
migration=ROOT/'supabase/migrations/20261115213000_credit_profile_identity.sql'
with IsolatedPostgres(schema_files=[p for p in sorted(migration.parent.glob('*.sql')) if p.name<migration.name]) as db:
    db.auth_sql("select public.claim_finance_sync_lease('credit','identity',120)")
    epoch=db.auth_sql("select fence_epoch from public.finance_sync_leases where owner_id=auth.uid() and lease_name='credit'").strip()
    def save(state,revision,operation,document='identity'):
        return json.loads(db.auth_sql("select row_to_json(r) from public.save_finance_sync_document_v6("+quote(document)+','+str(revision)+','+quote(json.dumps(state))+"::jsonb,"+quote(operation)+",'{}','credit','identity',"+epoch+") r").strip())
    tx={'id':'reused','date':'2020-01-01','processedDate':'2020-01-10','status':'completed','originalAmount':-100,'originalCurrency':'ILS','chargedAmount':-100,'chargedCurrency':'ILS'}
    def profile(identity):return {'profileId':identity,'provider':'max','ownerLabel':'Owner','accounts':[{'accountNumber':'1234','months':[{'month':'2020-01','transactions':[tx]}],'unassignedTransactions':[]}]}
    state={'bank':{'balance':100},'creditSync':{'profiles':[profile('first'),profile('second')]}}
    assert save(state,0,'first')['revision']==1
    duplicate={'bank':{'balance':100},'creditSync':{'profiles':[profile('same'),profile('same')]}}
    save(duplicate,0,'legacy-duplicate','duplicate')
    if not args.pre_fix:db.migrate(migration.read_text(encoding='utf-8'))
    consolidated={'bank':{'balance':100},'creditSync':{'profiles':[profile('import:other')]}}
    try:save(consolidated,1,'weak-alias')
    except RuntimeError as error:assert 'credit_history_regression' in str(error)
    else:raise AssertionError('same owner/provider/suffix erased another profile occurrence')
    state['creditSync']['settings']='changed';assert save(state,1,'same-identities')['revision']==2
    duplicate['bank']['balance']=900;assert save(duplicate,1,'bank-only','duplicate')['revision']==2
    reduced={'bank':{'balance':900},'creditSync':{'profiles':[profile('same')]}}
    try:save(reduced,2,'concealed-old-ambiguity','duplicate')
    except RuntimeError as error:assert 'credit_ambiguous_identity' in str(error)
    else:raise AssertionError('normalization silently erased old ambiguous profile multiplicity')
    duplicate['creditSync']['settings']='changed'
    try:save(duplicate,2,'ambiguous-update','duplicate')
    except RuntimeError as error:assert 'credit_ambiguous_identity' in str(error)
    else:raise AssertionError('ambiguous profile ids accepted for Credit change')
    print('PASS exact profile histories and multiplicity, weak alias rejection, duplicate identity guard, legacy Bank-only update and versions')
