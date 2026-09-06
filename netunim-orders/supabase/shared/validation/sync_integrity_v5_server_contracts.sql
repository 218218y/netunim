-- STAGING ONLY. Run after sync_integrity_v5_upgrade.sql with a dedicated test user.
-- psql -v owner_id='<dedicated-test-user-uuid>' -f sync_integrity_v5_server_contracts.sql
-- All business-document changes are rolled back.
\if :{?owner_id}
\else
  \echo 'owner_id is required; refusing to run'
  \quit
\endif

begin;
select set_config('request.jwt.claim.sub', :'owner_id', true);
select set_config('request.jwt.claims', jsonb_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

do $contracts$
declare
  v_doc text:='sync-v5-'||gen_random_uuid()::text;v_checks_doc text:='sync-v5-checks-'||gen_random_uuid()::text;
  v_state jsonb;v_candidate jsonb;v_checks jsonb;v_revision bigint;v_checks_revision bigint;v_before_revision bigint;v_before_state jsonb;
  v_ids jsonb;v_group uuid:=gen_random_uuid();v_main_op text:=gen_random_uuid()::text;v_checks_op text:=gen_random_uuid()::text;v_result record;
  v_kupa_doc text:='sync-v5-kupa-'||gen_random_uuid()::text;v_kupa_state jsonb;v_kupa_revision bigint;v_finance_doc text:='sync-v5-finance-'||gen_random_uuid()::text;v_finance_op text:=gen_random_uuid()::text;
  v_finance_revision bigint;v_finance_state jsonb;v_finance_after_revision bigint;v_finance_after_state jsonb;
  v_retention_doc text:='sync-v5-retention-'||gen_random_uuid()::text;v_count bigint;v_min_revision bigint;v_max_revision bigint;v_safety_before bigint;v_safety_after bigint;
begin
  select revision,state into v_finance_revision,v_finance_state from public.finance_sync_documents where owner_id=auth.uid() and document_name='main';
  v_state:=jsonb_build_object(
    'version',4,'businessName','sync-v5','suppliers',(select jsonb_agg(jsonb_build_object('id','S-'||n,'name','supplier '||n)) from generate_series(1,55)n),
    'transactions','[]'::jsonb,'customerDebts','[]'::jsonb,'customerOrders','[]'::jsonb,'serviceCalls','[]'::jsonb,'notes','[]'::jsonb,
    'inventoryItems','[]'::jsonb,'inventoryCategoryOrder','[]'::jsonb,'inventoryEvents','[]'::jsonb,'warehouseOrders','[]'::jsonb
  );
  select revision into v_revision from public.save_order_management_document_v5(v_doc,0,v_state,gen_random_uuid()::text,'{}'::jsonb,'{"mutationType":"fixture"}'::jsonb);
  v_before_revision:=v_revision;v_before_state:=v_state;

  -- Historical 55 -> 1 stale snapshot without intent: fail closed and preserve both row and revision.
  v_candidate:=jsonb_set(v_state,'{suppliers}',jsonb_build_array(v_state#>'{suppliers,0}'),true);
  begin
    perform public.save_order_management_document_v5(v_doc,v_revision,v_candidate,gen_random_uuid()::text,'{}'::jsonb,'{"mutationType":"autosave"}'::jsonb);
    raise exception 'stale_55_to_1_was_accepted';
  exception when sqlstate 'PT422' then null;end;
  select revision,state into v_revision,v_state from public.order_management_documents where owner_id=auth.uid() and document_name=v_doc;
  if v_revision<>v_before_revision or v_state<>v_before_state then raise exception 'stale_rejection_changed_document';end if;

  -- Even exact explicit IDs may not turn routine autosave into mass delete.
  select jsonb_agg('S-'||n order by n) into v_ids from generate_series(2,55)n;
  begin
    perform public.save_order_management_document_v5(v_doc,v_revision,v_candidate,gen_random_uuid()::text,jsonb_build_object('suppliers',v_ids),'{"mutationType":"autosave"}'::jsonb);
    raise exception 'routine_mass_delete_was_accepted';
  exception when sqlstate 'PT422' then null;end;
  if (select revision from public.order_management_documents where owner_id=auth.uid() and document_name=v_doc)<>v_revision then raise exception 'mass_guard_changed_revision';end if;

  -- Dedicated, user-confirmed bulk path removes only exact IDs and captures immutable safety state.
  v_main_op:=gen_random_uuid()::text;
  select * into v_result from public.bulk_delete_save_order_management_document_v5(v_doc,v_revision,v_candidate,v_main_op,jsonb_build_object('suppliers',v_ids),'{"app":"orders","clientInstanceId":"contract-client","build":"contract-build","mutationType":"bulk-delete","surface":"contract"}'::jsonb);
  v_revision:=v_result.revision;v_state:=v_result.state;
  if jsonb_array_length(v_state->'suppliers')<>1 or not exists(select 1 from netunim_internal.safety_snapshots where owner_id=auth.uid() and domain='orders' and document_name=v_doc and operation_id=v_main_op and revision=v_before_revision) then raise exception 'approved_bulk_contract_failed';end if;
  if not exists(select 1 from netunim_internal.document_sync_operations where owner_id=auth.uid() and operation_id=v_main_op and app_site='orders' and client_instance_id='contract-client' and build_version='contract-build' and mutation_type='bulk-delete' and surface='contract' and base_revision=v_before_revision and before_counts->>'suppliers'='55' and after_counts->>'suppliers'='1' and delete_count=54) then raise exception 'operation_audit_metadata_missing';end if;

  -- Missing, blank and duplicate IDs are rejected before revision change.
  for v_candidate in select candidate from (values
    (jsonb_set(v_state,'{suppliers}','[{"name":"missing"}]'::jsonb,true)),
    (jsonb_set(v_state,'{suppliers}','[{"id":""}]'::jsonb,true)),
    (jsonb_set(v_state,'{suppliers}','[{"id":"D"},{"id":"D"}]'::jsonb,true))
  ) malformed(candidate) loop
    begin perform public.save_order_management_document_v5(v_doc,v_revision,v_candidate,gen_random_uuid()::text,'{}'::jsonb,'{}'::jsonb);raise exception 'malformed_id_was_accepted';exception when sqlstate '22023' then null;end;
    if (select revision from public.order_management_documents where owner_id=auth.uid() and document_name=v_doc)<>v_revision then raise exception 'malformed_id_changed_revision';end if;
  end loop;

  -- Cards are stable-ID Kupa entities: v5 protects deletion without rewriting v4.
  v_kupa_state:=jsonb_build_object(
    'version',4,'businessName','sync-v5-kupa','credits','[]'::jsonb,'cash','[]'::jsonb,'rights','[]'::jsonb,'notes','[]'::jsonb,
    'expenses','[]'::jsonb,'cards','[{"id":"CARD-1","name":"one"},{"id":"CARD-2","name":"two"}]'::jsonb,
    'notesSheet',jsonb_build_object('version',1,'rows','[]'::jsonb,'columns','[]'::jsonb),
    'bank',jsonb_build_object('adjustments','[{"amount":10}]'::jsonb)
  );
  select revision into v_kupa_revision from public.save_kupa_document_v5(v_kupa_doc,0,v_kupa_state,gen_random_uuid()::text,'{}'::jsonb,'{"app":"kupa","mutationType":"fixture"}'::jsonb);
  v_candidate:=jsonb_set(v_kupa_state,'{cards}','[{"id":"CARD-1","name":"one"}]'::jsonb,true);
  begin perform public.save_kupa_document_v5(v_kupa_doc,v_kupa_revision,v_candidate,gen_random_uuid()::text,'{}'::jsonb,'{}'::jsonb);raise exception 'card_delete_without_intent_was_accepted';exception when sqlstate 'PT422' then null;end;
  select revision into v_kupa_revision from public.save_kupa_document_v5(v_kupa_doc,v_kupa_revision,v_candidate,gen_random_uuid()::text,'{"cards":["CARD-2"]}'::jsonb,'{"app":"kupa","mutationType":"delete"}'::jsonb);
  if (select state->'cards' from public.kupa_documents where owner_id=auth.uid() and document_name=v_kupa_doc)<>v_candidate->'cards' then raise exception 'card_exact_delete_intent_failed';end if;

  -- The separate finance ledger also receives app/client/build metadata through v5.
  perform public.save_finance_sync_document_v5(v_finance_doc,0,'{"version":1,"bank":{},"creditSync":{}}'::jsonb,v_finance_op,'{"app":"orders","clientInstanceId":"contract-client","build":"contract-build","mutationType":"finance-update","surface":"contract.finance"}'::jsonb);
  if not exists(select 1 from netunim_internal.document_sync_operations where owner_id=auth.uid() and domain='finance' and document_name=v_finance_doc and operation_id=v_finance_op and app_site='orders' and mutation_type='finance-update' and surface='contract.finance') then raise exception 'finance_operation_audit_missing';end if;

  -- Prepare Shared Checks, stage every target/hash/intent, then apply both in one restore transaction.
  v_checks:=jsonb_build_object('version',1,'checks','[{"id":"K1"},{"id":"K2"},{"id":"K3"}]'::jsonb,'bankEvents','[]'::jsonb);
  select revision into v_checks_revision from public.save_shared_checks_document_v5(v_checks_doc,0,v_checks,gen_random_uuid()::text,'[]'::jsonb,'{"mutationType":"fixture"}'::jsonb);
  v_candidate:=jsonb_set(v_state,'{suppliers}','[{"id":"RESTORED","name":"restored"}]'::jsonb,true);
  v_main_op:=gen_random_uuid()::text;v_checks_op:=gen_random_uuid()::text;
  perform public.stage_restore_group_v5(v_group,'orders',v_doc,v_revision,v_candidate,jsonb_build_object('suppliers',jsonb_build_array(v_state#>>'{suppliers,0,id}')),v_checks_doc,v_checks_revision,jsonb_set(v_checks,'{checks}','[{"id":"K1"}]'::jsonb,true),'["K2","K3"]'::jsonb,v_main_op,v_checks_op,'{"app":"orders","surface":"contract.restore"}'::jsonb);
  if not exists(select 1 from netunim_internal.restore_operation_groups where owner_id=auth.uid() and restore_group_id=v_group and phase='staged' and main_payload_sha256 is not null and checks_payload_sha256 is not null) then raise exception 'restore_group_not_durably_staged';end if;
  select * into v_result from public.apply_restore_group_v5(v_group);
  if v_result.phase<>'completed' then raise exception 'restore_not_completed';end if;
  if (select count(*) from netunim_internal.safety_snapshots where owner_id=auth.uid() and restore_group_id=v_group)<>2 then raise exception 'pre_restore_snapshots_missing';end if;
  if (select count(distinct restore_group_id) from netunim_internal.document_sync_operations where owner_id=auth.uid() and operation_id in(v_main_op,v_checks_op))<>1 then raise exception 'restore_audit_group_missing';end if;
  v_before_revision:=v_result.main_revision;v_checks_revision:=v_result.checks_revision;
  select * into v_result from public.apply_restore_group_v5(v_group);
  if v_result.main_revision<>v_before_revision or v_result.checks_revision<>v_checks_revision then raise exception 'restore_lost_ack_replay_not_idempotent';end if;

  -- Direct writes and browser-side immutable-history deletion stay forbidden.
  begin update public.order_management_documents set state=state where owner_id=auth.uid() and document_name=v_doc;raise exception 'direct_update_was_accepted';exception when sqlstate '42501' then null;end;
  if has_table_privilege('authenticated','public.order_management_document_backups','DELETE')
     or has_table_privilege('authenticated','public.order_management_periodic_backups','DELETE')
     or has_table_privilege('authenticated','netunim_internal.safety_snapshots','DELETE') then raise exception 'browser_can_delete_immutable_backup';end if;

  -- Trusted backup retention is global but deterministic. This transaction proves
  -- every table contract and then rolls all fixture pruning back.
  if has_function_privilege('authenticated','netunim_internal.prune_document_backups()','EXECUTE')
     or has_function_privilege('anon','netunim_internal.prune_document_backups()','EXECUTE')
     or exists(
       select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
       where p.oid=to_regprocedure('netunim_internal.prune_document_backups()') and acl.grantee=0 and acl.privilege_type='EXECUTE'
     ) then raise exception 'browser_can_execute_backup_prune';end if;
  if exists(
    select 1 from unnest(array[
      'public.order_management_document_backups','public.order_management_periodic_backups',
      'public.kupa_document_backups','public.kupa_periodic_backups',
      'public.shared_checks_document_backups','public.shared_checks_periodic_backups'
    ]) relation(name)
    where has_table_privilege('authenticated',relation.name,'DELETE') or has_table_privilege('anon',relation.name,'DELETE')
  ) then raise exception 'browser_can_delete_backup_for_prune';end if;

  insert into public.order_management_document_backups(owner_id,document_name,revision,state,saved_at)
  select auth.uid(),v_retention_doc,n,v_state,statement_timestamp()-(205-n)*interval '1 minute' from generate_series(1,205)n;
  insert into public.kupa_document_backups(owner_id,document_name,revision,state,saved_at)
  select auth.uid(),v_retention_doc,n,v_kupa_state,statement_timestamp()-(205-n)*interval '1 minute' from generate_series(1,205)n;
  insert into public.shared_checks_document_backups(owner_id,document_name,revision,state,saved_at)
  select auth.uid(),v_retention_doc,n,v_checks,statement_timestamp()-(205-n)*interval '1 minute' from generate_series(1,205)n;

  insert into public.order_management_periodic_backups(owner_id,document_name,revision,state,saved_at) values
    (auth.uid(),v_retention_doc,1001,v_state,statement_timestamp()-interval '364 days'),
    (auth.uid(),v_retention_doc,1002,v_state,statement_timestamp()-interval '366 days');
  insert into public.kupa_periodic_backups(owner_id,document_name,revision,state,saved_at) values
    (auth.uid(),v_retention_doc,1001,v_kupa_state,statement_timestamp()-interval '364 days'),
    (auth.uid(),v_retention_doc,1002,v_kupa_state,statement_timestamp()-interval '366 days');
  insert into public.shared_checks_periodic_backups(owner_id,document_name,revision,state,saved_at) values
    (auth.uid(),v_retention_doc,1001,v_checks,statement_timestamp()-interval '364 days'),
    (auth.uid(),v_retention_doc,1002,v_checks,statement_timestamp()-interval '366 days');

  select count(*) into v_safety_before from netunim_internal.safety_snapshots where owner_id=auth.uid();
  select * into v_result from netunim_internal.prune_document_backups();
  for v_count,v_min_revision,v_max_revision in
    select count(*),min(revision),max(revision) from public.order_management_document_backups where owner_id=auth.uid() and document_name=v_retention_doc
    union all select count(*),min(revision),max(revision) from public.kupa_document_backups where owner_id=auth.uid() and document_name=v_retention_doc
    union all select count(*),min(revision),max(revision) from public.shared_checks_document_backups where owner_id=auth.uid() and document_name=v_retention_doc
  loop
    if v_count<>200 or v_min_revision<>6 or v_max_revision<>205 then raise exception 'trusted_prune_did_not_keep_exactly_200_newest';end if;
  end loop;
  if not exists(select 1 from public.order_management_periodic_backups where owner_id=auth.uid() and document_name=v_retention_doc and revision=1001)
     or not exists(select 1 from public.kupa_periodic_backups where owner_id=auth.uid() and document_name=v_retention_doc and revision=1001)
     or not exists(select 1 from public.shared_checks_periodic_backups where owner_id=auth.uid() and document_name=v_retention_doc and revision=1001) then raise exception 'periodic_backup_under_365_days_was_deleted';end if;
  if exists(select 1 from public.order_management_periodic_backups where owner_id=auth.uid() and document_name=v_retention_doc and revision=1002)
     or exists(select 1 from public.kupa_periodic_backups where owner_id=auth.uid() and document_name=v_retention_doc and revision=1002)
     or exists(select 1 from public.shared_checks_periodic_backups where owner_id=auth.uid() and document_name=v_retention_doc and revision=1002) then raise exception 'periodic_backup_over_365_days_was_retained';end if;
  select count(*) into v_safety_after from netunim_internal.safety_snapshots where owner_id=auth.uid();
  if v_safety_after<>v_safety_before then raise exception 'backup_retention_changed_safety_snapshots';end if;

  select revision,state into v_finance_after_revision,v_finance_after_state from public.finance_sync_documents where owner_id=auth.uid() and document_name='main';
  if v_finance_after_revision is distinct from v_finance_revision or v_finance_after_state is distinct from v_finance_state then raise exception 'finance_document_changed_by_core_restore';end if;
  raise notice 'PASS sync integrity v5 destructive/invariant/restore contracts';
end
$contracts$;

rollback;
\echo 'PASS sync integrity v5 server contracts (transaction rolled back)'
