import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import * as core from '../packages/vocabulary-core/dist/index.js';
import { buildSeed, loadSources, IDENTITIES_PATH } from '../scripts/vocabulary-seed.mjs';
import { catalogSeedSql } from '../scripts/catalog-bootstrap.mjs';
import { itemDatasetSql } from '../scripts/item-dataset-sql.mjs';
import { ingestLearningEvents } from '../supabase/v2/functions/v2-learning-events/handler.js';
import { commitInPartition, mergeRemoteInPartition, startInPartition } from '../public/v2/storage/learning-db.js';

// G3 (#332): one journal for every target. Core adapters and projectors, the local store's
// transaction bodies and the server intake on the real migrations 001–004 in PGlite.
const A='00000000-0000-4000-8000-0000000000a1';
const B='00000000-0000-4000-8000-0000000000b2';
const EPOCH={dataEpoch:'g3-test',epochStartedAt:'2026-01-01T00:00:00.000Z'};
const REF='7db7afee5acec66afd8612f186281dfe97b0cbf1';
const datasets=JSON.parse(readFileSync(new URL('./fixtures/item-datasets.json',import.meta.url),'utf8'));
const items=core.createItemExerciseRegistry(datasets);
const owner={kind:'account',id:A};
const ctx=(taskId,seed='seed-1')=>({answerLanguage:'ru',seed,taskId});
let counter=0;
const at=minutes=>new Date(Date.parse('2026-03-02T10:00:00.000Z')+minutes*60000).toISOString();
function event(task,kind,over={}) {
  const id=++counter;
  const intent=core.itemIntent(task.target.kind);
  return {schemaVersion:1,kind,eventId:`e-${id}`,commandId:`c-${id}`,sessionId:'s-1',taskId:task.id,target:task.target,
    exerciseId:task.exerciseId,intent,answerLanguage:'ru',occurredAt:at(id),studyTimezone:'UTC',taskVersion:task.taskVersion,
    contentVersion:task.contentVersion,policyVersion:core.ITEM_POLICY_VERSION,dataEpoch:EPOCH.dataEpoch,exposure:[],
    ...(kind==='answer' ? {attemptId:`a-${id}`,assisted:false,rawAnswer:null} : {}),...over};
}
const answer=(task,rawAnswer,over={})=>event(task,'answer',{rawAnswer,...over});
const fact=(e,task,receivedAt=e.occurredAt)=>({owner,event:e,receivedAt,
  ...(e.kind==='answer' ? {evaluation:core.evaluateItemAnswer(items,task,e)} : {})});
const replay={owner,...EPOCH,asOf:'2026-03-10T00:00:00.000Z'};

