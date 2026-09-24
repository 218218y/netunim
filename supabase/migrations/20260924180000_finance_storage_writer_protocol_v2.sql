-- Finance sync is part of Kupa's business state. The original Storage V2
-- fence covered Kupa documents but omitted finance_sync_documents, while the
-- bank snapshot RPC also updates Kupa. Give both finance writers explicit V2
-- entrypoints and keep the proven lease, audit, idempotency and bank watermark
-- implementations unchanged.
begin;

create trigger finance_sync_storage_protocol_guard
before insert or update on public.finance_sync_documents for each row
execute function netunim_internal.guard_storage_writer_protocol_v2('kupa');

-- Check the public legacy entrypoint too: an idempotent replay can return
-- without touching either guarded table and must still be rejected for a
-- fenced owner. A V6 wrapper has a protected invocation for this transaction.
create function netunim_internal.require_finance_storage_writer_v2()
returns void language plpgsql security definer
set search_path to 'pg_catalog', 'netunim_internal'
as $function$
declare v_owner uuid:=auth.uid();
begin
  if auth.role()='authenticated'
     and exists(select 1 from netunim_internal.storage_writer_protocol p
       where p.owner_id=v_owner and p.domain='kupa' and p.min_writer_protocol>=2)
     and not exists(select 1 from netunim_internal.storage_writer_invocations i
       where i.backend_pid=pg_backend_pid() and i.transaction_id=txid_current()
         and i.owner_id=v_owner and i.domain='kupa') then
    raise exception 'storage_protocol_upgrade_required' using errcode='PT426';
  end if;
end
$function$;
revoke all on function netunim_internal.require_finance_storage_writer_v2() from public, anon, authenticated;

-- Bank archive writes precede the atomic balance snapshot in the browser.
-- Fence these too, so an old tab cannot partially refresh the archive before
-- its final Kupa update is rejected.
create or replace function public.merge_bank_transactions(
  p_account_key text,p_account_role text,p_transactions jsonb,
  p_lease_name text default null,p_lease_token text default null,p_fence_epoch bigint default null)
returns table(inserted_count integer,updated_count integer,total_count integer)
language plpgsql security definer
set search_path to 'pg_catalog', 'public', 'netunim_internal'
as $function$
begin
  perform netunim_internal.require_finance_storage_writer_v2();
  if p_lease_name is distinct from 'bank' then raise exception 'stale_finance_sync_fence' using errcode='PT409';end if;
  perform netunim_internal.assert_finance_sync_fence(p_lease_name,p_lease_token,p_fence_epoch);
  return query select * from netunim_internal.fenced_impl_merge_bank_transactions(
    p_account_key,p_account_role,p_transactions);
end
$function$;

create or replace function public.sync_bank_transactions_snapshot(
  p_account_key text,p_account_role text,p_transactions jsonb,p_snapshot_at timestamptz,
  p_coverage_from date,p_coverage_to date,p_complete boolean,
  p_lease_name text default null,p_lease_token text default null,p_fence_epoch bigint default null)
returns table(inserted_count integer,updated_count integer,total_count integer,
  missing_count integer,active_missing_count integer,snapshot_stored boolean,baseline_created boolean)
language plpgsql security definer
set search_path to 'pg_catalog', 'public', 'netunim_internal'
as $function$
begin
  perform netunim_internal.require_finance_storage_writer_v2();
  if p_lease_name is distinct from 'bank' then raise exception 'stale_finance_sync_fence' using errcode='PT409';end if;
  perform netunim_internal.assert_finance_sync_fence(p_lease_name,p_lease_token,p_fence_epoch);
  return query select * from netunim_internal.fenced_impl_sync_bank_transactions_snapshot(
    p_account_key,p_account_role,p_transactions,p_snapshot_at,p_coverage_from,p_coverage_to,p_complete);
end
$function$;

create function public.merge_bank_transactions_v6(
  p_account_key text,p_account_role text,p_transactions jsonb,
  p_lease_name text default null,p_lease_token text default null,p_fence_epoch bigint default null)
returns table(inserted_count integer,updated_count integer,total_count integer)
language plpgsql security definer
set search_path to 'pg_catalog', 'public', 'netunim_internal'
as $function$
begin
  perform netunim_internal.enter_storage_writer_v2('kupa');
  return query select * from public.merge_bank_transactions(
    p_account_key,p_account_role,p_transactions,p_lease_name,p_lease_token,p_fence_epoch);
  perform netunim_internal.leave_storage_writer_v2('kupa');
