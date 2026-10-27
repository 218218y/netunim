-- OCR drafts have their own identity and never occupy a final expense_id.
BEGIN;
CREATE TABLE public.morning_expense_ocr_operations (
  operation_id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  environment text NOT NULL CHECK (environment IN ('sandbox', 'production')),
  file_sha256 text NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  file_size integer NOT NULL CHECK (file_size BETWEEN 1 AND 20971520),
  content_type text NOT NULL CHECK (content_type = 'application/pdf'),
  state text NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved', 'issuing', 'ticket_issued', 'accepted', 'processing', 'review_required')),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  business_id uuid,
  ticket_issued_at timestamptz,
  draft_id uuid,
  source_verified_at timestamptz,
  last_poll_at timestamptz,
  poll_count integer NOT NULL DEFAULT 0 CHECK (poll_count BETWEEN 0 AND 20),
  deferred_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (environment, file_sha256),
  UNIQUE (environment, draft_id),
  CHECK ((draft_id IS NULL) = (source_verified_at IS NULL)),
  CHECK (state NOT IN ('ticket_issued', 'accepted', 'processing', 'review_required') OR (business_id IS NOT NULL AND ticket_issued_at IS NOT NULL))
);
CREATE INDEX morning_expense_ocr_owner ON public.morning_expense_ocr_operations(owner_id, environment, created_at DESC);
ALTER TABLE public.morning_expense_ocr_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.morning_expense_ocr_operations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.morning_expense_ocr_operations TO service_role;
COMMENT ON TABLE public.morning_expense_ocr_operations IS 'Service-only OCR upload and source-byte linkage evidence. No approval or final expense identity. Retain uncertain uploads; never replay delivered forms.';
COMMIT;
