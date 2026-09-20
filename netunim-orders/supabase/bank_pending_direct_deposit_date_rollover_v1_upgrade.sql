-- Preserve one archive identity when Hapoalim moves the SAME direct-cheque pending row
-- from its deposit/event day to its future business/value day. The temporary reference is the
-- printed cheque number for this exact presentation, while processed_date remains the value day.
-- Matching stays fail-closed: exact provisional reference + amount + processed/value day, the
-- strict pending-direct-deposit shape, source absence of the old representation, and uniqueness.
-- Also heals the single stale duplicate created before this rule existed. Completed-transition
-- behavior remains byte-for-byte equivalent to the prior migration outside these additions.

begin;

create or replace function netunim_internal.merge_bank_transactions(p_account_key text,p_account_role text,p_transactions jsonb)
returns table(inserted_count integer, updated_count integer, total_count integer)
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_owner uuid:=auth.uid();
  r jsonb;
  v_id bigint;
  v_inserted int:=0;
  v_updated int:=0;
  v_candidates int;
  v_candidate bigint;
  v_date timestamptz;
  v_processed timestamptz;
  v_amount numeric;
  v_serial text;
  v_reference text;
  v_description text;
  v_memo text;
  v_party_name text;
  v_party_norm text;
  v_detail_digits text;
  v_status text;
  v_balance numeric;
  v_activity integer;
  v_pending_id bigint;
  v_pending_in_source boolean;
  v_direct_pending_reference text;
  v_stale_pending_id bigint;
  v_stale_pending_candidates int;
