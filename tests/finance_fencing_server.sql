-- Run against an isolated fixture DB, before and after the migration (red / green).
begin;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $test$
declare a record;b record;r record;before_finance jsonb;before_kupa jsonb;before_tx jsonb;before_rows jsonb;kind text;
begin
  perform public.save_kupa_document_v5('main',0,'{"version":5,"businessName":"fixture","credits":[],"cash":[],"rights":[],"notes":[],"expenses":[],"cards":[],"notesSheet":{"rows":[],"columns":[]},"bank":{"adjustments":[]}}','fixture-kupa','{}','{}');
  foreach kind in array array['bank','credit'] loop
    delete from public.finance_sync_leases where owner_id=auth.uid() and lease_name=kind;
    select * into a from public.claim_finance_sync_lease(kind,'A',60);
    update public.finance_sync_leases set fence_epoch=100 where owner_id=auth.uid() and lease_name=kind;
    select * into a from public.claim_finance_sync_lease(kind,'A',60);
    if a.fence_epoch<>100 then raise exception 'renewal_changed_fence';end if;
    update public.finance_sync_leases set leased_until=clock_timestamp()-interval '1 second' where owner_id=auth.uid() and lease_name=kind;
    -- Expiry alone invalidates the holder, even before any takeover.
    execute 'set local role authenticated';
    begin
      if kind='bank' then perform public.save_bank_sync_snapshot('main','{}','expired',0,kind,'A',100);
      else perform public.save_finance_sync_document_v5('main',0,'{}','expired','{}',kind,'A',100);end if;
      raise exception 'expired_holder_wrote';
    exception when sqlstate 'PT409' then if sqlerrm<>'stale_finance_sync_fence' then raise;end if;end;
    execute 'reset role';
    select * into b from public.claim_finance_sync_lease(kind,'B',60);
    if b.fence_epoch<>101 then raise exception 'takeover_not_monotonic';end if;
    execute 'set local role authenticated';
    if kind='bank' then
      perform public.save_bank_sync_snapshot('main','{"currentBalance":200,"source":"hapoalim"}', 'B-snapshot',0,kind,'B',101);
      perform public.sync_bank_transactions_snapshot('test','business','[]',clock_timestamp(),null,null,false,kind,'B',101);
    else
      select revision into r from public.finance_sync_documents where owner_id=auth.uid() and document_name='main';
      perform public.save_finance_sync_document_v5('main',r.revision,'{"creditSync":{"syncedAt":"B"}}','B-credit','{}',kind,'B',101);
    end if;
    select to_jsonb(d) into before_finance from public.finance_sync_documents d where owner_id=auth.uid() and document_name='main';
    select to_jsonb(d) into before_kupa from public.kupa_documents d where owner_id=auth.uid() and document_name='main';
    select jsonb_agg(to_jsonb(d)) into before_rows from public.bank_transactions d where owner_id=auth.uid();
    select jsonb_agg(to_jsonb(d)) into before_tx from public.bank_transaction_snapshots d where owner_id=auth.uid();
    begin
      if kind='bank' then perform public.save_bank_sync_snapshot('main','{"currentBalance":100}','A-snapshot',0,kind,'A',100);
      else perform public.save_finance_sync_document_v5('main',(before_finance->>'revision')::bigint,'{"creditSync":{"syncedAt":"A"}}','A-credit','{}',kind,'A',100);end if;
      raise exception 'stale_holder_wrote';
    exception when sqlstate 'PT409' then if sqlerrm<>'stale_finance_sync_fence' then raise;end if;end;
    -- A valid token with the wrong epoch must also fail (not only the old token).
    begin
      if kind='bank' then perform public.save_bank_sync_snapshot('main','{}','wrong-epoch',0,kind,'B',100);
      else perform public.save_finance_sync_document_v5('main',0,'{}','wrong-epoch','{}',kind,'B',100);end if;
      raise exception 'wrong_epoch_wrote';
    exception when sqlstate 'PT409' then if sqlerrm<>'stale_finance_sync_fence' then raise;end if;end;
    if kind='bank' then
      begin perform public.merge_bank_transactions('test','business','[]',kind,'A',100);raise exception 'stale_merge_wrote';
      exception when sqlstate 'PT409' then if sqlerrm<>'stale_finance_sync_fence' then raise;end if;end;
      begin perform public.sync_bank_transactions_snapshot('test','business','[]',clock_timestamp(),null,null,false,kind,'A',100);raise exception 'stale_archive_wrote';
      exception when sqlstate 'PT409' then if sqlerrm<>'stale_finance_sync_fence' then raise;end if;end;
    end if;
    if before_finance is distinct from (select to_jsonb(d) from public.finance_sync_documents d where owner_id=auth.uid() and document_name='main') then raise exception 'finance_changed';end if;
    if before_kupa is distinct from (select to_jsonb(d) from public.kupa_documents d where owner_id=auth.uid() and document_name='main') then raise exception 'kupa_changed';end if;
    if before_tx is distinct from (select jsonb_agg(to_jsonb(d)) from public.bank_transaction_snapshots d where owner_id=auth.uid()) then raise exception 'archive_changed';end if;
    if before_rows is distinct from (select jsonb_agg(to_jsonb(d)) from public.bank_transactions d where owner_id=auth.uid()) then raise exception 'transactions_changed';end if;
    execute 'reset role';
  end loop;
end $test$;
rollback;
