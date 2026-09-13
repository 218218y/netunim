-- Shared, owner-scoped cheque reconciliation. Runs only after a COMPLETE bank snapshot.
-- Workflow transitions use the existing revision/backups/financial-event writer.
begin;

create table netunim_internal.check_bank_claims (
  owner_id uuid not null references auth.users(id) on delete cascade,
  document_name text not null,
  transaction_id bigint not null,
  account_key text not null,
  account_role text not null,
  check_ids jsonb not null,
  members jsonb not null,
  source_transaction jsonb not null,
  previous_transaction_ids jsonb not null default '[]',
  conflicted boolean not null default false,
  created_at timestamptz not null default now(),
  primary key(owner_id,transaction_id)
);
revoke all on netunim_internal.check_bank_claims from public,anon,authenticated;

-- The archive merger already proves the pending -> completed identity. Reuse that
-- exact decision instead of independently guessing from the deposit amount.
create or replace function netunim_internal.move_check_bank_claim(p_old bigint,p_new bigint)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if exists(select 1 from netunim_internal.check_bank_claims where owner_id=auth.uid() and transaction_id=p_old) then
    if exists(select 1 from netunim_internal.check_bank_claims where owner_id=auth.uid() and transaction_id=p_new) then
      update netunim_internal.check_bank_claims set conflicted=true where owner_id=auth.uid() and transaction_id in (p_old,p_new);
    else
      update netunim_internal.check_bank_claims set transaction_id=p_new,previous_transaction_ids=previous_transaction_ids||jsonb_build_array(p_old::text)
      where owner_id=auth.uid() and transaction_id=p_old;
    end if;
  end if;
end $$;
-- Preserve the existing merger verbatim except for the claim transfer at its
-- already-proven pending-placeholder deletion. Existing ACL/signature stay intact.
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
        and b.transaction_date between (v_date-interval '3 days') and (v_date+interval '3 days')
        and (
          (v_reference not in ('','0') and b.bank_reference=v_reference
            and (v_activity is null or b.activity_type_code is null or b.activity_type_code=v_activity))
          or
          (v_balance is not null and v_activity is not null
            and b.balance_after is not distinct from v_balance
            and b.activity_type_code=v_activity
            and b.description=v_description)
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
      insert into public.bank_transactions(owner_id,account_key,account_role,merge_key,transaction_date,processed_date,amount,currency,description,memo,party_name,party_headline,message_headline,message_detail,status,balance_after,bank_reference,bank_serial,activity_type_code,cheque,check_details)
      values(v_owner,p_account_key,p_account_role,r->>'mergeKey',v_date,v_processed,v_amount,coalesce(nullif(r->>'currency',''),'ILS'),v_description,coalesce(r->>'memo',''),coalesce(r->>'partyName',''),coalesce(r->>'partyHeadline',''),coalesce(r->>'messageHeadline',''),coalesce(r->>'messageDetail',''),v_status,v_balance,v_reference,v_serial,v_activity,coalesce((r->>'cheque')::boolean,false),r->'checkDetails');
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
      );
      if found then v_updated:=v_updated+1; end if;
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

-- Preserve the existing internal-only boundary. CREATE OR REPLACE keeps owner/ACL, and these
-- statements fail closed if a previous installation accidentally exposed the helper.

-- Reviewed BOI cheque-clearing calendars, accessed 2026-09-13:
-- https://www.boi.org.il/media/qbcclufz/150726_ימי-פעילות-מסלקת-השיקים-2026.pdf
-- https://www.boi.org.il/media/awcntzfz/cheques-holidays-2027-heb.pdf
-- Deliberately also exclude Fridays and holiday eves (conservative product policy).
-- Unknown calendar years MUST NOT silently become ordinary working days.
create or replace function netunim_internal.check_bank_clear_after(p_day date)
returns date language sql immutable set search_path=pg_catalog as $$
  select case when extract(year from p_day) in (2026,2027) and extract(year from max(d)) in (2026,2027)
    then greatest(p_day+6,max(d)+1) end
  from (
    select p_day+i as d from generate_series(1,40) i
    where extract(dow from p_day+i) not in (5,6)
      and (p_day+i)::text <> all(array[
        '2026-03-03','2026-04-01','2026-04-02','2026-04-07','2026-04-08','2026-04-22',
        '2026-05-21','2026-05-22','2026-07-23','2026-09-11','2026-09-12','2026-09-13',
        '2026-09-20','2026-09-21','2026-09-25','2026-09-26','2026-10-02','2026-10-03','2026-10-27',
        '2027-03-23','2027-04-21','2027-04-22','2027-04-27','2027-04-28','2027-05-12',
        '2027-06-10','2027-06-11','2027-08-12','2027-10-01','2027-10-02','2027-10-03',
        '2027-10-10','2027-10-11','2027-10-15','2027-10-16','2027-10-22','2027-10-23'])
    order by i limit 3
  ) days;
