"""Actual v6 writes cannot erase posted evidence before a future billing date."""
import argparse
import json
from isolated_sync_postgres import IsolatedPostgres, ROOT, quote
parser=argparse.ArgumentParser();parser.add_argument('--pre-fix',action='store_true');args=parser.parse_args()
boundary='20261116080000_credit_posted_retention.sql'
with IsolatedPostgres(schema_files=[p for p in sorted((ROOT/'supabase/migrations').glob('*.sql')) if not args.pre_fix or p.name<boundary]) as db:
    db.auth_sql("select public.claim_finance_sync_lease('credit','posted',120)")
    epoch=db.auth_sql("select fence_epoch from public.finance_sync_leases where owner_id=auth.uid() and lease_name='credit'").strip()
    future=db.auth_sql("select to_char(current_timestamp at time zone 'Asia/Jerusalem' + interval '2 months','YYYY-MM-20')").strip()
    tx={'id':'posted','status':'completed','date':'2026-11-10','processedDate':future,'chargedAmount':-365,'chargedCurrency':'ILS','originalAmount':-365,'originalCurrency':'ILS'}
    state={'bank':{'balance':900},'creditSync':{'profiles':[{'profileId':'P','accounts':[{'accountNumber':'C','months':[{'month':future[:7],'transactions':[tx]}]}]}]}}
    def save(value,revision,operation):
        return json.loads(db.auth_sql("select row_to_json(r) from public.save_finance_sync_document_v6('posted',"+str(revision)+','+quote(json.dumps(value))+"::jsonb,"+quote(operation)+",'{}','credit','posted',"+epoch+") r").strip())
    save(state,0,'seed')
    missing=json.loads(json.dumps(state));missing['creditSync']['profiles'][0]['accounts'][0]['months'][0]['transactions']=[]
    try:save(missing,1,'partial')
    except RuntimeError as error:assert 'credit_history_regression' in str(error)
    else:raise AssertionError('completed future charge was silently erased')
    state['creditSync']['profiles'][0]['accounts'][0]['months'][0]['transactions'].append({**tx,'id':'refund','chargedAmount':365,'originalAmount':365})
    assert save(state,1,'explicit-refund')['revision']==2
    print('PASS future posted retention, explicit refund addition and exact v6 revision')
