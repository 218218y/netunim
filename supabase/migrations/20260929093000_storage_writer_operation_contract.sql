-- Centralize Storage V2 writer scope by business operation. Public v6 RPCs no
-- longer enumerate protected domains themselves; the contract below is the
-- reviewed source of truth for transitive writes, including trigger side effects.
-- The existing transaction/owner/domain invocation table remains the security
-- boundary. These helpers only populate that boundary from a protected contract.
begin;

create table netunim_internal.storage_writer_operations (
  operation text primary key,
  entrypoint text not null
);
revoke all on netunim_internal.storage_writer_operations from public, anon, authenticated, service_role;

create table netunim_internal.storage_writer_operation_domains (
  operation text not null references netunim_internal.storage_writer_operations(operation) on delete restrict,
  domain text not null check (domain in ('orders','kupa','shared-checks')),
  ordinal smallint not null check (ordinal > 0),
  primary key (operation,domain),
  unique (operation,ordinal)
);
revoke all on netunim_internal.storage_writer_operation_domains from public, anon, authenticated, service_role;

create table netunim_internal.storage_writer_operation_leases (
  operation text not null references netunim_internal.storage_writer_operations(operation) on delete restrict,
  lease_name text not null check (lease_name in ('bank','credit')),
  primary key (operation,lease_name)
);
revoke all on netunim_internal.storage_writer_operation_leases from public, anon, authenticated, service_role;

insert into netunim_internal.storage_writer_operations(operation,entrypoint) values
  ('orders-save','public.save_order_management_document_v6'),
  ('orders-bulk-delete','public.bulk_delete_save_order_management_document_v6'),
  ('kupa-save','public.save_kupa_document_v6'),
  ('kupa-bulk-delete','public.bulk_delete_save_kupa_document_v6'),
  ('shared-checks-save','public.save_shared_checks_document_v6'),
  ('shared-checks-bulk-delete','public.bulk_delete_save_shared_checks_document_v6'),
  ('restore-orders-stage','public.stage_restore_group_v6'),
  ('restore-kupa-stage','public.stage_restore_group_v6'),
  ('restore-orders-apply','public.apply_restore_group_v6'),
  ('restore-kupa-apply','public.apply_restore_group_v6'),
  ('bank-merge','public.merge_bank_transactions_v6'),
  ('bank-archive-snapshot','public.sync_bank_transactions_snapshot_v6'),
  ('bank-balance-snapshot','public.save_bank_sync_snapshot_v6'),
  ('finance-document-save','public.save_finance_sync_document_v6');

insert into netunim_internal.storage_writer_operation_domains(operation,domain,ordinal) values
  ('orders-save','orders',1),
  ('orders-bulk-delete','orders',1),
  ('kupa-save','kupa',1),
  ('kupa-bulk-delete','kupa',1),
  ('shared-checks-save','shared-checks',1),
  ('shared-checks-bulk-delete','shared-checks',1),
  ('restore-orders-stage','orders',1),
  ('restore-kupa-stage','kupa',1),
  ('restore-orders-apply','orders',1),
  ('restore-orders-apply','shared-checks',2),
  ('restore-kupa-apply','kupa',1),
  ('restore-kupa-apply','shared-checks',2),
  ('bank-merge','kupa',1),
  ('bank-archive-snapshot','kupa',1),
  ('bank-archive-snapshot','shared-checks',2),
  ('bank-balance-snapshot','kupa',1),
  ('finance-document-save','kupa',1);

insert into netunim_internal.storage_writer_operation_leases(operation,lease_name) values
  ('bank-merge','bank'),
  ('bank-archive-snapshot','bank'),
  ('bank-balance-snapshot','bank'),
  ('finance-document-save','bank'),
  ('finance-document-save','credit');

create function netunim_internal.enter_storage_writer_operation_v2(p_operation text)
returns void language plpgsql security definer
set search_path to 'pg_catalog', 'netunim_internal'
as $function$
declare v_domain text;v_found boolean:=false;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode='42501';end if;
  for v_domain in
    select d.domain from netunim_internal.storage_writer_operation_domains d
    where d.operation=p_operation order by d.ordinal
  loop
    v_found:=true;
    perform netunim_internal.enter_storage_writer_v2(v_domain);
  end loop;
  if not v_found then
    raise exception 'storage_writer_operation_invalid' using errcode='22023';
  end if;
end
$function$;
revoke all on function netunim_internal.enter_storage_writer_operation_v2(text) from public, anon, authenticated, service_role;

create function netunim_internal.leave_storage_writer_operation_v2(p_operation text)
returns void language plpgsql security definer
set search_path to 'pg_catalog', 'netunim_internal'
as $function$
declare v_domain text;
begin
  if not exists(select 1 from netunim_internal.storage_writer_operations o where o.operation=p_operation) then
    raise exception 'storage_writer_operation_invalid' using errcode='22023';
  end if;
  for v_domain in
    select d.domain from netunim_internal.storage_writer_operation_domains d
    where d.operation=p_operation order by d.ordinal desc
  loop
    perform netunim_internal.leave_storage_writer_v2(v_domain);
  end loop;
