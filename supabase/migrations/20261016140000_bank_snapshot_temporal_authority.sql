begin;
-- Keep the lease/operation fence first and reject before entering any business
-- implementation. The server clock is authoritative even if every client clock
-- agrees on a far-future observation. Infinities cannot be observations either.
create or replace function public.sync_bank_transactions_snapshot_v6(
  p_account_key text,p_account_role text,p_transactions jsonb,p_snapshot_at timestamptz,
  p_coverage_from date,p_coverage_to date,p_complete boolean,
  p_lease_name text default null,p_lease_token text default null,p_fence_epoch bigint default null)
returns table(inserted_count integer,updated_count integer,total_count integer,
  missing_count integer,active_missing_count integer,snapshot_stored boolean,baseline_created boolean)
language plpgsql security definer
set search_path to 'pg_catalog', 'public', 'netunim_internal'
as $function$
begin
  perform netunim_internal.assert_storage_writer_operation_fence_v2('bank-archive-snapshot',p_lease_name,p_lease_token,p_fence_epoch);
  if p_snapshot_at is null or not isfinite(p_snapshot_at)
    or p_snapshot_at > clock_timestamp() + interval '5 minutes' then
    raise exception 'invalid_bank_snapshot_time' using errcode='22023';
  end if;
  perform netunim_internal.assert_bank_transaction_evidence(p_transactions);
  perform netunim_internal.enter_storage_writer_operation_v2('bank-archive-snapshot');
  return query select * from netunim_internal.fenced_impl_sync_bank_transactions_snapshot(
    p_account_key,p_account_role,p_transactions,p_snapshot_at,p_coverage_from,p_coverage_to,p_complete);
  perform netunim_internal.leave_storage_writer_operation_v2('bank-archive-snapshot');
end
$function$;
commit;
