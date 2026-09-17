-- Independent workbooks. Main business revisions and backups are untouched by cell edits.
-- Existing workbooks are copied and validated before their main-document copy is removed.
begin;

create table public.spreadsheet_documents(
  owner_id uuid not null references auth.users(id) on delete cascade,
  domain text not null check(domain in ('kupa','orders')),
  document_name text not null default 'main' check(length(document_name) between 1 and 100),
  revision bigint not null default 0 check(revision>=0),
  state jsonb not null,
  updated_at timestamptz not null default now(),
  primary key(owner_id,domain,document_name)
);
create table public.spreadsheet_backups(
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  domain text not null check(domain in ('kupa','orders')),
  document_name text not null,
  revision bigint not null,
  state jsonb not null,
  kind text not null check(kind in ('edit','delete','bulk-delete','restore','migration')),
  bucket timestamptz not null,
  created_at timestamptz not null default now(),
  unique(owner_id,domain,document_name,kind,bucket)
);
create index spreadsheet_backups_lookup on public.spreadsheet_backups(owner_id,domain,document_name,created_at desc);
create table netunim_internal.spreadsheet_operations(
  owner_id uuid not null references auth.users(id) on delete cascade,
  domain text not null,
  document_name text not null,
  operation_id text not null,
  payload_hash text not null,
  applied_revision bigint not null,
  restore_backup_id bigint,
  created_at timestamptz not null default now(),
  primary key(owner_id,domain,document_name,operation_id)
);
create table netunim_internal.spreadsheet_legacy_sources(
  owner_id uuid not null references auth.users(id) on delete cascade,
  domain text not null,
  document_name text not null,
  source_revision bigint not null,
  source_state jsonb not null,
  migrated_state jsonb not null,
  migrated_at timestamptz not null default now(),
  primary key(owner_id,domain,document_name)
);
alter table public.spreadsheet_documents enable row level security;
alter table public.spreadsheet_backups enable row level security;
alter table netunim_internal.spreadsheet_operations enable row level security;
alter table netunim_internal.spreadsheet_legacy_sources enable row level security;
create policy spreadsheet_owner_read on public.spreadsheet_documents for select to authenticated using(owner_id=(select auth.uid()));
create policy spreadsheet_backup_owner_read on public.spreadsheet_backups for select to authenticated using(owner_id=(select auth.uid()));
revoke all on public.spreadsheet_documents,public.spreadsheet_backups from public,anon,authenticated;
grant select on public.spreadsheet_documents,public.spreadsheet_backups to authenticated;
revoke all on netunim_internal.spreadsheet_operations,netunim_internal.spreadsheet_legacy_sources from public,anon,authenticated;

create function netunim_internal.assert_spreadsheet(p_state jsonb) returns void
language plpgsql immutable set search_path to 'pg_catalog' as $function$
declare v_part text;v_row jsonb;v_cell record;
begin
  if jsonb_typeof(p_state) is distinct from 'object' or p_state->>'version' is distinct from '2' then raise exception 'invalid_spreadsheet_version' using errcode='22023';end if;
  foreach v_part in array array['sheets','columns','rows'] loop
    perform netunim_internal.assert_entity_array_ids(p_state,array[v_part],true);
  end loop;
  if exists(select 1 from (select x->>'id' id from jsonb_array_elements((p_state->'sheets')||(p_state->'columns')||(p_state->'rows')) x) all_ids group by id having count(*)>1) then raise exception 'duplicate_spreadsheet_id' using errcode='22023';end if;
  if jsonb_array_length(p_state->'sheets')=0 then raise exception 'empty_spreadsheet' using errcode='22023';end if;
  for v_row in select value from jsonb_array_elements(p_state->'sheets') loop
    if jsonb_typeof(v_row->'name') is distinct from 'string' or nullif(btrim(v_row->>'name'),'') is null then raise exception 'invalid_spreadsheet_name' using errcode='22023';end if;
    if not exists(select 1 from jsonb_array_elements(p_state->'columns') c where c->>'sheetId'=v_row->>'id') then raise exception 'empty_spreadsheet_columns' using errcode='22023';end if;
  end loop;
  for v_row in select value from jsonb_array_elements(p_state->'columns') loop
    if jsonb_typeof(v_row->'title') is distinct from 'string' or v_row->>'type' not in ('text','number') or v_row->>'type' is null
      or jsonb_typeof(v_row->'width') is distinct from 'number' or (v_row->>'width')::numeric not between 70 and 520
      or trunc((v_row->>'width')::numeric)<>(v_row->>'width')::numeric
      or not exists(select 1 from jsonb_array_elements(p_state->'sheets') s where s->>'id'=v_row->>'sheetId')
    then raise exception 'invalid_spreadsheet_column' using errcode='22023';end if;
  end loop;
  for v_row in select value from jsonb_array_elements(p_state->'rows') loop
    if jsonb_typeof(v_row->'cells') is distinct from 'object' or not exists(select 1 from jsonb_array_elements(p_state->'sheets') s where s->>'id'=v_row->>'sheetId') then raise exception 'invalid_spreadsheet_row' using errcode='22023';end if;
    for v_cell in select * from jsonb_each(v_row->'cells') loop
      if jsonb_typeof(v_cell.value) is distinct from 'string' or not exists(select 1 from jsonb_array_elements(p_state->'columns') c where c->>'id'=v_cell.key and c->>'sheetId'=v_row->>'sheetId') then raise exception 'orphan_spreadsheet_cell' using errcode='22023';end if;
    end loop;
  end loop;
