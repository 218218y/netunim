-- Add the missing FK-owner lookup index. No application rows are rewritten.
-- Migration API runs transactionally, so use bounded locking rather than CONCURRENTLY.
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '30s';
CREATE INDEX IF NOT EXISTS google_calendar_oauth_states_owner_id_idx
  ON public.google_calendar_oauth_states(owner_id);
COMMIT;