begin
  if v_owner is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  -- Shared per-user financial writer gate: fail fast instead of filling the PostgREST pool.
  if not pg_try_advisory_xact_lock(
    hashtextextended('netunim_financial_write:' || v_owner::text, 0)
  ) then
    raise exception 'save_busy'
      using errcode = 'PT429',
            hint = 'Another financial save is already in progress. Retry later.';
  end if;
  perform set_config('lock_timeout', '100ms', true);
  if coalesce(btrim(p_account_key),'')='' or p_account_role not in ('business','home') or jsonb_typeof(p_transactions) is distinct from 'array' then raise exception 'invalid_bank_merge_input' using errcode='22023'; end if;

  -- A duplicate merge key means the client could not distinguish two source rows. Fail atomically
  -- instead of silently collapsing financial movements. Fallback rows receive occurrence suffixes.
  if exists (
    select 1
    from jsonb_array_elements(p_transactions) x(value)
    group by x.value->>'mergeKey'
    having coalesce(x.value->>'mergeKey','')='' or count(*)>1
  ) then
    raise exception 'bank_archive_ambiguous_source_identity'
      using errcode='22023', hint='The bank returned rows that cannot be given unique stable identities. No archive rows were changed.';
  end if;

  for r in select value from jsonb_array_elements(p_transactions) loop
    if nullif(r->>'amount','') is null then raise exception 'invalid_bank_transaction_amount' using errcode='22023'; end if;
    v_date:=nullif(r->>'date','')::timestamptz;
    v_processed:=nullif(r->>'processedDate','')::timestamptz;
    v_amount:=(r->>'amount')::numeric;
    v_serial:=coalesce(r->>'bankSerial','');
    v_reference:=coalesce(r->>'bankReference','');
    v_description:=coalesce(r->>'description','');
    v_memo:=coalesce(r->>'memo','');
    v_party_name:=coalesce(r->>'partyName','');
    v_party_norm:=lower(regexp_replace(btrim(v_party_name),'[[:space:]]+',' ','g'));
    v_detail_digits:=regexp_replace(coalesce(nullif(r->>'messageDetail',''),r->>'memo',''),'[^0-9]','','g');
    v_status:=case when r->>'status'='pending' then 'pending' else 'completed' end;
    v_balance:=nullif(r->>'balanceAfter','')::numeric;
    v_activity:=nullif(r->>'activityTypeCode','')::integer;
    -- Reuse the already-reviewed strict provisional-reference classifier instead of duplicating
    -- its Hapoalim-shape rules here. The JSON keys are mapped explicitly to the archive row type.
    v_direct_pending_reference:=netunim_internal.check_bank_pending_reference_number(jsonb_populate_record(
      null::public.bank_transactions,jsonb_build_object(
        'status',v_status,'amount',v_amount,'currency',coalesce(nullif(r->>'currency',''),'ILS'),
        'cheque',coalesce((r->>'cheque')::boolean,false),'activity_type_code',v_activity,
        'bank_serial',v_serial,'description',v_description,'check_details',r->'checkDetails',
        'bank_reference',v_reference)));
    v_id:=null;
    v_pending_id:=null;
    v_pending_in_source:=false;

    -- Hapoalim reference numbers are not globally unique. The bank serial is day-scoped and is
    -- the strongest stable identifier available for completed rows, so date is part of every match.
    if v_date is not null and v_serial not in ('','0') then
      select count(*),min(b.id) into v_candidates,v_candidate
      from public.bank_transactions b
      where b.owner_id=v_owner and b.account_key=p_account_key and b.account_role=p_account_role
        and b.transaction_date::date=v_date::date and b.bank_serial=v_serial and b.amount=v_amount;
      if v_candidates>1 then
        raise exception 'bank_archive_existing_identity_collision'
          using errcode='40001', hint='More than one archived row matches the same bank date/serial/amount identity. No merge was committed.';
      elsif v_candidates=1 then v_id:=v_candidate; end if;
    end if;
    if v_id is null and v_date is not null and v_reference<>'' then
      select count(*),min(b.id) into v_candidates,v_candidate
      from public.bank_transactions b
      where b.owner_id=v_owner and b.account_key=p_account_key and b.account_role=p_account_role
        and b.transaction_date::date=v_date::date and b.bank_reference=v_reference and b.amount=v_amount
        and b.description=v_description and b.memo=v_memo;
      if v_candidates>1 then
        raise exception 'bank_archive_existing_identity_collision'
          using errcode='40001', hint='More than one archived row matches the same bank date/reference/amount/content identity. No merge was committed.';
      elsif v_candidates=1 then v_id:=v_candidate; end if;
    end if;

    if v_id is null and coalesce(r->>'mergeKey','')<>'' then
      select count(*),min(b.id) into v_candidates,v_candidate
      from public.bank_transactions b
      where b.owner_id=v_owner and b.account_key=p_account_key and b.account_role=p_account_role and b.merge_key=r->>'mergeKey';
      if v_candidates>1 then
        raise exception 'bank_archive_existing_merge_key_collision'
          using errcode='40001', hint='More than one archived row has the same merge key. No merge was committed.';
      elsif v_candidates=1 then v_id:=v_candidate; end if;
    end if;

    -- Hapoalim can first expose a direct-cheque pending row on the physical deposit day and
    -- later move that SAME pending row to the future business/value day. mergeKey/date are then
    -- different, and the running balance can also move because the bank reorders pending rows.
    -- The processed/value day remains stable. Reuse the old archive id only for the exact strict
    -- provisional-reference shape, exact cheque reference + amount + value day, one candidate,
    -- and only when the old representation is absent from the current bank payload.
    if v_id is null and v_direct_pending_reference<>'' and v_processed is not null then
      select count(*),min(b.id) into v_candidates,v_candidate
      from public.bank_transactions b
      where b.owner_id=v_owner and b.account_key=p_account_key and b.account_role=p_account_role
        and b.status='pending' and b.amount=v_amount and b.currency='ILS'
        and netunim_internal.check_bank_pending_reference_number(b)=v_direct_pending_reference
        and b.processed_date is not null
        and (b.processed_date at time zone 'Asia/Jerusalem')::date=(v_processed at time zone 'Asia/Jerusalem')::date
        and not exists(select 1 from jsonb_array_elements(p_transactions) src(value)
          where src.value->>'mergeKey'=b.merge_key);
      if v_candidates=1 then v_id:=v_candidate; end if;
    end if;

    -- A Hapoalim pending row is a temporary state of the same movement. While pending, the bank
    -- commonly returns serial=0 and can later change both the activity label and beneficiary text.
    -- Reference/balance matches remain preferred. Instant credits (including Zahav-style credits)
    -- get one additional fail-closed identity: same amount, same/adjacent bank day, compatible
    -- activity direction, a long beneficiary-name phrase contained in the other state, and the
    -- same >=8-digit account suffix extracted from messageDetail (memo is only a fallback source).
    -- The candidate must still be UNIQUE; ambiguity deliberately leaves rows separate.
    if v_status='completed' and v_date is not null then
      select count(*),min(b.id) into v_candidates,v_candidate
      from public.bank_transactions b
      cross join lateral (
        select
          lower(regexp_replace(btrim(coalesce(b.party_name,'')),'[[:space:]]+',' ','g')) as pending_party_norm,
          regexp_replace(coalesce(nullif(b.message_detail,''),b.memo,''),'[^0-9]','','g') as pending_detail_digits
      ) hints
      where b.owner_id=v_owner and b.account_key=p_account_key and b.account_role=p_account_role
        and b.status='pending' and b.amount=v_amount
        and netunim_internal.check_bank_pending_compatible(b,r)
        and b.transaction_date between (v_date-interval '3 days') and (v_date+interval '3 days')
        and (
          netunim_internal.check_bank_pending_items_equal(b,r)
          or
          (v_reference not in ('','0') and b.bank_reference=v_reference
            and (v_activity is null or b.activity_type_code is null or b.activity_type_code=v_activity))
          or
          (v_balance is not null and v_activity is not null
            and b.balance_after is not distinct from v_balance
            and b.activity_type_code=v_activity
            and (
              b.description=v_description
              or (
                netunim_internal.check_bank_kind(b.description)='deposit'
                and netunim_internal.check_bank_kind(v_description)='deposit'
              )
            ))
          or
          (
            v_amount>0
            and (v_description ~ 'מיידי|זה.?ב' or coalesce(b.description,'') ~ 'מיידי|זה.?ב')
            and b.transaction_date between (v_date-interval '1 day') and (v_date+interval '1 day')
            and (v_activity is null or b.activity_type_code is null or b.activity_type_code=v_activity)
            and length(v_party_norm)>=8 and length(hints.pending_party_norm)>=8
            and array_length(regexp_split_to_array(v_party_norm,'[[:space:]]+'),1)>=2
            and array_length(regexp_split_to_array(hints.pending_party_norm,'[[:space:]]+'),1)>=2
            and (
              position(' '||v_party_norm||' ' in ' '||hints.pending_party_norm||' ')>0
              or position(' '||hints.pending_party_norm||' ' in ' '||v_party_norm||' ')>0
            )
            and length(v_detail_digits)>=8 and length(hints.pending_detail_digits)>=8
            and right(v_detail_digits,least(length(v_detail_digits),length(hints.pending_detail_digits)))
              =right(hints.pending_detail_digits,least(length(v_detail_digits),length(hints.pending_detail_digits)))
          )
        );
      if v_candidates=1 then
        v_pending_id:=v_candidate;

        -- Never delete a pending row that the current bank payload still exposes. The exact merge
        -- key is preferred, but connector upgrades are allowed to change derived client identities,
        -- so a conservative stable-facts fallback also counts as "still present".
        select exists(
          select 1
          from public.bank_transactions pb
          cross join lateral jsonb_array_elements(p_transactions) x(value)
          where pb.id=v_pending_id and x.value->>'status'='pending'
            and (
              x.value->>'mergeKey'=pb.merge_key
              or (
                nullif(x.value->>'amount','') is not null
                and (x.value->>'amount')::numeric=pb.amount
                and (
                  (coalesce(x.value->>'bankReference','') not in ('','0')
                    and x.value->>'bankReference'=pb.bank_reference)
                  or
                  (nullif(x.value->>'balanceAfter','') is not null
                    and nullif(x.value->>'activityTypeCode','') is not null
                    and (x.value->>'balanceAfter')::numeric is not distinct from pb.balance_after
                    and (x.value->>'activityTypeCode')::integer is not distinct from pb.activity_type_code)
                  or
                  (coalesce(x.value->>'description','')=pb.description
                    and nullif(x.value->>'date','') is not null
                    and (x.value->>'date')::timestamptz between (pb.transaction_date-interval '1 day') and (pb.transaction_date+interval '1 day'))
                )
              )
            )
        ) into v_pending_in_source;

        if not v_pending_in_source and v_id is null then
          v_id:=v_pending_id;
        end if;
      end if;
    end if;

    if v_id is null then
      insert into public.bank_transactions(owner_id,account_key,account_role,merge_key,transaction_date,processed_date,amount,currency,description,memo,party_name,party_headline,message_headline,message_detail,status,balance_after,bank_reference,bank_serial,activity_type_code,cheque,check_details,credit_settlement_details)
      values(v_owner,p_account_key,p_account_role,r->>'mergeKey',v_date,v_processed,v_amount,coalesce(nullif(r->>'currency',''),'ILS'),v_description,coalesce(r->>'memo',''),coalesce(r->>'partyName',''),coalesce(r->>'partyHeadline',''),coalesce(r->>'messageHeadline',''),coalesce(r->>'messageDetail',''),v_status,v_balance,v_reference,v_serial,v_activity,coalesce((r->>'cheque')::boolean,false),r->'checkDetails',r->'creditSettlementDetails');
      v_inserted:=v_inserted+1;
    else
      update public.bank_transactions b set
        merge_key=coalesce(nullif(r->>'mergeKey',''),b.merge_key),
        transaction_date=coalesce(v_date,b.transaction_date),
        processed_date=coalesce(v_processed,b.processed_date),
        currency=coalesce(nullif(r->>'currency',''),b.currency),
        description=coalesce(nullif(r->>'description',''),b.description),
        memo=coalesce(r->>'memo',b.memo),
        party_name=coalesce(r->>'partyName',b.party_name),
        party_headline=coalesce(r->>'partyHeadline',b.party_headline),
        message_headline=coalesce(r->>'messageHeadline',b.message_headline),
        message_detail=coalesce(r->>'messageDetail',b.message_detail),
        status=case when v_status='pending' and b.status='completed' then b.status else v_status end,
        balance_after=coalesce(v_balance,b.balance_after),
        bank_reference=coalesce(nullif(r->>'bankReference',''),b.bank_reference),
        bank_serial=coalesce(nullif(r->>'bankSerial',''),b.bank_serial),
        activity_type_code=coalesce(v_activity,b.activity_type_code),
        cheque=coalesce((r->>'cheque')::boolean,b.cheque),
        check_details=coalesce(r->'checkDetails',b.check_details),
        credit_settlement_details=coalesce(r->'creditSettlementDetails',b.credit_settlement_details),
        last_changed_at=now()
      where b.id=v_id and (
        b.merge_key is distinct from coalesce(nullif(r->>'mergeKey',''),b.merge_key)
        or b.transaction_date is distinct from coalesce(v_date,b.transaction_date)
        or b.processed_date is distinct from coalesce(v_processed,b.processed_date)
        or b.currency is distinct from coalesce(nullif(r->>'currency',''),b.currency)
        or b.description is distinct from coalesce(nullif(r->>'description',''),b.description)
        or b.memo is distinct from coalesce(r->>'memo',b.memo)
        or b.party_name is distinct from coalesce(r->>'partyName',b.party_name)
        or b.party_headline is distinct from coalesce(r->>'partyHeadline',b.party_headline)
        or b.message_headline is distinct from coalesce(r->>'messageHeadline',b.message_headline)
        or b.message_detail is distinct from coalesce(r->>'messageDetail',b.message_detail)
        or b.status is distinct from (case when v_status='pending' and b.status='completed' then b.status else v_status end)
        or b.balance_after is distinct from coalesce(v_balance,b.balance_after)
        or b.bank_reference is distinct from coalesce(nullif(r->>'bankReference',''),b.bank_reference)
        or b.bank_serial is distinct from coalesce(nullif(r->>'bankSerial',''),b.bank_serial)
        or b.activity_type_code is distinct from coalesce(v_activity,b.activity_type_code)
        or b.cheque is distinct from coalesce((r->>'cheque')::boolean,b.cheque)
        or b.check_details is distinct from coalesce(r->'checkDetails',b.check_details)
        or b.credit_settlement_details is distinct from coalesce(r->'creditSettlementDetails',b.credit_settlement_details)
      );
      if found then v_updated:=v_updated+1; end if;
    end if;

    -- Heal the pre-upgrade false-positive pair: the old deposit-day pending row may already be
    -- stored beside the current value-day pending row. Delete only ONE stale strict provisional
    -- representation with the same cheque reference + amount + processed/value day, and never a
    -- row whose mergeKey is still present in this payload. This preserves genuine simultaneous
    -- source rows and fails closed when historical evidence is ambiguous.
    if v_direct_pending_reference<>'' and v_processed is not null and v_id is not null then
      select count(*),min(b.id) into v_stale_pending_candidates,v_stale_pending_id
      from public.bank_transactions b
      where b.owner_id=v_owner and b.account_key=p_account_key and b.account_role=p_account_role
        and b.id<>v_id and b.status='pending' and b.amount=v_amount and b.currency='ILS'
        and netunim_internal.check_bank_pending_reference_number(b)=v_direct_pending_reference
        and b.processed_date is not null
        and (b.processed_date at time zone 'Asia/Jerusalem')::date=(v_processed at time zone 'Asia/Jerusalem')::date
        and not exists(select 1 from jsonb_array_elements(p_transactions) src(value)
          where src.value->>'mergeKey'=b.merge_key);
      if v_stale_pending_candidates=1 then
        perform netunim_internal.move_check_bank_claim(v_stale_pending_id,v_id);
        delete from public.bank_transactions b
        where b.id=v_stale_pending_id and b.owner_id=v_owner and b.account_key=p_account_key
          and b.account_role=p_account_role and b.status='pending'
          and netunim_internal.check_bank_pending_reference_number(b)=v_direct_pending_reference
          and b.amount=v_amount and b.processed_date is not null
          and (b.processed_date at time zone 'Asia/Jerusalem')::date=(v_processed at time zone 'Asia/Jerusalem')::date;
      end if;
    end if;

    -- Heal duplicates created by the previous logic: if this completed row already existed under
    -- its final serial identity, remove only the one uniquely matched stale pending placeholder.
    -- Security-definer ownership keeps DELETE capability inside this RPC; clients are not granted
    -- direct delete permission on the bank archive table.
    if v_status='completed' and v_pending_id is not null and v_pending_id<>v_id and not v_pending_in_source then
      perform netunim_internal.move_check_bank_claim(v_pending_id,v_id);
      delete from public.bank_transactions b
      where b.id=v_pending_id and b.owner_id=v_owner and b.account_key=p_account_key
        and b.account_role=p_account_role and b.status='pending';
    end if;
  end loop;
  -- Self-verify the statement before returning. If any source row failed to become the exact
  -- archived row for its merge key, raise and let PostgreSQL roll the whole RPC statement back.
  if exists (
    select 1
    from jsonb_array_elements(p_transactions) x(value)
    where not exists (
      select 1 from public.bank_transactions b
      where b.owner_id=v_owner and b.account_key=p_account_key and b.account_role=p_account_role
        and b.merge_key=x.value->>'mergeKey'
        and (nullif(x.value->>'date','') is null or b.transaction_date is not distinct from (x.value->>'date')::timestamptz)
        and (nullif(x.value->>'processedDate','') is null or b.processed_date is not distinct from (x.value->>'processedDate')::timestamptz)
        and b.amount=(x.value->>'amount')::numeric
        and b.description=coalesce(x.value->>'description','')
        and b.memo=coalesce(x.value->>'memo','')
        and (coalesce(x.value->>'bankReference','')='' or b.bank_reference=x.value->>'bankReference')
        and (coalesce(x.value->>'bankSerial','')='' or b.bank_serial=x.value->>'bankSerial')
        and (case when x.value->>'status'='pending' then b.status in ('pending','completed') else b.status='completed' end)
    )
  ) then
    raise exception 'bank_archive_merge_verification_failed'
      using errcode='40001', hint='The transaction merge did not reproduce every bank row exactly. The entire RPC was rolled back.';
  end if;

  select count(*)::int into total_count from public.bank_transactions b where b.owner_id=v_owner and b.account_key=p_account_key and b.account_role=p_account_role;
  inserted_count:=v_inserted; updated_count:=v_updated; return next;
end $$;

commit;
