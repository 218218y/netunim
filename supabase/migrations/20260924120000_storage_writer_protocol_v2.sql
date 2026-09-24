-- Fence-ready only. No owner is activated by installing this migration.
-- A later, explicit owner-scoped RPC turns the fence on atomically for all
-- three documents after both current clients have switched to the v6 writers.
begin;

create table netunim_internal.storage_writer_protocol (
  owner_id uuid not null,
  domain text not null check (domain in ('orders','kupa','shared-checks')),
  min_writer_protocol smallint not null check (min_writer_protocol = 2),
  activated_revision bigint not null check (activated_revision >= 0),
  activated_by uuid not null,
  activated_at timestamptz not null default now(),
  primary key (owner_id,domain)
);
revoke all on netunim_internal.storage_writer_protocol from public, anon, authenticated;

create function netunim_internal.guard_storage_writer_protocol_v2()
returns trigger language plpgsql security definer
set search_path to 'pg_catalog', 'netunim_internal'
as $function$
begin
  -- The JWT role remains authenticated inside SECURITY DEFINER restore RPCs.
  -- Service-side maintenance is not a browser writer and keeps its own controls.
  if auth.role() = 'authenticated'
     and exists (
       select 1 from netunim_internal.storage_writer_protocol p
       where p.owner_id = new.owner_id and p.domain = tg_argv[0]
         and p.min_writer_protocol >= 2
     )
     and coalesce(current_setting('app.netunim_storage_writer_protocol',true),'') <> '2' then
    raise exception 'storage_protocol_upgrade_required'
      using errcode = 'PT426',
            hint = 'Reload the current Storage V2 client before editing this account.';
  end if;
  return new;
end
$function$;
revoke all on function netunim_internal.guard_storage_writer_protocol_v2() from public, anon, authenticated;

create trigger order_management_storage_protocol_guard
before insert or update on public.order_management_documents for each row
execute function netunim_internal.guard_storage_writer_protocol_v2('orders');
create trigger kupa_storage_protocol_guard
before insert or update on public.kupa_documents for each row
execute function netunim_internal.guard_storage_writer_protocol_v2('kupa');
create trigger shared_checks_storage_protocol_guard
before insert or update on public.shared_checks_documents for each row
execute function netunim_internal.guard_storage_writer_protocol_v2('shared-checks');

-- A legacy tab must not stage a restore after activation. Otherwise a newer
-- client could discover and apply its stale group through the v6 entrypoint.
create function netunim_internal.guard_restore_storage_protocol_v2()
returns trigger language plpgsql security definer
set search_path to 'pg_catalog', 'netunim_internal'
as $function$
begin
  if auth.role() = 'authenticated'
     and exists (
       select 1 from netunim_internal.storage_writer_protocol p
       where p.owner_id=new.owner_id
         and p.domain in (new.app_site,'shared-checks')
         and p.min_writer_protocol>=2
     )
     and coalesce(current_setting('app.netunim_storage_writer_protocol',true),'') <> '2' then
    raise exception 'storage_protocol_upgrade_required' using errcode='PT426';
  end if;
  return new;
end
$function$;
revoke all on function netunim_internal.guard_restore_storage_protocol_v2() from public, anon, authenticated;
create trigger restore_group_storage_protocol_guard
before insert or update on netunim_internal.restore_operation_groups for each row
execute function netunim_internal.guard_restore_storage_protocol_v2();

-- SET on the function is scoped to this call and restored before control
-- returns to the caller. Legacy v5 calls cannot inherit a previous v6 call's
-- setting in the same transaction. The verified v5 implementation remains the
-- single source of revision, delete-intent, audit, backup and ledger behavior.
create function public.save_order_management_document_v6(
  p_document_name text,p_expected_revision bigint,p_state jsonb,p_operation_id text,p_delete_intents jsonb,p_audit jsonb)
returns table(revision bigint,updated_at timestamptz,state jsonb,operation_replayed boolean,operation_revision bigint)
language sql security invoker
set search_path to 'pg_catalog', 'public', 'netunim_internal'
set app.netunim_storage_writer_protocol to '2'
as $function$
  select * from public.save_order_management_document_v5(p_document_name,p_expected_revision,p_state,p_operation_id,p_delete_intents,p_audit)
$function$;
create function public.bulk_delete_save_order_management_document_v6(
  p_document_name text,p_expected_revision bigint,p_state jsonb,p_operation_id text,p_delete_intents jsonb,p_audit jsonb)
returns table(revision bigint,updated_at timestamptz,state jsonb,operation_replayed boolean,operation_revision bigint)
language sql security invoker
set search_path to 'pg_catalog', 'public', 'netunim_internal'
set app.netunim_storage_writer_protocol to '2'
as $function$
  select * from public.bulk_delete_save_order_management_document_v5(p_document_name,p_expected_revision,p_state,p_operation_id,p_delete_intents,p_audit)
$function$;
create function public.save_kupa_document_v6(
  p_document_name text,p_expected_revision bigint,p_state jsonb,p_operation_id text,p_delete_intents jsonb,p_audit jsonb)
