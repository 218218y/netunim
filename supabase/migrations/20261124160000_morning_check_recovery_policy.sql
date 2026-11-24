-- Registration recovery runs only against verified, frozen server intent.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.morning_document_operations
  add column checks_registration_failure_kind text,
  add column checks_registration_first_failed_at timestamptz,
  add column checks_registration_last_failed_at timestamptz,
  add column checks_registration_last_manual_at timestamptz;

create or replace function netunim_internal.record_morning_check_failure(p_operation uuid,p_error text,p_code text)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  attempted_at timestamptz := clock_timestamp();
  failure_kind text := case
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
    checks_registration_next_retry_at=case
      when failure_kind='contention' then attempted_at+interval '1 minute'
      when failure_kind in ('authorization','invalid_data') or m.checks_registration_attempts>=4 then null
      else attempted_at+interval '1 minute' * (1 << least(m.checks_registration_attempts,4)) end,
    updated_at=attempted_at
    where m.operation_id=p_operation and m.checks_registered_at is null;
end $$;

create function netunim_internal.attempt_morning_check_registration(p_operation uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  perform netunim_internal.register_morning_checks(p_operation);
  update public.morning_document_operations set checks_registration_failure_kind=null
    where operation_id=p_operation and checks_registered_at is not null and checks_registration_failure_kind is not null;
exception when others then
  -- The failed subtransaction rolls back both the write and its dedupe rows.
  perform netunim_internal.record_morning_check_failure(p_operation,sqlerrm,sqlstate);
end $$;

create or replace function netunim_internal.complete_morning_checks()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.state='created' and new.verified_at is not null and new.check_intent is not null
    and new.checks_registered_at is null and new.check_payment_evidence='matched'
    and (tg_op='INSERT' or old.state is distinct from new.state or old.verified_at is null
      or old.check_payment_evidence is distinct from new.check_payment_evidence) then
    perform netunim_internal.attempt_morning_check_registration(new.operation_id);
  end if;
  return new;
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
end $$;

-- Only the authenticated, MFA-assured Edge handler can request this continuation.
-- The identifiers select an existing owner/environment-bound operation. There is no input for check data.
create function public.retry_verified_morning_checks(p_owner_id uuid,p_environment text,p_operation_id uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  perform 1 from public.morning_document_operations m
    where m.owner_id=p_owner_id and m.environment=p_environment and m.operation_id=p_operation_id
      and m.state='created' and m.verified_at is not null and m.document_id is not null
      and m.check_intent is not null and m.checks_registered_at is null and m.check_payment_evidence='matched'
      and (m.checks_registration_last_manual_at is null or m.checks_registration_last_manual_at<=now()-interval '30 seconds')
    for update skip locked;
  if not found then return false; end if;
  update public.morning_document_operations set checks_registration_last_manual_at=clock_timestamp()
    where operation_id=p_operation_id;
  perform netunim_internal.attempt_morning_check_registration(p_operation_id);
  return true;
end $$;

revoke all on function netunim_internal.attempt_morning_check_registration(uuid) from public,anon,authenticated,service_role;
revoke all on function public.retry_verified_morning_checks(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.retry_verified_morning_checks(uuid,text,uuid) to service_role;
commit;
