-- Keep the proven document implementations and their OIDs. Move them behind
-- the internal API; the old public names become compatibility entrypoints.
-- No document rows or protocol markers change in this migration.
begin;

alter function public.save_order_management_document_v5(text,bigint,jsonb,text,jsonb,jsonb) set schema netunim_internal;
alter function netunim_internal.save_order_management_document_v5(text,bigint,jsonb,text,jsonb,jsonb) rename to save_order_management_document_current;
alter function public.save_kupa_document_v5(text,bigint,jsonb,text,jsonb,jsonb) set schema netunim_internal;
alter function netunim_internal.save_kupa_document_v5(text,bigint,jsonb,text,jsonb,jsonb) rename to save_kupa_document_current;
alter function public.save_shared_checks_document_v5(text,bigint,jsonb,text,jsonb,jsonb) set schema netunim_internal;
alter function netunim_internal.save_shared_checks_document_v5(text,bigint,jsonb,text,jsonb,jsonb) rename to save_shared_checks_document_current;
alter function public.save_order_management_document_v4(text,bigint,jsonb,text,jsonb) set schema netunim_internal;
alter function netunim_internal.save_order_management_document_v4(text,bigint,jsonb,text,jsonb) rename to save_order_management_document_core;
alter function public.save_kupa_document_v4(text,bigint,jsonb,text,jsonb) set schema netunim_internal;
alter function netunim_internal.save_kupa_document_v4(text,bigint,jsonb,text,jsonb) rename to save_kupa_document_core;
alter function public.save_shared_checks_document_v4(text,bigint,jsonb,text,jsonb) set schema netunim_internal;
alter function netunim_internal.save_shared_checks_document_v4(text,bigint,jsonb,text,jsonb) rename to save_shared_checks_document_core;
alter function public.stage_restore_group_v5(uuid,text,text,bigint,jsonb,jsonb,text,bigint,jsonb,jsonb,text,text,jsonb) set schema netunim_internal;
alter function netunim_internal.stage_restore_group_v5(uuid,text,text,bigint,jsonb,jsonb,text,bigint,jsonb,jsonb,text,text,jsonb) rename to stage_restore_group_current;
alter function public.save_finance_sync_document_v3(text,bigint,jsonb,text) set schema netunim_internal;
alter function netunim_internal.save_finance_sync_document_v3(text,bigint,jsonb,text) rename to save_finance_sync_document_current;

revoke all on function netunim_internal.save_order_management_document_current(text,bigint,jsonb,text,jsonb,jsonb) from public, anon, authenticated;
revoke all on function netunim_internal.save_kupa_document_current(text,bigint,jsonb,text,jsonb,jsonb) from public, anon, authenticated;
revoke all on function netunim_internal.save_shared_checks_document_current(text,bigint,jsonb,text,jsonb,jsonb) from public, anon, authenticated;
revoke all on function netunim_internal.save_order_management_document_core(text,bigint,jsonb,text,jsonb) from public, anon, authenticated;
revoke all on function netunim_internal.save_kupa_document_core(text,bigint,jsonb,text,jsonb) from public, anon, authenticated;
revoke all on function netunim_internal.save_shared_checks_document_core(text,bigint,jsonb,text,jsonb) from public, anon, authenticated;
revoke all on function netunim_internal.stage_restore_group_current(uuid,text,text,bigint,jsonb,jsonb,text,bigint,jsonb,jsonb,text,text,jsonb) from public, anon, authenticated;
revoke all on function netunim_internal.save_finance_sync_document_current(text,bigint,jsonb,text) from public, anon, authenticated;

create function netunim_internal.require_legacy_storage_writer(p_domain text)
returns void language plpgsql security definer
set search_path to 'pg_catalog', 'netunim_internal'
as $function$
begin
  if auth.role()='authenticated' and exists(
    select 1 from netunim_internal.storage_writer_protocol p
    where p.owner_id=auth.uid() and p.domain=p_domain and p.min_writer_protocol>=2
  ) then
    raise exception 'storage_protocol_upgrade_required' using errcode='PT426';
  end if;
end
$function$;
revoke all on function netunim_internal.require_legacy_storage_writer(text) from public, anon, authenticated;

create function public.save_order_management_document_v5(
  p_document_name text,p_expected_revision bigint,p_state jsonb,p_operation_id text,p_delete_intents jsonb,p_audit jsonb)
returns table(revision bigint,updated_at timestamptz,state jsonb,operation_replayed boolean,operation_revision bigint)
language plpgsql security definer
set search_path to 'pg_catalog', 'public', 'netunim_internal'
as $function$
begin
  perform netunim_internal.require_legacy_storage_writer('orders');
  return query select * from netunim_internal.save_order_management_document_current(p_document_name,p_expected_revision,p_state,p_operation_id,p_delete_intents,p_audit);
