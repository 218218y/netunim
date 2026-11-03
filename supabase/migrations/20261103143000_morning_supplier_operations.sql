BEGIN;
-- One durable send claim per tax identity, shared by every worker and browser.
CREATE TABLE public.morning_supplier_operations (
  environment text NOT NULL CHECK (environment IN ('production', 'sandbox')),
  tax_id text NOT NULL CHECK (tax_id ~ '^[0-9]{9}$'),
  owner_id uuid NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 180),
  state text NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved', 'sending', 'verified')),
  supplier_id uuid,
  sent_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment, tax_id),
  CHECK (state <> 'sending' OR sent_at IS NOT NULL),
  CHECK (state <> 'verified' OR (supplier_id IS NOT NULL AND verified_at IS NOT NULL))
);
ALTER TABLE public.morning_supplier_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.morning_supplier_operations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.morning_supplier_operations TO service_role;
COMMENT ON TABLE public.morning_supplier_operations IS 'Service-only supplier send claims; retain uncertain sends and reconcile against Morning. Never blindly replay.';
COMMIT;
