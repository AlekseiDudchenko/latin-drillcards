import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { assertDecks, assertPublishedWord } from '../packages/vocabulary-core/dist/index.js';
import { buildSeed, loadSources, IDENTITIES_PATH } from '../scripts/vocabulary-seed.mjs';
import { catalogSeedSql } from '../scripts/catalog-bootstrap.mjs';

const A='00000000-0000-4000-8000-000000000001';
const B='00000000-0000-4000-8000-000000000002';
const REF='7db7afee5acec66afd8612f186281dfe97b0cbf1';
const schema=readFileSync(new URL('../supabase/v2/transition/fresh-project-preflight.sql',import.meta.url),'utf8')+
  readFileSync(new URL('../supabase/v2/migrations/001_catalog.sql',import.meta.url),'utf8');
const seed=buildSeed(JSON.parse(readFileSync(IDENTITIES_PATH,'utf8')),loadSources());
const seedSql=catalogSeedSql(seed,{sourceRef:REF});
let db;
let txDepth=0;
async function transaction(fn,rollback=false) {
  const nested=txDepth>0; const name=`catalog_test_${txDepth}`;
  await db.exec(nested ? `SAVEPOINT ${name}` : 'BEGIN');
  txDepth++;
  try {
    const result=await fn();
    if (rollback) await db.exec(nested ? `ROLLBACK TO SAVEPOINT ${name}` : 'ROLLBACK');
    else if (!nested) await db.exec('COMMIT');
    if (nested) await db.exec(`RELEASE SAVEPOINT ${name}`);
    return result;
  } catch (error) {
    await db.exec(nested ? `ROLLBACK TO SAVEPOINT ${name}; RELEASE SAVEPOINT ${name}` : 'ROLLBACK');
    throw error;
  } finally { txDepth--; }
}
async function role(name,user,sql,params=[]) {
  assert.ok(['anon','authenticated','service_role','public_probe'].includes(name));
  return transaction(async()=>{
    await db.exec(`SET LOCAL ROLE ${name}`);
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[user ?? '']);
    const result=await db.query(sql,params);
    await db.exec('RESET ROLE');
    return result;
  });
}
const rolledBack=fn=>transaction(fn,true);
const word=seed.words[0];
const root=`seed/${word.id}/${word.contentVersion}/word/${word.id}`;
const revisionSql=`INSERT INTO catalog_private.content_revisions(id,word_id,kind,entity_id,revision,content_hash)
  VALUES ('candidate',$1,'translation','candidate',1,repeat('a',64))`;

// Hand-built candidate revisions exercise the boundary independently of the seed writer.
async function stage(id,kind,table,columns,values,{confirmed=true,source=true,entityId=id,version=999}={}) {
  const digest=createHash('sha256').update(JSON.stringify(values)).digest('hex');
  await db.query(`INSERT INTO catalog_private.content_revisions(id,word_id,kind,entity_id,revision,content_hash)
    VALUES ($1,$2,$3,$4,$5,$6)`,[id,word.id,kind,entityId,version,digest]);
  await db.query(`INSERT INTO catalog_private.${table}(id,word_id,${columns.join(',')})
    VALUES (${Array.from({length:values.length+2},(_,i)=>'$'+(i+1)).join(',')})`,[id,word.id,...values]);
  if(source) await db.query(`INSERT INTO catalog_private.content_sources
    VALUES ($1,'fixture',$1,'revision-1','https://example.org/fixture','Test author','CC0-1.0',now(),false)`,[id]);
  if(confirmed) await db.query(`INSERT INTO catalog_private.content_reviews(id,revision_id,content_hash,decision,reviewer_kind)
    VALUES ($1,$2,$3,'confirmed','seed')`,[id+'/review',id,digest]);
  return {id,kind};
}
async function nextRoot() {
  const root=await stage('next-root','word','word_revisions',['lemma','part_of_speech'],['Testwort','other']);
  const ru=await stage('next-ru','translation','word_translations',['language','text'],['ru','новый перевод']);
  return [root,ru];
}
async function manifest(items) {
  const positions={};
  for(const item of items) {
    await db.query(`INSERT INTO catalog_private.publication_items(word_id,content_version,revision_id,kind,review_id,position)
      VALUES ($1,999,$2,$3,$4,$5)`,[word.id,item.id,item.kind,item.id+'/review',positions[item.kind]??0]);
    positions[item.kind]=(positions[item.kind]??0)+1;
  }
}
async function seal() {
  await db.query(`INSERT INTO catalog_private.word_publications(word_id,content_version,word_revision_id)
    VALUES ($1,999,'next-root')`,[word.id]);
}

