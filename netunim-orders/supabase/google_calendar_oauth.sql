-- Google Calendar OAuth backend state.
-- Safe for an existing database: this script only creates two new tables/indexes
-- and does not alter order-management, checks, kupa, or backup data.

create table if not exists public.google_calendar_connections (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  google_account_id text not null,
  refresh_token text not null,
  scope text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.google_calendar_oauth_states (
  state_hash text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  return_url text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists google_calendar_oauth_states_expires_idx
  on public.google_calendar_oauth_states(expires_at);

alter table public.google_calendar_connections enable row level security;
alter table public.google_calendar_oauth_states enable row level security;

revoke all on table public.google_calendar_connections from public, anon, authenticated;
revoke all on table public.google_calendar_oauth_states from public, anon, authenticated;
grant select, insert, update, delete on table public.google_calendar_connections to service_role;
grant select, insert, update, delete on table public.google_calendar_oauth_states to service_role;
