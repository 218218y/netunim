-- Fix manual bank handled-state writes after the production bank archive was hardened to SELECT-only
-- for authenticated browser sessions. Keep the table non-writable from the browser and expose only
-- the narrow owner-scoped handled_at mutation through this SECURITY DEFINER RPC.
begin;

create or replace function public.set_bank_transaction_handled(
  p_transaction_id bigint,
  p_handled boolean
)
returns table(transaction_id bigint,handled_at timestamptz)
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_owner uuid:=auth.uid();
begin
  if v_owner is null then
    raise exception 'not_authenticated' using errcode='42501';
  end if;
  if p_transaction_id is null or p_transaction_id<=0 then
    raise exception 'invalid_bank_transaction_id' using errcode='22023';
  end if;
  if p_handled is null then
    raise exception 'invalid_bank_transaction_handled_state' using errcode='22023';
  end if;

  update public.bank_transactions b
     set handled_at=case when p_handled then coalesce(b.handled_at,now()) else null end
   where b.id=p_transaction_id
     and b.owner_id=v_owner
     and b.account_role='business'
     and b.status='completed'
  returning b.id,b.handled_at into transaction_id,handled_at;

  if transaction_id is null then
    raise exception 'bank_transaction_not_found'
      using errcode='P0002',hint='The finalized business bank transaction does not exist or is not owned by this user.';
  end if;
  return next;
end $$;

alter function public.set_bank_transaction_handled(bigint,boolean) owner to postgres;
revoke all on function public.set_bank_transaction_handled(bigint,boolean) from public,anon,authenticated,service_role;
grant execute on function public.set_bank_transaction_handled(bigint,boolean) to authenticated;

commit;
notify pgrst,'reload schema';
