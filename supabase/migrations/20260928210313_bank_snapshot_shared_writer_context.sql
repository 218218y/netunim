-- A complete bank archive snapshot invokes bank_snapshot_check_reconcile.
-- That trigger may update shared_checks_documents in the same transaction.
-- The V6 RPC previously registered only Kupa, so accounts fenced for Shared
-- Checks received PT426 exactly when reconciliation changed a cheque.
-- Keep the two domains authorized only for this authenticated, lease-fenced
-- bank snapshot call. The trusted invocation records are removed before return.
begin;

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
  if p_lease_name is distinct from 'bank' then
    raise exception 'stale_finance_sync_fence' using errcode='PT409';
  end if;
  perform netunim_internal.assert_finance_sync_fence(p_lease_name,p_lease_token,p_fence_epoch);
  perform netunim_internal.enter_storage_writer_v2('kupa');
  perform netunim_internal.enter_storage_writer_v2('shared-checks');
  return query select * from netunim_internal.fenced_impl_sync_bank_transactions_snapshot(
    p_account_key,p_account_role,p_transactions,p_snapshot_at,p_coverage_from,p_coverage_to,p_complete);
  perform netunim_internal.leave_storage_writer_v2('shared-checks');
  perform netunim_internal.leave_storage_writer_v2('kupa');
end
$function$;

revoke all on function public.sync_bank_transactions_snapshot_v6(text,text,jsonb,timestamptz,date,date,boolean,text,text,bigint) from public, anon;
grant execute on function public.sync_bank_transactions_snapshot_v6(text,text,jsonb,timestamptz,date,date,boolean,text,text,bigint) to authenticated, service_role;

commit;
