-- Additive source intent: no PDF bytes, invoice edits, or new financial POSTs.
BEGIN;
ALTER TABLE public.morning_expense_operations
  ADD COLUMN source_metadata jsonb,
  ADD COLUMN source_review jsonb,
  ADD COLUMN source_verified_at timestamptz,
  ADD COLUMN source_waived_at timestamptz,
  ADD COLUMN source_waived_reason text,
  ADD CONSTRAINT morning_expense_source_metadata_check CHECK (source_metadata IS NULL OR coalesce((
    jsonb_typeof(source_metadata)='object' AND source_metadata->>'sha256' ~ '^[0-9a-f]{64}$' AND
    jsonb_typeof(source_metadata->'size')='number' AND source_metadata->>'size' ~ '^[1-9][0-9]{0,7}$' AND
    (source_metadata->>'size')::bigint BETWEEN 1 AND 20971520 AND source_metadata->>'contentType' IN ('application/pdf','image/jpeg','image/png')),false)),
  ADD CONSTRAINT morning_expense_source_review_check CHECK (source_review IS NULL OR coalesce((
    source_metadata IS NOT NULL AND jsonb_typeof(source_review)='object' AND source_review->>'mode' IN ('extracted','manual')),false)),
  ADD CONSTRAINT morning_expense_source_verified_check CHECK (source_verified_at IS NULL OR source_metadata IS NOT NULL),
  ADD CONSTRAINT morning_expense_source_waived_check CHECK ((source_waived_at IS NULL AND source_waived_reason IS NULL) OR
    coalesce(((source_metadata IS NOT NULL OR file_requested_at IS NOT NULL) AND source_waived_at IS NOT NULL AND length(btrim(source_waived_reason)) BETWEEN 10 AND 250),false));
CREATE UNIQUE INDEX morning_expense_active_source_identity ON public.morning_expense_operations
  (environment,(source_metadata->>'sha256')) WHERE source_metadata IS NOT NULL AND state<>'cancelled';
CREATE INDEX morning_expense_pending_source ON public.morning_expense_operations(owner_id,environment,created_at DESC)
  WHERE (source_metadata IS NOT NULL OR file_requested_at IS NOT NULL) AND source_verified_at IS NULL AND source_waived_at IS NULL AND state<>'cancelled';

