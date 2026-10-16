-- Current write boundaries validate nested financial evidence before any DML.
-- No historical row is rewritten and no deployed migration is edited.
begin;

create function netunim_internal.bank_business_fields_valid(p_value jsonb,p_text text[],p_booleans text[])
returns boolean language sql immutable set search_path = pg_catalog as $function$
  select jsonb_typeof(p_value)='object'
    and not exists(select 1 from unnest(p_text) f where p_value ? f and jsonb_typeof(p_value->f) is distinct from 'string')
    and not exists(select 1 from unnest(p_booleans) f where p_value ? f and jsonb_typeof(p_value->f) is distinct from 'boolean')
$function$;

create function netunim_internal.bank_business_integer_valid(p_value jsonb)
returns boolean language sql immutable set search_path = pg_catalog as $function$
  select case when jsonb_typeof(p_value)='number' then
    (p_value#>>'{}')::numeric between 0 and 9007199254740991
    and trunc((p_value#>>'{}')::numeric)=(p_value#>>'{}')::numeric
  else false end
$function$;

create function netunim_internal.bank_business_positive_money_valid(p_value jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog as $function$
declare amount double precision;
begin
  if jsonb_typeof(p_value) not in ('number','string') or p_value is null
    or jsonb_typeof(p_value)='string' and (p_value#>>'{}') !~ '^-?[0-9]+([.][0-9]+)?$' then return false; end if;
  amount := (p_value#>>'{}')::double precision;
  return amount>0 and amount<'Infinity'::double precision;
exception when numeric_value_out_of_range or invalid_text_representation then return false;
end
$function$;

-- Match ECMAScript trim for identifier evidence, including tabs and Unicode spaces.
create function netunim_internal.bank_business_text_valid(p_value jsonb)
returns boolean language sql immutable set search_path = pg_catalog as $function$
  select coalesce(jsonb_typeof(p_value)='string' and (p_value#>>'{}') !~
    U&'^[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]*$',false)
$function$;

create function netunim_internal.assert_bank_transaction_evidence(p_transactions jsonb)
returns void language plpgsql set search_path = pg_catalog,netunim_internal as $function$
declare tx jsonb; detail jsonb; item jsonb; field text;
begin
  perform netunim_internal.assert_bank_transaction_statuses(p_transactions);
  for tx in select value from jsonb_array_elements(p_transactions) loop
    detail := tx->'checkDetails';
    if detail is not null and detail<>'null'::jsonb then
      if not bank_business_fields_valid(detail,array['kind','warning'],array['hasDocumentReference'])
        or detail ? 'kind' and detail->>'kind' not in ('','deposit','returned','returned_credit') then
        raise exception 'invalid_bank_business_evidence' using errcode='22023';
      end if;
      if detail->'checkCount' is not null and detail->'checkCount'<>'null'::jsonb then
        if not bank_business_integer_valid(detail->'checkCount') then
          raise exception 'invalid_bank_business_evidence' using errcode='22023';
        elsif (detail->>'checkCount')::numeric=0 then
          raise exception 'invalid_bank_business_evidence' using errcode='22023';
        end if;
      end if;
      if detail ? 'checkNumbers' then
        if jsonb_typeof(detail->'checkNumbers') is distinct from 'array' then
          raise exception 'invalid_bank_business_evidence' using errcode='22023';
        end if;
        if jsonb_array_length(detail->'checkNumbers')>50 or exists(select 1 from jsonb_array_elements(detail->'checkNumbers') x
          where not bank_business_text_valid(x))
          or (select count(*)<>count(distinct x) from jsonb_array_elements(detail->'checkNumbers') x) then
          raise exception 'invalid_bank_business_evidence' using errcode='22023';
        end if;
      end if;
      if detail ? 'checkItems' then
        if jsonb_typeof(detail->'checkItems') is distinct from 'array' then
          raise exception 'invalid_bank_business_evidence' using errcode='22023';
        end if;
        if jsonb_array_length(detail->'checkItems')>50 then
          raise exception 'invalid_bank_business_evidence' using errcode='22023';
        end if;
        for item in select value from jsonb_array_elements(detail->'checkItems') loop
          if not bank_business_fields_valid(item,array['bankNumber','branchNumber','accountNumber','checkNumber','imageFrontKey','imageBackKey'],array['hasDocumentReference'])
            or not bank_business_positive_money_valid(item->'amount')
            or not (bank_business_text_valid(item->'checkNumber') or
              bank_business_text_valid(item->'bankNumber') and bank_business_text_valid(item->'branchNumber') and bank_business_text_valid(item->'accountNumber')) then
            raise exception 'invalid_bank_business_evidence' using errcode='22023';
          end if;
          foreach field in array array['imageFrontKey','imageBackKey'] loop
            if item ? field and item->>field<>'' and item->>field !~ '^[a-f0-9]{64}$' then
              raise exception 'invalid_bank_business_evidence' using errcode='22023';
            end if;
          end loop;
        end loop;
      end if;
    end if;
    detail := tx->'creditSettlementDetails';
    if detail is not null and detail<>'null'::jsonb then
      if not bank_business_fields_valid(detail,array['provider','providerLabel','issuerReference','permissionReference','cardIdentitySource','warning'],array['detailFetched'])
        or coalesce(detail->>'provider','') not in ('visaCal','max','isracard','amex')
        or detail ? 'cardIdentitySource' and detail->>'cardIdentitySource' not in ('','bank_detail_explicit') then
        raise exception 'invalid_bank_business_evidence' using errcode='22023';
      end if;
      foreach field in array array['bankActivityTypeCode','bankTextCode'] loop
        if detail->field is not null and detail->field<>'null'::jsonb and not bank_business_integer_valid(detail->field) then
          raise exception 'invalid_bank_business_evidence' using errcode='22023';
        end if;
      end loop;
      if detail ? 'cardLast4s' then
        if jsonb_typeof(detail->'cardLast4s') is distinct from 'array' then
          raise exception 'invalid_bank_business_evidence' using errcode='22023';
        end if;
        if jsonb_array_length(detail->'cardLast4s')>20 or exists(select 1 from jsonb_array_elements(detail->'cardLast4s') x
          where jsonb_typeof(x) is distinct from 'string' or x#>>'{}' !~ '^[0-9]{4}$')
          or (select count(*)<>count(distinct x) from jsonb_array_elements(detail->'cardLast4s') x)
          or jsonb_array_length(detail->'cardLast4s')>0 and detail->>'cardIdentitySource' is distinct from 'bank_detail_explicit' then
          raise exception 'invalid_bank_business_evidence' using errcode='22023';
        end if;
      end if;
    end if;
  end loop;
end
$function$;

revoke all on function netunim_internal.bank_business_fields_valid(jsonb,text[],text[]),
  netunim_internal.bank_business_integer_valid(jsonb),netunim_internal.bank_business_positive_money_valid(jsonb),
  netunim_internal.bank_business_text_valid(jsonb),
  netunim_internal.assert_bank_transaction_evidence(jsonb) from public,anon,authenticated;

-- The lease/operation fence remains first; validate the entire batch before entering DML.
create or replace function public.merge_bank_transactions_v6(
  p_account_key text,p_account_role text,p_transactions jsonb,
  p_lease_name text default null,p_lease_token text default null,p_fence_epoch bigint default null)
returns table(inserted_count integer,updated_count integer,total_count integer)
language plpgsql security definer
set search_path to 'pg_catalog', 'public', 'netunim_internal'
as $function$
begin
  perform netunim_internal.assert_storage_writer_operation_fence_v2('bank-merge',p_lease_name,p_lease_token,p_fence_epoch);
  perform netunim_internal.assert_bank_transaction_evidence(p_transactions);
  perform netunim_internal.enter_storage_writer_operation_v2('bank-merge');
  return query select * from netunim_internal.fenced_impl_merge_bank_transactions(p_account_key,p_account_role,p_transactions);
  perform netunim_internal.leave_storage_writer_operation_v2('bank-merge');
end
$function$;

create or replace function public.sync_bank_transactions_snapshot_v6(
  p_account_key text,p_account_role text,p_transactions jsonb,p_snapshot_at timestamptz,
  p_coverage_from date,p_coverage_to date,p_complete boolean,
  p_lease_name text default null,p_lease_token text default null,p_fence_epoch bigint default null)
returns table(inserted_count integer,updated_count integer,total_count integer,
  missing_count integer,active_missing_count integer,snapshot_stored boolean,baseline_created boolean)
language plpgsql security definer
set search_path to 'pg_catalog', 'public', 'netunim_internal'
as $function$
begin
  perform netunim_internal.assert_storage_writer_operation_fence_v2('bank-archive-snapshot',p_lease_name,p_lease_token,p_fence_epoch);
  perform netunim_internal.assert_bank_transaction_evidence(p_transactions);
  perform netunim_internal.enter_storage_writer_operation_v2('bank-archive-snapshot');
  return query select * from netunim_internal.fenced_impl_sync_bank_transactions_snapshot(
    p_account_key,p_account_role,p_transactions,p_snapshot_at,p_coverage_from,p_coverage_to,p_complete);
  perform netunim_internal.leave_storage_writer_operation_v2('bank-archive-snapshot');
end
$function$;
commit;
