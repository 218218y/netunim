begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create function public.retry_verified_morning_checks_v2(p_owner_id uuid,p_environment text,p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare op public.morning_document_operations;
begin
  select * into op from public.morning_document_operations m
    where m.owner_id=p_owner_id and m.environment=p_environment and m.operation_id=p_operation_id;
  if not found then return jsonb_build_object('state','unavailable'); end if;
  if op.checks_registered_at is not null then return jsonb_build_object('state','already_registered'); end if;

  select * into op from public.morning_document_operations m
    where m.owner_id=p_owner_id and m.environment=p_environment and m.operation_id=p_operation_id
    for update skip locked;
  if not found then return jsonb_build_object('state','busy'); end if;
  if op.checks_registered_at is not null then return jsonb_build_object('state','already_registered'); end if;
  if op.state<>'created' or op.verified_at is null or op.document_id is null
    or op.check_intent is null or op.check_payment_evidence is distinct from 'matched'
  then return jsonb_build_object('state','unavailable'); end if;
  if op.checks_registration_last_manual_at>clock_timestamp()-interval '30 seconds' then
    return jsonb_build_object('state','cooldown','retry_at',op.checks_registration_last_manual_at+interval '30 seconds');
  end if;

  update public.morning_document_operations set checks_registration_last_manual_at=clock_timestamp()
    where operation_id=p_operation_id;
  perform netunim_internal.attempt_morning_check_registration(p_operation_id);
  select * into op from public.morning_document_operations where operation_id=p_operation_id;
  return jsonb_build_object('attempted',true,'state',case when op.checks_registered_at is not null then 'registered'
    when op.checks_registration_failure_kind='contention' then 'busy' else 'failed' end);
end $$;

-- Share the manual claim with any older Edge deployment that still expects a boolean.
create or replace function public.retry_verified_morning_checks(p_owner_id uuid,p_environment text,p_operation_id uuid)
returns boolean language sql security definer set search_path=pg_catalog,public as $$
  select coalesce((public.retry_verified_morning_checks_v2(p_owner_id,p_environment,p_operation_id)->>'attempted')::boolean,false);
$$;

create function public.list_morning_recovery_operations_v2(p_owner_id uuid,p_environment text,
  p_filter text,p_query text,p_after_priority int,p_after_created timestamptz,p_after_id uuid)
returns table(operation_id uuid,stage text,document_id text,document_number text,document_type integer,
  source_kind text,amount numeric,check_count integer,check_amount numeric,created_at timestamptz,
  verified_at timestamptz,first_failed_at timestamptz,last_attempt_at timestamptz,next_retry_at timestamptz,
  attempts integer,failure_kind text,error_code text,resolved_at timestamptz,priority integer,
  sort_at timestamptz,checks_registered_at timestamptz,bank_linked boolean,payment_evidence text)
language sql stable security invoker set search_path=pg_catalog,public as $$
  with eligible as (
    select m.*,l.created_at as linked_at,l.id is not null as linked,
      case when m.state<>'created' then 'verification'
        when m.check_intent is not null and m.checks_registered_at is null then
          case when m.check_payment_evidence='mismatch' then 'payment_mismatch'
            when m.check_payment_evidence is distinct from 'matched' then 'payment_evidence'
            else 'check_registration' end
        when m.source_kind='bank' and l.id is null then 'bank_link' else 'registered' end as derived_stage
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
          or (p_filter='resolved' and greatest(m.checks_registered_at,l.created_at)>=statement_timestamp()-interval '14 days'
            and (m.check_intent is null or m.checks_registered_at is not null) and (m.source_kind<>'bank' or l.id is not null)))))
  ), ranked as (
    select e.*,case when derived_stage='registered' then 2
      when derived_stage in ('verification','payment_mismatch') or
        (derived_stage='check_registration' and checks_registration_error is not null and checks_registration_next_retry_at is null) then 0
      else 1 end as rank,
      case when derived_stage='registered' then greatest(e.checks_registered_at,e.linked_at) else e.created_at end as ordered_at
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
    case when m.rank=2 then m.ordered_at end,m.rank,m.ordered_at,m.checks_registered_at,m.linked,m.check_payment_evidence
  from page m left join lateral (select sum((v->>'amount')::numeric) as total from jsonb_array_elements(m.check_intent) v
    where v->>'amount' ~ '^[0-9]{1,12}(\.[0-9]{1,2})?$') p on true
  order by m.rank,m.ordered_at,m.operation_id;
$$;

revoke all on function public.retry_verified_morning_checks_v2(uuid,text,uuid),
  public.list_morning_recovery_operations_v2(uuid,text,text,text,int,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.retry_verified_morning_checks_v2(uuid,text,uuid),
  public.list_morning_recovery_operations_v2(uuid,text,text,text,int,timestamptz,uuid) to service_role;
commit;
