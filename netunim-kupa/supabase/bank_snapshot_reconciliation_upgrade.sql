-- Bank complete-snapshot reconciliation v1
-- Separates durable bank history from the latest proven-complete bank response.
-- Archive rows are never deleted merely because they disappear from a later read.
-- Missing warnings are created only from complete reads and persist until the row reappears
-- or the owner explicitly acknowledges the review item.

begin;

alter table public.bank_transactions
  add column if not exists presence_state text not null default 'unknown',
  add column if not exists last_seen_at timestamptz,
  add column if not exists missing_since timestamptz,
  add column if not exists missing_acknowledged_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.bank_transactions'::regclass
      and conname='bank_transactions_presence_state_check'
  ) then
    alter table public.bank_transactions
      add constraint bank_transactions_presence_state_check
      check (presence_state in ('unknown','present','missing'));
  end if;
end $$;

create index if not exists bank_transactions_owner_missing_idx
  on public.bank_transactions(owner_id,account_key,account_role,missing_since desc)
  where presence_state='missing' and missing_acknowledged_at is null;

create table if not exists public.bank_transaction_snapshots (
  owner_id uuid not null references auth.users(id) on delete cascade,
  account_key text not null,
  account_role text not null check (account_role in ('business','home')),
  snapshot_at timestamptz not null,
  coverage_from date not null,
  coverage_to date not null,
  transaction_count integer not null check (transaction_count >= 0),
  transactions jsonb not null check (jsonb_typeof(transactions)='array'),
  updated_at timestamptz not null default now(),
  primary key(owner_id,account_key,account_role),
  check (coverage_to >= coverage_from)
);

alter table public.bank_transaction_snapshots enable row level security;
revoke all on table public.bank_transaction_snapshots from anon,authenticated;
grant select,insert,update on table public.bank_transaction_snapshots to authenticated;
drop policy if exists "bank_transaction_snapshots_select_own" on public.bank_transaction_snapshots;
create policy "bank_transaction_snapshots_select_own"
  on public.bank_transaction_snapshots for select to authenticated
  using ((select auth.uid())=owner_id);
drop policy if exists "bank_transaction_snapshots_insert_own" on public.bank_transaction_snapshots;
create policy "bank_transaction_snapshots_insert_own"
  on public.bank_transaction_snapshots for insert to authenticated
  with check ((select auth.uid())=owner_id);
drop policy if exists "bank_transaction_snapshots_update_own" on public.bank_transaction_snapshots;
create policy "bank_transaction_snapshots_update_own"
  on public.bank_transaction_snapshots for update to authenticated
  using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);

create or replace function public.sync_bank_transactions_snapshot(
  p_account_key text,
  p_account_role text,
  p_transactions jsonb,
  p_snapshot_at timestamptz,
  p_coverage_from date,
  p_coverage_to date,
  p_complete boolean
)
returns table(
  inserted_count integer,
  updated_count integer,
  total_count integer,
  missing_count integer,
  active_missing_count integer,
  snapshot_stored boolean,
  baseline_created boolean
)
language plpgsql
security invoker
set search_path=pg_catalog,public
as $$
declare
  v_owner uuid:=auth.uid();
  v_inserted integer:=0;
  v_updated integer:=0;
  v_total integer:=0;
  v_previous_snapshot_at timestamptz;
  v_had_complete_snapshot boolean:=false;
