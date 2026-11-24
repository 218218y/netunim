begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table netunim_internal.financial_job_health (
  name text primary key,
  enabled_at timestamptz not null default clock_timestamp(),
  last_run_at timestamptz
);
insert into netunim_internal.financial_job_health(name)
  values ('check-bank-refresh'),('morning-check-registration');
alter table netunim_internal.financial_job_health enable row level security;
revoke all on netunim_internal.financial_job_health from public,anon,authenticated,service_role;

alter table netunim_internal.check_bank_refresh_state
  add column pending_since timestamptz,
  add column first_failed_at timestamptz,
  add column last_failed_at timestamptz,
  add column next_retry_at timestamptz,
  add column consecutive_failures integer not null default 0,
  add column failure_kind text;
update netunim_internal.check_bank_refresh_state set pending_since=requested_at where requested_at is not null;

create function netunim_internal.track_check_bank_pending()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin
  if new.requested_at is null then
    new.pending_since:=null;
    new.first_failed_at:=null;
    new.last_failed_at:=null;
    new.next_retry_at:=null;
    new.consecutive_failures:=0;
    new.failure_kind:=null;
  elsif tg_op='INSERT' then
    new.pending_since:=new.requested_at;
  else
    new.pending_since:=coalesce(old.pending_since,new.requested_at);
    if new.requested_at is distinct from old.requested_at then
      -- A new input or an explicit write attempt can re-open a stopped item.
      new.next_retry_at:=null;
      new.consecutive_failures:=0;
      new.failure_kind:=null;
    end if;
  end if;
  return new;
end $$;
create trigger track_check_bank_pending before insert or update of requested_at
  on netunim_internal.check_bank_refresh_state for each row execute function netunim_internal.track_check_bank_pending();

create or replace function netunim_internal.run_check_bank_refresh_queue()
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare work record; outcome text; failure text; attempted_at timestamptz;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('netunim:check-bank-refresh',0)) then return; end if;
  for work in select owner_id,requested_at from netunim_internal.check_bank_refresh_state
    where requested_at<clock_timestamp()-interval '3 seconds'
      and (failure_kind is null or next_retry_at<=clock_timestamp())
    order by coalesce(pending_since,requested_at),owner_id limit 50
  loop
    begin
      outcome:=netunim_internal.refresh_check_bank_matches(work.owner_id)->>'status';
      if outcome='no_checks' then
        update netunim_internal.check_bank_refresh_state set requested_at=null,error=null
          where owner_id=work.owner_id and requested_at=work.requested_at;
      end if;
    exception when others then
      attempted_at:=clock_timestamp();
      failure:=case
        when sqlstate in ('PT429','40001','40P01','55P03') or left(sqlstate,2)='08' then 'transient'
        when sqlstate in ('42501','PT401','PT403') or sqlerrm='mfa_required' then 'authorization'
        when left(sqlstate,2) in ('22','23') or sqlstate='PT422' then 'invalid_data'
        else 'unexpected' end;
      update netunim_internal.check_bank_refresh_state set
        error=case when sqlerrm='mfa_required' then 'mfa_required' else sqlstate end,
        first_failed_at=coalesce(first_failed_at,attempted_at),last_failed_at=attempted_at,
        failure_kind=failure,consecutive_failures=consecutive_failures+1,
        next_retry_at=case when failure in ('authorization','invalid_data') or consecutive_failures>=4 then null
          else attempted_at+interval '1 minute'*(1 << least(consecutive_failures,4)) end
        where owner_id=work.owner_id and requested_at=work.requested_at;
    end;
  end loop;
  update netunim_internal.financial_job_health set last_run_at=clock_timestamp() where name='check-bank-refresh';
end $$;

create or replace function netunim_internal.retry_morning_check_registrations()
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare op record;
begin
  for op in select m.operation_id from public.morning_document_operations m
    where m.state='created' and m.verified_at is not null and m.document_id is not null
      and m.check_intent is not null and m.checks_registered_at is null and m.check_payment_evidence='matched'
      and ((m.checks_registration_next_retry_at is null and m.checks_registration_failure_kind is null)
        or m.checks_registration_next_retry_at<=now()
        or (m.checks_registration_failure_kind is null and m.checks_registration_error='mfa_required'))
      and exists(select 1 from auth.users u where u.id=m.owner_id)
    order by m.updated_at,m.operation_id limit 50 for update of m skip locked
  loop
    perform netunim_internal.attempt_morning_check_registration(op.operation_id);
  end loop;
  update netunim_internal.financial_job_health set last_run_at=clock_timestamp() where name='morning-check-registration';
end $$;

alter table public.morning_document_operations
  add column checks_registration_failure_streak integer not null default 0;
update public.morning_document_operations set checks_registration_failure_streak=least(checks_registration_attempts,5)
  where checks_registration_error is not null and checks_registration_failure_kind is not null
    and checks_registered_at is null;