$$;

create or replace function netunim_internal.check_bank_kind(p_description text)
returns text language sql immutable set search_path=pg_catalog as $$
  select case
    when btrim(p_description) ~* '^(החזרת[[:space:]]+(שיק|צ.?ק|המחא)|(שיק|צ.?ק|המחאה)[[:space:]]+(חזר|הוחזר)|return(ed)?[[:space:]]+(check|cheque))' then 'return'
    when btrim(p_description) ~* '^(הפק[.[:space:]]*(דת[[:space:]]*)?(שיק|צ.?ק|המחא)|הפקדת[[:space:]]+(שיק|צ.?ק|המחא)|cheque deposit|check deposit)'
      and p_description !~ 'עמל|ביטול|החזר' then 'deposit'
  end;
$$;

create or replace function netunim_internal.check_bank_date(p_value text)
returns date language plpgsql immutable strict set search_path=pg_catalog as $$
begin
  if p_value !~ '^\d{4}-\d{2}-\d{2}$' then return null; end if;
  return p_value::date;
exception when invalid_datetime_format or datetime_field_overflow then return null;
end $$;

-- At most 16 eligible checks => at most 65536 subsets, INCLUDING larger batches.
-- Never truncate a candidate list and then mistake its first solution for uniqueness.
create or replace function netunim_internal.check_bank_candidates(p_checks jsonb,p_tx public.bank_transactions)
returns jsonb language plpgsql stable set search_path=pg_catalog,public as $$
declare candidates jsonb; solutions jsonb; nums jsonb; txday text;
begin
  txday := (p_tx.transaction_date at time zone 'Asia/Jerusalem')::date::text;
  nums := p_tx.check_details->'checkNumbers';
  if jsonb_typeof(nums) is distinct from 'array' then nums := '[]'; end if;
  select coalesce(jsonb_agg(c order by c->>'id'),'[]') into candidates
  from jsonb_array_elements(p_checks) c
  where coalesce(c->>'account','עסקי')=case p_tx.account_role when 'home' then 'ביתי' else 'עסקי' end
    and c->>'status' in ('בקופה','הופקד - במעקב','נפרע')
    and coalesce(c->>'bankAutomationDisabled','false')<>'true'
    and (coalesce(c->'bankMatch'->>'phase','') in ('','ambiguous')
      or (c->>'status'='בקופה' and c->'bankMatch'->>'phase' in ('manual','returned'))
      or abs(netunim_internal.check_bank_date(c->'bankMatch'->>'date')-txday::date)<=7)
    and (c->>'status'<>'נפרע' or abs(coalesce(netunim_internal.check_bank_date(c->>'depositDate'),netunim_internal.check_bank_date(c->>'dueDate'))-txday::date)<=7)
    and netunim_internal.check_bank_date(c->>'dueDate') <= txday::date
    and (c->>'amount')::numeric>0 and (c->>'amount')::numeric<=p_tx.amount
    and (jsonb_array_length(nums)=0 or nums ? (c->>'checkNumber'));
  if jsonb_array_length(candidates)>16 then
    return jsonb_build_object('kind','limit','candidates',candidates);
  end if;
  with recursive items as (
    select c->>'id' id,(c->>'amount')::numeric amount,n::int n from jsonb_array_elements(candidates) with ordinality x(c,n)
  ), subsets(ids,total,last_n) as (
    select array[]::text[],0::numeric,0
    union all
    select s.ids||i.id,s.total+i.amount,i.n from subsets s join items i on i.n>s.last_n
    where s.total+i.amount<=p_tx.amount
  ), found as (
    select ids from subsets where total=p_tx.amount and cardinality(ids)>0
      and (jsonb_array_length(nums)=0 or cardinality(ids)=jsonb_array_length(nums))
      and (coalesce(p_tx.check_details->>'checkCount','') !~ '^[1-9][0-9]*$'
        or cardinality(ids)=(p_tx.check_details->>'checkCount')::numeric)
  )
  select jsonb_build_object('kind',case count(*) when 0 then 'none' when 1 then 'unique' else 'ambiguous' end,
    'ids',(select to_jsonb(f.ids) from found f order by f.ids limit 1),
    'candidates',coalesce((select jsonb_agg(c) from jsonb_array_elements(candidates) c
      where exists(select 1 from found f where c->>'id'=any(f.ids))),'[]')) into solutions from found;
  return solutions;
