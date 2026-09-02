-- Lossless cloud sync v3. Additive and backward-compatible with the previous clients.
-- Apply after core_rpc_contention_hardening_upgrade.sql. Never run setup.sql on production.
begin;

create extension if not exists pgcrypto with schema extensions;

-- Durable operation ledger for document writers. The table is in the non-exposed
-- internal schema; authenticated receives only the minimum privileges required by
-- SECURITY INVOKER RPCs and RLS restricts every row to its owner.
create table if not exists netunim_internal.document_sync_operations (
  owner_id uuid not null references auth.users(id) on delete cascade,
  domain text not null check (domain in ('orders','kupa','shared-checks','finance')),
  document_name text not null,
  operation_id text not null check (length(operation_id) between 1 and 200),
  payload_sha256 text not null check (length(payload_sha256) = 64),
  applied_revision bigint not null check (applied_revision >= 1),
  created_at timestamptz not null default now(),
  primary key (owner_id, domain, document_name, operation_id)
);
alter table netunim_internal.document_sync_operations enable row level security;
drop policy if exists "document_sync_operations_select_own" on netunim_internal.document_sync_operations;
create policy "document_sync_operations_select_own" on netunim_internal.document_sync_operations
  for select to authenticated using ((select auth.uid()) = owner_id);
drop policy if exists "document_sync_operations_insert_own" on netunim_internal.document_sync_operations;
create policy "document_sync_operations_insert_own" on netunim_internal.document_sync_operations
  for insert to authenticated with check ((select auth.uid()) = owner_id);
revoke all on table netunim_internal.document_sync_operations from public, anon, authenticated;
grant select, insert on table netunim_internal.document_sync_operations to authenticated;
grant usage on schema netunim_internal to authenticated;

create table if not exists netunim_internal.bank_sync_operations (
  owner_id uuid not null references auth.users(id) on delete cascade,
  document_name text not null,
  operation_id text not null check (length(operation_id) between 1 and 200),
  snapshot_seq bigint not null check (snapshot_seq >= 0),
  payload_sha256 text not null check (length(payload_sha256) = 64),
  created_at timestamptz not null default now(),
  primary key (owner_id, document_name, operation_id)
);
do $operation_id_constraint$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='netunim_internal.bank_sync_operations'::regclass
      and conname='bank_sync_operations_operation_id_check'
  ) then
    alter table netunim_internal.bank_sync_operations
      add constraint bank_sync_operations_operation_id_check
      check (length(operation_id) between 1 and 200) not valid;
    alter table netunim_internal.bank_sync_operations
      validate constraint bank_sync_operations_operation_id_check;
  end if;
end
$operation_id_constraint$;
alter table netunim_internal.bank_sync_operations enable row level security;
drop policy if exists "bank_sync_operations_select_own" on netunim_internal.bank_sync_operations;
create policy "bank_sync_operations_select_own" on netunim_internal.bank_sync_operations
  for select to authenticated using ((select auth.uid()) = owner_id);
drop policy if exists "bank_sync_operations_insert_own" on netunim_internal.bank_sync_operations;
create policy "bank_sync_operations_insert_own" on netunim_internal.bank_sync_operations
  for insert to authenticated with check ((select auth.uid()) = owner_id);
revoke all on table netunim_internal.bank_sync_operations from public, anon, authenticated;
grant select, insert on table netunim_internal.bank_sync_operations to authenticated;