describe('G3: shared item contracts in the core',()=>{
  test('tasks are deterministic, pin the dataset version and reject forged content',()=>{
    const t=items.buildTask('item-choice','sample-sentences','s1',ctx('t1'));
    assert.deepEqual(items.buildTask('item-choice','sample-sentences','s1',ctx('t1')),t);
    assert.deepEqual(t.target,{kind:'sentence',datasetId:'sample-sentences',itemId:'s1'});
    assert.equal(t.specification.datasetVersion,'2026-10-29.1');
    assert.deepEqual(t.assessedComponents,[],'items assess no word component');
    const forged=structuredClone(t); forged.specification.exercise.correctOptionId='b';
    assert.throws(()=>items.validateTask(forged),/canonical/);
    assert.throws(()=>items.validateTask({...t,specification:{...t.specification,datasetVersion:'old'}}),/unavailable/);
    assert.throws(()=>items.buildTask('item-text','sample-sentences','s1',ctx('t2')),/not applicable/);
    assert.throws(()=>items.buildTask('item-self-check','sample-level-test','q1',ctx('t3')),/not applicable/,'no self-rating in a test');
  });

  test('the shared evaluators decide; malformed answers and wrong intents are refused',()=>{
    const choice=items.buildTask('item-choice','sample-sentences','s1',ctx('t4'));
    assert.equal(core.evaluateItemAnswer(items,choice,answer(choice,'a')).outcome,'correct');
    assert.equal(core.evaluateItemAnswer(items,choice,answer(choice,'b')).outcome,'incorrect');
    assert.throws(()=>core.evaluateItemAnswer(items,choice,answer(choice,'zzz')),/option/);
    const typed=items.buildTask('item-text','sample-passiv','p1',ctx('t5'));
    assert.equal(core.evaluateItemAnswer(items,typed,answer(typed,'  amat ')).outcome,'correct');
    assert.equal(core.evaluateItemAnswer(items,typed,answer(typed,'Amat')).outcome,'incorrect','case is spelling');
    const self=items.buildTask('item-self-check','sample-video','v1',ctx('t6'));
    assert.deepEqual(core.evaluateItemAnswer(items,self,answer(self,'remembered')),{outcome:'correct',source:'self-assessment',components:{}});
    for(const over of [{intent:'review-due'},{intent:'learn-new'},{policyVersion:'evidence/1'},{exposure:['recall']}])
      assert.throws(()=>core.evaluateItemAnswer(items,choice,answer(choice,'a',over)),/mismatch/,JSON.stringify(over));
    const test=items.buildTask('item-choice','sample-level-test','q1',ctx('t7'));
    assert.throws(()=>core.evaluateItemAnswer(items,test,answer(test,'rosa',{intent:'practice'})),/mismatch/,'a test answer is an assessment');
    assert.throws(()=>core.bindItemEvent(items,choice,event(choice,'reveal')),/mismatch/,'only reveal tasks reveal');
    assert.throws(()=>core.bindItemEvent(items,choice,event(choice,'introduction')),/mismatch/);
  });

  test('exercise progress: own statistics per exercise, dataset and item; retries and reveals are not independent',()=>{
    const t1=items.buildTask('item-choice','sample-sentences','s1',ctx('p1'));
    const t2=items.buildTask('item-choice','sample-sentences','s2',ctx('p2'));
    const self=items.buildTask('item-self-check','sample-video','v1',ctx('p3'));
    const wrong=answer(t1,'b'); const retry=answer(t1,'a'); const right=answer(t2,'b');
    const rating=answer(self,'remembered'); const reveal=event(self,'reveal',{occurredAt:at(-5)});
    const records=[wrong,retry,right,reveal,rating].map(e=>fact(e,e.taskId==='p3' ? self : e.taskId==='p1' ? t1 : t2));
    const progress=core.projectExerciseProgress([...records,records[2]],replay);
    const s1=progress.items.find(p=>p.itemId==='s1');
    assert.deepEqual([s1.tasks,s1.answers,s1.independentCorrect,s1.lastOutcome],[1,2,0,'correct']);
    assert.equal(progress.items.find(p=>p.itemId==='s2').independentCorrect,1);
    assert.equal(progress.items.find(p=>p.itemId==='v1').lastOutcome,'correct','a revealed self-rating is observed');
    const unrevealed=core.projectExerciseProgress([fact(answer(self,'remembered'),self)],replay);
    assert.equal(unrevealed.items[0].lastOutcome,'unobserved','a self-rating without its reveal is not');
    assert.deepEqual(core.summarizeExercise(items,'item-choice','sample-sentences',progress),
      {exerciseId:'item-choice',datasetId:'sample-sentences',applicable:3,attempted:2,coverage:2/3,accuracy:0.5,incorrect:0});
    assert.deepEqual(core.selectItems(items,'item-choice','sample-sentences',progress),['s3','s1','s2'],'unseen first, then oldest');
    const after=core.projectExerciseProgress([...records,fact(answer(t2,'a'),t2)],replay);
    assert.deepEqual(core.selectItems(items,'item-choice','sample-sentences',after),['s3','s2','s1'],'last wrong before the rest');
  });

  test('a word an item mentions gets no SRS progress, and a word assessment is not SRS evidence',()=>{
    const seed=buildSeed(JSON.parse(readFileSync(IDENTITIES_PATH,'utf8')),loadSources());
    const rosa=seed.words.find(w=>w.id==='w-rosa');
    const t=items.buildTask('item-choice','sample-sentences','s1',ctx('m1'));
    assert.deepEqual(items.getItem('sample-sentences','s1').wordIds,['w-rosa']);
    const records=[fact(answer(t,'a'),t)];
    // The word journal only takes word facts: an item fact is refused, never merged.
    assert.throws(()=>core.replayWord(rosa,records,replay),/Invalid word event/);
    assert.equal(core.projectExerciseProgress(records,replay).items.length,1);
    const words=core.createWordExerciseRegistry(seed.words,seed.catalogVersion);
    const wt=words.get('target-type').buildTask(rosa,ctx('m2'));
    const e={...answer(wt,rosa.lemma),target:wt.target,intent:'assessment',policyVersion:'evidence/1',taskVersion:wt.taskVersion,contentVersion:wt.contentVersion};
    const progress=core.replayWord(rosa,[{owner,event:e,receivedAt:e.occurredAt,evaluation:core.evaluateWordAnswer(words,wt,e)}],replay).progress;
    assert.equal(progress.introducedAt,null);
    assert.ok(Object.values(progress.components).every(c=>c.stage==='unintroduced'));
  });

  test('daily goal and streak count each answer once; reveals, duplicates and rejected events do not',()=>{
    const t=items.buildTask('item-self-check','sample-video','v1',ctx('d1'));
    const c=items.buildTask('item-choice','sample-sentences','s2',ctx('d2'));
    const day=(date,h)=>`${date}T${String(h).padStart(2,'0')}:00:00.000Z`;
    const reveal=event(t,'reveal',{occurredAt:day('2026-03-08',9)});
    const a1=answer(t,'remembered',{occurredAt:day('2026-03-08',10)});
    const a2=answer(c,'b',{occurredAt:day('2026-03-09',10)});
    const a3=answer(c,'a',{occurredAt:day('2026-03-09',11)});
    const rejected=answer(c,'a',{occurredAt:day('2026-03-09',12)});
    const records=[reveal,a1,a2,a3,rejected].map(e=>fact(e,e.taskId==='d1' ? t : c));
    const activity=core.projectDailyActivity([...records,records[1],{...records[2],receivedAt:day('2026-03-09',13)}],
      {...replay,asOf:day('2026-03-09',20),goal:1,timezone:'UTC',excludeEventIds:[rejected.eventId]});
    assert.deepEqual(activity.days,[{date:'2026-03-08',answers:1,goalMet:true},{date:'2026-03-09',answers:2,goalMet:true}]);
    assert.equal(activity.streak,2);
    assert.equal(core.projectDailyActivity(records,{...replay,asOf:day('2026-03-10',8),goal:2,timezone:'UTC'}).streak,1,
      'today still open: the streak runs through yesterday');
    assert.throws(()=>core.projectDailyActivity([...records,{...records[1],event:{...a1,rawAnswer:'forgotten'}}],
      {...replay,goal:1,timezone:'UTC'}),/Conflicting/);
  });

  test('an assessment keeps its own result per run, first answer per question',()=>{
    const q1=items.buildTask('item-choice','sample-level-test','q1',ctx('q1'));
    const q2=items.buildTask('item-choice','sample-level-test','q2',ctx('q2'));
    const records=[answer(q1,'rosa'),answer(q1,'aqua'),answer(q2,'es')].map((e,i)=>fact(e,i<2 ? q1 : q2));
    const [result]=core.projectAssessments(records,replay);
    assert.deepEqual({answered:result.answered,correct:result.correct,score:result.score,datasetId:result.datasetId},
      {answered:2,correct:1,score:0.5,datasetId:'sample-level-test'});
    assert.equal(core.projectExerciseProgress(records,replay).items.length,0,'no practice statistics from a test');
  });
});

