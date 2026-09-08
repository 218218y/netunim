-- Morning / Green Invoice document-operation ledger.
-- Stores only compact metadata and idempotency state. PDF/document content stays in Morning.
begin;

create table if not exists public.morning_document_operations (
  owner_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  debt_id text not null,
  request_fingerprint text not null,
  state text not null check (state in ('pending','created','needs_reconciliation','failed')),
  document_type integer not null check (document_type in (305,320,400)),
  amount numeric(14,2) not null check (amount > 0),
  document_date date not null,
  client_name text not null default '',
  description text not null default '',
  document_id text,
  document_number text,
  document_url text,
  allocation_number text,
  allocation_checked_at timestamptz,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, operation_id)
);

-- Existing installations may already have the table from an earlier Morning rollout.
-- Keep this setup file safely re-runnable and add new compact metadata columns in place.
alter table public.morning_document_operations
  add column if not exists allocation_number text;
alter table public.morning_document_operations
  add column if not exists allocation_checked_at timestamptz;

create index if not exists morning_document_operations_debt_idx
  on public.morning_document_operations(owner_id,debt_id,created_at desc);

create unique index if not exists morning_document_operations_unresolved_debt_uidx
  on public.morning_document_operations(owner_id,debt_id)
  where state in ('pending','needs_reconciliation');

alter table public.morning_document_operations enable row level security;
revoke all on table public.morning_document_operations from public, anon, authenticated;
grant select,insert,update,delete on table public.morning_document_operations to service_role;

commit;
