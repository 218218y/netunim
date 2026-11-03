BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '30s';

-- Intent metadata only. Credentials remain in the existing connection tables.
CREATE TABLE public.google_oauth_intents (
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  service text NOT NULL CHECK (service IN ('calendar', 'drive')),
  state_hash text,
  expires_at timestamptz,
  PRIMARY KEY (owner_id, service)
);
ALTER TABLE public.google_oauth_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.google_oauth_intents FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.google_oauth_intents TO service_role;

CREATE FUNCTION public.google_oauth_start(p_service text, p_owner_id uuid,
  p_state_hash text, p_return_url text, p_expires_at timestamptz)
RETURNS void LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF p_service NOT IN ('calendar', 'drive') OR p_service IS NULL
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

CREATE FUNCTION public.google_oauth_publish(p_service text, p_owner_id uuid,
  p_state_hash text, p_account_id text, p_refresh_token text, p_scope text)
RETURNS boolean LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE intent public.google_oauth_intents%ROWTYPE;
BEGIN
  SELECT * INTO intent FROM public.google_oauth_intents
    WHERE owner_id = p_owner_id AND service = p_service FOR UPDATE;
  IF NOT FOUND OR intent.state_hash IS DISTINCT FROM p_state_hash
    OR intent.state_hash IS NULL OR intent.expires_at IS NULL OR intent.expires_at <= clock_timestamp() THEN
    RETURN false;
  END IF;
  IF coalesce(btrim(p_account_id), '') = '' OR coalesce(btrim(p_refresh_token), '') = ''
    OR coalesce(btrim(p_scope), '') = '' THEN
    RAISE EXCEPTION 'Missing verified Google credentials';
  END IF;
  EXECUTE format('INSERT INTO public.%I (owner_id, google_account_id, refresh_token, scope)
    VALUES ($1,$2,$3,$4) ON CONFLICT (owner_id) DO UPDATE SET
    google_account_id = EXCLUDED.google_account_id, refresh_token = EXCLUDED.refresh_token,
    scope = EXCLUDED.scope, updated_at = now()', 'google_' || p_service || '_connections')
    USING p_owner_id, p_account_id, p_refresh_token, p_scope;
  UPDATE public.google_oauth_intents SET state_hash = NULL, expires_at = NULL
    WHERE owner_id = p_owner_id AND service = p_service;
  RETURN true;
END;
$$;

CREATE FUNCTION public.google_oauth_disconnect(p_service text, p_owner_id uuid)
RETURNS text LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE credential text;
BEGIN
  IF p_service NOT IN ('calendar', 'drive') OR p_service IS NULL THEN
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

REVOKE ALL ON FUNCTION public.google_oauth_start(text, uuid, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.google_oauth_publish(text, uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.google_oauth_disconnect(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.google_oauth_start(text, uuid, text, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.google_oauth_publish(text, uuid, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.google_oauth_disconnect(text, uuid) TO service_role;
COMMIT;
