-- Hapoalim can replace one unitemized direct-deposit placeholder (reference 0)
-- with one machine deposit (reference -1) containing several cheques. The running
-- balance is order-dependent and is not an identity: the observed transition
-- changed it by ILS 40. Require a complete snapshot and a unique pair instead.
begin;

create or replace function netunim_internal.bank_aggregate_cheque_transition_matches(
  p_pending public.bank_transactions,p_completed jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog,public as $$
declare final_row public.bank_transactions; pack jsonb;
begin
  if not coalesce(
    p_pending.status='pending' and p_pending.amount>0 and p_pending.currency='ILS'
    and p_pending.cheque and p_pending.activity_type_code=1
    and p_pending.bank_serial in ('','0') and p_pending.bank_reference='0'
    and btrim(p_pending.description)='הפק שיק-ע.ישיר'
    and p_pending.check_details->>'kind'='deposit'
    and p_pending.check_details->'checkItems'='[]'::jsonb
    and p_pending.check_details->'checkNumbers'='[]'::jsonb
    and coalesce(p_pending.check_details->>'checkCount','')=''
    and coalesce(p_pending.check_details->>'warning','')=''
    and p_completed->>'status'='completed' and p_completed->>'currency'='ILS'
    and (p_completed->>'cheque')::boolean and (p_completed->>'activityTypeCode')::integer=1
    and p_completed->>'bankReference'='-1' and p_completed->>'bankSerial' ~ '^[1-9][0-9]*$'
    and btrim(p_completed->>'description')='הפק.שיק במכונה'
    and p_completed->'checkDetails'->>'kind'='deposit'
    and (p_completed->>'amount')::numeric=p_pending.amount
    and (p_pending.transaction_date at time zone 'Asia/Jerusalem')::date
      =((p_completed->>'date')::timestamptz at time zone 'Asia/Jerusalem')::date
    and (p_pending.processed_date at time zone 'Asia/Jerusalem')::date
      =((p_completed->>'processedDate')::timestamptz at time zone 'Asia/Jerusalem')::date,
    false) then return false; end if;
  final_row:=jsonb_populate_record(null::public.bank_transactions,
    jsonb_build_object('amount',p_completed->'amount','check_details',p_completed->'checkDetails'));
  pack:=netunim_internal.check_bank_items(final_row);
  return pack->>'kind'='valid' and jsonb_array_length(pack->'items')>=2
    and not exists(select 1 from jsonb_array_elements(pack->'items') i
      where i->>'checkNumber'='' or i->>'bankNumber'='' or i->>'branchNumber'='' or i->>'accountNumber'='');
end $$;
revoke all on function netunim_internal.bank_aggregate_cheque_transition_matches(public.bank_transactions,jsonb)
  from public,anon,authenticated;

-- Called only by the fenced snapshot writer, under its financial writer lock.
-- Inspect the entire source/archive before changing anything. In particular two
-- equal deposits, a still-visible placeholder or incomplete details never prove
-- a transition. Existing cheque claims must independently agree with the items.
create or replace function netunim_internal.reconcile_bank_aggregate_cheque_transition(
  p_account_key text,p_account_role text,p_transactions jsonb,p_coverage_from date,p_coverage_to date)
returns void language plpgsql set search_path=pg_catalog,public as $$
declare r jsonb; pending_row public.bank_transactions; candidates integer; candidate_id bigint;
  final_id bigint; final_count integer;
begin
  for r in select value from jsonb_array_elements(p_transactions)
    where value->>'status'='completed' and value->>'description'='הפק.שיק במכונה'
      and ((value->>'date')::timestamptz at time zone 'Asia/Jerusalem')::date
        between p_coverage_from and p_coverage_to
  loop
    -- Count all cheque placeholders with these financial facts, including ones
    -- whose reference/details contradict the strict aggregate presentation.
    select count(*),min(b.id) into candidates,candidate_id from public.bank_transactions b
    where b.owner_id=auth.uid() and b.account_key=p_account_key and b.account_role=p_account_role
      and b.status='pending' and b.currency=r->>'currency' and b.amount=(r->>'amount')::numeric
      and netunim_internal.check_bank_kind(b.description)='deposit'
      and (b.transaction_date at time zone 'Asia/Jerusalem')::date
        =((r->>'date')::timestamptz at time zone 'Asia/Jerusalem')::date
      and (b.processed_date at time zone 'Asia/Jerusalem')::date
        =((r->>'processedDate')::timestamptz at time zone 'Asia/Jerusalem')::date;
    if candidates<>1 then continue; end if;
    select * into pending_row from public.bank_transactions where id=candidate_id;
    if pending_row.presence_state not in ('present','missing') or pending_row.last_seen_at is null
      or not netunim_internal.bank_aggregate_cheque_transition_matches(pending_row,r) then continue; end if;

    -- Equal current deposits compete even when one has incomplete cheque data.
    select count(*) into candidates from jsonb_array_elements(p_transactions) src(value)
    where src.value->>'currency'=pending_row.currency and (src.value->>'amount')::numeric=pending_row.amount
      and netunim_internal.check_bank_kind(src.value->>'description')='deposit'
      and ((src.value->>'date')::timestamptz at time zone 'Asia/Jerusalem')::date
        =(pending_row.transaction_date at time zone 'Asia/Jerusalem')::date
      and ((src.value->>'processedDate')::timestamptz at time zone 'Asia/Jerusalem')::date
        =(pending_row.processed_date at time zone 'Asia/Jerusalem')::date;
    if candidates<>1 or exists(select 1 from jsonb_array_elements(p_transactions) src(value)
      where src.value->>'mergeKey'=pending_row.merge_key) then continue; end if;

    select count(*),min(b.id) into final_count,final_id from public.bank_transactions b
    where b.owner_id=auth.uid() and b.account_key=p_account_key and b.account_role=p_account_role
      and b.status='completed' and b.currency=pending_row.currency and b.amount=pending_row.amount
      and netunim_internal.check_bank_kind(b.description)='deposit'
      and (b.transaction_date at time zone 'Asia/Jerusalem')::date
        =(pending_row.transaction_date at time zone 'Asia/Jerusalem')::date
      and (b.processed_date at time zone 'Asia/Jerusalem')::date
        =(pending_row.processed_date at time zone 'Asia/Jerusalem')::date;
    if final_count>1 or (final_count=1 and not exists(select 1 from public.bank_transactions b
      where b.id=final_id and b.bank_serial=r->>'bankSerial' and b.bank_reference=r->>'bankReference'))
      then continue; end if;
    if exists(select 1 from netunim_internal.check_bank_claims l
      where l.owner_id=auth.uid() and l.transaction_id=pending_row.id)
      and (not netunim_internal.check_bank_pending_items_equal(pending_row,r)
        or exists(select 1 from netunim_internal.check_bank_claims l
          where l.owner_id=auth.uid() and l.transaction_id=final_id)) then continue; end if;
    -- Pending movements normally cannot have Morning links. Preserve any legacy
    -- linked record rather than orphaning user documents or handled state.
    if pending_row.handled_at is not null
      or exists(select 1 from public.bank_transaction_document_links l
        where l.owner_id=auth.uid() and l.transaction_id=pending_row.id)
      or exists(select 1 from public.morning_document_operations o
        where o.owner_id=auth.uid() and o.source_bank_transaction_id=pending_row.id) then continue; end if;

    if final_count=0 then
      -- The normal merge now enriches the original archive ID with every final
      -- bank field. This retains claims/history instead of inventing a new row.
      update public.bank_transactions set merge_key=r->>'mergeKey' where id=pending_row.id;
    else
      -- Heal a pair already persisted by an older version or a partial scan.
      perform netunim_internal.move_check_bank_claim(pending_row.id,final_id);
      delete from public.bank_transactions where id=pending_row.id;
    end if;
  end loop;
end $$;
revoke all on function netunim_internal.reconcile_bank_aggregate_cheque_transition(text,text,jsonb,date,date)
  from public,anon,authenticated;

CREATE OR REPLACE FUNCTION netunim_internal.fenced_impl_sync_bank_transactions_snapshot(p_account_key text, p_account_role text, p_transactions jsonb, p_snapshot_at timestamp with time zone, p_coverage_from date, p_coverage_to date, p_complete boolean)
 RETURNS TABLE(inserted_count integer, updated_count integer, total_count integer, missing_count integer, active_missing_count integer, snapshot_stored boolean, baseline_created boolean)
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_owner uuid:=auth.uid();
  v_inserted integer:=0;
  v_updated integer:=0;
  v_total integer:=0;
  v_previous_snapshot_at timestamptz;
  v_had_complete_snapshot boolean:=false;
begin
  if v_owner is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  if coalesce(btrim(p_account_key),'')='' or p_account_role not in ('business','home')
     or jsonb_typeof(p_transactions) is distinct from 'array'
     or p_snapshot_at is null then
    raise exception 'invalid_bank_snapshot_input' using errcode='22023';
  end if;
  if coalesce(p_complete,false) and (p_coverage_from is null or p_coverage_to is null or p_coverage_to<p_coverage_from) then
    raise exception 'invalid_bank_snapshot_coverage' using errcode='22023';
  end if;

  -- Acquire the same transaction lock before identity reconciliation. The merge
  -- retains this gate too; all changes roll back together on any validation,
  -- stale-snapshot, lease or source-identity failure.
  if not pg_try_advisory_xact_lock(hashtextextended('netunim_financial_write:'||v_owner::text,0)) then
    raise exception 'save_busy' using errcode='PT429',hint='Another financial save is already in progress. Retry later.';
  end if;
  perform set_config('lock_timeout','100ms',true);
  if coalesce(p_complete,false) then
    perform netunim_internal.reconcile_bank_aggregate_cheque_transition(
      p_account_key,p_account_role,p_transactions,p_coverage_from,p_coverage_to);
  end if;

  -- The public merge boundary owns the shared per-user advisory transaction lock both before and
  -- after core contention hardening. Transaction-scoped advisory locks remain held for this whole
  -- RPC, so merge + reconciliation + snapshot are atomic; any later exception rolls all of it back.
  select m.inserted_count,m.updated_count,m.total_count
    into v_inserted,v_updated,v_total
  from netunim_internal.fenced_impl_merge_bank_transactions(p_account_key,p_account_role,p_transactions) m;

  select s.snapshot_at into v_previous_snapshot_at
  from public.bank_transaction_snapshots s
  where s.owner_id=v_owner and s.account_key=p_account_key and s.account_role=p_account_role
  for update;
  v_had_complete_snapshot:=v_previous_snapshot_at is not null;

  -- A late client cannot mutate presence state after a newer proven-complete bank snapshot. This
  -- applies even to an incomplete read: a stale partial response must not resurrect a row that a
  -- newer complete snapshot already proved missing. Throwing rolls the merge back atomically too.
  if v_previous_snapshot_at is not null and p_snapshot_at<v_previous_snapshot_at then
    raise exception 'bank_snapshot_stale'
      using errcode='40001',hint='A newer complete bank snapshot is already stored. The stale snapshot was not applied.';
  end if;

  -- Rows actually returned by the bank are present. This is safe even for a partial read; absence
  -- is the only fact that is forbidden unless the connector proved the whole requested range.
  -- Reappearance also clears an old acknowledgement so a later disappearance becomes a new incident.
  update public.bank_transactions b set
    presence_state='present',
    last_seen_at=p_snapshot_at,
    missing_since=null,
    missing_acknowledged_at=null
  where b.owner_id=v_owner and b.account_key=p_account_key and b.account_role=p_account_role
    and exists (
      select 1 from jsonb_array_elements(p_transactions) x(value)
      where x.value->>'mergeKey'=b.merge_key
    )
    and (
      b.presence_state is distinct from 'present'
      or b.last_seen_at is distinct from p_snapshot_at
      or b.missing_since is not null
      or b.missing_acknowledged_at is not null
    );

  if coalesce(p_complete,false) then
    -- Pre-upgrade archive rows start UNKNOWN. The first complete snapshot is a baseline only: it
    -- cannot manufacture warnings for old history whose prior presence was never proven. Starting
    -- with the second complete snapshot, only previously PRESENT rows inside the connector-declared
    -- coverage window can transition to MISSING.
    if v_had_complete_snapshot then
      update public.bank_transactions b set
        presence_state='missing',
        missing_since=coalesce(b.missing_since,p_snapshot_at)
      where b.owner_id=v_owner and b.account_key=p_account_key and b.account_role=p_account_role
        and b.presence_state='present'
        and coalesce(b.transaction_date,b.processed_date)::date between p_coverage_from and p_coverage_to
        and (b.last_seen_at is null or b.last_seen_at<p_snapshot_at)
        and not exists (
          select 1 from jsonb_array_elements(p_transactions) x(value)
          where x.value->>'mergeKey'=b.merge_key
        );
    end if;

    insert into public.bank_transaction_snapshots(
      owner_id,account_key,account_role,snapshot_at,coverage_from,coverage_to,
      transaction_count,transactions,updated_at
    ) values (
      v_owner,p_account_key,p_account_role,p_snapshot_at,p_coverage_from,p_coverage_to,
      jsonb_array_length(p_transactions),p_transactions,now()
    )
    on conflict(owner_id,account_key,account_role) do update set
      snapshot_at=excluded.snapshot_at,
      coverage_from=excluded.coverage_from,
      coverage_to=excluded.coverage_to,
      transaction_count=excluded.transaction_count,
      transactions=excluded.transactions,
      updated_at=now()
    where public.bank_transaction_snapshots.snapshot_at<=excluded.snapshot_at;
  end if;

  select count(*)::integer into missing_count
  from public.bank_transactions b
  where b.owner_id=v_owner and b.account_key=p_account_key and b.account_role=p_account_role
    and b.presence_state='missing';

  select count(*)::integer into active_missing_count
  from public.bank_transactions b
  where b.owner_id=v_owner and b.account_key=p_account_key and b.account_role=p_account_role
    and b.presence_state='missing' and b.missing_acknowledged_at is null;

  inserted_count:=coalesce(v_inserted,0);
  updated_count:=coalesce(v_updated,0);
  total_count:=coalesce(v_total,0);
  snapshot_stored:=coalesce(p_complete,false);
  baseline_created:=coalesce(p_complete,false) and not v_had_complete_snapshot;
  return next;
end $function$;

commit;
