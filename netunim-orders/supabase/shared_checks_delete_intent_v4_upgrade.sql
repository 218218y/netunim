-- Shared Checks explicit-delete intent hardening (v4)
-- Root cause addressed: a stale browser outbox can contain an incomplete checks snapshot.
-- Missing records are no longer accepted as deletions unless their IDs are explicitly declared.
-- Data safety: DDL/function/trigger changes only; this migration does not mutate application rows.

begin;

create or replace function netunim_internal.shared_checks_delete_intent_guard()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_raw text;
  v_declared_json jsonb;
  v_declared text[] := '{}'::text[];
  v_removed text[] := '{}'::text[];
begin
  if tg_op <> 'UPDATE' then return new; end if;
  if jsonb_typeof(old.state->'checks') is distinct from 'array'
     or jsonb_typeof(new.state->'checks') is distinct from 'array' then
    raise exception 'invalid_shared_checks_state' using errcode='22023';
  end if;

  select coalesce(array_agg(id order by id),'{}'::text[])
    into v_removed
  from (
    select old_check.value->>'id' as id
    from jsonb_array_elements(old.state->'checks') old_check(value)
    where nullif(btrim(old_check.value->>'id'),'') is not null
      and not exists (
        select 1
        from jsonb_array_elements(new.state->'checks') new_check(value)
        where new_check.value->>'id' = old_check.value->>'id'
      )
  ) removed;

  if cardinality(v_removed)=0 then return new; end if;

  v_raw:=nullif(current_setting('app.shared_checks_delete_ids',true),'');
  if v_raw is null then
    raise exception 'shared_checks_delete_intent_required'
      using errcode='PT422', hint='Check deletion requires an explicit deletedCheckIds list.';
  end if;

  begin
    v_declared_json:=v_raw::jsonb;
  exception when others then
    raise exception 'invalid_shared_checks_delete_intent' using errcode='22023';
  end;
  if jsonb_typeof(v_declared_json) is distinct from 'array' then
    raise exception 'invalid_shared_checks_delete_intent' using errcode='22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_declared_json) j(value)
    where jsonb_typeof(j.value) is distinct from 'string'
       or nullif(btrim(j.value #>> '{}'),'') is null
  ) then
    raise exception 'invalid_shared_checks_delete_intent' using errcode='22023';
  end if;

  select coalesce(array_agg(id order by id),'{}'::text[])
    into v_declared
  from (
    select distinct btrim(j.value #>> '{}') as id
    from jsonb_array_elements(v_declared_json) j(value)
  ) declared;

  if cardinality(v_declared) <> jsonb_array_length(v_declared_json) then
    raise exception 'duplicate_shared_checks_delete_intent' using errcode='22023';
  end if;
  if v_declared is distinct from v_removed then
    raise exception 'shared_checks_delete_intent_mismatch'
      using errcode='PT422', hint='deletedCheckIds must exactly match the check IDs removed by this update.';
  end if;
  return new;
end;
$$;

revoke all on function netunim_internal.shared_checks_delete_intent_guard() from public, anon;
grant execute on function netunim_internal.shared_checks_delete_intent_guard() to authenticated;

drop trigger if exists shared_checks_delete_intent_guard on public.shared_checks_documents;
create trigger shared_checks_delete_intent_guard
before update on public.shared_checks_documents
for each row execute function netunim_internal.shared_checks_delete_intent_guard();


-- The legacy internal writer has an older emergency guard that rejects >1 -> 0.
-- Keep that guard for v3/old clients, but let v4 reach the exact-ID trigger above.
do $patch_legacy_empty_guard$
declare
  v_oid regprocedure := to_regprocedure('netunim_internal.save_shared_checks_document(text,bigint,jsonb)');
  v_def text;
  v_old text := 'and jsonb_array_length(p_state->''checks'') = 0 then';
  v_new text := 'and jsonb_array_length(p_state->''checks'') = 0' || E'\n     and nullif(current_setting(''app.shared_checks_delete_ids'', true), '''') is null then';
begin
  if v_oid is null then raise exception 'missing_internal_shared_checks_writer'; end if;
  select pg_get_functiondef(v_oid) into v_def;
  if position('app.shared_checks_delete_ids' in v_def) = 0 then
    if position(v_old in v_def) = 0 then raise exception 'legacy_shared_checks_empty_guard_not_found'; end if;
    execute replace(v_def, v_old, v_new);
  end if;
end
$patch_legacy_empty_guard$;

create or replace function public.save_shared_checks_document_v4(
  p_document_name text,
  p_expected_revision bigint,
  p_state jsonb,
  p_operation_id text,
  p_deleted_check_ids jsonb
)
returns table(revision bigint,updated_at timestamptz,state jsonb,operation_replayed boolean,operation_revision bigint)
language plpgsql
security invoker
set search_path = pg_catalog, public, netunim_internal, extensions
as $$
declare
  v_owner uuid:=auth.uid();
  v_deleted_ids jsonb:='[]'::jsonb;
  v_payload_hash text;
  v_legacy_payload_hash text;
  v_ledger_hash text;
  v_applied_revision bigint;
  v_saved_revision bigint;
  v_saved_updated_at timestamptz;
  v_saved_state jsonb;
begin
  if v_owner is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  if p_document_name is null or btrim(p_document_name)='' then raise exception 'invalid_document_name' using errcode='22023'; end if;
  if p_expected_revision is null or p_expected_revision<0 then raise exception 'invalid_expected_revision' using errcode='22023'; end if;
  if p_state is null or jsonb_typeof(p_state) is distinct from 'object' then raise exception 'invalid_shared_checks_state' using errcode='22023'; end if;
  if coalesce(btrim(p_operation_id),'')='' or length(p_operation_id)>200 then raise exception 'invalid_operation_id' using errcode='22023'; end if;
  if p_deleted_check_ids is null or jsonb_typeof(p_deleted_check_ids) is distinct from 'array' then raise exception 'invalid_shared_checks_delete_intent' using errcode='22023'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_deleted_check_ids) j(value)
    where jsonb_typeof(j.value) is distinct from 'string'
       or nullif(btrim(j.value #>> '{}'),'') is null
  ) then
    raise exception 'invalid_shared_checks_delete_intent' using errcode='22023';
  end if;

  select coalesce(jsonb_agg(id order by id),'[]'::jsonb)
    into v_deleted_ids
  from (
    select distinct btrim(j.value #>> '{}') as id
    from jsonb_array_elements(p_deleted_check_ids) j(value)
  ) declared;
  if jsonb_array_length(v_deleted_ids) <> jsonb_array_length(p_deleted_check_ids) then
    raise exception 'duplicate_shared_checks_delete_intent' using errcode='22023';
  end if;

  if not pg_try_advisory_xact_lock(hashtextextended('netunim_financial_write:'||v_owner::text,0)) then
    raise exception 'save_busy' using errcode='PT429',hint='Another financial save is already in progress. Retry later.';
  end if;
  perform set_config('lock_timeout','100ms',true);

  v_payload_hash:=encode(extensions.digest(convert_to(jsonb_build_object('state',p_state,'deletedCheckIds',v_deleted_ids)::text,'UTF8'),'sha256'),'hex');
  v_legacy_payload_hash:=encode(extensions.digest(convert_to(p_state::text,'UTF8'),'sha256'),'hex');
  select o.payload_sha256,o.applied_revision into v_ledger_hash,v_applied_revision
  from netunim_internal.document_sync_operations o
  where o.owner_id=v_owner and o.domain='shared-checks' and o.document_name=p_document_name and o.operation_id=p_operation_id;
  if found then
    if v_ledger_hash<>v_payload_hash and v_ledger_hash<>v_legacy_payload_hash then
      raise exception 'idempotency_key_reuse' using errcode='PT422',hint='An operation id cannot be reused with a different payload.';
    end if;
    select d.revision,d.updated_at,d.state into revision,updated_at,state
    from public.shared_checks_documents d where d.owner_id=v_owner and d.document_name=p_document_name;
    if revision is null then raise exception 'operation_replay_document_missing' using errcode='P0002'; end if;
    operation_replayed:=true;operation_revision:=v_applied_revision;return next;return;
  end if;

  perform set_config('app.shared_checks_delete_ids',v_deleted_ids::text,true);
  begin
    select x.revision,x.updated_at,x.state into v_saved_revision,v_saved_updated_at,v_saved_state
    from netunim_internal.save_shared_checks_document(p_document_name,p_expected_revision,p_state) x;
  exception when lock_not_available then
    raise exception 'save_busy' using errcode='PT429',hint='A financial row is temporarily locked. Retry later.';
  end;
  if v_saved_revision is null then raise exception 'save_result_missing' using errcode='P0002'; end if;

  insert into netunim_internal.document_sync_operations(owner_id,domain,document_name,operation_id,payload_sha256,applied_revision,created_at)
  values(v_owner,'shared-checks',p_document_name,p_operation_id,v_payload_hash,v_saved_revision,coalesce(v_saved_updated_at,now()));
  select d.revision,d.updated_at,d.state into revision,updated_at,state
  from public.shared_checks_documents d where d.owner_id=v_owner and d.document_name=p_document_name;
  operation_replayed:=false;operation_revision:=v_saved_revision;return next;
end;
$$;

revoke all on function public.save_shared_checks_document_v4(text,bigint,jsonb,text,jsonb) from public, anon;
grant execute on function public.save_shared_checks_document_v4(text,bigint,jsonb,text,jsonb) to authenticated;

commit;
