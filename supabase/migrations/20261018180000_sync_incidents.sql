-- Monitoring only. Never gates or mutates a business document or writer lease.
CREATE TABLE public.sync_incidents (
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  incident_id uuid NOT NULL,
  client_instance_id text NOT NULL CHECK (length(client_instance_id) BETWEEN 1 AND 160),
  device_label text NOT NULL CHECK (length(device_label) <= 80),
  site text NOT NULL CHECK (site IN ('orders','kupa')),
  domain text NOT NULL CHECK (domain IN ('orders_main','kupa_main','shared_checks','orders_sheet','kupa_sheet','orders_calendar')),
  scope_epoch text NOT NULL CHECK (length(scope_epoch) BETWEEN 1 AND 160),
  severity text NOT NULL CHECK (severity IN ('warning','critical')),
  reason_code text NOT NULL CHECK (reason_code IN ('stalled','conflict','recovery_blocked','local_durability_error')),
  evidence_kind text NOT NULL CHECK (evidence_kind IN ('journal','spreadsheet','calendar_queue','durability','unknown')),
  has_pending boolean NOT NULL,
  last_error_code text NOT NULL CHECK (length(last_error_code) <= 100),
  report_version bigint NOT NULL CHECK (report_version BETWEEN 1 AND 9007199254740991),
  first_reported_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_reported_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  resolved_at timestamptz,
  resolution_kind text CHECK (resolution_kind IN ('clean_verified','operator_reviewed_unverified')),
  PRIMARY KEY (owner_id,incident_id),
  CHECK ((resolved_at IS NULL) = (resolution_kind IS NULL)),
  CHECK (domain='shared_checks' OR domain LIKE site || '\_%' ESCAPE '\')
);
CREATE INDEX sync_incidents_active_owner ON public.sync_incidents(owner_id,first_reported_at) WHERE resolved_at IS NULL;
ALTER TABLE public.sync_incidents ENABLE ROW LEVEL SECURITY;
CREATE POLICY sync_incidents_owner ON public.sync_incidents FOR SELECT TO authenticated USING (owner_id=(SELECT auth.uid()));
REVOKE ALL ON public.sync_incidents FROM PUBLIC,anon,authenticated;

-- Shared validator/mutator is callable only by the reviewed public entrypoints.
CREATE FUNCTION netunim_internal.write_sync_incident_v1(p_incident jsonb,p_resolve boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE
  v_owner uuid:=auth.uid();
  v_row public.sync_incidents;
  v_existing public.sync_incidents;
BEGIN
  IF v_owner IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;
  IF p_resolve IS NULL OR jsonb_typeof(p_incident) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_incident->'report_version') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_incident->'has_pending') IS DISTINCT FROM 'boolean'
    OR EXISTS (SELECT 1 FROM unnest(ARRAY['incident_id','client_instance_id','device_label','site','domain','scope_epoch','severity','reason_code','evidence_kind','last_error_code']) k WHERE jsonb_typeof(p_incident->k) IS DISTINCT FROM 'string')
  THEN RAISE EXCEPTION 'sync_incident_invalid' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_row FROM jsonb_populate_record(NULL::public.sync_incidents,p_incident);
  IF v_row.report_version::numeric <> (p_incident->>'report_version')::numeric THEN RAISE EXCEPTION 'sync_incident_version_invalid' USING ERRCODE='22023'; END IF;
  INSERT INTO public.sync_incidents AS existing
    (owner_id,incident_id,client_instance_id,device_label,site,domain,scope_epoch,severity,reason_code,evidence_kind,has_pending,last_error_code,report_version,resolved_at,resolution_kind)
  VALUES (v_owner,v_row.incident_id,v_row.client_instance_id,v_row.device_label,v_row.site,v_row.domain,v_row.scope_epoch,v_row.severity,v_row.reason_code,v_row.evidence_kind,v_row.has_pending,v_row.last_error_code,v_row.report_version,
    CASE WHEN p_resolve THEN clock_timestamp() END,CASE WHEN p_resolve THEN 'clean_verified' END)
  ON CONFLICT (owner_id,incident_id) DO UPDATE SET
    device_label=excluded.device_label,severity=excluded.severity,reason_code=excluded.reason_code,
    evidence_kind=excluded.evidence_kind,has_pending=excluded.has_pending,last_error_code=excluded.last_error_code,
    report_version=excluded.report_version,last_reported_at=clock_timestamp(),
    resolved_at=excluded.resolved_at,resolution_kind=excluded.resolution_kind
  WHERE existing.resolved_at IS NULL AND existing.report_version < excluded.report_version
    AND existing.client_instance_id=excluded.client_instance_id AND existing.site=excluded.site
    AND existing.domain=excluded.domain AND existing.scope_epoch=excluded.scope_epoch;
  SELECT * INTO STRICT v_existing FROM public.sync_incidents WHERE owner_id=v_owner AND incident_id=v_row.incident_id;
  IF v_existing.client_instance_id<>v_row.client_instance_id OR v_existing.site<>v_row.site
    OR v_existing.domain<>v_row.domain OR v_existing.scope_epoch<>v_row.scope_epoch
  THEN RAISE EXCEPTION 'sync_incident_identity_mismatch' USING ERRCODE='22023'; END IF;
  RETURN to_jsonb(v_existing);
END $$;
REVOKE ALL ON FUNCTION netunim_internal.write_sync_incident_v1(jsonb,boolean) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.report_sync_incident_v1(p_incident jsonb)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT netunim_internal.write_sync_incident_v1(p_incident,false)
$$;
CREATE FUNCTION public.resolve_sync_incident_v1(p_incident jsonb)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT netunim_internal.write_sync_incident_v1(p_incident,true)
$$;
CREATE FUNCTION public.list_active_sync_incidents_v1()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_owner uuid:=auth.uid();
BEGIN
  IF v_owner IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY first_reported_at,incident_id),'[]'::jsonb)
    FROM public.sync_incidents i WHERE owner_id=v_owner AND resolved_at IS NULL);
END $$;
CREATE FUNCTION public.mark_sync_incident_reviewed_v1(p_incident_id uuid,p_expected_report_version bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_owner uuid:=auth.uid(); v_row public.sync_incidents;
BEGIN
  IF v_owner IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='42501'; END IF;
  UPDATE public.sync_incidents SET resolved_at=clock_timestamp(),resolution_kind='operator_reviewed_unverified'
    WHERE owner_id=v_owner AND incident_id=p_incident_id AND report_version=p_expected_report_version AND resolved_at IS NULL
    RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'sync_incident_changed_or_missing' USING ERRCODE='40001'; END IF;
  RETURN to_jsonb(v_row);
END $$;
REVOKE ALL ON FUNCTION public.report_sync_incident_v1(jsonb),public.resolve_sync_incident_v1(jsonb),public.list_active_sync_incidents_v1(),public.mark_sync_incident_reviewed_v1(uuid,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.report_sync_incident_v1(jsonb),public.resolve_sync_incident_v1(jsonb),public.list_active_sync_incidents_v1(),public.mark_sync_incident_reviewed_v1(uuid,bigint) TO authenticated;
COMMENT ON TABLE public.sync_incidents IS 'Persistent sync incidents and terminal tombstones. No TTL, presence or business-state authority.';
