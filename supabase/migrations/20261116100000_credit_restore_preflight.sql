begin;
set local lock_timeout='2s';
set local statement_timeout='60s';
create function netunim_internal.credit_restore_valid_day(value text) returns boolean
language plpgsql immutable set search_path=pg_catalog as $f$
begin
 if value is null or left(value,10)!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return false;end if;
 return to_char(make_date(left(value,4)::integer,substring(value,6,2)::integer,substring(value,9,2)::integer),'YYYY-MM-DD')=left(value,10);
exception when datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then return false;
end $f$;

-- Content validity is separate from the historical-loss policy. An authorized
-- restore may replace history, but cannot revive an ambiguous/double-billed state.
create function netunim_internal.require_credit_restore_integrity(sync jsonb) returns void
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
      if coalesce(t->>replace(field,'Amount','Currency'),'')!~'^[A-Z]{3}$' then raise exception 'finance_credit_invalid_version: invalid_currency' using errcode='23514';end if;
     end if;
    end loop;
    foreach field in array array['date','processedDate'] loop
     if coalesce(t->>field,'')<>'' and not netunim_internal.credit_restore_valid_day(t->>field) then raise exception 'finance_credit_invalid_version: invalid_date' using errcode='23514';end if;
    end loop;
    if t ? 'status' and coalesce(t->>'status','') not in ('completed','pending') then raise exception 'finance_credit_invalid_version: invalid_status' using errcode='23514';end if;
    if t->'installments' is not null and t->'installments'<>'null'::jsonb then
     if jsonb_typeof(t->'installments') is distinct from 'object' or coalesce(t#>>'{installments,number}','')!~'^[1-9][0-9]*$'
       or coalesce(t#>>'{installments,total}','')!~'^[1-9][0-9]*$' then raise exception 'finance_credit_invalid_version: invalid_installments' using errcode='23514';end if;
     if (t#>>'{installments,number}')::numeric>(t#>>'{installments,total}')::numeric or (t#>>'{installments,total}')::numeric>9007199254740991 then raise exception 'finance_credit_invalid_version: invalid_installments' using errcode='23514';end if;
    end if;
   end loop;
   if exists(select 1 from jsonb_array_elements(rows) tx where coalesce(tx->>'id','')<>''
     group by coalesce(tx->>'status','completed')='pending',tx->>'id',left(coalesce(tx->>'processedDate',''),10),coalesce(tx#>>'{installments,number}','1') having count(*)>1) then
    raise exception 'finance_credit_invalid_version: ambiguous_billing_identity' using errcode='23514';end if;
   if exists(select 1 from netunim_internal.credit_unassigned_rows(a) source cross join lateral netunim_internal.credit_month_rows(a) assigned
      where netunim_internal.credit_source_matches(source,assigned.tx)) then
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
revoke all on function netunim_internal.credit_restore_valid_day(text) from public,anon,authenticated;
revoke all on function netunim_internal.require_credit_restore_integrity(jsonb) from public,anon,authenticated;

create or replace function netunim_internal.apply_finance_credit_correction(p_document_name text,p_credit_sync jsonb,p_expected_revision bigint,
 p_operation_id text,p_reason text,p_lease_token text,p_fence_epoch bigint,p_request_hash text)
returns table(revision bigint,updated_at timestamptz,state jsonb,operation_replayed boolean,operation_revision bigint)
language plpgsql security definer set search_path=pg_catalog,public,netunim_internal as $f$
declare v_current jsonb;v_revision bigint;v_request_hash text;v_receipt record;v_saved record;
begin
 perform netunim_internal.require_financial_mfa_v1();
 perform netunim_internal.assert_storage_writer_operation_fence_v2('finance-document-save','credit',p_lease_token,p_fence_epoch);
 if length(btrim(coalesce(p_reason,'')))<8 or length(p_reason)>500 then
   raise exception 'finance_restore_reason_required' using errcode='22023';end if;
 select d.state,d.revision into v_current,v_revision from public.finance_sync_documents d
 where d.owner_id=auth.uid() and d.document_name=p_document_name for update;
 v_request_hash:=p_request_hash;
 select * into v_receipt from netunim_internal.finance_credit_restore_requests r
 where r.owner_id=auth.uid() and r.document_name=p_document_name and r.operation_id=p_operation_id;
 if found then
   if v_receipt.request_hash<>v_request_hash then raise exception 'finance_restore_operation_reused' using errcode='23514';end if;
   return query select d.revision,d.updated_at,d.state,true,v_receipt.applied_revision from public.finance_sync_documents d
     where d.owner_id=auth.uid() and d.document_name=p_document_name;
   return;
 end if;
 if v_revision is distinct from p_expected_revision then raise exception 'finance_restore_revision_conflict' using errcode='40001';end if;
 perform netunim_internal.require_credit_restore_integrity(p_credit_sync);
 insert into netunim_internal.finance_credit_restore_context values(pg_backend_pid(),txid_current(),auth.uid(),'credit-restore: '||p_reason);
 perform netunim_internal.enter_storage_writer_operation_v2('finance-document-save');
 select * into v_saved from netunim_internal.fenced_impl_save_finance_sync_document_v5(p_document_name,p_expected_revision,
   jsonb_set(v_current,'{creditSync}',p_credit_sync),p_operation_id,
   jsonb_build_object('source','credit-correction','reason',p_reason,'hash',v_request_hash));
 insert into netunim_internal.finance_credit_restore_requests values(auth.uid(),p_document_name,p_operation_id,v_request_hash,v_saved.operation_revision);
 return query select v_saved.revision,v_saved.updated_at,v_saved.state,v_saved.operation_replayed,v_saved.operation_revision;
 perform netunim_internal.leave_storage_writer_operation_v2('finance-document-save');
 delete from netunim_internal.finance_credit_restore_context where backend_pid=pg_backend_pid() and transaction_id=txid_current() and owner_id=auth.uid();
end $f$;


commit;
