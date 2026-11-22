BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.google_contacts_connections
  ADD COLUMN reconnect_required boolean NOT NULL DEFAULT false;

-- The existing trigger fires on OAuth publication, including a reconnect of
-- the same account. Refresh-token rotation leaves this marker in place.
CREATE OR REPLACE FUNCTION public.rotate_google_contacts_grant()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  NEW.grant_id := gen_random_uuid();
  NEW.reconnect_required := false;
  RETURN NEW;
END;
$$;

COMMIT;
