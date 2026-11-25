begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create function netunim_internal.morning_debt_unique_progress(p_debt jsonb)
returns boolean language sql immutable set search_path=pg_catalog as $$
  select not exists(
    select 1 from netunim_internal.morning_debt_items(p_debt->'debtProgress') p
    where p->>'id' is not null group by p->>'id' having count(*)>1)
$$;

-- Keep unrelated edits and repairs of old data possible. An existing bad
-- duplicate can remain in history, but it must not grow or prove a receipt.
create function netunim_internal.assert_morning_debt_progress_write(p_owner uuid,p_before jsonb,p_after jsonb)
returns void language plpgsql set search_path=pg_catalog as $$
declare v_duplicate boolean;v_wrong_debt boolean;v_already_complete boolean;v_noncanonical boolean;
begin
  with before_debts as materialized (
    select d->>'id' id,d->'debtProgress' progress from netunim_internal.morning_debt_items(p_before) d
  ), changed as materialized (
    select d->>'id' id,d->'debtProgress' progress,b.progress previous
    from netunim_internal.morning_debt_items(p_after) d left join before_debts b on b.id=d->>'id'
    where d->'debtProgress' is distinct from b.progress
  ), incoming as materialized (
    select d.id as debt_id,p->>'id' as entry_id,p-'createdAt' as entry
    from changed d cross join lateral netunim_internal.morning_debt_items(d.progress) p
    where p->>'id' is not null
  ), added as materialized (
    select * from incoming
    except all
    select d.id,p->>'id',p-'createdAt' from changed d
    cross join lateral netunim_internal.morning_debt_items(d.previous) p where p->>'id' is not null
  ), matched as materialized (
    select a.debt_id,a.entry_id,m.operation_id,m.orders_debt_recovery,m.orders_debt_recovery_proof
    from added a join public.morning_document_operations m
      on m.operation_id=substring(lower(a.entry_id) from '^morning:([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}):(payment|invoice)$')::uuid
      and m.owner_id=p_owner
    where m.orders_debt_recovery is not null or m.orders_debt_recovery_proof is not null
  )
  select exists(
    select 1 from incoming i join (select distinct debt_id,entry_id from added) a using(debt_id,entry_id)
    group by i.debt_id,i.entry_id having count(*)>1
  ),exists(
    select 1 from matched m
    where coalesce(m.orders_debt_recovery->>'debtId',m.orders_debt_recovery_proof->>'debtId',m.debt_id)<>m.debt_id
  ),exists(select 1 from matched m where m.orders_debt_recovery_proof is not null),
    exists(select 1 from matched m where m.entry_id<>'MORNING:'||m.operation_id::text||':'||lower(split_part(m.entry_id,':',3)))
  into v_duplicate,v_wrong_debt,v_already_complete,v_noncanonical;
  if v_duplicate then raise exception 'morning_debt_duplicate_progress' using errcode='PT409'; end if;
  if v_wrong_debt then raise exception 'morning_debt_wrong_target' using errcode='PT409'; end if;
  if v_already_complete then raise exception 'morning_debt_allocation_already_final' using errcode='PT409'; end if;
  if v_noncanonical then raise exception 'morning_debt_invalid_progress_id' using errcode='PT409'; end if;
end $$;

create or replace function netunim_internal.morning_debt_plan(p_m public.morning_document_operations, p_debt jsonb)
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
    from input cross join kinds where (choice->'financialSnapshot')=s and netunim_internal.morning_debt_unique_progress(p_debt)
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
  if tg_op='INSERT' or new.state->'customerDebts' is distinct from old.state->'customerDebts' then
    perform netunim_internal.assert_morning_debt_progress_write(
      new.owner_id,case when tg_op='UPDATE' then old.state->'customerDebts' end,new.state->'customerDebts');
  end if;
  for v_operation in select m.* from public.morning_document_operations m
    where m.owner_id=new.owner_id and m.state='created' and m.verified_at is not null
      and m.orders_debt_recovery is not null
  loop
    select d into v_debt from jsonb_array_elements(new.state->'customerDebts') d
      where d->>'id'=v_operation.orders_debt_recovery->>'debtId';
    if not found then continue; end if;
    v_entries:=array['MORNING:'||v_operation.operation_id||':payment','MORNING:'||v_operation.operation_id||':invoice'];
    v_plan:=null;
    if exists(select 1 from netunim_internal.morning_debt_items(v_debt->'morningDocuments') l
      where l->>'operationId'=v_operation.operation_id::text and l->>'documentId'=v_operation.document_id
        and l->>'documentType'=v_operation.document_type::text
        and l->>'documentNumber'=coalesce(v_operation.document_number,''))
    then v_plan:=netunim_internal.morning_debt_plan(v_operation,v_debt); end if;
    if v_plan is not null
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

create function public.list_morning_recovery_operations_v4(p_owner_id uuid,p_environment text,
  p_filter text,p_query text,p_after_priority int,p_after_created timestamptz,p_after_id uuid)
returns table(operation_id uuid,stage text,document_id text,document_number text,document_type integer,
  source_kind text,amount numeric,check_count integer,check_amount numeric,created_at timestamptz,
  verified_at timestamptz,first_failed_at timestamptz,last_attempt_at timestamptz,next_retry_at timestamptz,
  attempts integer,failure_kind text,error_code text,resolved_at timestamptz,priority integer,
  sort_at timestamptz,checks_registered_at timestamptz,bank_linked boolean,payment_evidence text,debt_state text,severity text)