end
$function$;
create function public.save_kupa_document_v5(
  p_document_name text,p_expected_revision bigint,p_state jsonb,p_operation_id text,p_delete_intents jsonb,p_audit jsonb)
returns table(revision bigint,updated_at timestamptz,state jsonb,operation_replayed boolean,operation_revision bigint)
language plpgsql security definer
set search_path to 'pg_catalog', 'public', 'netunim_internal'
as $function$
begin
  perform netunim_internal.require_legacy_storage_writer('kupa');
  return query select * from netunim_internal.save_kupa_document_current(p_document_name,p_expected_revision,p_state,p_operation_id,p_delete_intents,p_audit);
end
$function$;
create function public.save_shared_checks_document_v5(
  p_document_name text,p_expected_revision bigint,p_state jsonb,p_operation_id text,p_deleted_check_ids jsonb,p_audit jsonb)
returns table(revision bigint,updated_at timestamptz,state jsonb,operation_replayed boolean,operation_revision bigint)
language plpgsql security definer
set search_path to 'pg_catalog', 'public', 'netunim_internal'
as $function$
begin
  perform netunim_internal.require_legacy_storage_writer('shared-checks');
  return query select * from netunim_internal.save_shared_checks_document_current(p_document_name,p_expected_revision,p_state,p_operation_id,p_deleted_check_ids,p_audit);
end
$function$;
create function public.stage_restore_group_v5(
  p_restore_group_id uuid,p_app_site text,p_main_document_name text,p_main_base_revision bigint,
  p_main_state jsonb,p_main_delete_intents jsonb,p_checks_document_name text,p_checks_base_revision bigint,
  p_checks_state jsonb,p_checks_delete_ids jsonb,p_main_operation_id text,p_checks_operation_id text,p_audit jsonb)
returns table(restore_group_id uuid,phase text)
language plpgsql security definer
set search_path to 'pg_catalog', 'public', 'netunim_internal'
as $function$
begin
  perform netunim_internal.require_legacy_storage_writer(p_app_site);
  return query select * from netunim_internal.stage_restore_group_current(
    p_restore_group_id,p_app_site,p_main_document_name,p_main_base_revision,
    p_main_state,p_main_delete_intents,p_checks_document_name,p_checks_base_revision,
    p_checks_state,p_checks_delete_ids,p_main_operation_id,p_checks_operation_id,p_audit);
end
$function$;
create function public.save_finance_sync_document_v3(
  p_document_name text,p_expected_revision bigint,p_state jsonb,p_operation_id text)
returns table(revision bigint,updated_at timestamptz,state jsonb,operation_replayed boolean,operation_revision bigint)
language plpgsql security definer
set search_path to 'pg_catalog', 'public', 'netunim_internal'
as $function$
begin
  perform netunim_internal.require_finance_storage_writer_v2();
  return query select * from netunim_internal.save_finance_sync_document_current(
    p_document_name,p_expected_revision,p_state,p_operation_id);
end
$function$;
create function public.save_order_management_document_v4(
  p_document_name text,p_expected_revision bigint,p_state jsonb,p_operation_id text,p_delete_intents jsonb)
returns table(revision bigint,updated_at timestamptz,state jsonb,operation_replayed boolean,operation_revision bigint)
language plpgsql security definer
set search_path to 'pg_catalog', 'public', 'netunim_internal'
as $function$
begin
  perform netunim_internal.require_legacy_storage_writer('orders');
  return query select * from netunim_internal.save_order_management_document_core(p_document_name,p_expected_revision,p_state,p_operation_id,p_delete_intents);
end
$function$;
create function public.save_kupa_document_v4(
  p_document_name text,p_expected_revision bigint,p_state jsonb,p_operation_id text,p_delete_intents jsonb)
returns table(revision bigint,updated_at timestamptz,state jsonb,operation_replayed boolean,operation_revision bigint)
language plpgsql security definer
set search_path to 'pg_catalog', 'public', 'netunim_internal'
as $function$
begin
  perform netunim_internal.require_legacy_storage_writer('kupa');
  return query select * from netunim_internal.save_kupa_document_core(p_document_name,p_expected_revision,p_state,p_operation_id,p_delete_intents);
end
$function$;
create function public.save_shared_checks_document_v4(
  p_document_name text,p_expected_revision bigint,p_state jsonb,p_operation_id text,p_deleted_check_ids jsonb)
returns table(revision bigint,updated_at timestamptz,state jsonb,operation_replayed boolean,operation_revision bigint)
language plpgsql security definer
set search_path to 'pg_catalog', 'public', 'netunim_internal'
as $function$
begin
  perform netunim_internal.require_legacy_storage_writer('shared-checks');
  return query select * from netunim_internal.save_shared_checks_document_core(p_document_name,p_expected_revision,p_state,p_operation_id,p_deleted_check_ids);