end
$function$;
revoke all on function netunim_internal.leave_storage_writer_operation_v2(text) from public, anon, authenticated, service_role;

create function netunim_internal.assert_storage_writer_operation_fence_v2(
  p_operation text,p_lease_name text,p_lease_token text,p_fence_epoch bigint)
returns void language plpgsql security definer
set search_path to 'pg_catalog', 'netunim_internal'
as $function$
begin
  if not exists(
    select 1 from netunim_internal.storage_writer_operation_leases l
    where l.operation=p_operation and l.lease_name=p_lease_name
  ) then
    raise exception 'stale_finance_sync_fence' using errcode='PT409';
  end if;
  perform netunim_internal.assert_finance_sync_fence(p_lease_name,p_lease_token,p_fence_epoch);
end
$function$;
revoke all on function netunim_internal.assert_storage_writer_operation_fence_v2(text,text,text,bigint) from public, anon, authenticated, service_role;

-- Simple document writers now reference operations, not domains.
create or replace function public.save_order_management_document_v6(
  p_document_name text,p_expected_revision bigint,p_state jsonb,p_operation_id text,p_delete_intents jsonb,p_audit jsonb)
returns table(revision bigint,updated_at timestamptz,state jsonb,operation_replayed boolean,operation_revision bigint)
language plpgsql security definer
set search_path to 'pg_catalog', 'public', 'netunim_internal'
as $function$
begin
  perform netunim_internal.enter_storage_writer_operation_v2('orders-save');
  return query select * from netunim_internal.save_order_management_document_current(p_document_name,p_expected_revision,p_state,p_operation_id,p_delete_intents,p_audit);
  perform netunim_internal.leave_storage_writer_operation_v2('orders-save');
end
$function$;

create or replace function public.save_kupa_document_v6(
  p_document_name text,p_expected_revision bigint,p_state jsonb,p_operation_id text,p_delete_intents jsonb,p_audit jsonb)
returns table(revision bigint,updated_at timestamptz,state jsonb,operation_replayed boolean,operation_revision bigint)
language plpgsql security definer
set search_path to 'pg_catalog', 'public', 'netunim_internal'
as $function$
begin
  perform netunim_internal.enter_storage_writer_operation_v2('kupa-save');
  return query select * from netunim_internal.save_kupa_document_current(p_document_name,p_expected_revision,p_state,p_operation_id,p_delete_intents,p_audit);
  perform netunim_internal.leave_storage_writer_operation_v2('kupa-save');
end
$function$;

create or replace function public.save_shared_checks_document_v6(
  p_document_name text,p_expected_revision bigint,p_state jsonb,p_operation_id text,p_deleted_check_ids jsonb,p_audit jsonb)
returns table(revision bigint,updated_at timestamptz,state jsonb,operation_replayed boolean,operation_revision bigint)
language plpgsql security definer
set search_path to 'pg_catalog', 'public', 'netunim_internal'
as $function$
begin
  perform netunim_internal.enter_storage_writer_operation_v2('shared-checks-save');
  return query select * from netunim_internal.save_shared_checks_document_current(p_document_name,p_expected_revision,p_state,p_operation_id,p_deleted_check_ids,p_audit);
  perform netunim_internal.leave_storage_writer_operation_v2('shared-checks-save');
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
  perform netunim_internal.enter_storage_writer_operation_v2('orders-bulk-delete');
  perform set_config('app.destructive_operation_kind','bulk-delete',true);
  perform netunim_internal.capture_safety_snapshot(v_owner,'orders',p_document_name,p_operation_id,'bulk-delete');
  select * into v_result from netunim_internal.save_order_management_document_current(p_document_name,p_expected_revision,p_state,p_operation_id,p_delete_intents,coalesce(p_audit,'{}'::jsonb)||jsonb_build_object('mutationType','bulk-delete'));
  perform set_config('app.destructive_operation_kind','',true);
  perform netunim_internal.leave_storage_writer_operation_v2('orders-bulk-delete');
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
  perform netunim_internal.enter_storage_writer_operation_v2('kupa-bulk-delete');
  perform set_config('app.destructive_operation_kind','bulk-delete',true);
  perform netunim_internal.capture_safety_snapshot(v_owner,'kupa',p_document_name,p_operation_id,'bulk-delete');
  select * into v_result from netunim_internal.save_kupa_document_current(p_document_name,p_expected_revision,p_state,p_operation_id,p_delete_intents,coalesce(p_audit,'{}'::jsonb)||jsonb_build_object('mutationType','bulk-delete'));
  perform set_config('app.destructive_operation_kind','',true);
  perform netunim_internal.leave_storage_writer_operation_v2('kupa-bulk-delete');
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
  perform netunim_internal.enter_storage_writer_operation_v2('shared-checks-bulk-delete');
  perform set_config('app.destructive_operation_kind','bulk-delete',true);
  perform netunim_internal.capture_safety_snapshot(v_owner,'shared-checks',p_document_name,p_operation_id,'bulk-delete');
  select * into v_result from netunim_internal.save_shared_checks_document_current(p_document_name,p_expected_revision,p_state,p_operation_id,p_deleted_check_ids,coalesce(p_audit,'{}'::jsonb)||jsonb_build_object('mutationType','bulk-delete'));
  perform set_config('app.destructive_operation_kind','',true);
  perform netunim_internal.leave_storage_writer_operation_v2('shared-checks-bulk-delete');
  return query select v_result.revision,v_result.updated_at,v_result.state,v_result.operation_replayed,v_result.operation_revision;