language sql stable security invoker set search_path=pg_catalog,public as $$
  with eligible as (
    select m.*,l.created_at as linked_at,l.id is not null as linked,
      case when m.state<>'created' then 'verification'
        when m.check_intent is not null and m.checks_registered_at is null then
          case when m.check_payment_evidence='mismatch' then 'payment_mismatch'
            when m.check_payment_evidence is distinct from 'matched' then 'payment_evidence'
            else 'check_registration' end
        when m.source_kind='bank' and l.id is null then 'bank_link'
        when m.orders_debt_recovery is not null then 'debt_update' else 'registered' end as derived_stage
    from public.morning_document_operations m
    left join public.bank_transaction_document_links l on l.owner_id=m.owner_id and l.operation_id=m.operation_id
    where m.owner_id=p_owner_id and m.environment=p_environment
      and (coalesce(p_query,'')='' or m.document_number=p_query or m.operation_id::text=p_query)
      and (m.state in ('created_unverified','needs_reconciliation')
        or (m.state='pending' and coalesce(m.issuance_started_at,m.created_at)<=statement_timestamp()-interval '2 minutes')
        or (m.state='created' and m.verified_at is not null and (
          (m.check_intent is not null and m.checks_registered_at is null and (
            m.checks_registration_error is not null or m.check_payment_evidence is distinct from 'matched'
            or m.verified_at<=statement_timestamp()-interval '2 minutes'))
          or ((m.check_intent is null or m.checks_registered_at is not null) and m.source_kind='bank'
            and l.id is null and m.verified_at<=statement_timestamp()-interval '2 minutes')
          or m.orders_debt_recovery is not null
          or (p_filter='resolved' and m.orders_debt_recovery is null
            and greatest(m.checks_registered_at,l.created_at,m.orders_debt_recovery_completed_at)>=statement_timestamp()-interval '14 days'
            and (m.check_intent is null or m.checks_registered_at is not null) and (m.source_kind<>'bank' or l.id is not null)))))
  ), classified as (
    select e.*,case
      when derived_stage='registered' then 'complete'
      when derived_stage='payment_mismatch' then 'critical'
      when derived_stage='debt_update' then 'error'
      when derived_stage='check_registration' and checks_registration_error is not null
        and checks_registration_next_retry_at is null then 'error'
      when derived_stage='verification' then
        case when created_at<=statement_timestamp()-interval '10 minutes' then 'error' else 'warning' end
      when derived_stage='payment_evidence' then
        case when coalesce(checks_registration_first_failed_at,verified_at,created_at)<=statement_timestamp()-interval '10 minutes'
          then 'error' else 'warning' end
      when derived_stage='bank_link' and coalesce(verified_at,created_at)<=statement_timestamp()-interval '30 minutes' then 'error'
      else 'info' end as severity_key
    from eligible e
  ), ranked as (
    select c.*,case severity_key when 'critical' then 0 when 'error' then 1 when 'warning' then 2 when 'info' then 3 else 4 end as rank,
      case when severity_key='complete' then greatest(checks_registered_at,linked_at,orders_debt_recovery_completed_at) else created_at end as ordered_at
    from classified c
  ), page as materialized (
    select * from ranked m where case p_filter when 'resolved' then rank=4 when 'attention' then rank<=1
      when 'waiting' then rank in (2,3) when 'verification' then derived_stage in ('verification','payment_evidence','payment_mismatch')
      when 'active' then rank<4 else false end
      and (p_after_id is null or (m.rank,m.ordered_at,m.operation_id)>(p_after_priority,p_after_created,p_after_id))
    order by m.rank,m.ordered_at,m.operation_id limit 51
  )
  select m.operation_id,m.derived_stage,case when m.verified_at is not null then m.document_id end,
    m.document_number,m.document_type,m.source_kind,m.amount,coalesce(jsonb_array_length(m.check_intent),0),coalesce(p.total,0),
    m.created_at,m.verified_at,m.checks_registration_first_failed_at,
    coalesce(m.checks_registration_last_failed_at,m.last_reconciliation_at),m.checks_registration_next_retry_at,
    case when m.state='created' then m.checks_registration_attempts else m.reconciliation_attempts end,m.checks_registration_failure_kind,
    case when m.checks_registration_error ~ '^(save_busy|mfa_required|invalid_morning_check_intent|[A-Z0-9]{5})$' then m.checks_registration_error
      when m.error_code in ('creation_uncertain','creation_success_without_id','creation_verification_pending',
        'known_document_verification_pending','too_many_candidates','multiple_candidates','waiting_for_reconciliation','reconciliation_unavailable') then m.error_code end,
    case when m.rank=4 then m.ordered_at end,m.rank,m.ordered_at,m.checks_registered_at,m.linked,m.check_payment_evidence,
    case when m.orders_debt_recovery is not null then 'pending'
      when m.orders_debt_recovery_completed_at is not null then 'preserved' end,m.severity_key
  from page m left join lateral (select sum((v->>'amount')::numeric) as total from jsonb_array_elements(m.check_intent) v
    where v->>'amount' ~ '^[0-9]{1,12}(\.[0-9]{1,2})?$') p on true
  order by m.rank,m.ordered_at,m.operation_id;
$$;

revoke all on function netunim_internal.morning_debt_unique_progress(jsonb),
  netunim_internal.assert_morning_debt_progress_write(uuid,jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.list_morning_recovery_operations_v4(uuid,text,text,text,int,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.list_morning_recovery_operations_v4(uuid,text,text,text,int,timestamptz,uuid) to service_role;
commit;
