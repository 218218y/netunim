-- Structured cheque evidence, reviewed against the 2026-09-14 bank diagnostic.
-- This migration supersedes reconciliation functions, never rewrites applied SQL.
begin;
alter table netunim_internal.check_bank_claims add column bank_members jsonb;

create or replace function netunim_internal.check_bank_number(p_value text)
returns text language sql immutable set search_path=pg_catalog as $$
  select case when btrim(coalesce(p_value,'')) ~ '^[0-9]+$'
    then coalesce(nullif(ltrim(btrim(p_value),'0'),''),'') else btrim(coalesce(p_value,'')) end;
$$;

create or replace function netunim_internal.check_bank_money(p_value text)
returns numeric language sql immutable set search_path=pg_catalog as $$
  select case when p_value ~ '^[0-9]{1,15}([.][0-9]{1,2})?$' then p_value::numeric end;
$$;

create or replace function netunim_internal.check_bank_kind(p_description text)
returns text language sql immutable set search_path=pg_catalog as $$
  select case
    when btrim(p_description) ~ '^הצ[[:space:]]+שיק[[:space:]]+חוזר[-[:space:]]*נט$' then 'redeposit'
    when btrim(p_description) ~* '^(החזרת[[:space:]]+(שיק|צ.?ק|המחא)|(שיק|צ.?ק|המחאה)[[:space:]]+(חזר|הוחזר)|return(ed)?[[:space:]]+(check|cheque))' then 'return'
    when btrim(p_description) ~* '^(הפק[.[:space:]]*(דת[[:space:]]*)?(שיק|צ.?ק|המחא)|הפקדת[[:space:]]+(שיק|צ.?ק|המחא)|cheque deposit|check deposit)'
      and p_description !~ 'עמל|ביטול|החזר' then 'deposit' end;
$$;

-- Validate the whole bank table before trusting any of its rows. A partial,
-- conflicting or malformed table must not fall back to a coincidental total.
create or replace function netunim_internal.check_bank_items(p_tx public.bank_transactions)
returns jsonb language plpgsql immutable set search_path=pg_catalog,public as $$
declare raw jsonb:=p_tx.check_details->'checkItems'; items jsonb; declared_count numeric;
begin
  if raw is null or raw='[]'::jsonb then return '{"kind":"none","items":[]}'::jsonb; end if;
  if jsonb_typeof(raw)<>'array' then return '{"kind":"invalid","items":[]}'::jsonb; end if;
  if jsonb_array_length(raw)>50 or exists(select 1 from jsonb_array_elements(raw) x where jsonb_typeof(x)<>'object'
    or coalesce(netunim_internal.check_bank_money(x->>'amount'),0)<=0) then return '{"kind":"invalid","items":[]}'::jsonb; end if;
  select jsonb_agg(jsonb_build_object('checkNumber',netunim_internal.check_bank_number(x->>'checkNumber'),
    'bankNumber',netunim_internal.check_bank_number(x->>'bankNumber'),'branchNumber',netunim_internal.check_bank_number(x->>'branchNumber'),
    'accountNumber',netunim_internal.check_bank_number(x->>'accountNumber'),'amount',netunim_internal.check_bank_money(x->>'amount')) order by ord)
    into items from jsonb_array_elements(raw) with ordinality a(x,ord);
  declared_count:=netunim_internal.check_bank_money(p_tx.check_details->>'checkCount');
  if (declared_count is not null and declared_count<>jsonb_array_length(items))
    or (select sum((x->>'amount')::numeric) from jsonb_array_elements(items) x)<>abs(p_tx.amount)
    or exists(select 1 from jsonb_array_elements(items) x group by x having count(*)>1)
    or exists(select 1 from jsonb_array_elements(items) x where x->>'checkNumber'='' and (x->>'bankNumber'='' or x->>'branchNumber'='' or x->>'accountNumber'=''))
    or coalesce(p_tx.check_details->>'warning','')<>'' then return jsonb_build_object('kind','invalid','items',items); end if;
  if jsonb_typeof(p_tx.check_details->'checkNumbers')='array' and exists(
    select 1 from jsonb_array_elements_text(p_tx.check_details->'checkNumbers') n where netunim_internal.check_bank_number(n)<>''
      and not exists(select 1 from jsonb_array_elements(items) x where x->>'checkNumber'=netunim_internal.check_bank_number(n)))
    then return jsonb_build_object('kind','invalid','items',items); end if;
  return jsonb_build_object('kind','valid','items',items);
end $$;

create or replace function netunim_internal.check_bank_item_matches(p_check jsonb,p_item jsonb)
returns boolean language sql immutable set search_path=pg_catalog as $$
  select coalesce(netunim_internal.check_bank_money(p_check->>'amount')=netunim_internal.check_bank_money(p_item->>'amount')
    and (netunim_internal.check_bank_number(p_check->>'checkNumber')='' or netunim_internal.check_bank_number(p_item->>'checkNumber')=''
      or netunim_internal.check_bank_number(p_check->>'checkNumber')=netunim_internal.check_bank_number(p_item->>'checkNumber'))
    and not exists(select 1 from unnest(array['bankNumber','branchNumber','accountNumber']) k
      where netunim_internal.check_bank_number(p_check->>k)<>'' and netunim_internal.check_bank_number(p_item->>k)<>''
      and netunim_internal.check_bank_number(p_check->>k)<>netunim_internal.check_bank_number(p_item->>k)),false);
$$;

create or replace function netunim_internal.check_bank_same_item(a jsonb,b jsonb)
returns boolean language sql immutable set search_path=pg_catalog as $$
  select netunim_internal.check_bank_number(a->>'checkNumber')<>'' and netunim_internal.check_bank_number(b->>'checkNumber')<>''
    and netunim_internal.check_bank_item_matches(a,b);
$$;

