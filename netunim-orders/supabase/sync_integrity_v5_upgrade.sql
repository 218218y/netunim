-- Sync/data-integrity hardening v5.
-- Additive metadata/tables/functions only. Existing business rows and backup history are not rewritten.
-- Routine deletion policy follows the UI contract: one/two independently confirmed deletions may
-- coalesce in autosave; 10 absolute removals, or 3+ removals covering at least 50% of a collection,
-- require the dedicated bulk-delete/restore RPC.
begin;

create schema if not exists netunim_internal;
revoke all on schema netunim_internal from public, anon;
grant usage on schema netunim_internal to authenticated;

do $prerequisites$
declare v_missing text[];
begin
  select array_agg(signature) into v_missing from unnest(array[
    'public.save_order_management_document_v4(text,bigint,jsonb,text,jsonb)',
    'public.save_kupa_document_v4(text,bigint,jsonb,text,jsonb)',
    'public.save_shared_checks_document_v4(text,bigint,jsonb,text,jsonb)',
    'public.save_finance_sync_document_v3(text,bigint,jsonb,text)',
    'netunim_internal.save_order_management_document(text,bigint,jsonb)',
    'netunim_internal.save_kupa_document(text,bigint,jsonb)',
    'netunim_internal.save_shared_checks_document(text,bigint,jsonb)',
    'netunim_internal.canonical_delete_intents(jsonb,text[])',
    'netunim_internal.prune_sync_operation_ledgers()'
  ]) signature where to_regprocedure(signature) is null;
  if v_missing is not null then raise exception 'sync_integrity_v5_missing_prerequisites: %',v_missing;end if;
  if to_regclass('netunim_internal.document_sync_operations') is null
     or to_regclass('public.order_management_documents') is null
     or to_regclass('public.kupa_documents') is null
     or to_regclass('public.shared_checks_documents') is null
     or to_regclass('public.finance_sync_documents') is null then raise exception 'sync_integrity_v5_missing_document_tables';end if;
end
$prerequisites$;

alter table netunim_internal.document_sync_operations
  add column if not exists client_instance_id text,
  add column if not exists app_site text,
  add column if not exists build_version text,
  add column if not exists mutation_type text,
  add column if not exists surface text,
  add column if not exists base_revision bigint,
  add column if not exists before_counts jsonb,
  add column if not exists after_counts jsonb,
  add column if not exists delete_count integer,
  add column if not exists restore_group_id uuid,
  add column if not exists audit_timestamp timestamptz;

create table if not exists netunim_internal.safety_snapshots (
  owner_id uuid not null references auth.users(id) on delete cascade,
  domain text not null,
  document_name text not null,
  operation_id text not null,
  restore_group_id uuid,
  revision bigint not null check (revision > 0),
  state jsonb not null check (jsonb_typeof(state)='object'),
  operation_kind text not null check (operation_kind in ('bulk-delete','restore','destructive-migration')),
  created_at timestamptz not null default now(),
  primary key(owner_id,domain,document_name,operation_id)
);
alter table netunim_internal.safety_snapshots enable row level security;
drop policy if exists "safety_snapshots_select_own" on netunim_internal.safety_snapshots;
create policy "safety_snapshots_select_own" on netunim_internal.safety_snapshots
for select to authenticated using ((select auth.uid())=owner_id);
drop policy if exists "safety_snapshots_insert_own" on netunim_internal.safety_snapshots;
revoke all on table netunim_internal.safety_snapshots from public,anon,authenticated;
grant select on table netunim_internal.safety_snapshots to authenticated;
revoke update,delete,truncate on table netunim_internal.safety_snapshots from public,anon,authenticated;

create table if not exists netunim_internal.restore_operation_groups (
  owner_id uuid not null references auth.users(id) on delete cascade,
  restore_group_id uuid not null,
  app_site text not null check (app_site in ('kupa','orders')),
  main_document_name text not null,
  main_base_revision bigint not null check (main_base_revision >= 0),
  checks_document_name text not null default 'main',
  checks_base_revision bigint,
  main_state jsonb not null check (jsonb_typeof(main_state)='object'),
  checks_state jsonb,
  main_delete_intents jsonb not null default '{}'::jsonb,
  checks_delete_ids jsonb not null default '[]'::jsonb,
  main_payload_sha256 text not null,
  checks_payload_sha256 text,
  main_operation_id text not null,
  checks_operation_id text,
  phase text not null check (phase in ('staged','main_pending','main_acked','checks_pending','checks_acked','completed')),
  audit jsonb not null default '{}'::jsonb,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key(owner_id,restore_group_id)
);
alter table netunim_internal.restore_operation_groups enable row level security;
drop policy if exists "restore_groups_select_own" on netunim_internal.restore_operation_groups;
create policy "restore_groups_select_own" on netunim_internal.restore_operation_groups
for select to authenticated using ((select auth.uid())=owner_id);
drop policy if exists "restore_groups_insert_own" on netunim_internal.restore_operation_groups;
drop policy if exists "restore_groups_update_own" on netunim_internal.restore_operation_groups;
revoke all on table netunim_internal.restore_operation_groups from public,anon,authenticated;
grant select on table netunim_internal.restore_operation_groups to authenticated;
revoke delete,truncate on table netunim_internal.restore_operation_groups from public,anon,authenticated;