end
$function$;
revoke all on function public.save_order_management_document_v5(text,bigint,jsonb,text,jsonb,jsonb) from public, anon;
revoke all on function public.save_kupa_document_v5(text,bigint,jsonb,text,jsonb,jsonb) from public, anon;
revoke all on function public.save_shared_checks_document_v5(text,bigint,jsonb,text,jsonb,jsonb) from public, anon;
revoke all on function public.stage_restore_group_v5(uuid,text,text,bigint,jsonb,jsonb,text,bigint,jsonb,jsonb,text,text,jsonb) from public, anon;
revoke all on function public.save_finance_sync_document_v3(text,bigint,jsonb,text) from public, anon;
revoke all on function public.save_order_management_document_v4(text,bigint,jsonb,text,jsonb) from public, anon;
revoke all on function public.save_kupa_document_v4(text,bigint,jsonb,text,jsonb) from public, anon;
revoke all on function public.save_shared_checks_document_v4(text,bigint,jsonb,text,jsonb) from public, anon;
grant execute on function public.save_order_management_document_v5(text,bigint,jsonb,text,jsonb,jsonb) to authenticated, service_role;
grant execute on function public.save_kupa_document_v5(text,bigint,jsonb,text,jsonb,jsonb) to authenticated, service_role;
grant execute on function public.save_shared_checks_document_v5(text,bigint,jsonb,text,jsonb,jsonb) to authenticated, service_role;
grant execute on function public.stage_restore_group_v5(uuid,text,text,bigint,jsonb,jsonb,text,bigint,jsonb,jsonb,text,text,jsonb) to authenticated, service_role;
grant execute on function public.save_finance_sync_document_v3(text,bigint,jsonb,text) to authenticated, service_role;
grant execute on function public.save_order_management_document_v4(text,bigint,jsonb,text,jsonb) to authenticated, service_role;
grant execute on function public.save_kupa_document_v4(text,bigint,jsonb,text,jsonb) to authenticated, service_role;
grant execute on function public.save_shared_checks_document_v4(text,bigint,jsonb,text,jsonb) to authenticated, service_role;

-- Preserve the current V5 audit/validation contract, but call the canonical
-- internal revision/delete-intent implementations rather than public V4.
create or replace function netunim_internal.save_order_management_document_current(
  p_document_name text,p_expected_revision bigint,p_state jsonb,p_operation_id text,p_delete_intents jsonb,p_audit jsonb)
returns table(revision bigint,updated_at timestamptz,state jsonb,operation_replayed boolean,operation_revision bigint)
language plpgsql
set search_path to 'pg_catalog', 'public', 'netunim_internal'
as $function$
declare v_owner uuid:=auth.uid();v_before jsonb;v_result record;v_paths text[]:=array['suppliers','transactions','customerDebts','customerOrders','serviceCalls','notes','inventoryItems','inventoryEvents','warehouseOrders','notesSheet.sheets','notesSheet.columns','notesSheet.rows'];
begin
  if v_owner is null then raise exception 'not_authenticated' using errcode='42501';end if;
  perform netunim_internal.assert_document_invariants('orders',p_state);
  select d.state into v_before from public.order_management_documents d where d.owner_id=v_owner and d.document_name=p_document_name;
  select * into v_result from netunim_internal.save_order_management_document_core(p_document_name,p_expected_revision,p_state,p_operation_id,p_delete_intents);
  perform netunim_internal.record_operation_audit(v_owner,'orders',p_document_name,p_operation_id,coalesce(p_audit,'{}'::jsonb)||jsonb_build_object('baseRevision',p_expected_revision),coalesce(v_before,p_state),v_result.state,v_paths,null);
  return query select v_result.revision,v_result.updated_at,v_result.state,v_result.operation_replayed,v_result.operation_revision;
end
$function$;
create or replace function netunim_internal.save_kupa_document_current(
  p_document_name text,p_expected_revision bigint,p_state jsonb,p_operation_id text,p_delete_intents jsonb,p_audit jsonb)