end
$function$;

create function public.save_spreadsheet_document_v1(p_domain text,p_document_name text,p_expected_revision bigint,p_state jsonb,p_operation_id text,p_delete_intents jsonb default '{}'::jsonb,p_kind text default 'edit')
returns table(revision bigint,state jsonb,updated_at timestamptz,operation_replayed boolean)
language plpgsql security definer set search_path to 'pg_catalog','public','netunim_internal' as $function$
declare v_owner uuid:=auth.uid();v_doc public.spreadsheet_documents%rowtype;v_hash text;v_prior text;v_part text;v_removed jsonb;v_intents jsonb;v_actual jsonb:='{}';v_bucket timestamptz;
begin
  if v_owner is null then raise exception 'not_authenticated' using errcode='42501';end if;
  if p_domain not in ('kupa','orders') or p_domain is null or p_document_name is null or length(p_document_name) not between 1 and 100 or p_expected_revision is null or p_expected_revision<0 or nullif(btrim(p_operation_id),'') is null or length(p_operation_id)>200 or p_kind not in ('edit','delete','bulk-delete','restore') or p_kind is null then raise exception 'invalid_spreadsheet_request' using errcode='22023';end if;
  perform netunim_internal.assert_spreadsheet(p_state);
  v_intents:=netunim_internal.canonical_delete_intents(p_delete_intents,array['notesSheet.sheets','notesSheet.columns','notesSheet.rows']);
  v_hash:=encode(extensions.digest(convert_to(jsonb_build_object('state',p_state,'deletes',v_intents,'kind',p_kind)::text,'UTF8'),'sha256'),'hex');
  if not pg_try_advisory_xact_lock(hashtextextended('spreadsheet:'||v_owner::text||':'||p_domain||':'||p_document_name,0)) then raise exception 'save_busy' using errcode='PT429';end if;
  select d.* into v_doc from public.spreadsheet_documents d where d.owner_id=v_owner and d.domain=p_domain and d.document_name=p_document_name;
  select o.payload_hash into v_prior from netunim_internal.spreadsheet_operations o where o.owner_id=v_owner and o.domain=p_domain and o.document_name=p_document_name and o.operation_id=p_operation_id;
  if found then
    if v_prior<>v_hash then raise exception 'idempotency_key_reuse' using errcode='PT422';end if;
    return query select v_doc.revision,v_doc.state,v_doc.updated_at,true;return;
  end if;
  if coalesce(v_doc.revision,0)<>p_expected_revision then raise exception 'revision_conflict' using errcode='40001';end if;
  foreach v_part in array array['sheets','columns','rows'] loop
    select coalesce(jsonb_agg(id order by id),'[]'::jsonb) into v_removed from (
      select old->>'id' id from jsonb_array_elements(coalesce(v_doc.state->v_part,'[]'::jsonb)) old
      where not exists(select 1 from jsonb_array_elements(p_state->v_part) new where new->>'id'=old->>'id')
    ) gone;
    if jsonb_array_length(v_removed)>0 then v_actual:=v_actual||jsonb_build_object('notesSheet.'||v_part,v_removed);end if;
  end loop;
  if v_actual<>v_intents then raise exception 'spreadsheet_delete_intent_mismatch' using errcode='PT422';end if;
  if v_actual<>'{}'::jsonb and p_kind not in ('delete','bulk-delete','restore') then raise exception 'spreadsheet_delete_requires_explicit_kind' using errcode='PT422';end if;
  if (select coalesce(sum(jsonb_array_length(value)),0) from jsonb_each(v_actual))>20 and p_kind not in ('bulk-delete','restore') then raise exception 'spreadsheet_mass_delete_requires_explicit_kind' using errcode='PT422';end if;
  if v_doc.state is distinct from p_state then
    if v_doc.state is not null then
      v_bucket:=case when p_kind='edit' then date_bin(interval '10 minutes',now(),'2020-01-01'::timestamptz) else clock_timestamp() end;
      insert into public.spreadsheet_backups(owner_id,domain,document_name,revision,state,kind,bucket)
        values(v_owner,p_domain,p_document_name,v_doc.revision,v_doc.state,p_kind,v_bucket) on conflict(owner_id,domain,document_name,kind,bucket) do nothing;
    end if;
    insert into public.spreadsheet_documents(owner_id,domain,document_name,revision,state) values(v_owner,p_domain,p_document_name,1,p_state)
      on conflict(owner_id,domain,document_name) do update set state=excluded.state,revision=spreadsheet_documents.revision+1,updated_at=now()
      returning * into v_doc;
  end if;
  insert into netunim_internal.spreadsheet_operations(owner_id,domain,document_name,operation_id,payload_hash,applied_revision) values(v_owner,p_domain,p_document_name,p_operation_id,v_hash,v_doc.revision);
  -- Bounded retention on writes, with no new scheduled jobs or main-document backups.
  delete from public.spreadsheet_backups b where b.owner_id=v_owner and b.domain=p_domain and b.document_name=p_document_name and b.kind<>'migration' and
    (b.created_at<now()-interval '30 days' or b.id in (select x.id from public.spreadsheet_backups x where x.owner_id=v_owner and x.domain=p_domain and x.document_name=p_document_name and x.kind<>'migration' order by x.created_at desc,x.id desc offset 100));
  delete from netunim_internal.spreadsheet_operations o where o.owner_id=v_owner and o.domain=p_domain and o.document_name=p_document_name and o.created_at<now()-interval '90 days';
  return query select v_doc.revision,v_doc.state,v_doc.updated_at,false;