end $$;

-- Work from the immutable members of the ORIGINAL deposit, including deleted or
-- later-edited checks. A disappearing member must not change the subset arithmetic.
create or replace function netunim_internal.check_bank_remainder(p_claim netunim_internal.check_bank_claims,p_snapshot public.bank_transaction_snapshots)
returns jsonb language plpgsql stable set search_path=pg_catalog,public as $$
declare tx public.bank_transactions; candidate public.bank_transactions; original numeric; returned_total numeric:=0;
  source_day date; match jsonb; chosen jsonb; missing jsonb; n int:=0; other_claim record;
  return_ids jsonb:='[]'; returned_members jsonb:='[]'; contested boolean:=false; source_tx public.bank_transactions;
  other_checks jsonb;
begin
  original:=(p_claim.source_transaction->>'amount')::numeric;
  source_day:=((p_claim.source_transaction->>'transaction_date')::timestamptz at time zone 'Asia/Jerusalem')::date;
  select * into tx from public.bank_transactions where owner_id=p_claim.owner_id and id=p_claim.transaction_id;
  if found and tx.presence_state='present' and tx.last_seen_at=p_snapshot.snapshot_at then
    if tx.amount=original then
      source_tx:=tx;
      -- Banks also reduce a deposit by separate return debits instead of editing
      -- the credit. Attribute such debits only to a unique original deposit group.
      for candidate in select b.* from public.bank_transactions b where b.owner_id=p_claim.owner_id
        and b.account_key=p_claim.account_key and b.account_role=p_claim.account_role and b.amount<0 and -b.amount<=original
        and b.status='completed' and b.currency='ILS' and b.presence_state='present' and b.last_seen_at=p_snapshot.snapshot_at
        and netunim_internal.check_bank_kind(b.description)='return'
        and (b.transaction_date at time zone 'Asia/Jerusalem')::date between source_day and least(source_day+30,(p_snapshot.snapshot_at at time zone 'Asia/Jerusalem')::date)
      order by b.id
      loop
        candidate.amount:=-candidate.amount;
        match:=netunim_internal.check_bank_candidates(p_claim.members,candidate);
        if match->>'kind'='none' then continue; end if;
        -- Amounts alone cannot make repeated/ambiguous debits disjoint. Two
        -- returns of the same member must never implicate a different member
        -- whose amount happens to equal their sum.
        if match->>'kind'<>'unique' or exists(select 1 from jsonb_array_elements_text(match->'ids') id
          where returned_members ? id) then contested:=true; end if;
        returned_members:=returned_members||coalesce(match->'ids','[]'::jsonb);
        for other_claim in select l.* from netunim_internal.check_bank_claims l where l.owner_id=p_claim.owner_id
          and l.account_key=p_claim.account_key and l.account_role=p_claim.account_role and l.transaction_id<>p_claim.transaction_id
          and (candidate.transaction_date at time zone 'Asia/Jerusalem')::date between
            ((l.source_transaction->>'transaction_date')::timestamptz at time zone 'Asia/Jerusalem')::date and
            ((l.source_transaction->>'transaction_date')::timestamptz at time zone 'Asia/Jerusalem')::date+30
        loop
          if netunim_internal.check_bank_candidates(other_claim.members,candidate)->>'kind'<>'none' then contested:=true; end if;
        end loop;
        returned_total:=returned_total+candidate.amount;return_ids:=return_ids||jsonb_build_array(candidate.id);
      end loop;
      if returned_total=0 or returned_total>original or contested then
        return jsonb_build_object('kind','full','transactionId',tx.id,'originalAmount',original,'originalIds',p_claim.check_ids);
      end if;
      if returned_total=original then
        return jsonb_build_object('kind','reduced','transactionId',tx.id,'originalAmount',original,'observedAmount',0,
          'remainingIds','[]'::jsonb,'missingMembers',p_claim.members,'missingAmount',original,'evidence','return_debits','returnTransactionIds',return_ids);
      end if;
      tx.amount:=original-returned_total;tx.check_details:='{}';
      chosen:=jsonb_build_object('transactionId',source_tx.id,'observedAmount',tx.amount,'evidence','return_debits','returnTransactionIds',return_ids);
    else
    if tx.amount<=0 or tx.amount>original or tx.currency<>'ILS' or netunim_internal.check_bank_kind(tx.description) is distinct from 'deposit' then return null; end if;
    chosen:=jsonb_build_object('transactionId',tx.id,'observedAmount',tx.amount);
    end if;
  else
    -- The bank may replace the aggregate row when its amount changes. Require one
    -- unique same-day cheque credit, and check competing original batches as well.
    -- This is an inferred replacement, kept reviewable; it never proves a return.
    for candidate in select b.* from public.bank_transactions b where b.owner_id=p_claim.owner_id
      and b.account_key=p_claim.account_key and b.account_role=p_claim.account_role
      and b.presence_state='present' and b.last_seen_at=p_snapshot.snapshot_at
      and b.status in ('pending','completed') and b.currency='ILS' and b.amount>0 and b.amount<original
      and (b.transaction_date at time zone 'Asia/Jerusalem')::date=source_day
      and netunim_internal.check_bank_kind(b.description)='deposit'
      and not exists(select 1 from netunim_internal.check_bank_claims l where l.owner_id=b.owner_id
        and (l.transaction_id=b.id or l.previous_transaction_ids ? b.id::text))
    loop
      -- A changed nonempty bank reference is contradictory evidence, not a match.
      if coalesce(p_claim.source_transaction->>'bank_reference','') not in ('','0')
        and candidate.bank_reference not in ('','0') and candidate.bank_reference<>p_claim.source_transaction->>'bank_reference' then continue; end if;
      match:=netunim_internal.check_bank_candidates(p_claim.members,candidate);
      if match->>'kind'='none' then continue; end if;
      n:=n+1;tx:=candidate;chosen:=jsonb_build_object('transactionId',candidate.id,'observedAmount',candidate.amount);
      -- A same-day amount can also be a genuinely new deposit. In the absence of
      -- a shared stable reference/serial, any other admissible check explanation
      -- makes the inferred successor unsafe.
      if not ((candidate.bank_reference not in ('','0') and candidate.bank_reference=p_claim.source_transaction->>'bank_reference')
        or (candidate.bank_serial not in ('','0') and candidate.bank_serial=p_claim.source_transaction->>'bank_serial')) then
        select coalesce(jsonb_agg(member),'[]') into other_checks
          from public.shared_checks_documents d cross join lateral jsonb_array_elements(d.state->'checks') member
          where d.owner_id=p_claim.owner_id and d.document_name=p_claim.document_name and not (p_claim.check_ids ? (member->>'id'));
        if netunim_internal.check_bank_candidates(other_checks,candidate)->>'kind'<>'none' then n:=n+1; end if;
      end if;
      for other_claim in select l.* from netunim_internal.check_bank_claims l where l.owner_id=p_claim.owner_id
        and l.account_key=p_claim.account_key and l.account_role=p_claim.account_role and l.transaction_id<>p_claim.transaction_id
        and ((l.source_transaction->>'transaction_date')::timestamptz at time zone 'Asia/Jerusalem')::date=source_day
        and not exists(select 1 from public.bank_transactions b where b.owner_id=l.owner_id and b.id=l.transaction_id and b.presence_state='present')
      loop
        if netunim_internal.check_bank_candidates(other_claim.members,candidate)->>'kind'<>'none' then n:=n+1; end if;
      end loop;
    end loop;
    if n<>1 then return null; end if;
  end if;
  match:=netunim_internal.check_bank_candidates(p_claim.members,tx);
  if match->>'kind'<>'unique' then return chosen||jsonb_build_object('kind','ambiguous','originalAmount',original); end if;
  select coalesce(jsonb_agg(c),'[]') into missing from jsonb_array_elements(p_claim.members) c where not (match->'ids' ? (c->>'id'));
  return chosen||jsonb_build_object('kind','reduced','originalAmount',original,'remainingIds',match->'ids','missingMembers',missing,
    'missingAmount',original-tx.amount);