returns table(revision bigint,updated_at timestamptz,state jsonb,operation_replayed boolean,operation_revision bigint)
language plpgsql
set search_path to 'pg_catalog', 'public', 'netunim_internal'
as $function$
declare v_owner uuid:=auth.uid();v_before jsonb;v_result record;v_paths text[]:=array['credits','cash','rights','notes','expenses','cards','notesSheet.rows','notesSheet.columns','notesSheet.sheets'];
begin
  if v_owner is null then raise exception 'not_authenticated' using errcode='42501';end if;
  perform netunim_internal.assert_document_invariants('kupa',p_state);
  select d.state into v_before from public.kupa_documents d where d.owner_id=v_owner and d.document_name=p_document_name;
  perform set_config('app.kupa_cards_delete_intents',coalesce(p_delete_intents->'cards','[]'::jsonb)::text,true);
  select * into v_result from netunim_internal.save_kupa_document_core(p_document_name,p_expected_revision,p_state,p_operation_id,coalesce(p_delete_intents,'{}'::jsonb)-'cards');
  perform set_config('app.kupa_cards_delete_intents','[]',true);
  perform netunim_internal.record_operation_audit(v_owner,'kupa',p_document_name,p_operation_id,coalesce(p_audit,'{}'::jsonb)||jsonb_build_object('baseRevision',p_expected_revision),coalesce(v_before,p_state),v_result.state,v_paths,null);
  return query select v_result.revision,v_result.updated_at,v_result.state,v_result.operation_replayed,v_result.operation_revision;
end
$function$;
create or replace function netunim_internal.save_shared_checks_document_current(
  p_document_name text,p_expected_revision bigint,p_state jsonb,p_operation_id text,p_deleted_check_ids jsonb,p_audit jsonb)
returns table(revision bigint,updated_at timestamptz,state jsonb,operation_replayed boolean,operation_revision bigint)
language plpgsql
set search_path to 'pg_catalog', 'public', 'netunim_internal'
as $function$
declare v_owner uuid:=auth.uid();v_before jsonb;v_result record;v_paths text[]:=array['checks'];
begin
  if v_owner is null then raise exception 'not_authenticated' using errcode='42501';end if;
  if jsonb_typeof(p_state->'bankEvents') is distinct from 'array' then p_state:=p_state||jsonb_build_object('bankEvents','[]'::jsonb);end if;
  perform netunim_internal.assert_document_invariants('shared-checks',p_state);
  select d.state into v_before from public.shared_checks_documents d where d.owner_id=v_owner and d.document_name=p_document_name;
  select * into v_result from netunim_internal.save_shared_checks_document_core(p_document_name,p_expected_revision,p_state,p_operation_id,p_deleted_check_ids);
  perform netunim_internal.record_operation_audit(v_owner,'shared-checks',p_document_name,p_operation_id,coalesce(p_audit,'{}'::jsonb)||jsonb_build_object('baseRevision',p_expected_revision),coalesce(v_before,p_state),v_result.state,v_paths,null);
  return query select v_result.revision,v_result.updated_at,v_result.state,v_result.operation_replayed,v_result.operation_revision;
end
$function$;

create or replace function netunim_internal.fenced_impl_save_finance_sync_document_v5(
  p_document_name text,p_expected_revision bigint,p_state jsonb,p_operation_id text,p_audit jsonb)
returns table(revision bigint,updated_at timestamptz,state jsonb,operation_replayed boolean,operation_revision bigint)
language plpgsql
set search_path to 'pg_catalog', 'public', 'netunim_internal'
as $function$
declare v_owner uuid:=auth.uid();v_before jsonb;v_result record;v_paths text[]:=array[]::text[];
begin
  if v_owner is null then raise exception 'not_authenticated' using errcode='42501';end if;
  if p_state is null or jsonb_typeof(p_state) is distinct from 'object' then raise exception 'invalid_finance_state' using errcode='22023';end if;
  select d.state into v_before from public.finance_sync_documents d where d.owner_id=v_owner and d.document_name=p_document_name;
  select * into v_result from netunim_internal.save_finance_sync_document_current(p_document_name,p_expected_revision,p_state,p_operation_id);
  perform netunim_internal.record_operation_audit(v_owner,'finance',p_document_name,p_operation_id,coalesce(p_audit,'{}'::jsonb)||jsonb_build_object('baseRevision',p_expected_revision),coalesce(v_before,p_state),v_result.state,v_paths,null);
  return query select v_result.revision,v_result.updated_at,v_result.state,v_result.operation_replayed,v_result.operation_revision;
end
$function$;

-- The v6 entrypoints no longer invoke public compatibility functions.
create or replace function public.save_order_management_document_v6(
  p_document_name text,p_expected_revision bigint,p_state jsonb,p_operation_id text,p_delete_intents jsonb,p_audit jsonb)
returns table(revision bigint,updated_at timestamptz,state jsonb,operation_replayed boolean,operation_revision bigint)
language plpgsql security definer
set search_path to 'pg_catalog', 'public', 'netunim_internal'
as $function$
begin
  perform netunim_internal.enter_storage_writer_v2('orders');
  return query select * from netunim_internal.save_order_management_document_current(p_document_name,p_expected_revision,p_state,p_operation_id,p_delete_intents,p_audit);
  perform netunim_internal.leave_storage_writer_v2('orders');
