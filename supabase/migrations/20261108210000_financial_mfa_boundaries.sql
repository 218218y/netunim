BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='30s';

-- An unenrolled account keeps its existing login behavior. Once a factor is
-- verified, only an AAL2 JWT may access financial data. Raise instead of hiding
-- rows, so an older client cannot mistake an assurance failure for deleted data.
CREATE OR REPLACE FUNCTION netunim_internal.require_financial_mfa_v1()
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,auth AS $mfa$
DECLARE v_owner uuid:=auth.uid();
BEGIN
  IF v_owner IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING errcode='42501'; END IF;
  IF EXISTS(SELECT 1 FROM auth.mfa_factors f WHERE f.user_id=v_owner AND f.status='verified')
     AND coalesce(auth.jwt()->>'aal','aal1')<>'aal2' THEN
    RAISE EXCEPTION 'mfa_required' USING errcode='42501',hint='Complete the authenticator challenge before accessing financial data.';
  END IF;
  RETURN true;
END $mfa$;
REVOKE ALL ON FUNCTION netunim_internal.require_financial_mfa_v1() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION netunim_internal.require_financial_mfa_v1() TO authenticated;

-- Static replacements preserve each complete existing definition and privilege.
-- The only body change is the first-statement assurance check. Existing owner,
-- operation fencing, revision checks, leases and financial logic remain intact.