end $$;

-- A client may acknowledge an event or opt out. Bank evidence itself is server-owned.
-- Old clients which omit metadata cannot erase links or resurrect a rejected match.
create or replace function netunim_internal.protect_check_bank_metadata()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare c jsonb; oldc jsonb; rows jsonb:='[]';
begin
  if current_setting('app.check_bank_reconcile',true)='1' then return new; end if;
  for c in select value from jsonb_array_elements(new.state->'checks') loop
    select value into oldc from jsonb_array_elements(case when tg_op='UPDATE' then old.state->'checks' else '[]'::jsonb end) where value->>'id'=c->>'id';
    c:=c-'bankMatch';
    if oldc ? 'bankMatch' then
      c:=c||jsonb_build_object('bankMatch',oldc->'bankMatch');
      if (c->>'status',c->>'amount',c->>'dueDate',coalesce(c->>'account','עסקי'),c->>'checkNumber')
        is distinct from (oldc->>'status',oldc->>'amount',oldc->>'dueDate',coalesce(oldc->>'account','עסקי'),oldc->>'checkNumber') then
        c:=c||jsonb_build_object('bankAutomationDisabled',true,'bankMatch',(oldc->'bankMatch')||'{"phase":"manual"}'::jsonb);
      end if;
    end if;
    if not c ? 'bankAutomationDisabled' and oldc ? 'bankAutomationDisabled' then
      c:=c||jsonb_build_object('bankAutomationDisabled',oldc->'bankAutomationDisabled');
    end if;
    if not c ? 'bankReview' and oldc ? 'bankReview' then c:=c||jsonb_build_object('bankReview',oldc->'bankReview'); end if;
    if c->>'bankAutomationDisabled'='true' and c ? 'bankMatch' then
      c:=jsonb_set(c,'{bankMatch}',(c->'bankMatch')||'{"phase":"manual"}'::jsonb);
    end if;
    if oldc->>'bankAutomationDisabled'='true' and c->>'bankAutomationDisabled'='false'
      and c->>'status'='הופקד - במעקב' and c->'bankMatch'->>'phase'='manual' then
      c:=jsonb_set(c,'{bankMatch}',(c->'bankMatch')||jsonb_build_object('phase','deposited','eventId',(c->'bankMatch'->>'transactionId')||':resume:'||clock_timestamp()::text));
    end if;
    rows:=rows||jsonb_build_array(c);
  end loop;
  new.state:=jsonb_set(new.state,'{checks}',rows);
  return new;
