begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- The provider ledger keeps only the owner's allocation intent. Orders V2
-- remains the authority for balances and durable document/debt associations.
alter table public.morning_document_operations
  add column orders_debt_recovery jsonb,
  add column orders_debt_recovery_completed_at timestamptz,
  add column orders_debt_recovery_revision bigint,
  add constraint morning_orders_debt_recovery_shape check (orders_debt_recovery is null or (
    source_kind in ('debt','bank') and length(orders_debt_recovery->>'debtId') between 1 and 160
    and jsonb_typeof(orders_debt_recovery->'debtId')='string'
    and jsonb_typeof(orders_debt_recovery->'applyPayment')='boolean'
    and jsonb_typeof(orders_debt_recovery->'applyInvoice')='boolean'
    and jsonb_typeof(orders_debt_recovery->'financialSnapshot')='object'
    and orders_debt_recovery-array['debtId','applyPayment','applyInvoice','financialSnapshot']='{}'::jsonb
    and orders_debt_recovery_completed_at is null and orders_debt_recovery_revision is null
  ) is true),
  add constraint morning_orders_debt_recovery_receipt check (
    (orders_debt_recovery_completed_at is null and orders_debt_recovery_revision is null)
    or (orders_debt_recovery_completed_at is not null and coalesce(orders_debt_recovery_revision,0)>0
      and orders_debt_recovery is null and state='created'));

create index morning_operations_orders_pending on public.morning_document_operations(owner_id,operation_id)
  where orders_debt_recovery is not null and state='created';

create function netunim_internal.guard_morning_orders_debt_recovery()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin
  if new.state='failed' then new.orders_debt_recovery:=null; end if;
  if tg_op='INSERT' then
    if new.orders_debt_recovery is not null and new.state<>'reserved' then
      raise exception 'morning_orders_debt_recovery_requires_reservation' using errcode='22023';
    end if;
  elsif new.orders_debt_recovery is distinct from old.orders_debt_recovery
    and (new.orders_debt_recovery is not null or (new.state<>'failed' and new.orders_debt_recovery_revision is null)) then
    raise exception 'morning_orders_debt_recovery_immutable' using errcode='22023';
  end if;
  return new;
end $$;

create trigger morning_orders_debt_recovery_guard
  before insert or update of state,orders_debt_recovery on public.morning_document_operations
  for each row execute function netunim_internal.guard_morning_orders_debt_recovery();

create function netunim_internal.confirm_morning_orders_debt_recovery()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if new.document_name<>'suppliers' or jsonb_typeof(new.state->'customerDebts') is distinct from 'array'
    or not exists(select 1 from public.morning_document_operations m where m.owner_id=new.owner_id
      and m.state='created' and m.orders_debt_recovery is not null) then return new; end if;
  update public.morning_document_operations m
    set orders_debt_recovery=null,orders_debt_recovery_completed_at=clock_timestamp(),orders_debt_recovery_revision=new.revision
    where m.owner_id=new.owner_id and m.state='created' and m.verified_at is not null
      and m.orders_debt_recovery is not null and exists(
        select 1 from jsonb_array_elements(new.state->'customerDebts') d
        cross join lateral jsonb_array_elements(case when jsonb_typeof(d->'morningDocuments')='array'
          then d->'morningDocuments' else '[]'::jsonb end) link
        where d->>'id'=m.orders_debt_recovery->>'debtId'
          and link->>'operationId'=m.operation_id::text and link->>'documentId'=m.document_id
          and link->>'documentType'=m.document_type::text);
  return new;
end $$;

create trigger orders_morning_debt_recovery_receipt
  after insert or update of state on public.order_management_documents
  for each row execute function netunim_internal.confirm_morning_orders_debt_recovery();

create function public.list_morning_recovery_operations_v3(p_owner_id uuid,p_environment text,
  p_filter text,p_query text,p_after_priority int,p_after_created timestamptz,p_after_id uuid)
returns table(operation_id uuid,stage text,document_id text,document_number text,document_type integer,
  source_kind text,amount numeric,check_count integer,check_amount numeric,created_at timestamptz,
  verified_at timestamptz,first_failed_at timestamptz,last_attempt_at timestamptz,next_retry_at timestamptz,
  attempts integer,failure_kind text,error_code text,resolved_at timestamptz,priority integer,
  sort_at timestamptz,checks_registered_at timestamptz,bank_linked boolean,payment_evidence text,debt_state text)
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
  ), ranked as (
    select e.*,case when derived_stage='registered' then 2
      when derived_stage in ('verification','payment_mismatch','debt_update') or
        (derived_stage='check_registration' and checks_registration_error is not null and checks_registration_next_retry_at is null) then 0
      else 1 end as rank,
      case when derived_stage='registered' then greatest(e.checks_registered_at,e.linked_at,e.orders_debt_recovery_completed_at) else e.created_at end as ordered_at
    from eligible e
  ), page as materialized (
    select * from ranked m where case p_filter when 'resolved' then rank=2 when 'attention' then rank=0
      when 'waiting' then rank=1 when 'verification' then derived_stage in ('verification','payment_evidence','payment_mismatch')
      when 'active' then rank<2 else false end
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
    case when m.rank=2 then m.ordered_at end,m.rank,m.ordered_at,m.checks_registered_at,m.linked,m.check_payment_evidence,
    case when m.orders_debt_recovery is not null then 'pending'
      when m.orders_debt_recovery_completed_at is not null then 'preserved' end
  from page m left join lateral (select sum((v->>'amount')::numeric) as total from jsonb_array_elements(m.check_intent) v
    where v->>'amount' ~ '^[0-9]{1,12}(\.[0-9]{1,2})?$') p on true
  order by m.rank,m.ordered_at,m.operation_id;
$$;

revoke all on function netunim_internal.guard_morning_orders_debt_recovery(),
  netunim_internal.confirm_morning_orders_debt_recovery() from public,anon,authenticated,service_role;
revoke all on function public.list_morning_recovery_operations_v3(uuid,text,text,text,int,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.list_morning_recovery_operations_v3(uuid,text,text,text,int,timestamptz,uuid) to service_role;
commit;
