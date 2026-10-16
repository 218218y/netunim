-- Validate the entire batch before any merge, snapshot, or absence reconciliation.
-- Existing immutable migrations and the monotonic pending-to-completed rule remain intact.
begin;
create function netunim_internal.assert_bank_transaction_statuses(p_transactions jsonb)
returns void language plpgsql set search_path = pg_catalog as $function$
begin
  if jsonb_typeof(p_transactions) is distinct from 'array' then
    raise exception 'invalid_bank_transactions' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_transactions) tx
    where jsonb_typeof(tx) is distinct from 'object'
      or jsonb_typeof(tx->'status') is distinct from 'string'
      or (tx->>'status') not in ('pending','completed')) then
    raise exception 'invalid_bank_transaction_status' using errcode='22023';
  end if;
end
$function$;
revoke all on function netunim_internal.assert_bank_transaction_statuses(jsonb) from public, anon, authenticated;
create or replace function public.merge_bank_transactions_v6(
  p_account_key text,p_account_role text,p_transactions jsonb,
  p_lease_name text default null,p_lease_token text default null,p_fence_epoch bigint default null)
returns table(inserted_count integer,updated_count integer,total_count integer)
language plpgsql security definer
set search_path to 'pg_catalog', 'public', 'netunim_internal'
as $function$
begin
  perform netunim_internal.assert_storage_writer_operation_fence_v2('bank-merge',p_lease_name,p_lease_token,p_fence_epoch);
  perform netunim_internal.assert_bank_transaction_statuses(p_transactions);
  perform netunim_internal.enter_storage_writer_operation_v2('bank-merge');
  return query select * from netunim_internal.fenced_impl_merge_bank_transactions(p_account_key,p_account_role,p_transactions);
  perform netunim_internal.leave_storage_writer_operation_v2('bank-merge');
end
$function$;

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
  perform netunim_internal.assert_bank_transaction_statuses(p_transactions);
  perform netunim_internal.enter_storage_writer_operation_v2('bank-archive-snapshot');
  return query select * from netunim_internal.fenced_impl_sync_bank_transactions_snapshot(
    p_account_key,p_account_role,p_transactions,p_snapshot_at,p_coverage_from,p_coverage_to,p_complete);
  perform netunim_internal.leave_storage_writer_operation_v2('bank-archive-snapshot');
end
$function$;


commit;
