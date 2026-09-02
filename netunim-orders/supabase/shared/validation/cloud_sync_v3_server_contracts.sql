-- STAGING ONLY. Run with psql -v owner_id='<dedicated-test-user-uuid>' -f cloud_sync_v3_server_contracts.sql
-- Every mutation is enclosed in this transaction and rolled back.
\if :{?owner_id}
\else
  \echo 'owner_id is required; refusing to run'
  \quit
\endif

begin;
select set_config('request.jwt.claim.sub', :'owner_id', true);
select set_config('request.jwt.claims', jsonb_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

do $orders$
declare v_revision bigint;v_state jsonb;v_probe jsonb;v_remote jsonb;v_operation text:=gen_random_uuid()::text;v_first record;v_replay record;v_remote_revision bigint;
begin
  select revision,state into v_revision,v_state from public.order_management_documents where owner_id=auth.uid() and document_name='suppliers';
  if v_state is null then raise exception 'orders_test_document_missing'; end if;
  v_probe:=jsonb_set(v_state,'{_syncV3Probe}',to_jsonb(gen_random_uuid()::text),true);
  select * into v_first from public.save_order_management_document_v3('suppliers',v_revision,v_probe,v_operation);
  v_remote:=jsonb_set(v_probe,'{_syncV3Remote}',to_jsonb(gen_random_uuid()::text),true);
  select revision into v_remote_revision from public.save_order_management_document('suppliers',v_first.revision,v_remote);
  select * into v_replay from public.save_order_management_document_v3('suppliers',v_revision,v_probe,v_operation);
  if not v_replay.operation_replayed or v_replay.operation_revision<>v_first.revision or v_replay.revision<>v_remote_revision or v_replay.state<>v_remote then
    raise exception 'orders_intervening_write_replay_failed';
  end if;
  begin perform public.save_order_management_document_v3('suppliers',v_revision,jsonb_set(v_probe,'{_syncV3Probe}',to_jsonb('different'::text),true),v_operation);raise exception 'orders_idempotency_reuse_missing';exception when sqlstate 'PT422' then null;end;
  begin perform public.save_order_management_document_v3('suppliers',v_revision,v_probe,gen_random_uuid()::text);raise exception 'orders_expected_conflict_missing';exception when sqlstate 'PT409' then null;end;
  raise notice 'PASS orders operation replay applied=% current=%',v_first.revision,v_replay.revision;
end
$orders$;

do $kupa$
declare v_revision bigint;v_state jsonb;v_probe jsonb;v_remote jsonb;v_operation text:=gen_random_uuid()::text;v_first record;v_replay record;v_remote_revision bigint;
begin
  select revision,state into v_revision,v_state from public.kupa_documents where owner_id=auth.uid() and document_name='main';
  if v_state is null then raise exception 'kupa_test_document_missing'; end if;
  v_probe:=jsonb_set(v_state,'{_syncV3Probe}',to_jsonb(gen_random_uuid()::text),true);
  select * into v_first from public.save_kupa_document_v3('main',v_revision,v_probe,v_operation);
  v_remote:=jsonb_set(v_probe,'{_syncV3Remote}',to_jsonb(gen_random_uuid()::text),true);
  select revision into v_remote_revision from public.save_kupa_document('main',v_first.revision,v_remote);
  select * into v_replay from public.save_kupa_document_v3('main',v_revision,v_probe,v_operation);
  if not v_replay.operation_replayed or v_replay.operation_revision<>v_first.revision or v_replay.revision<>v_remote_revision or v_replay.state<>v_remote then raise exception 'kupa_intervening_write_replay_failed'; end if;
  begin perform public.save_kupa_document_v3('main',v_revision,jsonb_set(v_probe,'{_syncV3Probe}',to_jsonb('different'::text),true),v_operation);raise exception 'kupa_idempotency_reuse_missing';exception when sqlstate 'PT422' then null;end;
  begin perform public.save_kupa_document_v3('main',v_revision,v_probe,gen_random_uuid()::text);raise exception 'kupa_expected_conflict_missing';exception when sqlstate 'PT409' then null;end;
  raise notice 'PASS kupa operation replay applied=% current=%',v_first.revision,v_replay.revision;
end
$kupa$;

do $checks$
declare v_revision bigint;v_state jsonb;v_probe jsonb;v_remote jsonb;v_operation text:=gen_random_uuid()::text;v_first record;v_replay record;v_remote_revision bigint;
begin
  select revision,state into v_revision,v_state from public.shared_checks_documents where owner_id=auth.uid() and document_name='main';
  if v_state is null then raise exception 'shared_checks_test_document_missing'; end if;
  if jsonb_array_length(v_state->'checks')=0 then
    v_probe:=jsonb_set(v_state,'{checks}',jsonb_build_array(jsonb_build_object('id','sync-v3-contract-check','amount',0,'dueDate','2026-01-01','status','בקופה','_syncV3Probe',gen_random_uuid()::text)),true);
  else v_probe:=jsonb_set(v_state,'{checks,0,_syncV3Probe}',to_jsonb(gen_random_uuid()::text),true);end if;
  select * into v_first from public.save_shared_checks_document_v3('main',v_revision,v_probe,v_operation);
  v_remote:=jsonb_set(v_probe,'{checks,0,_syncV3Remote}',to_jsonb(gen_random_uuid()::text),true);
  select revision into v_remote_revision from public.save_shared_checks_document('main',v_first.revision,v_remote);
  select * into v_replay from public.save_shared_checks_document_v3('main',v_revision,v_probe,v_operation);
  if not v_replay.operation_replayed or v_replay.operation_revision<>v_first.revision or v_replay.revision<>v_remote_revision or v_replay.state<>v_remote then raise exception 'checks_intervening_write_replay_failed'; end if;
  begin perform public.save_shared_checks_document_v3('main',v_revision,jsonb_set(v_probe,'{checks,0,_syncV3Probe}',to_jsonb('different'::text),true),v_operation);raise exception 'checks_idempotency_reuse_missing';exception when sqlstate 'PT422' then null;end;
  begin perform public.save_shared_checks_document_v3('main',v_revision,v_probe,gen_random_uuid()::text);raise exception 'checks_expected_conflict_missing';exception when sqlstate 'PT409' then null;end;
  raise notice 'PASS checks operation replay applied=% current=%',v_first.revision,v_replay.revision;
end
$checks$;

do $finance$
declare v_revision bigint;v_state jsonb;v_probe jsonb;v_remote jsonb;v_operation text:=gen_random_uuid()::text;v_first record;v_replay record;v_remote_revision bigint;
begin
  select revision,state into v_revision,v_state from public.finance_sync_documents where owner_id=auth.uid() and document_name='main';
  if v_state is null then raise exception 'finance_test_document_missing'; end if;
  v_probe:=jsonb_set(v_state,'{_syncV3Probe}',to_jsonb(gen_random_uuid()::text),true);
  select * into v_first from public.save_finance_sync_document_v3('main',v_revision,v_probe,v_operation);
  v_remote:=jsonb_set(v_probe,'{_syncV3Remote}',to_jsonb(gen_random_uuid()::text),true);
  select revision into v_remote_revision from public.save_finance_sync_document('main',v_first.revision,v_remote);
  select * into v_replay from public.save_finance_sync_document_v3('main',v_revision,v_probe,v_operation);
  if not v_replay.operation_replayed or v_replay.operation_revision<>v_first.revision or v_replay.revision<>v_remote_revision or v_replay.state<>v_remote then raise exception 'finance_intervening_write_replay_failed'; end if;
  begin perform public.save_finance_sync_document_v3('main',v_revision,jsonb_set(v_probe,'{_syncV3Probe}',to_jsonb('different'::text),true),v_operation);raise exception 'finance_idempotency_reuse_missing';exception when sqlstate 'PT422' then null;end;
  begin perform public.save_finance_sync_document_v3('main',v_revision,v_probe,gen_random_uuid()::text);raise exception 'finance_expected_conflict_missing';exception when sqlstate 'PT409' then null;end;
  raise notice 'PASS finance operation replay applied=% current=%',v_first.revision,v_replay.revision;
end
$finance$;

do $bank$
declare v_bank jsonb; v_seq bigint; v_token text:=gen_random_uuid()::text; v_first record; v_replay record; v_finance_after bigint; v_kupa_after bigint;
begin
  select f.state->'bank',greatest(0,coalesce((k.state#>>'{bank,snapshotSeq}')::bigint,0))
  into v_bank,v_seq
  from public.finance_sync_documents f join public.kupa_documents k using(owner_id,document_name)
  where f.owner_id=auth.uid() and f.document_name='main';
  if v_bank is null then raise exception 'bank_test_state_missing'; end if;
  select * into v_first from public.save_bank_sync_snapshot('main',v_bank,v_token,v_seq);
  select * into v_replay from public.save_bank_sync_snapshot('main',v_bank,v_token,v_seq);
  select revision into v_finance_after from public.finance_sync_documents where owner_id=auth.uid() and document_name='main';
  select revision into v_kupa_after from public.kupa_documents where owner_id=auth.uid() and document_name='main';
  if v_first.finance_revision<>v_replay.finance_revision or v_first.kupa_revision<>v_replay.kupa_revision
     or v_replay.finance_revision<>v_finance_after or v_replay.kupa_revision<>v_kupa_after then
    raise exception 'bank_lost_ack_replay_bumped_revision';
  end if;
  begin
    perform public.save_bank_sync_snapshot('main',jsonb_set(v_bank,'{_syncV3Probe}','true'::jsonb,true),v_token,v_seq);
    raise exception 'bank_idempotency_key_reuse_not_rejected';
  exception when sqlstate 'PT422' then null; end;
  raise notice 'PASS bank token replay finance=% kupa=%',v_replay.finance_revision,v_replay.kupa_revision;
end
$bank$;

do $merge$
declare v_key text:='sync-v3-contract-'||gen_random_uuid()::text; v_batch jsonb; v_first record; v_second record;
begin
  v_batch:=jsonb_build_array(jsonb_build_object(
    'mergeKey',v_key,'date','2026-01-02T10:00:00Z','processedDate','2026-01-02T10:00:00Z',
    'amount',1,'currency','ILS','description','sync-v3-contract','memo','same-payload',
    'status','completed','bankReference',v_key,'bankSerial','0','cheque',false
  ));
  select * into v_first from public.merge_bank_transactions('sync-v3-contract','business',v_batch);
  select * into v_second from public.merge_bank_transactions('sync-v3-contract','business',v_batch);
  if v_first.inserted_count<>1 or v_second.inserted_count<>0 or v_second.updated_count<>0 or v_first.total_count<>v_second.total_count then
    raise exception 'bank_merge_replay_not_idempotent';
  end if;
  raise notice 'PASS merge replay total=%',v_second.total_count;
end
$merge$;

do $leases$
declare v_token text:='sync-v3-lease-'||gen_random_uuid()::text; v_first record; v_second record; v_other record; v_released boolean;
begin
  select * into v_first from public.claim_finance_sync_lease('bank',v_token,120);
  select * into v_second from public.claim_finance_sync_lease('bank',v_token,120);
  select * into v_other from public.claim_finance_sync_lease('bank',v_token||'-other',120);
  if not v_first.acquired or not v_second.acquired or v_other.acquired then raise exception 'finance_lease_claim_not_token_idempotent'; end if;
  select public.release_finance_sync_lease('bank',v_token) into v_released;
  if not v_released or not public.release_finance_sync_lease('bank',v_token) then raise exception 'finance_lease_release_not_idempotent'; end if;
  raise notice 'PASS finance lease token replay';
end
$leases$;

rollback;
\echo 'PASS cloud sync v3 server contracts (transaction rolled back)'
