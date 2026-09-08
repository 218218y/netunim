-- Harden Morning issuance semantics without deleting or recreating the ledger.
-- `created` now means: the returned Morning document ID was re-read canonically
-- and the document's core fields matched the reserved request.
begin;
lock table public.morning_document_operations in access exclusive mode;

alter table public.morning_document_operations
  add column if not exists verified_at timestamptz;

-- Existing `created` rows came from the previous implementation, which could
-- mark success even when the canonical GET failed. Preserve the known Morning
-- document ID, but force one read-back before treating those rows as verified.
do $$
begin
  if exists (
    select 1 from public.morning_document_operations
    where state='created' and document_id is null
  ) then
    raise exception 'Cannot harden Morning ledger: a created row has no document_id';
  end if;

  if exists (
    select 1
    from public.morning_document_operations
    where document_id is not null
    group by owner_id,environment,document_id
    having count(*) > 1
  ) then
    raise exception 'Cannot harden Morning ledger: duplicate document_id ownership exists';
  end if;
end $$;

alter table public.morning_document_operations
  drop constraint if exists morning_document_operations_state_check;
alter table public.morning_document_operations
  add constraint morning_document_operations_state_check
  check (state in ('pending','created_unverified','created','needs_reconciliation','failed'));

update public.morning_document_operations
set state='created_unverified',
    error_code=coalesce(error_code,'migration_requires_reverification'),
    error_message=coalesce(error_message,'Existing success must be canonically re-verified after reliability hardening'),
    updated_at=now()
where state='created' and verified_at is null;

drop index if exists public.morning_document_operations_unresolved_fingerprint_uidx;
create unique index morning_document_operations_unresolved_fingerprint_uidx
  on public.morning_document_operations(owner_id,environment,request_fingerprint)
  where state in ('pending','created_unverified','needs_reconciliation');

-- Close the race that previously relied only on an application-side lookup.
create unique index if not exists morning_document_operations_document_uidx
  on public.morning_document_operations(owner_id,environment,document_id)
  where document_id is not null;

alter table public.morning_document_operations
  drop constraint if exists morning_document_operations_created_verified_check;
alter table public.morning_document_operations
  add constraint morning_document_operations_created_verified_check
  check (state <> 'created' or (document_id is not null and verified_at is not null));

alter table public.morning_document_operations
  drop constraint if exists morning_document_operations_created_unverified_document_check;
alter table public.morning_document_operations
  add constraint morning_document_operations_created_unverified_document_check
  check (state <> 'created_unverified' or document_id is not null);

commit;