end $$;
create trigger shared_checks_bank_metadata before insert or update on public.shared_checks_documents
for each row execute function netunim_internal.protect_check_bank_metadata();

create or replace function netunim_internal.reconcile_check_bank_snapshot()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare doc record; tx public.bank_transactions; ret public.bank_transactions; c jsonb; m jsonb;
  rows jsonb; nextrows jsonb; proposals jsonb:='[]'; proposal jsonb; match jsonb; ids jsonb;
  phase text; event text; txday date; clearafter date; returncount int; overlapcount int; claim netunim_internal.check_bank_claims;
  batches jsonb:='{}'; remainder jsonb; members jsonb; reduced_survivor boolean;
begin
  -- The existing archive RPC supplies authenticated identity and complete, fenced snapshots.
  if auth.uid() is null or new.owner_id<>auth.uid() then return new; end if;
  if tg_op='UPDATE' and new.snapshot_at<=old.snapshot_at then return new; end if;
  if new.snapshot_at>clock_timestamp()+interval '5 minutes' then return new; end if;
  select * into doc from public.shared_checks_documents d where d.owner_id=new.owner_id and d.document_name='main' for update;
  if not found then return new; end if;
  rows:=doc.state->'checks';

  -- Reserve reduced successors BEFORE proposing fresh deposits, so a replacement
  -- cannot consume unrelated open checks and leave its original group stranded.
  for claim in select l.* from netunim_internal.check_bank_claims l where l.owner_id=new.owner_id
    and l.account_key=new.account_key and l.account_role=new.account_role and not l.conflicted
  loop
    remainder:=netunim_internal.check_bank_remainder(claim,new);
    if remainder->>'kind'='reduced' and (remainder->>'transactionId')::bigint<>claim.transaction_id then
      perform netunim_internal.move_check_bank_claim(claim.transaction_id,(remainder->>'transactionId')::bigint);
    end if;
    if remainder is not null then
      batches:=batches||jsonb_build_object(claim.transaction_id::text,remainder,(remainder->>'transactionId'),remainder);
    end if;
  end loop;

  -- Proposals are built against the SAME original check list before accepting any of them.
  for tx in select b.* from public.bank_transactions b
    where b.owner_id=new.owner_id and b.account_key=new.account_key and b.account_role=new.account_role
      and b.amount>0 and b.currency='ILS' and b.status in ('pending','completed')
      and b.presence_state='present' and b.last_seen_at=new.snapshot_at
      and (b.transaction_date at time zone 'Asia/Jerusalem')::date between new.coverage_from and least(new.coverage_to,(new.snapshot_at at time zone 'Asia/Jerusalem')::date)
      and b.transaction_date>=new.snapshot_at-interval '30 days'
      and netunim_internal.check_bank_kind(b.description)='deposit'
      and not exists(select 1 from netunim_internal.check_bank_claims l where l.owner_id=b.owner_id and l.transaction_id=b.id)
    order by b.id
  loop
    match:=netunim_internal.check_bank_candidates(rows,tx);
    if match->>'kind'<>'none' then proposals:=proposals||jsonb_build_array(match||jsonb_build_object('transactionId',tx.id)); end if;
  end loop;
  for proposal in select value from jsonb_array_elements(proposals) loop
    select * into tx from public.bank_transactions where id=(proposal->>'transactionId')::bigint;
    ids:=proposal->'ids';
    -- Every alternative (including an ambiguous/over-limit deposit) blocks shared candidates.
    select count(*) into overlapcount from jsonb_array_elements(proposals) p
    where p->>'transactionId'<>proposal->>'transactionId'
      and exists(select 1 from jsonb_array_elements(p->'candidates') x where ids ? (x->>'id'));
    phase:=case when proposal->>'kind'='unique' and overlapcount=0 then 'deposited' else 'ambiguous' end;
    if phase='deposited' and exists(select 1 from jsonb_array_elements(rows) x where ids ? (x->>'id')
      and (x->>'status'='נפרע' or x->'bankMatch'->>'phase' in ('deposited','cleared','missing'))) then phase:='ambiguous'; end if;
    if phase='deposited' then
      select jsonb_agg(jsonb_build_object('id',member->>'id','name',member->>'name','amount',member->'amount','dueDate',member->>'dueDate',
        'account',coalesce(member->>'account','עסקי'),'status','בקופה','checkNumber',member->>'checkNumber')) into members
      from jsonb_array_elements(rows) member where ids ? (member->>'id');
      insert into netunim_internal.check_bank_claims(owner_id,document_name,transaction_id,account_key,account_role,check_ids,members,source_transaction)
      values(new.owner_id,'main',tx.id,new.account_key,new.account_role,ids,members,to_jsonb(tx));
    else
      select jsonb_agg(x->>'id') into ids from jsonb_array_elements(proposal->'candidates') x;
    end if;
    nextrows:='[]';
    for c in select value from jsonb_array_elements(rows) loop
      if ids ? (c->>'id') and c->>'status' in ('בקופה','הופקד - במעקב')
        and coalesce(c->'bankMatch'->>'phase','') not in ('deposited','cleared','missing') then
        event:=tx.id::text||':'||phase||case when phase='ambiguous' then ':'||md5(ids::text) else '' end;
        m:=jsonb_build_object('transactionId',tx.id,'accountKey',tx.account_key,'accountRole',tx.account_role,'phase',phase,'eventId',event,
          'description',tx.description,'amount',tx.amount,'date',(tx.transaction_date at time zone 'Asia/Jerusalem')::date,
          'detectedAt',case when c->'bankMatch'->>'eventId'=event then c->'bankMatch'->'detectedAt' else to_jsonb(new.snapshot_at) end,
          'completedSeenDate',case when tx.status='completed' and phase='deposited' then (new.snapshot_at at time zone 'Asia/Jerusalem')::date end,
          'checkIds',ids,'previousStatus',c->>'status','previousDepositDate',c->'depositDate');
        c:=c||jsonb_build_object('bankMatch',m);
        if phase='deposited' then c:=c||jsonb_build_object('status','הופקד - במעקב','depositDate',m->>'date','clearedDate',null); end if;
      end if;
      nextrows:=nextrows||jsonb_build_array(c);
    end loop;
    rows:=nextrows;
  end loop;

  -- Linked checks keep their claim even after rejection, deletion or manual correction.
  nextrows:='[]';
  for c in select value from jsonb_array_elements(rows) loop
    m:=c->'bankMatch'; phase:=m->>'phase';
    remainder:=batches->(m->>'transactionId');reduced_survivor:=false;
    if phase in ('deposited','cleared','missing') and coalesce(c->>'bankAutomationDisabled','false')<>'true'
      and m->>'accountKey'=new.account_key
      and coalesce(c->>'account','עסקי')=(case new.account_role when 'home' then 'ביתי' else 'עסקי' end) then
      select * into claim from netunim_internal.check_bank_claims where owner_id=new.owner_id
        and (transaction_id=(m->>'transactionId')::bigint or previous_transaction_ids ? (m->>'transactionId'));
      select * into tx from public.bank_transactions where owner_id=new.owner_id and id=coalesce(claim.transaction_id,(m->>'transactionId')::bigint) and account_role=new.account_role;
      if found then
        m:=m||jsonb_build_object('transactionId',tx.id);
        if remainder is null and m ? 'remainder' then
          m:=m-'remainder';
          if m->>'warning' in ('batch_missing','batch_ambiguous') then m:=m-'warning'; end if;
        end if;
        if remainder->>'kind'='full' and m ? 'remainder' then
          m:=(m-'remainder')||jsonb_build_object('amount',remainder->'originalAmount','checkIds',remainder->'originalIds');
        end if;
        if remainder->>'kind'='reduced' then
          reduced_survivor:=remainder->'remainingIds' ? (c->>'id');
          m:=m||jsonb_build_object('remainder',remainder);
          if reduced_survivor then
            -- Verify future amount/number/count against the surviving subset, while
            -- immutable original membership stays available in the claim forever.
            m:=m||jsonb_build_object('amount',tx.amount,'checkIds',remainder->'remainingIds');
          end if;
        end if;
        txday:=greatest((tx.transaction_date at time zone 'Asia/Jerusalem')::date,(tx.processed_date at time zone 'Asia/Jerusalem')::date);
        -- Amount-only returns are alerts and block clearing, but do not prove WHICH cheque returned.
        returncount:=0;
        for ret in select r.* from public.bank_transactions r where r.owner_id=new.owner_id
          and r.account_key=new.account_key and r.account_role=new.account_role and r.amount<0
          and r.currency='ILS' and r.presence_state<>'missing'
          and netunim_internal.check_bank_kind(r.description)='return'
          and (r.transaction_date at time zone 'Asia/Jerusalem')::date>=txday
          and (r.transaction_date at time zone 'Asia/Jerusalem')::date<=txday+30
          and (r.transaction_date at time zone 'Asia/Jerusalem')::date<=(new.snapshot_at at time zone 'Asia/Jerusalem')::date
        loop
          ret.amount:=-ret.amount;
          if netunim_internal.check_bank_candidates(claim.members,ret)->>'kind'<>'none' then
            returncount:=returncount+1;
          end if;
        end loop;
        if reduced_survivor and remainder->>'evidence'='return_debits' then returncount:=0; end if;
        select r.* into ret from public.bank_transactions r where r.owner_id=new.owner_id
          and r.account_key=new.account_key and r.account_role=new.account_role and r.amount=-(c->>'amount')::numeric
          and r.status='completed' and r.currency='ILS' and r.presence_state='present'
          and netunim_internal.check_bank_kind(r.description)='return'
          and (r.transaction_date at time zone 'Asia/Jerusalem')::date>=txday
          and (r.transaction_date at time zone 'Asia/Jerusalem')::date<=(new.snapshot_at at time zone 'Asia/Jerusalem')::date
          and nullif(c->>'checkNumber','') is not null and r.check_details->'checkNumbers' ? (c->>'checkNumber')
          and (select count(*) from jsonb_array_elements(rows) x where x->>'checkNumber'=c->>'checkNumber' and x->>'account'=c->>'account')=1
          order by r.id limit 1;
        if claim.conflicted then
          phase:='missing';m:=m||jsonb_build_object('warning','identity_conflict');
          c:=c||jsonb_build_object('status','הופקד - במעקב','clearedDate',null);
        elsif found then
          phase:='returned'; c:=c||jsonb_build_object('status','חזר','clearedDate',null);
          m:=(m-'warning')||jsonb_build_object('returnTransactionId',ret.id,'reason',concat_ws(' · ',nullif(ret.message_headline,''),nullif(ret.message_detail,''),ret.description));
        elsif remainder->>'kind'='reduced' and not reduced_survivor then
          phase:='missing';m:=m||jsonb_build_object('warning','batch_missing');
          c:=c||jsonb_build_object('status','הופקד - במעקב','clearedDate',null);
        elsif remainder->>'kind'='ambiguous' then
          phase:='missing';m:=m||jsonb_build_object('warning','batch_ambiguous','remainder',remainder);
          c:=c||jsonb_build_object('status','הופקד - במעקב','clearedDate',null);
        elsif reduced_survivor and c->'bankMatch'->'remainder' is distinct from remainder then
          phase:='deposited';m:=(m-'warning')||jsonb_build_object('completedSeenDate',case when tx.status='completed' then (new.snapshot_at at time zone 'Asia/Jerusalem')::date end);
          c:=c||jsonb_build_object('status','הופקד - במעקב','clearedDate',null);
        elsif tx.presence_state='missing' then
          phase:='missing';
          -- A removed credit revokes an automatic cleared state; never assert a return without evidence.
          if c->>'status'='נפרע' then c:=c||jsonb_build_object('status','הופקד - במעקב','clearedDate',null); end if;
        elsif returncount>0 then
          m:=m||jsonb_build_object('warning','possible_return');
          if c->>'status'='נפרע' then phase:='deposited';c:=c||jsonb_build_object('status','הופקד - במעקב','clearedDate',null); end if;
        elsif tx.amount<>(m->>'amount')::numeric or tx.currency<>'ILS' or tx.status not in ('pending','completed')
          or netunim_internal.check_bank_kind(tx.description) is distinct from 'deposit'
          or (jsonb_typeof(tx.check_details->'checkNumbers')='array' and tx.check_details->'checkNumbers'<>'[]'::jsonb
            and not (tx.check_details->'checkNumbers' ? coalesce(c->>'checkNumber','')))
          or (coalesce(remainder->>'evidence','')<>'return_debits' and coalesce(tx.check_details->>'checkCount','') ~ '^[1-9][0-9]*$'
            and (tx.check_details->>'checkCount')::numeric<>jsonb_array_length(m->'checkIds')) then
          phase:='missing';m:=m||jsonb_build_object('warning','changed');
          c:=c||jsonb_build_object('status','הופקד - במעקב','clearedDate',null);
        elsif phase='missing' and tx.presence_state='present' and tx.last_seen_at=new.snapshot_at then
          phase:='deposited';m:=m-'warning';
        elsif tx.status='completed' and tx.presence_state='present' and tx.last_seen_at=new.snapshot_at then
          if m->>'completedSeenDate' is null then m:=m||jsonb_build_object('completedSeenDate',(new.snapshot_at at time zone 'Asia/Jerusalem')::date); end if;
          clearafter:=netunim_internal.check_bank_clear_after(greatest(txday,(m->>'completedSeenDate')::date));
          m:=m||jsonb_build_object('clearAfter',clearafter);
          if clearafter is null then m:=m||jsonb_build_object('warning','calendar');
          elsif m->>'warning' in ('calendar','possible_return') then m:=m-'warning'; end if;
          if clearafter is not null and (new.snapshot_at at time zone 'Asia/Jerusalem')::date>=clearafter
            and new.coverage_from<=txday and new.coverage_to>=(new.snapshot_at at time zone 'Asia/Jerusalem')::date
            and c->>'bankReview'=m->>'eventId' and not (c->'bankMatch' ? 'warning')
            and phase='deposited' then
            phase:='cleared';c:=c||jsonb_build_object('status','נפרע','clearedDate',(new.snapshot_at at time zone 'Asia/Jerusalem')::date);
          end if;
        end if;
        event:=m->>'eventId';
        if phase is distinct from c->'bankMatch'->>'phase' or m->>'warning' is distinct from c->'bankMatch'->>'warning'
          or m->'remainder' is distinct from c->'bankMatch'->'remainder' then
          event:=tx.id::text||':'||phase||':'||new.snapshot_at::text;
        end if;
        c:=c||jsonb_build_object('bankMatch',m||jsonb_build_object('phase',phase,'eventId',event));
      else
        c:=c||jsonb_build_object('status','הופקד - במעקב','clearedDate',null,'bankMatch',m||jsonb_build_object('phase','missing','eventId',(m->>'transactionId')||':missing'));
      end if;
    end if;
    nextrows:=nextrows||jsonb_build_array(c);
  end loop;
  if nextrows is distinct from doc.state->'checks' then
    perform set_config('app.check_bank_reconcile','1',true);
    perform netunim_internal.save_shared_checks_document('main',doc.revision,jsonb_build_object('checks',nextrows));
    perform set_config('app.check_bank_reconcile','0',true);
  end if;
  return new;
end $$;
create trigger bank_snapshot_check_reconcile after insert or update on public.bank_transaction_snapshots
for each row execute function netunim_internal.reconcile_check_bank_snapshot();

revoke all on function netunim_internal.check_bank_clear_after(date),netunim_internal.check_bank_kind(text),
  netunim_internal.move_check_bank_claim(bigint,bigint),
  netunim_internal.check_bank_date(text),
  netunim_internal.check_bank_remainder(netunim_internal.check_bank_claims,public.bank_transaction_snapshots),
  netunim_internal.check_bank_candidates(jsonb,public.bank_transactions),netunim_internal.protect_check_bank_metadata(),
  netunim_internal.reconcile_check_bank_snapshot() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