end
$function$;
create or replace function public.save_kupa_document_v6(
  p_document_name text,p_expected_revision bigint,p_state jsonb,p_operation_id text,p_delete_intents jsonb,p_audit jsonb)
returns table(revision bigint,updated_at timestamptz,state jsonb,operation_replayed boolean,operation_revision bigint)
language plpgsql security definer
set search_path to 'pg_catalog', 'public', 'netunim_internal'
as $function$
begin
  perform netunim_internal.enter_storage_writer_v2('kupa');
  return query select * from netunim_internal.save_kupa_document_current(p_document_name,p_expected_revision,p_state,p_operation_id,p_delete_intents,p_audit);
  perform netunim_internal.leave_storage_writer_v2('kupa');
end
$function$;
create or replace function public.save_shared_checks_document_v6(
  p_document_name text,p_expected_revision bigint,p_state jsonb,p_operation_id text,p_deleted_check_ids jsonb,p_audit jsonb)
returns table(revision bigint,updated_at timestamptz,state jsonb,operation_replayed boolean,operation_revision bigint)
language plpgsql security definer
set search_path to 'pg_catalog', 'public', 'netunim_internal'
as $function$
begin
  perform netunim_internal.enter_storage_writer_v2('shared-checks');
  return query select * from netunim_internal.save_shared_checks_document_current(p_document_name,p_expected_revision,p_state,p_operation_id,p_deleted_check_ids,p_audit);
  perform netunim_internal.leave_storage_writer_v2('shared-checks');
end
$function$;

create or replace function public.bulk_delete_save_order_management_document_v6(
  p_document_name text,p_expected_revision bigint,p_state jsonb,p_operation_id text,p_delete_intents jsonb,p_audit jsonb)
returns table(revision bigint,updated_at timestamptz,state jsonb,operation_replayed boolean,operation_revision bigint)
language plpgsql security definer
set search_path to 'pg_catalog', 'public', 'netunim_internal'
as $function$
declare v_owner uuid:=auth.uid();v_result record;
begin
  if v_owner is null then raise exception 'not_authenticated' using errcode='42501';end if;
  perform netunim_internal.enter_storage_writer_v2('orders');
  perform set_config('app.destructive_operation_kind','bulk-delete',true);
  perform netunim_internal.capture_safety_snapshot(v_owner,'orders',p_document_name,p_operation_id,'bulk-delete');
  select * into v_result from netunim_internal.save_order_management_document_current(p_document_name,p_expected_revision,p_state,p_operation_id,p_delete_intents,coalesce(p_audit,'{}'::jsonb)||jsonb_build_object('mutationType','bulk-delete'));
  perform set_config('app.destructive_operation_kind','',true);
  perform netunim_internal.leave_storage_writer_v2('orders');
  return query select v_result.revision,v_result.updated_at,v_result.state,v_result.operation_replayed,v_result.operation_revision;
end
$function$;
create or replace function public.bulk_delete_save_kupa_document_v6(
  p_document_name text,p_expected_revision bigint,p_state jsonb,p_operation_id text,p_delete_intents jsonb,p_audit jsonb)
returns table(revision bigint,updated_at timestamptz,state jsonb,operation_replayed boolean,operation_revision bigint)
language plpgsql security definer
set search_path to 'pg_catalog', 'public', 'netunim_internal'
as $function$
declare v_owner uuid:=auth.uid();v_result record;
begin
  if v_owner is null then raise exception 'not_authenticated' using errcode='42501';end if;
  perform netunim_internal.enter_storage_writer_v2('kupa');
  perform set_config('app.destructive_operation_kind','bulk-delete',true);
  perform netunim_internal.capture_safety_snapshot(v_owner,'kupa',p_document_name,p_operation_id,'bulk-delete');
  select * into v_result from netunim_internal.save_kupa_document_current(p_document_name,p_expected_revision,p_state,p_operation_id,p_delete_intents,coalesce(p_audit,'{}'::jsonb)||jsonb_build_object('mutationType','bulk-delete'));
  perform set_config('app.destructive_operation_kind','',true);
  perform netunim_internal.leave_storage_writer_v2('kupa');
  return query select v_result.revision,v_result.updated_at,v_result.state,v_result.operation_replayed,v_result.operation_revision;
end
$function$;
create or replace function public.bulk_delete_save_shared_checks_document_v6(
  p_document_name text,p_expected_revision bigint,p_state jsonb,p_operation_id text,p_deleted_check_ids jsonb,p_audit jsonb)
