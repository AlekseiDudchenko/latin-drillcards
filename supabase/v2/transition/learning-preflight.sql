-- S1 forward migration preflight: the catalog/environment install must exist and
-- learning objects must not. Serialized with the install; no data is changed.
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(hashtextextended('drillcards-v2-install',0));
DO $$ DECLARE name text; BEGIN
  IF to_regclass('catalog_private.catalog_imports') IS NULL OR to_regclass('public.v2_environment') IS NULL THEN
    RAISE EXCEPTION 'Apply the v2 transition (001/002) first' USING ERRCODE='55000';
  END IF;
  FOREACH name IN ARRAY ARRAY['learning_owners','learning_tasks','learning_events','word_progress'] LOOP
    IF to_regclass(format('public.%I',name)) IS NOT NULL THEN
      RAISE EXCEPTION 'V2 learning name collision: public.%; existing data is unchanged',name USING ERRCODE='55000';
    END IF;
  END LOOP;
END $$;
