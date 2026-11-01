-- Read-only preparation. No user identities, tokens or response contents.
SELECT current_database() AS database_name,
  (SELECT count(*) FROM auth.users) AS auth_user_count,
  to_regnamespace('catalog_private') IS NOT NULL AS v2_catalog_exists,
  to_regclass('public.v2_environment') IS NOT NULL AS v2_environment_exists;
SELECT n.nspname AS schema_name,c.relname AS relation_name,c.relkind,c.relrowsecurity
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind IN ('r','v','m') ORDER BY c.relname;
SELECT p.oid::regprocedure::text AS signature,p.prosecdef AS security_definer
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN ('upsert_progress','sync_progress','increment_daily','sync_daily','sync_srs_card')
ORDER BY signature;
