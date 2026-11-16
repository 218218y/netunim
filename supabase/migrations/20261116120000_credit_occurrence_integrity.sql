begin;
set local lock_timeout='2s';
set local statement_timeout='60s';

create function netunim_internal.credit_observation_key(tx jsonb) returns jsonb
language sql immutable set search_path=pg_catalog as $f$
 select jsonb_build_array(coalesce(nullif(tx->>'id',''),tx->>'identifier',''),tx->'type',tx->'status',tx->'date',tx->'processedDate',
 tx->'transactionDate',tx->'transactionTime',tx->'originalAmount',tx->'originalCurrency',tx->'chargedAmount',tx->'chargedCurrency',
 tx->'chargeAmountStatus',tx->'foreignTransaction',coalesce(tx->>'description',''),tx->'memo',tx#>'{installments,number}',tx#>'{installments,total}')
$f$;
create function netunim_internal.credit_source_evidence(old_tx jsonb,new_tx jsonb) returns boolean
language sql immutable set search_path=pg_catalog as $f$
 select coalesce(nullif(old_tx->>'id',''),old_tx->>'identifier','')=coalesce(nullif(new_tx->>'id',''),new_tx->>'identifier','')
 and coalesce(old_tx->>'date','')<>'' and old_tx->>'date'=new_tx->>'date'
 and coalesce(nullif(old_tx->>'transactionDate',''),old_tx->>'date','')=coalesce(nullif(new_tx->>'transactionDate',''),new_tx->>'date','')
 and (coalesce(nullif(old_tx->>'id',''),old_tx->>'identifier','')<>'' or coalesce(old_tx->>'description','')<>'')
 and coalesce(old_tx->>'description','')=coalesce(new_tx->>'description','')
 and coalesce(old_tx->>'transactionTime','')=coalesce(new_tx->>'transactionTime','')
 and old_tx->>'originalAmount' is not null and coalesce(old_tx->>'originalCurrency','')<>''
 and old_tx->'originalAmount'=new_tx->'originalAmount' and old_tx->'originalCurrency'=new_tx->'originalCurrency'
 and old_tx#>'{installments,number}' is not distinct from new_tx#>'{installments,number}'
 and old_tx#>'{installments,total}' is not distinct from new_tx#>'{installments,total}'
 and (old_tx->>'chargedAmount' is null or old_tx->'chargedAmount'=new_tx->'chargedAmount' and old_tx->'chargedCurrency'=new_tx->'chargedCurrency')
$f$;
create or replace function netunim_internal.credit_source_matches(old_tx jsonb,new_tx jsonb) returns boolean
language sql immutable set search_path=pg_catalog,netunim_internal as $f$
 select netunim_internal.credit_source_evidence(old_tx,new_tx) and
 (coalesce(nullif(old_tx->>'id',''),old_tx->>'identifier','')<>'' or coalesce(old_tx->>'transactionTime','')~'^([01][0-9]|2[0-3]):[0-5][0-9]$')
$f$;
create function netunim_internal.credit_placement_overlap(source jsonb,assigned jsonb) returns boolean
language sql immutable set search_path=pg_catalog,netunim_internal as $f$
 select netunim_internal.credit_source_evidence(source,assigned) or netunim_internal.credit_source_evidence(assigned,source)
$f$;
create function netunim_internal.credit_amount_enrichment(old_tx jsonb,new_tx jsonb) returns boolean
language sql immutable set search_path=pg_catalog,netunim_internal as $f$
 select coalesce(nullif(old_tx->>'id',''),old_tx->>'identifier','')<>'' and old_tx->>'status'='completed' and new_tx->>'status'='completed'
 and old_tx->>'chargedAmount' is null and old_tx->>'chargeAmountStatus'='missing' and new_tx->>'chargeAmountStatus'='reported'
 and jsonb_typeof(new_tx->'chargedAmount')='number' and old_tx->'processedDate' is not distinct from new_tx->'processedDate'
 and old_tx->'type' is not distinct from new_tx->'type' and old_tx->'foreignTransaction' is not distinct from new_tx->'foreignTransaction'
 and netunim_internal.credit_source_evidence(old_tx,new_tx)
$f$;
create function netunim_internal.credit_history_preserved(previous jsonb,incoming jsonb,day text) returns boolean
language plpgsql immutable set search_path=pg_catalog,netunim_internal as $f$
declare source jsonb;candidate jsonb;candidates jsonb;remaining jsonb:='[]';used bigint[]:=array[]::bigint[];matches bigint[];position bigint;
begin
 select coalesce(jsonb_agg(jsonb_build_object('month',month,'tx',tx)),'[]') into candidates from netunim_internal.credit_month_rows(incoming);
 for source in select jsonb_build_object('month',month,'tx',tx) from netunim_internal.credit_month_rows(previous)
 where month<left(day,7) or coalesce(tx->>'status','completed')='completed' and (coalesce(tx->>'type','')<>'statement_adjustment'
 or not coalesce(tx->>'processedDate'~'^[0-9]{4}-[0-9]{2}-[0-9]{2}',false) or left(tx->>'processedDate',10)<=day) loop
  select ordinal into position from jsonb_array_elements(candidates) with ordinality rows(value,ordinal)
  where not(ordinal=any(used)) and value->>'month'=source->>'month'
   and netunim_internal.credit_financial_key(value->'tx')=netunim_internal.credit_financial_key(source->'tx') limit 1;
  if position is null then remaining:=remaining||jsonb_build_array(source);else used:=array_append(used,position);end if;
 end loop;
 for source in select value from jsonb_array_elements(remaining) loop
  select array_agg(ordinal) into matches from jsonb_array_elements(candidates) with ordinality rows(value,ordinal)
  where not(ordinal=any(used)) and value->>'month'=source->>'month' and netunim_internal.credit_amount_enrichment(source->'tx',value->'tx');
  if coalesce(cardinality(matches),0)<>1 then return false;end if;
  candidate:=candidates->((matches[1]-1)::integer);
  if (select count(*) from jsonb_array_elements(remaining) old where old->>'month'=candidate->>'month'
    and netunim_internal.credit_amount_enrichment(old->'tx',candidate->'tx'))<>1 then return false;end if;
  used:=used||matches;
 end loop;
 return true;
end $f$;
create or replace function netunim_internal.guard_finance_credit_history() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,netunim_internal as $f$
declare p jsonb;a jsonb;n jsonb;r record;v_accounts jsonb;v_candidates jsonb;v_matches bigint[];v_consumed bigint[];v_remaining jsonb;v_exact bigint;v_identity jsonb;
 v_day text:=to_char(current_timestamp at time zone 'Asia/Jerusalem','YYYY-MM-DD');
begin
 -- Unchanged Credit cannot introduce a Credit regression. Other writer fences
 -- and the AFTER snapshot trigger still execute for Bank-only writes.
 if tg_op='UPDATE' and new.state->'creditSync' is not distinct from old.state->'creditSync' then return new;end if;
 if exists(select 1 from netunim_internal.finance_credit_restore_context c
   where c.backend_pid=pg_backend_pid() and c.transaction_id=txid_current() and c.owner_id=old.owner_id) then return new;end if;
 -- Both retained and proposed identities must be unambiguous before any
 -- Credit mutation. A normalizer cannot hide a pre-existing duplicate ID.
 for v_identity in select new.state->'creditSync' union all select old.state->'creditSync' where tg_op='UPDATE' loop
  if exists(select 1 from jsonb_array_elements(coalesce(v_identity->'profiles','[]')) profile
    group by profile->>'profileId' having count(*)>1) then
    raise exception 'credit_ambiguous_identity' using errcode='23514';end if;
  for p in select value from jsonb_array_elements(coalesce(v_identity->'profiles','[]')) loop
   if exists(select 1 from jsonb_array_elements(coalesce(p->'accounts','[]')) account
     group by account->>'accountNumber' having count(*)>1) then
     raise exception 'credit_ambiguous_identity' using errcode='23514';end if;
  end loop;
 end loop;
 for p in select value from jsonb_array_elements(coalesce(new.state#>'{creditSync,profiles}','[]')) loop
  for a in select value from jsonb_array_elements(coalesce(p->'accounts','[]')) loop
   if exists(select 1 from netunim_internal.credit_unassigned_rows(a) source
     cross join lateral netunim_internal.credit_month_rows(a) assigned
     where netunim_internal.credit_placement_overlap(source,assigned.tx)) then
     raise exception 'credit_duplicate_placement' using errcode='23514';end if;
  end loop;
 end loop;
 if tg_op='INSERT' then return new;end if;
 for p in select value from jsonb_array_elements(coalesce(old.state#>'{creditSync,profiles}','[]')) loop
  for a in select value from jsonb_array_elements(coalesce(p->'accounts','[]')) loop
   -- Distinct profile IDs cannot consume each other's history on the strength
   -- of a shared owner label, provider and last digits.
   select jsonb_agg(account) into v_accounts from jsonb_array_elements(coalesce(new.state#>'{creditSync,profiles}','[]')) profile
     cross join lateral jsonb_array_elements(coalesce(profile->'accounts','[]')) account
     where account->>'accountNumber'=a->>'accountNumber' and profile->>'profileId'=p->>'profileId';
   n:=case when jsonb_array_length(v_accounts)=1 then v_accounts->0 else '{}'::jsonb end;
   if not netunim_internal.credit_history_preserved(a,n,v_day) then raise exception 'credit_history_regression' using errcode='23514';end if;
   select coalesce(jsonb_agg(jsonb_build_object('tx',tx,'assigned',assigned)),'[]') into v_candidates from (
     select value as tx,false as assigned from netunim_internal.credit_unassigned_rows(n) value
     union all select tx,true from netunim_internal.credit_month_rows(n)
   ) rows;
   v_consumed:=array[]::bigint[];v_remaining:='[]';
   -- Reserve every unchanged occurrence before considering source transitions.
   for r in select netunim_internal.credit_financial_key(value) as key,count(*) as needed,(jsonb_agg(value)->0) as tx
     from netunim_internal.credit_unassigned_rows(a) value group by 1,netunim_internal.credit_observation_key(value) loop
    select array_agg(position order by position) into v_matches
    from jsonb_array_elements(v_candidates) with ordinality candidates(value,position)
    where not (value->>'assigned')::boolean and netunim_internal.credit_financial_key(value->'tx')=r.key;
    v_exact:=least(coalesce(cardinality(v_matches),0),r.needed);
    v_consumed:=v_consumed||coalesce(v_matches[1:v_exact],array[]::bigint[]);
    if v_exact<r.needed then v_remaining:=v_remaining||jsonb_build_array(jsonb_build_object('tx',r.tx,'needed',r.needed-v_exact));end if;
   end loop;
   for r in select value->'tx' as tx,(value->>'needed')::bigint as needed from jsonb_array_elements(v_remaining) loop
    select array_agg(position order by position) into v_matches
    from jsonb_array_elements(v_candidates) with ordinality candidates(value,position)
    where not (position=any(v_consumed)) and netunim_internal.credit_source_matches(r.tx,value->'tx');
    if coalesce(cardinality(v_matches),0)<>r.needed then
      raise exception 'credit_unassigned_regression' using errcode='23514';end if;
    v_consumed:=v_consumed||v_matches;
   end loop;
  end loop;
 end loop;
 return new;
end $f$;
create or replace function netunim_internal.require_credit_restore_integrity(sync jsonb) returns void
language plpgsql immutable set search_path=pg_catalog,netunim_internal as $f$
declare p jsonb;a jsonb;m jsonb;t jsonb;v jsonb;mapping jsonb;transition jsonb;field text;rows jsonb;
begin
 if jsonb_typeof(sync) is distinct from 'object' or jsonb_typeof(sync->'profiles') is distinct from 'array' then
  raise exception 'finance_credit_invalid_version: invalid_profiles' using errcode='23514';end if;
 if exists(select 1 from jsonb_array_elements(sync->'profiles') value group by value->>'profileId' having count(*)>1) then
  raise exception 'finance_credit_invalid_version: duplicate_profile' using errcode='23514';end if;
 for p in select value from jsonb_array_elements(sync->'profiles') loop
  if jsonb_typeof(p) is distinct from 'object' or jsonb_typeof(p->'profileId') is distinct from 'string'
    or btrim(p->>'profileId')='' or jsonb_typeof(p->'accounts') is distinct from 'array' then
   raise exception 'finance_credit_invalid_version: invalid_profile' using errcode='23514';end if;
  if exists(select 1 from jsonb_array_elements(p->'accounts') value group by value->>'accountNumber' having count(*)>1) then
   raise exception 'finance_credit_invalid_version: duplicate_account' using errcode='23514';end if;
  for a in select value from jsonb_array_elements(p->'accounts') loop
   if jsonb_typeof(a) is distinct from 'object' or jsonb_typeof(a->'accountNumber') is distinct from 'string' or btrim(a->>'accountNumber')='' then
    raise exception 'finance_credit_invalid_version: invalid_account' using errcode='23514';end if;
   foreach field in array array['months','txns','unassignedTransactions','pendingTransactions','unassignedTransfers'] loop
    if a ? field and jsonb_typeof(a->field) is distinct from 'array' then
     raise exception 'finance_credit_invalid_version: invalid_list' using errcode='23514';end if;
   end loop;
   if coalesce(a->>'balanceDate','')<>'' and not netunim_internal.credit_restore_valid_day(a->>'balanceDate') then
    raise exception 'finance_credit_invalid_version: invalid_date' using errcode='23514';end if;
   if exists(select 1 from jsonb_array_elements(coalesce(a->'months','[]')) value group by value->>'month' having count(*)>1) then
    raise exception 'finance_credit_invalid_version: duplicate_month' using errcode='23514';end if;
   for m in select value from jsonb_array_elements(coalesce(a->'months','[]')) loop
    if jsonb_typeof(m) is distinct from 'object' or coalesce(m->>'month','')!~'^[0-9]{4}-(0[1-9]|1[0-2])$'
      or left(m->>'month',4)='0000' or jsonb_typeof(m->'transactions') is distinct from 'array' then
     raise exception 'finance_credit_invalid_version: invalid_month' using errcode='23514';end if;
   end loop;
   select coalesce(jsonb_agg(tx),'[]') into rows from (
    select tx from netunim_internal.credit_month_rows(a)
    union all select value from netunim_internal.credit_unassigned_rows(a) value
    union all select value from jsonb_array_elements(coalesce(a->'pendingTransactions','[]'))
    union all select value from jsonb_array_elements(coalesce(a->'txns','[]'))
      where jsonb_array_length(coalesce(a->'months','[]'))=0 and not(a ? 'pendingTransactions') and value->>'status'='pending'
   ) active;
   for t in select value from jsonb_array_elements(rows) loop
    if jsonb_typeof(t) is distinct from 'object' then raise exception 'finance_credit_invalid_version: invalid_transaction' using errcode='23514';end if;
    foreach field in array array['originalAmount','chargedAmount'] loop
     v:=t->field;
     if v is not null and v<>'null'::jsonb then
      if jsonb_typeof(v) is distinct from 'number' then raise exception 'finance_credit_invalid_version: invalid_amount' using errcode='23514';end if;
      if abs(round((v#>>'{}')::numeric*100))>9007199254740991 then raise exception 'finance_credit_invalid_version: invalid_amount' using errcode='23514';end if;
      if coalesce(t->>replace(field,'Amount','Currency'),'')!~'^[A-Z]{3}$'
        and coalesce(t->>replace(field,'Amount','Currency'),'') not in ('₪','ש״ח','שח','ש"ח','$','€','£','¥','₽','₹','₩','₺','₴','₫','฿','R$') then
       raise exception 'finance_credit_invalid_version: invalid_currency' using errcode='23514';end if;
     end if;
    end loop;
    foreach field in array array['date','processedDate'] loop
     if coalesce(t->>field,'')<>'' and not netunim_internal.credit_restore_valid_day(t->>field) then raise exception 'finance_credit_invalid_version: invalid_date' using errcode='23514';end if;
    end loop;
    if t ? 'status' and coalesce(t->>'status','') not in ('completed','pending') then raise exception 'finance_credit_invalid_version: invalid_status' using errcode='23514';end if;
    if t ? 'foreignTransaction' and jsonb_typeof(t->'foreignTransaction') is distinct from 'boolean'
      or t ? 'chargeAmountStatus' and coalesce(t->>'chargeAmountStatus','') not in ('reported','missing','not_billed')
      or t->>'chargeAmountStatus'='reported' and t->>'chargedAmount' is null
      or t->>'chargeAmountStatus'='missing' and t->>'chargedAmount' is not null
      or t->>'chargeAmountStatus'='not_billed' and t->>'chargedAmount' is not null and t->'chargedAmount'<>'0'::jsonb then
     raise exception 'finance_credit_invalid_version: invalid_evidence' using errcode='23514';end if;
    if t->'installments' is not null and t->'installments'<>'null'::jsonb then
     if jsonb_typeof(t->'installments') is distinct from 'object' or coalesce(t#>>'{installments,number}','')!~'^[1-9][0-9]*$'
       or coalesce(t#>>'{installments,total}','')!~'^[1-9][0-9]*$' then raise exception 'finance_credit_invalid_version: invalid_installments' using errcode='23514';end if;
     if (t#>>'{installments,number}')::numeric>(t#>>'{installments,total}')::numeric or (t#>>'{installments,total}')::numeric>9007199254740991 then raise exception 'finance_credit_invalid_version: invalid_installments' using errcode='23514';end if;
    end if;
   end loop;
   if exists(select 1 from jsonb_array_elements(rows) tx where coalesce(nullif(tx->>'id',''),tx->>'identifier','')<>''
     group by netunim_internal.credit_observation_key(tx) having count(*)>1) then
    raise exception 'finance_credit_invalid_version: ambiguous_billing_identity' using errcode='23514';end if;
   if exists(select 1 from netunim_internal.credit_unassigned_rows(a) source cross join lateral netunim_internal.credit_month_rows(a) assigned
      where netunim_internal.credit_placement_overlap(source,assigned.tx)) then
    raise exception 'finance_credit_invalid_version: duplicate_placement' using errcode='23514';end if;
  end loop;
 end loop;
 if sync ? 'cardMappings' and jsonb_typeof(sync->'cardMappings') is distinct from 'object' then raise exception 'finance_credit_invalid_version: invalid_mappings' using errcode='23514';end if;
 for mapping in select value from jsonb_each(coalesce(sync->'cardMappings','{}')) loop
  if jsonb_typeof(mapping) is distinct from 'object' then raise exception 'finance_credit_invalid_version: invalid_mapping' using errcode='23514';end if;
  foreach field in array array['included','hidden'] loop
   if mapping ? field and jsonb_typeof(mapping->field) is distinct from 'boolean' then raise exception 'finance_credit_invalid_version: invalid_mapping' using errcode='23514';end if;
  end loop;
  if mapping ? 'account' and coalesce(mapping->>'account','') not in ('עסקי','ביתי','business','home') then raise exception 'finance_credit_invalid_version: invalid_mapping' using errcode='23514';end if;
  v:=mapping->'manualFrame';
  if v is not null and v<>'null'::jsonb then
   if jsonb_typeof(v) is distinct from 'number' then raise exception 'finance_credit_invalid_version: invalid_amount' using errcode='23514';end if;
   if (v#>>'{}')::numeric<0 or round((v#>>'{}')::numeric*100)>9007199254740991 then raise exception 'finance_credit_invalid_version: invalid_amount' using errcode='23514';end if;
  end if;
  if mapping ? 'accountTransitions' and jsonb_typeof(mapping->'accountTransitions') is distinct from 'array' then raise exception 'finance_credit_invalid_version: invalid_transitions' using errcode='23514';end if;
  for transition in select value from jsonb_array_elements(coalesce(mapping->'accountTransitions','[]')) loop
   if jsonb_typeof(transition) is distinct from 'object' or not netunim_internal.credit_restore_valid_day(transition->>'effectiveDate')
     or coalesce(transition->>'fromAccount','') not in ('עסקי','ביתי','business','home') or coalesce(transition->>'toAccount','') not in ('עסקי','ביתי','business','home')
     or transition->>'fromAccount'=transition->>'toAccount' then raise exception 'finance_credit_invalid_version: invalid_transitions' using errcode='23514';end if;
  end loop;
 end loop;
end $f$;

revoke all on function netunim_internal.credit_observation_key(jsonb),netunim_internal.credit_source_evidence(jsonb,jsonb),
 netunim_internal.credit_placement_overlap(jsonb,jsonb),netunim_internal.credit_amount_enrichment(jsonb,jsonb),
 netunim_internal.credit_history_preserved(jsonb,jsonb,text) from public,anon,authenticated;
commit;
