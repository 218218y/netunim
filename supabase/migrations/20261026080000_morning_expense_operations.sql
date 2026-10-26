-- Expense intake has an independent, durable account-wide duplicate boundary.
BEGIN;
CREATE TABLE public.morning_expense_operations (
  operation_id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  environment text NOT NULL CHECK (environment IN ('production', 'sandbox')),
  invoice_identity text NOT NULL CHECK (invoice_identity ~ '^[0-9a-f]{64}$'),
  request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  state text NOT NULL CHECK (state IN ('reserved', 'pending', 'created_unverified', 'created', 'needs_reconciliation', 'blocked')),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  expense_id uuid,
  sent_at timestamptz,
  verified_at timestamptz,
  file_state text NOT NULL DEFAULT 'not_started' CHECK (file_state IN ('not_started', 'ticket_issued', 'file_linked')),
  file_requested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (environment, invoice_identity),
  UNIQUE (environment, expense_id),
  CHECK (state <> 'created' OR (expense_id IS NOT NULL AND verified_at IS NOT NULL)),
  CHECK (state NOT IN ('pending', 'created_unverified', 'created', 'needs_reconciliation') OR sent_at IS NOT NULL)
);
ALTER TABLE public.morning_expense_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.morning_expense_operations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.morning_expense_operations TO service_role;
COMMENT ON TABLE public.morning_expense_operations IS 'Service-only expense intake evidence. Retain across account deletion; never blindly replay pending writes.';
COMMIT;
