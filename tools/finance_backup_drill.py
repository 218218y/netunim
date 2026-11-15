"""Verify and restore a standalone Finance export into disposable PostgreSQL only.
No URL, credential or production connection option is accepted.
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tests'))
from isolated_sync_postgres import IsolatedPostgres, ROOT, quote


def read_backup(path):
    if path.stat().st_size>64_000_000: raise ValueError('backup is too large')
    backup=json.loads(path.read_text(encoding='utf-8-sig'))
    if backup.get('format')!='netunim-finance-backup' or backup.get('version')!=1 or backup.get('document')!='main': raise ValueError('unsupported backup format')
    wire=backup.get('stateText')
    if not isinstance(wire,str) or hashlib.sha256(wire.encode('utf-8')).hexdigest()!=backup.get('sha256'): raise ValueError('backup checksum mismatch')
    state=json.loads(wire)
    if not isinstance(state,dict) or not isinstance(state.get('creditSync'),dict) or not isinstance(state['creditSync'].get('profiles'),list): raise ValueError('invalid Finance state')
    return backup,state


def drill(path):
    backup,state=read_backup(Path(path))
    boundary='20261115160000_finance_credit_history.sql'
    migrations=sorted((ROOT/'supabase/migrations').glob('*.sql'))
    with IsolatedPostgres(schema_files=[p for p in migrations if p.name<boundary]) as db:
        db.auth_sql("select public.claim_finance_sync_lease('credit','external-drill',120)")
        epoch=db.auth_sql("select fence_epoch from public.finance_sync_leases where owner_id=auth.uid() and lease_name='credit'").strip()
        db.auth_sql("select * from public.save_finance_sync_document_v6('external-drill',0,"+quote(backup['stateText'])+"::jsonb,'file-import','{}','credit','external-drill',"+epoch+")")
        for migration in migrations:
            if migration.name>=boundary: db.migrate(migration.read_text(encoding='utf-8'))
        restored=json.loads(db.auth_sql("select state from public.read_finance_document_version('external-drill',1)").strip())
        if json.dumps(restored,sort_keys=True,ensure_ascii=False)!=json.dumps(state,sort_keys=True,ensure_ascii=False): raise AssertionError('restored Finance differs from the independent file')
        profiles=state['creditSync']['profiles']
        return {'checksum_verified':True,'exact_state_restored':True,'isolated_postgres':True,'profiles':len(profiles),'accounts':sum(len(profile.get('accounts',[])) for profile in profiles)}


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--backup',type=Path,required=True)
    print(json.dumps(drill(parser.parse_args().backup),sort_keys=True))