-- Three ADDITIONAL banking days; next midnight avoids guessing bank cutoff hours.
-- Fridays and ordinary holiday eves are banking days. No fixed six-day minimum.
-- BOI 154.pdf and published cheque calendars 2026/2027, reviewed 2026-09-14.
create or replace function netunim_internal.check_bank_clear_after(p_day date)
returns date language sql immutable set search_path=pg_catalog as $$
  select case when extract(year from p_day) in (2026,2027) and extract(year from max(d)) in (2026,2027) then max(d)+1 end
  from (select p_day+i d from generate_series(1,40) i where extract(dow from p_day+i)<>6
    and (p_day+i)::text<>all(array[
      '2026-03-03','2026-04-02','2026-04-08','2026-04-22','2026-05-22','2026-07-23',
      '2026-09-12','2026-09-13','2026-09-20','2026-09-21','2026-09-26','2026-10-03','2026-10-27',
      '2027-03-23','2027-04-22','2027-04-28','2027-05-12','2027-06-11','2027-08-12',
      '2027-10-02','2027-10-03','2027-10-10','2027-10-11','2027-10-16','2027-10-23']) order by i limit 3) days;
$$;

create or replace function netunim_internal.check_bank_candidates(p_checks jsonb,p_tx public.bank_transactions)
returns jsonb language plpgsql stable set search_path=pg_catalog,public as $$
declare eligible jsonb; candidates jsonb; solutions jsonb; nums jsonb; txday date; pack jsonb; exact_ids jsonb;
begin
  txday:=(p_tx.transaction_date at time zone 'Asia/Jerusalem')::date;
  pack:=netunim_internal.check_bank_items(p_tx);
  nums:=case when jsonb_typeof(p_tx.check_details->'checkNumbers')='array' then p_tx.check_details->'checkNumbers' else '[]'::jsonb end;
  select coalesce(jsonb_agg(c order by c->>'id'),'[]') into eligible from jsonb_array_elements(p_checks) c
    where coalesce(c->>'account','עסקי')=case p_tx.account_role when 'home' then 'ביתי' else 'עסקי' end
      and (c->>'status' in ('בקופה','הופקד - במעקב','נפרע') or (c->>'status'='חזר' and netunim_internal.check_bank_kind(p_tx.description)='redeposit'))
      and coalesce(c->>'bankAutomationDisabled','false')<>'true'
      and (coalesce(c->'bankMatch'->>'phase','') in ('','ambiguous','overdue','unverified')
        or (c->>'status'='בקופה' and c->'bankMatch'->>'phase' in ('manual','returned'))
        or (c->>'status'='חזר' and netunim_internal.check_bank_kind(p_tx.description)='redeposit')
        or abs(netunim_internal.check_bank_date(c->'bankMatch'->>'date')-txday)<=7)
      and (c->>'status'<>'נפרע' or abs(coalesce(netunim_internal.check_bank_date(c->>'depositDate'),netunim_internal.check_bank_date(c->>'dueDate'))-txday)<=7)
      and netunim_internal.check_bank_date(c->>'dueDate')<=txday
      and coalesce(netunim_internal.check_bank_money(c->>'amount'),0)>0;
  if pack->>'kind'='invalid' then
    select coalesce(jsonb_agg(c),'[]') into candidates from jsonb_array_elements(eligible) c
      where (c->>'amount')::numeric<=abs(p_tx.amount);
    return jsonb_build_object('kind','ambiguous','ids','[]'::jsonb,'candidates',candidates,'warning','invalid_items');
  end if;
  -- A supplied check number wins over unnumbered same-amount records. A known
  -- number with a different amount is contradictory evidence, never fallback.
  select coalesce(jsonb_agg(c->>'id'),'[]') into exact_ids from jsonb_array_elements(eligible) c
    where exists(select 1 from jsonb_array_elements_text(nums) n where netunim_internal.check_bank_number(n)<>''
      and netunim_internal.check_bank_number(c->>'checkNumber')=netunim_internal.check_bank_number(n))
      and (pack->>'kind'<>'valid' or exists(select 1 from jsonb_array_elements(pack->'items') i
        where i->>'checkNumber'=netunim_internal.check_bank_number(c->>'checkNumber')
          and not exists(select 1 from unnest(array['bankNumber','branchNumber','accountNumber']) k
            where netunim_internal.check_bank_number(c->>k)<>'' and i->>k<>'' and netunim_internal.check_bank_number(c->>k)<>i->>k)));
  select coalesce(jsonb_agg(c),'[]') into candidates from jsonb_array_elements(eligible) c
    where (c->>'amount')::numeric<=abs(p_tx.amount)
      and (jsonb_array_length(nums)=0 or exact_ids ? (c->>'id') or netunim_internal.check_bank_number(c->>'checkNumber')='')
      and not (jsonb_array_length(nums)=1 and jsonb_array_length(exact_ids)>0 and not (exact_ids ? (c->>'id')))
      and (pack->>'kind'<>'valid' or exists(select 1 from jsonb_array_elements(pack->'items') i where netunim_internal.check_bank_item_matches(c,i)));
  if jsonb_array_length(candidates)>16 then return jsonb_build_object('kind','limit','candidates',candidates); end if;
  with recursive items as (
    select c->>'id' id,(c->>'amount')::numeric amount,n::int n from jsonb_array_elements(candidates) with ordinality x(c,n)
  ), subsets(ids,total,last_n) as (
    select array[]::text[],0::numeric,0 union all select s.ids||i.id,s.total+i.amount,i.n from subsets s join items i on i.n>s.last_n where s.total+i.amount<=abs(p_tx.amount)
  ), found as (
    select ids from subsets where total=abs(p_tx.amount) and cardinality(ids)>0
      and (jsonb_array_length(nums)=0 or cardinality(ids)=jsonb_array_length(nums))
      and (jsonb_array_length(nums)=0 or not exists(select 1 from jsonb_array_elements(candidates) c
        where c->>'id'=any(ids) and netunim_internal.check_bank_number(c->>'checkNumber')<>''
          and (select count(*) from jsonb_array_elements(candidates) x where x->>'id'=any(ids)
            and netunim_internal.check_bank_number(x->>'checkNumber')=netunim_internal.check_bank_number(c->>'checkNumber'))
            > (select count(*) from jsonb_array_elements_text(nums) n where netunim_internal.check_bank_number(n)=netunim_internal.check_bank_number(c->>'checkNumber'))))
      and (netunim_internal.check_bank_money(p_tx.check_details->>'checkCount') is null or cardinality(ids)=netunim_internal.check_bank_money(p_tx.check_details->>'checkCount'))
      and (pack->>'kind'<>'valid' or not exists(select 1 from jsonb_array_elements(pack->'items') bi
        where (select count(*) from jsonb_array_elements(pack->'items') x where x->'amount'=bi->'amount')
          <> (select count(*) from jsonb_array_elements(candidates) c where c->>'id'=any(ids) and (c->>'amount')::numeric=(bi->>'amount')::numeric)))
  )
  select jsonb_build_object('kind',case count(*) when 0 then 'none' when 1 then 'unique' else 'ambiguous' end,
    'ids',(select to_jsonb(f.ids) from found f order by f.ids limit 1),
    'candidates',coalesce((select jsonb_agg(c) from jsonb_array_elements(candidates) c where exists(select 1 from found f where c->>'id'=any(f.ids))),'[]')) into solutions from found;
  if solutions->>'kind'='none' and jsonb_array_length(exact_ids)>0 then
    select coalesce(jsonb_agg(c),'[]') into candidates from jsonb_array_elements(eligible) c where exact_ids ? (c->>'id');
    return jsonb_build_object('kind','ambiguous','ids','[]'::jsonb,'candidates',candidates,'warning','number_amount_conflict');
  end if;
  return solutions;