end
$function$;
revoke all on function public.merge_bank_transactions_v6(text,text,jsonb,text,text,bigint) from public, anon;
grant execute on function public.merge_bank_transactions_v6(text,text,jsonb,text,text,bigint) to authenticated, service_role;

create function public.sync_bank_transactions_snapshot_v6(
  p_account_key text,p_account_role text,p_transactions jsonb,p_snapshot_at timestamptz,
  p_coverage_from date,p_coverage_to date,p_complete boolean,
  p_lease_name text default null,p_lease_token text default null,p_fence_epoch bigint default null)
returns table(inserted_count integer,updated_count integer,total_count integer,
  missing_count integer,active_missing_count integer,snapshot_stored boolean,baseline_created boolean)
language plpgsql security definer
set search_path to 'pg_catalog', 'public', 'netunim_internal'
as $function$
begin
  perform netunim_internal.enter_storage_writer_v2('kupa');
  return query select * from public.sync_bank_transactions_snapshot(
    p_account_key,p_account_role,p_transactions,p_snapshot_at,p_coverage_from,p_coverage_to,p_complete,
    p_lease_name,p_lease_token,p_fence_epoch);
  perform netunim_internal.leave_storage_writer_v2('kupa');
end
$function$;
revoke all on function public.sync_bank_transactions_snapshot_v6(text,text,jsonb,timestamptz,date,date,boolean,text,text,bigint) from public, anon;
grant execute on function public.sync_bank_transactions_snapshot_v6(text,text,jsonb,timestamptz,date,date,boolean,text,text,bigint) to authenticated, service_role;

create or replace function public.save_bank_sync_snapshot(
  p_document_name text,p_bank_state jsonb,p_snapshot_token text,p_snapshot_seq bigint,
  p_lease_name text default null,p_lease_token text default null,p_fence_epoch bigint default null)
returns table(finance_revision bigint,kupa_revision bigint,updated_at timestamptz)
language plpgsql security definer
set search_path to 'pg_catalog', 'public', 'netunim_internal'
as $function$
begin
  perform netunim_internal.require_finance_storage_writer_v2();
  if p_lease_name is distinct from 'bank' then raise exception 'stale_finance_sync_fence' using errcode='PT409';end if;
  perform netunim_internal.assert_finance_sync_fence(p_lease_name,p_lease_token,p_fence_epoch);
  return query select * from netunim_internal.fenced_impl_save_bank_sync_snapshot(
    p_document_name,p_bank_state,p_snapshot_token,p_snapshot_seq);
end
$function$;

create or replace function public.save_finance_sync_document_v5(
  p_document_name text,p_expected_revision bigint,p_state jsonb,p_operation_id text,p_audit jsonb,
  p_lease_name text default null,p_lease_token text default null,p_fence_epoch bigint default null)
returns table(revision bigint,updated_at timestamptz,state jsonb,operation_replayed boolean,operation_revision bigint)
language plpgsql security definer
set search_path to 'pg_catalog', 'public', 'netunim_internal'
as $function$
begin
  perform netunim_internal.require_finance_storage_writer_v2();
  perform netunim_internal.assert_finance_sync_fence(p_lease_name,p_lease_token,p_fence_epoch);
  return query select * from netunim_internal.fenced_impl_save_finance_sync_document_v5(
    p_document_name,p_expected_revision,p_state,p_operation_id,p_audit);
end
$function$;

create function public.save_bank_sync_snapshot_v6(
  p_document_name text,
  p_bank_state jsonb,
  p_snapshot_token text,
  p_snapshot_seq bigint,
  p_lease_name text default null,
  p_lease_token text default null,
  p_fence_epoch bigint default null)
returns table(finance_revision bigint,kupa_revision bigint,updated_at timestamptz)
language plpgsql security definer
set search_path to 'pg_catalog', 'public', 'netunim_internal'
as $function$
begin
  perform netunim_internal.enter_storage_writer_v2('kupa');
  return query select * from public.save_bank_sync_snapshot(
    p_document_name,p_bank_state,p_snapshot_token,p_snapshot_seq,
    p_lease_name,p_lease_token,p_fence_epoch);
  perform netunim_internal.leave_storage_writer_v2('kupa');
end
$function$;
revoke all on function public.save_bank_sync_snapshot_v6(text,jsonb,text,bigint,text,text,bigint) from public, anon;
grant execute on function public.save_bank_sync_snapshot_v6(text,jsonb,text,bigint,text,text,bigint) to authenticated, service_role;

