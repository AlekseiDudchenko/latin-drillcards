import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { assignIdentities, buildSeed, loadSources, normalizeEntry, IDENTITIES_PATH } from '../scripts/vocabulary-seed.mjs';
import { catalogSeedSql } from '../scripts/catalog-bootstrap.mjs';
import { catalogImportSql, catalogStateQuery, planCatalogImport } from '../scripts/catalog-import.mjs';

const A='00000000-0000-4000-8000-000000000001';
const REF='7db7afee5acec66afd8612f186281dfe97b0cbf1';
const NEXT='a23d2d2c0ffee0000000000000000000000000aa';
const schema=readFileSync(new URL('../supabase/v2/transition/fresh-project-preflight.sql',import.meta.url),'utf8')+
  readFileSync(new URL('../supabase/v2/migrations/001_catalog.sql',import.meta.url),'utf8');
const identities=JSON.parse(readFileSync(IDENTITIES_PATH,'utf8'));
const sources=loadSources();
const seed=buildSeed(identities,sources);

// The next seed, made the way an editor makes it: edit a deck, then `seed:assign`.
const entries=structuredClone(sources.entries);
const rosa=entries.find(e=>e.source==='basic:w_basic_1');
rosa.en='rose, flower'; // same sense (shares "rose"), new accepted wording
rosa.examples[0].translations.ru='Эта роза прекрасна.';
const lampe=entries.findIndex(e=>e.source==='basic:w_basic_3');
[entries[lampe],entries[lampe+1]]=[entries[lampe+1],entries[lampe]]; // terra and via swap places
entries.splice(entries.findIndex(e=>e.source==='basic:w_basic_2'),1); // aqua leaves every deck
entries.splice(lampe+1,0,normalizeEntry('basic',{id:'w_basic_test',la:'testarbor',pos:'noun',ru:'тестовое дерево',
  en:'test tree',exampleLa:'Testarbor viridis est.',exampleRu:'Тестовое дерево зелёное.',exampleEn:'The test tree is green.',tags:[]}));
const next=buildSeed(assignIdentities(identities,{entries}),{files:sources.files,entries});

let db;
const byId=(a,b)=>a.id<b.id?-1:1;
async function state() {
  await db.exec('BEGIN READ ONLY; SET LOCAL ROLE service_role');
  try { return JSON.parse((await db.query(catalogStateQuery)).rows[0].state); }
  finally { await db.exec('ROLLBACK'); }
}
async function apply(sql) {
  try { await db.exec(sql); }
  catch (error) { await db.exec('ROLLBACK'); throw error; }
}
const one=async(sql,params=[])=>(await db.query(sql,params)).rows;
const count=async table=>(await one(`SELECT count(*)::int n FROM catalog_private.${table}`))[0].n;