end $$;

create or replace function netunim_internal.check_bank_proposals(p_checks jsonb,p_tx public.bank_transactions)
returns jsonb language plpgsql stable set search_path=pg_catalog,public as $$
declare pack jsonb:=netunim_internal.check_bank_items(p_tx); i jsonb; v public.bank_transactions:=p_tx; m jsonb; proposals jsonb:='[]';
begin
  if pack->>'kind'='valid' then
    for i in select value from jsonb_array_elements(pack->'items') loop
      v.amount:=(i->>'amount')::numeric;
      v.check_details:=jsonb_build_object('checkItems',jsonb_build_array(i),'checkNumbers',case when i->>'checkNumber'='' then '[]'::jsonb else jsonb_build_array(i->>'checkNumber') end,'checkCount',1);
      m:=netunim_internal.check_bank_candidates(p_checks,v);
      if m->>'kind'<>'none' then proposals:=proposals||jsonb_build_array(m||jsonb_build_object('bankItem',i,'slot',md5(i::text),'transactionId',p_tx.id)); end if;
    end loop;
    -- An entirely unnumbered group may be certain as a whole even though its
    -- equal-value members cannot yet be assigned to individual bank rows.
    if not exists(select 1 from jsonb_array_elements(proposals) p where p->>'kind'='unique' or p ? 'warning') then
      m:=netunim_internal.check_bank_candidates(p_checks,p_tx);
      if m->>'kind'='unique' and not exists(select 1 from jsonb_array_elements(m->'candidates') c
        where netunim_internal.check_bank_number(c->>'checkNumber')<>'') then
        proposals:=jsonb_build_array(m||jsonb_build_object('slot','batch','transactionId',p_tx.id));
      end if;
    end if;
  else
    m:=netunim_internal.check_bank_candidates(p_checks,p_tx);
    if m->>'kind'<>'none' then proposals:=jsonb_build_array(m||jsonb_build_object('slot','batch','transactionId',p_tx.id)); end if;
  end if;
  return proposals;
end $$;


create or replace function netunim_internal.check_bank_claim_members(p_claim netunim_internal.check_bank_claims)
returns jsonb language plpgsql stable set search_path=pg_catalog,public as $$
declare item jsonb; matches jsonb; member jsonb; rows jsonb:='[]'; used jsonb:='[]'; current_check jsonb; enriched jsonb:='[]';
begin
  if p_claim.bank_members is null then return p_claim.members; end if;
  -- Filling an originally blank manual number can resolve an old equal-value
  -- group. Names/amounts remain the original evidence; only compatible identity
  -- enrichment from the still-linked, automatically tracked check is admitted.
  for member in select value from jsonb_array_elements(p_claim.members) loop
    if netunim_internal.check_bank_number(member->>'checkNumber')='' then
      select c into current_check from public.shared_checks_documents d cross join lateral jsonb_array_elements(d.state->'checks') c
        where d.owner_id=p_claim.owner_id and d.document_name=p_claim.document_name and c->>'id'=member->>'id'
          and coalesce(c->>'bankAutomationDisabled','false')<>'true'
          and ((c->'bankMatch'->>'transactionId')=p_claim.transaction_id::text or p_claim.previous_transaction_ids ? (c->'bankMatch'->>'transactionId'))
          and netunim_internal.check_bank_number(c->>'checkNumber')<>''
          and netunim_internal.check_bank_money(c->>'amount')=netunim_internal.check_bank_money(member->>'amount')
          and coalesce(c->>'account','עסקי')=coalesce(member->>'account','עסקי');
      if found and (select count(*) from jsonb_array_elements(p_claim.bank_members) i where netunim_internal.check_bank_same_item(current_check,i))=1 then
        member:=member||jsonb_build_object('checkNumber',current_check->>'checkNumber');
      end if;
    end if;
    enriched:=enriched||jsonb_build_array(member);
  end loop;
  for item in select value from jsonb_array_elements(p_claim.bank_members) loop
    select coalesce(jsonb_agg(c),'[]') into matches from jsonb_array_elements(enriched) c
      where netunim_internal.check_bank_item_matches(coalesce(nullif(c->'bankItem','null'::jsonb),c),item) and not (used ? (c->>'id'));
    if jsonb_array_length(matches)=1 then member:=matches->0;used:=used||jsonb_build_array(member->>'id');
    else member:=jsonb_build_object('id','#bank:'||md5(item::text),'name','שיק מס׳ '||coalesce(item->>'checkNumber','ללא מספר')); end if;
    rows:=rows||jsonb_build_array(member||item||jsonb_build_object('status','בקופה','dueDate',
      ((p_claim.source_transaction->>'transaction_date')::timestamptz at time zone 'Asia/Jerusalem')::date,
      'account',case p_claim.account_role when 'home' then 'ביתי' else 'עסקי' end));
  end loop;
  return rows;