describe('G3: the local store keeps item sessions in the same journal and outbox',()=>{
  const plan=core.planItemSession({registry:items,owner,sessionId:'local-1',dataEpoch:EPOCH.dataEpoch,studyTimezone:'UTC',
    seed:'seed',createdAt:at(0),answerLanguage:'ru',datasetId:'sample-sentences',
    items:[{itemId:'s1',exerciseId:'item-choice'},{itemId:'s2',exerciseId:'item-choice'}]});
  const archive={state:{plan,status:'ready',taskIndex:0,revision:0},catalogVersion:'',words:[],datasets:[datasets[0]]};
  const scope={owner,epoch:EPOCH};
  const empty={schemaVersion:1,owner,epoch:EPOCH,projectionAsOf:EPOCH.epochStartedAt,sessions:[],facts:[],projections:[],outbox:[]};
  test('commit evaluates with the shared adapter, appends to the outbox and projects no word',()=>{
    let data=startInPartition(empty,scope,archive).next;
    const presenting={...archive.state,status:'presenting',revision:1};
    data={...data,sessions:[{...archive,state:presenting}]};
    const task=plan.tasks[0];
    const e={...answer(task,'a'),sessionId:'local-1'};
    const {result,next}=commitInPartition(data,scope,{owner,dataEpoch:EPOCH.dataEpoch,event:e,receivedAt:e.occurredAt,
      session:{...presenting,status:'feedback',revision:2},expectedSessionRevision:1});
    assert.equal(result,'committed');
    assert.deepEqual(next.facts[0].evaluation,{outcome:'correct',source:'automatic',components:{}});
    assert.deepEqual(next.outbox,[e.eventId]);
    assert.deepEqual(next.projections,[]);
    assert.equal(commitInPartition(next,scope,{owner,dataEpoch:EPOCH.dataEpoch,event:e,receivedAt:e.occurredAt,
      session:{...presenting,status:'feedback',revision:2},expectedSessionRevision:1}).result,'duplicate');
    assert.throws(()=>commitInPartition(data,scope,{owner,dataEpoch:EPOCH.dataEpoch,event:{...e,eventId:'x',commandId:'y',attemptId:'z',policyVersion:'evidence/1'},
      receivedAt:e.occurredAt,session:{...presenting,status:'feedback',revision:2},expectedSessionRevision:1}),/binding|mismatch/);
    assert.throws(()=>startInPartition(empty,scope,{...archive,datasets:[]}),/pinned datasets/);
    // Another device's item answer merges into the journal without a word projection.
    const merged=mergeRemoteInPartition(next,[{sequence:1,event:e,evaluation:next.facts[0].evaluation,receivedAt:at(50)}],[],at(60));
    assert.deepEqual(merged.outbox,[]);
    assert.equal(merged.facts.length,1);
  });
});

