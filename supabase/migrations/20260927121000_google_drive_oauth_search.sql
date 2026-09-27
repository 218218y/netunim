BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS public.google_drive_connections (
  owner_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  google_account_id text NOT NULL,
  refresh_token text NOT NULL,
  scope text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.google_drive_oauth_states (
  state_hash text PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  return_url text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS google_drive_oauth_states_expires_idx ON public.google_drive_oauth_states(expires_at);
CREATE INDEX IF NOT EXISTS google_drive_oauth_states_owner_id_idx ON public.google_drive_oauth_states(owner_id);

ALTER TABLE public.google_drive_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_drive_oauth_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.google_drive_connections FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.google_drive_oauth_states FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.google_drive_connections TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.google_drive_oauth_states TO service_role;

COMMIT;
