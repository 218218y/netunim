begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table netunim_internal.check_bank_refresh_state
  add column last_outcome text,
  add column last_matched_at timestamptz;

create or replace function netunim_internal.run_check_bank_refresh_queue()
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare work record; outcome jsonb; failure text; attempted_at timestamptz;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('netunim:check-bank-refresh',0)) then return; end if;
  for work in select owner_id,requested_at from netunim_internal.check_bank_refresh_state
    where requested_at<clock_timestamp()-interval '3 seconds'
      and (failure_kind is null or next_retry_at<=clock_timestamp())
    order by coalesce(pending_since,requested_at),owner_id limit 50
  loop
    begin
      attempted_at:=clock_timestamp();
      -- The interactive matcher requeues on contention. The existing queue
      -- already owns this item, so preserve its timestamps and failure streak.
      if not pg_try_advisory_xact_lock(hashtextextended('netunim_financial_write:'||work.owner_id::text,0)) then
        update netunim_internal.check_bank_refresh_state set
          first_failed_at=coalesce(first_failed_at,attempted_at),last_failed_at=attempted_at,
          failure_kind=case when failure_kind is null then 'contention' else failure_kind end,
          next_retry_at=attempted_at+interval '1 minute'
          where owner_id=work.owner_id and requested_at=work.requested_at;
        continue;
      end if;
      outcome:=netunim_internal.refresh_check_bank_matches(work.owner_id);
      if outcome->>'status'='no_checks' then
        update netunim_internal.check_bank_refresh_state set requested_at=null,error=null
          where owner_id=work.owner_id and requested_at=work.requested_at;
      end if;
      update netunim_internal.check_bank_refresh_state
        set last_outcome=outcome->>'status',
          last_matched_at=case when (outcome->>'changed')::integer>0 then attempted_at else last_matched_at end
        where owner_id=work.owner_id and (requested_at is null or requested_at=work.requested_at);
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

create or replace function public.financial_background_health_v1(p_owner uuid,p_morning_environment text)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
  with heartbeat as (
    select h.name,h.last_run_at,
      case when not exists(select 1 from cron.job j where j.jobname=h.name and j.active)
        or coalesce(h.last_run_at,h.enabled_at)<statement_timestamp()-interval '5 minutes' then 'job_unavailable'
        when h.last_run_at is null then 'checking' else 'healthy' end as state
    from netunim_internal.financial_job_health h
  ), bank as (
    select * from netunim_internal.check_bank_refresh_state where owner_id=p_owner
  ), bank_snapshots as (
    select max(s.snapshot_at) latest_snapshot,
      count(*) filter(where s.snapshot_at>statement_timestamp()+interval '5 minutes') future_snapshots
    from public.bank_transaction_snapshots s where s.owner_id=p_owner
  ), bank_source as (
    select latest_snapshot,
      case when future_snapshots>0 then 'unknown'
        when latest_snapshot is null and (
          exists(select 1 from netunim_internal.bank_sync_operations o where o.owner_id=p_owner) or
          exists(select 1 from public.bank_transactions t where t.owner_id=p_owner))
          then 'missing'
        when latest_snapshot is null then 'no_history'
        when latest_snapshot<statement_timestamp()-interval '72 hours' then 'stale'
        else 'fresh' end as state
    from bank_snapshots
  ), morning as (
    select count(*) filter(where m.checks_registered_at is null and m.check_payment_evidence='matched') as pending,
      min(m.verified_at) filter(where m.checks_registered_at is null and m.check_payment_evidence='matched') as oldest_at,
      min(m.checks_registration_next_retry_at) filter(where m.checks_registered_at is null and m.check_payment_evidence='matched') as next_retry_at,
      max(m.checks_registered_at) as progressed_at,
      count(*) filter(where m.checks_registered_at is null and m.check_payment_evidence is distinct from 'matched') as unverified_payment,
      count(*) filter(where m.checks_registered_at is null and m.check_payment_evidence='matched'
        and m.checks_registration_failure_kind is not null and m.checks_registration_next_retry_at is null) as stopped,
      bool_or(m.checks_registered_at is null and m.check_payment_evidence='matched'
        and coalesce(m.checks_registration_next_retry_at,m.verified_at)<statement_timestamp()-interval '5 minutes') as delayed
    from public.morning_document_operations m
    where m.owner_id=p_owner and m.environment=p_morning_environment and m.state='created' and m.check_intent is not null
  )
  select jsonb_build_object(
    'bank', (select jsonb_build_object(
      'state',case when h.state='job_unavailable' then h.state
        when b.requested_at is not null and b.failure_kind is not null and b.next_retry_at is null then 'stopped'
        when b.pending_since<statement_timestamp()-interval '5 minutes' then 'delayed'
        when b.failure_kind is not null then 'retrying' else h.state end,
      'pending',case when b.requested_at is not null then 1 else 0 end,'oldest_at',b.pending_since,
      'run_state',h.state,'last_run_at',h.last_run_at,'progressed_at',b.checked_at,
      'source_state',s.state,'source_at',s.latest_snapshot,'last_outcome',b.last_outcome,'business_progressed_at',b.last_matched_at,
      'next_retry_at',b.next_retry_at,'first_failed_at',b.first_failed_at,'last_failed_at',b.last_failed_at,
      'attempts',coalesce(b.consecutive_failures,0),'failure_kind',b.failure_kind)
      from heartbeat h left join bank b on true cross join bank_source s where h.name='check-bank-refresh'),
    'morning',(select jsonb_build_object(
      'state',case when h.state='job_unavailable' then h.state
        when m.stopped>0 then 'stopped' when m.delayed then 'delayed' else h.state end,
      'pending',m.pending,'oldest_at',m.oldest_at,'run_state',h.state,'last_run_at',h.last_run_at,
      'progressed_at',m.progressed_at,'next_retry_at',m.next_retry_at,'missing_payment_evidence',m.unverified_payment)
      from heartbeat h cross join morning m where h.name='morning-check-registration'))
$$;
commit;
