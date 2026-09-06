-- Durable bank alert acknowledgements v1
-- Keeps alert dismissal separate from missing-transaction reconciliation so one incident cannot
-- accidentally suppress another. Alert acknowledgements are per archived bank transaction/kind.

begin;

alter table public.bank_transactions
  add column if not exists alert_acknowledgements jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.bank_transactions'::regclass
      and conname='bank_transactions_alert_acknowledgements_object_check'
  ) then
    alter table public.bank_transactions
      add constraint bank_transactions_alert_acknowledgements_object_check
      check (jsonb_typeof(alert_acknowledgements)='object');
  end if;
end $$;

create or replace function public.acknowledge_bank_transaction_alert(
  p_transaction_id bigint,
  p_alert_kind text
)
returns table(transaction_id bigint,alert_kind text,acknowledged_at timestamptz)
language plpgsql
security invoker
set search_path=pg_catalog,public
as $$
declare
  v_owner uuid:=auth.uid();
  v_kind text:=btrim(coalesce(p_alert_kind,''));
  v_at timestamptz:=now();
begin
  if v_owner is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  if p_transaction_id is null or p_transaction_id<=0 then raise exception 'invalid_bank_transaction_id' using errcode='22023'; end if;
  if v_kind not in ('returned_cheque') then raise exception 'unsupported_bank_alert_kind' using errcode='22023'; end if;

  update public.bank_transactions b
     set alert_acknowledgements=coalesce(b.alert_acknowledgements,'{}'::jsonb) || jsonb_build_object(v_kind,v_at)
   where b.id=p_transaction_id and b.owner_id=v_owner
  returning b.id into transaction_id;

  if transaction_id is null then
    raise exception 'bank_alert_transaction_not_found'
      using errcode='P0002',hint='The bank transaction does not exist or is not owned by this user.';
  end if;

  alert_kind:=v_kind;
  acknowledged_at:=v_at;
  return next;
end $$;

revoke all on function public.acknowledge_bank_transaction_alert(bigint,text) from public,anon;
grant execute on function public.acknowledge_bank_transaction_alert(bigint,text) to authenticated;

notify pgrst,'reload schema';
commit;
