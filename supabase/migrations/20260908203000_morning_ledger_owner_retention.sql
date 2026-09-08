-- Morning issuance evidence must outlive an app user account.
-- Deleting a Supabase user must never erase an unresolved/verified issuance row,
-- because Morning remains the system of record and a lost guard could permit a
-- duplicate document on a later retry.
begin;
lock table public.morning_document_operations in access exclusive mode;

alter table public.morning_document_operations
  drop constraint if exists morning_document_operations_owner_id_fkey;

comment on column public.morning_document_operations.owner_id is
  'Supabase user UUID that initiated the operation. Intentionally not a cascading FK: issuance/idempotency evidence survives user deletion.';

commit;