create or replace function netunim_internal.assert_entity_array_ids(p_state jsonb,p_path text[],p_required boolean default true)
returns void language plpgsql immutable security invoker set search_path=pg_catalog as $validator$
declare v_rows jsonb;v_path text:=array_to_string(p_path,'.');
begin
  v_rows:=p_state#>p_path;
  if v_rows is null and not p_required then return; end if;
  if jsonb_typeof(v_rows) is distinct from 'array' then
    raise exception 'entity_collection_required' using errcode='22023',detail=v_path;
  end if;
  if exists(select 1 from jsonb_array_elements(v_rows) r(value)
    where jsonb_typeof(r.value) is distinct from 'object'
       or jsonb_typeof(r.value->'id') is distinct from 'string'
       or nullif(btrim(r.value->>'id'),'') is null
       or r.value->>'id' is distinct from btrim(r.value->>'id')) then
    raise exception 'entity_id_missing_or_blank' using errcode='22023',detail=v_path;
  end if;
  if exists(select 1 from (
    select btrim(r.value->>'id') id,count(*) n from jsonb_array_elements(v_rows) r(value)
    group by btrim(r.value->>'id') having count(*)>1
  ) duplicates) then
    raise exception 'duplicate_entity_id' using errcode='22023',detail=v_path;
  end if;
end
$validator$;

