begin;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $test$
declare lease record; stamp timestamptz; complete boolean; before_state jsonb; after_state jsonb;
  t1 timestamptz := clock_timestamp()-interval '2 minutes';
  t2 timestamptz := clock_timestamp()-interval '1 minute';
  tx jsonb := '[{"mergeKey":"temporal-original","date":"2026-10-16T10:00:00Z","amount":20,"currency":"ILS","status":"completed"}]';
  bad_tx jsonb := '[{"mergeKey":"temporal-injected","date":"2026-10-16T10:00:00Z","amount":99,"currency":"ILS","status":"completed"}]';
begin
  delete from public.finance_sync_leases where owner_id=auth.uid() and lease_name='bank';
  select * into lease from public.claim_finance_sync_lease('bank','temporal-test',60);
  perform public.sync_bank_transactions_snapshot_v6('temporal','business',tx,t1,'2026-10-01','2026-10-31',true,'bank','temporal-test',lease.fence_epoch);
  select jsonb_build_object(
    'archive',(select jsonb_agg(to_jsonb(b) order by b.id) from public.bank_transactions b where owner_id=auth.uid()),
    'snapshots',(select jsonb_agg(to_jsonb(s) order by s.account_key,s.account_role) from public.bank_transaction_snapshots s where owner_id=auth.uid()),
    'finance',(select jsonb_agg(to_jsonb(f)) from public.finance_sync_documents f where owner_id=auth.uid())) into before_state;
  foreach complete in array array[true,false] loop
    foreach stamp in array array[clock_timestamp()+interval '100 years',clock_timestamp()+interval '6 minutes','infinity'::timestamptz,'-infinity'::timestamptz,null::timestamptz] loop
      begin
        perform public.sync_bank_transactions_snapshot_v6('temporal','business',bad_tx,stamp,'2026-10-01','2026-10-31',complete,'bank','temporal-test',lease.fence_epoch);
        raise exception 'invalid_temporal_snapshot_accepted';
      exception when sqlstate '22023' then
        if sqlerrm<>'invalid_bank_snapshot_time' then raise; end if;
      end;
      select jsonb_build_object(
        'archive',(select jsonb_agg(to_jsonb(b) order by b.id) from public.bank_transactions b where owner_id=auth.uid()),
        'snapshots',(select jsonb_agg(to_jsonb(s) order by s.account_key,s.account_role) from public.bank_transaction_snapshots s where owner_id=auth.uid()),
        'finance',(select jsonb_agg(to_jsonb(f)) from public.finance_sync_documents f where owner_id=auth.uid())) into after_state;
      if before_state is distinct from after_state then raise exception 'rejected_temporal_snapshot_mutated_state'; end if;
    end loop;
  end loop;
  -- A valid subsequent observation still applies, including absence reconciliation.
  perform public.sync_bank_transactions_snapshot_v6('temporal','business','[]',t2,'2026-10-01','2026-10-31',true,'bank','temporal-test',lease.fence_epoch);
  if not exists(select 1 from public.bank_transaction_snapshots where owner_id=auth.uid() and account_key='temporal' and snapshot_at=t2)
    or not exists(select 1 from public.bank_transactions where owner_id=auth.uid() and account_key='temporal' and merge_key='temporal-original' and presence_state='missing' and missing_since=t2 and last_seen_at=t1) then
    raise exception 'valid_temporal_snapshot_did_not_recover';
  end if;
  -- Small clock drift is accepted. Authentication/fencing and stale checks remain intact.
  perform public.sync_bank_transactions_snapshot_v6('temporal','business','[]',clock_timestamp()+interval '4 minutes',null,null,false,'bank','temporal-test',lease.fence_epoch);
end
$test$;
rollback;
