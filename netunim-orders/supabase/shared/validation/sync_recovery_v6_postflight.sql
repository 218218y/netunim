-- Read-only deployment postflight. Run after v6 and before deploying either frontend.
do $postflight$
declare actual jsonb:=public.get_netunim_sync_capabilities();required jsonb:='{"documentOperationLedger":3,"syncIntegrity":5,"deleteIntents":4,"massDeleteGuard":5,"restoreGroups":5,"sharedChecksIntegrity":5,"financeFencing":1}';k text;v jsonb;
begin
 for k,v in select * from jsonb_each(required) loop
  if coalesce((actual->>k)::int,0)<(v::text)::int then raise exception 'netunim_sync_capabilities_missing: %',k;end if;
 end loop;
 if has_function_privilege('authenticated','public.save_finance_sync_document_v3(text,bigint,jsonb,text)','execute') then raise exception 'unfenced_finance_rpc_executable';end if;
 if has_table_privilege('authenticated','public.finance_sync_leases','UPDATE') then raise exception 'finance_fence_mutable_by_client';end if;
 if not has_function_privilege('authenticated','public.save_bank_sync_snapshot(text,jsonb,text,bigint,text,text,bigint)','execute') then raise exception 'fenced_bank_rpc_missing';end if;
end $postflight$;