create or replace function netunim_internal.assert_document_invariants(p_domain text,p_state jsonb)
returns void language plpgsql immutable security invoker set search_path=pg_catalog,netunim_internal as $validator$
declare v_path text;
begin
  if p_state is null or jsonb_typeof(p_state) is distinct from 'object' then
    raise exception 'invalid_document_state' using errcode='22023',detail=p_domain;
  end if;
  if p_domain='orders' then
    if p_state?'checks' then raise exception 'orders_state_contains_checks' using errcode='22023'; end if;
    foreach v_path in array array[
      'suppliers','transactions','customerDebts','customerOrders',
      'serviceCalls','notes','inventoryItems','inventoryEvents','warehouseOrders'
    ] loop perform netunim_internal.assert_entity_array_ids(p_state,string_to_array(v_path,'.'),true);end loop;
    if jsonb_typeof(p_state->'inventoryCategoryOrder') is distinct from 'array' then raise exception 'invalid_order_configuration' using errcode='22023';end if;
  elsif p_domain='kupa' then
    if p_state?'checks' then raise exception 'kupa_state_contains_checks' using errcode='22023'; end if;
    foreach v_path in array array[
      'credits','cash','rights','notes','expenses','cards','notesSheet.rows','notesSheet.columns'
    ] loop perform netunim_internal.assert_entity_array_ids(p_state,string_to_array(v_path,'.'),true);end loop;
    if jsonb_typeof(p_state->'bank') is distinct from 'object'
       or jsonb_typeof(p_state#>'{bank,adjustments}') is distinct from 'array' then
      raise exception 'invalid_kupa_bank_state' using errcode='22023';
    end if;
  elsif p_domain='shared-checks' then
    perform netunim_internal.assert_entity_array_ids(p_state,array['checks'],true);
    if jsonb_typeof(p_state->'bankEvents') is distinct from 'array' then raise exception 'invalid_shared_checks_events' using errcode='22023';end if;
  else raise exception 'invalid_document_domain' using errcode='22023',detail=p_domain;
  end if;
end
$validator$;

revoke all on function netunim_internal.assert_entity_array_ids(jsonb,text[],boolean) from public,anon;
revoke all on function netunim_internal.assert_document_invariants(text,jsonb) from public,anon;
grant execute on function netunim_internal.assert_entity_array_ids(jsonb,text[],boolean) to authenticated;
grant execute on function netunim_internal.assert_document_invariants(text,jsonb) to authenticated;

create or replace function netunim_internal.document_invariant_guard()
returns trigger language plpgsql security invoker set search_path=pg_catalog,netunim_internal as $guard$
declare v_domain text;
begin
  v_domain:=case tg_table_name
    when 'order_management_documents' then 'orders'
    when 'kupa_documents' then 'kupa'
    when 'shared_checks_documents' then 'shared-checks' end;
  if v_domain is null then raise exception 'unknown_invariant_table' using errcode='22023';end if;
  perform netunim_internal.assert_document_invariants(v_domain,new.state);return new;
end
$guard$;
revoke all on function netunim_internal.document_invariant_guard() from public,anon;
grant execute on function netunim_internal.document_invariant_guard() to authenticated;

do $invariant_triggers$
declare v_table text;
begin
  foreach v_table in array array['order_management_documents','kupa_documents','shared_checks_documents'] loop
    execute format('drop trigger if exists %I on public.%I',v_table||'_invariant_guard',v_table);
    execute format('create trigger %I before insert or update on public.%I for each row execute function netunim_internal.document_invariant_guard()',v_table||'_invariant_guard',v_table);
  end loop;
end
$invariant_triggers$;

create or replace function netunim_internal.mass_destructive_guard()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $guard$
declare
  v_paths text[];v_path text;v_old jsonb;v_new jsonb;v_removed integer;v_old_count integer;
  v_mode text:=coalesce(current_setting('app.destructive_operation_kind',true),'');
  v_absolute_threshold constant integer:=10;
  v_percentage_min_count constant integer:=3;
  v_percentage_threshold constant numeric:=0.50;
begin
  if tg_op<>'UPDATE' or v_mode in ('bulk-delete','restore','destructive-migration') then return new;end if;
  if tg_table_name='order_management_documents' then
    v_paths:=array['suppliers','transactions','customerDebts','customerOrders','serviceCalls','notes','inventoryItems','inventoryEvents','warehouseOrders'];
  elsif tg_table_name='kupa_documents' then
    v_paths:=array['credits','cash','rights','notes','expenses','cards','notesSheet.rows','notesSheet.columns'];
  else v_paths:=array['checks'];end if;
  foreach v_path in array v_paths loop
    v_old:=case when jsonb_typeof(old.state#>string_to_array(v_path,'.'))='array' then old.state#>string_to_array(v_path,'.') else '[]'::jsonb end;
    v_new:=case when jsonb_typeof(new.state#>string_to_array(v_path,'.'))='array' then new.state#>string_to_array(v_path,'.') else '[]'::jsonb end;
    v_old_count:=jsonb_array_length(v_old);
    select count(*) into v_removed from jsonb_array_elements(v_old) o(value)
      where nullif(btrim(o.value->>'id'),'') is not null
        and not exists(select 1 from jsonb_array_elements(v_new) n(value) where btrim(n.value->>'id')=btrim(o.value->>'id'));
    if v_removed>=v_absolute_threshold
       or (v_removed>=v_percentage_min_count and v_old_count>0 and v_removed::numeric/v_old_count>=v_percentage_threshold) then
      raise exception 'mass_delete_requires_dedicated_rpc' using errcode='PT422',detail=v_path,
        hint='Use the dedicated approved bulk-delete or restore RPC.';
    end if;
  end loop;
  return new;
end
$guard$;
revoke all on function netunim_internal.mass_destructive_guard() from public,anon;
grant execute on function netunim_internal.mass_destructive_guard() to authenticated;
drop trigger if exists order_management_mass_destructive_guard on public.order_management_documents;
create trigger order_management_mass_destructive_guard before update on public.order_management_documents for each row execute function netunim_internal.mass_destructive_guard();
drop trigger if exists kupa_mass_destructive_guard on public.kupa_documents;
create trigger kupa_mass_destructive_guard before update on public.kupa_documents for each row execute function netunim_internal.mass_destructive_guard();
drop trigger if exists shared_checks_mass_destructive_guard on public.shared_checks_documents;
create trigger shared_checks_mass_destructive_guard before update on public.shared_checks_documents for each row execute function netunim_internal.mass_destructive_guard();

-- Cards are persistent user configuration. v5 carries their exact intent in a
-- separate transaction-local channel, so the deployed v4 function stays unchanged.
create or replace function netunim_internal.kupa_delete_intent_guard()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public,netunim_internal as $guard$
declare
  v_v4_allowed constant text[]:=array['credits','cash','rights','notes','expenses','notesSheet.rows','notesSheet.columns'];
  v_allowed constant text[]:=array['credits','cash','rights','notes','expenses','notesSheet.rows','notesSheet.columns','cards'];
  v_key text;v_old jsonb;v_new jsonb;v_removed jsonb;v_actual jsonb:='{}'::jsonb;v_intended jsonb;v_raw text;v_cards_raw text;
begin
  if tg_op<>'UPDATE' then return new;end if;
  foreach v_key in array v_allowed loop
    if v_key='notesSheet.rows' then v_old:=case when jsonb_typeof(old.state#>'{notesSheet,rows}')='array' then old.state#>'{notesSheet,rows}' else '[]'::jsonb end;v_new:=case when jsonb_typeof(new.state#>'{notesSheet,rows}')='array' then new.state#>'{notesSheet,rows}' else '[]'::jsonb end;
    elsif v_key='notesSheet.columns' then v_old:=case when jsonb_typeof(old.state#>'{notesSheet,columns}')='array' then old.state#>'{notesSheet,columns}' else '[]'::jsonb end;v_new:=case when jsonb_typeof(new.state#>'{notesSheet,columns}')='array' then new.state#>'{notesSheet,columns}' else '[]'::jsonb end;
    else v_old:=case when jsonb_typeof(old.state->v_key)='array' then old.state->v_key else '[]'::jsonb end;v_new:=case when jsonb_typeof(new.state->v_key)='array' then new.state->v_key else '[]'::jsonb end;end if;
    select coalesce(jsonb_agg(id order by id),'[]'::jsonb) into v_removed from (
      select btrim(o.value->>'id') id from jsonb_array_elements(v_old) o(value)
      where nullif(btrim(o.value->>'id'),'') is not null
        and not exists(select 1 from jsonb_array_elements(v_new) n(value) where btrim(n.value->>'id')=btrim(o.value->>'id'))
    ) removed;
    if jsonb_array_length(v_removed)>0 then v_actual:=v_actual||jsonb_build_object(v_key,v_removed);end if;
  end loop;
  v_raw:=nullif(current_setting('app.kupa_delete_intents',true),'');
  v_cards_raw:=nullif(current_setting('app.kupa_cards_delete_intents',true),'');
  v_intended:=netunim_internal.canonical_delete_intents(coalesce(v_raw::jsonb,'{}'::jsonb),v_v4_allowed)
    ||netunim_internal.canonical_delete_intents(jsonb_build_object('cards',coalesce(v_cards_raw::jsonb,'[]'::jsonb)),array['cards']);
  if v_actual is distinct from v_intended then raise exception 'kupa_delete_intent_mismatch' using errcode='PT422';end if;
  return new;
end
$guard$;
revoke all on function netunim_internal.kupa_delete_intent_guard() from public,anon;
grant execute on function netunim_internal.kupa_delete_intent_guard() to authenticated;

create or replace function netunim_internal.json_collection_counts(p_state jsonb,p_paths text[])
returns jsonb language plpgsql immutable security invoker set search_path=pg_catalog as $counts$
declare v_path text;v_out jsonb:='{}'::jsonb;v_value jsonb;
begin
  foreach v_path in array p_paths loop
    v_value:=p_state#>string_to_array(v_path,'.');
    v_out:=v_out||jsonb_build_object(v_path,case when jsonb_typeof(v_value)='array' then jsonb_array_length(v_value) else 0 end);
  end loop;
  return v_out;
end
$counts$;

create or replace function netunim_internal.record_operation_audit(
  p_owner uuid,p_domain text,p_document_name text,p_operation_id text,p_audit jsonb,p_before jsonb,p_after jsonb,p_paths text[],p_restore_group_id uuid default null
) returns void language plpgsql security definer set search_path=pg_catalog,netunim_internal as $audit$
declare v_meta jsonb:=coalesce(p_audit,'{}'::jsonb);v_delete_count integer;
begin
  if auth.uid() is null or p_owner is distinct from auth.uid() then raise exception 'audit_owner_mismatch' using errcode='42501';end if;
  select coalesce(sum(greatest(0,(b.value::text)::integer-(a.value::text)::integer)),0)::integer into v_delete_count
  from jsonb_each(netunim_internal.json_collection_counts(p_before,p_paths)) b
  join jsonb_each(netunim_internal.json_collection_counts(p_after,p_paths)) a using(key);
  update netunim_internal.document_sync_operations o set
    client_instance_id=coalesce(o.client_instance_id,left(nullif(v_meta->>'clientInstanceId',''),200)),
    app_site=coalesce(o.app_site,case when v_meta->>'app' in ('kupa','orders') then v_meta->>'app' else 'unknown' end),
    build_version=coalesce(o.build_version,left(nullif(v_meta->>'build',''),80)),
    mutation_type=coalesce(o.mutation_type,left(nullif(v_meta->>'mutationType',''),80)),
    surface=coalesce(o.surface,left(nullif(v_meta->>'surface',''),120)),
    base_revision=coalesce(o.base_revision,case when (v_meta->>'baseRevision')~'^\d+$' then (v_meta->>'baseRevision')::bigint else null end),
    before_counts=coalesce(o.before_counts,netunim_internal.json_collection_counts(p_before,p_paths)),
    after_counts=coalesce(o.after_counts,netunim_internal.json_collection_counts(p_after,p_paths)),
    delete_count=coalesce(o.delete_count,v_delete_count),
    restore_group_id=coalesce(o.restore_group_id,p_restore_group_id),
    audit_timestamp=coalesce(o.audit_timestamp,now())
  where o.owner_id=p_owner and o.domain=p_domain and o.document_name=p_document_name and o.operation_id=p_operation_id;
end
$audit$;

revoke all on function netunim_internal.json_collection_counts(jsonb,text[]) from public,anon;
revoke all on function netunim_internal.record_operation_audit(uuid,text,text,text,jsonb,jsonb,jsonb,text[],uuid) from public,anon;
grant execute on function netunim_internal.json_collection_counts(jsonb,text[]) to authenticated;
grant execute on function netunim_internal.record_operation_audit(uuid,text,text,text,jsonb,jsonb,jsonb,text[],uuid) to authenticated;
revoke update,delete,truncate on table netunim_internal.document_sync_operations from public,anon,authenticated;

create or replace function public.save_order_management_document_v5(p_document_name text,p_expected_revision bigint,p_state jsonb,p_operation_id text,p_delete_intents jsonb,p_audit jsonb)
returns table(revision bigint,updated_at timestamptz,state jsonb,operation_replayed boolean,operation_revision bigint)
language plpgsql security invoker set search_path=pg_catalog,public,netunim_internal as $save$
declare v_owner uuid:=auth.uid();v_before jsonb;v_result record;v_paths text[]:=array['suppliers','transactions','customerDebts','customerOrders','serviceCalls','notes','inventoryItems','inventoryEvents','warehouseOrders'];
begin
  if v_owner is null then raise exception 'not_authenticated' using errcode='42501';end if;
  perform netunim_internal.assert_document_invariants('orders',p_state);
  select d.state into v_before from public.order_management_documents d where d.owner_id=v_owner and d.document_name=p_document_name;
  select * into v_result from public.save_order_management_document_v4(p_document_name,p_expected_revision,p_state,p_operation_id,p_delete_intents);
  perform netunim_internal.record_operation_audit(v_owner,'orders',p_document_name,p_operation_id,coalesce(p_audit,'{}'::jsonb)||jsonb_build_object('baseRevision',p_expected_revision),coalesce(v_before,p_state),v_result.state,v_paths,null);
  return query select v_result.revision,v_result.updated_at,v_result.state,v_result.operation_replayed,v_result.operation_revision;
end
$save$;

create or replace function public.save_kupa_document_v5(p_document_name text,p_expected_revision bigint,p_state jsonb,p_operation_id text,p_delete_intents jsonb,p_audit jsonb)
returns table(revision bigint,updated_at timestamptz,state jsonb,operation_replayed boolean,operation_revision bigint)
language plpgsql security invoker set search_path=pg_catalog,public,netunim_internal as $save$
declare v_owner uuid:=auth.uid();v_before jsonb;v_result record;v_paths text[]:=array['credits','cash','rights','notes','expenses','cards','notesSheet.rows','notesSheet.columns'];
begin
  if v_owner is null then raise exception 'not_authenticated' using errcode='42501';end if;
  perform netunim_internal.assert_document_invariants('kupa',p_state);
  select d.state into v_before from public.kupa_documents d where d.owner_id=v_owner and d.document_name=p_document_name;
  perform set_config('app.kupa_cards_delete_intents',coalesce(p_delete_intents->'cards','[]'::jsonb)::text,true);
  select * into v_result from public.save_kupa_document_v4(p_document_name,p_expected_revision,p_state,p_operation_id,coalesce(p_delete_intents,'{}'::jsonb)-'cards');
  perform set_config('app.kupa_cards_delete_intents','[]',true);
  perform netunim_internal.record_operation_audit(v_owner,'kupa',p_document_name,p_operation_id,coalesce(p_audit,'{}'::jsonb)||jsonb_build_object('baseRevision',p_expected_revision),coalesce(v_before,p_state),v_result.state,v_paths,null);
  return query select v_result.revision,v_result.updated_at,v_result.state,v_result.operation_replayed,v_result.operation_revision;
end
$save$;

create or replace function public.save_finance_sync_document_v5(p_document_name text,p_expected_revision bigint,p_state jsonb,p_operation_id text,p_audit jsonb)
returns table(revision bigint,updated_at timestamptz,state jsonb,operation_replayed boolean,operation_revision bigint)
language plpgsql security invoker set search_path=pg_catalog,public,netunim_internal as $save$
declare v_owner uuid:=auth.uid();v_before jsonb;v_result record;v_paths text[]:=array[]::text[];
begin
  if v_owner is null then raise exception 'not_authenticated' using errcode='42501';end if;
  if p_state is null or jsonb_typeof(p_state) is distinct from 'object' then raise exception 'invalid_finance_state' using errcode='22023';end if;
  select d.state into v_before from public.finance_sync_documents d where d.owner_id=v_owner and d.document_name=p_document_name;
  select * into v_result from public.save_finance_sync_document_v3(p_document_name,p_expected_revision,p_state,p_operation_id);
  perform netunim_internal.record_operation_audit(v_owner,'finance',p_document_name,p_operation_id,coalesce(p_audit,'{}'::jsonb)||jsonb_build_object('baseRevision',p_expected_revision),coalesce(v_before,p_state),v_result.state,v_paths,null);
  return query select v_result.revision,v_result.updated_at,v_result.state,v_result.operation_replayed,v_result.operation_revision;
end
$save$;

create or replace function public.save_shared_checks_document_v5(p_document_name text,p_expected_revision bigint,p_state jsonb,p_operation_id text,p_deleted_check_ids jsonb,p_audit jsonb)
returns table(revision bigint,updated_at timestamptz,state jsonb,operation_replayed boolean,operation_revision bigint)
language plpgsql security invoker set search_path=pg_catalog,public,netunim_internal as $save$
declare v_owner uuid:=auth.uid();v_before jsonb;v_result record;v_paths text[]:=array['checks'];
begin
  if v_owner is null then raise exception 'not_authenticated' using errcode='42501';end if;
  if jsonb_typeof(p_state->'bankEvents') is distinct from 'array' then p_state:=p_state||jsonb_build_object('bankEvents','[]'::jsonb);end if;
  perform netunim_internal.assert_document_invariants('shared-checks',p_state);
  select d.state into v_before from public.shared_checks_documents d where d.owner_id=v_owner and d.document_name=p_document_name;
  select * into v_result from public.save_shared_checks_document_v4(p_document_name,p_expected_revision,p_state,p_operation_id,p_deleted_check_ids);
  perform netunim_internal.record_operation_audit(v_owner,'shared-checks',p_document_name,p_operation_id,coalesce(p_audit,'{}'::jsonb)||jsonb_build_object('baseRevision',p_expected_revision),coalesce(v_before,p_state),v_result.state,v_paths,null);
  return query select v_result.revision,v_result.updated_at,v_result.state,v_result.operation_replayed,v_result.operation_revision;
end
$save$;

create or replace function netunim_internal.capture_safety_snapshot(p_owner uuid,p_domain text,p_document_name text,p_operation_id text,p_kind text,p_restore_group_id uuid default null)
returns void language plpgsql security definer set search_path=pg_catalog,public,netunim_internal as $snapshot$
declare v_revision bigint;v_state jsonb;
begin
  if auth.uid() is null or p_owner is distinct from auth.uid() then raise exception 'snapshot_owner_mismatch' using errcode='42501';end if;
  if p_domain='orders' then select revision,state into v_revision,v_state from public.order_management_documents where owner_id=p_owner and document_name=p_document_name;
  elsif p_domain='kupa' then select revision,state into v_revision,v_state from public.kupa_documents where owner_id=p_owner and document_name=p_document_name;
  elsif p_domain='shared-checks' then select revision,state into v_revision,v_state from public.shared_checks_documents where owner_id=p_owner and document_name=p_document_name;
  else raise exception 'invalid_document_domain' using errcode='22023';end if;
  if v_revision is not null then insert into netunim_internal.safety_snapshots(owner_id,domain,document_name,operation_id,restore_group_id,revision,state,operation_kind)
    values(p_owner,p_domain,p_document_name,p_operation_id,p_restore_group_id,v_revision,v_state,p_kind) on conflict do nothing;end if;
end
$snapshot$;
revoke all on function netunim_internal.capture_safety_snapshot(uuid,text,text,text,text,uuid) from public,anon;
grant execute on function netunim_internal.capture_safety_snapshot(uuid,text,text,text,text,uuid) to authenticated;

create or replace function public.bulk_delete_save_order_management_document_v5(p_document_name text,p_expected_revision bigint,p_state jsonb,p_operation_id text,p_delete_intents jsonb,p_audit jsonb)
returns table(revision bigint,updated_at timestamptz,state jsonb,operation_replayed boolean,operation_revision bigint)
language plpgsql security invoker set search_path=pg_catalog,public,netunim_internal as $bulk$
declare v_owner uuid:=auth.uid();v_result record;
begin
  if v_owner is null then raise exception 'not_authenticated' using errcode='42501';end if;
  perform set_config('app.destructive_operation_kind','bulk-delete',true);
  perform netunim_internal.capture_safety_snapshot(v_owner,'orders',p_document_name,p_operation_id,'bulk-delete');
  select * into v_result from public.save_order_management_document_v5(p_document_name,p_expected_revision,p_state,p_operation_id,p_delete_intents,coalesce(p_audit,'{}'::jsonb)||jsonb_build_object('mutationType','bulk-delete'));
  perform set_config('app.destructive_operation_kind','',true);
  return query select v_result.revision,v_result.updated_at,v_result.state,v_result.operation_replayed,v_result.operation_revision;
end
$bulk$;

create or replace function public.bulk_delete_save_kupa_document_v5(p_document_name text,p_expected_revision bigint,p_state jsonb,p_operation_id text,p_delete_intents jsonb,p_audit jsonb)
returns table(revision bigint,updated_at timestamptz,state jsonb,operation_replayed boolean,operation_revision bigint)
language plpgsql security invoker set search_path=pg_catalog,public,netunim_internal as $bulk$
declare v_owner uuid:=auth.uid();v_result record;
begin
  if v_owner is null then raise exception 'not_authenticated' using errcode='42501';end if;
  perform set_config('app.destructive_operation_kind','bulk-delete',true);
  perform netunim_internal.capture_safety_snapshot(v_owner,'kupa',p_document_name,p_operation_id,'bulk-delete');
  select * into v_result from public.save_kupa_document_v5(p_document_name,p_expected_revision,p_state,p_operation_id,p_delete_intents,coalesce(p_audit,'{}'::jsonb)||jsonb_build_object('mutationType','bulk-delete'));
  perform set_config('app.destructive_operation_kind','',true);
  return query select v_result.revision,v_result.updated_at,v_result.state,v_result.operation_replayed,v_result.operation_revision;
end
$bulk$;

create or replace function public.bulk_delete_save_shared_checks_document_v5(p_document_name text,p_expected_revision bigint,p_state jsonb,p_operation_id text,p_deleted_check_ids jsonb,p_audit jsonb)
returns table(revision bigint,updated_at timestamptz,state jsonb,operation_replayed boolean,operation_revision bigint)
language plpgsql security invoker set search_path=pg_catalog,public,netunim_internal as $bulk$
declare v_owner uuid:=auth.uid();v_result record;
begin
  if v_owner is null then raise exception 'not_authenticated' using errcode='42501';end if;
  perform set_config('app.destructive_operation_kind','bulk-delete',true);
  perform netunim_internal.capture_safety_snapshot(v_owner,'shared-checks',p_document_name,p_operation_id,'bulk-delete');
  select * into v_result from public.save_shared_checks_document_v5(p_document_name,p_expected_revision,p_state,p_operation_id,p_deleted_check_ids,coalesce(p_audit,'{}'::jsonb)||jsonb_build_object('mutationType','bulk-delete'));
  perform set_config('app.destructive_operation_kind','',true);
  return query select v_result.revision,v_result.updated_at,v_result.state,v_result.operation_replayed,v_result.operation_revision;
end
$bulk$;

create or replace function public.stage_restore_group_v5(
  p_restore_group_id uuid,p_app_site text,p_main_document_name text,p_main_base_revision bigint,p_main_state jsonb,p_main_delete_intents jsonb,
  p_checks_document_name text,p_checks_base_revision bigint,p_checks_state jsonb,p_checks_delete_ids jsonb,
  p_main_operation_id text,p_checks_operation_id text,p_audit jsonb
) returns table(restore_group_id uuid,phase text)
language plpgsql security definer set search_path=pg_catalog,netunim_internal,extensions as $stage$
declare v_owner uuid:=auth.uid();v_main_hash text;v_checks_hash text;v_existing netunim_internal.restore_operation_groups%rowtype;
begin
  if v_owner is null then raise exception 'not_authenticated' using errcode='42501';end if;
  if p_restore_group_id is null or p_app_site not in ('kupa','orders') or p_main_base_revision<0 then raise exception 'invalid_restore_group' using errcode='22023';end if;
  perform netunim_internal.assert_document_invariants(p_app_site,p_main_state);
  if p_checks_state is not null then
    if jsonb_typeof(p_checks_state->'bankEvents') is distinct from 'array' then p_checks_state:=p_checks_state||jsonb_build_object('bankEvents','[]'::jsonb);end if;
    perform netunim_internal.assert_document_invariants('shared-checks',p_checks_state);
    if p_checks_base_revision is null or p_checks_base_revision<0 or coalesce(btrim(p_checks_operation_id),'')='' then raise exception 'invalid_restore_checks_target' using errcode='22023';end if;
  end if;
  if coalesce(btrim(p_main_operation_id),'')='' then raise exception 'invalid_restore_operation_id' using errcode='22023';end if;
  v_main_hash:=encode(extensions.digest(convert_to(jsonb_build_object('state',p_main_state,'deleteIntents',coalesce(p_main_delete_intents,'{}'::jsonb))::text,'UTF8'),'sha256'),'hex');
  v_checks_hash:=case when p_checks_state is null then null else encode(extensions.digest(convert_to(jsonb_build_object('state',p_checks_state,'deleteIds',coalesce(p_checks_delete_ids,'[]'::jsonb))::text,'UTF8'),'sha256'),'hex') end;
  insert into netunim_internal.restore_operation_groups(owner_id,restore_group_id,app_site,main_document_name,main_base_revision,checks_document_name,checks_base_revision,main_state,checks_state,main_delete_intents,checks_delete_ids,main_payload_sha256,checks_payload_sha256,main_operation_id,checks_operation_id,phase,audit)
  values(v_owner,p_restore_group_id,p_app_site,p_main_document_name,p_main_base_revision,coalesce(nullif(p_checks_document_name,''),'main'),p_checks_base_revision,p_main_state,p_checks_state,coalesce(p_main_delete_intents,'{}'::jsonb),coalesce(p_checks_delete_ids,'[]'::jsonb),v_main_hash,v_checks_hash,p_main_operation_id,p_checks_operation_id,'staged',coalesce(p_audit,'{}'::jsonb))
  on conflict do nothing;
  select * into v_existing from netunim_internal.restore_operation_groups g where g.owner_id=v_owner and g.restore_group_id=p_restore_group_id;
  if v_existing.main_payload_sha256<>v_main_hash or v_existing.checks_payload_sha256 is distinct from v_checks_hash or v_existing.app_site<>p_app_site then
    raise exception 'restore_group_id_reuse' using errcode='PT422';
  end if;
  return query select v_existing.restore_group_id,v_existing.phase;
end
$stage$;

create or replace function public.apply_restore_group_v5(p_restore_group_id uuid)
returns table(restore_group_id uuid,phase text,main_revision bigint,checks_revision bigint)
language plpgsql security definer set search_path=pg_catalog,public,netunim_internal as $apply$
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
  update netunim_internal.restore_operation_groups set phase='main_pending',updated_at=now(),last_error_code=null where owner_id=v_owner and restore_group_id=p_restore_group_id;
  perform netunim_internal.capture_safety_snapshot(v_owner,v_group.app_site,v_group.main_document_name,v_group.main_operation_id,'restore',v_group.restore_group_id);
  if v_group.app_site='orders' then
    select * into v_main from public.save_order_management_document_v5(v_group.main_document_name,v_group.main_base_revision,v_group.main_state,v_group.main_operation_id,v_group.main_delete_intents,v_group.audit||jsonb_build_object('mutationType','restore','restoreGroupId',v_group.restore_group_id));
  else
    select * into v_main from public.save_kupa_document_v5(v_group.main_document_name,v_group.main_base_revision,v_group.main_state,v_group.main_operation_id,v_group.main_delete_intents,v_group.audit||jsonb_build_object('mutationType','restore','restoreGroupId',v_group.restore_group_id));
  end if;
  update netunim_internal.restore_operation_groups set phase='main_acked',updated_at=now() where owner_id=v_owner and restore_group_id=p_restore_group_id;
  if v_group.checks_state is not null then
    update netunim_internal.restore_operation_groups set phase='checks_pending',updated_at=now() where owner_id=v_owner and restore_group_id=p_restore_group_id;
    perform netunim_internal.capture_safety_snapshot(v_owner,'shared-checks',v_group.checks_document_name,v_group.checks_operation_id,'restore',v_group.restore_group_id);
    select * into v_checks from public.save_shared_checks_document_v5(v_group.checks_document_name,v_group.checks_base_revision,v_group.checks_state,v_group.checks_operation_id,v_group.checks_delete_ids,v_group.audit||jsonb_build_object('mutationType','restore','restoreGroupId',v_group.restore_group_id));
    update netunim_internal.restore_operation_groups set phase='checks_acked',updated_at=now() where owner_id=v_owner and restore_group_id=p_restore_group_id;
  end if;
  perform set_config('app.destructive_operation_kind','',true);
  update netunim_internal.restore_operation_groups set phase='completed',completed_at=now(),updated_at=now() where owner_id=v_owner and restore_group_id=p_restore_group_id;
  restore_group_id:=v_group.restore_group_id;phase:='completed';main_revision:=v_main.revision;checks_revision:=case when v_group.checks_state is null then null else v_checks.revision end;return next;
end
$apply$;

create or replace function public.list_incomplete_restore_groups_v5()
returns table(restore_group_id uuid,app_site text,phase text,created_at timestamptz,updated_at timestamptz)
language sql stable security invoker set search_path=pg_catalog,netunim_internal as $list$
  select g.restore_group_id,g.app_site,g.phase,g.created_at,g.updated_at from netunim_internal.restore_operation_groups g
  where g.owner_id=auth.uid() and g.phase<>'completed' order by g.created_at
$list$;

revoke all on function public.save_order_management_document_v5(text,bigint,jsonb,text,jsonb,jsonb) from public,anon;
revoke all on function public.save_kupa_document_v5(text,bigint,jsonb,text,jsonb,jsonb) from public,anon;
revoke all on function public.save_shared_checks_document_v5(text,bigint,jsonb,text,jsonb,jsonb) from public,anon;
revoke all on function public.save_finance_sync_document_v5(text,bigint,jsonb,text,jsonb) from public,anon;
revoke all on function public.bulk_delete_save_order_management_document_v5(text,bigint,jsonb,text,jsonb,jsonb) from public,anon;
revoke all on function public.bulk_delete_save_kupa_document_v5(text,bigint,jsonb,text,jsonb,jsonb) from public,anon;
revoke all on function public.bulk_delete_save_shared_checks_document_v5(text,bigint,jsonb,text,jsonb,jsonb) from public,anon;
revoke all on function public.stage_restore_group_v5(uuid,text,text,bigint,jsonb,jsonb,text,bigint,jsonb,jsonb,text,text,jsonb) from public,anon;
revoke all on function public.apply_restore_group_v5(uuid) from public,anon;
revoke all on function public.list_incomplete_restore_groups_v5() from public,anon;
grant execute on function public.save_order_management_document_v5(text,bigint,jsonb,text,jsonb,jsonb) to authenticated;
grant execute on function public.save_kupa_document_v5(text,bigint,jsonb,text,jsonb,jsonb) to authenticated;
grant execute on function public.save_shared_checks_document_v5(text,bigint,jsonb,text,jsonb,jsonb) to authenticated;
grant execute on function public.save_finance_sync_document_v5(text,bigint,jsonb,text,jsonb) to authenticated;
grant execute on function public.bulk_delete_save_order_management_document_v5(text,bigint,jsonb,text,jsonb,jsonb) to authenticated;
grant execute on function public.bulk_delete_save_kupa_document_v5(text,bigint,jsonb,text,jsonb,jsonb) to authenticated;
grant execute on function public.bulk_delete_save_shared_checks_document_v5(text,bigint,jsonb,text,jsonb,jsonb) to authenticated;
grant execute on function public.stage_restore_group_v5(uuid,text,text,bigint,jsonb,jsonb,text,bigint,jsonb,jsonb,text,text,jsonb) to authenticated;
grant execute on function public.apply_restore_group_v5(uuid) to authenticated;
grant execute on function public.list_incomplete_restore_groups_v5() to authenticated;

-- Remove browser-triggered pruning from the three internal document writers before
-- revoking backup DELETE. Existing history is preserved; trusted maintenance owns retention.
do $remove_inline_pruning$
declare v_signature text;v_periodic text;v_rolling text;v_def text;v_start integer;v_tail text;v_return integer;
begin
  for v_signature,v_periodic,v_rolling in values
    ('netunim_internal.save_order_management_document(text,bigint,jsonb)','order_management_periodic_backups','order_management_document_backups'),
    ('netunim_internal.save_kupa_document(text,bigint,jsonb)','kupa_periodic_backups','kupa_document_backups'),
    ('netunim_internal.save_shared_checks_document(text,bigint,jsonb)','shared_checks_periodic_backups','shared_checks_document_backups')
  loop
    select pg_get_functiondef(to_regprocedure(v_signature)) into v_def;
    if v_def is null then raise exception 'missing_internal_writer' using detail=v_signature;end if;
    v_start:=position('delete from public.'||v_periodic in lower(v_def));
    if v_start>0 then
      v_tail:=substring(v_def from v_start);v_return:=position('return query' in lower(v_tail));
      if v_return=0 then raise exception 'inline_pruning_shape_changed' using detail=v_signature;end if;
      v_def:=substring(v_def from 1 for v_start-1)||substring(v_tail from v_return);
      execute v_def;
    end if;
    select pg_get_functiondef(to_regprocedure(v_signature)) into v_def;
    if position('delete from public.'||v_periodic in lower(v_def))>0 or position('delete from public.'||v_rolling in lower(v_def))>0 then
      raise exception 'inline_pruning_still_present' using detail=v_signature;
    end if;
  end loop;
end
$remove_inline_pruning$;

do $immutable_backups$
declare v_table text;
begin
  foreach v_table in array array[
    'order_management_document_backups','order_management_periodic_backups',
    'kupa_document_backups','kupa_periodic_backups',
    'shared_checks_document_backups','shared_checks_periodic_backups'
  ] loop
    execute format('revoke update,delete,truncate on table public.%I from public,anon,authenticated',v_table);
  end loop;
  drop policy if exists "order_management_backups_delete_own" on public.order_management_document_backups;
  drop policy if exists "order_management_periodic_backups_delete_own" on public.order_management_periodic_backups;
  drop policy if exists "kupa_backups_delete_own" on public.kupa_document_backups;
  drop policy if exists "kupa_periodic_backups_delete_own" on public.kupa_periodic_backups;
  drop policy if exists "shared_checks_backups_delete_own" on public.shared_checks_document_backups;
  drop policy if exists "shared_checks_periodic_delete_own" on public.shared_checks_periodic_backups;
end
$immutable_backups$;

-- A real trusted weekly schedule. Migration fails if pg_cron cannot be installed;
-- deployment must not claim ledger retention is active merely because the function exists.
create extension if not exists pg_cron;
do $ledger_schedule$
begin
  if not exists(select 1 from cron.job where jobname='netunim-sync-ledger-retention-weekly') then
    perform cron.schedule('netunim-sync-ledger-retention-weekly','17 3 * * 0','select * from netunim_internal.prune_sync_operation_ledgers();');
  end if;
  if not exists(select 1 from cron.job where jobname='netunim-sync-ledger-retention-weekly' and active) then
    raise exception 'sync_ledger_retention_schedule_missing';
  end if;
end
$ledger_schedule$;

notify pgrst,'reload schema';
commit;
