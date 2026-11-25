begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.morning_document_operations
  add column orders_debt_recovery_decision jsonb,
  add column orders_debt_recovery_proof jsonb,
  add constraint morning_orders_business_proof_requires_receipt check (
    orders_debt_recovery_proof is null or orders_debt_recovery_completed_at is not null);

-- Match shared/customer-debt-progress.js, including removal of a reset.
create function netunim_internal.morning_debt_money(p_value text)
returns numeric language sql immutable set search_path=pg_catalog as $$
  select case when p_value ~ '^[-+]?[0-9]{1,16}(\.[0-9]{1,16})?$'
    then floor(p_value::numeric*100+0.5)/100 else 0 end
$$;

create function netunim_internal.morning_debt_items(p_value jsonb)
returns setof jsonb language sql immutable set search_path=pg_catalog as $$
  select jsonb_array_elements(case when jsonb_typeof(p_value)='array' then p_value else '[]'::jsonb end)
$$;

create function netunim_internal.morning_debt_progress(p_debt jsonb, p_excluded text[] default '{}')
returns table(entry jsonb, active boolean)
language sql immutable set search_path=pg_catalog as $$
  with items as (
    select j from netunim_internal.morning_debt_items(p_debt->'debtProgress') j
    where j->>'id' <> all(p_excluded)
  ), visible as (
    select i.j from items i where i.j->'removesEntry' is distinct from 'true'::jsonb
      and not exists(select 1 from items r where r.j->>'kind'=i.j->>'kind'
        and r.j->>'action'='reset' and r.j->'removesEntry'='true'::jsonb and r.j->'clears'->>0=i.j->>'id')
  )
  select i.j, coalesce(i.j->>'action','add')<>'reset'
    and i.j in (select v.j from visible v)
    and not exists(select 1 from visible v where v.j->>'kind'=i.j->>'kind'
      and v.j->>'action'='reset' and v.j->'clears' ? (i.j->>'id'))
    and netunim_internal.morning_debt_money(i.j->>'amount')>0
  from items i
$$;

create function netunim_internal.morning_debt_snapshot(p_debt jsonb, p_operation uuid default null)
returns jsonb language sql immutable set search_path=pg_catalog as $$
  with debt as (select netunim_internal.morning_debt_money(p_debt->>'amount') as amount,
    coalesce(p_debt->'paid'='true'::jsonb,false) as paid,
    coalesce(p_debt->'invoiceIssued'='true'::jsonb,false) as invoiced),
  sums as (
    select coalesce(sum(netunim_internal.morning_debt_money(entry->>'amount')) filter (where entry->>'kind'='payment'),0) payment,
      coalesce(sum(netunim_internal.morning_debt_money(entry->>'amount')) filter (where entry->>'kind'='invoice'),0) invoice
    from netunim_internal.morning_debt_progress(p_debt,case when p_operation is null then '{}'::text[]
      else array['MORNING:'||p_operation||':payment','MORNING:'||p_operation||':invoice'] end) where active
  )
  select jsonb_build_object('amount',amount,
    'paymentApplied',case when paid then abs(amount) else least(abs(amount),payment) end,
    'invoiceApplied',case when invoiced then abs(amount) else least(abs(amount),invoice) end,
    'paymentComplete',paid or (abs(amount)>0 and payment>=abs(amount)),
    'invoiceComplete',invoiced or (abs(amount)>0 and invoice>=abs(amount)))
  from debt cross join sums
$$;

create function netunim_internal.morning_debt_plan(p_m public.morning_document_operations, p_debt jsonb)
returns jsonb language sql stable set search_path=pg_catalog as $$
  with input as (
    select netunim_internal.morning_debt_snapshot(p_debt,p_m.operation_id) s,
      coalesce(p_m.orders_debt_recovery_decision,p_m.orders_debt_recovery) choice
  ), kinds(kind,eligible,selection,applied) as (
    values ('payment',p_m.document_type in (320,400),'applyPayment','paymentApplied'),
           ('invoice',p_m.document_type in (305,320),'applyInvoice','invoiceApplied')
  ), allocations as (
    select kind,eligible,choice->selection='true'::jsonb as selected,
      (s->>'amount')::numeric as debt_amount, greatest(0,(s->>'amount')::numeric-(s->>applied)::numeric) as remaining
    from input cross join kinds where (choice->'financialSnapshot')=s
  )
  select jsonb_object_agg(kind,jsonb_build_object('amount',case when eligible and selected
    then least(p_m.amount,remaining) else 0 end,
    'outcome',case when not eligible then 'not_applicable' when not selected then 'declined'
      when debt_amount<=0 then 'ineligible_debt' when remaining=0 then 'no_balance'
      when p_m.amount<remaining then 'partial' else 'applied' end)) from allocations
