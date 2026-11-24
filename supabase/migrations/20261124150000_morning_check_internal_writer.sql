-- Repair the server-only Morning continuation after financial MFA was enabled.
-- Do not change the public MFA guard or synthesize JWT assurance.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

insert into netunim_internal.storage_writer_operations(operation,entrypoint)
  values('morning-check-import','netunim_internal.register_morning_checks');
insert into netunim_internal.storage_writer_operation_domains(operation,domain,ordinal)
  values('morning-check-import','shared-checks',1);

create or replace function netunim_internal.register_morning_checks(p_operation uuid)
returns integer language plpgsql security definer set search_path=pg_catalog,public as $$
declare op public.morning_document_operations; doc public.shared_checks_documents;
  payment jsonb; rows jsonb; c jsonb; source jsonb; review_ids jsonb; check_id text; n integer:=0;
  prior_identity text:=current_setting('request.jwt.claim.sub',true);
begin
  select * into op from public.morning_document_operations where operation_id=p_operation for update;
  if not found or op.state<>'created' or op.verified_at is null or op.document_id is null
    or op.check_intent is null or op.checks_registered_at is not null or op.check_payment_evidence is distinct from 'matched' then return 0; end if;
  if not exists(select 1 from auth.users u where u.id=op.owner_id) then return 0; end if;
  -- No browser state or third-party payload can choose the owner of this write.
  perform set_config('request.jwt.claim.sub',op.owner_id::text,true);
  if not pg_try_advisory_xact_lock(hashtextextended('netunim_financial_write:'||op.owner_id::text,0)) then
    raise exception 'save_busy' using errcode='PT429';
  end if;
  select * into doc from public.shared_checks_documents where owner_id=op.owner_id and document_name='main' for update;
  rows:=coalesce(doc.state->'checks','[]');
  for payment in select value from jsonb_array_elements(op.check_intent) loop
    if netunim_internal.check_bank_money(payment->>'amount') is null
      or netunim_internal.check_bank_money(payment->>'amount')<=0
      or netunim_internal.check_bank_date(payment->>'dueDate') is null
      or coalesce(payment->>'checkNumber','')='' or coalesce(payment->>'name','')=''
      or coalesce(payment->>'paymentIndex','') !~ '^[0-9]+$' then
      raise exception 'invalid_morning_check_intent';
    end if;
    if exists(select 1 from netunim_internal.morning_check_registrations r where r.owner_id=op.owner_id
      and r.environment=op.environment and r.document_id=op.document_id and r.payment_index=(payment->>'paymentIndex')::int) then continue; end if;
    check_id:='MORNING:'||op.environment||':'||op.document_id||':'||(payment->>'paymentIndex');
    -- Ordinary manual rows lack verified drawer identity. Never merge on cheque number alone.
    select coalesce(jsonb_agg(x->>'id'),'[]') into review_ids from jsonb_array_elements(rows) x
      where not (x ? 'morningSource') and coalesce(x->>'account','עסקי')='עסקי'
        and netunim_internal.check_bank_number(x->>'checkNumber')=netunim_internal.check_bank_number(payment->>'checkNumber')
        and netunim_internal.check_bank_money(x->>'amount')=netunim_internal.check_bank_money(payment->>'amount')
        and x->>'dueDate'=payment->>'dueDate';
    source:=jsonb_build_object('environment',op.environment,'documentId',op.document_id,'documentNumber',op.document_number,
      'documentType',op.document_type,'operationId',op.operation_id,'paymentIndex',payment->'paymentIndex',
      'bankTransactionId',case when payment->>'bankSourceKey' like 'check:%' then op.source_bank_transaction_id end,
      'bankSourceKey',payment->>'bankSourceKey','reviewCheckIds',review_ids);
    insert into netunim_internal.morning_check_registrations values(op.owner_id,op.environment,op.document_id,
      (payment->>'paymentIndex')::int,op.operation_id,check_id,source);
    c:=(payment-'paymentIndex')||jsonb_build_object('id',check_id,'account','עסקי','status','בקופה',
      'createdAt',(op.verified_at at time zone 'Asia/Jerusalem')::date,'morningSource',source,
      'note','','depositDate',null,'depositedAt',null,'depositSeq',null,'clearedDate',null);
    rows:=rows||jsonb_build_array(c); n:=n+1;
  end loop;
  if n>0 then
    -- This is a server-owned continuation of a verified, immutable intent,
    -- not a client financial write. Keep the same V2 fence, revision, audit,
    -- validation and idempotency without inventing an AAL2 JWT.
    perform netunim_internal.enter_storage_writer_operation_v2('morning-check-import');
    perform netunim_internal.save_shared_checks_document_current('main',coalesce(doc.revision,0),jsonb_build_object('version',1,'checks',rows,'bankEvents',coalesce(doc.state->'bankEvents','[]')),
      'morning-checks:'||op.operation_id::text,'[]',jsonb_build_object('site','orders','mutationType','morning-check-import','checkAmountPrecision',2));
    perform netunim_internal.leave_storage_writer_operation_v2('morning-check-import');
  end if;
  update public.morning_document_operations set checks_registered_at=clock_timestamp(),checks_registration_error=null,checks_registration_next_retry_at=null where operation_id=p_operation;
  perform set_config('request.jwt.claim.sub',coalesce(prior_identity,''),true);
  return n;
end $$;

-- CREATE OR REPLACE preserves existing ACLs; assert the private contract again.
revoke all on function netunim_internal.register_morning_checks(uuid)
  from public,anon,authenticated,service_role;
commit;
