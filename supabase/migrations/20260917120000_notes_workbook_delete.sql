-- Explicit workbook deletion: exact intents, parent integrity, audit and bulk guard.
-- Apply once before deploying the corresponding Kupa client. Safe to re-run.
begin;

CREATE OR REPLACE FUNCTION netunim_internal.assert_document_invariants(p_domain text, p_state jsonb)
 RETURNS void
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'netunim_internal'
AS $function$
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
    -- Legacy single-sheet documents remain readable. Workbook documents must
    -- keep every child attached to an existing, nonempty named sheet.
    if p_state#>'{notesSheet,sheets}' is not null then
      perform netunim_internal.assert_entity_array_ids(p_state,array['notesSheet','sheets'],true);
      if jsonb_array_length(p_state#>'{notesSheet,sheets}')=0 or exists(
        select 1 from jsonb_array_elements(p_state#>'{notesSheet,sheets}') s
        where jsonb_typeof(s->'name') is distinct from 'string' or nullif(btrim(s->>'name'),'') is null
      ) then raise exception 'invalid_notes_workbook' using errcode='22023';end if;
      foreach v_path in array array['rows','columns'] loop
        if exists(select 1 from jsonb_array_elements(p_state#>array['notesSheet',v_path]) child
          where not exists(select 1 from jsonb_array_elements(p_state#>'{notesSheet,sheets}') sheet where sheet->>'id'=child->>'sheetId'))
        then raise exception 'orphan_notes_sheet_entity' using errcode='22023',detail=v_path;end if;
      end loop;
    end if;
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
$function$;

CREATE OR REPLACE FUNCTION netunim_internal.kupa_delete_intent_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'netunim_internal'
AS $function$
declare
  v_v4_allowed constant text[]:=array['credits','cash','rights','notes','expenses','notesSheet.rows','notesSheet.columns','notesSheet.sheets'];
  v_allowed constant text[]:=array['credits','cash','rights','notes','expenses','notesSheet.rows','notesSheet.columns','notesSheet.sheets','cards'];
  v_key text;v_old jsonb;v_new jsonb;v_removed jsonb;v_actual jsonb:='{}'::jsonb;v_intended jsonb;v_raw text;v_cards_raw text;
begin
  if tg_op<>'UPDATE' then return new;end if;
  foreach v_key in array v_allowed loop
    v_old:=old.state#>string_to_array(v_key,'.');v_new:=new.state#>string_to_array(v_key,'.');
    if jsonb_typeof(v_old) is distinct from 'array' then v_old:='[]'::jsonb;end if;
    if jsonb_typeof(v_new) is distinct from 'array' then v_new:='[]'::jsonb;end if;
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
$function$;

CREATE OR REPLACE FUNCTION netunim_internal.mass_destructive_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
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
    v_paths:=array['credits','cash','rights','notes','expenses','cards','notesSheet.rows','notesSheet.columns','notesSheet.sheets'];
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
$function$;

CREATE OR REPLACE FUNCTION public.save_kupa_document_v4(p_document_name text, p_expected_revision bigint, p_state jsonb, p_operation_id text, p_delete_intents jsonb)
 RETURNS TABLE(revision bigint, updated_at timestamp with time zone, state jsonb, operation_replayed boolean, operation_revision bigint)
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'netunim_internal', 'extensions'
AS $function$
declare
  v_owner uuid:=auth.uid();
  v_allowed constant text[]:=array['credits','cash','rights','notes','expenses','notesSheet.rows','notesSheet.columns','notesSheet.sheets'];
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
$function$;

CREATE OR REPLACE FUNCTION public.save_kupa_document_v5(p_document_name text, p_expected_revision bigint, p_state jsonb, p_operation_id text, p_delete_intents jsonb, p_audit jsonb)
 RETURNS TABLE(revision bigint, updated_at timestamp with time zone, state jsonb, operation_replayed boolean, operation_revision bigint)
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'netunim_internal'
AS $function$
declare v_owner uuid:=auth.uid();v_before jsonb;v_result record;v_paths text[]:=array['credits','cash','rights','notes','expenses','cards','notesSheet.rows','notesSheet.columns','notesSheet.sheets'];
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
$function$;

commit;
