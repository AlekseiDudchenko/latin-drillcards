import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import * as core from '../packages/vocabulary-core/dist/index.js';
import { buildSeed, loadSources, IDENTITIES_PATH } from '../scripts/vocabulary-seed.mjs';
import { catalogSeedSql } from '../scripts/catalog-bootstrap.mjs';
import { createLearningEventsHandler, ingestLearningEvents } from '../supabase/v2/functions/v2-learning-events/handler.js';

// Real migrations 001–003 in embedded PostgreSQL; only Supabase's auth schema and
// API roles are fixtures. The intake logic runs the shared compiled core.
const A='00000000-0000-4000-8000-000000000001';
const B='00000000-0000-4000-8000-000000000002';
const C='00000000-0000-4000-8000-000000000003';
const EPOCH='s1-test';
const REF='7db7afee5acec66afd8612f186281dfe97b0cbf1';
const read=path=>readFileSync(new URL(`../supabase/v2/${path}`,import.meta.url),'utf8');
const seed=buildSeed(JSON.parse(readFileSync(IDENTITIES_PATH,'utf8')),loadSources());
const registry=core.createWordExerciseRegistry(seed.words,seed.catalogVersion);
const noun=seed.words.find(w=>w.partOfSpeech==='noun' && w.meanings.ru && registry.availability('meaning-choice',w,{answerLanguage:'ru',seed:'s',taskId:'t'}).available);
const verb=seed.words.find(w=>w.partOfSpeech==='verb' && w.meanings.ru);
let db;

async function as(role,user,sql,params=[]) {
  await db.exec('BEGIN');
  try {
    await db.exec(`SET LOCAL ROLE ${role}`);
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[user ?? '']);
    const result=await db.query(sql,params);
    await db.exec('COMMIT');
    return result;
  } catch(error) { await db.exec('ROLLBACK'); throw error; }
}
const service=(sql,params)=>as('service_role',null,sql,params);
const one=async(sql,params)=>(await service(sql,params)).rows[0].r;
const catalogs=new Map();
const store={
  state:(userId,ids)=>one('SELECT public.v2_learning_state($1,$2,$3,$4,$5,$6) AS r',
    [userId,ids.wordIds,ids.taskIds,ids.eventIds,ids.commandIds,ids.attemptIds]),
  async catalog(version) {
    if(!catalogs.has(version)) {
      const snapshot=await one('SELECT public.v2_catalog_snapshot($1) AS r',[version]);
      catalogs.set(version,snapshot && core.createWordExerciseRegistry(snapshot.words,snapshot.catalogVersion));
    }
    return catalogs.get(version);
  },
  commit:(userId,batch)=>one('SELECT public.v2_commit_learning($1,$2,$3,$4::jsonb,$5::jsonb) AS r',
    [userId,batch.dataEpoch,batch.receivedAt,JSON.stringify(batch.events),JSON.stringify(batch.projections)]),
};
const now=()=>new Date().toISOString();
const ingest=(userId,items,s=store)=>ingestLearningEvents({core,store:s,userId,items,now});
let counter=0;
const minutesAgo=m=>new Date(Math.floor(Date.now()/1000)*1000-m*60000).toISOString();
function task(word,exerciseId='target-type',taskId=`task-${++counter}`) {
  return registry.get(exerciseId).buildTask(word,{answerLanguage:'ru',seed:`seed-${counter}`,taskId});
}
function answer(t,rawAnswer,over={}) {
  const id=++counter;
  return {schemaVersion:1,kind:'answer',eventId:`event-${id}`,commandId:`command-${id}`,attemptId:`attempt-${id}`,
    sessionId:'session-1',taskId:t.id,target:t.target,exerciseId:t.exerciseId,intent:'learn-new',answerLanguage:'ru',
    occurredAt:minutesAgo(30-id%20),studyTimezone:'UTC',taskVersion:t.taskVersion,contentVersion:t.contentVersion,
    policyVersion:'evidence/1',dataEpoch:EPOCH,rawAnswer,assisted:false,exposure:[],...over};
}
const count=async(table,user)=>(await db.query(`SELECT count(*)::int n FROM public.${table} WHERE user_id=$1`,[user])).rows[0].n;
const progressRow=async(user,word)=>(await db.query('SELECT * FROM public.word_progress WHERE user_id=$1 AND word_id=$2',[user,word])).rows[0];
async function journal(user,word) {
  return (await db.query(`SELECT event,evaluation,to_char(received_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "receivedAt"
    FROM public.learning_events WHERE user_id=$1 AND word_id=$2 ORDER BY sequence`,[user,word])).rows;
}
async function expectedProgress(user,word,asOf) {
  const env=(await db.query(`SELECT data_epoch,to_char(epoch_started_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') s FROM public.v2_environment`)).rows[0];
  const owner={kind:'account',id:user};
  const records=(await journal(user,word.id)).map(r=>({owner,event:r.event,receivedAt:r.receivedAt,...(r.evaluation ? {evaluation:r.evaluation} : {})}));
  return core.replayWord(word,records,{owner,dataEpoch:env.data_epoch,epochStartedAt:env.s,asOf}).progress;
}

