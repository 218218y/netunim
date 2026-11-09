"""Exercise MFA against real isolated RLS and every privileged public entrypoint."""
import json
import re
from isolated_sync_postgres import IsolatedPostgres, ROOT, OWNER, quote

OTHER = '22222222-2222-4222-8222-222222222222'
MIGRATION = ROOT/'supabase/migrations/20261108210000_financial_mfa_boundaries.sql'

def auth(db, owner, sql, aal='aal1'):
    return db.sql('BEGIN;SET LOCAL ROLE authenticated;SET LOCAL request.jwt.claim.sub='+quote(owner)+
        ';SET LOCAL request.jwt.claims='+quote(json.dumps({'sub':owner, 'role':'authenticated', 'aal':aal}))+';'+sql+';COMMIT;').strip()

def denied(db, owner, sql):
    auth(db, owner, "DO $test$ BEGIN PERFORM "+sql+";RAISE EXCEPTION 'MFA boundary did not reject the operation';EXCEPTION WHEN SQLSTATE '42501' THEN NULL;END $test$")

def definitions(db):
    return json.loads(db.sql("select json_agg(json_build_object('signature',p.oid::regprocedure::text,'body',p.prosrc,'strict',p.proisstrict,'language',l.lanname,'arguments',(select string_agg('NULL::'||format_type(t,null),',' order by ord) from unnest(p.proargtypes::oid[]) with ordinality x(t,ord)))) from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang where n.nspname='public' and p.prosecdef and has_function_privilege('authenticated',p.oid,'EXECUTE')"))

def run():
    migrations = sorted((ROOT/'supabase/migrations').glob('*.sql'))
    with IsolatedPostgres(schema_files=[p for p in migrations if p != MIGRATION]) as db:
        previous = {f['signature']:f for f in definitions(db)}
        assert len(previous) == 27
        # Managed Storage grants are a platform prerequisite, absent from the
        # minimal fixture. Model them before applying this application migration.
        db.sql('grant select,insert,delete on storage.objects to authenticated;')
        db.migrate(MIGRATION.read_text(encoding='utf-8'))
        current = definitions(db)
        assert set(previous) == {f['signature'] for f in current}
        for function in current:
            before = previous[function['signature']]
            assert not function['strict'], function['signature']
            body = function['body'].replace('\r\n','\n')
            expected = before['body'].replace('\r\n','\n').strip()
            guard = r'\s*(?:PERFORM|SELECT) netunim_internal\.require_financial_mfa_v1\(\);'
            assert len(re.findall(guard, body)) == 1, function['signature']
            assert re.sub(guard, '', body, count=1).strip() == expected, ('business body changed',function['signature'])
        db.sql('insert into auth.users values('+quote(OTHER)+');')
        ids=[]
        for owner in (OWNER,OTHER):
            ids.append(db.sql("insert into public.bank_transactions(owner_id,account_key,account_role,merge_key,amount) values("+quote(owner)+",'mfa-synthetic','business',"+quote(owner)+",1) returning id").strip())
            assert auth(db,owner,'select count(*) from public.bank_transactions') == '1'
        db.sql("insert into auth.mfa_factors(user_id,status) values("+quote(OWNER)+",'unverified')")
        assert auth(db,OWNER,'select count(*) from public.bank_transactions') == '1'
        db.sql("update auth.mfa_factors set status='verified' where user_id="+quote(OWNER))
        db.sql("insert into storage.objects values(gen_random_uuid(),'bank-cheque-images',"+quote(OWNER+'/mfa-synthetic.png')+")")
        denied(db,OWNER,'(select count(*) from public.bank_transactions)')
        denied(db,OWNER,'(select count(*) from storage.objects)')
        for function in current:
            name=function['signature'].split('(')[0]
            denied(db,OWNER,name+'('+(function['arguments'] or '')+')')
        # Positive controls distinguish real assurance enforcement from denying everyone.
        assert auth(db,OWNER,'select count(*) from public.bank_transactions','aal2') == '1'
        assert auth(db,OWNER,'select count(*) from storage.objects','aal2') == '1'
        assert auth(db,OTHER,'select count(*) from storage.objects') == '0'
        assert auth(db,OWNER,'select transaction_id from public.set_bank_transaction_handled('+ids[0]+',true)','aal2') == ids[0]
        assert auth(db,OTHER,'select count(*) from public.bank_transactions') == '1'
        assert auth(db,OTHER,'select count(*) from public.bank_transactions where owner_id='+quote(OWNER)) == '0'
        assert db.sql("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','netunim_internal') and p.prosecdef and has_function_privilege('anon',p.oid,'EXECUTE')").strip() == '0'
        assert db.sql("select count(*) from pg_policy where polname='financial_mfa_v1'").strip() != '0'
        # Missing/forged assurance remains denied; another owner's active factor does not opt B in.
        denied(db,OWNER,'netunim_internal.require_financial_mfa_v1()')
    print('PASS MFA: unchanged business definitions, all 27 privileged entrypoints, real RLS, lower-AAL denial and AAL2/unenrolled positive controls')

if __name__ == '__main__': run()