returns table(revision bigint,updated_at timestamptz,state jsonb,operation_replayed boolean,operation_revision bigint)
language sql security invoker
set search_path to 'pg_catalog', 'public', 'netunim_internal'
set app.netunim_storage_writer_protocol to '2'
as $function$
  select * from public.save_kupa_document_v5(p_document_name,p_expected_revision,p_state,p_operation_id,p_delete_intents,p_audit)
$function$;
create function public.bulk_delete_save_kupa_document_v6(
  p_document_name text,p_expected_revision bigint,p_state jsonb,p_operation_id text,p_delete_intents jsonb,p_audit jsonb)
returns table(revision bigint,updated_at timestamptz,state jsonb,operation_replayed boolean,operation_revision bigint)
language sql security invoker
set search_path to 'pg_catalog', 'public', 'netunim_internal'
set app.netunim_storage_writer_protocol to '2'
as $function$
  select * from public.bulk_delete_save_kupa_document_v5(p_document_name,p_expected_revision,p_state,p_operation_id,p_delete_intents,p_audit)
$function$;
create function public.save_shared_checks_document_v6(
  p_document_name text,p_expected_revision bigint,p_state jsonb,p_operation_id text,p_deleted_check_ids jsonb,p_audit jsonb)
returns table(revision bigint,updated_at timestamptz,state jsonb,operation_replayed boolean,operation_revision bigint)
language sql security invoker
set search_path to 'pg_catalog', 'public', 'netunim_internal'
set app.netunim_storage_writer_protocol to '2'
as $function$
  select * from public.save_shared_checks_document_v5(p_document_name,p_expected_revision,p_state,p_operation_id,p_deleted_check_ids,p_audit)
$function$;
create function public.bulk_delete_save_shared_checks_document_v6(
  p_document_name text,p_expected_revision bigint,p_state jsonb,p_operation_id text,p_deleted_check_ids jsonb,p_audit jsonb)
returns table(revision bigint,updated_at timestamptz,state jsonb,operation_replayed boolean,operation_revision bigint)
language sql security invoker
set search_path to 'pg_catalog', 'public', 'netunim_internal'
set app.netunim_storage_writer_protocol to '2'
as $function$
  select * from public.bulk_delete_save_shared_checks_document_v5(p_document_name,p_expected_revision,p_state,p_operation_id,p_deleted_check_ids,p_audit)
$function$;
create function public.apply_restore_group_v6(p_restore_group_id uuid)
returns table(restore_group_id uuid,phase text,main_revision bigint,checks_revision bigint)
language sql security invoker
set search_path to 'pg_catalog', 'public', 'netunim_internal'
set app.netunim_storage_writer_protocol to '2'
as $function$
  select * from public.apply_restore_group_v5(p_restore_group_id)
$function$;
create function public.stage_restore_group_v6(
  p_restore_group_id uuid,p_app_site text,p_main_document_name text,p_main_base_revision bigint,
  p_main_state jsonb,p_main_delete_intents jsonb,p_checks_document_name text,p_checks_base_revision bigint,
  p_checks_state jsonb,p_checks_delete_ids jsonb,p_main_operation_id text,p_checks_operation_id text,p_audit jsonb)
returns table(restore_group_id uuid,phase text)
language sql security invoker
set search_path to 'pg_catalog', 'public', 'netunim_internal'
set app.netunim_storage_writer_protocol to '2'
as $function$
  select * from public.stage_restore_group_v5(p_restore_group_id,p_app_site,p_main_document_name,p_main_base_revision,
    p_main_state,p_main_delete_intents,p_checks_document_name,p_checks_base_revision,p_checks_state,p_checks_delete_ids,
    p_main_operation_id,p_checks_operation_id,p_audit)
$function$;

revoke all on function public.save_order_management_document_v6(text,bigint,jsonb,text,jsonb,jsonb) from public, anon;
revoke all on function public.bulk_delete_save_order_management_document_v6(text,bigint,jsonb,text,jsonb,jsonb) from public, anon;
revoke all on function public.save_kupa_document_v6(text,bigint,jsonb,text,jsonb,jsonb) from public, anon;
revoke all on function public.bulk_delete_save_kupa_document_v6(text,bigint,jsonb,text,jsonb,jsonb) from public, anon;
revoke all on function public.save_shared_checks_document_v6(text,bigint,jsonb,text,jsonb,jsonb) from public, anon;
revoke all on function public.bulk_delete_save_shared_checks_document_v6(text,bigint,jsonb,text,jsonb,jsonb) from public, anon;
revoke all on function public.apply_restore_group_v6(uuid) from public, anon;
revoke all on function public.stage_restore_group_v6(uuid,text,text,bigint,jsonb,jsonb,text,bigint,jsonb,jsonb,text,text,jsonb) from public, anon;
grant execute on function public.save_order_management_document_v6(text,bigint,jsonb,text,jsonb,jsonb) to authenticated, service_role;
grant execute on function public.bulk_delete_save_order_management_document_v6(text,bigint,jsonb,text,jsonb,jsonb) to authenticated, service_role;
grant execute on function public.save_kupa_document_v6(text,bigint,jsonb,text,jsonb,jsonb) to authenticated, service_role;
grant execute on function public.bulk_delete_save_kupa_document_v6(text,bigint,jsonb,text,jsonb,jsonb) to authenticated, service_role;
grant execute on function public.save_shared_checks_document_v6(text,bigint,jsonb,text,jsonb,jsonb) to authenticated, service_role;
grant execute on function public.bulk_delete_save_shared_checks_document_v6(text,bigint,jsonb,text,jsonb,jsonb) to authenticated, service_role;
grant execute on function public.apply_restore_group_v6(uuid) to authenticated, service_role;
grant execute on function public.stage_restore_group_v6(uuid,text,text,bigint,jsonb,jsonb,text,bigint,jsonb,jsonb,text,text,jsonb) to authenticated, service_role;