-- Policies come from paired reported PDFs (Roya/Gaber) and explicit user
-- confirmation of source numbers (Yesharim SI / Cocktail CR, 2026-10-27).
-- Hashes are issuer fingerprints from invoice-supplier-profiles.js.
-- Zero removal is a duplicate-comparison key; the submitted number is untouched.
CREATE FUNCTION public.morning_expense_number_key(issuer_hash text,pcn text,invoice_number text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE value text:=invoice_number;
BEGIN
  IF pcn='P' AND value ~ '^[0-9]+$' THEN RETURN coalesce(nullif(ltrim(value,'0'),''),'0'); END IF;
  IF issuer_hash='3048278b3ec7b2841cccebb31ce17340d5ea09b4d3f4ce0b9c4defa89d70c9b5' AND value ~ '^s?[0-9]+$' THEN
    value:=regexp_replace(value,'^s',''); RETURN coalesce(nullif(ltrim(value,'0'),''),'0');
  END IF;
  IF issuer_hash='e098e4875ada13457d0f4e32665585e2f77bac0a331bed94bd7f3631f057707a' AND value ~ '^(SI|CR)[0-9]+$' THEN
    RETURN regexp_replace(value,'^(SI|CR)','');
  END IF;
  IF issuer_hash='519266a7d546c1393e9f392d2eeadb67d07a80a60c91a223fa7b94878fcfa5f2' AND value ~ '^SI[0-9]+$' THEN
    RETURN regexp_replace(value,'^SI','');
  END IF;
  IF issuer_hash='4ea2a48a89e99699f3d5ae50253ed265790f8292c5bba3b30e58a04d10c80b85' AND value ~ '^CR[0-9]+$' THEN
    RETURN regexp_replace(value,'^CR','');
  END IF;
  RETURN value;
END $$;
REVOKE ALL ON FUNCTION public.morning_expense_number_key(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.morning_expense_number_key(text,text,text) TO service_role;

CREATE FUNCTION public.morning_expense_reservation_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE source_hash text; tax text; number_key text; issuer_hash text; other_record boolean;
BEGIN
  IF TG_TABLE_NAME='morning_expense_operations' THEN
    IF TG_OP='UPDATE' AND OLD.source_metadata IS NOT NULL AND NEW.source_metadata IS DISTINCT FROM OLD.source_metadata THEN
      RAISE check_violation USING MESSAGE='approved expense source is immutable';
    END IF;
    -- Arbitrate accounting identities against legacy rows too. Old workers
    -- execute the same trigger, even before the matching function is replaced.
    IF TG_OP='INSERT' AND NEW.state<>'cancelled' AND NEW.payload->'supplier'->>'taxId' ~ '^[0-9]{9}$' AND
      NEW.payload->>'documentType' IN ('305','330','320') AND NEW.payload->>'date' ~ '^[0-9]{4}-' AND NEW.payload->>'number' IS NOT NULL THEN
      tax:=NEW.payload->'supplier'->>'taxId';issuer_hash:=encode(sha256(convert_to('supplier-tax:'||tax,'UTF8')),'hex');
      number_key:=public.morning_expense_number_key(issuer_hash,NEW.payload->>'pcnClassification',NEW.payload->>'number');
      PERFORM pg_advisory_xact_lock(hashtextextended('morning-invoice:'||NEW.environment||':'||
        jsonb_build_array(tax,NEW.payload->>'documentType',left(NEW.payload->>'date',4),number_key)::text,0));
      SELECT EXISTS(SELECT 1 FROM public.morning_expense_operations op WHERE op.environment=NEW.environment AND op.state<>'cancelled' AND
        op.payload->'supplier'->>'taxId'=tax AND op.payload->>'documentType'=NEW.payload->>'documentType' AND
        left(op.payload->>'date',4)=left(NEW.payload->>'date',4) AND
        public.morning_expense_number_key(issuer_hash,op.payload->>'pcnClassification',op.payload->>'number')=number_key) INTO other_record;
      IF other_record THEN RAISE unique_violation USING MESSAGE='accounting invoice already reserved'; END IF;
    END IF;
    source_hash:=NEW.source_metadata->>'sha256';
  ELSE source_hash:=NEW.file_sha256;
  END IF;
  IF source_hash IS NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('morning-source:'||NEW.environment||':'||source_hash,0));
  IF TG_TABLE_NAME='morning_expense_operations' THEN
    SELECT EXISTS(SELECT 1 FROM public.morning_expense_ocr_operations op WHERE op.environment=NEW.environment AND op.file_sha256=source_hash) INTO other_record;
  ELSE
    SELECT EXISTS(SELECT 1 FROM public.morning_expense_operations op WHERE op.environment=NEW.environment AND op.state<>'cancelled' AND op.source_metadata->>'sha256'=source_hash) INTO other_record;
  END IF;
  IF other_record THEN RAISE unique_violation USING MESSAGE='source already reserved by another intake path'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.morning_expense_reservation_guard() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.morning_expense_reservation_guard() TO service_role;
CREATE TRIGGER morning_expense_reservation_guard BEFORE INSERT OR UPDATE OF source_metadata
  ON public.morning_expense_operations FOR EACH ROW EXECUTE FUNCTION public.morning_expense_reservation_guard();
CREATE TRIGGER morning_ocr_reservation_guard BEFORE INSERT
  ON public.morning_expense_ocr_operations FOR EACH ROW EXECUTE FUNCTION public.morning_expense_reservation_guard();
COMMENT ON COLUMN public.morning_expense_operations.source_metadata IS 'Approved source SHA-256, size and content type. No source bytes; immutable once bound.';
COMMIT;
