begin;
set local lock_timeout='2s';
set local statement_timeout='60s';
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
     where netunim_internal.credit_source_matches(source,assigned.tx)) then
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
   if exists(
     (select month,netunim_internal.credit_financial_key(tx) from netunim_internal.credit_month_rows(a)
       where month<left(v_day,7) or coalesce(tx->>'status','completed')='completed' and (coalesce(tx->>'type','')<>'statement_adjustment' or not coalesce(tx->>'processedDate'~'^[0-9]{4}-[0-9]{2}-[0-9]{2}',false) or left(tx->>'processedDate',10)<=v_day))
     except all
     (select month,netunim_internal.credit_financial_key(tx) from netunim_internal.credit_month_rows(n))
   ) then raise exception 'credit_history_regression' using errcode='23514';end if;
   select coalesce(jsonb_agg(jsonb_build_object('tx',tx,'assigned',assigned)),'[]') into v_candidates from (
     select value as tx,false as assigned from netunim_internal.credit_unassigned_rows(n) value
     union all select tx,true from netunim_internal.credit_month_rows(n)
   ) rows;
   v_consumed:=array[]::bigint[];v_remaining:='[]';
   -- Reserve every unchanged occurrence before considering source transitions.
   for r in select netunim_internal.credit_financial_key(value) as key,count(*) as needed,(jsonb_agg(value)->0) as tx
     from netunim_internal.credit_unassigned_rows(a) value group by 1 loop
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
commit;
