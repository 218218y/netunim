-- Run only in the disposable candidate database after the full migration chain.
begin;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $test$
declare lease record; tx jsonb; bad jsonb; batch jsonb; before_rows jsonb; before_snapshot jsonb; writer text;
begin
  delete from public.finance_sync_leases where owner_id=auth.uid() and lease_name='bank';
  select * into lease from public.claim_finance_sync_lease('bank','bank-evidence-test',60);
  tx := '{"mergeKey":"status-authority","date":"2026-10-16T10:00:00Z","amount":25,"currency":"ILS","status":"completed"}';
  perform public.sync_bank_transactions_snapshot_v6('status-authority','business',jsonb_build_array(tx),
    now(),'2026-10-01','2026-10-16',true,'bank','bank-evidence-test',lease.fence_epoch);
  select jsonb_agg(to_jsonb(b) order by b.id) into before_rows from public.bank_transactions b where owner_id=auth.uid();
  select jsonb_agg(to_jsonb(b)) into before_snapshot from public.bank_transaction_snapshots b where owner_id=auth.uid();
  for bad in select value from jsonb_array_elements('[null,true,false,1,"garbage","PENDING",{},[]]') loop
    foreach writer in array array['merge','snapshot'] loop
      batch := jsonb_build_array(tx || '{"mergeKey":"would-insert"}', tx || jsonb_build_object('status',bad));
      begin
        if writer='merge' then
          perform public.merge_bank_transactions_v6('status-authority','business',batch,'bank','bank-evidence-test',lease.fence_epoch);
        else
          perform public.sync_bank_transactions_snapshot_v6('status-authority','business',batch,
            now(),'2026-10-01','2026-10-16',true,'bank','bank-evidence-test',lease.fence_epoch);
        end if;
        raise exception 'malformed_status_was_accepted';
      exception when sqlstate '22023' then
        if sqlerrm<>'invalid_bank_transaction_status' then raise; end if;
      end;
    end loop;
  end loop;
  begin
    perform public.merge_bank_transactions_v6('status-authority','business',jsonb_build_array(tx-'status'),
      'bank','bank-evidence-test',lease.fence_epoch);
    raise exception 'missing_status_was_accepted';
  exception when sqlstate '22023' then
    if sqlerrm<>'invalid_bank_transaction_status' then raise; end if;
  end;
  if before_rows is distinct from (select jsonb_agg(to_jsonb(b) order by b.id) from public.bank_transactions b where owner_id=auth.uid())
    or before_snapshot is distinct from (select jsonb_agg(to_jsonb(b)) from public.bank_transaction_snapshots b where owner_id=auth.uid()) then
    raise exception 'rejected_batch_changed_financial_state';
  end if;
end
$test$;
rollback;