create or replace function netunim_internal.record_morning_check_failure(p_operation uuid,p_error text,p_code text)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  attempted_at timestamptz:=clock_timestamp();
  failure_kind text:=case
    when p_code='PT429' and p_error='save_busy' then 'contention'
    when p_code in ('PT429','40001','40P01','55P03') or left(p_code,2)='08' then 'transient'
    when p_error='mfa_required' or p_code in ('42501','PT401','PT403') then 'authorization'
    when p_error='invalid_morning_check_intent' or left(p_code,2) in ('22','23') or p_code='PT422' then 'invalid_data'
    else 'unexpected' end;
begin
  update public.morning_document_operations m set
    checks_registration_error=case when p_error in ('save_busy','mfa_required','invalid_morning_check_intent') then p_error else p_code end,
    checks_registration_failure_kind=failure_kind,
    checks_registration_first_failed_at=coalesce(m.checks_registration_first_failed_at,attempted_at),
    checks_registration_last_failed_at=attempted_at,
    checks_registration_attempts=m.checks_registration_attempts+case when failure_kind='contention' then 0 else 1 end,
    checks_registration_failure_streak=m.checks_registration_failure_streak+case when failure_kind='contention' then 0 else 1 end,
    checks_registration_next_retry_at=case
      when failure_kind='contention' then attempted_at+interval '1 minute'
      when failure_kind in ('authorization','invalid_data') or m.checks_registration_failure_streak>=4 then null
      else attempted_at+interval '1 minute'*(1 << least(m.checks_registration_failure_streak,4)) end,
    updated_at=attempted_at
    where m.operation_id=p_operation and m.checks_registered_at is null;
end $$;

create function public.financial_background_health_v1(p_owner uuid,p_morning_environment text)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
  with heartbeat as (
    select h.name,h.last_run_at,
      case when not exists(select 1 from cron.job j where j.jobname=h.name and j.active)
        or coalesce(h.last_run_at,h.enabled_at)<statement_timestamp()-interval '5 minutes' then 'job_unavailable'
        when h.last_run_at is null then 'checking' else 'healthy' end as state
    from netunim_internal.financial_job_health h
  ), bank as (
    select * from netunim_internal.check_bank_refresh_state where owner_id=p_owner
  ), morning as (
    select count(*) filter(where m.checks_registered_at is null) as pending,
      min(m.verified_at) filter(where m.checks_registered_at is null) as oldest_at,
      min(m.checks_registration_next_retry_at) filter(where m.checks_registered_at is null) as next_retry_at,
      max(m.checks_registered_at) as progressed_at,
      count(*) filter(where m.checks_registered_at is null and m.checks_registration_failure_kind is not null
        and m.checks_registration_next_retry_at is null) as stopped,
      bool_or(m.checks_registered_at is null
        and coalesce(m.checks_registration_next_retry_at,m.verified_at)<statement_timestamp()-interval '5 minutes') as delayed
    from public.morning_document_operations m
    where m.owner_id=p_owner and m.environment=p_morning_environment and m.state='created'
      and m.check_payment_evidence='matched' and m.check_intent is not null
  )
  select jsonb_build_object(
    'bank', (select jsonb_build_object(
      'state',case when h.state='job_unavailable' then h.state
        when b.requested_at is not null and b.failure_kind is not null and b.next_retry_at is null then 'stopped'
        when b.pending_since<statement_timestamp()-interval '5 minutes' then 'delayed'
        when b.failure_kind is not null then 'retrying' else h.state end,
      'pending',case when b.requested_at is not null then 1 else 0 end,'oldest_at',b.pending_since,
      'last_run_at',h.last_run_at,'progressed_at',b.checked_at,'next_retry_at',b.next_retry_at,
      'first_failed_at',b.first_failed_at,'last_failed_at',b.last_failed_at,
      'attempts',coalesce(b.consecutive_failures,0),'failure_kind',b.failure_kind)
      from heartbeat h left join bank b on true where h.name='check-bank-refresh'),
    'morning',(select jsonb_build_object(
      'state',case when h.state='job_unavailable' then h.state
        when m.stopped>0 then 'stopped' when m.delayed then 'delayed' else h.state end,
      'pending',m.pending,'oldest_at',m.oldest_at,'last_run_at',h.last_run_at,
      'progressed_at',m.progressed_at,'next_retry_at',m.next_retry_at)
      from heartbeat h cross join morning m where h.name='morning-check-registration'))
$$;

revoke all on function netunim_internal.track_check_bank_pending() from public,anon,authenticated,service_role;
revoke all on function public.financial_background_health_v1(uuid,text) from public,anon,authenticated;
grant execute on function public.financial_background_health_v1(uuid,text) to service_role;
commit;
