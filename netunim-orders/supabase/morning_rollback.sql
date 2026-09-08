-- Run only while Morning issuance is stopped and the previous Edge version is ready.
-- Never roll back over newly created or unresolved operations.
begin;
lock table public.morning_document_operations in access exclusive mode;
do $$ begin
  if exists(select 1 from public.morning_document_operations where state in ('reserved','created','created_unverified','pending','needs_reconciliation')) then
    raise exception 'STOP: preserve new Morning operations; do not restore the old schema over them';
  end if;
  if to_regclass('public.morning_document_operations_backup_20260908') is null then
    raise exception 'Morning backup is missing';
  end if;
end $$;
-- Rename preserves every post-upgrade failed attempt for diagnostics as well.
alter table public.morning_document_operations rename to morning_document_operations_rollback_20260908;
alter index public.morning_document_operations_pkey rename to morning_document_operations_rollback_20260908_pkey;
create table public.morning_document_operations (
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
insert into public.morning_document_operations select * from public.morning_document_operations_backup_20260908;
create index morning_document_operations_debt_idx on public.morning_document_operations(owner_id,debt_id,created_at desc);
create unique index morning_document_operations_unresolved_debt_uidx on public.morning_document_operations(owner_id,debt_id) where state in ('pending','needs_reconciliation');
alter table public.morning_document_operations enable row level security;
revoke all on public.morning_document_operations from public,anon,authenticated;
grant select,insert,update,delete on public.morning_document_operations to service_role;
commit;
-- Restore the prior Edge code only after this transaction succeeds.
-- No customer or financial tables are involved in rollback.
