BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE public.google_contacts_connections (
  owner_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  google_account_id text NOT NULL,
  refresh_token text NOT NULL,
  scope text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  grant_id uuid NOT NULL DEFAULT gen_random_uuid(),
  search_window_start timestamptz NOT NULL DEFAULT now(),
  search_count integer NOT NULL DEFAULT 0
);

CREATE TABLE public.google_contacts_oauth_states (
  state_hash text PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  return_url text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX google_contacts_oauth_states_expiry_idx ON public.google_contacts_oauth_states(expires_at);
CREATE INDEX google_contacts_oauth_states_owner_idx ON public.google_contacts_oauth_states(owner_id);
ALTER TABLE public.google_contacts_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_contacts_oauth_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.google_contacts_connections, public.google_contacts_oauth_states FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.google_contacts_connections, public.google_contacts_oauth_states TO service_role;
ALTER TABLE public.google_oauth_intents
  DROP CONSTRAINT google_oauth_intents_service_check,
  ADD CONSTRAINT google_oauth_intents_service_check CHECK (service IN ('calendar', 'drive', 'contacts'));

-- Publication changes the grant even when the user reconnects the same account.
-- Refresh credential rotation does not change the grant identity.
CREATE FUNCTION public.rotate_google_contacts_grant()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  NEW.grant_id := gen_random_uuid();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.rotate_google_contacts_grant() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER google_contacts_grant_change
  BEFORE UPDATE OF google_account_id, scope ON public.google_contacts_connections
  FOR EACH ROW EXECUTE FUNCTION public.rotate_google_contacts_grant();

-- The rate limit is shared across Edge isolates and stores only counters.
CREATE FUNCTION public.take_google_contacts_search_slot(p_owner_id uuid, p_grant_id uuid)
RETURNS boolean LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE cutoff timestamptz := statement_timestamp() - interval '1 minute';
BEGIN
  UPDATE public.google_contacts_connections
    SET search_count = CASE WHEN search_window_start <= cutoff THEN 1 ELSE search_count + 1 END,
        search_window_start = CASE WHEN search_window_start <= cutoff THEN statement_timestamp() ELSE search_window_start END
    WHERE owner_id = p_owner_id AND grant_id = p_grant_id
      AND (search_window_start <= cutoff OR search_count < 40);
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.take_google_contacts_search_slot(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.take_google_contacts_search_slot(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.google_oauth_start(p_service text, p_owner_id uuid,
  p_state_hash text, p_return_url text, p_expires_at timestamptz)
RETURNS void LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF p_service NOT IN ('calendar', 'drive', 'contacts') OR p_service IS NULL
    OR p_state_hash IS NULL OR length(p_state_hash) <> 64
    OR p_expires_at IS NULL OR p_expires_at <= now() THEN
    RAISE EXCEPTION 'Invalid Google OAuth intent';
  END IF;
  -- All three operations serialize on this row, including an absent connection.
  INSERT INTO public.google_oauth_intents(owner_id, service, state_hash, expires_at)
  VALUES (p_owner_id, p_service, p_state_hash, p_expires_at)
  ON CONFLICT (owner_id, service) DO UPDATE
    SET state_hash = EXCLUDED.state_hash, expires_at = EXCLUDED.expires_at;
  EXECUTE format('INSERT INTO public.%I (state_hash, owner_id, return_url, expires_at) VALUES ($1,$2,$3,$4)',
    'google_' || p_service || '_oauth_states')
    USING p_state_hash, p_owner_id, p_return_url, p_expires_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.google_oauth_disconnect(p_service text, p_owner_id uuid)
RETURNS text LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE credential text;
BEGIN
  IF p_service NOT IN ('calendar', 'drive', 'contacts') OR p_service IS NULL THEN
    RAISE EXCEPTION 'Invalid Google OAuth service';
  END IF;
  INSERT INTO public.google_oauth_intents(owner_id, service, state_hash, expires_at)
    VALUES (p_owner_id, p_service, NULL, NULL)
  ON CONFLICT (owner_id, service) DO UPDATE SET state_hash = NULL, expires_at = NULL;
  EXECUTE format('DELETE FROM public.%I WHERE owner_id = $1 RETURNING refresh_token',
    'google_' || p_service || '_connections') INTO credential USING p_owner_id;
  -- Pending callbacks not yet admitted are also invalidated. Already consumed
  -- callbacks can finish I/O but publication fails under the same row lock.
  EXECUTE format('DELETE FROM public.%I WHERE owner_id = $1',
    'google_' || p_service || '_oauth_states') USING p_owner_id;
  RETURN coalesce(credential, '');
END;
$$;

COMMIT;