returns table(revision bigint,updated_at timestamptz,state jsonb,operation_replayed boolean,operation_revision bigint)
language plpgsql security definer
set search_path to 'pg_catalog', 'public', 'netunim_internal'
as $function$
declare v_owner uuid:=auth.uid();v_result record;
begin
  if v_owner is null then raise exception 'not_authenticated' using errcode='42501';end if;
  perform netunim_internal.enter_storage_writer_v2('shared-checks');
  perform set_config('app.destructive_operation_kind','bulk-delete',true);
  perform netunim_internal.capture_safety_snapshot(v_owner,'shared-checks',p_document_name,p_operation_id,'bulk-delete');
  select * into v_result from netunim_internal.save_shared_checks_document_current(p_document_name,p_expected_revision,p_state,p_operation_id,p_deleted_check_ids,coalesce(p_audit,'{}'::jsonb)||jsonb_build_object('mutationType','bulk-delete'));
  perform set_config('app.destructive_operation_kind','',true);
  perform netunim_internal.leave_storage_writer_v2('shared-checks');
  return query select v_result.revision,v_result.updated_at,v_result.state,v_result.operation_replayed,v_result.operation_revision;
end
$function$;

create function netunim_internal.apply_restore_group_current(p_restore_group_id uuid)
returns table(restore_group_id uuid,phase text,main_revision bigint,checks_revision bigint)
language plpgsql security definer
set search_path to 'pg_catalog', 'public', 'netunim_internal'
as $function$
declare v_owner uuid:=auth.uid();v_group netunim_internal.restore_operation_groups%rowtype;v_main record;v_checks record;
begin
  if v_owner is null then raise exception 'not_authenticated' using errcode='42501';end if;
  select * into v_group from netunim_internal.restore_operation_groups g where g.owner_id=v_owner and g.restore_group_id=p_restore_group_id for update;
  if not found then raise exception 'restore_group_missing' using errcode='P0002';end if;
  if v_group.phase='completed' then
    select applied_revision into main_revision from netunim_internal.document_sync_operations where owner_id=v_owner and domain=v_group.app_site and document_name=v_group.main_document_name and operation_id=v_group.main_operation_id;
    if v_group.checks_state is not null then select applied_revision into checks_revision from netunim_internal.document_sync_operations where owner_id=v_owner and domain='shared-checks' and document_name=v_group.checks_document_name and operation_id=v_group.checks_operation_id;end if;
    restore_group_id:=v_group.restore_group_id;phase:=v_group.phase;return next;return;
  end if;
  perform set_config('app.destructive_operation_kind','restore',true);
  update netunim_internal.restore_operation_groups as g set phase='main_pending',updated_at=now() where g.owner_id=v_owner and g.restore_group_id=p_restore_group_id;
  perform netunim_internal.capture_safety_snapshot(v_owner,v_group.app_site,v_group.main_document_name,v_group.main_operation_id,'restore',v_group.restore_group_id);
  if v_group.app_site='orders' then
    select * into v_main from netunim_internal.save_order_management_document_current(v_group.main_document_name,v_group.main_base_revision,v_group.main_state,v_group.main_operation_id,v_group.main_delete_intents,v_group.audit||jsonb_build_object('mutationType','restore','restoreGroupId',v_group.restore_group_id));
  else
    select * into v_main from netunim_internal.save_kupa_document_current(v_group.main_document_name,v_group.main_base_revision,v_group.main_state,v_group.main_operation_id,v_group.main_delete_intents,v_group.audit||jsonb_build_object('mutationType','restore','restoreGroupId',v_group.restore_group_id));
  end if;
  update netunim_internal.restore_operation_groups as g set phase='main_acked',updated_at=now() where g.owner_id=v_owner and g.restore_group_id=p_restore_group_id;
  if v_group.checks_state is not null then
    update netunim_internal.restore_operation_groups as g set phase='checks_pending',updated_at=now() where g.owner_id=v_owner and g.restore_group_id=p_restore_group_id;
    perform netunim_internal.capture_safety_snapshot(v_owner,'shared-checks',v_group.checks_document_name,v_group.checks_operation_id,'restore',v_group.restore_group_id);
    select * into v_checks from netunim_internal.save_shared_checks_document_current(v_group.checks_document_name,v_group.checks_base_revision,v_group.checks_state,v_group.checks_operation_id,v_group.checks_delete_ids,v_group.audit||jsonb_build_object('mutationType','restore','restoreGroupId',v_group.restore_group_id));
    update netunim_internal.restore_operation_groups as g set phase='checks_acked',updated_at=now() where g.owner_id=v_owner and g.restore_group_id=p_restore_group_id;
  end if;
  perform set_config('app.destructive_operation_kind','',true);
  update netunim_internal.restore_operation_groups as g set phase='completed',completed_at=now(),updated_at=now() where g.owner_id=v_owner and g.restore_group_id=p_restore_group_id;
  restore_group_id:=v_group.restore_group_id;phase:='completed';main_revision:=v_main.revision;
  checks_revision:=null;
  if v_group.checks_state is not null then checks_revision:=v_checks.revision;end if;
  return next;
