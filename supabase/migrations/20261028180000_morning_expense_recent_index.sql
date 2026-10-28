-- The default recent list reads ten verified site intakes without provider scans.
CREATE INDEX morning_expense_recent_created_idx
  ON public.morning_expense_operations (owner_id, environment, sent_at DESC, operation_id DESC)
  WHERE state = 'created';
