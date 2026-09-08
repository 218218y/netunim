-- Guard again under an exclusive lock: preflight counts alone can race a create.
begin;
do $$
begin
  if to_regclass('public.morning_document_operations') is null then return; end if;
  lock table public.morning_document_operations in access exclusive mode;
  if exists (select 1 from public.morning_document_operations
             where state in ('created','pending','needs_reconciliation')) then
    raise exception 'Important Morning operations exist. STOP: use a preserving migration.';
  end if;
-- Intentionally no IF NOT EXISTS: never overwrite or silently reuse a backup.
create table public.morning_document_operations_backup_20260908
as table public.morning_document_operations;
alter table public.morning_document_operations_backup_20260908 enable row level security;
revoke all on public.morning_document_operations_backup_20260908 from public, anon, authenticated;
drop table public.morning_document_operations;
end $$;
create table if not exists public.morning_document_operations (
  operation_id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  environment text not null check (environment in ('production','sandbox')),
  request_fingerprint text not null,
  state text not null check (state in ('pending','created','needs_reconciliation','failed')),
  document_type integer not null check (document_type in (305,320,400)),
  amount numeric(14,2) not null check (amount > 0),
  document_date date not null,
  client_name text not null default '',
  description text not null default '',
  document_id text,
  document_number text,
  allocation_number text,
  allocation_checked_at timestamptz,
  error_code text,
  error_message text,
  reconciliation_attempts integer not null default 0,
  last_reconciliation_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists morning_document_operations_unresolved_fingerprint_uidx
  on public.morning_document_operations(owner_id,environment,request_fingerprint)
  where state in ('pending','needs_reconciliation');
alter table public.morning_document_operations enable row level security;
revoke all on table public.morning_document_operations from public, anon, authenticated;
grant select,insert,update,delete on table public.morning_document_operations to service_role;
commit;