end
$function$;
revoke all on function netunim_internal.apply_restore_group_current(uuid) from public, anon, authenticated;

create or replace function public.apply_restore_group_v6(p_restore_group_id uuid)
returns table(restore_group_id uuid,phase text,main_revision bigint,checks_revision bigint)
language plpgsql security definer
set search_path to 'pg_catalog', 'public', 'netunim_internal'
as $function$
declare v_app text;
begin
  select g.app_site into v_app from netunim_internal.restore_operation_groups g
    where g.owner_id=auth.uid() and g.restore_group_id=p_restore_group_id;
  if v_app not in ('orders','kupa') or v_app is null then
    raise exception 'restore_group_missing' using errcode='P0002';
  end if;
  perform netunim_internal.enter_storage_writer_v2(v_app);
  perform netunim_internal.enter_storage_writer_v2('shared-checks');
  return query select * from netunim_internal.apply_restore_group_current(p_restore_group_id);
  perform netunim_internal.leave_storage_writer_v2('shared-checks');
  perform netunim_internal.leave_storage_writer_v2(v_app);
end
$function$;

create or replace function public.stage_restore_group_v6(
  p_restore_group_id uuid,p_app_site text,p_main_document_name text,p_main_base_revision bigint,
  p_main_state jsonb,p_main_delete_intents jsonb,p_checks_document_name text,p_checks_base_revision bigint,
  p_checks_state jsonb,p_checks_delete_ids jsonb,p_main_operation_id text,p_checks_operation_id text,p_audit jsonb)
returns table(restore_group_id uuid,phase text)
language plpgsql security definer
set search_path to 'pg_catalog', 'public', 'netunim_internal'
as $function$
begin
  perform netunim_internal.enter_storage_writer_v2(p_app_site);
  return query select * from netunim_internal.stage_restore_group_current(
    p_restore_group_id,p_app_site,p_main_document_name,p_main_base_revision,
    p_main_state,p_main_delete_intents,p_checks_document_name,p_checks_base_revision,
    p_checks_state,p_checks_delete_ids,p_main_operation_id,p_checks_operation_id,p_audit);
  perform netunim_internal.leave_storage_writer_v2(p_app_site);
end
$function$;

-- Financial V2 endpoints use the existing internal lease-fenced implementations
-- directly. The public legacy bank and credit names remain for compatibility.
create or replace function public.merge_bank_transactions_v6(
  p_account_key text,p_account_role text,p_transactions jsonb,
  p_lease_name text default null,p_lease_token text default null,p_fence_epoch bigint default null)
returns table(inserted_count integer,updated_count integer,total_count integer)
language plpgsql security definer
set search_path to 'pg_catalog', 'public', 'netunim_internal'
as $function$
begin
  perform netunim_internal.enter_storage_writer_v2('kupa');
  if p_lease_name is distinct from 'bank' then raise exception 'stale_finance_sync_fence' using errcode='PT409';end if;
  perform netunim_internal.assert_finance_sync_fence(p_lease_name,p_lease_token,p_fence_epoch);
  return query select * from netunim_internal.fenced_impl_merge_bank_transactions(p_account_key,p_account_role,p_transactions);
  perform netunim_internal.leave_storage_writer_v2('kupa');
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
  perform netunim_internal.enter_storage_writer_v2('kupa');
  if p_lease_name is distinct from 'bank' then raise exception 'stale_finance_sync_fence' using errcode='PT409';end if;
  perform netunim_internal.assert_finance_sync_fence(p_lease_name,p_lease_token,p_fence_epoch);
  return query select * from netunim_internal.fenced_impl_sync_bank_transactions_snapshot(
    p_account_key,p_account_role,p_transactions,p_snapshot_at,p_coverage_from,p_coverage_to,p_complete);
  perform netunim_internal.leave_storage_writer_v2('kupa');
end
$function$;
create or replace function public.save_bank_sync_snapshot_v6(
  p_document_name text,p_bank_state jsonb,p_snapshot_token text,p_snapshot_seq bigint,
  p_lease_name text default null,p_lease_token text default null,p_fence_epoch bigint default null)
returns table(finance_revision bigint,kupa_revision bigint,updated_at timestamptz)
language plpgsql security definer
set search_path to 'pg_catalog', 'public', 'netunim_internal'
as $function$
begin
  perform netunim_internal.enter_storage_writer_v2('kupa');
  if p_lease_name is distinct from 'bank' then raise exception 'stale_finance_sync_fence' using errcode='PT409';end if;
  perform netunim_internal.assert_finance_sync_fence(p_lease_name,p_lease_token,p_fence_epoch);
  return query select * from netunim_internal.fenced_impl_save_bank_sync_snapshot(
    p_document_name,p_bank_state,p_snapshot_token,p_snapshot_seq);
  perform netunim_internal.leave_storage_writer_v2('kupa');
