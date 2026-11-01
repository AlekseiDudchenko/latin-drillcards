-- One-time additive install. Serialize simultaneous attempts and fail before any
-- DDL if names are occupied. No existing table/function or Auth row is changed.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
SELECT pg_advisory_xact_lock(hashtextextended('drillcards-v2-install',0));
DO $$ DECLARE name text; BEGIN
  IF to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION 'Supabase Auth schema is required' USING ERRCODE='55000';
  END IF;
  FOREACH name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=name) THEN
      RAISE EXCEPTION 'Missing Supabase API role: %',name USING ERRCODE='55000';
    END IF;
  END LOOP;
  IF to_regnamespace('catalog_private') IS NOT NULL THEN
    RAISE EXCEPTION 'V2 catalog already exists; use a reviewed forward migration' USING ERRCODE='55000';
  END IF;
  FOREACH name IN ARRAY ARRAY['decks','deck_memberships','catalog_words','catalog_decks','catalog_sources','catalog_release','v2_environment','deck_memberships_word','decks_owner'] LOOP
    IF to_regclass(format('public.%I',name)) IS NOT NULL OR to_regtype(format('public.%I',name)) IS NOT NULL THEN
      RAISE EXCEPTION 'V2 name collision: public.%; existing data is unchanged',name USING ERRCODE='55000';
    END IF;
  END LOOP;
END $$;
