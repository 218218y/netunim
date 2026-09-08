-- Separate a DB-only reservation from the externally ambiguous issuance window.
-- `reserved` proves POST /documents has not been started yet. `pending` means the
-- operation has atomically claimed the right to issue and may already have reached Morning.
begin;
lock table public.morning_document_operations in access exclusive mode;

alter table public.morning_document_operations
  add column if not exists issuance_started_at timestamptz;

-- Rows created by older code used `pending` from reservation time. Treat them
-- conservatively as possibly issued and use created_at as the reconciliation anchor.
update public.morning_document_operations
set issuance_started_at = coalesce(issuance_started_at, created_at)
where state in ('pending','created_unverified','created','needs_reconciliation');

alter table public.morning_document_operations
  drop constraint if exists morning_document_operations_state_check;
alter table public.morning_document_operations
  add constraint morning_document_operations_state_check
  check (state in ('reserved','pending','created_unverified','created','needs_reconciliation','failed'));

alter table public.morning_document_operations
  drop constraint if exists morning_document_operations_issuance_started_check;
alter table public.morning_document_operations
  add constraint morning_document_operations_issuance_started_check
  check (state in ('reserved','failed') or issuance_started_at is not null);

drop index if exists public.morning_document_operations_unresolved_fingerprint_uidx;
create unique index morning_document_operations_unresolved_fingerprint_uidx
  on public.morning_document_operations(environment,request_fingerprint)
  where state in ('reserved','pending','created_unverified','needs_reconciliation');

commit;
