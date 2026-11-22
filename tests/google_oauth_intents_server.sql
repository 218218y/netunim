DO $$
DECLARE
  owner uuid := '11111111-1111-4111-8111-111111111111';
  v_service text;
  first_hash text := repeat('a',64);
  second_hash text := repeat('b',64);
  captured_grant uuid;
BEGIN
  FOREACH v_service IN ARRAY ARRAY['calendar','drive','contacts'] LOOP
    PERFORM public.google_oauth_start(v_service,owner,first_hash,'https://example.invalid',now()+interval '10 minutes');
    PERFORM public.google_oauth_disconnect(v_service,owner);
    IF public.google_oauth_publish(v_service,owner,first_hash,'old','old','scope') THEN
      RAISE EXCEPTION 'disconnected callback resurrected connection';
    END IF;
    PERFORM public.google_oauth_start(v_service,owner,first_hash,'https://example.invalid',now()+interval '10 minutes');
    PERFORM public.google_oauth_start(v_service,owner,second_hash,'https://example.invalid',now()+interval '10 minutes');
    IF public.google_oauth_publish(v_service,owner,first_hash,'old','old','scope') THEN
      RAISE EXCEPTION 'older callback superseded new intent';
    END IF;
    IF NOT public.google_oauth_publish(v_service,owner,second_hash,'new','new','scope') THEN
      RAISE EXCEPTION 'current callback rejected';
    END IF;
    IF public.google_oauth_publish(v_service,owner,second_hash,'replay','replay','scope') THEN
      RAISE EXCEPTION 'publication replay accepted';
    END IF;
    IF public.google_oauth_disconnect(v_service,owner) <> 'new' THEN
      RAISE EXCEPTION 'wrong captured credential removed';
    END IF;
    PERFORM public.google_oauth_start(v_service,owner,first_hash,'https://example.invalid',now()+interval '10 minutes');
    UPDATE public.google_oauth_intents SET expires_at=now()-interval '1 second'
      WHERE owner_id=owner AND google_oauth_intents.service=v_service;
    IF public.google_oauth_publish(v_service,owner,first_hash,'expired','expired','scope') THEN
      RAISE EXCEPTION 'expired callback accepted';
    END IF;
    PERFORM public.google_oauth_disconnect(v_service,owner);
  END LOOP;
  PERFORM public.google_oauth_start('contacts',owner,first_hash,'https://example.invalid',now()+interval '10 minutes');
  PERFORM public.google_oauth_publish('contacts',owner,first_hash,'fixture@example.test','first','scope');
  SELECT grant_id INTO STRICT captured_grant FROM public.google_contacts_connections WHERE owner_id=owner;
  FOR request_number IN 1..40 LOOP
    IF NOT public.take_google_contacts_search_slot(owner, captured_grant) THEN
      RAISE EXCEPTION 'Premature contact search throttle';
    END IF;
  END LOOP;
  IF public.take_google_contacts_search_slot(owner, captured_grant) THEN RAISE EXCEPTION 'Contact search throttle failed'; END IF;
  UPDATE public.google_contacts_connections SET search_window_start=now()-interval '2 minutes', refresh_token='rotated' WHERE owner_id=owner;
  IF NOT public.take_google_contacts_search_slot(owner, captured_grant) THEN RAISE EXCEPTION 'Window or rotation broke contact lookup'; END IF;
  UPDATE public.google_contacts_connections SET reconnect_required=true WHERE owner_id=owner AND grant_id=captured_grant;
  IF NOT EXISTS (SELECT 1 FROM public.google_contacts_connections WHERE owner_id=owner AND grant_id=captured_grant AND reconnect_required) THEN
    RAISE EXCEPTION 'Revoking a grant lost its identity';
  END IF;
  PERFORM public.google_oauth_start('contacts',owner,second_hash,'https://example.invalid',now()+interval '10 minutes');
  PERFORM public.google_oauth_publish('contacts',owner,second_hash,'fixture@example.test','second','scope');
  IF NOT EXISTS (SELECT 1 FROM public.google_contacts_connections WHERE owner_id=owner AND grant_id<>captured_grant AND NOT reconnect_required) THEN
    RAISE EXCEPTION 'Publishing a new grant did not clear reconnection state';
  END IF;
  IF public.take_google_contacts_search_slot(owner, captured_grant) THEN RAISE EXCEPTION 'Replaced contact grant remained usable'; END IF;
  PERFORM public.google_oauth_disconnect('contacts',owner);
END;
$$;
