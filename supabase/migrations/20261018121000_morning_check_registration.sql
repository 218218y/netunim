-- Durable intents are opt-in for NEW operations; historical documents are never imported.
begin;
alter table public.morning_document_operations
  add column check_intent jsonb,
  add column checks_registered_at timestamptz,
  add column checks_registration_error text;
alter table public.morning_document_operations add constraint morning_check_intent_array
  check (check_intent is null or (jsonb_typeof(check_intent)='array' and jsonb_array_length(check_intent)<=12));
create index morning_checks_pending on public.morning_document_operations(updated_at)
  where check_intent is not null and checks_registered_at is null and state='created' and verified_at is not null;

create table netunim_internal.morning_check_registrations (
  owner_id uuid not null,
  environment text not null,
  document_id text not null,
  payment_index integer not null,
  operation_id uuid not null references public.morning_document_operations(operation_id),
  check_id text not null,
  source jsonb not null,
  primary key(owner_id,environment,document_id,payment_index),
  unique(owner_id,check_id)
);
alter table netunim_internal.morning_check_registrations enable row level security;
revoke all on netunim_internal.morning_check_registrations from public,anon,authenticated,service_role;

create function netunim_internal.freeze_morning_check_intent()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin
  if tg_op='UPDATE' and new.check_intent is distinct from old.check_intent then
    raise exception 'morning_check_intent_immutable' using errcode='22023';
  end if;
  if tg_op='INSERT' and new.check_intent is not null and
    (new.state<>'reserved' or new.document_type not in (320,400)) then
    raise exception 'invalid_morning_check_intent' using errcode='22023';
  end if;
  return new;
end $$;
create trigger morning_check_intent_frozen before insert or update on public.morning_document_operations
  for each row execute function netunim_internal.freeze_morning_check_intent();

create function netunim_internal.register_morning_checks(p_operation uuid)
returns integer language plpgsql security definer set search_path=pg_catalog,public as $$
declare op public.morning_document_operations; doc public.shared_checks_documents;
  payment jsonb; rows jsonb; c jsonb; source jsonb; review_ids jsonb; check_id text; n integer:=0;
  prior_identity text:=current_setting('request.jwt.claim.sub',true);
begin
  select * into op from public.morning_document_operations where operation_id=p_operation for update;
  if not found or op.state<>'created' or op.verified_at is null or op.document_id is null
    or op.check_intent is null or op.checks_registered_at is not null then return 0; end if;
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
    perform public.save_shared_checks_document_v6('main',coalesce(doc.revision,0),jsonb_build_object('version',1,'checks',rows,'bankEvents',coalesce(doc.state->'bankEvents','[]')),
      'morning-checks:'||op.operation_id::text,'[]',jsonb_build_object('site','orders','mutationType','morning-check-import','checkAmountPrecision',2));
  end if;
  update public.morning_document_operations set checks_registered_at=clock_timestamp(),checks_registration_error=null where operation_id=p_operation;
  perform set_config('request.jwt.claim.sub',coalesce(prior_identity,''),true);
  return n;
end $$;

create function netunim_internal.complete_morning_checks()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.state='created' and new.verified_at is not null and new.check_intent is not null and new.checks_registered_at is null then
    begin
      perform netunim_internal.register_morning_checks(new.operation_id);
    exception when others then
      -- The document remains verified even if its independent follow-up needs retry.
      update public.morning_document_operations set checks_registration_error=left(sqlerrm,500),updated_at=clock_timestamp() where operation_id=new.operation_id;
    end;
  end if;
  return new;
end $$;
create trigger morning_complete_checks after insert or update of state,verified_at on public.morning_document_operations
  for each row execute function netunim_internal.complete_morning_checks();