end
$function$;

create function public.restore_spreadsheet_document_v1(p_domain text,p_document_name text,p_expected_revision bigint,p_backup_id bigint,p_operation_id text)
returns table(revision bigint,state jsonb,updated_at timestamptz,operation_replayed boolean)
language plpgsql security definer set search_path to 'pg_catalog','public','netunim_internal' as $function$
declare v_owner uuid:=auth.uid();v_target jsonb;v_current jsonb;v_part text;v_ids jsonb;v_intents jsonb:='{}';v_prior bigint;v_result record;
begin
  if v_owner is null then raise exception 'not_authenticated' using errcode='42501';end if;
  if not pg_try_advisory_xact_lock(hashtextextended('spreadsheet:'||v_owner::text||':'||p_domain||':'||p_document_name,0)) then raise exception 'save_busy' using errcode='PT429';end if;
  select o.restore_backup_id into v_prior from netunim_internal.spreadsheet_operations o where o.owner_id=v_owner and o.domain=p_domain and o.document_name=p_document_name and o.operation_id=p_operation_id;
  if found then
    if v_prior is distinct from p_backup_id then raise exception 'idempotency_key_reuse' using errcode='PT422';end if;
    return query select d.revision,d.state,d.updated_at,true from public.spreadsheet_documents d where d.owner_id=v_owner and d.domain=p_domain and d.document_name=p_document_name;return;
  end if;
  select b.state into v_target from public.spreadsheet_backups b where b.id=p_backup_id and b.owner_id=v_owner and b.domain=p_domain and b.document_name=p_document_name;
  if not found then raise exception 'spreadsheet_backup_not_found' using errcode='P0002';end if;
  select d.state into v_current from public.spreadsheet_documents d where d.owner_id=v_owner and d.domain=p_domain and d.document_name=p_document_name;
  foreach v_part in array array['sheets','columns','rows'] loop
    select coalesce(jsonb_agg(x->>'id' order by x->>'id'),'[]'::jsonb) into v_ids from jsonb_array_elements(coalesce(v_current->v_part,'[]')) x where not exists(select 1 from jsonb_array_elements(v_target->v_part) y where y->>'id'=x->>'id');
    if jsonb_array_length(v_ids)>0 then v_intents:=v_intents||jsonb_build_object('notesSheet.'||v_part,v_ids);end if;
  end loop;
  select * into v_result from public.save_spreadsheet_document_v1(p_domain,p_document_name,p_expected_revision,v_target,p_operation_id,v_intents,'restore');
  update netunim_internal.spreadsheet_operations o set restore_backup_id=p_backup_id where o.owner_id=v_owner and o.domain=p_domain and o.document_name=p_document_name and o.operation_id=p_operation_id;
  return query select v_result.revision,v_result.state,v_result.updated_at,v_result.operation_replayed;