end
$function$;
create or replace function public.save_finance_sync_document_v6(
  p_document_name text,p_expected_revision bigint,p_state jsonb,p_operation_id text,p_audit jsonb,
  p_lease_name text default null,p_lease_token text default null,p_fence_epoch bigint default null)
returns table(revision bigint,updated_at timestamptz,state jsonb,operation_replayed boolean,operation_revision bigint)
language plpgsql security definer
set search_path to 'pg_catalog', 'public', 'netunim_internal'
as $function$
begin
  perform netunim_internal.enter_storage_writer_v2('kupa');
  perform netunim_internal.assert_finance_sync_fence(p_lease_name,p_lease_token,p_fence_epoch);
  return query select * from netunim_internal.fenced_impl_save_finance_sync_document_v5(
    p_document_name,p_expected_revision,p_state,p_operation_id,p_audit);
  perform netunim_internal.leave_storage_writer_v2('kupa');
end
$function$;

create or replace function public.get_netunim_sync_capabilities()
returns jsonb language sql stable security invoker
set search_path to 'pg_catalog', 'public', 'netunim_internal'
as $function$
 select jsonb_build_object(
 'documentOperationLedger',case when to_regclass('netunim_internal.document_sync_operations') is not null then 3 else 0 end,
 'syncIntegrity',case when to_regprocedure('netunim_internal.document_invariant_guard()') is not null then 5 else 0 end,
 'deleteIntents',case when (select count(*) from pg_trigger where tgname in ('order_management_delete_intent_guard','kupa_delete_intent_guard','shared_checks_delete_intent_guard') and tgenabled<>'D')=3 then 4 else 0 end,
 'massDeleteGuard',case when (select count(*) from pg_trigger where tgname in ('order_management_mass_destructive_guard','kupa_mass_destructive_guard','shared_checks_mass_destructive_guard') and tgenabled<>'D')=3 then 5 else 0 end,
 'restoreGroups',case when to_regclass('netunim_internal.restore_operation_groups') is not null and to_regprocedure('netunim_internal.apply_restore_group_current(uuid)') is not null and to_regprocedure('public.apply_restore_group_v6(uuid)') is not null then 5 else 0 end,
 'sharedChecksIntegrity',case when to_regprocedure('netunim_internal.save_shared_checks_document_current(text,bigint,jsonb,text,jsonb,jsonb)') is not null and to_regprocedure('public.save_shared_checks_document_v6(text,bigint,jsonb,text,jsonb,jsonb)') is not null then 5 else 0 end,
 'financeFencing',case when to_regprocedure('public.save_bank_sync_snapshot_v6(text,jsonb,text,bigint,text,text,bigint)') is not null
   and to_regprocedure('public.save_finance_sync_document_v6(text,bigint,jsonb,text,jsonb,text,text,bigint)') is not null
   and to_regprocedure('public.merge_bank_transactions_v6(text,text,jsonb,text,text,bigint)') is not null
   and to_regprocedure('public.sync_bank_transactions_snapshot_v6(text,text,jsonb,timestamptz,date,date,boolean,text,text,bigint)') is not null
   and exists(select 1 from pg_trigger where tgname='finance_sync_storage_protocol_guard' and tgenabled<>'D')
   then 2 else 0 end,
 'storageWriterProtocol',case when to_regclass('netunim_internal.storage_writer_protocol') is not null
   and to_regprocedure('netunim_internal.save_order_management_document_current(text,bigint,jsonb,text,jsonb,jsonb)') is not null
   and to_regprocedure('netunim_internal.save_kupa_document_current(text,bigint,jsonb,text,jsonb,jsonb)') is not null
   and to_regprocedure('netunim_internal.save_shared_checks_document_current(text,bigint,jsonb,text,jsonb,jsonb)') is not null
   and to_regprocedure('public.save_order_management_document_v6(text,bigint,jsonb,text,jsonb,jsonb)') is not null
   and to_regprocedure('public.save_kupa_document_v6(text,bigint,jsonb,text,jsonb,jsonb)') is not null
   and to_regprocedure('public.save_shared_checks_document_v6(text,bigint,jsonb,text,jsonb,jsonb)') is not null
   and to_regprocedure('public.apply_restore_group_v6(uuid)') is not null
   and to_regprocedure('public.stage_restore_group_v6(uuid,text,text,bigint,jsonb,jsonb,text,bigint,jsonb,jsonb,text,text,jsonb)') is not null
   and (select count(*) from pg_trigger where tgname in ('order_management_storage_protocol_guard','kupa_storage_protocol_guard','shared_checks_storage_protocol_guard','restore_group_storage_protocol_guard') and tgenabled<>'D')=4
   then 2 else 0 end);
$function$;

commit;
