-- Advisor follow-up: cover the owner_id foreign key used by auth.users cascades.
-- CONCURRENTLY intentionally runs outside a transaction to avoid blocking OAuth writes.
create index concurrently if not exists google_calendar_oauth_states_owner_id_idx
  on public.google_calendar_oauth_states(owner_id);
