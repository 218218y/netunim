-- Technical issuance ledger only. No business data or document PDF is stored here.
begin;
create table if not exists public.morning_document_operations (
  operation_id uuid primary key,
  -- Historical initiator only. Do not cascade user deletion into issuance evidence.
  owner_id uuid not null,
  environment text not null check (environment in ('production','sandbox')),
  request_fingerprint text not null,
  state text not null check (state in ('reserved','pending','created_unverified','created','needs_reconciliation','failed')),
  document_type integer not null check (document_type in (305,320,400)),
  amount numeric(14,2) not null check (amount > 0),
  document_date date not null,
  client_name text not null default '',
  description text not null default '',
  document_id text,
  document_number text,
  allocation_number text,
  allocation_checked_at timestamptz,
  verified_at timestamptz,
  issuance_started_at timestamptz,
  error_code text,
  error_message text,
  reconciliation_attempts integer not null default 0,
  last_reconciliation_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint morning_document_operations_created_verified_check
    check (state <> 'created' or (document_id is not null and verified_at is not null)),
  constraint morning_document_operations_created_unverified_document_check
    check (state <> 'created_unverified' or document_id is not null),
  constraint morning_document_operations_issuance_started_check
    check (state in ('reserved','failed') or issuance_started_at is not null)
);
create unique index if not exists morning_document_operations_unresolved_fingerprint_uidx
  on public.morning_document_operations(environment,request_fingerprint)
  where state in ('reserved','pending','created_unverified','needs_reconciliation');
create unique index if not exists morning_document_operations_document_uidx
  on public.morning_document_operations(environment,document_id)
  where document_id is not null;
alter table public.morning_document_operations enable row level security;
revoke all on table public.morning_document_operations from public, anon, authenticated;
grant select,insert,update,delete on table public.morning_document_operations to service_role;
commit;
