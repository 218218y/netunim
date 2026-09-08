-- The Edge Function uses one Morning credential pair per environment. Idempotency
-- must therefore protect that Morning business across all authenticated app users,
-- not merely within one Supabase owner_id.
begin;
lock table public.morning_document_operations in access exclusive mode;

do $$
begin
  if exists (
    select 1
    from public.morning_document_operations
    where document_id is not null
    group by environment,document_id
    having count(*) > 1
  ) then
    raise exception 'Cannot enable global Morning idempotency: one document_id is already claimed by multiple app users';
  end if;

  if exists (
    select 1
    from public.morning_document_operations
    where state in ('pending','created_unverified','needs_reconciliation')
    group by environment,request_fingerprint
    having count(*) > 1
  ) then
    raise exception 'Cannot enable global Morning idempotency: duplicate unresolved fingerprints already exist across app users';
  end if;
end $$;

drop index if exists public.morning_document_operations_unresolved_fingerprint_uidx;
create unique index morning_document_operations_unresolved_fingerprint_uidx
  on public.morning_document_operations(environment,request_fingerprint)
  where state in ('pending','created_unverified','needs_reconciliation');

drop index if exists public.morning_document_operations_document_uidx;
create unique index morning_document_operations_document_uidx
  on public.morning_document_operations(environment,document_id)
  where document_id is not null;

commit;
