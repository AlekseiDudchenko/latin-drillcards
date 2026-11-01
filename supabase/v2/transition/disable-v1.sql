-- Run as the project administrator. Idempotent; no data or Auth deletion.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$ DECLARE object record; column_names text; BEGIN
  -- Revoke PUBLIC too: functions are executable by PUBLIC by default.
  FOR object IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN
      ('upsert_progress','sync_progress','sync_srs_card','sync_daily','increment_daily') LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION %s FROM PUBLIC, anon, authenticated',object.oid::regprocedure);
  END LOOP;
  FOR object IN SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p')
      AND c.relname IN ('progress','daily_stats','srs_cards') LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %s FROM PUBLIC, anon, authenticated',object.oid::regclass);
    -- Table REVOKE alone does not remove explicit column grants.
    SELECT string_agg(quote_ident(attname),',') INTO column_names FROM pg_attribute
      WHERE attrelid=object.oid AND attnum>0 AND NOT attisdropped;
    IF column_names IS NOT NULL THEN
      EXECUTE format('REVOKE ALL PRIVILEGES (%s) ON TABLE %s FROM PUBLIC, anon, authenticated',column_names,object.oid::regclass);
    END IF;
  END LOOP;
END $$;
-- Effective checks also catch inherited grants; failure rolls back the transaction.
DO $$ DECLARE client text; object record; BEGIN
  FOREACH client IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOR object IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN
        ('upsert_progress','sync_progress','sync_srs_card','sync_daily','increment_daily') LOOP
      IF has_function_privilege(client,object.oid,'EXECUTE') THEN
        RAISE EXCEPTION 'v1 RPC % remains accessible by % (check inherited roles)',object.oid::regprocedure,client;
      END IF;
    END LOOP;
    FOR object IN SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname IN ('progress','daily_stats','srs_cards') LOOP
      IF has_table_privilege(client,object.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR has_any_column_privilege(client,object.oid,'SELECT,INSERT,UPDATE,REFERENCES') THEN
        RAISE EXCEPTION 'v1 table % remains accessible by % (check inherited roles)',object.oid::regclass,client;
      END IF;
    END LOOP;
  END LOOP;
END $$;
COMMIT;
