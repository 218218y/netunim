begin;

create or replace function netunim_internal.canonical_delete_intents(p_intents jsonb, p_allowed text[])
returns jsonb
language plpgsql
immutable
security invoker
set search_path = pg_catalog
as $$
declare
  v_key text;
  v_value jsonb;
  v_clean jsonb;
  v_out jsonb := '{}'::jsonb;
begin
  if p_intents is null then return v_out; end if;
  if jsonb_typeof(p_intents) is distinct from 'object' then
    raise exception 'invalid_delete_intents' using errcode='22023';
  end if;
  for v_key,v_value in select key,value from jsonb_each(p_intents) loop
    if not (v_key = any(p_allowed)) then
      raise exception 'invalid_delete_intent_domain' using errcode='22023', detail=v_key;
    end if;
    if jsonb_typeof(v_value) is distinct from 'array' then
      raise exception 'invalid_delete_intent_ids' using errcode='22023', detail=v_key;
    end if;
    if exists (
      select 1 from jsonb_array_elements(v_value) j(value)
      where jsonb_typeof(j.value) is distinct from 'string'
         or nullif(btrim(j.value #>> '{}'),'') is null
    ) then
      raise exception 'invalid_delete_intent_ids' using errcode='22023', detail=v_key;
    end if;
    select coalesce(jsonb_agg(id order by id),'[]'::jsonb)
      into v_clean
    from (select distinct btrim(j.value #>> '{}') id from jsonb_array_elements(v_value) j(value)) q;
    if jsonb_array_length(v_clean) <> jsonb_array_length(v_value) then
      raise exception 'duplicate_delete_intent_id' using errcode='22023', detail=v_key;
    end if;
    if jsonb_array_length(v_clean)>0 then v_out:=v_out||jsonb_build_object(v_key,v_clean); end if;
  end loop;
  return v_out;
end;
$$;
revoke all on function netunim_internal.canonical_delete_intents(jsonb,text[]) from public, anon;
grant execute on function netunim_internal.canonical_delete_intents(jsonb,text[]) to authenticated;

create or replace function netunim_internal.order_management_delete_intent_guard()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public, netunim_internal
as $$
declare
  v_allowed constant text[] := array['suppliers','transactions','customerDebts','customerOrders','serviceCalls','notes','inventoryItems','inventoryEvents','warehouseOrders'];
  v_key text;
  v_old jsonb;
  v_new jsonb;
  v_removed jsonb;
  v_actual jsonb := '{}'::jsonb;
  v_intended jsonb;
  v_raw text;
begin
  if tg_op <> 'UPDATE' then return new; end if;
  foreach v_key in array v_allowed loop
    v_old:=case when jsonb_typeof(old.state->v_key)='array' then old.state->v_key else '[]'::jsonb end;
    v_new:=case when jsonb_typeof(new.state->v_key)='array' then new.state->v_key else '[]'::jsonb end;
    select coalesce(jsonb_agg(id order by id),'[]'::jsonb) into v_removed
    from (
      select o.value->>'id' id
      from jsonb_array_elements(v_old) o(value)
      where nullif(btrim(o.value->>'id'),'') is not null
        and not exists (select 1 from jsonb_array_elements(v_new) n(value) where n.value->>'id'=o.value->>'id')
    ) q;
    if jsonb_array_length(v_removed)>0 then v_actual:=v_actual||jsonb_build_object(v_key,v_removed); end if;
  end loop;
  v_raw:=nullif(current_setting('app.order_management_delete_intents',true),'');
  v_intended:=netunim_internal.canonical_delete_intents(coalesce(v_raw::jsonb,'{}'::jsonb),v_allowed);
  if v_actual is distinct from v_intended then
    raise exception 'order_management_delete_intent_mismatch'
      using errcode='PT422', hint='Record deletion requires exact explicit delete intents.';
  end if;
  return new;
end;
$$;
revoke all on function netunim_internal.order_management_delete_intent_guard() from public, anon;
grant execute on function netunim_internal.order_management_delete_intent_guard() to authenticated;
drop trigger if exists order_management_delete_intent_guard on public.order_management_documents;
create trigger order_management_delete_intent_guard before update on public.order_management_documents
for each row execute function netunim_internal.order_management_delete_intent_guard();

create or replace function public.save_order_management_document_v4(p_document_name text,p_expected_revision bigint,p_state jsonb,p_operation_id text,p_delete_intents jsonb)
returns table(revision bigint,updated_at timestamptz,state jsonb,operation_replayed boolean,operation_revision bigint)
language plpgsql
security invoker
set search_path = pg_catalog, public, netunim_internal, extensions
as $$
declare
  v_owner uuid:=auth.uid();
  v_allowed constant text[]:=array['suppliers','transactions','customerDebts','customerOrders','serviceCalls','notes','inventoryItems','inventoryEvents','warehouseOrders'];
  v_intents jsonb;
  v_payload_hash text;v_legacy_hash text;v_ledger_hash text;v_applied_revision bigint;
  v_saved_revision bigint;v_saved_updated_at timestamptz;
begin
  if v_owner is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  if p_document_name is null or btrim(p_document_name)='' then raise exception 'invalid_document_name' using errcode='22023'; end if;
  if p_expected_revision is null or p_expected_revision<0 then raise exception 'invalid_expected_revision' using errcode='22023'; end if;
  if p_state is null or jsonb_typeof(p_state) is distinct from 'object' then raise exception 'invalid_order_management_state' using errcode='22023'; end if;
  if coalesce(btrim(p_operation_id),'')='' or length(p_operation_id)>200 then raise exception 'invalid_operation_id' using errcode='22023'; end if;
  v_intents:=netunim_internal.canonical_delete_intents(coalesce(p_delete_intents,'{}'::jsonb),v_allowed);
  if not pg_try_advisory_xact_lock(hashtextextended('order_management:'||v_owner::text||':'||p_document_name,0)) then
    raise exception 'save_busy' using errcode='PT429',hint='Another save is already in progress. Retry later without refreshing the revision.';
  end if;
  perform set_config('lock_timeout','100ms',true);
  v_payload_hash:=encode(extensions.digest(convert_to(jsonb_build_object('state',p_state,'deleteIntents',v_intents)::text,'UTF8'),'sha256'),'hex');
  v_legacy_hash:=encode(extensions.digest(convert_to(p_state::text,'UTF8'),'sha256'),'hex');
  select o.payload_sha256,o.applied_revision into v_ledger_hash,v_applied_revision
  from netunim_internal.document_sync_operations o
  where o.owner_id=v_owner and o.domain='orders' and o.document_name=p_document_name and o.operation_id=p_operation_id;
  if found then
    if v_ledger_hash<>v_payload_hash and v_ledger_hash<>v_legacy_hash then raise exception 'idempotency_key_reuse' using errcode='PT422'; end if;
    select d.revision,d.updated_at,d.state into revision,updated_at,state from public.order_management_documents d where d.owner_id=v_owner and d.document_name=p_document_name;
    if revision is null then raise exception 'operation_replay_document_missing' using errcode='P0002'; end if;
    operation_replayed:=true;operation_revision:=v_applied_revision;return next;return;
  end if;
  perform set_config('app.order_management_delete_intents',v_intents::text,true);
  begin
    select x.revision,x.updated_at into v_saved_revision,v_saved_updated_at
    from netunim_internal.save_order_management_document(p_document_name,p_expected_revision,p_state) x;
  exception when lock_not_available then raise exception 'save_busy' using errcode='PT429'; end;
  if v_saved_revision is null then raise exception 'save_result_missing' using errcode='P0002'; end if;
  insert into netunim_internal.document_sync_operations(owner_id,domain,document_name,operation_id,payload_sha256,applied_revision,created_at)
  values(v_owner,'orders',p_document_name,p_operation_id,v_payload_hash,v_saved_revision,coalesce(v_saved_updated_at,now()));
  select d.revision,d.updated_at,d.state into revision,updated_at,state from public.order_management_documents d where d.owner_id=v_owner and d.document_name=p_document_name;
  operation_replayed:=false;operation_revision:=v_saved_revision;return next;
end;
$$;
revoke all on function public.save_order_management_document_v4(text,bigint,jsonb,text,jsonb) from public, anon;
grant execute on function public.save_order_management_document_v4(text,bigint,jsonb,text,jsonb) to authenticated;

create or replace function netunim_internal.kupa_delete_intent_guard()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public, netunim_internal
as $$
declare
  v_allowed constant text[] := array['credits','cash','rights','notes','expenses','notesSheet.rows','notesSheet.columns'];
  v_key text;
  v_old jsonb;
  v_new jsonb;
  v_removed jsonb;
  v_actual jsonb := '{}'::jsonb;
  v_intended jsonb;
  v_raw text;
begin
  if tg_op <> 'UPDATE' then return new; end if;
  foreach v_key in array v_allowed loop
    if v_key='notesSheet.rows' then
      v_old:=case when jsonb_typeof(old.state#>'{notesSheet,rows}')='array' then old.state#>'{notesSheet,rows}' else '[]'::jsonb end;
      v_new:=case when jsonb_typeof(new.state#>'{notesSheet,rows}')='array' then new.state#>'{notesSheet,rows}' else '[]'::jsonb end;
    elsif v_key='notesSheet.columns' then
      v_old:=case when jsonb_typeof(old.state#>'{notesSheet,columns}')='array' then old.state#>'{notesSheet,columns}' else '[]'::jsonb end;
      v_new:=case when jsonb_typeof(new.state#>'{notesSheet,columns}')='array' then new.state#>'{notesSheet,columns}' else '[]'::jsonb end;
    else
      v_old:=case when jsonb_typeof(old.state->v_key)='array' then old.state->v_key else '[]'::jsonb end;
      v_new:=case when jsonb_typeof(new.state->v_key)='array' then new.state->v_key else '[]'::jsonb end;
    end if;
    select coalesce(jsonb_agg(id order by id),'[]'::jsonb) into v_removed
    from (
      select o.value->>'id' id
      from jsonb_array_elements(v_old) o(value)
      where nullif(btrim(o.value->>'id'),'') is not null
        and not exists (select 1 from jsonb_array_elements(v_new) n(value) where n.value->>'id'=o.value->>'id')
    ) q;
    if jsonb_array_length(v_removed)>0 then v_actual:=v_actual||jsonb_build_object(v_key,v_removed); end if;
  end loop;
  v_raw:=nullif(current_setting('app.kupa_delete_intents',true),'');
  v_intended:=netunim_internal.canonical_delete_intents(coalesce(v_raw::jsonb,'{}'::jsonb),v_allowed);
  if v_actual is distinct from v_intended then
    raise exception 'kupa_delete_intent_mismatch' using errcode='PT422',hint='Record deletion requires exact explicit delete intents.';
  end if;
  return new;
end;
$$;
revoke all on function netunim_internal.kupa_delete_intent_guard() from public, anon;
grant execute on function netunim_internal.kupa_delete_intent_guard() to authenticated;
drop trigger if exists kupa_delete_intent_guard on public.kupa_documents;
create trigger kupa_delete_intent_guard before update on public.kupa_documents
for each row execute function netunim_internal.kupa_delete_intent_guard();

create or replace function public.save_kupa_document_v4(p_document_name text,p_expected_revision bigint,p_state jsonb,p_operation_id text,p_delete_intents jsonb)
returns table(revision bigint,updated_at timestamptz,state jsonb,operation_replayed boolean,operation_revision bigint)
language plpgsql
security invoker
set search_path = pg_catalog, public, netunim_internal, extensions
as $$
declare
  v_owner uuid:=auth.uid();
  v_allowed constant text[]:=array['credits','cash','rights','notes','expenses','notesSheet.rows','notesSheet.columns'];
  v_intents jsonb;
  v_payload_hash text;v_legacy_hash text;v_ledger_hash text;v_applied_revision bigint;
  v_saved_revision bigint;v_saved_updated_at timestamptz;v_saved_state jsonb;
begin
  if v_owner is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  if p_document_name is null or btrim(p_document_name)='' then raise exception 'invalid_document_name' using errcode='22023'; end if;
  if p_expected_revision is null or p_expected_revision<0 then raise exception 'invalid_expected_revision' using errcode='22023'; end if;
  if p_state is null or jsonb_typeof(p_state) is distinct from 'object' then raise exception 'invalid_kupa_state' using errcode='22023'; end if;
  if coalesce(btrim(p_operation_id),'')='' or length(p_operation_id)>200 then raise exception 'invalid_operation_id' using errcode='22023'; end if;
  v_intents:=netunim_internal.canonical_delete_intents(coalesce(p_delete_intents,'{}'::jsonb),v_allowed);
  if not pg_try_advisory_xact_lock(hashtextextended('netunim_financial_write:'||v_owner::text,0)) then raise exception 'save_busy' using errcode='PT429'; end if;
  perform set_config('lock_timeout','100ms',true);
  v_payload_hash:=encode(extensions.digest(convert_to(jsonb_build_object('state',p_state,'deleteIntents',v_intents)::text,'UTF8'),'sha256'),'hex');
  v_legacy_hash:=encode(extensions.digest(convert_to(p_state::text,'UTF8'),'sha256'),'hex');
  select o.payload_sha256,o.applied_revision into v_ledger_hash,v_applied_revision from netunim_internal.document_sync_operations o
  where o.owner_id=v_owner and o.domain='kupa' and o.document_name=p_document_name and o.operation_id=p_operation_id;
  if found then
    if v_ledger_hash<>v_payload_hash and v_ledger_hash<>v_legacy_hash then raise exception 'idempotency_key_reuse' using errcode='PT422'; end if;
    select d.revision,d.updated_at,d.state into revision,updated_at,state from public.kupa_documents d where d.owner_id=v_owner and d.document_name=p_document_name;
    if revision is null then raise exception 'operation_replay_document_missing' using errcode='P0002'; end if;
    operation_replayed:=true;operation_revision:=v_applied_revision;return next;return;
  end if;
  perform set_config('app.kupa_delete_intents',v_intents::text,true);
  begin
    select x.revision,x.updated_at,x.state into v_saved_revision,v_saved_updated_at,v_saved_state
    from netunim_internal.save_kupa_document(p_document_name,p_expected_revision,p_state) x;
  exception when lock_not_available then raise exception 'save_busy' using errcode='PT429'; end;
  if v_saved_revision is null then raise exception 'save_result_missing' using errcode='P0002'; end if;
  insert into netunim_internal.document_sync_operations(owner_id,domain,document_name,operation_id,payload_sha256,applied_revision,created_at)
  values(v_owner,'kupa',p_document_name,p_operation_id,v_payload_hash,v_saved_revision,coalesce(v_saved_updated_at,now()));
  select d.revision,d.updated_at,d.state into revision,updated_at,state from public.kupa_documents d where d.owner_id=v_owner and d.document_name=p_document_name;
  operation_replayed:=false;operation_revision:=v_saved_revision;return next;
end;
$$;
revoke all on function public.save_kupa_document_v4(text,bigint,jsonb,text,jsonb) from public, anon;
grant execute on function public.save_kupa_document_v4(text,bigint,jsonb,text,jsonb) to authenticated;

commit;
