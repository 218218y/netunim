-- Operational infrastructure only: never invoke either retention function here.
-- Supabase provides the pg_cron binary/preloaded worker; fail if unavailable.
create extension if not exists pg_cron;

do $migration$
declare
  expected record;
  existing cron.job%rowtype;
begin
  -- cron.job has owner RLS. A partial catalog view cannot prove uniqueness.
  if current_user <> 'postgres' or current_database() <> 'postgres'
     or not exists (select 1 from pg_roles where rolname=current_user and (rolsuper or rolbypassrls)) then
    raise exception 'Retention migration requires postgres with full cron catalog visibility in postgres database';
  end if;
  -- Supabase owns this extension table; postgres has API access, not table locks.
  -- Serialize migration reruns without broadening the extension's privileges.
  perform pg_advisory_xact_lock(hashtextextended('netunim.retention_cron_jobs',0));
  if exists (
    select 1 from cron.job
    where (jobname like 'netunim-%retention%' or command ~* 'prune_(document_backups|sync_operation_ledgers)')
      and (jobname is null or jobname not in ('netunim-document-backup-retention-daily','netunim-sync-ledger-retention-weekly')
           or username <> 'postgres' or database <> 'postgres')
  ) or exists (
    select 1 from cron.job
    where jobname in ('netunim-document-backup-retention-daily','netunim-sync-ledger-retention-weekly')
    group by jobname having count(*) <> 1
  ) then
    raise exception 'Ambiguous retention jobs: review ownership/duplicates; no automatic cleanup performed';
  end if;
  for expected in select * from (values
    ('netunim-document-backup-retention-daily','43 3 * * *','select * from netunim_internal.prune_document_backups();'),
    ('netunim-sync-ledger-retention-weekly','17 3 * * 0','select * from netunim_internal.prune_sync_operation_ledgers();')
  ) as jobs(jobname,schedule,command) loop
    select * into existing from cron.job where jobname=expected.jobname;
    if not found then
      perform cron.schedule(expected.jobname,expected.schedule,expected.command);
    elsif existing.nodename <> 'localhost' or existing.nodeport <> inet_server_port() then
      raise exception 'Unexpected retention connection target for %', expected.jobname;
    elsif existing.schedule is distinct from expected.schedule
       or existing.command is distinct from expected.command or existing.active is distinct from true then
      perform cron.alter_job(existing.jobid, schedule := expected.schedule, command := expected.command, active := true);
    end if;
    if (select count(*) from cron.job where jobname=expected.jobname and schedule=expected.schedule
        and command=expected.command and active is true and username='postgres' and database='postgres'
        and nodename='localhost' and nodeport=inet_server_port()) <> 1 then
      raise exception 'Retention job contract failed for %',expected.jobname;
    end if;
  end loop;
  if (select count(*) from cron.job
      where jobname like 'netunim-%retention%' or command ~* 'prune_(document_backups|sync_operation_ledgers)') <> 2 then
    raise exception 'Retention catalog changed during migration; review unexpected jobs';
  end if;
end
$migration$;