-- Seed the ledger with the currently published token so a replay immediately after
-- deployment remains idempotent. This writes only to the new private ledger.
insert into netunim_internal.bank_sync_operations(
  owner_id, document_name, operation_id, snapshot_seq, payload_sha256, created_at
)
select k.owner_id,
       k.document_name,
       k.state#>>'{bank,snapshotToken}',
       greatest(0, (k.state#>>'{bank,snapshotSeq}')::bigint),
       encode(extensions.digest(convert_to((f.state->'bank')::text, 'UTF8'), 'sha256'), 'hex'),
       greatest(k.updated_at, f.updated_at)
from public.kupa_documents k
join public.finance_sync_documents f
  on f.owner_id = k.owner_id and f.document_name = k.document_name
where nullif(k.state#>>'{bank,snapshotToken}', '') is not null
  and (k.state#>>'{bank,snapshotSeq}') ~ '^[0-9]+$'
  and jsonb_typeof(f.state->'bank') = 'object'
on conflict (owner_id, document_name, operation_id) do nothing;

-- Change only explicit revision_conflict branches. Other SQLSTATE 40001 errors,
-- including stale bank watermarks, intentionally keep their own semantics.
do $contract$
declare
  v_signature text;
  v_definition text;
  v_updated text;
begin
  foreach v_signature in array array[
    'netunim_internal.save_order_management_document(text,bigint,jsonb)',
    'netunim_internal.save_shared_checks_document(text,bigint,jsonb)',
    'netunim_internal.save_kupa_document(text,bigint,jsonb)'
  ] loop
    select pg_get_functiondef(to_regprocedure(v_signature)) into v_definition;
    if v_definition is null then
      raise exception 'missing_required_function: %', v_signature;
    end if;
    v_updated := regexp_replace(
      v_definition,
      $pattern$raise[[:space:]]+exception[[:space:]]+'revision_conflict'[[:space:]]+using[[:space:]]+errcode[[:space:]]*=[[:space:]]*'40001'$pattern$,
      $replacement$raise exception 'revision_conflict' using errcode = 'PT409'$replacement$,
      'gi'
    );
    if v_updated = v_definition and position('PT409' in v_definition) = 0 then
      raise exception 'revision_conflict_contract_not_found: %', v_signature;
    end if;
    if v_updated <> v_definition then execute v_updated; end if;
  end loop;
end
$contract$;

create or replace function netunim_internal.save_finance_sync_document(
  p_document_name text,
  p_expected_revision bigint,
  p_state jsonb
)
returns table(revision bigint, updated_at timestamptz, state jsonb)
language plpgsql
security invoker
set search_path = pg_catalog, public, netunim_internal
as $$
declare
  v_owner uuid := auth.uid();
  v_current bigint;
  v_current_updated_at timestamptz;
  v_current_state jsonb;
begin
  if v_owner is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  if not pg_try_advisory_xact_lock(hashtextextended('netunim_financial_write:' || v_owner::text, 0)) then
    raise exception 'save_busy' using errcode='PT429', hint='Another financial save is already in progress. Retry later.';
  end if;
  perform set_config('lock_timeout', '100ms', true);
  if p_document_name is null or btrim(p_document_name)='' then raise exception 'invalid_document_name' using errcode='22023'; end if;
  if p_expected_revision is null or p_expected_revision < 0 then raise exception 'invalid_expected_revision' using errcode='22023'; end if;
  if p_state is null or jsonb_typeof(p_state) is distinct from 'object' then raise exception 'invalid_finance_sync_state' using errcode='22023'; end if;

  select d.revision, d.updated_at, d.state
  into v_current, v_current_updated_at, v_current_state
  from public.finance_sync_documents d
  where d.owner_id=v_owner and d.document_name=p_document_name
  for update;

  if v_current is null then
    if p_expected_revision<>0 then raise exception 'revision_conflict' using errcode='PT409'; end if;
    insert into public.finance_sync_documents(owner_id,document_name,revision,state,updated_at)
    values(v_owner,p_document_name,1,p_state,now())
    returning finance_sync_documents.revision,finance_sync_documents.updated_at,finance_sync_documents.state
    into revision,updated_at,state;
    return next; return;
  end if;

  -- Lost ACK replay: equality is checked before optimistic revision conflict.
  if v_current_state = p_state then
    revision:=v_current; updated_at:=v_current_updated_at; state:=v_current_state;
    return next; return;
  end if;
  if v_current<>p_expected_revision then raise exception 'revision_conflict' using errcode='PT409'; end if;

  update public.finance_sync_documents d
  set revision=d.revision+1,state=p_state,updated_at=now()
  where d.owner_id=v_owner and d.document_name=p_document_name
  returning d.revision,d.updated_at,d.state into revision,updated_at,state;
  return next;
end $$;

create or replace function netunim_internal.save_bank_sync_snapshot(
  p_document_name text,
  p_bank_state jsonb,
  p_snapshot_token text,
  p_snapshot_seq bigint
)
returns table(finance_revision bigint, kupa_revision bigint, updated_at timestamptz)
language plpgsql
security invoker
set search_path = pg_catalog, public, netunim_internal, extensions
as $$
declare
  v_owner uuid := auth.uid();
  v_kupa_state jsonb;
  v_kupa_bank jsonb;
  v_old_snapshot_seq bigint := 0;
  v_shared_max_seq bigint := 0;
  v_finance_state jsonb;
  v_finance_revision bigint;
  v_kupa_revision bigint;
  v_finance_updated_at timestamptz;
  v_kupa_updated_at timestamptz;
  v_operation_seq bigint;
  v_operation_hash text;
  v_payload_hash text;
  v_now timestamptz := clock_timestamp();
begin
  if v_owner is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  if not pg_try_advisory_xact_lock(hashtextextended('netunim_financial_write:' || v_owner::text, 0)) then
    raise exception 'save_busy' using errcode='PT429', hint='Another financial save is already in progress. Retry later.';
  end if;
  perform set_config('lock_timeout', '100ms', true);
  if p_document_name is null or btrim(p_document_name)='' then raise exception 'invalid_document_name' using errcode='22023'; end if;
  if p_bank_state is null or jsonb_typeof(p_bank_state) is distinct from 'object' then raise exception 'invalid_bank_sync_state' using errcode='22023'; end if;
  if coalesce(btrim(p_snapshot_token),'')='' or length(p_snapshot_token)>200 then raise exception 'invalid_bank_snapshot_token' using errcode='22023'; end if;
  if p_snapshot_seq is null or p_snapshot_seq<0 then raise exception 'invalid_bank_snapshot_sequence' using errcode='22023'; end if;
  v_payload_hash:=encode(digest(convert_to(p_bank_state::text, 'UTF8'), 'sha256'), 'hex');

  -- Canonical order remains Kupa then Finance; the shared financial advisory gate is unchanged.
  select d.state,d.revision,d.updated_at into v_kupa_state,v_kupa_revision,v_kupa_updated_at
  from public.kupa_documents d
  where d.owner_id=v_owner and d.document_name=p_document_name
  for update;
  if v_kupa_state is null then raise exception 'kupa_document_not_found' using errcode='P0002'; end if;

  select f.state,f.revision,f.updated_at into v_finance_state,v_finance_revision,v_finance_updated_at
  from public.finance_sync_documents f
  where f.owner_id=v_owner and f.document_name=p_document_name
  for update;

  select o.snapshot_seq,o.payload_sha256 into v_operation_seq,v_operation_hash
  from netunim_internal.bank_sync_operations o
  where o.owner_id=v_owner and o.document_name=p_document_name and o.operation_id=p_snapshot_token;
  if found then
    if v_operation_seq<>p_snapshot_seq or v_operation_hash<>v_payload_hash then
      raise exception 'idempotency_key_reuse' using errcode='PT422', hint='A bank snapshot token cannot be reused with a different payload.';
    end if;
    if v_finance_revision is null then raise exception 'finance_document_not_found' using errcode='P0002'; end if;
    finance_revision:=v_finance_revision;
    kupa_revision:=v_kupa_revision;
    updated_at:=greatest(v_finance_updated_at,v_kupa_updated_at);
    return next; return;
  end if;

  v_kupa_bank:=coalesce(v_kupa_state->'bank','{}'::jsonb);
  if jsonb_typeof(v_kupa_bank->'snapshotSeq')='number' then
    begin v_old_snapshot_seq:=greatest(0,(v_kupa_bank->>'snapshotSeq')::bigint);
    exception when others then raise exception 'invalid_existing_bank_snapshot_sequence' using errcode='22023'; end;
  end if;

  select coalesce(max((e.value->>'seq')::bigint),0) into v_shared_max_seq
  from public.shared_checks_documents s
  left join lateral jsonb_array_elements(case when jsonb_typeof(s.state->'bankEvents')='array' then s.state->'bankEvents' else '[]'::jsonb end) e(value) on true
  where s.owner_id=v_owner and s.document_name='main';
  v_shared_max_seq:=coalesce(v_shared_max_seq,0);
  if p_snapshot_seq<v_old_snapshot_seq then
    raise exception 'stale_bank_snapshot_watermark' using errcode='40001',hint='Refresh shared checks before saving the bank snapshot.';
  end if;
  if p_snapshot_seq>greatest(v_old_snapshot_seq,v_shared_max_seq) then
    raise exception 'bank_snapshot_watermark_ahead_of_server' using errcode='22023',hint='The requested watermark was not observed in shared check events.';
  end if;

  if v_finance_revision is null then
    insert into public.finance_sync_documents(owner_id,document_name,revision,state,updated_at)
    values(v_owner,p_document_name,1,jsonb_build_object('bank',p_bank_state,'creditSync',null),v_now)
    returning revision into v_finance_revision;
  else
    v_finance_state:=coalesce(v_finance_state,'{}'::jsonb);
    update public.finance_sync_documents f
    set revision=f.revision+1,state=jsonb_set(v_finance_state,'{bank}',p_bank_state,true),updated_at=v_now
    where f.owner_id=v_owner and f.document_name=p_document_name
    returning f.revision into v_finance_revision;
  end if;

  perform set_config('app.kupa_rpc_write','1',true);
  v_kupa_bank:=jsonb_build_object(
    'currentBalance',null,'updatedAt',null,'asOfDate',null,
    'adjustments',coalesce(v_kupa_bank->'adjustments','[]'::jsonb),
    'source',null,'sourceAccount',null,
    'snapshotToken',p_snapshot_token,'snapshotSeq',p_snapshot_seq
  );
  v_kupa_state:=(v_kupa_state-'bank'-'creditSync')||jsonb_build_object('bank',v_kupa_bank);
  update public.kupa_documents d
  set revision=d.revision+1,state=v_kupa_state,updated_at=v_now
  where d.owner_id=v_owner and d.document_name=p_document_name
  returning d.revision into v_kupa_revision;

  insert into netunim_internal.bank_sync_operations(owner_id,document_name,operation_id,snapshot_seq,payload_sha256,created_at)
  values(v_owner,p_document_name,p_snapshot_token,p_snapshot_seq,v_payload_hash,v_now);
  finance_revision:=v_finance_revision;kupa_revision:=v_kupa_revision;updated_at:=v_now;return next;
end $$;


-- New RPC names avoid PostgREST function-overload ambiguity. Old 3-argument RPCs
-- remain available throughout deployment; v3 clients use these operation-aware APIs.
create or replace function public.save_order_management_document_v3(
  p_document_name text,
  p_expected_revision bigint,
  p_state jsonb,
  p_operation_id text
)
returns table(
  revision bigint,
  updated_at timestamptz,
  state jsonb,
  operation_replayed boolean,
  operation_revision bigint
)
language plpgsql
security invoker
set search_path = pg_catalog, public, netunim_internal, extensions
as $$
declare
  v_owner uuid := auth.uid();
  v_payload_hash text;
  v_ledger_hash text;
  v_applied_revision bigint;
  v_saved_revision bigint;
  v_saved_updated_at timestamptz;
begin
  if v_owner is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  if p_document_name is null or btrim(p_document_name)='' then raise exception 'invalid_document_name' using errcode='22023'; end if;
  if p_expected_revision is null or p_expected_revision<0 then raise exception 'invalid_expected_revision' using errcode='22023'; end if;
  if p_state is null or jsonb_typeof(p_state) is distinct from 'object' then raise exception 'invalid_order_management_state' using errcode='22023'; end if;
  if coalesce(btrim(p_operation_id),'')='' or length(p_operation_id)>200 then raise exception 'invalid_operation_id' using errcode='22023'; end if;
  if not pg_try_advisory_xact_lock(hashtextextended('order_management:'||v_owner::text||':'||p_document_name,0)) then
    raise exception 'save_busy' using errcode='PT429',hint='Another save is already in progress. Retry later without refreshing the revision.';
  end if;
  perform set_config('lock_timeout','100ms',true);
  v_payload_hash:=encode(extensions.digest(convert_to(p_state::text,'UTF8'),'sha256'),'hex');

  select o.payload_sha256,o.applied_revision into v_ledger_hash,v_applied_revision
  from netunim_internal.document_sync_operations o
  where o.owner_id=v_owner and o.domain='orders' and o.document_name=p_document_name and o.operation_id=p_operation_id;
  if found then
    if v_ledger_hash<>v_payload_hash then
      raise exception 'idempotency_key_reuse' using errcode='PT422',hint='An operation id cannot be reused with a different payload.';
    end if;
    select d.revision,d.updated_at,d.state into revision,updated_at,state
    from public.order_management_documents d
    where d.owner_id=v_owner and d.document_name=p_document_name;
    if revision is null then raise exception 'operation_replay_document_missing' using errcode='P0002'; end if;
    operation_replayed:=true;operation_revision:=v_applied_revision;return next;return;
  end if;

  begin
    select x.revision,x.updated_at into v_saved_revision,v_saved_updated_at
    from netunim_internal.save_order_management_document(p_document_name,p_expected_revision,p_state) x;
  exception when lock_not_available then
    raise exception 'save_busy' using errcode='PT429',hint='The document row is temporarily locked. Retry later without refreshing the revision.';
  end;
  if v_saved_revision is null then raise exception 'save_result_missing' using errcode='P0002'; end if;
  insert into netunim_internal.document_sync_operations(owner_id,domain,document_name,operation_id,payload_sha256,applied_revision,created_at)
  values(v_owner,'orders',p_document_name,p_operation_id,v_payload_hash,v_saved_revision,coalesce(v_saved_updated_at,now()));
  select d.revision,d.updated_at,d.state into revision,updated_at,state
  from public.order_management_documents d
  where d.owner_id=v_owner and d.document_name=p_document_name;
  operation_replayed:=false;operation_revision:=v_saved_revision;return next;
end $$;

create or replace function public.save_shared_checks_document_v3(
  p_document_name text,
  p_expected_revision bigint,
  p_state jsonb,
  p_operation_id text
)
returns table(revision bigint,updated_at timestamptz,state jsonb,operation_replayed boolean,operation_revision bigint)
language plpgsql
security invoker
set search_path = pg_catalog, public, netunim_internal, extensions
as $$
declare
  v_owner uuid:=auth.uid();v_payload_hash text;v_ledger_hash text;v_applied_revision bigint;
  v_saved_revision bigint;v_saved_updated_at timestamptz;v_saved_state jsonb;
begin
  if v_owner is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  if p_document_name is null or btrim(p_document_name)='' then raise exception 'invalid_document_name' using errcode='22023'; end if;
  if p_expected_revision is null or p_expected_revision<0 then raise exception 'invalid_expected_revision' using errcode='22023'; end if;
  if p_state is null or jsonb_typeof(p_state) is distinct from 'object' then raise exception 'invalid_shared_checks_state' using errcode='22023'; end if;
  if coalesce(btrim(p_operation_id),'')='' or length(p_operation_id)>200 then raise exception 'invalid_operation_id' using errcode='22023'; end if;
  if not pg_try_advisory_xact_lock(hashtextextended('netunim_financial_write:'||v_owner::text,0)) then
    raise exception 'save_busy' using errcode='PT429',hint='Another financial save is already in progress. Retry later.';
  end if;
  perform set_config('lock_timeout','100ms',true);
  v_payload_hash:=encode(extensions.digest(convert_to(p_state::text,'UTF8'),'sha256'),'hex');
  select o.payload_sha256,o.applied_revision into v_ledger_hash,v_applied_revision
  from netunim_internal.document_sync_operations o
  where o.owner_id=v_owner and o.domain='shared-checks' and o.document_name=p_document_name and o.operation_id=p_operation_id;
  if found then
    if v_ledger_hash<>v_payload_hash then raise exception 'idempotency_key_reuse' using errcode='PT422',hint='An operation id cannot be reused with a different payload.'; end if;
    select d.revision,d.updated_at,d.state into revision,updated_at,state from public.shared_checks_documents d where d.owner_id=v_owner and d.document_name=p_document_name;
    if revision is null then raise exception 'operation_replay_document_missing' using errcode='P0002'; end if;
    operation_replayed:=true;operation_revision:=v_applied_revision;return next;return;
  end if;
  begin
    select x.revision,x.updated_at,x.state into v_saved_revision,v_saved_updated_at,v_saved_state
    from netunim_internal.save_shared_checks_document(p_document_name,p_expected_revision,p_state) x;
  exception when lock_not_available then raise exception 'save_busy' using errcode='PT429',hint='A financial row is temporarily locked. Retry later.'; end;
  if v_saved_revision is null then raise exception 'save_result_missing' using errcode='P0002'; end if;
  insert into netunim_internal.document_sync_operations(owner_id,domain,document_name,operation_id,payload_sha256,applied_revision,created_at)
  values(v_owner,'shared-checks',p_document_name,p_operation_id,v_payload_hash,v_saved_revision,coalesce(v_saved_updated_at,now()));
  select d.revision,d.updated_at,d.state into revision,updated_at,state from public.shared_checks_documents d where d.owner_id=v_owner and d.document_name=p_document_name;
  operation_replayed:=false;operation_revision:=v_saved_revision;return next;
end $$;

create or replace function public.save_kupa_document_v3(
  p_document_name text,
  p_expected_revision bigint,
  p_state jsonb,
  p_operation_id text
)
returns table(revision bigint,updated_at timestamptz,state jsonb,operation_replayed boolean,operation_revision bigint)
language plpgsql
security invoker
set search_path = pg_catalog, public, netunim_internal, extensions
as $$
declare
  v_owner uuid:=auth.uid();v_payload_hash text;v_ledger_hash text;v_applied_revision bigint;
  v_saved_revision bigint;v_saved_updated_at timestamptz;v_saved_state jsonb;
begin
  if v_owner is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  if p_document_name is null or btrim(p_document_name)='' then raise exception 'invalid_document_name' using errcode='22023'; end if;
  if p_expected_revision is null or p_expected_revision<0 then raise exception 'invalid_expected_revision' using errcode='22023'; end if;
  if p_state is null or jsonb_typeof(p_state) is distinct from 'object' then raise exception 'invalid_kupa_state' using errcode='22023'; end if;
  if coalesce(btrim(p_operation_id),'')='' or length(p_operation_id)>200 then raise exception 'invalid_operation_id' using errcode='22023'; end if;
  if not pg_try_advisory_xact_lock(hashtextextended('netunim_financial_write:'||v_owner::text,0)) then
    raise exception 'save_busy' using errcode='PT429',hint='Another financial save is already in progress. Retry later.';
  end if;
  perform set_config('lock_timeout','100ms',true);
  v_payload_hash:=encode(extensions.digest(convert_to(p_state::text,'UTF8'),'sha256'),'hex');
  select o.payload_sha256,o.applied_revision into v_ledger_hash,v_applied_revision
  from netunim_internal.document_sync_operations o
  where o.owner_id=v_owner and o.domain='kupa' and o.document_name=p_document_name and o.operation_id=p_operation_id;
  if found then
    if v_ledger_hash<>v_payload_hash then raise exception 'idempotency_key_reuse' using errcode='PT422',hint='An operation id cannot be reused with a different payload.'; end if;
    select d.revision,d.updated_at,d.state into revision,updated_at,state from public.kupa_documents d where d.owner_id=v_owner and d.document_name=p_document_name;
    if revision is null then raise exception 'operation_replay_document_missing' using errcode='P0002'; end if;
    operation_replayed:=true;operation_revision:=v_applied_revision;return next;return;
  end if;
  begin
    select x.revision,x.updated_at,x.state into v_saved_revision,v_saved_updated_at,v_saved_state
    from netunim_internal.save_kupa_document(p_document_name,p_expected_revision,p_state) x;
  exception when lock_not_available then raise exception 'save_busy' using errcode='PT429',hint='A financial row is temporarily locked. Retry later.'; end;
  if v_saved_revision is null then raise exception 'save_result_missing' using errcode='P0002'; end if;
  insert into netunim_internal.document_sync_operations(owner_id,domain,document_name,operation_id,payload_sha256,applied_revision,created_at)
  values(v_owner,'kupa',p_document_name,p_operation_id,v_payload_hash,v_saved_revision,coalesce(v_saved_updated_at,now()));
  select d.revision,d.updated_at,d.state into revision,updated_at,state from public.kupa_documents d where d.owner_id=v_owner and d.document_name=p_document_name;
  operation_replayed:=false;operation_revision:=v_saved_revision;return next;
end $$;

create or replace function public.save_finance_sync_document_v3(
  p_document_name text,
  p_expected_revision bigint,
  p_state jsonb,
  p_operation_id text
)
returns table(revision bigint,updated_at timestamptz,state jsonb,operation_replayed boolean,operation_revision bigint)
language plpgsql
security invoker
set search_path = pg_catalog, public, netunim_internal, extensions
as $$
declare
  v_owner uuid:=auth.uid();v_payload_hash text;v_ledger_hash text;v_applied_revision bigint;
  v_saved_revision bigint;v_saved_updated_at timestamptz;v_saved_state jsonb;
begin
  if v_owner is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  if p_document_name is null or btrim(p_document_name)='' then raise exception 'invalid_document_name' using errcode='22023'; end if;
  if p_expected_revision is null or p_expected_revision<0 then raise exception 'invalid_expected_revision' using errcode='22023'; end if;
  if p_state is null or jsonb_typeof(p_state) is distinct from 'object' then raise exception 'invalid_finance_sync_state' using errcode='22023'; end if;
  if coalesce(btrim(p_operation_id),'')='' or length(p_operation_id)>200 then raise exception 'invalid_operation_id' using errcode='22023'; end if;
  if not pg_try_advisory_xact_lock(hashtextextended('netunim_financial_write:'||v_owner::text,0)) then
    raise exception 'save_busy' using errcode='PT429',hint='Another financial save is already in progress. Retry later.';
  end if;
  perform set_config('lock_timeout','100ms',true);
  v_payload_hash:=encode(extensions.digest(convert_to(p_state::text,'UTF8'),'sha256'),'hex');
  select o.payload_sha256,o.applied_revision into v_ledger_hash,v_applied_revision
  from netunim_internal.document_sync_operations o
  where o.owner_id=v_owner and o.domain='finance' and o.document_name=p_document_name and o.operation_id=p_operation_id;
  if found then
    if v_ledger_hash<>v_payload_hash then raise exception 'idempotency_key_reuse' using errcode='PT422',hint='An operation id cannot be reused with a different payload.'; end if;
    select d.revision,d.updated_at,d.state into revision,updated_at,state from public.finance_sync_documents d where d.owner_id=v_owner and d.document_name=p_document_name;
    if revision is null then raise exception 'operation_replay_document_missing' using errcode='P0002'; end if;
    operation_replayed:=true;operation_revision:=v_applied_revision;return next;return;
  end if;
  begin
    select x.revision,x.updated_at,x.state into v_saved_revision,v_saved_updated_at,v_saved_state
    from netunim_internal.save_finance_sync_document(p_document_name,p_expected_revision,p_state) x;
  exception when lock_not_available then raise exception 'save_busy' using errcode='PT429',hint='A financial row is temporarily locked. Retry later.'; end;
  if v_saved_revision is null then raise exception 'save_result_missing' using errcode='P0002'; end if;
  insert into netunim_internal.document_sync_operations(owner_id,domain,document_name,operation_id,payload_sha256,applied_revision,created_at)
  values(v_owner,'finance',p_document_name,p_operation_id,v_payload_hash,v_saved_revision,coalesce(v_saved_updated_at,now()));
  select d.revision,d.updated_at,d.state into revision,updated_at,state from public.finance_sync_documents d where d.owner_id=v_owner and d.document_name=p_document_name;
  operation_replayed:=false;operation_revision:=v_saved_revision;return next;
end $$;

revoke all on function public.save_order_management_document_v3(text,bigint,jsonb,text) from public,anon;
revoke all on function public.save_shared_checks_document_v3(text,bigint,jsonb,text) from public,anon;
revoke all on function public.save_kupa_document_v3(text,bigint,jsonb,text) from public,anon;
revoke all on function public.save_finance_sync_document_v3(text,bigint,jsonb,text) from public,anon;
grant execute on function public.save_order_management_document_v3(text,bigint,jsonb,text) to authenticated;
grant execute on function public.save_shared_checks_document_v3(text,bigint,jsonb,text) to authenticated;
grant execute on function public.save_kupa_document_v3(text,bigint,jsonb,text) to authenticated;
grant execute on function public.save_finance_sync_document_v3(text,bigint,jsonb,text) to authenticated;

revoke all on function netunim_internal.save_finance_sync_document(text,bigint,jsonb) from public, anon;
revoke all on function netunim_internal.save_bank_sync_snapshot(text,jsonb,text,bigint) from public, anon;
grant execute on function netunim_internal.save_finance_sync_document(text,bigint,jsonb) to authenticated;
grant execute on function netunim_internal.save_bank_sync_snapshot(text,jsonb,text,bigint) to authenticated;

notify pgrst,'reload schema';
commit;