end
$function$;

-- Restore staging writes only restore metadata. Apply is the cross-domain step.
create or replace function public.stage_restore_group_v6(
  p_restore_group_id uuid,p_app_site text,p_main_document_name text,p_main_base_revision bigint,
  p_main_state jsonb,p_main_delete_intents jsonb,p_checks_document_name text,p_checks_base_revision bigint,
  p_checks_state jsonb,p_checks_delete_ids jsonb,p_main_operation_id text,p_checks_operation_id text,p_audit jsonb)
returns table(restore_group_id uuid,phase text)
language plpgsql security definer
set search_path to 'pg_catalog', 'public', 'netunim_internal'
as $function$
declare v_operation text;
begin
  if p_app_site not in ('orders','kupa') or p_app_site is null then
    raise exception 'invalid_restore_group' using errcode='22023';
  end if;
  v_operation:=case p_app_site when 'orders' then 'restore-orders-stage' else 'restore-kupa-stage' end;
  perform netunim_internal.enter_storage_writer_operation_v2(v_operation);
  return query select * from netunim_internal.stage_restore_group_current(
    p_restore_group_id,p_app_site,p_main_document_name,p_main_base_revision,
    p_main_state,p_main_delete_intents,p_checks_document_name,p_checks_base_revision,
    p_checks_state,p_checks_delete_ids,p_main_operation_id,p_checks_operation_id,p_audit);
  perform netunim_internal.leave_storage_writer_operation_v2(v_operation);
end
$function$;

create or replace function public.apply_restore_group_v6(p_restore_group_id uuid)
returns table(restore_group_id uuid,phase text,main_revision bigint,checks_revision bigint)
language plpgsql security definer
set search_path to 'pg_catalog', 'public', 'netunim_internal'
as $function$
declare v_app text;v_operation text;
begin
  select g.app_site into v_app from netunim_internal.restore_operation_groups g
    where g.owner_id=auth.uid() and g.restore_group_id=p_restore_group_id;
  if v_app not in ('orders','kupa') or v_app is null then
    raise exception 'restore_group_missing' using errcode='P0002';
  end if;
  v_operation:=case v_app when 'orders' then 'restore-orders-apply' else 'restore-kupa-apply' end;
  perform netunim_internal.enter_storage_writer_operation_v2(v_operation);
  return query select * from netunim_internal.apply_restore_group_current(p_restore_group_id);
  perform netunim_internal.leave_storage_writer_operation_v2(v_operation);
end
$function$;

-- Finance validates its lease contract before opening any Storage V2 writer scope.
create or replace function public.merge_bank_transactions_v6(
  p_account_key text,p_account_role text,p_transactions jsonb,
  p_lease_name text default null,p_lease_token text default null,p_fence_epoch bigint default null)
returns table(inserted_count integer,updated_count integer,total_count integer)
language plpgsql security definer
set search_path to 'pg_catalog', 'public', 'netunim_internal'
as $function$
begin
  perform netunim_internal.assert_storage_writer_operation_fence_v2('bank-merge',p_lease_name,p_lease_token,p_fence_epoch);
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
  perform netunim_internal.enter_storage_writer_operation_v2('bank-archive-snapshot');
  return query select * from netunim_internal.fenced_impl_sync_bank_transactions_snapshot(
    p_account_key,p_account_role,p_transactions,p_snapshot_at,p_coverage_from,p_coverage_to,p_complete);
  perform netunim_internal.leave_storage_writer_operation_v2('bank-archive-snapshot');
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
  perform netunim_internal.assert_storage_writer_operation_fence_v2('bank-balance-snapshot',p_lease_name,p_lease_token,p_fence_epoch);
  perform netunim_internal.enter_storage_writer_operation_v2('bank-balance-snapshot');
  return query select * from netunim_internal.fenced_impl_save_bank_sync_snapshot(
    p_document_name,p_bank_state,p_snapshot_token,p_snapshot_seq);
  perform netunim_internal.leave_storage_writer_operation_v2('bank-balance-snapshot');
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
  perform netunim_internal.assert_storage_writer_operation_fence_v2('finance-document-save',p_lease_name,p_lease_token,p_fence_epoch);
  perform netunim_internal.enter_storage_writer_operation_v2('finance-document-save');
  return query select * from netunim_internal.fenced_impl_save_finance_sync_document_v5(
    p_document_name,p_expected_revision,p_state,p_operation_id,p_audit);
  perform netunim_internal.leave_storage_writer_operation_v2('finance-document-save');
end
$function$;

commit;