-- MFA boundary: acknowledge_bank_transaction_alert(bigint,text)
CREATE OR REPLACE FUNCTION public.acknowledge_bank_transaction_alert(p_transaction_id bigint, p_alert_kind text)
 RETURNS TABLE(transaction_id bigint, alert_kind text, acknowledged_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_owner uuid:=auth.uid();
  v_kind text:=btrim(coalesce(p_alert_kind,''));
  v_at timestamptz:=now();
begin
  PERFORM netunim_internal.require_financial_mfa_v1();
  if v_owner is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  if p_transaction_id is null or p_transaction_id<=0 then raise exception 'invalid_bank_transaction_id' using errcode='22023'; end if;
  if v_kind not in ('returned_cheque') then raise exception 'unsupported_bank_alert_kind' using errcode='22023'; end if;

  update public.bank_transactions b
     set alert_acknowledgements=coalesce(b.alert_acknowledgements,'{}'::jsonb) || jsonb_build_object(v_kind,v_at)
   where b.id=p_transaction_id and b.owner_id=v_owner
  returning b.id into transaction_id;

  if transaction_id is null then
    raise exception 'bank_alert_transaction_not_found'
      using errcode='P0002',hint='The bank transaction does not exist or is not owned by this user.';
  end if;

  alert_kind:=v_kind;
  acknowledged_at:=v_at;
  return next;
end $function$;

-- MFA boundary: acknowledge_bank_transaction_missing(bigint)
CREATE OR REPLACE FUNCTION public.acknowledge_bank_transaction_missing(p_transaction_id bigint)
 RETURNS TABLE(transaction_id bigint, acknowledged_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_owner uuid:=auth.uid();
begin
  PERFORM netunim_internal.require_financial_mfa_v1();
  if v_owner is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  if p_transaction_id is null or p_transaction_id<=0 then raise exception 'invalid_bank_transaction_id' using errcode='22023'; end if;

  update public.bank_transactions b
     set missing_acknowledged_at=coalesce(b.missing_acknowledged_at,now())
   where b.id=p_transaction_id and b.owner_id=v_owner and b.presence_state='missing'
  returning b.id,b.missing_acknowledged_at into transaction_id,acknowledged_at;

  if transaction_id is null then
    raise exception 'bank_missing_transaction_not_found'
      using errcode='P0002',hint='The row is not a missing bank transaction owned by this user.';
  end if;
  return next;
end $function$;

-- MFA boundary: activate_storage_protocol_v2(bigint,bigint,bigint)
CREATE OR REPLACE FUNCTION public.activate_storage_protocol_v2(p_orders_revision bigint, p_kupa_revision bigint, p_shared_revision bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'netunim_internal'
AS $function$
declare
  v_owner uuid:=auth.uid();v_count integer;v_orders bigint;v_kupa bigint;v_shared bigint;
begin
  PERFORM netunim_internal.require_financial_mfa_v1();
  if v_owner is null then raise exception 'not_authenticated' using errcode='42501';end if;
  if p_orders_revision is null or p_orders_revision<1 or p_kupa_revision is null or p_kupa_revision<1
     or p_shared_revision is null or p_shared_revision<1 then
    raise exception 'storage_protocol_revisions_required' using errcode='22023';
  end if;
  -- Same advisory-lock order as ordinary Orders then financial writes. This
  -- serializes activation with saves before comparing the supplied heads.
  perform pg_advisory_xact_lock(hashtextextended('order_management:'||v_owner::text||':suppliers',0));
  perform pg_advisory_xact_lock(hashtextextended('netunim_financial_write:'||v_owner::text,0));
  select count(*) into v_count from netunim_internal.storage_writer_protocol where owner_id=v_owner;
  if v_count=3 then return public.get_storage_protocol_state();end if;
  if v_count<>0 then raise exception 'storage_protocol_partial_activation' using errcode='PT409';end if;
  if exists(select 1 from netunim_internal.restore_operation_groups g where g.owner_id=v_owner and g.phase<>'completed') then
    raise exception 'storage_protocol_restore_pending' using errcode='PT409';
  end if;
  select d.revision into v_orders from public.order_management_documents d
    where d.owner_id=v_owner and d.document_name='suppliers';
  select d.revision into v_kupa from public.kupa_documents d
    where d.owner_id=v_owner and d.document_name='main';
  select d.revision into v_shared from public.shared_checks_documents d
    where d.owner_id=v_owner and d.document_name='main';
  if v_orders is distinct from p_orders_revision or v_kupa is distinct from p_kupa_revision
     or v_shared is distinct from p_shared_revision then
    raise exception 'storage_protocol_cloud_heads_changed' using errcode='PT409';
  end if;
  insert into netunim_internal.storage_writer_protocol
    (owner_id,domain,min_writer_protocol,activated_revision,activated_by)
  values (v_owner,'orders',2,v_orders,v_owner),
         (v_owner,'kupa',2,v_kupa,v_owner),
         (v_owner,'shared-checks',2,v_shared,v_owner);
  return public.get_storage_protocol_state();
end
$function$;

-- MFA boundary: apply_restore_group_v6(uuid)
CREATE OR REPLACE FUNCTION public.apply_restore_group_v6(p_restore_group_id uuid)
 RETURNS TABLE(restore_group_id uuid, phase text, main_revision bigint, checks_revision bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'netunim_internal'
AS $function$
declare v_app text;v_operation text;
begin
  PERFORM netunim_internal.require_financial_mfa_v1();
  select g.app_site into v_app from netunim_internal.restore_operation_groups g
    where g.owner_id=auth.uid() and g.restore_group_id=p_restore_group_id;
  if v_app not in ('orders','kupa') or v_app is null then
    raise exception 'restore_group_missing' using errcode='P0002';
  end if;
  v_operation:=case v_app when 'orders' then 'restore-orders-apply' else 'restore-kupa-apply' end;
  perform netunim_internal.enter_storage_writer_operation_v2(v_operation);
  return query select * from netunim_internal.apply_restore_group_current(p_restore_group_id);
  perform netunim_internal.leave_storage_writer_operation_v2(v_operation);
end
$function$;

-- MFA boundary: bulk_delete_save_kupa_document_v6(text,bigint,jsonb,text,jsonb,jsonb)
CREATE OR REPLACE FUNCTION public.bulk_delete_save_kupa_document_v6(p_document_name text, p_expected_revision bigint, p_state jsonb, p_operation_id text, p_delete_intents jsonb, p_audit jsonb)
 RETURNS TABLE(revision bigint, updated_at timestamp with time zone, state jsonb, operation_replayed boolean, operation_revision bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'netunim_internal'
AS $function$
declare v_owner uuid:=auth.uid();v_result record;
begin
  PERFORM netunim_internal.require_financial_mfa_v1();
  if v_owner is null then raise exception 'not_authenticated' using errcode='42501';end if;
  perform netunim_internal.enter_storage_writer_operation_v2('kupa-bulk-delete');
  perform set_config('app.destructive_operation_kind','bulk-delete',true);
  perform netunim_internal.capture_safety_snapshot(v_owner,'kupa',p_document_name,p_operation_id,'bulk-delete');
  select * into v_result from netunim_internal.save_kupa_document_current(p_document_name,p_expected_revision,p_state,p_operation_id,p_delete_intents,coalesce(p_audit,'{}'::jsonb)||jsonb_build_object('mutationType','bulk-delete'));
  perform set_config('app.destructive_operation_kind','',true);
  perform netunim_internal.leave_storage_writer_operation_v2('kupa-bulk-delete');
  return query select v_result.revision,v_result.updated_at,v_result.state,v_result.operation_replayed,v_result.operation_revision;
end
$function$;

-- MFA boundary: bulk_delete_save_order_management_document_v6(text,bigint,jsonb,text,jsonb,jsonb)
CREATE OR REPLACE FUNCTION public.bulk_delete_save_order_management_document_v6(p_document_name text, p_expected_revision bigint, p_state jsonb, p_operation_id text, p_delete_intents jsonb, p_audit jsonb)
 RETURNS TABLE(revision bigint, updated_at timestamp with time zone, state jsonb, operation_replayed boolean, operation_revision bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'netunim_internal'
AS $function$
declare v_owner uuid:=auth.uid();v_result record;
begin
  PERFORM netunim_internal.require_financial_mfa_v1();
  if v_owner is null then raise exception 'not_authenticated' using errcode='42501';end if;
  perform netunim_internal.enter_storage_writer_operation_v2('orders-bulk-delete');
  perform set_config('app.destructive_operation_kind','bulk-delete',true);
  perform netunim_internal.capture_safety_snapshot(v_owner,'orders',p_document_name,p_operation_id,'bulk-delete');
  select * into v_result from netunim_internal.save_order_management_document_current(p_document_name,p_expected_revision,p_state,p_operation_id,p_delete_intents,coalesce(p_audit,'{}'::jsonb)||jsonb_build_object('mutationType','bulk-delete'));
  perform set_config('app.destructive_operation_kind','',true);
  perform netunim_internal.leave_storage_writer_operation_v2('orders-bulk-delete');
  return query select v_result.revision,v_result.updated_at,v_result.state,v_result.operation_replayed,v_result.operation_revision;
end
$function$;

-- MFA boundary: bulk_delete_save_shared_checks_document_v6(text,bigint,jsonb,text,jsonb,jsonb)
CREATE OR REPLACE FUNCTION public.bulk_delete_save_shared_checks_document_v6(p_document_name text, p_expected_revision bigint, p_state jsonb, p_operation_id text, p_deleted_check_ids jsonb, p_audit jsonb)
 RETURNS TABLE(revision bigint, updated_at timestamp with time zone, state jsonb, operation_replayed boolean, operation_revision bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'netunim_internal'
AS $function$
declare v_owner uuid:=auth.uid();v_result record;
begin
  PERFORM netunim_internal.require_financial_mfa_v1();
  if v_owner is null then raise exception 'not_authenticated' using errcode='42501';end if;
  perform netunim_internal.enter_storage_writer_operation_v2('shared-checks-bulk-delete');
  perform set_config('app.destructive_operation_kind','bulk-delete',true);
  perform netunim_internal.capture_safety_snapshot(v_owner,'shared-checks',p_document_name,p_operation_id,'bulk-delete');
  select * into v_result from netunim_internal.save_shared_checks_document_current(p_document_name,p_expected_revision,p_state,p_operation_id,p_deleted_check_ids,coalesce(p_audit,'{}'::jsonb)||jsonb_build_object('mutationType','bulk-delete'));
  perform set_config('app.destructive_operation_kind','',true);
  perform netunim_internal.leave_storage_writer_operation_v2('shared-checks-bulk-delete');
  return query select v_result.revision,v_result.updated_at,v_result.state,v_result.operation_replayed,v_result.operation_revision;
end
$function$;

-- MFA boundary: claim_finance_sync_lease(text,text,integer)
CREATE OR REPLACE FUNCTION public.claim_finance_sync_lease(p_lease_name text, p_lease_token text, p_ttl_seconds integer DEFAULT 1200)
 RETURNS TABLE(acquired boolean, leased_until timestamp with time zone, lease_token text, fence_epoch bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_owner uuid:=auth.uid();v_now timestamptz:=clock_timestamp();
begin
  PERFORM netunim_internal.require_financial_mfa_v1();
 if v_owner is null then raise exception 'not_authenticated' using errcode='42501';end if;
 if p_lease_name not in ('bank','credit') or p_lease_name is null or coalesce(btrim(p_lease_token),'')='' or length(p_lease_token)>200 or p_ttl_seconds is null or p_ttl_seconds<60 or p_ttl_seconds>1800 then raise exception 'invalid_finance_sync_lease' using errcode='22023';end if;
 insert into public.finance_sync_leases as l(owner_id,lease_name,lease_token,leased_until,fence_epoch)
 values(v_owner,p_lease_name,p_lease_token,v_now+make_interval(secs=>p_ttl_seconds),1)
 on conflict(owner_id,lease_name) do update set lease_token=excluded.lease_token,
 leased_until=clock_timestamp()+make_interval(secs=>p_ttl_seconds),updated_at=clock_timestamp(),
 fence_epoch=case when l.lease_token=excluded.lease_token and l.leased_until>clock_timestamp() then l.fence_epoch else l.fence_epoch+1 end
 where l.leased_until<=clock_timestamp() or l.lease_token=excluded.lease_token
 returning true,l.leased_until,l.lease_token,l.fence_epoch into acquired,leased_until,lease_token,fence_epoch;
 if not found then select false,l.leased_until,l.lease_token,l.fence_epoch into acquired,leased_until,lease_token,fence_epoch from public.finance_sync_leases l where l.owner_id=v_owner and l.lease_name=p_lease_name;end if;
 return next;
end $function$;

-- MFA boundary: get_storage_protocol_state()
CREATE OR REPLACE FUNCTION public.get_storage_protocol_state()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'netunim_internal'
AS $function$
declare v_owner uuid:=auth.uid();v_result jsonb;
begin
  PERFORM netunim_internal.require_financial_mfa_v1();
  if v_owner is null then raise exception 'not_authenticated' using errcode='42501';end if;
  select jsonb_build_object(
    'orders',coalesce(max(p.min_writer_protocol) filter (where p.domain='orders'),1),
    'kupa',coalesce(max(p.min_writer_protocol) filter (where p.domain='kupa'),1),
    'sharedChecks',coalesce(max(p.min_writer_protocol) filter (where p.domain='shared-checks'),1))
  into v_result from netunim_internal.storage_writer_protocol p where p.owner_id=v_owner;
  return v_result;
end
$function$;

-- MFA boundary: list_active_sync_incidents_v1()
CREATE OR REPLACE FUNCTION public.list_active_sync_incidents_v1()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE v_owner uuid:=auth.uid();
BEGIN
  PERFORM netunim_internal.require_financial_mfa_v1();
  IF v_owner IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY first_reported_at,incident_id),'[]'::jsonb)
    FROM public.sync_incidents i WHERE owner_id=v_owner AND resolved_at IS NULL);
END $function$;

-- MFA boundary: mark_sync_incident_reviewed_v1(uuid,bigint)
CREATE OR REPLACE FUNCTION public.mark_sync_incident_reviewed_v1(p_incident_id uuid, p_expected_report_version bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE v_owner uuid:=auth.uid(); v_row public.sync_incidents;
BEGIN
  PERFORM netunim_internal.require_financial_mfa_v1();
  IF v_owner IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;
  UPDATE public.sync_incidents SET resolved_at=clock_timestamp(),resolution_kind='operator_reviewed_unverified'
    WHERE owner_id=v_owner AND incident_id=p_incident_id AND report_version=p_expected_report_version AND resolved_at IS NULL
    RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'sync_incident_changed_or_missing' USING ERRCODE='40001'; END IF;
  RETURN to_jsonb(v_row);
END $function$;

-- MFA boundary: merge_bank_transactions_v6(text,text,jsonb,text,text,bigint)
CREATE OR REPLACE FUNCTION public.merge_bank_transactions_v6(p_account_key text, p_account_role text, p_transactions jsonb, p_lease_name text DEFAULT NULL::text, p_lease_token text DEFAULT NULL::text, p_fence_epoch bigint DEFAULT NULL::bigint)
 RETURNS TABLE(inserted_count integer, updated_count integer, total_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'netunim_internal'
AS $function$
begin
  PERFORM netunim_internal.require_financial_mfa_v1();
  perform netunim_internal.assert_storage_writer_operation_fence_v2('bank-merge',p_lease_name,p_lease_token,p_fence_epoch);
  perform netunim_internal.assert_bank_transaction_evidence(p_transactions);
  perform netunim_internal.enter_storage_writer_operation_v2('bank-merge');
  return query select * from netunim_internal.fenced_impl_merge_bank_transactions(p_account_key,p_account_role,p_transactions);
  perform netunim_internal.leave_storage_writer_operation_v2('bank-merge');
end
$function$;

-- MFA boundary: refresh_check_bank_matches(bigint)
CREATE OR REPLACE FUNCTION public.refresh_check_bank_matches(p_expected_revision bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  PERFORM netunim_internal.require_financial_mfa_v1();
  if auth.uid() is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  if p_expected_revision is null or p_expected_revision<0 then raise exception 'invalid_expected_revision' using errcode='22023'; end if;
  return netunim_internal.refresh_check_bank_matches(auth.uid(),p_expected_revision);
end $function$;

-- MFA boundary: release_finance_sync_lease(text,text)
CREATE OR REPLACE FUNCTION public.release_finance_sync_lease(p_lease_name text, p_lease_token text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_owner uuid:=auth.uid();
  v_name text:=btrim(coalesce(p_lease_name,''));
  v_token text:=btrim(coalesce(p_lease_token,''));
  v_now timestamptz:=clock_timestamp();
  v_released boolean:=false;
begin
  PERFORM netunim_internal.require_financial_mfa_v1();
  if v_owner is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  if v_name not in ('bank','credit') then raise exception 'invalid_finance_sync_lease_name' using errcode='22023'; end if;
  if v_token='' or length(v_token)>200 then raise exception 'invalid_finance_sync_lease_token' using errcode='22023'; end if;

  update public.finance_sync_leases lease
  set leased_until=v_now,updated_at=v_now
  where lease.owner_id=v_owner and lease.lease_name=v_name and lease.lease_token=v_token
  returning true into v_released;
  return coalesce(v_released,false);
end $function$;

-- MFA boundary: report_sync_incident_v1(jsonb)
CREATE OR REPLACE FUNCTION public.report_sync_incident_v1(p_incident jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
SELECT netunim_internal.require_financial_mfa_v1();

  SELECT netunim_internal.write_sync_incident_v1(p_incident,false)
$function$;

-- MFA boundary: resolve_sync_incident_v1(jsonb)
CREATE OR REPLACE FUNCTION public.resolve_sync_incident_v1(p_incident jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
SELECT netunim_internal.require_financial_mfa_v1();

  SELECT netunim_internal.write_sync_incident_v1(p_incident,true)
$function$;

-- MFA boundary: restore_spreadsheet_document_v1(text,text,bigint,bigint,text)
CREATE OR REPLACE FUNCTION public.restore_spreadsheet_document_v1(p_domain text, p_document_name text, p_expected_revision bigint, p_backup_id bigint, p_operation_id text)
 RETURNS TABLE(revision bigint, state jsonb, updated_at timestamp with time zone, operation_replayed boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'netunim_internal'
AS $function$
declare v_owner uuid:=auth.uid();v_target jsonb;v_current jsonb;v_part text;v_ids jsonb;v_intents jsonb:='{}';v_prior bigint;v_result record;
begin
  PERFORM netunim_internal.require_financial_mfa_v1();
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

-- MFA boundary: save_bank_sync_snapshot_v6(text,jsonb,text,bigint,text,text,bigint)
CREATE OR REPLACE FUNCTION public.save_bank_sync_snapshot_v6(p_document_name text, p_bank_state jsonb, p_snapshot_token text, p_snapshot_seq bigint, p_lease_name text DEFAULT NULL::text, p_lease_token text DEFAULT NULL::text, p_fence_epoch bigint DEFAULT NULL::bigint)
 RETURNS TABLE(finance_revision bigint, kupa_revision bigint, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'netunim_internal'
AS $function$
begin
  PERFORM netunim_internal.require_financial_mfa_v1();
  perform netunim_internal.assert_storage_writer_operation_fence_v2('bank-balance-snapshot',p_lease_name,p_lease_token,p_fence_epoch);
  perform netunim_internal.enter_storage_writer_operation_v2('bank-balance-snapshot');
  return query select * from netunim_internal.fenced_impl_save_bank_sync_snapshot(
    p_document_name,p_bank_state,p_snapshot_token,p_snapshot_seq);
  perform netunim_internal.leave_storage_writer_operation_v2('bank-balance-snapshot');
end
$function$;

-- MFA boundary: save_finance_sync_document_v6(text,bigint,jsonb,text,jsonb,text,text,bigint)
CREATE OR REPLACE FUNCTION public.save_finance_sync_document_v6(p_document_name text, p_expected_revision bigint, p_state jsonb, p_operation_id text, p_audit jsonb, p_lease_name text DEFAULT NULL::text, p_lease_token text DEFAULT NULL::text, p_fence_epoch bigint DEFAULT NULL::bigint)
 RETURNS TABLE(revision bigint, updated_at timestamp with time zone, state jsonb, operation_replayed boolean, operation_revision bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'netunim_internal'
AS $function$
begin
  PERFORM netunim_internal.require_financial_mfa_v1();
  perform netunim_internal.assert_storage_writer_operation_fence_v2('finance-document-save',p_lease_name,p_lease_token,p_fence_epoch);
  perform netunim_internal.enter_storage_writer_operation_v2('finance-document-save');
  return query select * from netunim_internal.fenced_impl_save_finance_sync_document_v5(
    p_document_name,p_expected_revision,p_state,p_operation_id,p_audit);
  perform netunim_internal.leave_storage_writer_operation_v2('finance-document-save');
end
$function$;

-- MFA boundary: save_kupa_document_v6(text,bigint,jsonb,text,jsonb,jsonb)
CREATE OR REPLACE FUNCTION public.save_kupa_document_v6(p_document_name text, p_expected_revision bigint, p_state jsonb, p_operation_id text, p_delete_intents jsonb, p_audit jsonb)
 RETURNS TABLE(revision bigint, updated_at timestamp with time zone, state jsonb, operation_replayed boolean, operation_revision bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'netunim_internal'
AS $function$
begin
  PERFORM netunim_internal.require_financial_mfa_v1();
  perform netunim_internal.enter_storage_writer_operation_v2('kupa-save');
  return query select * from netunim_internal.save_kupa_document_current(p_document_name,p_expected_revision,p_state,p_operation_id,p_delete_intents,p_audit);
  perform netunim_internal.leave_storage_writer_operation_v2('kupa-save');
end
$function$;

-- MFA boundary: save_order_management_document_v6(text,bigint,jsonb,text,jsonb,jsonb)
CREATE OR REPLACE FUNCTION public.save_order_management_document_v6(p_document_name text, p_expected_revision bigint, p_state jsonb, p_operation_id text, p_delete_intents jsonb, p_audit jsonb)
 RETURNS TABLE(revision bigint, updated_at timestamp with time zone, state jsonb, operation_replayed boolean, operation_revision bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'netunim_internal'
AS $function$
begin
  PERFORM netunim_internal.require_financial_mfa_v1();
  perform netunim_internal.enter_storage_writer_operation_v2('orders-save');
  return query select * from netunim_internal.save_order_management_document_current(p_document_name,p_expected_revision,p_state,p_operation_id,p_delete_intents,p_audit);
  perform netunim_internal.leave_storage_writer_operation_v2('orders-save');
end
$function$;

-- MFA boundary: save_shared_checks_document_v6(text,bigint,jsonb,text,jsonb,jsonb)
CREATE OR REPLACE FUNCTION public.save_shared_checks_document_v6(p_document_name text, p_expected_revision bigint, p_state jsonb, p_operation_id text, p_deleted_check_ids jsonb, p_audit jsonb)
 RETURNS TABLE(revision bigint, updated_at timestamp with time zone, state jsonb, operation_replayed boolean, operation_revision bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'netunim_internal'
AS $function$
begin
  PERFORM netunim_internal.require_financial_mfa_v1();
  perform netunim_internal.enter_storage_writer_operation_v2('shared-checks-save');
  return query select * from netunim_internal.save_shared_checks_document_current(p_document_name,p_expected_revision,p_state,p_operation_id,p_deleted_check_ids,p_audit);
  perform netunim_internal.leave_storage_writer_operation_v2('shared-checks-save');
end
$function$;

-- MFA boundary: save_spreadsheet_document_v1(text,text,bigint,jsonb,text,jsonb,text)
CREATE OR REPLACE FUNCTION public.save_spreadsheet_document_v1(p_domain text, p_document_name text, p_expected_revision bigint, p_state jsonb, p_operation_id text, p_delete_intents jsonb DEFAULT '{}'::jsonb, p_kind text DEFAULT 'edit'::text)
 RETURNS TABLE(revision bigint, state jsonb, updated_at timestamp with time zone, operation_replayed boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'netunim_internal'
AS $function$
declare v_owner uuid:=auth.uid();v_doc public.spreadsheet_documents%rowtype;v_hash text;v_prior text;v_part text;v_removed jsonb;v_intents jsonb;v_actual jsonb:='{}';v_bucket timestamptz;
begin
  PERFORM netunim_internal.require_financial_mfa_v1();
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

-- MFA boundary: save_tax_calculator_document_v1(text,bigint,jsonb,text,bigint)
CREATE OR REPLACE FUNCTION public.save_tax_calculator_document_v1(p_document_name text, p_expected_revision bigint, p_state jsonb, p_operation_id text, p_restore_revision bigint DEFAULT NULL::bigint)
 RETURNS TABLE(owner_id uuid, document_name text, revision bigint, state jsonb, operation_id text, operation_replayed boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare uid uuid := auth.uid(); head public.tax_calculator_documents%rowtype; op public.tax_calculator_operations%rowtype; next_revision bigint;
begin
  PERFORM netunim_internal.require_financial_mfa_v1();
  if uid is null or auth.role() is distinct from 'authenticated' then raise exception 'authentication required' using errcode='42501'; end if;
  if p_operation_id is null or length(p_operation_id) not between 1 and 200 or p_expected_revision is null or p_expected_revision < 0 or p_expected_revision >= 9007199254740991
    or netunim_internal.validate_tax_document(p_document_name,p_state) is distinct from true then raise exception 'invalid calculator document' using errcode='22023'; end if;
  -- Serialize per owner, including operation IDs reused across different documents.
  perform pg_advisory_xact_lock(hashtextextended('tax-calculator/'||uid::text,0));
  select * into op from public.tax_calculator_operations t where t.owner_id=uid and t.operation_id=p_operation_id;
  if found then
    if op.document_name <> p_document_name or op.expected_revision <> p_expected_revision or op.submitted_state <> p_state or op.restore_revision is distinct from p_restore_revision then raise exception 'operation ID reused with different intent' using errcode='22023'; end if;
    return query select uid,p_document_name,op.acknowledged_revision,op.submitted_state,p_operation_id,true; return;
  end if;
  select * into head from public.tax_calculator_documents t where t.owner_id=uid and t.document_name=p_document_name for update;
  if coalesce(head.revision,0) <> p_expected_revision then raise exception 'calculator revision conflict' using errcode='40001'; end if;
  if p_document_name like 'rules/%' and head.revision is not null then raise exception 'rules versions are immutable' using errcode='22023'; end if;
  if p_restore_revision is not null and (p_document_name like 'rules/%' or not exists(select 1 from public.tax_calculator_history h where h.owner_id=uid and h.document_name=p_document_name and h.revision=p_restore_revision and h.state=p_state)) then raise exception 'restore snapshot does not match history' using errcode='22023'; end if;
  next_revision := p_expected_revision+1;
  insert into public.tax_calculator_documents as d(owner_id,document_name,revision,state) values(uid,p_document_name,next_revision,p_state)
    on conflict on constraint tax_calculator_documents_pkey do update set revision=excluded.revision,state=excluded.state,updated_at=now();
  insert into public.tax_calculator_history(owner_id,document_name,revision,state) values(uid,p_document_name,next_revision,p_state);
  insert into public.tax_calculator_operations(owner_id,operation_id,document_name,expected_revision,submitted_state,restore_revision,acknowledged_revision) values(uid,p_operation_id,p_document_name,p_expected_revision,p_state,p_restore_revision,next_revision);
  return query select uid,p_document_name,next_revision,p_state,p_operation_id,false;
end $function$;

-- MFA boundary: set_bank_transaction_handled(bigint,boolean)
CREATE OR REPLACE FUNCTION public.set_bank_transaction_handled(p_transaction_id bigint, p_handled boolean)
 RETURNS TABLE(transaction_id bigint, handled_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_owner uuid:=auth.uid();
begin
  PERFORM netunim_internal.require_financial_mfa_v1();
  if v_owner is null then
    raise exception 'not_authenticated' using errcode='42501';
  end if;
  if p_transaction_id is null or p_transaction_id<=0 then
    raise exception 'invalid_bank_transaction_id' using errcode='22023';
  end if;
  if p_handled is null then
    raise exception 'invalid_bank_transaction_handled_state' using errcode='22023';
  end if;

  update public.bank_transactions b
     set handled_at=case when p_handled then coalesce(b.handled_at,now()) else null end
   where b.id=p_transaction_id
     and b.owner_id=v_owner
     and b.account_role='business'
     and b.status='completed'
  returning b.id,b.handled_at into transaction_id,handled_at;

  if transaction_id is null then
    raise exception 'bank_transaction_not_found'
      using errcode='P0002',hint='The finalized business bank transaction does not exist or is not owned by this user.';
  end if;
  return next;
end $function$;

-- MFA boundary: stage_restore_group_v6(uuid,text,text,bigint,jsonb,jsonb,text,bigint,jsonb,jsonb,text,text,jsonb)
CREATE OR REPLACE FUNCTION public.stage_restore_group_v6(p_restore_group_id uuid, p_app_site text, p_main_document_name text, p_main_base_revision bigint, p_main_state jsonb, p_main_delete_intents jsonb, p_checks_document_name text, p_checks_base_revision bigint, p_checks_state jsonb, p_checks_delete_ids jsonb, p_main_operation_id text, p_checks_operation_id text, p_audit jsonb)
 RETURNS TABLE(restore_group_id uuid, phase text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'netunim_internal'
AS $function$
declare v_operation text;
begin
  PERFORM netunim_internal.require_financial_mfa_v1();
  if p_app_site not in ('orders','kupa') or p_app_site is null then
    raise exception 'invalid_restore_group' using errcode='22023';
  end if;
  v_operation:=case p_app_site when 'orders' then 'restore-orders-stage' else 'restore-kupa-stage' end;
  perform netunim_internal.enter_storage_writer_operation_v2(v_operation);
  return query select * from netunim_internal.stage_restore_group_current(
    p_restore_group_id,p_app_site,p_main_document_name,p_main_base_revision,
    p_main_state,p_main_delete_intents,p_checks_document_name,p_checks_base_revision,
    p_checks_state,p_checks_delete_ids,p_main_operation_id,p_checks_operation_id,p_audit);
  perform netunim_internal.leave_storage_writer_operation_v2(v_operation);
end
$function$;

-- MFA boundary: sync_bank_transactions_snapshot_v6(text,text,jsonb,timestamp with time zone,date,date,boolean,text,text,bigint)
CREATE OR REPLACE FUNCTION public.sync_bank_transactions_snapshot_v6(p_account_key text, p_account_role text, p_transactions jsonb, p_snapshot_at timestamp with time zone, p_coverage_from date, p_coverage_to date, p_complete boolean, p_lease_name text DEFAULT NULL::text, p_lease_token text DEFAULT NULL::text, p_fence_epoch bigint DEFAULT NULL::bigint)
 RETURNS TABLE(inserted_count integer, updated_count integer, total_count integer, missing_count integer, active_missing_count integer, snapshot_stored boolean, baseline_created boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'netunim_internal'
AS $function$
begin
  PERFORM netunim_internal.require_financial_mfa_v1();
  perform netunim_internal.assert_storage_writer_operation_fence_v2('bank-archive-snapshot',p_lease_name,p_lease_token,p_fence_epoch);
  if p_snapshot_at is null or not isfinite(p_snapshot_at)
    or p_snapshot_at > clock_timestamp() + interval '5 minutes' then
    raise exception 'invalid_bank_snapshot_time' using errcode='22023';
  end if;
  perform netunim_internal.assert_bank_transaction_evidence(p_transactions);
  perform netunim_internal.enter_storage_writer_operation_v2('bank-archive-snapshot');
  return query select * from netunim_internal.fenced_impl_sync_bank_transactions_snapshot(
    p_account_key,p_account_role,p_transactions,p_snapshot_at,p_coverage_from,p_coverage_to,p_complete);
  perform netunim_internal.leave_storage_writer_operation_v2('bank-archive-snapshot');
end
$function$;

-- Restrictive policies compose with existing owner policies. They never add a
-- permissive path, and server-only tables without browser grants stay untouched.
DO $policies$
DECLARE target record;
BEGIN
  FOR target IN
    SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind='r' AND c.relrowsecurity
      AND n.nspname IN ('public','netunim_internal','storage')
      AND (n.nspname<>'storage' OR c.relname='objects')
      AND has_table_privilege('authenticated',c.oid,'SELECT')
  LOOP
    EXECUTE format('CREATE POLICY financial_mfa_v1 ON %I.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT netunim_internal.require_financial_mfa_v1())) WITH CHECK ((SELECT netunim_internal.require_financial_mfa_v1()))',target.nspname,target.relname);
  END LOOP;
END $policies$;
COMMIT;
NOTIFY pgrst,'reload schema';
