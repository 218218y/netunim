-- Cloud header ownership: keep the Kupa header timestamp independent from bank/credit feed writes.
-- Safe to run repeatedly. It does not rewrite Kupa state, checks, bank transactions, or finance data.

begin;

alter table public.kupa_documents
  add column if not exists core_updated_at timestamptz;

-- A Kupa core change is user-owned Kupa state. Shared checks have their own document/timestamp,
-- and bank/credit feed data is owned by finance_sync_documents. The bank snapshot token/sequence
-- stored in kupa_documents is transport bookkeeping and must not advance the Kupa header clock.
create or replace function netunim_internal.kupa_header_owned_state(p_state jsonb)
returns jsonb
language sql
immutable
set search_path = pg_catalog
as $$
  select (coalesce(p_state, '{}'::jsonb) - 'bank' - 'creditSync' - 'checks')
         || jsonb_build_object(
              'bankAdjustments',
              coalesce(p_state #> '{bank,adjustments}', '[]'::jsonb)
            );
$$;

create or replace function netunim_internal.track_kupa_core_updated_at()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, netunim_internal
as $$
begin
  if tg_op = 'INSERT' then
    new.core_updated_at := coalesce(new.core_updated_at, new.updated_at, clock_timestamp());
  elsif netunim_internal.kupa_header_owned_state(new.state)
        is distinct from netunim_internal.kupa_header_owned_state(old.state) then
    new.core_updated_at := coalesce(new.updated_at, clock_timestamp());
  else
    -- Finance/bank bookkeeping may still advance revision + updated_at for concurrency safety.
    -- Preserve the Kupa-owned clock so the top header does not pretend user data changed.
    new.core_updated_at := old.core_updated_at;
  end if;
  return new;
end;
$$;

revoke all on function netunim_internal.kupa_header_owned_state(jsonb) from public, anon, authenticated;
revoke all on function netunim_internal.track_kupa_core_updated_at() from public, anon, authenticated;

-- Prefer the durable Kupa operation ledger for historical backfill. If this installation predates
-- that ledger, fall back to the existing document timestamp rather than inventing a time.
do $backfill$
begin
  if to_regclass('netunim_internal.document_sync_operations') is not null then
    execute $sql$
      update public.kupa_documents k
      set core_updated_at = coalesce(
        (select max(o.created_at)
         from netunim_internal.document_sync_operations o
         where o.owner_id = k.owner_id
           and o.domain = 'kupa'
           and o.document_name = k.document_name),
        k.updated_at
      )
      where k.core_updated_at is null
    $sql$;
  else
    update public.kupa_documents
    set core_updated_at = updated_at
    where core_updated_at is null;
  end if;
end
$backfill$;

alter table public.kupa_documents
  alter column core_updated_at set default now();

alter table public.kupa_documents
  alter column core_updated_at set not null;

drop trigger if exists kupa_core_updated_at_track on public.kupa_documents;
create trigger kupa_core_updated_at_track
before insert or update of state, updated_at on public.kupa_documents
for each row execute function netunim_internal.track_kupa_core_updated_at();

comment on column public.kupa_documents.core_updated_at is
  'Last Kupa-owned state change. Excludes bank/credit feed bookkeeping; shared checks are timestamped separately.';

commit;