describe('seed update import into a live catalog (#356)',()=>{
  let before1;
  before(async()=>{
    db=new PGlite();
    await db.exec(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN BYPASSRLS;
      CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
      INSERT INTO auth.users VALUES ('${A}');`);
    await db.exec('BEGIN;\n'+schema+'\n'+catalogSeedSql(seed,{sourceRef:REF})+'COMMIT;');
    // A learner's own deck holds the word that will be retired and one that moves.
    await db.query("INSERT INTO public.decks VALUES ($1,'Mine',$2)",[`${A}:mine`,A]);
    await db.query("INSERT INTO public.deck_memberships VALUES ($1,'w-aqua',0),($1,'w-via',1)",[`${A}:mine`]);
    before1=await state();
  });
  after(async()=>{await db?.close();});

  test('the fixture seed has an edited, a new, a retired word and a reordered deck',()=>{
    const plan=planCatalogImport(before1,next);
    assert.deepEqual(plan.newWords.map(w=>w.id),['w-testarbor']);
    assert.deepEqual(plan.publish.map(p=>[p.word.id,p.word.contentVersion]),[['w-rosa',2]]);
    assert.deepEqual(plan.retire,['w-aqua']);
    assert.deepEqual(plan.decks.map(d=>d.deck.id),['basic']);
    assert.ok(next.retiredWordIds.includes('w-aqua'));
  });

  test('a stale state or a failure before commit leaves no half-publication',async()=>{
    const { sql }=catalogImportSql(before1,next,{sourceRef:NEXT});
    // Fails at COMMIT on the deferred pointer check, after every row was written.
    const broken=sql.replace(/COMMIT;\n$/,"UPDATE catalog_private.words SET published_version=99 WHERE id='w-terra';\nCOMMIT;\n");
    await assert.rejects(apply(broken),{code:'23503'});
    assert.deepEqual(await state(),before1);
    // The catalog moved after the export: the import refuses instead of applying an outdated diff.
    await db.exec("INSERT INTO catalog_private.words(id,sense_id) VALUES ('w-concurrent','w-concurrent')");
    await assert.rejects(apply(sql),/changed since its state was exported/);
    await db.exec("DELETE FROM catalog_private.words WHERE id='w-concurrent'");
    assert.deepEqual(await state(),before1);
  });

  test('import gives exactly the new seed models; old versions stay in history',async()=>{
    const revisions=await count('content_revisions');
    const { sql }=catalogImportSql(before1,next,{sourceRef:NEXT});
    assert.match(sql,/SET LOCAL ROLE service_role;/,'runs with the service role only');
    await apply(sql);
    await db.exec('SET ROLE anon');
    const words=(await one('SELECT word FROM public.catalog_words ORDER BY id')).map(r=>r.word);
    const decks=await one('SELECT id,title,"wordIds" FROM public.catalog_decks ORDER BY id');
    await db.exec('RESET ROLE');
    assert.deepEqual(words,[...next.words].sort(byId));
    assert.deepEqual(decks,[...next.decks].sort(byId));
    const a1=decks.find(d=>d.id==='basic').wordIds;
    assert.ok(a1.indexOf('w-via')<a1.indexOf('w-terra') && !a1.includes('w-aqua') && a1.includes('w-testarbor'));
    const history=async(id,version)=>(await one(`SELECT word FROM catalog_private.published_word_versions
      WHERE word_id=$1 AND content_version=$2`,[id,version]))[0]?.word;
    assert.deepEqual(await history('w-rosa',1),seed.words.find(w=>w.id==='w-rosa'));
    assert.deepEqual(await history('w-aqua',1),seed.words.find(w=>w.id==='w-aqua'));
    const [release]=await one('SELECT catalog_version,seed_version,source_ref FROM public.catalog_release');
    assert.deepEqual(release,{catalog_version:next.catalogVersion,seed_version:next.seedVersion,source_ref:NEXT});
    assert.equal(await count('catalog_imports'),2);
    assert.equal(await count('content_revisions'),revisions+9);
  });

  test('only changed elements get new revisions; unchanged ones keep their review',async()=>{
    const rows=await one(`SELECT kind,revision_id,review_id FROM catalog_private.publication_items
      WHERE word_id='w-rosa' AND content_version=2 ORDER BY kind,position`);
    const items=rows.map(r=>[r.kind,r.revision_id]);
    const v1='seed/w-rosa/1/', v2='seed/w-rosa/2/';
    assert.ok(rows.every(r=>r.review_id===r.revision_id+'/review'),'each item keeps the review of its own revision');
    assert.deepEqual(items.filter(([,id])=>id.startsWith(v2)).map(([kind])=>kind).sort(),['example_translation','translation']);
    assert.ok(items.some(([kind,id])=>kind==='word' && id.startsWith(v1)),'unchanged root is reused');
    assert.ok(items.some(([kind,id])=>kind==='translation' && id.startsWith(v1)),'unchanged RU gloss is reused');
    // Two for rosa (EN gloss, RU example translation), seven for the new word, nothing else.
    // New revisions carry the new commit in their provenance; reused ones keep their own.
    const fresh=await one(`SELECT r.word_id,count(DISTINCT r.id)::int n FROM catalog_private.content_revisions r
      JOIN catalog_private.content_sources s ON s.revision_id=r.id WHERE s.source_url LIKE $1 GROUP BY r.word_id ORDER BY r.word_id`,[`%/${NEXT}/%`]);
    assert.deepEqual(fresh,[{word_id:'w-rosa',n:2},{word_id:'w-testarbor',n:7}]);
  });

  test('retired word stays reserved and in personal decks; shared decks drop it',async()=>{
    assert.deepEqual(await one("SELECT published_version FROM catalog_private.words WHERE id='w-aqua'"),[{published_version:null}]);
    await assert.rejects(db.exec("INSERT INTO catalog_private.words(id,sense_id) VALUES ('w-aqua','x')"),{code:'23505'});
    assert.deepEqual(await one('SELECT word_id,position FROM public.deck_memberships WHERE deck_id=$1 ORDER BY position',[`${A}:mine`]),
      [{word_id:'w-aqua',position:0},{word_id:'w-via',position:1}],'personal deck untouched');
    assert.deepEqual(await one("SELECT deck_id FROM public.deck_memberships m JOIN public.decks d ON d.id=m.deck_id WHERE word_id='w-aqua' AND owner_id IS NULL"),[]);
  });

  test('importing the same seed again changes nothing',async()=>{
    const after1=await state();
    const again=catalogImportSql(after1,next,{sourceRef:NEXT});
    assert.equal(again.sql,null);
    assert.equal(again.plan.changed,false);
    // Re-running the applied file is refused before writing anything.
    await assert.rejects(apply(catalogImportSql(before1,next,{sourceRef:NEXT}).sql),/already imported/);
    assert.deepEqual(await state(),after1);
  });

  test('refuses a downgrade or a version that means other content',async()=>{
    const after1=await state();
    assert.throws(()=>planCatalogImport(after1,seed),/w-rosa: catalog has version 2, seed only 1/);
    const forged=structuredClone(next); forged.words.find(w=>w.id==='w-terra').tags=['forged'];
    assert.throws(()=>planCatalogImport(after1,forged),/w-terra: version 1 is published with other content/);
    assert.throws(()=>catalogImportSql(after1,next),/pinned/);
  });
});