$$;

create or replace function netunim_internal.confirm_morning_orders_debt_recovery()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_operation public.morning_document_operations%rowtype;
  v_debt jsonb;
  v_plan jsonb;
  v_entries text[];
begin
  if new.document_name<>'suppliers' or jsonb_typeof(new.state->'customerDebts') is distinct from 'array' then
    return new;
  end if;
  if (tg_op='INSERT' or new.state->'customerDebts' is distinct from old.state->'customerDebts') and exists(
    with previous as (
      select d->>'id' as debt_id,p from netunim_internal.morning_debt_items(
        case when tg_op='UPDATE' then old.state->'customerDebts' end) d
      cross join lateral netunim_internal.morning_debt_items(d->'debtProgress') p
      where p->>'id' like 'MORNING:%'
    ), added as (
      select d->>'id' as debt_id,p,
        substring(p->>'id' from '^MORNING:([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}):')::uuid as operation_id
      from jsonb_array_elements(new.state->'customerDebts') d
      cross join lateral netunim_internal.morning_debt_items(d->'debtProgress') p
      where p->>'id' like 'MORNING:%'
    )
    select 1 from added a join public.morning_document_operations m
      on m.operation_id=a.operation_id and m.owner_id=new.owner_id and m.orders_debt_recovery_proof is not null
    where not exists(select 1 from previous b where b.debt_id=a.debt_id and b.p-'createdAt'=a.p-'createdAt')
  ) then
    raise exception 'morning_debt_allocation_already_final' using errcode='PT409';
  end if;
  for v_operation in select m.* from public.morning_document_operations m
    where m.owner_id=new.owner_id and m.state='created' and m.verified_at is not null
      and m.orders_debt_recovery is not null
  loop
    select d into v_debt from jsonb_array_elements(new.state->'customerDebts') d
      where d->>'id'=v_operation.orders_debt_recovery->>'debtId';
    if not found then continue; end if;
    v_entries:=array['MORNING:'||v_operation.operation_id||':payment','MORNING:'||v_operation.operation_id||':invoice'];
    v_plan:=netunim_internal.morning_debt_plan(v_operation,v_debt);
    if v_plan is not null
      and exists(select 1 from netunim_internal.morning_debt_items(v_debt->'morningDocuments') l
        where l->>'operationId'=v_operation.operation_id::text and l->>'documentId'=v_operation.document_id
          and l->>'documentType'=v_operation.document_type::text
          and l->>'documentNumber'=coalesce(v_operation.document_number,''))
      and not exists(
        select 1 from jsonb_each(v_plan) expected(kind, result)
        left join netunim_internal.morning_debt_progress(v_debt) p
          on p.entry->>'id'='MORNING:'||v_operation.operation_id||':'||expected.kind
        where case when (result->>'amount')::numeric=0 then p.entry is not null
          else not coalesce(p.active and p.entry->>'kind'=expected.kind and p.entry->>'action'='add'
            and p.entry->>'source'='morning' and (p.entry->'amount')=result->'amount',false) end)
    then
      update public.morning_document_operations set
        orders_debt_recovery=null,orders_debt_recovery_completed_at=clock_timestamp(),
        orders_debt_recovery_revision=new.revision,
        orders_debt_recovery_proof=v_plan||jsonb_build_object('debtId',v_debt->>'id','decisionRevision',
          coalesce(v_operation.orders_debt_recovery_decision->'revision','0'::jsonb))
        where operation_id=v_operation.operation_id and orders_debt_recovery is not null;
    elsif exists(
      select 1 from netunim_internal.morning_debt_progress(v_debt) p where p.entry->>'id'=any(v_entries)
        and not exists(select 1 from netunim_internal.morning_debt_items(
            case when tg_op='UPDATE' then old.state->'customerDebts' end) d
          cross join lateral netunim_internal.morning_debt_progress(d) previous
          where d->>'id'=v_debt->>'id' and previous.entry=p.entry))
    then
      -- During rollout an older tab can still propose a whole V2 document.
      -- Reject stale new Morning allocations atomically, leaving the intent open.
      raise exception 'morning_debt_allocation_changed' using errcode='PT409';
    end if;
  end loop;
  return new;
