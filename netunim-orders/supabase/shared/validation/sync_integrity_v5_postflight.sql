-- Read-only v5 production postflight. Run after the v5 migration and before opening writes.
begin transaction read only;

do $postflight$
declare v_missing text[];v_disabled text[];
begin
  select array_agg(signature) into v_missing from unnest(array[
    'public.save_order_management_document_v5(text,bigint,jsonb,text,jsonb,jsonb)',
    'public.save_kupa_document_v5(text,bigint,jsonb,text,jsonb,jsonb)',
    'public.save_shared_checks_document_v5(text,bigint,jsonb,text,jsonb,jsonb)',
    'public.save_finance_sync_document_v5(text,bigint,jsonb,text,jsonb)',
    'public.bulk_delete_save_order_management_document_v5(text,bigint,jsonb,text,jsonb,jsonb)',
    'public.bulk_delete_save_kupa_document_v5(text,bigint,jsonb,text,jsonb,jsonb)',
    'public.bulk_delete_save_shared_checks_document_v5(text,bigint,jsonb,text,jsonb,jsonb)',
    'public.stage_restore_group_v5(uuid,text,text,bigint,jsonb,jsonb,text,bigint,jsonb,jsonb,text,text,jsonb)',
    'public.apply_restore_group_v5(uuid)',
    'netunim_internal.assert_document_invariants(text,jsonb)'
  ]) signature where to_regprocedure(signature) is null;
  if v_missing is not null then raise exception 'v5_postflight_missing_functions: %',v_missing;end if;

  select array_agg(required.name) into v_disabled
  from unnest(array[
    'order_management_documents_invariant_guard','kupa_documents_invariant_guard','shared_checks_documents_invariant_guard',
    'order_management_mass_destructive_guard','kupa_mass_destructive_guard','shared_checks_mass_destructive_guard',
    'order_management_delete_intent_guard','kupa_delete_intent_guard','shared_checks_delete_intent_guard',
    'order_management_documents_write_guard','kupa_documents_write_guard','shared_checks_documents_write_guard'
  ]) required(name)
  left join pg_trigger trigger on trigger.tgname=required.name and not trigger.tgisinternal and trigger.tgenabled in ('O','A')
  where trigger.oid is null;
  if v_disabled is not null then raise exception 'v5_postflight_missing_or_disabled_triggers: %',v_disabled;end if;

  if exists(select 1 from unnest(array[
    'public.order_management_documents','public.kupa_documents','public.shared_checks_documents',
    'public.order_management_document_backups','public.order_management_periodic_backups',
    'public.kupa_document_backups','public.kupa_periodic_backups',
    'public.shared_checks_document_backups','public.shared_checks_periodic_backups',
    'netunim_internal.document_sync_operations','netunim_internal.safety_snapshots','netunim_internal.restore_operation_groups'
  ]) relation(name) join pg_class c on c.oid=to_regclass(relation.name) where not c.relrowsecurity) then raise exception 'v5_postflight_rls_disabled';end if;

  if exists(select 1 from unnest(array[
    'public.order_management_document_backups','public.order_management_periodic_backups',
    'public.kupa_document_backups','public.kupa_periodic_backups',
    'public.shared_checks_document_backups','public.shared_checks_periodic_backups',
    'netunim_internal.safety_snapshots'
  ]) relation(name) where has_table_privilege('authenticated',relation.name,'UPDATE') or has_table_privilege('authenticated',relation.name,'DELETE') or has_table_privilege('authenticated',relation.name,'TRUNCATE')) then raise exception 'v5_postflight_browser_backup_mutation_grant';end if;

  if has_table_privilege('authenticated','netunim_internal.safety_snapshots','INSERT')
     or has_table_privilege('authenticated','netunim_internal.restore_operation_groups','INSERT')
     or has_table_privilege('authenticated','netunim_internal.restore_operation_groups','UPDATE')
     or has_table_privilege('authenticated','netunim_internal.restore_operation_groups','DELETE')
     or has_table_privilege('authenticated','netunim_internal.restore_operation_groups','TRUNCATE') then raise exception 'v5_postflight_browser_internal_mutation_grant';end if;

  if has_table_privilege('authenticated','netunim_internal.document_sync_operations','UPDATE')
     or has_table_privilege('authenticated','netunim_internal.document_sync_operations','DELETE')
     or has_table_privilege('authenticated','netunim_internal.document_sync_operations','TRUNCATE')
     or has_function_privilege('authenticated','netunim_internal.prune_sync_operation_ledgers()','EXECUTE') then raise exception 'v5_postflight_browser_ledger_maintenance_grant';end if;

  if not exists(select 1 from cron.job where jobname='netunim-sync-ledger-retention-weekly' and active and command='select * from netunim_internal.prune_sync_operation_ledgers();') then raise exception 'v5_postflight_ledger_schedule_missing';end if;
  if exists(select 1 from unnest(array[
    'netunim_internal.save_order_management_document(text,bigint,jsonb)',
    'netunim_internal.save_kupa_document(text,bigint,jsonb)',
    'netunim_internal.save_shared_checks_document(text,bigint,jsonb)'
  ]) signature where lower(pg_get_functiondef(to_regprocedure(signature))) like '%delete from public.%backups%') then raise exception 'v5_postflight_browser_triggered_backup_pruning_present';end if;
  if not exists(select 1 from pg_policies where schemaname='netunim_internal' and tablename='safety_snapshots' and policyname='safety_snapshots_select_own')
     or not exists(select 1 from pg_policies where schemaname='netunim_internal' and tablename='restore_operation_groups' and policyname='restore_groups_select_own') then raise exception 'v5_postflight_owner_rls_policy_missing';end if;
  if exists(select 1 from pg_policies where schemaname='netunim_internal' and tablename in ('safety_snapshots','restore_operation_groups') and cmd in ('INSERT','UPDATE','DELETE','ALL')) then raise exception 'v5_postflight_internal_mutation_policy_present';end if;
  if exists(select 1 from unnest(array[
    'public.save_order_management_document_v5(text,bigint,jsonb,text,jsonb,jsonb)',
    'public.save_kupa_document_v5(text,bigint,jsonb,text,jsonb,jsonb)',
    'public.save_shared_checks_document_v5(text,bigint,jsonb,text,jsonb,jsonb)',
    'public.save_finance_sync_document_v5(text,bigint,jsonb,text,jsonb)',
    'public.bulk_delete_save_order_management_document_v5(text,bigint,jsonb,text,jsonb,jsonb)',
    'public.bulk_delete_save_kupa_document_v5(text,bigint,jsonb,text,jsonb,jsonb)',
    'public.bulk_delete_save_shared_checks_document_v5(text,bigint,jsonb,text,jsonb,jsonb)',
    'public.stage_restore_group_v5(uuid,text,text,bigint,jsonb,jsonb,text,bigint,jsonb,jsonb,text,text,jsonb)',
    'public.apply_restore_group_v5(uuid)'
  ]) signature where not has_function_privilege('authenticated',signature,'EXECUTE') or has_function_privilege('anon',signature,'EXECUTE')) then raise exception 'v5_postflight_rpc_grant_mismatch';end if;
  raise notice 'PASS sync integrity v5 postflight';
end
$postflight$;

rollback;