end $$;

-- Pending references remain references. Numbered pending rows may be linked to
-- completed rows by their complete item set, even if the aggregate reference changes.
create or replace function netunim_internal.check_bank_pending_compatible(p_pending public.bank_transactions,p_completed jsonb)
returns boolean language plpgsql stable set search_path=pg_catalog,public as $$
declare nextrow public.bank_transactions; a jsonb; b jsonb; ak text; bk text;
begin
  ak:=netunim_internal.check_bank_kind(p_pending.description);bk:=netunim_internal.check_bank_kind(p_completed->>'description');
  if ak is null and bk is null then return true; end if;
  if ak is distinct from bk then return false; end if;
  nextrow:=jsonb_populate_record(null::public.bank_transactions,jsonb_build_object('amount',p_completed->'amount','check_details',p_completed->'checkDetails'));
  a:=netunim_internal.check_bank_items(p_pending);b:=netunim_internal.check_bank_items(nextrow);
  if a->>'kind'='invalid' or b->>'kind'='invalid' then return false; end if;
  if a->>'kind'='valid' and b->>'kind'='valid' then
    return jsonb_array_length(a->'items')=jsonb_array_length(b->'items') and not exists(select 1 from jsonb_array_elements(a->'items') x
      where (select count(*) from jsonb_array_elements(b->'items') y where netunim_internal.check_bank_same_item(x,y))<>1);
  end if;
  if jsonb_typeof(p_pending.check_details->'checkNumbers')='array' and jsonb_typeof(p_completed->'checkDetails'->'checkNumbers')='array'
    and p_pending.check_details->'checkNumbers'<>'[]'::jsonb and p_completed->'checkDetails'->'checkNumbers'<>'[]'::jsonb then
    return (select jsonb_agg(netunim_internal.check_bank_number(x) order by netunim_internal.check_bank_number(x)) from jsonb_array_elements_text(p_pending.check_details->'checkNumbers') x)
      =(select jsonb_agg(netunim_internal.check_bank_number(x) order by netunim_internal.check_bank_number(x)) from jsonb_array_elements_text(p_completed->'checkDetails'->'checkNumbers') x);
  end if;
  return true;
end $$;

create or replace function netunim_internal.check_bank_pending_items_equal(p_pending public.bank_transactions,p_completed jsonb)
returns boolean language plpgsql stable set search_path=pg_catalog,public as $$
declare r public.bank_transactions;
begin
  r:=jsonb_populate_record(null::public.bank_transactions,jsonb_build_object('amount',p_completed->'amount','check_details',p_completed->'checkDetails'));
  return netunim_internal.check_bank_kind(p_pending.description) in ('deposit','redeposit')
    and (netunim_internal.check_bank_items(p_pending)->>'kind'='valid' or exists(
      select 1 from netunim_internal.check_bank_claims l where l.owner_id=p_pending.owner_id and l.transaction_id=p_pending.id
        and not l.conflicted and jsonb_array_length(l.members)=jsonb_array_length(netunim_internal.check_bank_items(r)->'items')
        and not exists(select 1 from jsonb_array_elements(l.members) c where
          (select count(*) from jsonb_array_elements(netunim_internal.check_bank_items(r)->'items') i
            where netunim_internal.check_bank_same_item(coalesce(nullif(c->'bankItem','null'::jsonb),c),i))<>1)
        and not exists(select 1 from jsonb_array_elements(netunim_internal.check_bank_items(r)->'items') i where
          (select count(*) from jsonb_array_elements(l.members) c
            where netunim_internal.check_bank_same_item(coalesce(nullif(c->'bankItem','null'::jsonb),c),i))<>1)))
    and netunim_internal.check_bank_items(r)->>'kind'='valid'
    and netunim_internal.check_bank_pending_compatible(p_pending,p_completed);
end $$;

-- A per-check return uses the printed bank account captured at deposit when
-- available. The same serial number at a different bank/account is not this check.
create or replace function netunim_internal.check_bank_return_matches(p_check jsonb,p_match jsonb,p_return public.bank_transactions)
returns boolean language plpgsql stable set search_path=pg_catalog,public as $$
declare pack jsonb:=netunim_internal.check_bank_items(p_return); identity jsonb:=coalesce(nullif(p_match->'bankItem','null'::jsonb),p_check);
begin
  if netunim_internal.check_bank_number(identity->>'checkNumber')='' then return false; end if;
  if pack->>'kind'='valid' then
    return (select count(*) from jsonb_array_elements(pack->'items') i where netunim_internal.check_bank_same_item(identity,i))=1;
  elsif pack->>'kind'='invalid' then return false; end if;
  return -p_return.amount=netunim_internal.check_bank_money(p_check->>'amount')
    and jsonb_typeof(p_return.check_details->'checkNumbers')='array'
    and exists(select 1 from jsonb_array_elements_text(p_return.check_details->'checkNumbers') n
      where netunim_internal.check_bank_number(n)=netunim_internal.check_bank_number(identity->>'checkNumber'));
end $$;


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

