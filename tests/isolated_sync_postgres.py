"""Disposable PostgreSQL cluster; never accepts a URL or production credentials.
Requires local PostgreSQL executables. pg_cron is represented by a scheduling catalog
stub because Windows PostgreSQL does not ship it; retention execution is not tested.
"""
from pathlib import Path
import contextlib
import json
import os
import shutil
import subprocess
import tempfile
from browser_harness import ROOT, _free_port

OWNER='11111111-1111-4111-8111-111111111111'
class IsolatedPostgres:
    def __init__(self, schema_files=None, demotable_postgres=False):
        self.schema_files=schema_files
        self.demotable_postgres=demotable_postgres

    def __enter__(self):
        binary=shutil.which('postgres')
        if not binary: raise RuntimeError('PostgreSQL server tools required on PATH')
        self.bin=Path(binary).parent
        self.tmp=Path(tempfile.mkdtemp(prefix='netunim-sync-postgres-')).resolve()
        self.port=_free_port()
        self.env={**os.environ,'PGCLIENTENCODING':'UTF8'}
        for key in ('PGPASSWORD','PGSERVICE','PGSERVICEFILE','PGHOST','PGDATABASE','PGUSER','PGPORT','PGOPTIONS'):
            self.env.pop(key,None)
        try:
            bootstrap='fixture_bootstrap' if self.demotable_postgres else 'postgres'
            self.run('initdb','-D',str(self.tmp/'data'),'-U',bootstrap,'-A','trust','--encoding=UTF8','--no-locale')
            # Every fixture client uses explicit loopback TCP. Ubuntu's PostgreSQL
            # defaults to /var/run/postgresql for Unix sockets, which the unprivileged
            # CI user cannot write. Do not depend on (or chmod) host service state.
            with (self.tmp/'data/postgresql.conf').open('a',encoding='utf8') as config:
                config.write("\nunix_socket_directories = ''\n")
            self.run('pg_ctl','-D',str(self.tmp/'data'),'-l',str(self.tmp/'server.log'),'-o',f'-p {self.port} -h 127.0.0.1','start')
            if self.demotable_postgres:
                # PostgreSQL 18 cannot demote its bootstrap superuser. A separate
                # fixture bootstrap permits testing Supabase's non-superuser postgres.
                self.run('psql','-h','127.0.0.1','-p',str(self.port),'-U',bootstrap,'-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1',input='create role postgres login superuser;')
            self.sql('''create role anon;create role authenticated;create role service_role;
create role supabase_admin;
create schema auth;create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to public;grant execute on function auth.uid() to public;
create schema extensions;grant usage on schema extensions to authenticated;create schema cron;
create table cron.job(jobid bigint generated always as identity primary key,jobname text,schedule text,command text,active boolean default true,
 username text default current_user,database text default current_database(),nodename text default 'localhost',nodeport integer default inet_server_port(),unique(jobname,username));
create function cron.schedule(text,text,text) returns bigint language sql as $$insert into cron.job(jobname,schedule,command) values($1,$2,$3)
 on conflict(jobname,username) do update set schedule=excluded.schedule,command=excluded.command,active=true returning jobid$$;
create function cron.alter_job(job_id bigint,schedule text default null,command text default null,database text default null,username text default null,active boolean default null)
 returns void language sql as $$update cron.job set schedule=coalesce($2,job.schedule),command=coalesce($3,job.command),database=coalesce($4,job.database),username=coalesce($5,job.username),active=coalesce($6,job.active) where jobid=$1$$;
insert into auth.users values('''+quote(OWNER)+''');''')
            files=['netunim-kupa/supabase/setup.sql','netunim-orders/supabase/setup.sql','netunim-orders/supabase/shared/setup.sql']+['netunim-orders/supabase/'+n+'.sql' for n in ['core_rpc_contention_hardening_upgrade','cloud_sync_lossless_v3_upgrade','cloud_sync_operation_ledger_retention_upgrade','shared_checks_delete_intent_v4_upgrade','destructive_delete_intent_v4_upgrade','sync_integrity_v5_upgrade','sync_recovery_fencing_v6_upgrade']]
            if self.schema_files is not None:files=self.schema_files
            for name in files:
                self.migrate((ROOT/name).read_text(encoding='utf-8-sig'))
            if self.schema_files is None:self.sql((ROOT/'netunim-orders/supabase/shared/validation/sync_recovery_v6_postflight.sql').read_text(encoding='utf-8-sig'))
            return self
        except BaseException:
            self.__exit__(None,None,None)
            raise
    def __exit__(self,*args):
        with contextlib.suppress(Exception):self.run('pg_ctl','-D',str(self.tmp/'data'),'-m','immediate','stop')
        if self.tmp.parent!=Path(tempfile.gettempdir()).resolve() or not self.tmp.name.startswith('netunim-sync-postgres-'):
            raise RuntimeError('refusing cleanup outside the temporary test cluster')
        shutil.rmtree(self.tmp,ignore_errors=True)
    def run(self,program,*args,input=None):
        command=[str(self.bin/(program+('.exe' if os.name=='nt' else ''))),*args]
        if program=='pg_ctl':
            # Windows server grandchildren inherit pipe handles; use a file for pg_ctl.
            with (self.tmp/'control.log').open('w',encoding='utf8') as log:
                result=subprocess.run(command,stdin=subprocess.DEVNULL,stdout=log,stderr=log,env=self.env,timeout=30)
            if result.returncode:
                # Preserve the server's actual startup error before __exit__ removes
                # the disposable cluster; pg_ctl alone only says to inspect its log.
                diagnostics=[]
                for name in ('control.log','server.log'):
                    path=self.tmp/name
                    if path.is_file():diagnostics.append(name+':\n'+path.read_text(encoding='utf8',errors='replace')[-8000:])
                raise RuntimeError('\n'.join(diagnostics))
            return ''
        result=subprocess.run(command,input=input,encoding='utf8',errors='replace',capture_output=True,env=self.env,timeout=90)
        if result.returncode:raise RuntimeError(result.stderr[-8000:])
        return result.stdout
    def sql(self,source):
        return self.run('psql','-h','127.0.0.1','-p',str(self.port),'-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1',input=source)
    def migrate(self,source):
        # Explicit Windows-only scheduling model. Never fake pg_extension membership:
        # the live postflight MUST reject this fixture's missing real extension.
        return self.sql(source.replace('create extension if not exists pg_cron;','-- isolated scheduling catalog stub'))
    def auth_sql(self,source):
        return self.sql("begin;set local role authenticated;set local request.jwt.claim.sub='"+OWNER+"';"+source+';commit;')
    def rpc(self,name,body):
        allowed={'save_order_management_document_v5','save_kupa_document_v5','save_shared_checks_document_v5','get_netunim_sync_capabilities'}
        if name not in allowed:raise ValueError('unsupported fixture RPC')
        types={'p_document_name':'text','p_expected_revision':'bigint','p_state':'jsonb','p_operation_id':'text','p_delete_intents':'jsonb','p_deleted_check_ids':'jsonb','p_audit':'jsonb'}
        args=[]
        for key,value in body.items():
            if key not in types:raise ValueError('unsupported fixture parameter')
            args.append(key+'=>'+quote(json.dumps(value,ensure_ascii=False) if types[key]=='jsonb' else str(value))+'::'+types[key])
        if name=='get_netunim_sync_capabilities':return json.loads(self.auth_sql('select public.get_netunim_sync_capabilities()').strip())
        return json.loads(self.auth_sql('select row_to_json(r) from public.'+name+'('+','.join(args)+') r').strip())
    def head(self,table,document):
        if table not in ('order_management_documents','kupa_documents','shared_checks_documents'):raise ValueError('unsupported fixture table')
        out=self.auth_sql('select row_to_json(r) from (select revision,state,updated_at from public.'+table+' where owner_id=auth.uid() and document_name='+quote(document)+') r').strip()
        return json.loads(out) if out else None

def quote(value):return "'"+str(value).replace("'","''")+"'"

if __name__=='__main__':
    with IsolatedPostgres() as db:
        db.sql((ROOT/'tests/finance_fencing_server.sql').read_text(encoding='utf8'))
        print('PASS isolated PostgreSQL migration, capability postflight, bank/credit fencing under authenticated role')