-- Persist the source through edits by either application, and prevent client forgery.
create function netunim_internal.protect_morning_check_source()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare c jsonb; oldc jsonb; source jsonb; rows jsonb:='[]'; old_checks jsonb; sources jsonb;
begin
  select coalesce(jsonb_object_agg(x->>'id',x),'{}') into old_checks
    from jsonb_array_elements(case when tg_op='UPDATE' then old.state->'checks' else '[]'::jsonb end) x;
  select coalesce(jsonb_object_agg(r.check_id,r.source),'{}') into sources
    from netunim_internal.morning_check_registrations r join jsonb_array_elements(new.state->'checks') x on r.check_id=x->>'id'
    where r.owner_id=new.owner_id;
  for c in select value from jsonb_array_elements(new.state->'checks') loop
    oldc:=old_checks->(c->>'id');
    if oldc is not null and (oldc->>'amount')::numeric<>trunc((oldc->>'amount')::numeric)
      and c->'amount' is distinct from oldc->'amount'
      and (coalesce(current_setting('app.check_amount_precision',true),'')<>'2'
        or (coalesce(current_setting('app.destructive_operation_kind',true),'')<>'restore'
          and (coalesce(c->>'amountEditId','')=''
            or c->>'amountEditId' is not distinct from oldc->>'amountEditId')))
      and coalesce(current_setting('app.check_bank_reconcile',true),'')<>'1' then
      raise exception 'check_precision_upgrade_required' using errcode='PT426',hint='Refresh the application before editing checks with cents';
    end if;
    source:=sources->(c->>'id');
    c:=c-'morningSource';
    if source is not null then c:=c||jsonb_build_object('morningSource',source); end if;
    rows:=rows||jsonb_build_array(c);
  end loop;
  new.state:=jsonb_set(new.state,'{checks}',rows);return new;
end $$;
create trigger shared_checks_morning_source before insert or update on public.shared_checks_documents
  for each row execute function netunim_internal.protect_morning_check_source();

create function netunim_internal.retry_morning_check_registrations()
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare op record;
begin
  for op in select m.operation_id from public.morning_document_operations m where m.state='created' and m.verified_at is not null
    and m.check_intent is not null and m.checks_registered_at is null
    and exists(select 1 from auth.users u where u.id=m.owner_id) order by m.updated_at limit 50
  loop
    begin perform netunim_internal.register_morning_checks(op.operation_id);
    exception when others then
      update public.morning_document_operations set checks_registration_error=left(sqlerrm,500),updated_at=clock_timestamp() where operation_id=op.operation_id;
    end;
  end loop;
end $$;
select cron.schedule('morning-check-registration','* * * * *','select netunim_internal.retry_morning_check_registrations()');
revoke all on function netunim_internal.freeze_morning_check_intent(),netunim_internal.register_morning_checks(uuid),
  netunim_internal.complete_morning_checks(),netunim_internal.protect_morning_check_source(),netunim_internal.retry_morning_check_registrations()
  from public,anon,authenticated,service_role;
create or replace function netunim_internal.save_shared_checks_document_current(
  p_document_name text,p_expected_revision bigint,p_state jsonb,p_operation_id text,p_deleted_check_ids jsonb,p_audit jsonb)
returns table(revision bigint,updated_at timestamptz,state jsonb,operation_replayed boolean,operation_revision bigint)
language plpgsql
set search_path to 'pg_catalog', 'public', 'netunim_internal'
as $function$
declare v_owner uuid:=auth.uid();v_before jsonb;v_result record;v_paths text[]:=array['checks'];v_prior_precision text:=current_setting('app.check_amount_precision',true);
begin
  if v_owner is null then raise exception 'not_authenticated' using errcode='42501';end if;
  if jsonb_typeof(p_state->'bankEvents') is distinct from 'array' then p_state:=p_state||jsonb_build_object('bankEvents','[]'::jsonb);end if;
  perform netunim_internal.assert_document_invariants('shared-checks',p_state);
  select d.state into v_before from public.shared_checks_documents d where d.owner_id=v_owner and d.document_name=p_document_name;
  perform set_config('app.check_amount_precision',coalesce(p_audit->>'checkAmountPrecision',''),true);
  select * into v_result from netunim_internal.save_shared_checks_document_core(p_document_name,p_expected_revision,p_state,p_operation_id,p_deleted_check_ids);
  perform set_config('app.check_amount_precision',coalesce(v_prior_precision,''),true);
  perform netunim_internal.record_operation_audit(v_owner,'shared-checks',p_document_name,p_operation_id,coalesce(p_audit,'{}'::jsonb)||jsonb_build_object('baseRevision',p_expected_revision),coalesce(v_before,p_state),v_result.state,v_paths,null);
  return query select v_result.revision,v_result.updated_at,v_result.state,v_result.operation_replayed,v_result.operation_revision;
end
$function$;
commit;
