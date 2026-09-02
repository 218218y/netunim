-- Cross-device lease for bank / credit synchronization.
-- One authenticated user can hold one lease per synchronization kind.
create table if not exists public.finance_sync_leases (
  owner_id uuid not null references auth.users(id) on delete cascade,
  lease_name text not null check (lease_name in ('bank','credit')),
  lease_token text not null,
  leased_until timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key(owner_id,lease_name)
);

alter table public.finance_sync_leases enable row level security;
revoke all on table public.finance_sync_leases from anon, authenticated;
grant select, insert, update on table public.finance_sync_leases to authenticated;

drop policy if exists "finance_sync_leases_select_own" on public.finance_sync_leases;
create policy "finance_sync_leases_select_own" on public.finance_sync_leases
for select to authenticated
using ((select auth.uid())=owner_id);

drop policy if exists "finance_sync_leases_insert_own" on public.finance_sync_leases;
create policy "finance_sync_leases_insert_own" on public.finance_sync_leases
for insert to authenticated
with check ((select auth.uid())=owner_id);

drop policy if exists "finance_sync_leases_update_own" on public.finance_sync_leases;
create policy "finance_sync_leases_update_own" on public.finance_sync_leases
for update to authenticated
using ((select auth.uid())=owner_id)
with check ((select auth.uid())=owner_id);

create or replace function public.claim_finance_sync_lease(
  p_lease_name text,
  p_lease_token text,
  p_ttl_seconds integer default 1200
)
returns table(acquired boolean, leased_until timestamptz)
language plpgsql
security invoker
set search_path=pg_catalog,public
as $$
declare
  v_owner uuid:=auth.uid();
  v_name text:=btrim(coalesce(p_lease_name,''));
  v_token text:=btrim(coalesce(p_lease_token,''));
  v_now timestamptz:=clock_timestamp();
  v_until timestamptz;
begin
  if v_owner is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  if v_name not in ('bank','credit') then raise exception 'invalid_finance_sync_lease_name' using errcode='22023'; end if;
  if v_token='' or length(v_token)>200 then raise exception 'invalid_finance_sync_lease_token' using errcode='22023'; end if;
  if p_ttl_seconds is null or p_ttl_seconds<60 or p_ttl_seconds>1800 then raise exception 'invalid_finance_sync_lease_ttl' using errcode='22023'; end if;
  v_until:=v_now+make_interval(secs=>p_ttl_seconds);

  insert into public.finance_sync_leases as lease(owner_id,lease_name,lease_token,leased_until,updated_at)
  values(v_owner,v_name,v_token,v_until,v_now)
  on conflict(owner_id,lease_name) do update
  set lease_token=excluded.lease_token,
      leased_until=excluded.leased_until,
      updated_at=excluded.updated_at
  where lease.leased_until<=v_now or lease.lease_token=excluded.lease_token
  returning true,lease.leased_until into acquired,leased_until;

  if found then return next; return; end if;

  select false,lease.leased_until into acquired,leased_until
  from public.finance_sync_leases lease
  where lease.owner_id=v_owner and lease.lease_name=v_name;
  if not found then acquired:=false;leased_until:=null;end if;
  return next;
end $$;

revoke all on function public.claim_finance_sync_lease(text,text,integer) from public,anon;
grant execute on function public.claim_finance_sync_lease(text,text,integer) to authenticated;

create or replace function public.release_finance_sync_lease(
  p_lease_name text,
  p_lease_token text
)
returns boolean
language plpgsql
security invoker
set search_path=pg_catalog,public
as $$
declare
  v_owner uuid:=auth.uid();
  v_name text:=btrim(coalesce(p_lease_name,''));
  v_token text:=btrim(coalesce(p_lease_token,''));
  v_now timestamptz:=clock_timestamp();
  v_released boolean:=false;
begin
  if v_owner is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  if v_name not in ('bank','credit') then raise exception 'invalid_finance_sync_lease_name' using errcode='22023'; end if;
  if v_token='' or length(v_token)>200 then raise exception 'invalid_finance_sync_lease_token' using errcode='22023'; end if;

  update public.finance_sync_leases lease
  set leased_until=v_now,updated_at=v_now
  where lease.owner_id=v_owner and lease.lease_name=v_name and lease.lease_token=v_token
  returning true into v_released;
  return coalesce(v_released,false);
end $$;

revoke all on function public.release_finance_sync_lease(text,text) from public,anon;
grant execute on function public.release_finance_sync_lease(text,text) to authenticated;