create or replace function netunim_internal.check_bank_remainder(p_claim netunim_internal.check_bank_claims,p_snapshot public.bank_transaction_snapshots)
returns jsonb language plpgsql stable set search_path=pg_catalog,public as $$
declare tx public.bank_transactions; candidate public.bank_transactions; original numeric; returned_total numeric:=0;
  source_day date; match jsonb; chosen jsonb; missing jsonb; n int:=0; other_claim netunim_internal.check_bank_claims;
  return_ids jsonb:='[]'; returned_members jsonb:='[]'; contested boolean:=false; source_tx public.bank_transactions;
  other_checks jsonb; pack jsonb; original_members jsonb; remaining jsonb; identity_total numeric; input_claim netunim_internal.check_bank_claims:=p_claim;
begin
  p_claim.members:=netunim_internal.check_bank_claim_members(p_claim);
  original_members:=p_claim.members;
  original:=(p_claim.source_transaction->>'amount')::numeric;
  source_day:=((p_claim.source_transaction->>'transaction_date')::timestamptz at time zone 'Asia/Jerusalem')::date;
  select * into tx from public.bank_transactions where owner_id=p_claim.owner_id and id=p_claim.transaction_id;
  if found and tx.presence_state='present' and tx.last_seen_at=p_snapshot.snapshot_at then
    pack:=netunim_internal.check_bank_items(tx);
    if p_claim.bank_members is not null and pack->>'kind'='valid' then
      select coalesce(jsonb_agg(c->>'id'),'[]'),coalesce(sum((c->>'amount')::numeric),0) into remaining,identity_total
        from jsonb_array_elements(original_members) c where exists(select 1 from jsonb_array_elements(pack->'items') i where netunim_internal.check_bank_same_item(c,i));
      if identity_total<original then
        if exists(select 1 from jsonb_array_elements(input_claim.members) c where not exists(select 1 from jsonb_array_elements(original_members) o where o->>'id'=c->>'id')) then
          return jsonb_build_object('kind','ambiguous','transactionId',tx.id,'originalAmount',original,'observedAmount',tx.amount); end if;
        select coalesce(jsonb_agg(c),'[]') into missing from jsonb_array_elements(original_members) c where not (remaining ? (c->>'id'));
        return jsonb_build_object('kind','reduced','transactionId',tx.id,'originalAmount',original,'observedAmount',identity_total,
          'remainingIds',remaining,'missingMembers',missing,'missingAmount',original-identity_total,'evidence','bank_items');
      end if;
    end if;
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
          if netunim_internal.check_bank_candidates(netunim_internal.check_bank_claim_members(other_claim),candidate)->>'kind'<>'none' then contested:=true; end if;
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
      -- Each debit already proved a unique disjoint subset. Preserve those IDs
      -- rather than trying to infer the complement from equal amounts again.
      select coalesce(jsonb_agg(c->>'id'),'[]') into remaining from jsonb_array_elements(p_claim.members) c where not (returned_members ? (c->>'id'));
      select coalesce(jsonb_agg(c),'[]') into missing from jsonb_array_elements(p_claim.members) c where returned_members ? (c->>'id');
      return jsonb_build_object('kind','reduced','transactionId',tx.id,'originalAmount',original,'observedAmount',original-returned_total,
        'remainingIds',remaining,'missingMembers',missing,'missingAmount',returned_total,'evidence','return_debits','returnTransactionIds',return_ids);

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
        and candidate.bank_reference not in ('','0') and candidate.bank_reference<>p_claim.source_transaction->>'bank_reference'
        and not (netunim_internal.check_bank_items(candidate)->>'kind'='valid' and not exists(
          select 1 from jsonb_array_elements(netunim_internal.check_bank_items(candidate)->'items') i where
            (select count(*) from jsonb_array_elements(p_claim.members) member where netunim_internal.check_bank_same_item(member,i))<>1)) then continue; end if;
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
        if netunim_internal.check_bank_candidates(netunim_internal.check_bank_claim_members(other_claim),candidate)->>'kind'<>'none' then n:=n+1; end if;
      end loop;
    end loop;
    if n<>1 then return null; end if;
  end if;
  if p_claim.bank_members is not null and exists(select 1 from jsonb_array_elements(input_claim.members) c
    where not exists(select 1 from jsonb_array_elements(original_members) o where o->>'id'=c->>'id')) then
    return chosen||jsonb_build_object('kind','ambiguous','originalAmount',original); end if;
  match:=netunim_internal.check_bank_candidates(p_claim.members,tx);
  if match->>'kind'<>'unique' then return chosen||jsonb_build_object('kind','ambiguous','originalAmount',original); end if;
  select coalesce(jsonb_agg(c),'[]') into missing from jsonb_array_elements(p_claim.members) c where not (match->'ids' ? (c->>'id'));
  return chosen||jsonb_build_object('kind','reduced','originalAmount',original,'remainingIds',match->'ids','missingMembers',missing,
    'missingAmount',original-tx.amount);
end $$;

