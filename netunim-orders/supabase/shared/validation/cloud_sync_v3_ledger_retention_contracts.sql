-- STAGING ONLY. Requires both Cloud Sync v3 migrations and a dedicated owner.
-- Usage: psql -v owner_id='<dedicated-test-user-uuid>' -f cloud_sync_v3_ledger_retention_contracts.sql
-- Every mutation, including maintenance, is rolled back.
\if :{?owner_id}
\else
  \echo 'owner_id is required; refusing to run'
  \quit
\endif

begin;
select set_config('request.jwt.claim.sub', :'owner_id', true);
select set_config('request.jwt.claims', jsonb_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

do $authorization$
begin
  if has_function_privilege('anon', 'netunim_internal.prune_sync_operation_ledgers()', 'EXECUTE')
     or has_function_privilege('authenticated', 'netunim_internal.prune_sync_operation_ledgers()', 'EXECUTE') then
    raise exception 'browser_role_can_execute_ledger_cleanup';
  end if;
  if has_table_privilege('anon', 'netunim_internal.document_sync_operations', 'DELETE')
     or has_table_privilege('authenticated', 'netunim_internal.document_sync_operations', 'DELETE')
     or has_table_privilege('anon', 'netunim_internal.bank_sync_operations', 'DELETE')
     or has_table_privilege('authenticated', 'netunim_internal.bank_sync_operations', 'DELETE') then
    raise exception 'browser_role_can_delete_ledger_rows';
  end if;
  if not has_function_privilege('service_role', 'netunim_internal.prune_sync_operation_ledgers()', 'EXECUTE') then
    raise exception 'service_role_cannot_execute_ledger_cleanup';
  end if;
end
$authorization$;

create temporary table business_before on commit drop as
select jsonb_build_object(
  'orders', (select to_jsonb(d) from public.order_management_documents d where owner_id=:'owner_id'::uuid and document_name='suppliers'),
  'kupa', (select to_jsonb(d) from public.kupa_documents d where owner_id=:'owner_id'::uuid and document_name='main'),
  'checks', (select to_jsonb(d) from public.shared_checks_documents d where owner_id=:'owner_id'::uuid and document_name='main'),
  'finance', (select to_jsonb(d) from public.finance_sync_documents d where owner_id=:'owner_id'::uuid and document_name='main')
) as snapshot;

insert into netunim_internal.document_sync_operations(
  owner_id, domain, document_name, operation_id, payload_sha256, applied_revision, created_at
)
select :'owner_id'::uuid,
       'orders',
       'retention-contract-document',
       'retention-old-' || value::text,
       repeat('a', 64),
       value,
       timestamptz '2000-01-01 00:00:00+00' + make_interval(secs => value)
from generate_series(1, 101) value;

insert into netunim_internal.document_sync_operations(
  owner_id, domain, document_name, operation_id, payload_sha256, applied_revision, created_at
) values (
  :'owner_id'::uuid, 'orders', 'retention-contract-document', 'retention-fresh', repeat('b', 64), 102, statement_timestamp()
);

insert into netunim_internal.bank_sync_operations(
  owner_id, document_name, operation_id, snapshot_seq, payload_sha256, created_at
)
select :'owner_id'::uuid,
       'retention-contract-bank',
       'retention-bank-old-' || value::text,
       value,
       repeat('c', 64),
       timestamptz '2000-01-01 00:00:00+00' + make_interval(secs => value)
from generate_series(1, 101) value;

insert into netunim_internal.bank_sync_operations(
  owner_id, document_name, operation_id, snapshot_seq, payload_sha256, created_at
) values (
  :'owner_id'::uuid, 'retention-contract-bank', 'retention-bank-fresh', 102, repeat('d', 64), statement_timestamp()
);

select * from netunim_internal.prune_sync_operation_ledgers();

do $retention$
declare
  v_document_count bigint;
  v_bank_count bigint;
  v_before jsonb;
  v_after jsonb;
begin
  select count(*) into v_document_count
  from netunim_internal.document_sync_operations
  where owner_id=:'owner_id'::uuid and domain='orders' and document_name='retention-contract-document';
  if v_document_count <> 100 then raise exception 'document_keep_floor_failed: %', v_document_count; end if;
  if not exists (
    select 1 from netunim_internal.document_sync_operations
    where owner_id=:'owner_id'::uuid and domain='orders' and document_name='retention-contract-document'
      and operation_id='retention-fresh' and created_at >= statement_timestamp() - interval '1 day'
  ) then raise exception 'fresh_document_operation_deleted'; end if;

  select count(*) into v_bank_count
  from netunim_internal.bank_sync_operations
  where owner_id=:'owner_id'::uuid and document_name='retention-contract-bank';
  if v_bank_count <> 100 then raise exception 'bank_keep_floor_failed: %', v_bank_count; end if;
  if not exists (
    select 1 from netunim_internal.bank_sync_operations
    where owner_id=:'owner_id'::uuid and document_name='retention-contract-bank'
      and operation_id='retention-bank-fresh' and created_at >= statement_timestamp() - interval '1 day'
  ) then raise exception 'fresh_bank_operation_deleted'; end if;

  select snapshot into v_before from business_before;
  select jsonb_build_object(
    'orders', (select to_jsonb(d) from public.order_management_documents d where owner_id=:'owner_id'::uuid and document_name='suppliers'),
    'kupa', (select to_jsonb(d) from public.kupa_documents d where owner_id=:'owner_id'::uuid and document_name='main'),
    'checks', (select to_jsonb(d) from public.shared_checks_documents d where owner_id=:'owner_id'::uuid and document_name='main'),
    'finance', (select to_jsonb(d) from public.finance_sync_documents d where owner_id=:'owner_id'::uuid and document_name='main')
  ) into v_after;
  if v_before is distinct from v_after then raise exception 'cleanup_touched_business_documents'; end if;
end
$retention$;

do $writers_after_cleanup$
declare
  v_revision bigint;
  v_state jsonb;
  v_operation text := 'retention-replay-' || gen_random_uuid()::text;
  v_first record;
  v_replay record;
begin
  select revision, state into v_revision, v_state
  from public.order_management_documents where owner_id=auth.uid() and document_name='suppliers';
  v_state := jsonb_set(v_state, '{_retentionContract}', to_jsonb(v_operation), true);
  select * into v_first from public.save_order_management_document_v3('suppliers', v_revision, v_state, v_operation);
  select * into v_replay from public.save_order_management_document_v3('suppliers', v_revision, v_state, v_operation);
  if not v_replay.operation_replayed or v_replay.operation_revision <> v_first.revision then
    raise exception 'retained_operation_replay_not_idempotent';
  end if;
  begin
    perform public.save_order_management_document_v3('suppliers', v_revision, jsonb_set(v_state, '{_retentionContract}', '"different"'::jsonb, true), v_operation);
    raise exception 'retained_operation_payload_reuse_not_rejected';
  exception when sqlstate 'PT422' then null; end;

  select revision, state into v_revision, v_state from public.kupa_documents where owner_id=auth.uid() and document_name='main';
  perform public.save_kupa_document_v3('main', v_revision, v_state, 'retention-kupa-' || gen_random_uuid()::text);
  select revision, state into v_revision, v_state from public.shared_checks_documents where owner_id=auth.uid() and document_name='main';
  perform public.save_shared_checks_document_v3('main', v_revision, v_state, 'retention-checks-' || gen_random_uuid()::text);
  select revision, state into v_revision, v_state from public.finance_sync_documents where owner_id=auth.uid() and document_name='main';
  perform public.save_finance_sync_document_v3('main', v_revision, v_state, 'retention-finance-' || gen_random_uuid()::text);
end
$writers_after_cleanup$;

rollback;
\echo 'PASS cloud sync v3 ledger retention contracts (transaction rolled back)'