describe('G3: server intake of item events (migrations 001–004)',()=>{
  let db;
  const read=path=>readFileSync(new URL(`../supabase/v2/${path}`,import.meta.url),'utf8');
  async function as(role,user,sql,params=[]) {
    await db.exec('BEGIN');
    try {
      await db.exec(`SET LOCAL ROLE ${role}`);
      await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[user ?? '']);
      const result=await db.query(sql,params);
      await db.exec('COMMIT'); return result;
    } catch(error) { await db.exec('ROLLBACK'); throw error; }
  }
  const one=async(sql,params)=>(await as('service_role',null,sql,params)).rows[0].r;
  const store={
    state:(userId,ids)=>one('SELECT public.v2_learning_state($1,$2,$3,$4,$5,$6) AS r',
      [userId,ids.wordIds,ids.taskIds,ids.eventIds,ids.commandIds,ids.attemptIds]),
    catalog:async()=>null,
    async dataset(id,version) { const d=await one('SELECT public.v2_item_dataset($1,$2) AS r',[id,version]); return d && core.createItemExerciseRegistry([d]); },
    commit:(userId,batch)=>one('SELECT public.v2_commit_learning($1,$2,$3,$4::jsonb,$5::jsonb) AS r',
      [userId,batch.dataEpoch,batch.receivedAt,JSON.stringify(batch.events),JSON.stringify(batch.projections)]),
  };
  const ingest=(userId,list)=>ingestLearningEvents({core,store,userId,items:list,now:()=>new Date().toISOString()});
  const recent=e=>({...e,occurredAt:new Date(Math.floor(Date.now()/1000)*1000-60000+counter*10).toISOString()});
  before(async()=>{
    db=new PGlite();
    await db.exec(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
      CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
      INSERT INTO auth.users VALUES ('${A}'),('${B}');
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated;`);
    const seed=buildSeed(JSON.parse(readFileSync(IDENTITIES_PATH,'utf8')),loadSources());
    await db.exec('BEGIN;\n'+read('transition/fresh-project-preflight.sql')+read('migrations/001_catalog.sql')+read('migrations/002_environment.sql')+
      catalogSeedSql(seed,{sourceRef:REF})+`INSERT INTO public.v2_environment VALUES (true,1,'local','${EPOCH.dataEpoch}','${EPOCH.epochStartedAt}');\nCOMMIT;`);
    await db.exec('BEGIN;\n'+read('transition/learning-preflight.sql')+read('migrations/003_learning.sql')+'\nCOMMIT;');
    await db.exec('BEGIN;\n'+read('migrations/004_item_learning.sql')+'\nCOMMIT;');
    await db.exec(itemDatasetSql(datasets));
  });
  after(async()=>{await db?.close();});

  test('the migration refuses a second run; published datasets are immutable and public',async()=>{
    await assert.rejects(db.exec('BEGIN;\n'+read('migrations/004_item_learning.sql')+'\nCOMMIT;'),{code:'55000'});
    await db.exec('ROLLBACK');
    await db.exec(itemDatasetSql(datasets));
    const changed=structuredClone(datasets[1]); changed.items[0].content.answers=['ist'];
    await assert.rejects(db.exec(itemDatasetSql([changed])),{code:'55000'});
    await db.exec('ROLLBACK');
    assert.equal((await as('anon',null,'SELECT count(*)::int n FROM public.catalog_item_datasets')).rows[0].n,4);
    await assert.rejects(as('authenticated',A,"SELECT public.v2_item_dataset('sample-passiv','1')"),{code:'42501'});
    await assert.rejects(as('service_role',null,"UPDATE catalog_private.item_datasets SET kind='phrase'"),e=>['42501','55000'].includes(e.code));
  });

  test('an item answer is evaluated on the server, archived with its task, and projects no word',async()=>{
    const t=items.buildTask('item-choice','sample-sentences','s1',ctx('srv-1'));
    const e=recent(answer(t,'a',{sessionId:'srv'}));
    const forged={...e,evaluation:{outcome:'incorrect'}};
    assert.deepEqual((await ingest(A,[{event:forged,task:t}])).results.map(r=>r.reason),['invalid-event'],'no client evaluation');
    const result=await ingest(A,[{event:e,task:t}]);
    assert.deepEqual(result.results,[{eventId:e.eventId,status:'accepted'}]);
    const row=(await db.query('SELECT target_kind,dataset_id,item_id,word_id,evaluation FROM public.learning_events WHERE user_id=$1',[A])).rows[0];
    assert.deepEqual(row,{target_kind:'sentence',dataset_id:'sample-sentences',item_id:'s1',word_id:null,
      evaluation:{outcome:'correct',source:'automatic',components:{}}});
    assert.deepEqual((await db.query('SELECT target_kind,dataset_version,word_id FROM public.learning_tasks WHERE user_id=$1',[A])).rows,
      [{target_kind:'sentence',dataset_version:'2026-10-29.1',word_id:null}]);
    assert.equal((await db.query('SELECT count(*)::int n FROM public.word_progress WHERE user_id=$1',[A])).rows[0].n,0,'w-rosa is only mentioned');
    assert.deepEqual((await ingest(A,[{event:e,task:t}])).results,[{eventId:e.eventId,status:'duplicate'}]);
    assert.equal((await as('authenticated',A,'SELECT count(*)::int n FROM public.learning_events')).rows[0].n,1);
    assert.equal((await as('authenticated',B,'SELECT count(*)::int n FROM public.learning_events')).rows[0].n,0);
  });

  test('forged tasks, unknown datasets, wrong intents and malformed answers are rejected',async()=>{
    const t=items.buildTask('item-choice','sample-sentences','s2',ctx('srv-2'));
    const forged=structuredClone(t); forged.specification.exercise.correctOptionId='a';
    const unknown=structuredClone(t); unknown.specification.datasetVersion='nope';
    const test=items.buildTask('item-choice','sample-level-test','q2',ctx('srv-3'));
    const reasons=(await ingest(B,[
      {event:recent(answer(forged,'a',{sessionId:'srv-b'})),task:forged},
      {event:recent(answer(unknown,'a',{sessionId:'srv-b'})),task:unknown},
      {event:recent(answer(test,'sum',{sessionId:'srv-b',intent:'practice'})),task:test},
      {event:recent(answer(t,'zzz',{sessionId:'srv-b'})),task:t},
    ])).results.map(r=>r.reason);
    assert.deepEqual(reasons,['invalid-task','unknown-dataset','task-mismatch','invalid-answer']);
    assert.equal((await db.query('SELECT count(*)::int n FROM public.learning_events WHERE user_id=$1',[B])).rows[0].n,0);
    // The same answer with the right intent is accepted.
    const ok=recent(answer(test,'sum',{sessionId:'srv-b'}));
    assert.deepEqual((await ingest(B,[{event:ok,task:test}])).results.map(r=>r.status),['accepted']);
  });
});

describe('G3: item sessions run on the shared SessionRunner',()=>{
  test('a reveal and a self-rating are committed once; the summary is per task',async()=>{
    const { SessionRunner }=await import('../public/v2/session-runner.js');
    const plan=core.planItemSession({registry:core.createItemExerciseRegistry([datasets[2]]),owner,sessionId:'run-1',dataEpoch:EPOCH.dataEpoch,
      studyTimezone:'UTC',seed:'seed',createdAt:at(0),answerLanguage:'ru',datasetId:'sample-video',items:[{itemId:'v1',exerciseId:'item-self-check'}]});
    let data={schemaVersion:1,owner,epoch:EPOCH,projectionAsOf:EPOCH.epochStartedAt,sessions:[],facts:[],projections:[],outbox:[]};
    const scope={owner,epoch:EPOCH};
    // In-memory store over the exact partition transaction bodies of the IndexedDB adapter.
    const store={owner,epoch:EPOCH,
      snapshot:async()=>structuredClone(data), restore:async()=>structuredClone(data),
      async startSession(archive) { const r=startInPartition(data,scope,archive); if(r.next) data=r.next; return r.result; },
      async saveSession(state,expected) {
        const saved=data.sessions.find(s=>s.state.plan.sessionId===state.plan.sessionId);
        if(saved.state.revision!==expected) return 'conflict';
        data={...data,sessions:data.sessions.map(s=>s===saved ? {...s,state} : s)}; return 'committed';
      },
      async commit(input) { const r=commitInPartition(data,scope,input); if(r.next) data=r.next; return r.result; }};
    let n=0; let clock=10;
    const env={now:()=>at(clock++),id:()=>`id-${++n}`};
    const runner=await SessionRunner.start(store,env,{state:{plan,status:'ready',taskIndex:0,revision:0},catalogVersion:'',words:[],datasets:[datasets[2]]});
    assert.equal(runner.view.family,'items');
    assert.equal(runner.view.phase,'presenting');
    await assert.rejects(runner.submit('remembered'),/Reveal/);
    assert.equal(await runner.reveal(),'committed');
    assert.equal(await runner.reveal(),'duplicate');
    assert.equal(await runner.submit('remembered'),'committed');
    assert.deepEqual(runner.view.answer.evaluation,{outcome:'correct',source:'self-assessment',components:{}});
    assert.equal(await runner.next(),'committed');
    assert.equal(runner.view.phase,'completed');
    assert.deepEqual(runner.view.summary,{answered:1,correct:1,tasks:[{taskId:plan.tasks[0].id,itemId:'v1',outcome:'correct'}]});
    assert.deepEqual(data.facts.map(f=>[f.event.kind,f.event.intent,f.event.policyVersion]),
      [['reveal','practice',core.ITEM_POLICY_VERSION],['answer','practice',core.ITEM_POLICY_VERSION]]);
    assert.equal(data.outbox.length,2,'one outbox for every family');
    assert.equal(await SessionRunner.latestOpenSession(store),undefined,'vocabulary pages never resume an item session');
    const activity=core.projectDailyActivity(data.facts,{...replay,goal:1,timezone:'UTC'});
    assert.equal(activity.answerEventIds.length,1,'the reveal does not count toward the daily goal');
  });
});
