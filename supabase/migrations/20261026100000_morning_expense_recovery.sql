BEGIN;
ALTER TABLE public.morning_expense_operations
  DROP CONSTRAINT morning_expense_operations_state_check,
  DROP CONSTRAINT morning_expense_operations_file_state_check,
  DROP CONSTRAINT morning_expense_operations_environment_invoice_identity_key,
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN file_generation uuid,
  ADD COLUMN file_expires_at timestamptz,
  ADD COLUMN file_content_type text,
  ADD COLUMN file_size bigint,
  ADD CONSTRAINT morning_expense_operations_state_check CHECK (state IN ('reserved', 'pending', 'created_unverified', 'created', 'needs_reconciliation', 'blocked', 'cancelled')),
  ADD CONSTRAINT morning_expense_operations_file_state_check CHECK (file_state IN ('not_started', 'prepared', 'upload_started', 'ticket_issued', 'file_accepted', 'file_linked')),
  ADD CONSTRAINT morning_expense_cancelled_check CHECK (state <> 'cancelled' OR (cancelled_at IS NOT NULL AND sent_at IS NULL AND expense_id IS NULL AND verified_at IS NULL)),
  ADD CONSTRAINT morning_expense_file_prepared_check CHECK (file_state NOT IN ('prepared', 'upload_started') OR (file_generation IS NOT NULL AND file_expires_at IS NOT NULL AND file_content_type IS NOT NULL AND file_content_type IN ('application/pdf', 'image/jpeg', 'image/png') AND file_size IS NOT NULL AND file_size > 0 AND file_size <= 20971520));
-- Cancellation retains the operation forever, releasing only a provably unsent invoice.
CREATE UNIQUE INDEX morning_expense_active_invoice_identity
  ON public.morning_expense_operations(environment, invoice_identity) WHERE state <> 'cancelled';
COMMIT;
