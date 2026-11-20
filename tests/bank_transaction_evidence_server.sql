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

do $sender$
declare
  lease record;
  receipt record;
  account jsonb := '{"bankNumber":"9","branchNumber":"1","accountNumber":"000975318"}';
  tx jsonb := '{"mergeKey":"incoming-transfer","date":"2026-10-16T10:00:00Z","amount":50,"currency":"ILS","status":"completed"}';
  original_id bigint;
begin
  select * into lease from public.claim_finance_sync_lease('bank','bank-evidence-test',60);
  perform public.merge_bank_transactions_v6('sender-evidence','business',jsonb_build_array(tx),
    'bank','bank-evidence-test',lease.fence_epoch);
  select id into strict original_id from public.bank_transactions where owner_id=auth.uid() and account_key='sender-evidence';
  select * into receipt from public.sync_bank_transactions_snapshot_v6(
    'sender-evidence','business',jsonb_build_array(tx || jsonb_build_object('senderAccount',account)),
    now(),'2026-10-01','2026-10-16',true,'bank','bank-evidence-test',lease.fence_epoch);
  if receipt.updated_count<>1 or receipt.inserted_count<>0 or not receipt.snapshot_stored then
    raise exception 'sender_account_did_not_update_existing_transaction';
  end if;
  perform public.merge_bank_transactions_v6('sender-evidence','business',jsonb_build_array(tx || '{"senderAccount":null}'),
    'bank','bank-evidence-test',lease.fence_epoch);
  if (select sender_account from public.bank_transactions where id=original_id) is distinct from account then
    raise exception 'sender_account_not_retained';
  end if;
  if (select transactions->0->'senderAccount' from public.bank_transaction_snapshots
      where owner_id=auth.uid() and account_key='sender-evidence') is distinct from account then
    raise exception 'sender_account_not_in_direct_snapshot';
  end if;
  begin
    perform public.merge_bank_transactions_v6('sender-evidence','business',
      jsonb_build_array(tx || '{"senderAccount":{"bankNumber":"9","branchNumber":"0","accountNumber":"000975318"}}'),
      'bank','bank-evidence-test',lease.fence_epoch);
    raise exception 'invalid_sender_account_was_accepted';
  exception when check_violation then
    null;
  end;
end
$sender$;
rollback;
