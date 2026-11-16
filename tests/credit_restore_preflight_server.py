"""Real archived malformed versions stay readable, but cannot bypass restore validation."""
import argparse
import json
from isolated_sync_postgres import IsolatedPostgres, ROOT, quote
parser=argparse.ArgumentParser();parser.add_argument('--pre-fix',action='store_true');args=parser.parse_args()
boundary='20261115160000_finance_credit_history.sql'
migrations=sorted((ROOT/'supabase/migrations').glob('*.sql'))
with IsolatedPostgres(schema_files=[p for p in migrations if p.name<boundary]) as db:
    db.auth_sql("select public.claim_finance_sync_lease('credit','validate',120)")
    epoch=db.auth_sql("select fence_epoch from public.finance_sync_leases where owner_id=auth.uid() and lease_name='credit'").strip()
    tx={'id':'T','status':'completed','date':'2026-11-10','processedDate':'2026-11-20','originalAmount':-365,'originalCurrency':'$','chargedAmount':-365,'chargedCurrency':'₪'}
    valid={'bank':{'balance':900},'creditSync':{'version':4,'profiles':[{'profileId':'P','accounts':[{'accountNumber':'C','months':[{'month':'2026-11','transactions':[tx]}]}]}],'cardMappings':{'P:C':{'included':True,'account':'עסקי'}}}}
    cases={}
    def altered(name,change):
        state=json.loads(json.dumps(valid));change(state);cases[name]=state
    altered('duplicate_profile',lambda s:s['creditSync']['profiles'].append(s['creditSync']['profiles'][0]))
    altered('duplicate_account',lambda s:s['creditSync']['profiles'][0]['accounts'].append(s['creditSync']['profiles'][0]['accounts'][0]))
    altered('duplicate_month',lambda s:s['creditSync']['profiles'][0]['accounts'][0]['months'].append(s['creditSync']['profiles'][0]['accounts'][0]['months'][0]))
    altered('invalid_month',lambda s:s['creditSync']['profiles'][0]['accounts'][0]['months'][0].update(month='2026-13'))
    altered('ambiguous_billing_identity',lambda s:s['creditSync']['profiles'][0]['accounts'][0]['months'][0]['transactions'].append({**tx}))
    altered('duplicate_placement',lambda s:s['creditSync']['profiles'][0]['accounts'][0].update(unassignedTransactions=[{**tx,'processedDate':None}]))
    altered('invalid_amount',lambda s:s['creditSync']['profiles'][0]['accounts'][0]['months'][0]['transactions'][0].update(chargedAmount='365'))
    altered('invalid_date',lambda s:s['creditSync']['profiles'][0]['accounts'][0]['months'][0]['transactions'][0].update(date='2026-02-30'))
    altered('invalid_mapping',lambda s:s['creditSync']['cardMappings']['P:C'].update(included='false'))
    def save(state,revision,operation,document):
        return json.loads(db.auth_sql("select row_to_json(r) from public.save_finance_sync_document_v6("+quote(document)+','+str(revision)+','+quote(json.dumps(state))+"::jsonb,"+quote(operation)+",'{}','credit','validate',"+epoch+") r").strip())
    for name,state in cases.items():save(state,0,'seed',name)
    save(valid,0,'seed','valid')
    for migration in migrations:
        if migration.name>=boundary and (not args.pre_fix or migration.name<'20261116100000_credit_restore_preflight.sql'):db.migrate(migration.read_text(encoding='utf-8'))
    def restore(document,revision,operation):
        return json.loads(db.auth_sql("select row_to_json(r) from public.restore_finance_credit_version("+quote(document)+",1,"+str(revision)+','+quote(operation)+",'Reviewed retained version','validate',"+epoch+") r").strip())
    for name,state in cases.items():
        archived=json.loads(db.auth_sql("select row_to_json(r) from public.export_finance_document_version("+quote(name)+",1) r").strip())
        assert json.loads(archived['state_text'])==state
        try:restore(name,1,'invalid-restore')
        except RuntimeError as error:assert 'finance_credit_invalid_version: '+name in str(error),error
        else:raise AssertionError('malformed retained version restored: '+name)
    valid['bank']['balance']=950;valid['creditSync']['cardMappings']['P:C']['included']=False
    assert save(valid,1,'current-settings','valid')['revision']==2
    restored=restore('valid',2,'valid-restore');assert restored['state']['bank']['balance']==950
    replay=restore('valid',2,'valid-restore');assert replay['operation_replayed'] is True and replay['revision']==3
    print('PASS malformed archive export, nine restore refusals, valid Credit-only restore, Bank preservation and replay')