end
$function$;
revoke all on function public.save_spreadsheet_document_v1(text,text,bigint,jsonb,text,jsonb,text),public.restore_spreadsheet_document_v1(text,text,bigint,bigint,text) from public,anon;
grant execute on function public.save_spreadsheet_document_v1(text,text,bigint,jsonb,text,jsonb,text),public.restore_spreadsheet_document_v1(text,text,bigint,bigint,text) to authenticated;
revoke all on function netunim_internal.assert_spreadsheet(jsonb) from public,anon,authenticated;

-- Remaining migration/cutover functions are appended below in the same transaction.
create function netunim_internal.upgrade_legacy_spreadsheet(p_source jsonb) returns jsonb
language plpgsql immutable set search_path to 'pg_catalog' as $function$
declare v_book jsonb;v_sheets jsonb;v_columns jsonb;v_rows jsonb;v_v2 boolean:=coalesce((p_source->>'version')::int,1)>=2;
begin
  if jsonb_typeof(p_source->'columns') is distinct from 'array' or jsonb_typeof(p_source->'rows') is distinct from 'array' then raise exception 'invalid_legacy_spreadsheet' using errcode='22023';end if;
  v_sheets:=case when v_v2 then p_source->'sheets' else '[{"id":"sheet-main","name":"גליון 1"}]'::jsonb end;
  select coalesce(jsonb_agg(jsonb_build_object('id',c->>'id','sheetId',case when v_v2 then c->>'sheetId' else 'sheet-main' end,'title',coalesce(c->>'title','עמודה '||n),'type',coalesce(c->>'type','text'),'width',case when v_v2 then coalesce(c->'width','90'::jsonb) else '90'::jsonb end) order by n),'[]'::jsonb) into v_columns from jsonb_array_elements(p_source->'columns') with ordinality x(c,n);
  select coalesce(jsonb_agg(jsonb_build_object('id',r->>'id','sheetId',case when v_v2 then r->>'sheetId' else 'sheet-main' end,'cells',r->'cells','createdAt',coalesce(r->>'createdAt',''),'updatedAt',coalesce(r->>'updatedAt',r->>'createdAt','')) order by n),'[]'::jsonb) into v_rows from jsonb_array_elements(p_source->'rows') with ordinality x(r,n);
  v_book:=jsonb_build_object('version',2,'sheets',v_sheets,'columns',v_columns,'rows',v_rows);
  -- No filtering, re-parenting, duplicate repair or unknown-cell removal.
  perform netunim_internal.assert_spreadsheet(v_book);return v_book;
end
$function$;
revoke all on function netunim_internal.upgrade_legacy_spreadsheet(jsonb) from public,anon,authenticated;

-- Main documents may omit the workbook once it lives in its own document.
-- Keep the legacy validator for old non-migrated documents and restore fixtures.
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
    -- Legacy single-sheet documents remain readable. Workbook documents must
    -- keep every child attached to an existing, nonempty named sheet.
    if p_state?'notesSheet' then
      perform netunim_internal.assert_entity_array_ids(p_state,array['notesSheet','rows'],true);
      perform netunim_internal.assert_entity_array_ids(p_state,array['notesSheet','columns'],true);
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
  elsif p_domain='kupa' then
    if p_state?'checks' then raise exception 'kupa_state_contains_checks' using errcode='22023'; end if;
    foreach v_path in array array[
      'credits','cash','rights','notes','expenses','cards'
    ] loop perform netunim_internal.assert_entity_array_ids(p_state,string_to_array(v_path,'.'),true);end loop;
    -- Legacy single-sheet documents remain readable. Workbook documents must
    -- keep every child attached to an existing, nonempty named sheet.
    if p_state?'notesSheet' then
      perform netunim_internal.assert_entity_array_ids(p_state,array['notesSheet','rows'],true);
      perform netunim_internal.assert_entity_array_ids(p_state,array['notesSheet','columns'],true);
    end if;
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

