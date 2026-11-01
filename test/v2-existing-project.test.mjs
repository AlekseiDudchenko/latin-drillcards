import { after,before,describe,test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,readdirSync,existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { PGlite } from '@electric-sql/pglite';
import { parseV2Environment,v2Namespace } from '../public/v2/environment-config.js';

const A='00000000-0000-4000-8000-000000000001';
const B='00000000-0000-4000-8000-000000000002';
const legacy=['001_progress.sql','002_upsert_progress_rpc.sql','003_sync_progress_rpc.sql',
  '004_daily_stats.sql','005_srs_cards.sql','006_srs_card_type_pk.sql','007_rpc_authorization.sql'];
let transition;let db;let initial;
const read=path=>readFileSync(path,'utf8');
const snapshots=async db=>({
  data:await Promise.all(['auth.users','auth.identities','public.progress','public.daily_stats','public.srs_cards']
    .map(async name=>(await db.query(`SELECT to_jsonb(t) AS row FROM ${name} t ORDER BY to_jsonb(t)::text`)).rows)),
  funcs:(await db.query(`SELECT p.oid::regprocedure::text AS signature,pg_get_functiondef(p.oid) AS definition,p.proacl::text AS acl
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
    AND p.proname IN ('upsert_progress','sync_progress','increment_daily','sync_daily','sync_srs_card') ORDER BY signature`)).rows,
  policies:(await db.query(`SELECT tablename,policyname,roles,cmd,qual,with_check FROM pg_policies
    WHERE schemaname='public' AND tablename IN ('progress','daily_stats','srs_cards') ORDER BY tablename,policyname`)).rows,
  grants:(await db.query(`SELECT relname,relacl::text,relrowsecurity FROM pg_class WHERE oid IN
    ('public.progress'::regclass,'public.daily_stats'::regclass,'public.srs_cards'::regclass) ORDER BY relname`)).rows,
});
async function legacyDb() {
  const db=new PGlite();
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE TABLE auth.identities(id text PRIMARY KEY,user_id uuid REFERENCES auth.users(id),provider text);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
    INSERT INTO auth.users VALUES ('${A}'),('${B}');
    INSERT INTO auth.identities VALUES ('google-a','${A}','google'),('google-b','${B}','google');`);
  for(const file of legacy)await db.exec(read(`supabase/migrations/${file}`));
  await db.exec(`GRANT SELECT,INSERT,UPDATE,DELETE ON public.progress,public.daily_stats,public.srs_cards TO authenticated;
    INSERT INTO public.progress(user_id,exercise,level,item_id,correct,wrong) VALUES ('${A}','words','a1','old-item',12,3),('${B}','words','a1','old-item',7,2);
    INSERT INTO public.daily_stats(user_id,answers) VALUES ('${A}',17),('${B}',9);
    INSERT INTO public.srs_cards(user_id,card_id,reps,stability) VALUES ('${A}','old-card',5,11),('${B}','old-card',3,8);`);
  return db;
}
async function apply(db,sql=transition) {
  try {await db.exec(sql);} catch(error) {await db.exec('ROLLBACK');throw error;}
}

describe('transition into the existing Supabase project',()=>{
  before(async()=>{
    const env={...process.env};
    for(const key of Object.keys(env))if(key.startsWith('V2_') || key==='DRILLCARDS_V2_ENV')delete env[key];
    execFileSync(process.execPath,['--env-file=config/v2/existing-preview.env.example','scripts/prepare-v2-deployment.mjs'],{env});
    transition=read('build/v2/preview/transition.sql');db=await legacyDb();initial=await snapshots(db);
    await apply(db);
  });
  after(async()=>{await db?.close();});

  test('preserves Auth users, Google identities, legacy rows, RPC definitions/grants and RLS exactly',async()=>{
    assert.deepEqual(await snapshots(db),initial);
    assert.equal((await db.query('SELECT count(*)::int n FROM public.catalog_words')).rows[0].n,1306);
    assert.equal((await db.query('SELECT count(*)::int n FROM public.catalog_decks')).rows[0].n,8);
    assert.deepEqual((await db.query('SELECT environment,data_epoch FROM public.v2_environment')).rows,
      [{environment:'preview',data_epoch:'v2-preview-20261027'}]);
  });

  test('the existing project URL is accepted but v2 Auth storage is separate from v1',()=>{
    const manifest=JSON.parse(read('build/v2/preview/transition.json'));
    assert.equal(manifest.target,'existing-project');assert.equal(manifest.projectRef,'xdwacapyjeeeeemlkaqq');
    assert.equal(manifest.preserveAuthUsers,true);assert.equal(manifest.preserveLegacyProgress,true);assert.equal(manifest.importLegacyProgress,false);
    assert.deepEqual(manifest.auth,{preserveGoogleProvider:true,preserveSiteUrl:true,addRedirect:'https://drillcards.org/v2/environment.html'});
    const config=parseV2Environment({schemaVersion:1,configured:true,environment:'preview',supabaseUrl:manifest.supabaseUrl,
      siteUrl:'https://drillcards.org/v2/',publishableKey:'sb_publishable_test_123456789',dataEpoch:manifest.dataEpoch,epochStartedAt:manifest.epochStartedAt});
    assert.ok(v2Namespace(config).startsWith('drillcards-v2:preview:'));
    assert.ok(!existsSync('build/v2/preview/supabase/migrations'));
    assert.ok(!existsSync('build/v2/preview/supabase/seed.sql'));
    assert.ok(!read('build/v2/preview/supabase/config.toml').includes('[auth]'));
  });

  test('retirement blocks all legacy API access, preserves Auth/history and leaves v2 readable',async()=>{
    const retired=await legacyDb();
    try {
      await apply(retired);
      const before=await snapshots(retired);
      await retired.exec('GRANT SELECT(correct),UPDATE(correct) ON public.progress TO authenticated');
      const disable=read('build/v2/preview/disable-v1.sql');
      await retired.exec(disable); await retired.exec(disable); // safe to retry
      await retired.exec(read('supabase/v2/transition/r3-cutover-check.sql'));
      assert.deepEqual((await snapshots(retired)).data,before.data);
      for(const role of ['anon','authenticated']) {
        await retired.exec(`BEGIN;SET LOCAL ROLE ${role}`);
        await assert.rejects(retired.query('SELECT * FROM public.progress'),{code:'42501'});
        await retired.exec('ROLLBACK');
        await retired.exec(`BEGIN;SET LOCAL ROLE ${role}`);
        await assert.rejects(retired.query("SELECT public.upsert_progress($1,'words','a1','blocked',NULL,1,0)",[A]),{code:'42501'});
        await retired.exec('ROLLBACK');
        await retired.exec(`BEGIN;SET LOCAL ROLE ${role}`);
        assert.equal((await retired.query('SELECT count(*)::int n FROM public.catalog_words')).rows[0].n,1306);
        await retired.exec('ROLLBACK');
      }
    } finally {await retired.close();}
  });

  test('reapplying refuses the existing v2 catalog without overwriting either version',async()=>{
    const words=(await db.query('SELECT count(*)::int n FROM public.catalog_words')).rows;
    await assert.rejects(apply(db),{code:'55000'});
    assert.deepEqual((await db.query('SELECT count(*)::int n FROM public.catalog_words')).rows,words);
    assert.deepEqual(await snapshots(db),initial);
  });

  test('the S1 learning migration applies after the transition, pins the imported catalog and is not reapplied',async()=>{
    const learning=read('build/v2/preview/learning.sql');
    await apply(db,learning);
    assert.deepEqual((await db.query(`SELECT count(*)::int n,count(DISTINCT catalog_version)::int versions
      FROM catalog_private.catalog_snapshot_words`)).rows,[{n:1306,versions:1}]);
    assert.equal((await db.query('SELECT count(*)::int n FROM public.word_progress')).rows[0].n,0,'no legacy progress import');
    await assert.rejects(apply(db,learning),{code:'55000'});
    assert.deepEqual(await snapshots(db),initial);
    assert.ok(existsSync('build/v2/preview/supabase/functions/_shared/vocabulary-core/index.js'),'intake function ships the shared core');
    assert.match(read('build/v2/preview/supabase/config.toml'),/\[functions\.v2-learning-events\]\nverify_jwt = false/);
    const fresh=await legacyDb();
    try {await assert.rejects(apply(fresh,learning),{code:'55000'});} finally {await fresh.close();}
  });

  test('item learning and the deployed item datasets apply after S1; the datasets are exactly the served files and idempotent',async()=>{
    await apply(db,read('build/v2/preview/learning-items.sql'));
    const datasets=read('build/v2/preview/item-datasets.sql');
    await apply(db,datasets);
    const files=readdirSync('public/data/items').filter(f=>f.endsWith('.json')).sort()
      .map(f=>JSON.parse(read(`public/data/items/${f}`))).map(({id,version})=>({dataset_id:id,version}));
    const published=(await db.query('SELECT dataset_id,version FROM catalog_private.item_datasets ORDER BY dataset_id')).rows;
    assert.deepEqual(published,[...files].sort((a,b)=>a.dataset_id<b.dataset_id?-1:1));
    assert.deepEqual(JSON.parse(read('build/v2/preview/transition.json')).itemDatasets.map(d=>d.id).sort(),files.map(f=>f.dataset_id).sort());
    await apply(db,datasets);
    assert.equal((await db.query('SELECT count(*)::int n FROM catalog_private.item_datasets')).rows[0].n,files.length);
    assert.deepEqual(await snapshots(db),initial);
  });

  for (const name of ['decks','catalog_release','decks_owner']) {
    test(`preflight refuses a colliding ${name} before changing Auth/v1 or creating the catalog`,async()=>{
      const collision=await legacyDb();
      try {
        await collision.exec(`CREATE TABLE public.${name}(id text PRIMARY KEY);INSERT INTO public.${name} VALUES ('keep-existing')`);
        const before=await snapshots(collision);
        await assert.rejects(apply(collision),{code:'55000'});
        assert.deepEqual((await collision.query(`SELECT * FROM public.${name}`)).rows,[{id:'keep-existing'}]);
        assert.deepEqual(await snapshots(collision),before);
        assert.equal((await collision.query("SELECT to_regnamespace('catalog_private') IS NULL absent")).rows[0].absent,true);
      } finally {await collision.close();}
    });
  }

  test('preflight also detects a standalone type that would collide with a new table',async()=>{
    const collision=await legacyDb();
    try {
      await collision.exec("CREATE TYPE public.decks AS ENUM ('keep-existing')");
      await assert.rejects(apply(collision),{code:'55000'});
      assert.equal((await collision.query("SELECT to_regnamespace('catalog_private') IS NULL absent")).rows[0].absent,true);
      assert.deepEqual((await collision.query("SELECT unnest(enum_range(NULL::public.decks))::text value")).rows,[{value:'keep-existing'}]);
    } finally {await collision.close();}
  });

  test('R3-only gate rejects every callable legacy overload and direct/column writes, then accepts revoked access without deleting history',async()=>{
    const cutover=await legacyDb();
    const check=read('supabase/v2/transition/r3-cutover-check.sql');
    try {
      const before=await snapshots(cutover);
      await cutover.exec('CREATE FUNCTION public.sync_progress(p jsonb) RETURNS void LANGUAGE sql AS $$ SELECT $$');
      await assert.rejects(cutover.exec(check),{code:'55000'});
      await cutover.exec('REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC,anon,authenticated');
      await assert.rejects(cutover.exec(check),{code:'55000'});
      await cutover.exec('REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON public.progress,public.daily_stats,public.srs_cards FROM PUBLIC,anon,authenticated');
      await cutover.exec('GRANT UPDATE(correct) ON public.progress TO authenticated');
      await assert.rejects(cutover.exec(check),{code:'55000'});
      await cutover.exec('REVOKE UPDATE(correct) ON public.progress FROM authenticated');
      await cutover.exec(check);
      assert.deepEqual((await snapshots(cutover)).data,before.data);
      assert.ok((await cutover.query("SELECT to_regprocedure('public.sync_progress(jsonb)') IS NOT NULL kept")).rows[0].kept);
    } finally {await cutover.close();}
  });

  test('a failure after loading the seed rolls back all new objects and preserves v1/Auth',async()=>{
    const failed=await legacyDb();
    try {
      const before=await snapshots(failed);
      await assert.rejects(apply(failed,transition.replace(/COMMIT;\s*$/,'SELECT 1/0;\nCOMMIT;')),{code:'22012'});
      assert.deepEqual(await snapshots(failed),before);
      assert.equal((await failed.query("SELECT to_regnamespace('catalog_private') IS NULL absent,to_regclass('public.v2_environment') IS NULL no_meta")).rows[0].absent,true);
      assert.equal((await failed.query("SELECT to_regclass('public.v2_environment') IS NULL absent")).rows[0].absent,true);
    } finally {await failed.close();}
  });
});
