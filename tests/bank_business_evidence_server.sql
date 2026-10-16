-- Fixture JSON is inserted by the candidate harness; all data is synthetic.
begin;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $test$
declare lease record; fixture record; stored record; tx jsonb; batch jsonb; writer text; before_state jsonb; after_state jsonb; target_key text;
begin
  delete from public.finance_sync_leases where owner_id=auth.uid() and lease_name='bank';
  select * into lease from public.claim_finance_sync_lease('bank','business-evidence-test',60);
  tx := '{"date":"2026-10-16T10:00:00Z","amount":20,"currency":"ILS","status":"completed"}';
  for fixture in select value,ordinality from jsonb_array_elements('__BANK_BUSINESS_CASES__'::jsonb) with ordinality loop
    target_key := 'business-case-'||fixture.ordinality;
    batch := jsonb_build_array(tx||jsonb_build_object('mergeKey','prefix-'||fixture.ordinality),
      tx||(fixture.value->'patch')||jsonb_build_object('mergeKey',target_key));
    foreach writer in array array['merge','snapshot'] loop
      select jsonb_build_object(
        'archive',(select jsonb_agg(to_jsonb(b) order by b.id) from public.bank_transactions b where owner_id=auth.uid()),
        'snapshot',(select jsonb_agg(to_jsonb(b) order by b.account_key,b.account_role) from public.bank_transaction_snapshots b where owner_id=auth.uid()),
        'finance',(select jsonb_agg(to_jsonb(b)) from public.finance_sync_documents b where owner_id=auth.uid())) into before_state;
      begin
        if writer='merge' then
          perform public.merge_bank_transactions_v6('business-authority','business',batch,'bank','business-evidence-test',lease.fence_epoch);
        else
          perform public.sync_bank_transactions_snapshot_v6('business-authority','business',batch,
            now(),'2026-10-01','2026-10-16',true,'bank','business-evidence-test',lease.fence_epoch);
        end if;
        if not (fixture.value->>'valid')::boolean then raise exception 'malformed_business_evidence_was_accepted: % / %',fixture.value->>'name',writer; end if;
      exception when sqlstate '22023' then
        if (fixture.value->>'valid')::boolean or sqlerrm<>'invalid_bank_business_evidence' then raise; end if;
      end;
      if (fixture.value->>'valid')::boolean then
        select check_details,credit_settlement_details into strict stored from public.bank_transactions
          where owner_id=auth.uid() and account_key='business-authority' and account_role='business' and merge_key=target_key;
        if (fixture.value->'patch' ? 'checkDetails' and stored.check_details is distinct from fixture.value->'patch'->'checkDetails')
          or (fixture.value->'patch' ? 'creditSettlementDetails' and stored.credit_settlement_details is distinct from fixture.value->'patch'->'creditSettlementDetails') then
          raise exception 'valid_business_evidence_was_not_preserved';
        end if;
      end if;
      if not (fixture.value->>'valid')::boolean then
        select jsonb_build_object(
          'archive',(select jsonb_agg(to_jsonb(b) order by b.id) from public.bank_transactions b where owner_id=auth.uid()),
          'snapshot',(select jsonb_agg(to_jsonb(b) order by b.account_key,b.account_role) from public.bank_transaction_snapshots b where owner_id=auth.uid()),
          'finance',(select jsonb_agg(to_jsonb(b)) from public.finance_sync_documents b where owner_id=auth.uid())) into after_state;
        if before_state is distinct from after_state then raise exception 'rejected_business_batch_changed_financial_state'; end if;
      end if;
    end loop;
  end loop;
end
$test$;
rollback;