create or replace function netunim_internal.protect_check_bank_metadata()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare c jsonb; oldc jsonb; rows jsonb:='[]';
begin
  if current_setting('app.check_bank_reconcile',true)='1' then return new; end if;
  for c in select value from jsonb_array_elements(new.state->'checks') loop
    select value into oldc from jsonb_array_elements(case when tg_op='UPDATE' then old.state->'checks' else '[]'::jsonb end) where value->>'id'=c->>'id';
    c:=c-'bankMatch';
    if oldc ? 'bankMatch' and oldc->'bankMatch'->>'transactionId' is not null then
      c:=c||jsonb_build_object('bankMatch',oldc->'bankMatch');
      if (c->>'status',c->>'amount',c->>'dueDate',coalesce(c->>'account','עסקי'))
        is distinct from (oldc->>'status',oldc->>'amount',oldc->>'dueDate',coalesce(oldc->>'account','עסקי'))
        or (netunim_internal.check_bank_number(c->>'checkNumber') is distinct from netunim_internal.check_bank_number(oldc->>'checkNumber')
          and (netunim_internal.check_bank_number(oldc->>'checkNumber')<>''
            or (coalesce(oldc->'bankMatch'->'bankItem'->>'checkNumber','')<>''
              and netunim_internal.check_bank_number(c->>'checkNumber')<>oldc->'bankMatch'->'bankItem'->>'checkNumber'))) then
        c:=c||jsonb_build_object('bankAutomationDisabled',true,'bankMatch',(oldc->'bankMatch')||'{"phase":"manual"}'::jsonb);
      end if;
    end if;
    if oldc->'bankMatch'->>'phase' in ('overdue','unverified')
      and (c->>'status',c->>'amount',c->>'dueDate',coalesce(c->>'account','עסקי'))
        is not distinct from (oldc->>'status',oldc->>'amount',oldc->>'dueDate',coalesce(oldc->>'account','עסקי'))
        or (netunim_internal.check_bank_number(c->>'checkNumber') is distinct from netunim_internal.check_bank_number(oldc->>'checkNumber')
          and (netunim_internal.check_bank_number(oldc->>'checkNumber')<>''
            or (coalesce(oldc->'bankMatch'->'bankItem'->>'checkNumber','')<>''
              and netunim_internal.check_bank_number(c->>'checkNumber')<>oldc->'bankMatch'->'bankItem'->>'checkNumber'))) then
      c:=c||jsonb_build_object('bankMatch',oldc->'bankMatch');
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