describe('S1: server event intake and transactional projection',()=>{
  before(async()=>{
    db=new PGlite();
    await db.exec(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
      CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
      INSERT INTO auth.users VALUES ('${A}'),('${B}'),('${C}');
      -- Simulate Supabase's permissive defaults; the migrations must narrow them.
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated;`);
    // Install as the existing project did (catalog first), then the forward migration.
    await db.exec('BEGIN;\n'+read('transition/fresh-project-preflight.sql')+read('migrations/001_catalog.sql')+
      read('migrations/002_environment.sql')+catalogSeedSql(seed,{sourceRef:REF})+
      `INSERT INTO public.v2_environment VALUES (true,1,'local','${EPOCH}','2026-01-01T00:00:00Z');\nCOMMIT;`);
    await db.exec('BEGIN;\n'+read('transition/learning-preflight.sql')+read('migrations/003_learning.sql')+'\nCOMMIT;');
  });
  after(async()=>{await db?.close();});

  test('an answer commits its event, archived task, server evaluation and projection atomically',async()=>{
    const t=task(noun);
    const event=answer(t,noun.lemma);
    const result=await ingest(A,[{event,task:t}]);
    assert.deepEqual(result,{journalRevision:1,results:[{eventId:event.eventId,status:'accepted'}]});
    const [stored]=await journal(A,noun.id);
    assert.deepEqual(stored.event,event);
    assert.deepEqual(stored.evaluation,core.evaluateWordAnswer(registry,t,event));
    const row=await progressRow(A,noun.id);
    assert.equal(Number(row.revision),1);assert.equal(Number(row.journal_revision),1);
    assert.deepEqual(row.progress,await expectedProgress(A,noun,row.as_of.toISOString()));
    assert.ok(row.introduced_at instanceof Date && row.next_due_at instanceof Date);
    const archived=(await db.query('SELECT task,session_id,catalog_version FROM public.learning_tasks WHERE user_id=$1',[A])).rows;
    assert.deepEqual(archived,[{task:JSON.parse(JSON.stringify(t)),session_id:'session-1',catalog_version:seed.catalogVersion}]);
    // RLS: the owner reads its journal/projection/cursor; another account sees nothing.
    for(const table of ['learning_events','word_progress','learning_tasks','learning_owners']) {
      assert.equal((await as('authenticated',A,`SELECT count(*)::int n FROM public.${table}`)).rows[0].n,1,table);
      assert.equal((await as('authenticated',B,`SELECT count(*)::int n FROM public.${table}`)).rows[0].n,0,table);
      await assert.rejects(as('anon',null,`SELECT * FROM public.${table}`),{code:'42501'});
    }
  });

  test('duplicate eventIds are idempotent; reused identities with other content are refused',async()=>{
    const t=task(verb,'meaning-recall');
    const reveal={...answer(t,null),kind:'reveal'};delete reveal.attemptId;delete reveal.rawAnswer;delete reveal.assisted;
    const event=answer(t,'remembered',{occurredAt:new Date(Date.parse(reveal.occurredAt)+1000).toISOString()});
    const first=await ingest(B,[{event:reveal,task:t},{event,task:t}]);
    assert.deepEqual(first.results.map(r=>r.status),['accepted','accepted']);
    const before={events:await journal(B,verb.id),progress:await progressRow(B,verb.id)};
    const again=await ingest(B,[{event,task:t},{event,task:t},{event:reveal,task:t}]);
    assert.deepEqual(again,{journalRevision:first.journalRevision,results:[event,event,reveal].map(e=>({eventId:e.eventId,status:'duplicate'}))});
    assert.deepEqual(await journal(B,verb.id),before.events,'first receipt time and sequence are kept');
    assert.deepEqual(await progressRow(B,verb.id),before.progress,'no second projection revision');
    const conflicts=await ingest(B,[
      {event:{...event,rawAnswer:'forgotten'},task:t},
      {event:{...answer(t,'forgotten'),commandId:event.commandId},task:t},
      {event:{...answer(t,'forgotten'),attemptId:event.attemptId},task:t}]);
    assert.deepEqual(conflicts.results.map(r=>r.reason),['event-conflict','event-conflict','event-conflict']);
    assert.equal(await count('learning_events',B),2);
  });

  test('concurrent revisions of one word are retried and keep both answers',async()=>{
    const t1=task(noun,'target-type');const t2=task(noun,'target-choice');
    const e1=answer(t1,noun.lemma,{intent:'practice'});const e2=answer(t2,t2.specification.options.find(o=>o.label===noun.lemma).id,{intent:'practice'});
    let interleaved=false;let commits=0;
    // The other device commits after this request read the journal but before it commits.
    const racing={...store,async commit(userId,batch) {
      commits++;
      if(!interleaved) { interleaved=true; assert.equal((await ingest(C,[{event:e2,task:t2}])).results[0].status,'accepted'); }
      return store.commit(userId,batch);
    }};
    const result=await ingest(C,[{event:e1,task:t1}],racing);
    assert.equal(commits,2,'first commit hit a stale revision and was replayed');
    assert.deepEqual(result,{journalRevision:2,results:[{eventId:e1.eventId,status:'accepted'}]});
    const events=await journal(C,noun.id);
    assert.deepEqual(events.map(e=>e.event.eventId),[e2.eventId,e1.eventId]);
    const row=await progressRow(C,noun.id);
    assert.equal(Number(row.revision),2);assert.equal(Number(row.journal_revision),2);
    assert.deepEqual(row.progress,await expectedProgress(C,noun,row.as_of.toISOString()));
    // A writer with a stale expected revision is refused by the RPC itself.
    await assert.rejects(store.commit(C,{dataEpoch:EPOCH,receivedAt:now(),
      events:[{event:answer(t1,'x'),task:t1,evaluation:{outcome:'incorrect',source:'automatic',components:{}}}],
      projections:[{wordId:noun.id,expectedRevision:1,progress:row.progress,replay:row.replay}]}),{code:'40001'});
    assert.equal(await count('learning_events',C),2);
  });

  test('answers are evaluated against the pinned task, content version and catalog snapshot',async()=>{
    const snapshot=await one('SELECT public.v2_catalog_snapshot($1) AS r',[seed.catalogVersion]);
    assert.deepEqual(snapshot.words,[...seed.words].sort((a,b)=>a.id<b.id?-1:1));
    assert.equal(await one('SELECT public.v2_catalog_snapshot($1) AS r',['unknown']),null);
    const t=task(noun,'meaning-choice');
    const wrong=t.specification.options.find(o=>o.id!==t.specification.correctOptionId).id;
    // A forged solution: the client claims its wrong option is correct.
    const forged={...t,specification:{...t.specification,correctOptionId:wrong}};
    const unknown={...t,specification:{...t.specification,catalogVersion:'catalog-from-the-future'}};
    const honest=answer(t,wrong);
    const result=await ingest(A,[
      {event:answer(t,wrong),task:forged},
      {event:answer(unknown,wrong),task:unknown},
      {event:answer(t,wrong,{contentVersion:t.contentVersion+1}),task:t},
      {event:answer(t,'not-an-option'),task:t},
      {event:honest,task:t,evaluation:{outcome:'correct',source:'automatic',components:{recognition:'correct'}}}]);
    assert.deepEqual(result.results.map(r=>r.reason ?? r.status),['invalid-task','unknown-catalog','task-mismatch','invalid-answer','accepted']);
    const stored=(await journal(A,noun.id)).find(r=>r.event.eventId===honest.eventId);
    assert.equal(stored.evaluation.outcome,'incorrect','uploaded evaluation is ignored');
    // The archived task is immutable: another session or another build under that ID is refused.
    const other=registry.get('meaning-choice').buildTask(noun,{answerLanguage:'ru',seed:'other-seed',taskId:t.id});
    const conflicts=await ingest(A,[{event:answer(t,wrong,{sessionId:'session-2'}),task:t},{event:answer(other,wrong),task:other}]);
    assert.deepEqual(conflicts.results.map(r=>r.reason),['task-conflict','task-conflict']);
    // A later import gets its own snapshot at commit; the earlier one stays pinned.
    await db.exec(`BEGIN;INSERT INTO catalog_private.catalog_imports VALUES ('later-catalog','later-seed','${REF}',now()+interval '1 day');COMMIT;`);
    const versions=(await db.query(`SELECT catalog_version,count(*)::int n FROM catalog_private.catalog_snapshot_words GROUP BY 1 ORDER BY 1`)).rows;
    assert.deepEqual(versions,['later-catalog',seed.catalogVersion].sort().map(catalog_version=>({catalog_version,n:seed.words.length})));
    await assert.rejects(db.exec('DELETE FROM catalog_private.catalog_snapshot_words'),{code:'55000'});
  });

  test('a forged owner, foreign projection writes and client calls of service RPCs are refused',async()=>{
    const t=task(noun);
    const clean=answer(t,noun.lemma);const forged={...answer(t,noun.lemma),ownerId:B};
    const auth=async(url,init)=>{
      assert.equal(new URL(url).pathname,'/auth/v1/user');
      return init.headers.Authorization==='Bearer token-c' ? Response.json({id:C}) : new Response('{}',{status:401});
    };
    const handler=createLearningEventsHandler({supabaseUrl:'https://example.supabase.co',publishableKey:'sb_publishable_test_123456789',
      allowedOrigins:['https://drillcards.org'],core,store,fetcher:auth});
    const post=(body,headers={})=>handler(new Request('https://fn/v2-learning-events',{method:'POST',
      headers:{'Content-Type':'application/json',Origin:'https://drillcards.org',...headers},body:JSON.stringify(body)}));
    const before=await count('learning_events',B);
    const response=await post({userId:B,owner:{kind:'account',id:B},events:[{event:forged,task:t},{event:clean,task:t}]},{Authorization:'Bearer token-c'});
    assert.equal(response.status,200);
    assert.deepEqual((await response.json()).results.map(r=>r.reason ?? r.status),['invalid-event','accepted']);
    assert.equal(await count('learning_events',B),before,'nothing written for the forged owner');
    assert.ok((await journal(C,noun.id)).some(r=>r.event.eventId===clean.eventId));
    assert.equal((await post({events:[{event:answer(t,'x'),task:t}]})).status,401);
    assert.equal((await post({events:[{event:answer(t,'x'),task:t}]},{Authorization:'Bearer stolen'})).status,401);
    assert.equal((await post({events:[]},{Authorization:'Bearer token-c'})).status,400);
    assert.equal((await post({events:[{event:answer(t,'x'),task:t}]},{Authorization:'Bearer token-c',Origin:'https://evil.example'})).status,403);

    // Browsers: no service RPC, no direct journal/projection writes, own or foreign.
    for(const role of ['anon','authenticated']) {
      for(const sql of [`SELECT public.v2_commit_learning('${C}','${EPOCH}',now(),'[]','[]')`,
        `SELECT public.v2_learning_state('${C}','{}','{}','{}','{}','{}')`,`SELECT public.v2_catalog_snapshot('x')`]) {
        await assert.rejects(as(role,C,sql),{code:'42501'},`${role}: ${sql}`);
      }
    }
    for(const user of [C,A]) {
      await assert.rejects(as('authenticated',C,`UPDATE public.word_progress SET revision=revision+10 WHERE user_id='${user}'`),{code:'42501'});
      await assert.rejects(as('authenticated',C,`DELETE FROM public.learning_events WHERE user_id='${user}'`),{code:'42501'});
      await assert.rejects(as('authenticated',C,`INSERT INTO public.learning_owners VALUES ('${user}',99)`),{code:'42501'});
    }
    // Even the service writes only through the commit RPC.
    await assert.rejects(service(`UPDATE public.word_progress SET revision=1 WHERE user_id='${A}'`),{code:'42501'});
    await assert.rejects(db.exec(`UPDATE public.learning_events SET evaluation='{}' WHERE user_id='${A}'`),{code:'55000'});

    // The RPC re-checks owner, epoch and projection identity, and is all-or-nothing.
    const row=await progressRow(C,noun.id);
    const fresh=answer(t,noun.lemma);
    const evaluation=core.evaluateWordAnswer(registry,t,fresh);
    const batch=(over={})=>({dataEpoch:EPOCH,receivedAt:now(),events:[{event:fresh,task:t,evaluation}],
      projections:[{wordId:noun.id,expectedRevision:Number(row.revision),progress:row.progress,replay:row.replay}],...over});
    await assert.rejects(store.commit('00000000-0000-4000-8000-00000000dead',batch()),{code:'42501'});
    await assert.rejects(store.commit(C,batch({dataEpoch:'other'})),{code:'55000'});
    await assert.rejects(store.commit(C,batch({receivedAt:'2020-01-01T00:00:00.000Z'})),{code:'22023'});
    await assert.rejects(store.commit(C,batch({projections:[{...batch().projections[0],progress:{...row.progress,owner:{kind:'account',id:A}}}]})),{code:'22023'});
    await assert.rejects(store.commit(C,batch({projections:[]})),{code:'22023'});
    const reused={...answer(t,noun.lemma),commandId:fresh.commandId};
    const events=(await journal(C,noun.id)).length;
    await assert.rejects(store.commit(C,batch({events:[{event:fresh,task:t,evaluation},
      {event:reused,task:t,evaluation:core.evaluateWordAnswer(registry,t,reused)}]})),{code:'23505'});
    assert.equal((await journal(C,noun.id)).length,events,'failed batch leaves no event');
    assert.deepEqual(await progressRow(C,noun.id),row,'failed batch leaves the projection');
  });

  test('a stale data epoch is rejected before evaluation',async()=>{
    const t=task(verb,'meaning-recall');
    const result=await ingest(A,[{event:answer(t,'remembered',{dataEpoch:'old-epoch'}),task:t}]);
    assert.deepEqual(result.results.map(r=>r.reason),['stale-epoch']);
  });
});