do $migration$
declare doc record;v_book jsonb;v_intents jsonb;v_part text;
begin
  for doc in select 'kupa' domain,owner_id,document_name,revision,state from public.kupa_documents where document_name='main'
    union all select 'orders',owner_id,document_name,revision,state from public.order_management_documents where document_name='suppliers'
  loop
    if doc.state?'notesSheet' then
      v_book:=netunim_internal.upgrade_legacy_spreadsheet(doc.state->'notesSheet');
      insert into netunim_internal.spreadsheet_legacy_sources(owner_id,domain,document_name,source_revision,source_state,migrated_state)
        values(doc.owner_id,doc.domain,doc.document_name,doc.revision,doc.state->'notesSheet',v_book);
      insert into public.spreadsheet_documents(owner_id,domain,document_name,revision,state) values(doc.owner_id,doc.domain,'main',1,v_book);
      insert into public.spreadsheet_backups(owner_id,domain,document_name,revision,state,kind,bucket) values(doc.owner_id,doc.domain,'main',1,v_book,'migration',now());
      v_intents:='{}';
      foreach v_part in array array['sheets','columns','rows'] loop
        if jsonb_array_length(coalesce(doc.state#>array['notesSheet',v_part],'[]'))>0 then
          v_intents:=v_intents||jsonb_build_object('notesSheet.'||v_part,(select jsonb_agg(x->>'id' order by x->>'id') from jsonb_array_elements(doc.state#>array['notesSheet',v_part]) x));
        end if;
      end loop;
      perform set_config(case when doc.domain='kupa' then 'app.kupa_delete_intents' else 'app.order_management_delete_intents' end,v_intents::text,true);
      perform set_config('app.kupa_cards_delete_intents','[]',true);
      perform set_config('app.destructive_operation_kind','destructive-migration',true);
      if doc.domain='kupa' then update public.kupa_documents set revision=revision+1,updated_at=now(),state=(doc.state-'notesSheet')||'{"notesWorkbookExternal":1}'::jsonb where owner_id=doc.owner_id and document_name=doc.document_name;
      else update public.order_management_documents set revision=revision+1,updated_at=now(),state=(doc.state-'notesSheet')||'{"notesWorkbookExternal":1}'::jsonb where owner_id=doc.owner_id and document_name=doc.document_name;end if;
    end if;
  end loop;
  perform set_config('app.kupa_delete_intents','{}',true);perform set_config('app.order_management_delete_intents','{}',true);perform set_config('app.destructive_operation_kind','',true);
end
$migration$;

-- Compatibility: unchanged legacy copies may accompany business edits for 90 days.
-- They are stripped before the business write. A stale client attempting an actual
-- workbook edit fails explicitly instead of overwriting the independent workbook.
create function netunim_internal.spreadsheet_legacy_write_guard() returns trigger
language plpgsql security definer set search_path to 'pg_catalog','public','netunim_internal' as $function$
declare source netunim_internal.spreadsheet_legacy_sources%rowtype;v_domain text;v_book jsonb;v_safe boolean;
begin
  if old.state->>'notesWorkbookExternal' is distinct from '1' then return new;end if;
  v_domain:=case when tg_table_name='kupa_documents' then 'kupa' else 'orders' end;
  if new.state?'notesSheet' then
    select * into source from netunim_internal.spreadsheet_legacy_sources s where s.owner_id=old.owner_id and s.domain=v_domain and s.document_name=old.document_name;
    v_book:=new.state->'notesSheet';
    v_safe:=v_book=source.source_state or v_book=source.migrated_state;
    if not found or source.migrated_at<now()-interval '90 days' or not coalesce(v_safe,false)
    then raise exception 'spreadsheet_upgrade_required' using errcode='PT409',hint='Refresh the app. The independent workbook is safe; this old client cannot edit it.';end if;
    new.state:=new.state-'notesSheet';
  end if;
  new.state:=new.state||'{"notesWorkbookExternal":1}'::jsonb;return new;
end
$function$;
revoke all on function netunim_internal.spreadsheet_legacy_write_guard() from public,anon,authenticated;
create trigger a_spreadsheet_legacy_compat before update on public.kupa_documents for each row execute function netunim_internal.spreadsheet_legacy_write_guard();
create trigger a_spreadsheet_legacy_compat before update on public.order_management_documents for each row execute function netunim_internal.spreadsheet_legacy_write_guard();

commit;
