begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create index morning_operations_recovery_active
  on public.morning_document_operations(owner_id,environment,updated_at desc,operation_id)
  where state in ('pending','created_unverified','needs_reconciliation')
    or (state='created' and ((check_intent is not null and checks_registered_at is null) or source_kind='bank'));
create index morning_operations_recovery_registered
  on public.morning_document_operations(owner_id,environment,checks_registered_at desc,operation_id)
  where checks_registered_at is not null;

-- Project only operational metadata. The Edge authenticates and supplies owner and environment.
create function public.list_morning_recovery_operations(p_owner_id uuid,p_environment text)
returns table(operation_id uuid,stage text,document_id text,document_number text,document_type integer,
  source_kind text,amount numeric,check_count integer,check_amount numeric,created_at timestamptz,
  verified_at timestamptz,first_failed_at timestamptz,last_attempt_at timestamptz,next_retry_at timestamptz,
  attempts integer,failure_kind text,error_code text,resolved_at timestamptz)
language sql stable security invoker set search_path=pg_catalog,public as $$
  with active as materialized (
    select m.*,l.id as bank_link_id
    from public.morning_document_operations m
    left join public.bank_transaction_document_links l on l.owner_id=m.owner_id and l.operation_id=m.operation_id
    where m.owner_id=p_owner_id and m.environment=p_environment and (
      (m.state in ('pending','created_unverified','needs_reconciliation') and (
        m.state<>'pending' or m.created_at<=statement_timestamp()-interval '2 minutes'))
      or (m.state='created' and m.verified_at is not null and (
        (m.check_intent is not null and m.checks_registered_at is null and (
          m.checks_registration_error is not null or m.check_payment_evidence is distinct from 'matched'
          or m.verified_at<=statement_timestamp()-interval '2 minutes'))
        or (m.source_kind='bank' and l.id is null and m.verified_at<=statement_timestamp()-interval '2 minutes'))))
    order by m.updated_at desc,m.operation_id limit 51
  ), recent as materialized (
    select m.* from public.morning_document_operations m
    where m.owner_id=p_owner_id and m.environment=p_environment and m.state='created'
      and m.checks_registered_at>=statement_timestamp()-interval '14 days'
      and (m.source_kind<>'bank' or exists(select 1 from public.bank_transaction_document_links l
        where l.owner_id=m.owner_id and l.operation_id=m.operation_id))
    order by m.checks_registered_at desc,m.operation_id limit 20
  )
  select m.operation_id,case
      when m.state<>'created' then 'verification'
      when m.check_intent is not null and m.checks_registered_at is null then
        case when m.check_payment_evidence='mismatch' then 'payment_mismatch'
          when m.check_payment_evidence is distinct from 'matched' then 'payment_evidence'
          else 'check_registration' end
      else 'bank_link' end,
    case when m.verified_at is not null then m.document_id end,m.document_number,m.document_type,m.source_kind,m.amount,
    coalesce(jsonb_array_length(m.check_intent),0),coalesce(p.total,0),m.created_at,m.verified_at,
    m.checks_registration_first_failed_at,coalesce(m.checks_registration_last_failed_at,m.last_reconciliation_at),
    m.checks_registration_next_retry_at,case when m.state='created' then m.checks_registration_attempts else m.reconciliation_attempts end,
    m.checks_registration_failure_kind,
    case when m.state='created' and m.checks_registration_error ~ '^(save_busy|mfa_required|invalid_morning_check_intent|[A-Z0-9]{5})$'
      then m.checks_registration_error
      when m.state<>'created' and m.error_code in ('creation_uncertain','creation_success_without_id',
        'creation_verification_pending','known_document_verification_pending','too_many_candidates',
        'multiple_candidates','waiting_for_reconciliation','reconciliation_unavailable') then m.error_code end,
    null::timestamptz
  from active m
  left join lateral (select sum((v->>'amount')::numeric) as total
    from jsonb_array_elements(m.check_intent) v where v->>'amount' ~ '^[0-9]{1,12}(\.[0-9]{1,2})?$') p on true
  union all
  select m.operation_id,'registered',m.document_id,m.document_number,m.document_type,m.source_kind,m.amount,
    coalesce(jsonb_array_length(m.check_intent),0),0::numeric,m.created_at,m.verified_at,m.checks_registration_first_failed_at,
    m.checks_registration_last_failed_at,null::timestamptz,m.checks_registration_attempts,null::text,null::text,m.checks_registered_at
  from recent m;
$$;

revoke all on function public.list_morning_recovery_operations(uuid,text) from public,anon,authenticated;
grant execute on function public.list_morning_recovery_operations(uuid,text) to service_role;
commit;
