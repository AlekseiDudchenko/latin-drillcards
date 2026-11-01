-- Used only by the optional fresh bootstrap, never the existing-project transition.
DO $$ BEGIN
  IF to_regclass('public.progress') IS NOT NULL OR to_regclass('public.srs_cards') IS NOT NULL
    OR to_regclass('public.daily_stats') IS NOT NULL THEN
    RAISE EXCEPTION 'Use a fresh v2 database; v1 tables are present' USING ERRCODE='55000';
  END IF;
END $$;
