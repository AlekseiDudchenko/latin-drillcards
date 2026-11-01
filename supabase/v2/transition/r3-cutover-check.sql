-- Read-only acceptance check after disable-v1.sql.
-- v1 is retired; its runtime is not a release requirement.
-- Disabled functions and historical rows may remain; do not require a reset.
DO $$ DECLARE client text; object record; BEGIN
  FOREACH client IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOR object IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN
        ('upsert_progress','sync_progress','sync_srs_card','sync_daily','increment_daily') LOOP
      IF has_function_privilege(client,object.oid,'EXECUTE') THEN
        RAISE EXCEPTION 'R3: v1 RPC % remains executable by %',object.oid::regprocedure,client USING ERRCODE='55000';
      END IF;
    END LOOP;
    FOR object IN SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname IN ('progress','daily_stats','srs_cards') LOOP
      IF has_table_privilege(client,object.oid,'INSERT,UPDATE,DELETE,TRUNCATE')
        OR has_any_column_privilege(client,object.oid,'INSERT,UPDATE') THEN
        RAISE EXCEPTION 'R3: v1 table % remains writable by %',object.oid::regclass,client USING ERRCODE='55000';
      END IF;
    END LOOP;
  END LOOP;
END $$;
