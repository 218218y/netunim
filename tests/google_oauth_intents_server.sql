DO $$
DECLARE
  owner uuid := '11111111-1111-4111-8111-111111111111';
  v_service text;
  first_hash text := repeat('a',64);
  second_hash text := repeat('b',64);
BEGIN
  FOREACH v_service IN ARRAY ARRAY['calendar','drive'] LOOP
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
END;
$$;
