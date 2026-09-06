-- Review candidate: qualify owner/group predicates against OUT parameter names.
-- Production has plpgsql.variable_conflict=error. No rows are rewritten by this DDL.
BEGIN;
CREATE OR REPLACE FUNCTION public.apply_restore_group_v5(p_restore_group_id uuid)
 RETURNS TABLE(restore_group_id uuid, phase text, main_revision bigint, checks_revision bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'netunim_internal'
AS $function$
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
  -- Failed applies deliberately leave the last durable phase unchanged: this entire
  -- function is atomic, so an exception also rolls back phase bookkeeping. Operators
  -- must monitor the failed RPC/database log, not infer a durable error from this row.
  update netunim_internal.restore_operation_groups as g set phase='main_pending',updated_at=now() where g.owner_id=v_owner and g.restore_group_id=p_restore_group_id;
  perform netunim_internal.capture_safety_snapshot(v_owner,v_group.app_site,v_group.main_document_name,v_group.main_operation_id,'restore',v_group.restore_group_id);
  if v_group.app_site='orders' then
    select * into v_main from public.save_order_management_document_v5(v_group.main_document_name,v_group.main_base_revision,v_group.main_state,v_group.main_operation_id,v_group.main_delete_intents,v_group.audit||jsonb_build_object('mutationType','restore','restoreGroupId',v_group.restore_group_id));
  else
    select * into v_main from public.save_kupa_document_v5(v_group.main_document_name,v_group.main_base_revision,v_group.main_state,v_group.main_operation_id,v_group.main_delete_intents,v_group.audit||jsonb_build_object('mutationType','restore','restoreGroupId',v_group.restore_group_id));
  end if;
  update netunim_internal.restore_operation_groups as g set phase='main_acked',updated_at=now() where g.owner_id=v_owner and g.restore_group_id=p_restore_group_id;
  if v_group.checks_state is not null then
    update netunim_internal.restore_operation_groups as g set phase='checks_pending',updated_at=now() where g.owner_id=v_owner and g.restore_group_id=p_restore_group_id;
    perform netunim_internal.capture_safety_snapshot(v_owner,'shared-checks',v_group.checks_document_name,v_group.checks_operation_id,'restore',v_group.restore_group_id);
    select * into v_checks from public.save_shared_checks_document_v5(v_group.checks_document_name,v_group.checks_base_revision,v_group.checks_state,v_group.checks_operation_id,v_group.checks_delete_ids,v_group.audit||jsonb_build_object('mutationType','restore','restoreGroupId',v_group.restore_group_id));
    update netunim_internal.restore_operation_groups as g set phase='checks_acked',updated_at=now() where g.owner_id=v_owner and g.restore_group_id=p_restore_group_id;
  end if;
  perform set_config('app.destructive_operation_kind','',true);
  update netunim_internal.restore_operation_groups as g set phase='completed',completed_at=now(),updated_at=now() where g.owner_id=v_owner and g.restore_group_id=p_restore_group_id;
  restore_group_id:=v_group.restore_group_id;phase:='completed';main_revision:=v_main.revision;
  checks_revision:=null;
  if v_group.checks_state is not null then checks_revision:=v_checks.revision;end if;
  return next;
end
$function$
;
COMMIT;