describe('fresh v2 catalog: real PostgreSQL schema, complete seed and API permissions',()=>{
  before(async()=>{
    db=new PGlite();
    await db.exec(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN BYPASSRLS; CREATE ROLE public_probe NOLOGIN;
      CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
      INSERT INTO auth.users VALUES ('${A}'),('${B}');
      -- Simulate Supabase's permissive defaults; the migration must narrow them.
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated;
    `);
    await db.exec('BEGIN;\n'+schema+'\n'+seedSql+'COMMIT;');
  });
  after(async()=>{await db?.close();});

  test('full import matches every Word and Deck from F3, including examples and accepted translations',async()=>{
    const rows=(await role('anon',null,'SELECT word FROM public.catalog_words ORDER BY id')).rows;
    assert.equal(rows.length,seed.words.length);
    const actual=rows.map(r=>r.word);
    actual.forEach(assertPublishedWord);
    assert.deepEqual(actual,[...seed.words].sort((a,b)=>a.id<b.id?-1:1));
    const decks=(await role('anon',null,'SELECT id,title,"wordIds" FROM public.catalog_decks ORDER BY id')).rows;
    assert.deepEqual(decks,[...seed.decks].sort((a,b)=>a.id<b.id?-1:1));
    assertDecks(decks,actual);
    assert.equal((await db.query('SELECT count(*)::int n FROM auth.users')).rows[0].n,2,'no user import');
    const tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).rows.map(r=>r.tablename).sort();
    assert.deepEqual(tables,['deck_memberships','decks'],'no v1 tables/RPC or learning state needed');
  });

  test('example provenance points to the actual main/detail file containing that text',async()=>{
    const sources=(await role('anon',null,`SELECT revision_id,source_url FROM public.catalog_sources
      WHERE kind IN ('example','example_translation','association')`)).rows;
    assert.ok(sources.some(s=>s.revision_id.includes(':detail:')));
    for (const source of sources) {
      assert.equal(source.source_url.endsWith('-detail.json'),source.revision_id.includes(':detail:'),source.revision_id);
    }
  });

  test('a translation credits only the entries that wrote it and is identified by its text',async()=>{
    const hose=seed.words.find(w=>w.meanings.ru?.preferred==='брюки' && w.lemma==='Hose');
    // Private join (test superuser): which entry each stored translation revision credits.
    const rows=(await db.query(`SELECT s.source_id,r.entity_id,t.text FROM catalog_private.content_sources s
      JOIN catalog_private.content_revisions r ON r.id=s.revision_id JOIN catalog_private.word_translations t ON t.id=s.revision_id
      WHERE r.word_id=$1 AND t.language='ru' ORDER BY t.text`,[hose.id])).rows;
    assert.deepEqual(rows.map(r=>[r.text,r.source_id]),[['брюки',seed.provenance[hose.id][0]],['брюки, штаны',seed.provenance[hose.id][1]]]);
    assert.ok(rows.every(r=>/^[^/]+\/ru\/[0-9a-f]{16}$/.test(r.entity_id)),'entity id is the text hash, not a position');
  });

  test('the catalog release names the imported seed version, and retired IDs stay reserved',async()=>{
    const [release]=(await role('anon',null,'SELECT catalog_version,seed_version,source_ref FROM public.catalog_release')).rows;
    assert.deepEqual(release,{catalog_version:seed.catalogVersion,seed_version:seed.seedVersion,source_ref:REF});
    const retired=structuredClone(seed); retired.words=[]; retired.decks=[]; retired.retiredWordIds=['w-retired-fixture'];
    retired.catalogVersion='seed-retired-fixture';
    const sql=catalogSeedSql(retired,{sourceRef:REF});
    await rolledBack(async()=>{
      await db.exec(sql);
      assert.equal((await db.query("SELECT published_version FROM catalog_private.words WHERE id='w-retired-fixture'")).rows[0].published_version,null);
      assert.equal((await role('anon',null,"SELECT count(*)::int n FROM public.catalog_words WHERE id='w-retired-fixture'")).rows[0].n,0);
      await assert.rejects(rolledBack(()=>db.exec("INSERT INTO catalog_private.words(id,sense_id) VALUES ('w-retired-fixture','other')")),{code:'23505'});
    });
  });

  test('seed SQL is deterministic, pins repository sources and escapes quotes',()=>{
    assert.equal(catalogSeedSql(seed,{sourceRef:REF}),seedSql);
    assert.ok(seedSql.includes(`/blob/${REF}/`));
    assert.throws(()=>catalogSeedSql(seed),/pinned/);
    const tiny=structuredClone(seed); tiny.words=[tiny.words[0]]; tiny.words[0].lemma="O'Wort";tiny.decks=[];
    assert.ok(catalogSeedSql(tiny,{sourceRef:REF}).includes("O''Wort"));
  });

  test('all internal tables have RLS and no anon/authenticated/public access',async()=>{
    const tables=(await db.query("SELECT tablename,rowsecurity FROM pg_tables WHERE schemaname='catalog_private'")).rows;
    assert.ok(tables.length>=11 && tables.every(t=>t.rowsecurity));
    for (const name of ['anon','authenticated','public_probe']) {
      for (const t of tables) {
        await assert.rejects(role(name,A,`SELECT * FROM catalog_private.${t.tablename}`),{code:'42501'});
      }
      await assert.rejects(role(name,A,'SELECT * FROM catalog_private.published_word_versions'),{code:'42501'});
      assert.equal((await db.query("SELECT has_schema_privilege($1,'catalog_private','USAGE') ok",[name])).rows[0].ok,false);
    }
    const functions=(await db.query(`SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='catalog_private'`)).rows;
    for (const f of functions) for (const name of ['anon','authenticated','public_probe'])
      assert.equal((await db.query('SELECT has_function_privilege($1,$2::oid,\'EXECUTE\') ok',[name,f.oid])).rows[0].ok,false);
  });

  test('client cannot insert/update a publication, seed review or public word, even with a subject',async()=>{
    for (const name of ['anon','authenticated']) {
      for (const sql of [
        "UPDATE public.catalog_words SET word='{}'::jsonb",
        "DELETE FROM public.catalog_words",
        "INSERT INTO catalog_private.words(id,sense_id) VALUES ('forged','forged')",
        `UPDATE catalog_private.words SET published_version=NULL WHERE id='${word.id}'`,
        "INSERT INTO catalog_private.content_reviews(id,revision_id,content_hash,decision,reviewer_kind) VALUES ('forged','x',repeat('a',64),'confirmed','seed')",
      ]) await assert.rejects(role(name,A,sql),e=>['42501','55000'].includes(e.code));
    }
  });

  test('service can stage a candidate; neither an unreviewed text nor a reviewed-but-unpublished text leaks',async()=>{
    await rolledBack(async()=>{
      await role('service_role',null,revisionSql,[word.id]);
      await role('service_role',null,"INSERT INTO catalog_private.word_translations(id,word_id,language,text) VALUES ('candidate',$1,'ru','secret candidate')",[word.id]);
      const initial=(await role('anon',null,'SELECT word FROM public.catalog_words WHERE id=$1',[word.id])).rows;
      await role('service_role',null,`INSERT INTO catalog_private.content_reviews(id,revision_id,content_hash,decision,reviewer_kind)
        VALUES ('review-candidate','candidate',repeat('a',64),'confirmed','seed')`);
      assert.deepEqual((await role('anon',null,'SELECT word FROM public.catalog_words WHERE id=$1',[word.id])).rows,initial);
      assert.ok(!JSON.stringify(initial).includes('secret candidate'));
    });
  });

  test('users manage their own deck only; shared decks and other memberships cannot be altered',async()=>{
    await rolledBack(async()=>{
      for (const [user,id] of [[A,`${A}:personal-a`],[B,`${B}:personal-b`]]) {
        await role('authenticated',user,'INSERT INTO public.decks(id,title,owner_id) VALUES ($1,$1,$2)',[id,user]);
        await role('authenticated',user,'INSERT INTO public.deck_memberships(deck_id,word_id,position) VALUES ($1,$2,0)',[id,word.id]);
      }
      assert.equal((await role('anon',A,"SELECT * FROM public.decks WHERE id LIKE '%:personal-%'")).rows.length,0,'anon claim cannot read private decks');
      const a=(await role('authenticated',A,"SELECT id FROM public.catalog_decks WHERE id LIKE '%:personal-%'")).rows;
      assert.deepEqual(a,[{id:`${A}:personal-a`}]);
      assert.equal((await role('authenticated',A,'SELECT * FROM public.deck_memberships WHERE deck_id=$1',[`${B}:personal-b`])).rows.length,0);
      for (const owner of [null,B]) await assert.rejects(rolledBack(()=>role('authenticated',A,
        'INSERT INTO public.decks(id,title,owner_id) VALUES ($1,$1,$2)',[`${owner ?? A}:forged`,owner])),{code:'42501'});
    });
  });

  test('personal deck IDs live under their owner: no shared ID taken, no other user probed',async()=>{
    await rolledBack(async()=>{
      // A shared deck ID, an unprefixed name and another owner's prefix are refused by the namespace check.
      for (const id of ['a1','mine',`${B}:mine`]) await assert.rejects(rolledBack(()=>role('authenticated',A,
        'INSERT INTO public.decks(id,title,owner_id) VALUES ($1,$1,$2)',[id,A])),{code:'23514'},id);
      // Both users can use the same name: their IDs never collide, so a unique violation reveals nothing.
      for (const user of [A,B]) await role('authenticated',user,'INSERT INTO public.decks(id,title,owner_id) VALUES ($1,$2,$3)',[`${user}:mine`,'Mine',user]);
      await assert.rejects(rolledBack(()=>role('service_role',null,"INSERT INTO public.decks(id,title) VALUES ('x:y','Shared')")),{code:'23514'});
    });
  });

  test('owner cannot transfer a deck, edit a shared deck, or delete another user membership',async()=>{
    await rolledBack(async()=>{
      const mine=`${A}:mine`;
      await role('authenticated',A,"INSERT INTO public.decks VALUES ($1,'Mine',$2)",[mine,A]);
      await role('authenticated',A,'INSERT INTO public.deck_memberships VALUES ($1,$2,0)',[mine,word.id]);
      const deleted=await role('authenticated',B,'DELETE FROM public.deck_memberships WHERE deck_id=$1',[mine]);
      assert.equal(deleted.affectedRows,0);
      assert.equal((await role('authenticated',B,"UPDATE public.decks SET title='Stolen' WHERE id=$1",[mine])).affectedRows,0);
      assert.equal((await role('authenticated',A,"DELETE FROM public.decks WHERE owner_id IS NULL")).affectedRows,0);
      await assert.rejects(role('authenticated',A,'UPDATE public.decks SET owner_id=$1 WHERE id=$2',[B,mine]),{code:'42501'});
    });
  });

  test('candidate-only words cannot be added to a private deck',async()=>{
    await rolledBack(async()=>{
      await role('service_role',null,"INSERT INTO catalog_private.words(id,sense_id) VALUES ('pending','pending')");
      await role('authenticated',A,"INSERT INTO public.decks VALUES ($1,'Mine',$2)",[`${A}:mine`,A]);
      await assert.rejects(role('authenticated',A,"INSERT INTO public.deck_memberships VALUES ($1,'pending',0)",[`${A}:mine`]),{code:'42501'});
    });
  });

  test('wrong word, kind, stale hash and unconfirmed review cannot satisfy references',async()=>{
    for (const sql of [
      `INSERT INTO catalog_private.content_reviews(id,revision_id,content_hash,decision,reviewer_kind)
        VALUES ('bad','${root}',repeat('0',64),'confirmed','seed')`,
      `INSERT INTO catalog_private.word_translations(id,word_id,language,text) VALUES ('${root}','${word.id}','ru','wrong kind')`,
      `INSERT INTO catalog_private.word_publications VALUES ('${seed.words[1].id}',999,'${root}',now())`,
    ]) await assert.rejects(rolledBack(()=>db.exec(sql)),{code:'23503'});
    await assert.rejects(rolledBack(async()=>{
      await db.query(revisionSql,[word.id]);
      await db.exec(`INSERT INTO catalog_private.content_reviews(id,revision_id,content_hash,decision,reviewer_kind)
        VALUES ('rejected','candidate',repeat('a',64),'rejected','seed')`);
      await db.query(`INSERT INTO catalog_private.publication_items VALUES ($1,999,'candidate','translation','rejected','confirmed',0)`,[word.id]);
    }),{code:'23503'});
  });

  test('published history cannot be mutated or extended even by the service',async()=>{
    for (const sql of [
      `UPDATE catalog_private.word_revisions SET lemma='changed' WHERE id='${root}'`,
      `DELETE FROM catalog_private.content_reviews WHERE revision_id='${root}'`,
      `UPDATE catalog_private.content_revisions SET content_hash=repeat('0',64) WHERE id='${root}'`,
      `INSERT INTO catalog_private.publication_items SELECT word_id,content_version,revision_id,kind,review_id,decision,999
        FROM catalog_private.publication_items WHERE revision_id='${root}'`,
    ]) await assert.rejects(rolledBack(()=>db.exec(sql)),{code:'55000'});
  });

  test('a new version needs a reviewed root and meaning; invalid versions never become visible',async()=>{
    await assert.rejects(rolledBack(async()=>{
      await db.query('INSERT INTO catalog_private.word_publications(word_id,content_version,word_revision_id) VALUES ($1,999,$2)',[word.id,root]);
    }),{code:'23514'});
  });

  test('new publication is pinned; pending texts stay hidden and old snapshots remain readable by the service',async()=>{
    await rolledBack(async()=>{
      const items=await nextRoot();
      await stage('pending-en','translation','word_translations',['language','text'],['en','secret translation'],{confirmed:false});
      // Even another confirmed revision is excluded unless named in this manifest.
      await stage('unused-en','translation','word_translations',['language','text'],['en','unused translation']);
      await manifest(items); await seal();
      assert.deepEqual((await role('anon',null,'SELECT word FROM public.catalog_words WHERE id=$1',[word.id])).rows[0].word,word);
      await role('service_role',null,'UPDATE catalog_private.words SET published_version=999 WHERE id=$1',[word.id]);
      const next=(await role('anon',null,'SELECT word FROM public.catalog_words WHERE id=$1',[word.id])).rows[0].word;
      assertPublishedWord(next);
      assert.equal(next.contentVersion,999);
      assert.deepEqual(next.meanings,{ru:{preferred:'новый перевод',accepted:[]}});
      const sources=(await role('anon',null,'SELECT * FROM public.catalog_sources WHERE word_id=$1',[word.id])).rows;
      assert.deepEqual(sources.map(s=>s.revision_id).sort(),['next-root','next-ru']);
      assert.ok(sources.every(s=>!('reviewer_id' in s)));
      const old=(await role('service_role',null,`SELECT word FROM catalog_private.published_word_versions
        WHERE word_id=$1 AND content_version=$2`,[word.id,word.contentVersion])).rows[0].word;
      assert.deepEqual(old,word);
    });
  });

  test('untranslated or unrelated examples cannot be silently included in a publication',async()=>{
    for(const includeTranslation of [false,true]) await assert.rejects(rolledBack(async()=>{
      const items=await nextRoot();
      items.push(await stage('next-example','example','examples',['text'],['Das ist ein Beispiel.']));
      if(includeTranslation) items.push(await stage('next-example-en','example_translation','example_translations',
        ['example_id','language','text'],['next-example','en','This is an example.']));
      // The required reviewed association to this word/sense is deliberately absent.
      await manifest(items); await seal();
    }),{code:'23514'});
  });

  test('a complete example has independent text, translation and sense-association reviews',async()=>{
    await rolledBack(async()=>{
      const items=await nextRoot();
      items.push(await stage('next-example','example','examples',['text'],['Das ist ein Beispiel.']));
      items.push(await stage('next-example-en','example_translation','example_translations',
        ['example_id','language','text'],['next-example','en','This is an example.']));
      items.push(await stage('next-link','association','word_examples',['word_revision_id','example_id'],['next-root','next-example']));
      await manifest(items); await seal();
      await role('service_role',null,'UPDATE catalog_private.words SET published_version=999 WHERE id=$1',[word.id]);
      const model=(await role('anon',null,'SELECT word FROM public.catalog_words WHERE id=$1',[word.id])).rows[0].word;
      assertPublishedWord(model);
      assert.deepEqual(model.examples,[{id:'next-example',text:'Das ist ein Beispiel.',translations:{en:'This is an example.'}}]);
    });
  });

  test('missing provenance, duplicate accepted answers and duplicate example translations reject publication',async()=>{
    for(const defect of ['source','meaning','example-translation']) await assert.rejects(rolledBack(async()=>{
      const items=await nextRoot();
      if(defect==='source') items.push(await stage('no-source','translation','word_translations',
        ['language','text'],['en','missing source'],{source:false}));
      if(defect==='meaning') items.push(await stage('duplicate-ru','translation','word_translations',
        ['language','text'],['ru','новый перевод']));
      if(defect==='example-translation') {
        items.push(await stage('next-example','example','examples',['text'],['Das ist ein Beispiel.']));
        for(const id of ['en-1','en-2']) items.push(await stage(id,'example_translation','example_translations',
          ['example_id','language','text'],['next-example','en',id]));
        items.push(await stage('next-link','association','word_examples',['word_revision_id','example_id'],['next-root','next-example']));
      }
      await manifest(items); await seal();
    }),{code:'23514'});
  });

  test('duplicate memberships, invalid articles and invalid forms fail integrity checks',async()=>{
    await assert.rejects(rolledBack(()=>db.query(`INSERT INTO public.deck_memberships SELECT * FROM public.deck_memberships LIMIT 1`)),{code:'23505'});
    for(const [pos,article,forms] of [['verb','der',[]],['other',null,[' ']],['other',null,['x','x']]]) {
      await assert.rejects(rolledBack(()=>stage('invalid-word','word','word_revisions',
        ['lemma','part_of_speech','article','accepted_forms'],['test',pos,article,forms])),{code:'23514'});
    }
    await assert.rejects(role('public_probe',null,'SELECT * FROM public.catalog_words'),{code:'42501'});
    await assert.rejects(role('anon',null,"INSERT INTO public.decks VALUES ('anon','Anon',NULL)"),{code:'42501'});
    await assert.rejects(role('authenticated',null,"INSERT INTO public.decks VALUES ('missing-owner','Missing',NULL)"),{code:'42501'});
  });

  test('two revisions of the same element cannot be included together',async()=>{
    await assert.rejects(rolledBack(async()=>{
      const items=await nextRoot();
      items.push(await stage('next-ru-v2','translation','word_translations',['language','text'],
        ['ru','другая редакция'],{entityId:'next-ru',version:1000}));
      await manifest(items); await seal();
    }),{code:'23514'});
  });

  test('v1 database is refused without touching its tables',async()=>{
    const old=new PGlite();
    try {
      await old.exec('CREATE TABLE public.progress(id integer); INSERT INTO public.progress VALUES (123)');
      await assert.rejects(old.exec(schema),{code:'55000'});
      assert.deepEqual((await old.query('SELECT * FROM public.progress')).rows,[{id:123}]);
      assert.equal((await old.query("SELECT count(*)::int n FROM pg_namespace WHERE nspname='catalog_private'")).rows[0].n,0);
    } finally { await old.close(); }
  });

  test('deferred references reject an unsealed manifest or missing current version at commit',async()=>{
    await assert.rejects(transaction(()=>db.query(`INSERT INTO catalog_private.publication_items
      SELECT word_id,999,revision_id,kind,review_id,decision,position
      FROM catalog_private.publication_items WHERE revision_id=$1`,[root])),{code:'23503'});
    await assert.rejects(role('service_role',null,'UPDATE catalog_private.words SET published_version=999 WHERE id=$1',[word.id]),{code:'23503'});
    assert.equal((await role('anon',null,'SELECT content_version FROM public.catalog_words WHERE id=$1',[word.id])).rows[0].content_version,word.contentVersion);
  });

  test('bootstrap refuses an existing catalog without changing it',async()=>{
    const initial=(await db.query('SELECT count(*)::int n FROM public.catalog_words')).rows;
    await assert.rejects(rolledBack(()=>db.exec(schema)),{code:'42P06'});
    assert.deepEqual((await db.query('SELECT count(*)::int n FROM public.catalog_words')).rows,initial);
  });
});