create or replace function netunim_internal.reconcile_check_bank_snapshot()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare doc record; tx public.bank_transactions; ret public.bank_transactions; c jsonb; m jsonb;
  rows jsonb; nextrows jsonb; proposals jsonb:='[]'; proposal jsonb; match jsonb; ids jsonb;
  phase text; event text; txday date; clearafter date; returncount int; overlapcount int; claim netunim_internal.check_bank_claims;
  pack jsonb; mapped_item jsonb; mapped_count int; oldclaim netunim_internal.check_bank_claims; already_claimed boolean;
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
    select * into tx from public.bank_transactions where id=claim.transaction_id and owner_id=new.owner_id;
    pack:=netunim_internal.check_bank_items(tx);
    if claim.bank_members is null and tx.amount=(claim.source_transaction->>'amount')::numeric
      and tx.last_seen_at=new.snapshot_at and tx.presence_state='present' and pack->>'kind'='valid'
      and not exists(select 1 from jsonb_array_elements(claim.members) member where not exists(
        select 1 from jsonb_array_elements(pack->'items') i where netunim_internal.check_bank_item_matches(coalesce(nullif(member->'bankItem','null'::jsonb),member),i))) then
      update netunim_internal.check_bank_claims set bank_members=pack->'items' where owner_id=claim.owner_id and transaction_id=claim.transaction_id;
      claim.bank_members:=pack->'items';
    end if;
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
      and netunim_internal.check_bank_kind(b.description) in ('deposit','redeposit')
    order by b.id
  loop
    proposals:=proposals||netunim_internal.check_bank_proposals(rows,tx);
  end loop;
  for proposal in select value from jsonb_array_elements(proposals) loop
    select * into tx from public.bank_transactions where id=(proposal->>'transactionId')::bigint;
    ids:=proposal->'ids';
    select * into claim from netunim_internal.check_bank_claims where owner_id=new.owner_id and transaction_id=tx.id;
    already_claimed:=found;
    if already_claimed and proposal->>'kind'='unique' and not exists(select 1 from jsonb_array_elements_text(ids) id where not (claim.check_ids ? id)) then continue; end if;
    if already_claimed and proposal ? 'bankItem' and (
      exists(select 1 from jsonb_array_elements(claim.members) member where
        netunim_internal.check_bank_same_item(coalesce(nullif(member->'bankItem','null'::jsonb),member),proposal->'bankItem'))
      or (select sum((member->>'amount')::numeric) from jsonb_array_elements(claim.members) member)=(claim.source_transaction->>'amount')::numeric
    ) then continue; end if;
    -- An amount-only claim reserves the entire movement, including deleted checks.
    if already_claimed and not (proposal ? 'bankItem') then continue; end if;
    -- Every alternative (including an ambiguous/over-limit deposit) blocks shared candidates.
    select count(*) into overlapcount from jsonb_array_elements(proposals) p
    where (p->>'transactionId',p->>'slot') is distinct from (proposal->>'transactionId',proposal->>'slot')
      and exists(select 1 from jsonb_array_elements(p->'candidates') x where ids ? (x->>'id'));
    phase:=case when proposal->>'kind'='unique' and overlapcount=0 then 'deposited' else 'ambiguous' end;
    if phase='deposited' and exists(select 1 from jsonb_array_elements(rows) x where ids ? (x->>'id')
      and (x->>'status'='נפרע' or x->'bankMatch'->>'phase' in ('deposited','cleared','missing'))) then phase:='ambiguous'; end if;
    if phase='deposited' and netunim_internal.check_bank_kind(tx.description)='redeposit' and exists(
      select 1 from jsonb_array_elements(rows) x where ids ? (x->>'id') and (
        not (proposal ? 'bankItem') or netunim_internal.check_bank_number(x->>'checkNumber')=''
        or not netunim_internal.check_bank_same_item(coalesce(nullif(x->'bankMatch'->'bankItem','null'::jsonb),x),proposal->'bankItem')
        or exists(select 1 from public.bank_transactions r where r.owner_id=new.owner_id and r.account_key=new.account_key and r.account_role=new.account_role
          and r.amount<0 and r.presence_state='present' and netunim_internal.check_bank_kind(r.description)='return'
          and r.transaction_date::date=tx.transaction_date::date and netunim_internal.check_bank_return_matches(x,jsonb_build_object('bankItem',proposal->'bankItem'),r))
        or (x->>'status'='חזר' and exists(select 1 from public.bank_transactions r where r.owner_id=new.owner_id
          and r.id=(x->'bankMatch'->>'returnTransactionId')::bigint and r.transaction_date::date>=tx.transaction_date::date)))) then
      phase:='ambiguous';proposal:=proposal||jsonb_build_object('warning','redeposit_unverified'); end if;
    if phase='deposited' then
      select jsonb_agg(jsonb_build_object('id',member->>'id','name',member->>'name','amount',member->'amount','dueDate',member->>'dueDate',
        'account',coalesce(member->>'account','עסקי'),'status','בקופה','checkNumber',member->>'checkNumber','bankItem',proposal->'bankItem')) into members
      from jsonb_array_elements(rows) member where ids ? (member->>'id');
      insert into netunim_internal.check_bank_claims(owner_id,document_name,transaction_id,account_key,account_role,check_ids,members,source_transaction,bank_members)
      values(new.owner_id,'main',tx.id,new.account_key,new.account_role,ids,members,to_jsonb(tx),
        case when netunim_internal.check_bank_items(tx)->>'kind'='valid' then netunim_internal.check_bank_items(tx)->'items' end)
      on conflict(owner_id,transaction_id) do update set
        check_ids=netunim_internal.check_bank_claims.check_ids||excluded.check_ids,
        members=netunim_internal.check_bank_claims.members||excluded.members;
    else
      select jsonb_agg(x->>'id') into ids from jsonb_array_elements(proposal->'candidates') x;
    end if;
    nextrows:='[]';
    for c in select value from jsonb_array_elements(rows) loop
      if ids ? (c->>'id') and c->>'status' in ('בקופה','הופקד - במעקב','חזר')
        and coalesce(c->'bankMatch'->>'phase','') not in ('deposited','cleared','missing') then
        event:=tx.id::text||':'||phase||case when phase='ambiguous' then ':'||md5(ids::text) else '' end;
        m:=jsonb_build_object('transactionId',tx.id,'accountKey',tx.account_key,'accountRole',tx.account_role,'phase',phase,'eventId',event,
          'bankItem',proposal->'bankItem','provisional',tx.status='pending',
          'matchMethod',case when proposal ? 'bankItem' and netunim_internal.check_bank_number(c->>'checkNumber')<>''
            and netunim_internal.check_bank_number(c->>'checkNumber')=proposal->'bankItem'->>'checkNumber' then 'number' else 'amount' end,
          'description',tx.description,'amount',tx.amount,'date',(tx.transaction_date at time zone 'Asia/Jerusalem')::date,
          'detectedAt',case when c->'bankMatch'->>'eventId'=event then c->'bankMatch'->'detectedAt' else to_jsonb(new.snapshot_at) end,
          'completedSeenDate',case when tx.status='completed' and phase='deposited' then (new.snapshot_at at time zone 'Asia/Jerusalem')::date end,
          'checkIds',ids,'previousStatus',c->>'status','previousDepositDate',c->'depositDate');
        if proposal ? 'warning' then m:=m||jsonb_build_object('warning',proposal->>'warning'); end if;
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
        if claim.check_ids is not null and not (m ? 'remainder') then m:=m||jsonb_build_object('checkIds',claim.check_ids); end if;
        pack:=netunim_internal.check_bank_items(tx);
        if pack->>'kind'='valid' and tx.presence_state='present' and tx.last_seen_at=new.snapshot_at and (m->'bankItem' is null or m->'bankItem'='null'::jsonb) then
          select count(*),jsonb_agg(i)->0 into mapped_count,mapped_item from jsonb_array_elements(pack->'items') i where netunim_internal.check_bank_item_matches(c,i)
            and exists(select 1 from jsonb_array_elements(netunim_internal.check_bank_claim_members(claim)) member
              where member->>'id'=c->>'id' and netunim_internal.check_bank_same_item(member,i));
          if mapped_count=1 then m:=m||jsonb_build_object('bankItem',mapped_item,'matchMethod',case when netunim_internal.check_bank_number(c->>'checkNumber')=mapped_item->>'checkNumber' then 'number' else 'amount' end); end if;
        end if;
        if tx.status='completed' then m:=m||jsonb_build_object('provisional',false); end if;
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
          if netunim_internal.check_bank_candidates(netunim_internal.check_bank_claim_members(claim),ret)->>'kind'<>'none' then
            returncount:=returncount+1;
          end if;
        end loop;
        if reduced_survivor and remainder->>'evidence'='return_debits' then returncount:=0; end if;
        select r.* into ret from public.bank_transactions r where r.owner_id=new.owner_id
          and r.account_key=new.account_key and r.account_role=new.account_role and r.amount<0
          and r.status='completed' and r.currency='ILS' and r.presence_state='present'
          and netunim_internal.check_bank_kind(r.description)='return'
          and (r.transaction_date at time zone 'Asia/Jerusalem')::date>=txday
          and (r.transaction_date at time zone 'Asia/Jerusalem')::date<=(new.snapshot_at at time zone 'Asia/Jerusalem')::date
          and netunim_internal.check_bank_return_matches(c,m,r)
          and (select count(*) from jsonb_array_elements(rows) x where coalesce(x->>'account','עסקי')=coalesce(c->>'account','עסקי')
            and netunim_internal.check_bank_same_item(coalesce(nullif(x->'bankMatch'->'bankItem','null'::jsonb),x),coalesce(nullif(m->'bankItem','null'::jsonb),c)))=1
          order by r.id limit 1;
        if claim.conflicted then
          phase:='missing';m:=m||jsonb_build_object('warning','identity_conflict');
          c:=c||jsonb_build_object('status','הופקד - במעקב','clearedDate',null);
        elsif found then
          phase:='returned'; c:=c||jsonb_build_object('status','חזר','clearedDate',null);
          m:=(m-'warning')||jsonb_build_object('returnTransactionId',ret.id,'returnDate',(ret.transaction_date at time zone 'Asia/Jerusalem')::date,'reason',concat_ws(' · ',nullif(ret.message_headline,''),nullif(ret.message_detail,''),ret.description));
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
        elsif pack->>'kind'='none' and m->'bankItem' is not null and m->'bankItem'<>'null'::jsonb then
          m:=m||jsonb_build_object('warning','details_unavailable');
          if c->>'status'='נפרע' then phase:='deposited';c:=c||jsonb_build_object('status','הופקד - במעקב','clearedDate',null); end if;
        elsif tx.amount<>(m->>'amount')::numeric or tx.currency<>'ILS' or tx.status not in ('pending','completed')
          or coalesce(netunim_internal.check_bank_kind(tx.description),'') not in ('deposit','redeposit')
          or pack->>'kind'='invalid'
          or (pack->>'kind'='valid' and not exists(select 1 from jsonb_array_elements(pack->'items') i
            where netunim_internal.check_bank_item_matches(coalesce(nullif(m->'bankItem','null'::jsonb),c),i)))
          or (pack->>'kind'='valid' and m->'bankItem' is not null and m->'bankItem'<>'null'::jsonb and not exists(
            select 1 from jsonb_array_elements(pack->'items') i where netunim_internal.check_bank_same_item(m->'bankItem',i)))
          or (pack->>'kind'='none' and netunim_internal.check_bank_number(c->>'checkNumber')<>''
            and jsonb_typeof(tx.check_details->'checkNumbers')='array' and tx.check_details->'checkNumbers'<>'[]'::jsonb
            and not exists(select 1 from jsonb_array_elements_text(tx.check_details->'checkNumbers') n where netunim_internal.check_bank_number(n)=netunim_internal.check_bank_number(c->>'checkNumber')))
          or (pack->>'kind'<>'valid' and coalesce(remainder->>'evidence','')<>'return_debits' and coalesce(tx.check_details->>'checkCount','') ~ '^[1-9][0-9]*$'
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
          elsif m->>'warning' in ('calendar','possible_return','details_unavailable') then m:=m-'warning'; end if;
          if clearafter is not null and (new.snapshot_at at time zone 'Asia/Jerusalem')::date>=clearafter
            and new.coverage_from<=txday and new.coverage_to>=(new.snapshot_at at time zone 'Asia/Jerusalem')::date
            and c->>'bankReview'=m->>'eventId' and not (c->'bankMatch' ? 'warning')
            and m->'bankItem' is not distinct from c->'bankMatch'->'bankItem' and coalesce((c->'bankMatch'->>'provisional')::boolean,false)=false
            and phase='deposited' then
            phase:='cleared';c:=c||jsonb_build_object('status','נפרע','clearedDate',(new.snapshot_at at time zone 'Asia/Jerusalem')::date);
          end if;
        end if;
        event:=m->>'eventId';
        if phase is distinct from c->'bankMatch'->>'phase' or m->>'warning' is distinct from c->'bankMatch'->>'warning'
          or m->'remainder' is distinct from c->'bankMatch'->'remainder'
          or m->'bankItem' is distinct from c->'bankMatch'->'bankItem' or m->'provisional' is distinct from c->'bankMatch'->'provisional' then
          event:=tx.id::text||':'||phase||':'||new.snapshot_at::text;
        end if;
        c:=c||jsonb_build_object('bankMatch',m||jsonb_build_object('phase',phase,'eventId',event));
      else
        c:=c||jsonb_build_object('status','הופקד - במעקב','clearedDate',null,'bankMatch',m||jsonb_build_object('phase','missing','eventId',(m->>'transactionId')||':missing'));
      end if;
    end if;
    nextrows:=nextrows||jsonb_build_array(c);
  end loop;
  rows:=nextrows;nextrows:='[]';
  for c in select value from jsonb_array_elements(rows) loop
    if coalesce(c->>'bankAutomationDisabled','false')<>'true'
      and coalesce(c->'bankMatch'->>'phase','') in ('','overdue','unverified')
      and coalesce(c->>'account','עסקי')=(case new.account_role when 'home' then 'ביתי' else 'עסקי' end)
      and c->>'status' in ('בקופה','הופקד - במעקב')
      and netunim_internal.check_bank_date(c->>'dueDate') between new.coverage_from and (new.snapshot_at at time zone 'Asia/Jerusalem')::date
      and new.coverage_to>=(new.snapshot_at at time zone 'Asia/Jerusalem')::date then
      phase:=case c->>'status' when 'בקופה' then 'overdue' else 'unverified' end;
      event:='no-bank:'||new.account_key||':'||(c->>'id')||':'||(c->>'dueDate')||':'||phase;
      if c->'bankMatch'->>'eventId' is distinct from event then
        c:=c||jsonb_build_object('bankMatch',jsonb_build_object('phase',phase,'eventId',event,'accountKey',new.account_key,
          'observedDate',(new.snapshot_at at time zone 'Asia/Jerusalem')::date,'date',c->>'dueDate'));
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

revoke all on function netunim_internal.check_bank_number(text),netunim_internal.check_bank_money(text),
netunim_internal.check_bank_items(public.bank_transactions),netunim_internal.check_bank_item_matches(jsonb,jsonb),
netunim_internal.check_bank_same_item(jsonb,jsonb),netunim_internal.check_bank_proposals(jsonb,public.bank_transactions),
netunim_internal.check_bank_claim_members(netunim_internal.check_bank_claims),
netunim_internal.check_bank_pending_compatible(public.bank_transactions,jsonb),netunim_internal.check_bank_pending_items_equal(public.bank_transactions,jsonb),
netunim_internal.check_bank_return_matches(jsonb,jsonb,public.bank_transactions) from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