create function public.save_finance_sync_document_v6(
  p_document_name text,
  p_expected_revision bigint,
  p_state jsonb,
  p_operation_id text,
  p_audit jsonb,
  p_lease_name text default null,
  p_lease_token text default null,
  p_fence_epoch bigint default null)
returns table(revision bigint,updated_at timestamptz,state jsonb,operation_replayed boolean,operation_revision bigint)
language plpgsql security definer
set search_path to 'pg_catalog', 'public', 'netunim_internal'
as $function$
begin
  perform netunim_internal.enter_storage_writer_v2('kupa');
  return query select * from public.save_finance_sync_document_v5(
    p_document_name,p_expected_revision,p_state,p_operation_id,p_audit,
    p_lease_name,p_lease_token,p_fence_epoch);
  perform netunim_internal.leave_storage_writer_v2('kupa');
end
$function$;
revoke all on function public.save_finance_sync_document_v6(text,bigint,jsonb,text,jsonb,text,text,bigint) from public, anon;
grant execute on function public.save_finance_sync_document_v6(text,bigint,jsonb,text,jsonb,text,text,bigint) to authenticated, service_role;

create or replace function public.get_netunim_sync_capabilities()
returns jsonb language sql stable security invoker
set search_path to 'pg_catalog', 'public', 'netunim_internal'
as $function$
 select jsonb_build_object(
 'documentOperationLedger',case when to_regclass('netunim_internal.document_sync_operations') is not null then 3 else 0 end,
 'syncIntegrity',case when to_regprocedure('netunim_internal.document_invariant_guard()') is not null then 5 else 0 end,
 'deleteIntents',case when (select count(*) from pg_trigger where tgname in ('order_management_delete_intent_guard','kupa_delete_intent_guard','shared_checks_delete_intent_guard') and tgenabled<>'D')=3 then 4 else 0 end,
 'massDeleteGuard',case when (select count(*) from pg_trigger where tgname in ('order_management_mass_destructive_guard','kupa_mass_destructive_guard','shared_checks_mass_destructive_guard') and tgenabled<>'D')=3 then 5 else 0 end,
 'restoreGroups',case when to_regclass('netunim_internal.restore_operation_groups') is not null and to_regprocedure('public.apply_restore_group_v5(uuid)') is not null then 5 else 0 end,
 'sharedChecksIntegrity',case when to_regprocedure('public.save_shared_checks_document_v5(text,bigint,jsonb,text,jsonb,jsonb)') is not null then 5 else 0 end,
 'financeFencing',case when to_regprocedure('public.save_bank_sync_snapshot_v6(text,jsonb,text,bigint,text,text,bigint)') is not null
   and to_regprocedure('public.save_finance_sync_document_v6(text,bigint,jsonb,text,jsonb,text,text,bigint)') is not null
   and to_regprocedure('public.merge_bank_transactions_v6(text,text,jsonb,text,text,bigint)') is not null
   and to_regprocedure('public.sync_bank_transactions_snapshot_v6(text,text,jsonb,timestamptz,date,date,boolean,text,text,bigint)') is not null
   and exists(select 1 from pg_trigger where tgname='finance_sync_storage_protocol_guard' and tgenabled<>'D')
   then 2 else 0 end,
 'storageWriterProtocol',case when to_regclass('netunim_internal.storage_writer_protocol') is not null
   and to_regprocedure('public.save_order_management_document_v6(text,bigint,jsonb,text,jsonb,jsonb)') is not null
   and to_regprocedure('public.save_kupa_document_v6(text,bigint,jsonb,text,jsonb,jsonb)') is not null
   and to_regprocedure('public.save_shared_checks_document_v6(text,bigint,jsonb,text,jsonb,jsonb)') is not null
   and to_regprocedure('public.apply_restore_group_v6(uuid)') is not null
   and to_regprocedure('public.stage_restore_group_v6(uuid,text,text,bigint,jsonb,jsonb,text,bigint,jsonb,jsonb,text,text,jsonb)') is not null
   and (select count(*) from pg_trigger where tgname in ('order_management_storage_protocol_guard','kupa_storage_protocol_guard','shared_checks_storage_protocol_guard','restore_group_storage_protocol_guard') and tgenabled<>'D')=4
   then 2 else 0 end);
$function$;

commit;
