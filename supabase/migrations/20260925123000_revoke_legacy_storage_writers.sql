-- Public compatibility writers are no longer a supported client protocol.
-- V6 uses the canonical internal implementations (migration 20260925120000).
-- Keep the old function bodies for a later dependency audit, but make them
-- unreachable to browser roles. The server-side minimum protocol fence stays.
begin;

do $revoke$
declare v_function regprocedure;
begin
  for v_function in
    select signature::regprocedure from (values
      ('public.save_order_management_document(text,bigint,jsonb)'),
      ('public.save_order_management_document_v3(text,bigint,jsonb,text)'),
      ('public.save_order_management_document_v4(text,bigint,jsonb,text,jsonb)'),
      ('public.save_order_management_document_v5(text,bigint,jsonb,text,jsonb,jsonb)'),
      ('public.bulk_delete_save_order_management_document_v5(text,bigint,jsonb,text,jsonb,jsonb)'),
      ('public.save_kupa_document(text,bigint,jsonb)'),
      ('public.save_kupa_document_v3(text,bigint,jsonb,text)'),
      ('public.save_kupa_document_v4(text,bigint,jsonb,text,jsonb)'),
      ('public.save_kupa_document_v5(text,bigint,jsonb,text,jsonb,jsonb)'),
      ('public.bulk_delete_save_kupa_document_v5(text,bigint,jsonb,text,jsonb,jsonb)'),
      ('public.save_shared_checks_document(text,bigint,jsonb)'),
      ('public.save_shared_checks_document_v3(text,bigint,jsonb,text)'),
      ('public.save_shared_checks_document_v4(text,bigint,jsonb,text,jsonb)'),
      ('public.save_shared_checks_document_v5(text,bigint,jsonb,text,jsonb,jsonb)'),
      ('public.bulk_delete_save_shared_checks_document_v5(text,bigint,jsonb,text,jsonb,jsonb)'),
      ('public.stage_restore_group_v5(uuid,text,text,bigint,jsonb,jsonb,text,bigint,jsonb,jsonb,text,text,jsonb)'),
      ('public.apply_restore_group_v5(uuid)'),
      ('public.save_finance_sync_document(text,bigint,jsonb)'),
      ('public.save_finance_sync_document_v3(text,bigint,jsonb,text)'),
      ('public.save_finance_sync_document_v5(text,bigint,jsonb,text,jsonb,text,text,bigint)'),
      ('public.merge_bank_transactions(text,text,jsonb,text,text,bigint)'),
      ('public.sync_bank_transactions_snapshot(text,text,jsonb,timestamptz,date,date,boolean,text,text,bigint)'),
      ('public.save_bank_sync_snapshot(text,jsonb,text,bigint,text,text,bigint)')
    ) as functions(signature)
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', v_function);
  end loop;
end
$revoke$;

-- SELECT remains available for cloud-authoritative adoption and diagnostics.
-- V6 SECURITY DEFINER RPCs retain their ability to write these tables.
revoke insert, update, delete, truncate on table
  public.order_management_documents,
  public.kupa_documents,
  public.shared_checks_documents,
  public.finance_sync_documents
from public, anon, authenticated;

commit;