create function public.get_storage_protocol_state()
returns jsonb language plpgsql stable security definer
set search_path to 'pg_catalog', 'netunim_internal'
as $function$
declare v_owner uuid:=auth.uid();v_result jsonb;
begin
  if v_owner is null then raise exception 'not_authenticated' using errcode='42501';end if;
  select jsonb_build_object(
    'orders',coalesce(max(p.min_writer_protocol) filter (where p.domain='orders'),1),
    'kupa',coalesce(max(p.min_writer_protocol) filter (where p.domain='kupa'),1),
    'sharedChecks',coalesce(max(p.min_writer_protocol) filter (where p.domain='shared-checks'),1))
  into v_result from netunim_internal.storage_writer_protocol p where p.owner_id=v_owner;
  return v_result;
end
$function$;
revoke all on function public.get_storage_protocol_state() from public, anon;
grant execute on function public.get_storage_protocol_state() to authenticated, service_role;

create function public.activate_storage_protocol_v2(
  p_orders_revision bigint,p_kupa_revision bigint,p_shared_revision bigint)
returns jsonb language plpgsql security definer
set search_path to 'pg_catalog', 'public', 'netunim_internal'
as $function$
declare
  v_owner uuid:=auth.uid();v_count integer;v_orders bigint;v_kupa bigint;v_shared bigint;
begin
  if v_owner is null then raise exception 'not_authenticated' using errcode='42501';end if;
  if p_orders_revision is null or p_orders_revision<1 or p_kupa_revision is null or p_kupa_revision<1
     or p_shared_revision is null or p_shared_revision<1 then
    raise exception 'storage_protocol_revisions_required' using errcode='22023';
  end if;
  -- Same advisory-lock order as ordinary Orders then financial writes. This
  -- serializes activation with saves before comparing the supplied heads.
  perform pg_advisory_xact_lock(hashtextextended('order_management:'||v_owner::text||':suppliers',0));
  perform pg_advisory_xact_lock(hashtextextended('netunim_financial_write:'||v_owner::text,0));
  select count(*) into v_count from netunim_internal.storage_writer_protocol where owner_id=v_owner;
  if v_count=3 then return public.get_storage_protocol_state();end if;
  if v_count<>0 then raise exception 'storage_protocol_partial_activation' using errcode='PT409';end if;
  if exists(select 1 from netunim_internal.restore_operation_groups g where g.owner_id=v_owner and g.phase<>'completed') then
    raise exception 'storage_protocol_restore_pending' using errcode='PT409';
  end if;
  select d.revision into v_orders from public.order_management_documents d
    where d.owner_id=v_owner and d.document_name='suppliers';
  select d.revision into v_kupa from public.kupa_documents d
    where d.owner_id=v_owner and d.document_name='main';
  select d.revision into v_shared from public.shared_checks_documents d
    where d.owner_id=v_owner and d.document_name='main';
  if v_orders is distinct from p_orders_revision or v_kupa is distinct from p_kupa_revision
     or v_shared is distinct from p_shared_revision then
    raise exception 'storage_protocol_cloud_heads_changed' using errcode='PT409';
  end if;
  insert into netunim_internal.storage_writer_protocol
    (owner_id,domain,min_writer_protocol,activated_revision,activated_by)
  values (v_owner,'orders',2,v_orders,v_owner),
         (v_owner,'kupa',2,v_kupa,v_owner),
         (v_owner,'shared-checks',2,v_shared,v_owner);
  return public.get_storage_protocol_state();
end
$function$;
revoke all on function public.activate_storage_protocol_v2(bigint,bigint,bigint) from public, anon;
grant execute on function public.activate_storage_protocol_v2(bigint,bigint,bigint) to authenticated, service_role;

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
 'financeFencing',case when to_regprocedure('public.save_bank_sync_snapshot(text,jsonb,text,bigint,text,text,bigint)') is not null and to_regprocedure('public.save_finance_sync_document_v5(text,bigint,jsonb,text,jsonb,text,text,bigint)') is not null then 1 else 0 end,
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