begin
  if v_owner is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  if coalesce(btrim(p_account_key),'')='' or p_account_role not in ('business','home')
     or jsonb_typeof(p_transactions) is distinct from 'array'
     or p_snapshot_at is null then
    raise exception 'invalid_bank_snapshot_input' using errcode='22023';
  end if;
  if coalesce(p_complete,false) and (p_coverage_from is null or p_coverage_to is null or p_coverage_to<p_coverage_from) then
    raise exception 'invalid_bank_snapshot_coverage' using errcode='22023';
  end if;

  -- The public merge boundary owns the shared per-user advisory transaction lock both before and
  -- after core contention hardening. Transaction-scoped advisory locks remain held for this whole
  -- RPC, so merge + reconciliation + snapshot are atomic; any later exception rolls all of it back.
  select m.inserted_count,m.updated_count,m.total_count
    into v_inserted,v_updated,v_total
  from public.merge_bank_transactions(p_account_key,p_account_role,p_transactions) m;

  select s.snapshot_at into v_previous_snapshot_at
  from public.bank_transaction_snapshots s
  where s.owner_id=v_owner and s.account_key=p_account_key and s.account_role=p_account_role
  for update;
  v_had_complete_snapshot:=v_previous_snapshot_at is not null;

  -- A late client cannot mutate presence state after a newer proven-complete bank snapshot. This
  -- applies even to an incomplete read: a stale partial response must not resurrect a row that a
  -- newer complete snapshot already proved missing. Throwing rolls the merge back atomically too.
  if v_previous_snapshot_at is not null and p_snapshot_at<v_previous_snapshot_at then
    raise exception 'bank_snapshot_stale'
      using errcode='40001',hint='A newer complete bank snapshot is already stored. The stale snapshot was not applied.';
  end if;

  -- Rows actually returned by the bank are present. This is safe even for a partial read; absence
  -- is the only fact that is forbidden unless the connector proved the whole requested range.
  -- Reappearance also clears an old acknowledgement so a later disappearance becomes a new incident.
  update public.bank_transactions b set
    presence_state='present',
    last_seen_at=p_snapshot_at,
    missing_since=null,
    missing_acknowledged_at=null
  where b.owner_id=v_owner and b.account_key=p_account_key and b.account_role=p_account_role
    and exists (
      select 1 from jsonb_array_elements(p_transactions) x(value)
      where x.value->>'mergeKey'=b.merge_key
    )
    and (
      b.presence_state is distinct from 'present'
      or b.last_seen_at is distinct from p_snapshot_at
      or b.missing_since is not null
      or b.missing_acknowledged_at is not null
    );

  if coalesce(p_complete,false) then
    -- Pre-upgrade archive rows start UNKNOWN. The first complete snapshot is a baseline only: it
    -- cannot manufacture warnings for old history whose prior presence was never proven. Starting
    -- with the second complete snapshot, only previously PRESENT rows inside the connector-declared
    -- coverage window can transition to MISSING.
    if v_had_complete_snapshot then
      update public.bank_transactions b set
        presence_state='missing',
        missing_since=coalesce(b.missing_since,p_snapshot_at)
      where b.owner_id=v_owner and b.account_key=p_account_key and b.account_role=p_account_role
        and b.presence_state='present'
        and coalesce(b.transaction_date,b.processed_date)::date between p_coverage_from and p_coverage_to
        and (b.last_seen_at is null or b.last_seen_at<p_snapshot_at)
        and not exists (
          select 1 from jsonb_array_elements(p_transactions) x(value)
          where x.value->>'mergeKey'=b.merge_key
        );
    end if;

    insert into public.bank_transaction_snapshots(
      owner_id,account_key,account_role,snapshot_at,coverage_from,coverage_to,
      transaction_count,transactions,updated_at
    ) values (
      v_owner,p_account_key,p_account_role,p_snapshot_at,p_coverage_from,p_coverage_to,
      jsonb_array_length(p_transactions),p_transactions,now()
    )
    on conflict(owner_id,account_key,account_role) do update set
      snapshot_at=excluded.snapshot_at,
      coverage_from=excluded.coverage_from,
      coverage_to=excluded.coverage_to,
      transaction_count=excluded.transaction_count,
      transactions=excluded.transactions,
      updated_at=now()
    where public.bank_transaction_snapshots.snapshot_at<=excluded.snapshot_at;
  end if;

  select count(*)::integer into missing_count
  from public.bank_transactions b
  where b.owner_id=v_owner and b.account_key=p_account_key and b.account_role=p_account_role
    and b.presence_state='missing';

  select count(*)::integer into active_missing_count
  from public.bank_transactions b
  where b.owner_id=v_owner and b.account_key=p_account_key and b.account_role=p_account_role
    and b.presence_state='missing' and b.missing_acknowledged_at is null;

  inserted_count:=coalesce(v_inserted,0);
  updated_count:=coalesce(v_updated,0);
  total_count:=coalesce(v_total,0);
  snapshot_stored:=coalesce(p_complete,false);
  baseline_created:=coalesce(p_complete,false) and not v_had_complete_snapshot;
  return next;
end $$;

revoke all on function public.sync_bank_transactions_snapshot(text,text,jsonb,timestamptz,date,date,boolean) from public,anon;
grant execute on function public.sync_bank_transactions_snapshot(text,text,jsonb,timestamptz,date,date,boolean) to authenticated;

create or replace function public.acknowledge_bank_transaction_missing(p_transaction_id bigint)
returns table(transaction_id bigint,acknowledged_at timestamptz)
language plpgsql
security invoker
set search_path=pg_catalog,public
as $$
declare
  v_owner uuid:=auth.uid();
begin
  if v_owner is null then raise exception 'not_authenticated' using errcode='42501'; end if;
  if p_transaction_id is null or p_transaction_id<=0 then raise exception 'invalid_bank_transaction_id' using errcode='22023'; end if;

  update public.bank_transactions b
     set missing_acknowledged_at=coalesce(b.missing_acknowledged_at,now())
   where b.id=p_transaction_id and b.owner_id=v_owner and b.presence_state='missing'
  returning b.id,b.missing_acknowledged_at into transaction_id,acknowledged_at;

  if transaction_id is null then
    raise exception 'bank_missing_transaction_not_found'
      using errcode='P0002',hint='The row is not a missing bank transaction owned by this user.';
  end if;
  return next;
end $$;

revoke all on function public.acknowledge_bank_transaction_missing(bigint) from public,anon;
grant execute on function public.acknowledge_bank_transaction_missing(bigint) to authenticated;

notify pgrst,'reload schema';
commit;
