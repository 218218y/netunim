"""Owner-scoped canonical export and independent-file restore drill."""
import hashlib
import json
import sys
import tempfile
from pathlib import Path
from isolated_sync_postgres import IsolatedPostgres, ROOT, quote
sys.path.insert(0,str(ROOT/'tools'))
from finance_backup_drill import drill, read_backup

with tempfile.TemporaryDirectory(prefix='netunim-finance-file-drill-') as directory:
    artifact=Path(directory)/'finance-backup.json'
    with IsolatedPostgres(schema_files=sorted((ROOT/'supabase/migrations').glob('*.sql'))) as db:
        db.auth_sql("select public.claim_finance_sync_lease('credit','export',120)")
        epoch=db.auth_sql("select fence_epoch from public.finance_sync_leases where owner_id=auth.uid() and lease_name='credit'").strip()
        state={'bank':{'balance':500},'creditSync':{'version':4,'profiles':[{'profileId':'P','provider':'max','accounts':[{'accountNumber':'C','months':[{'month':'2026-10','transactions':[{'id':'1','date':'2026-10-01','processedDate':'2026-10-10','description':'בדיקת ייצוא','chargedAmount':-100,'chargedCurrency':'ILS'}]}],'unassignedTransactions':[]}]}]}}
        db.auth_sql("select * from public.save_finance_sync_document_v6('main',0,"+quote(json.dumps(state,ensure_ascii=False))+"::jsonb,'first','{}','credit','export',"+epoch+")")
        row=json.loads(db.auth_sql("select row_to_json(r) from public.export_finance_document_version('main',1) r").strip())
        assert hashlib.sha256(row['state_text'].encode('utf-8')).hexdigest()==row['state_hash']
        artifact.write_text(json.dumps({'format':'netunim-finance-backup','version':1,'document':'main','revision':1,'stateText':row['state_text'],'sha256':row['state_hash']},ensure_ascii=False),encoding='utf-8')
        assert read_backup(artifact)[1]==state
        other=db.sql("begin;set local role authenticated;set local request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';select count(*) from public.export_finance_document_version('main',1);commit;")
        assert other.strip()=='0'
    result=drill(artifact)
    assert result['exact_state_restored'] and result['checksum_verified']
    backup=json.loads(artifact.read_text(encoding='utf-8'));backup['stateText']+=' ';artifact.write_text(json.dumps(backup),encoding='utf-8')
    try:read_backup(artifact)
    except ValueError as error:assert 'checksum' in str(error)
    else:raise AssertionError('changed backup accepted')
    print('PASS canonical UTF-8 export/hash, owner isolation, tamper rejection and exact independent-file restore on another disposable database')
