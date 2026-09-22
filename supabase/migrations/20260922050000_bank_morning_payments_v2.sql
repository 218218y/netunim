begin;

-- v2: verified bank documents may cover a selected subset of a multi-cheque deposit.
-- Aggregate cheque deposits stay manually handled because the remaining cheques may belong to other customers.
create or replace function public.record_verified_bank_morning_document(
  p_owner_id uuid,
  p_operation_id uuid
)
returns table(transaction_id bigint,handled_at timestamptz,link_id bigint)
language plpgsql
security invoker
set search_path=pg_catalog,public
as $$
declare
  v_op public.morning_document_operations%rowtype;
  v_tx public.bank_transactions%rowtype;
  v_link_id bigint;
  v_multi_check_deposit boolean:=false;
begin
  if p_owner_id is null or p_operation_id is null then
    raise exception 'invalid_bank_morning_link_input' using errcode='22023';
  end if;
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role_required' using errcode='42501';
  end if;

  select * into v_op
    from public.morning_document_operations o
   where o.operation_id=p_operation_id and o.owner_id=p_owner_id
   for update;
  if not found or v_op.source_kind<>'bank' or v_op.source_bank_transaction_id is null
     or v_op.state<>'created' or v_op.document_id is null or v_op.verified_at is null
     or v_op.document_type not in (320,400) then
    raise exception 'bank_morning_operation_not_verified' using errcode='22023';
  end if;

  select * into v_tx
    from public.bank_transactions b
   where b.id=v_op.source_bank_transaction_id and b.owner_id=p_owner_id
   for update;
  if not found or v_tx.account_role<>'business' or v_tx.status<>'completed'
     or upper(coalesce(v_tx.currency,'ILS'))<>'ILS' or v_tx.amount<=0 then
    raise exception 'bank_morning_transaction_not_eligible' using errcode='22023';
  end if;
  v_multi_check_deposit:=case
    when coalesce(v_tx.cheque,false)
      and coalesce(v_tx.check_details->>'kind','')='deposit'
      and jsonb_typeof(v_tx.check_details->'checkItems')='array'
    then jsonb_array_length(v_tx.check_details->'checkItems')>1
    else false
  end;
  if round(v_op.amount::numeric,2) < round(v_tx.amount::numeric,2) and not v_multi_check_deposit then
    raise exception 'bank_morning_document_below_transaction_amount' using errcode='22023';
  end if;

  insert into public.bank_transaction_document_links(
    owner_id,transaction_id,operation_id,environment,document_id,document_number,
    document_type,document_amount,bank_amount,verified_at
  ) values (
    p_owner_id,v_tx.id,v_op.operation_id,v_op.environment,v_op.document_id,coalesce(v_op.document_number,''),
    v_op.document_type,v_op.amount,v_tx.amount,v_op.verified_at
  )
  on conflict (owner_id,operation_id) do update
    set document_id=excluded.document_id,
        document_number=excluded.document_number,
        document_type=excluded.document_type,
        document_amount=excluded.document_amount,
        bank_amount=excluded.bank_amount,
        verified_at=excluded.verified_at
  returning id into v_link_id;

  if v_multi_check_deposit then
    -- One document may intentionally cover only a subset of the deposited cheques.
    -- Do not mark the entire aggregate transaction handled until the user decides it is complete.
    transaction_id:=v_tx.id;
    handled_at:=v_tx.handled_at;
  else
    update public.bank_transactions b
       set handled_at=coalesce(b.handled_at,v_op.verified_at,now())
     where b.id=v_tx.id and b.owner_id=p_owner_id
    returning b.id,b.handled_at into transaction_id,handled_at;
  end if;

  link_id:=v_link_id;
  return next;
end $$;
revoke all on function public.record_verified_bank_morning_document(uuid,uuid) from public,anon,authenticated;
grant execute on function public.record_verified_bank_morning_document(uuid,uuid) to service_role;

commit;
notify pgrst,'reload schema';