end $$;

create function netunim_internal.resolve_morning_orders_debt_recovery(
  p_environment text,p_operation uuid,p_decision_revision bigint,p_review jsonb)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare
  v_owner uuid:=auth.uid();
  v_head public.order_management_documents%rowtype;
  v_operation public.morning_document_operations%rowtype;
  v_debt jsonb;
  v_index integer;
  v_snapshot jsonb;
  v_decision jsonb;
  v_revision bigint;
  v_plan jsonb;
  v_kind text;
  v_amount numeric;
  v_event_id text;
  v_progress jsonb;
  v_links jsonb;
  v_now timestamptz:=clock_timestamp();
  v_completed jsonb;
  v_updated boolean:=false;
begin
  -- All V2 writers take the domain gate before locking the Orders head.
  select * into v_head from public.order_management_documents
    where owner_id=v_owner and document_name='suppliers' for update;
  select * into v_operation from public.morning_document_operations
    where owner_id=v_owner and environment=p_environment and operation_id=p_operation
      and state='created' and verified_at is not null for update;
  if not found then return jsonb_build_object('state','unavailable'); end if;
  if v_operation.orders_debt_recovery_completed_at is not null then
    return jsonb_build_object('state',case when v_operation.orders_debt_recovery_proof is null then 'historical' else 'complete' end);
  end if;
  if v_operation.orders_debt_recovery is null then return jsonb_build_object('state','unavailable'); end if;
  select d.value,(d.ordinality-1)::integer into v_debt,v_index
    from netunim_internal.morning_debt_items(v_head.state->'customerDebts') with ordinality d(value,ordinality)
    where d.value->>'id'=v_operation.orders_debt_recovery->>'debtId';
  if not found then return jsonb_build_object('state','missing_debt'); end if;
  if v_debt ? 'debtProgress' and jsonb_typeof(v_debt->'debtProgress')<>'array' then
    return jsonb_build_object('state','conflicting_progress');
  end if;
  if v_debt ? 'morningDocuments' and jsonb_typeof(v_debt->'morningDocuments')<>'array' then
    return jsonb_build_object('state','conflicting_document');
  end if;
  v_snapshot:=netunim_internal.morning_debt_snapshot(v_debt,p_operation);
  v_decision:=v_operation.orders_debt_recovery_decision;
  v_revision:=coalesce((v_decision->>'revision')::bigint,0);
  if p_review is not null
    and (jsonb_typeof(p_review->'applyPayment')='boolean'
      and jsonb_typeof(p_review->'applyInvoice')='boolean'
      and p_review-'applyPayment'-'applyInvoice'-'financialSnapshot'='{}'::jsonb) is not true
  then raise exception 'invalid_orders_debt_review' using errcode='22023'; end if;
  if p_review is not null and p_review->'financialSnapshot'=v_snapshot
    and v_decision-'revision'-'confirmedAt'=p_review
  then return jsonb_build_object('state','approved','decision',v_decision); end if;
  if p_decision_revision is distinct from v_revision
    or (p_review is not null and p_review->'financialSnapshot' is distinct from v_snapshot)
  then return jsonb_build_object('state','decision_changed','decision',v_decision); end if;
  if p_review is not null then
    v_decision:=p_review||jsonb_build_object('revision',v_revision+1,'confirmedAt',v_now);
    update public.morning_document_operations set orders_debt_recovery_decision=v_decision
      where operation_id=p_operation;
    return jsonb_build_object('state','approved','decision',v_decision);
  end if;

  v_plan:=netunim_internal.morning_debt_plan(v_operation,v_debt);
  if v_plan is null then return jsonb_build_object('state','decision_required','decision',v_decision); end if;
  v_progress:=coalesce(v_debt->'debtProgress','[]'::jsonb);
  foreach v_kind in array array['payment','invoice'] loop
    v_amount:=(v_plan->v_kind->>'amount')::numeric;
    v_event_id:='MORNING:'||p_operation||':'||v_kind;
    if exists(select 1 from jsonb_array_elements(v_progress) e where e->>'id'=v_event_id) then
      if v_amount=0 or not exists(select 1 from netunim_internal.morning_debt_progress(v_debt) p where p.active
        and p.entry->>'id'=v_event_id and p.entry->>'source'='morning' and p.entry->>'kind'=v_kind
        and p.entry->>'action'='add' and p.entry->'amount'=v_plan->v_kind->'amount')
      then return jsonb_build_object('state','conflicting_progress'); end if;
    elsif v_amount>0 then
      v_progress:=v_progress||jsonb_build_array(jsonb_build_object('id',v_event_id,'kind',v_kind,
        'action','add','amount',v_amount,'source','morning','createdAt',v_operation.verified_at));
      v_updated:=true;
    end if;
  end loop;
  v_links:=coalesce(v_debt->'morningDocuments','[]'::jsonb);
  if exists(select 1 from jsonb_array_elements(v_links) l where l->>'operationId'=p_operation::text
    and (l->>'documentId' is distinct from v_operation.document_id
      or l->>'documentType' is distinct from v_operation.document_type::text))
  then return jsonb_build_object('state','conflicting_document'); end if;
  select coalesce(jsonb_agg(l),'[]'::jsonb) into v_links from jsonb_array_elements(v_links) l
    where l->>'operationId'<>p_operation::text;
  v_debt:=jsonb_set(v_debt,'{morningDocuments}',v_links||jsonb_build_array(jsonb_build_object(
    'operationId',p_operation,'documentId',v_operation.document_id,'documentNumber',coalesce(v_operation.document_number,''),
    'documentType',v_operation.document_type,'verifiedAt',v_operation.verified_at)));
  if v_updated then
    v_debt:=jsonb_set(v_debt,'{debtProgress}',v_progress);
    v_completed:=netunim_internal.morning_debt_snapshot(v_debt);
    v_debt:=v_debt||jsonb_build_object(
      'paidAt',case when v_completed->'paymentComplete'='true'
        then coalesce(case when v_snapshot->'paymentComplete'='true' then v_debt->>'paidAt' end,v_operation.verified_at::text) end,
      'invoiceIssuedAt',case when v_completed->'invoiceComplete'='true'
        then coalesce(case when v_snapshot->'invoiceComplete'='true' then v_debt->>'invoiceIssuedAt' end,v_operation.verified_at::text) end,
      'closedAt',case when v_completed->'paymentComplete'='true' and v_completed->'invoiceComplete'='true'
        then coalesce(case when v_snapshot->'paymentComplete'='true' and v_snapshot->'invoiceComplete'='true'
          then v_debt->>'closedAt' end,v_operation.verified_at::text) end,'updatedAt',v_now);
  end if;
  -- Even an unchanged link may predate its proof. The canonical writer
  -- advances the revision and the trigger verifies the preserved state.
  perform netunim_internal.save_order_management_document_current('suppliers',v_head.revision,
    jsonb_set(v_head.state,array['customerDebts',v_index::text],v_debt),'morning-debt:'||p_operation,'{}',
    jsonb_build_object('surface','orders.morning.customerDebt','domains',jsonb_build_array('customerDebts')));
  if not exists(select 1 from public.morning_document_operations
    where operation_id=p_operation and orders_debt_recovery_proof is not null)
  then raise exception 'morning_debt_proof_required' using errcode='PT409'; end if;
  return jsonb_build_object('state','complete');
end $$;

create function public.resolve_morning_orders_debt_recovery_v1(
  p_environment text,p_operation uuid,p_decision_revision bigint,p_review jsonb default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v_result jsonb;
begin
  perform netunim_internal.require_financial_mfa_v1();
  perform netunim_internal.enter_storage_writer_operation_v2('orders-save');
  v_result:=netunim_internal.resolve_morning_orders_debt_recovery(p_environment,p_operation,p_decision_revision,p_review);
  perform netunim_internal.leave_storage_writer_operation_v2('orders-save');
  return v_result;
end $$;

revoke all on function netunim_internal.morning_debt_money(text),netunim_internal.morning_debt_items(jsonb),
  netunim_internal.morning_debt_progress(jsonb,text[]),netunim_internal.morning_debt_snapshot(jsonb,uuid),
  netunim_internal.morning_debt_plan(public.morning_document_operations,jsonb),
  netunim_internal.resolve_morning_orders_debt_recovery(text,uuid,bigint,jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.resolve_morning_orders_debt_recovery_v1(text,uuid,bigint,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.resolve_morning_orders_debt_recovery_v1(text,uuid,bigint,jsonb) to authenticated;
commit;
