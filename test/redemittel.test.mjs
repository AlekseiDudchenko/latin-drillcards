import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import * as core from '../packages/vocabulary-core/dist/index.js';
import { buildSeed, loadSources, IDENTITIES_PATH } from '../scripts/vocabulary-seed.mjs';
import { catalogSeedSql } from '../scripts/catalog-bootstrap.mjs';
import { itemDatasetSql } from '../scripts/item-dataset-sql.mjs';
import { convertPhraseDataset, formatDataset, PHRASE_DATASET, readPhraseDecks } from '../scripts/build-phrase-dataset.mjs';
import { ingestLearningEvents } from '../supabase/v2/functions/v2-learning-events/handler.js';
import { deckStats, phraseCard, phrasePresentation, planPhraseItems, ratingOf, summaryRows, otherLanguage } from '../public/v2/families/redemittel/redemittel-model.js';
import { commitInPartition, startInPartition } from '../public/v2/storage/learning-db.js';

// M7 (#339): FC11 Redemittel on the G3 item contracts: whole phrases, reveal + subjective self-rating.
const json=path=>JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'));
const decks=readPhraseDecks();
const phrases=json('../public/data/items/redemittel.json');
// Default definitions: exactly what the server intake uses.
const items=core.createItemExerciseRegistry([phrases]);
const A='00000000-0000-4000-8000-0000000000a7';
const owner={kind:'account',id:A};
const EPOCH={dataEpoch:'m7-test',epochStartedAt:'2026-01-01T00:00:00.000Z'};
const ctx=(taskId,answerLanguage='ru')=>({answerLanguage,seed:'seed',taskId});
let counter=0;
const at=minutes=>new Date(Date.parse('2026-03-02T10:00:00.000Z')+minutes*60000).toISOString();
function event(task,kind,over={}) {
  const id=++counter;
  const base={schemaVersion:1,kind,eventId:`e-${id}`,commandId:`c-${id}`,sessionId:'s-1',taskId:task.id,
    target:task.target,exerciseId:task.exerciseId,intent:'practice',answerLanguage:task.specification.answerLanguage,occurredAt:at(id),studyTimezone:'UTC',
    taskVersion:task.taskVersion,contentVersion:task.contentVersion,policyVersion:core.ITEM_POLICY_VERSION,dataEpoch:EPOCH.dataEpoch,exposure:[]};
  return kind==='answer' ? {...base,attemptId:`a-${id}`,assisted:false,rawAnswer:'remembered',...over} : {...base,...over};
}
const fact=(e,task)=>({owner,event:e,receivedAt:e.occurredAt,...(e.kind==='answer' ? {evaluation:core.evaluateItemAnswer(items,task,e)} : {})});
const rated=(task,rating,session='s-1')=>[fact(event(task,'reveal',{sessionId:session}),task),fact(event(task,'answer',{rawAnswer:rating,sessionId:session}),task)];
const replay={owner,...EPOCH,asOf:'2026-03-10T00:00:00.000Z'};

describe('M7: converted dataset',()=>{
  test('every v1 Redemittel deck is converted, one item per v1 phrase, deterministically',()=>{
    const converted=convertPhraseDataset(decks,phrases);
    assert.equal(formatDataset(converted),readFileSync(new URL('../public/data/items/redemittel.json',import.meta.url),'utf8'));
    assert.deepEqual(convertPhraseDataset(decks,phrases),converted);
    assert.deepEqual(Object.keys(decks),['beruf','daily'],'the job-interview deck and the IT daily stand-up deck');
    const v1=Object.values(decks).flat();
    assert.equal(phrases.items.length,v1.length); assert.equal(v1.length,47);
    for (const [deck,list] of Object.entries(decks)) for (const p of list) {
      const item=phrases.items.find(i=>i.id===p.id);
      assert.deepEqual(item.content,{de:p.de,translations:{en:p.en,ru:p.ru},deck},p.id);
    }
    assert.equal(phrases.id,PHRASE_DATASET.id); assert.equal(phrases.kind,'phrase');
    assert.ok(phrases.items.every(i=>i.wordIds.length===0),'a phrase is its own item, never a set of words');
  });
  test('a changed phrase gets a new content version and the dataset a new version; the rest keep theirs',()=>{
    const changed=structuredClone(decks); changed.daily[3].en='There are no blockers on my side.';
    const next=convertPhraseDataset(changed,phrases);
    assert.equal(next.version,String(Number(phrases.version)+1));
    const index=phrases.items.findIndex(i=>i.id==='p_daily_4');
    assert.equal(next.items[index].contentVersion,phrases.items[index].contentVersion+1);
    assert.ok(next.items.every((item,i)=>i===index || item.contentVersion===phrases.items[i].contentVersion));
  });
});

describe('M7: phrase-recall adapter',()=>{
  test('the meaning in the answer language is the prompt; the German phrase is revealed; subjective source',()=>{
    for (const item of phrases.items) assert.ok(items.isAvailable('phrase-recall','redemittel',item.id,ctx('t')),item.id);
    const ru=items.buildTask('phrase-recall','redemittel','p_daily_4',ctx('t1'));
    assert.deepEqual(ru.specification.exercise,{prompt:{text:'У меня блокеров нет.',lang:'ru'},answer:{text:'Bei mir gibt es keine Blocker.',lang:'de'}});
    assert.deepEqual([ru.input,ru.taskVersion,ru.assessedComponents,ru.target.kind],['reveal','phrase-recall/1',[],'phrase']);
    assert.equal(core.PHRASE_RECALL.source,'self-assessment');
    const en=items.buildTask('phrase-recall','redemittel','p_daily_4',ctx('t2','en'));
    assert.deepEqual(en.specification.exercise.prompt,{text:'I have no blockers.',lang:'en'});
    assert.deepEqual(items.buildTask('phrase-recall','redemittel','p_daily_4',ctx('t1')),ru);
    // Other families' items are not phrases.
    assert.equal(core.PHRASE_RECALL.isApplicable({id:'x',contentVersion:1,wordIds:[],content:{prompt:{text:'x',lang:'ru'},answer:{text:'y',lang:'de'}}}),false);
  });
  test('remembered / forgotten are the only answers; anything else is refused, never graded',()=>{
    const t=items.buildTask('phrase-recall','redemittel','p_beruf_1',ctx('t3'));
    assert.deepEqual(core.evaluateItemAnswer(items,t,event(t,'answer',{rawAnswer:'remembered'})),{outcome:'correct',source:'self-assessment',components:{}});
    assert.equal(core.evaluateItemAnswer(items,t,event(t,'answer',{rawAnswer:'forgotten'})).outcome,'incorrect');
    for (const raw of ['Das ist eine gute Frage',null,'',['remembered'],{rating:'remembered'},'knew'])
      assert.throws(()=>core.evaluateItemAnswer(items,t,event(t,'answer',{rawAnswer:raw})),RangeError,JSON.stringify(raw));
    assert.throws(()=>core.evaluateItemAnswer(items,t,event(t,'reveal')),RangeError,'a reveal is no answer');
  });
});

describe('M7: page model',()=>{
  test('a task becomes the shared RevealInput card; speech only after the reveal',()=>{
    const t=items.buildTask('phrase-recall','redemittel','p_daily_1',ctx('t4'));
    const title={ru:'r',en:'e',de:'d'};
    assert.deepEqual(phraseCard(t,title),{id:t.id,title,prompt:{text:'Я начну: вчера я работал над багом в логине.',lang:'ru'},
      input:{kind:'reveal',answer:'Ich fange an: Gestern habe ich am Login-Bug gearbeitet.',answerLang:'de'},translationLanguage:'ru',
      speechText:'Ich fange an: Gestern habe ich am Login-Bug gearbeitet.'});
    assert.equal(phrasePresentation('ru',{revealed:false,busy:false}).permissions.speech,false);
    assert.equal(phrasePresentation('ru',{revealed:true,busy:false}).permissions.speech,true);
    assert.deepEqual(phrasePresentation('de',{revealed:true,busy:true,rating:'forgotten'},{kind:'info',message:'m'}),
      {language:'de',busy:true,permissions:{reveal:true,details:false,speech:true},feedback:{kind:'info',message:'m'}});
    assert.deepEqual([ratingOf('remembered'),ratingOf('forgotten'),ratingOf('x'),ratingOf(undefined)],['remembered','forgotten',undefined,undefined]);
    assert.deepEqual([otherLanguage('ru'),otherLanguage('en')],['en','ru']);
  });
  test('session selection per deck: unrated first, then forgotten, then the oldest rating',()=>{
    assert.deepEqual(planPhraseItems(items,'beruf',[],replay),decks.beruf.map(p=>p.id),'the 7 interview phrases');
    assert.deepEqual(planPhraseItems(items,'daily',[],replay),decks.daily.slice(0,10).map(p=>p.id));
    const t1=items.buildTask('phrase-recall','redemittel','p_beruf_1',ctx('t5'));
    const t2=items.buildTask('phrase-recall','redemittel','p_beruf_2',ctx('t6'));
    const records=[...rated(t1,'remembered'),...rated(t2,'forgotten')];
    assert.deepEqual(planPhraseItems(items,'beruf',records,replay).slice(-2),['p_beruf_2','p_beruf_1']);
    assert.deepEqual(planPhraseItems(items,'daily',records,replay,3),['p_daily_1','p_daily_2','p_daily_3'],'decks are independent');
  });
  test('own statistics per deck from the journal: a rating without its reveal is not counted as remembered',()=>{
    const t1=items.buildTask('phrase-recall','redemittel','p_daily_1',ctx('t7'));
    const t2=items.buildTask('phrase-recall','redemittel','p_daily_2',ctx('t8'));
    const t3=items.buildTask('phrase-recall','redemittel','p_daily_3',ctx('t9'));
    const unrevealed=fact(event(t3,'answer',{rawAnswer:'remembered'}),t3);
    const records=[...rated(t1,'remembered'),...rated(t2,'forgotten'),unrevealed];
    assert.deepEqual(deckStats(items,'daily',records,replay),{applicable:40,rated:3,remembered:1,forgotten:1});
    assert.deepEqual(deckStats(items,'beruf',records,replay),{applicable:7,rated:0,remembered:0,forgotten:0});
    const progress=core.projectExerciseProgress(records,replay);
    assert.equal(progress.items.find(p=>p.itemId==='p_daily_3').lastOutcome,'unobserved');
    // The daily goal counts ratings (answers) only, never reveals.
    assert.equal(core.projectDailyActivity(records,{...replay,goal:1,timezone:'UTC'}).answerEventIds.length,3);
  });
});

describe('M7: phrases run on the shared Runner and journal',()=>{
  test('reveal before rating; a repeated reveal or rating writes nothing; continue and summary; no word progress',async()=>{
    const { SessionRunner }=await import('../public/v2/session-runner.js');
    const plan=core.planItemSession({registry:items,owner,sessionId:'run-7',dataEpoch:EPOCH.dataEpoch,studyTimezone:'UTC',seed:'seed',
      createdAt:at(0),answerLanguage:'en',datasetId:'redemittel',items:['p_beruf_1','p_beruf_2','p_beruf_3'].map(itemId=>({itemId,exerciseId:'phrase-recall'}))});
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
    const runner=await SessionRunner.start(store,env,{state:{plan,status:'ready',taskIndex:0,revision:0},catalogVersion:'',words:[],datasets:[phrases]});
    await assert.rejects(runner.submit('remembered'),/Reveal/,'the rating needs the reveal');
    assert.equal(await runner.reveal(),'committed');
    assert.equal(await runner.reveal(),'duplicate');
    assert.equal(runner.view.answer,undefined,'a reveal is not an answer');
    assert.equal(await runner.submit('remembered'),'committed');
    await assert.rejects(runner.submit('remembered'),'a second rating of the same task is refused');
    assert.equal(await runner.next(),'committed');
    assert.equal(await runner.reveal(),'committed');
    assert.equal(await runner.submit('forgotten'),'committed');
    assert.equal(await runner.next(),'committed');
    runner.dispose();
    // Continue after a reload: the same session at the third phrase.
    const reopened=await SessionRunner.open(store,env,'run-7');
    assert.deepEqual([reopened.view.phase,reopened.view.taskIndex,reopened.view.revealed],['presenting',2,false]);
    assert.equal(await reopened.finish(),'committed');
    const rows=summaryRows(items,plan.tasks,reopened.view.summary);
    assert.deepEqual(rows.map(r=>[r.itemId,r.rating]),[['p_beruf_1','remembered'],['p_beruf_2','forgotten'],['p_beruf_3',undefined]]);
    assert.equal(rows[0].de,decks.beruf[0].de);
    assert.deepEqual(data.facts.map(f=>[f.event.kind,f.event.target.itemId,f.evaluation?.source??null]),
      [['reveal','p_beruf_1',null],['answer','p_beruf_1','self-assessment'],['reveal','p_beruf_2',null],['answer','p_beruf_2','self-assessment']]);
    assert.deepEqual([data.outbox.length,data.projections.length],[4,0],'one shared outbox; no word projection');
    assert.deepEqual(deckStats(items,'beruf',data.facts,replay),{applicable:7,rated:2,remembered:1,forgotten:1});
  });
});

describe('M7: the server evaluates phrase ratings through the shared intake',()=>{
  let db;
  const read=path=>readFileSync(new URL(`../supabase/v2/${path}`,import.meta.url),'utf8');
  const one=async(sql,params)=>{
    await db.exec('BEGIN');
    try { await db.exec('SET LOCAL ROLE service_role'); const r=(await db.query(sql,params)).rows[0].r; await db.exec('COMMIT'); return r; }
    catch(error) { await db.exec('ROLLBACK'); throw error; }
  };
  const store={
    state:(userId,ids)=>one('SELECT public.v2_learning_state($1,$2,$3,$4,$5,$6) AS r',[userId,ids.wordIds,ids.taskIds,ids.eventIds,ids.commandIds,ids.attemptIds]),
    catalog:async()=>null,
    async dataset(id,version) { const d=await one('SELECT public.v2_item_dataset($1,$2) AS r',[id,version]); return d && core.createItemExerciseRegistry([d]); },
    commit:(userId,batch)=>one('SELECT public.v2_commit_learning($1,$2,$3,$4::jsonb,$5::jsonb) AS r',
      [userId,batch.dataEpoch,batch.receivedAt,JSON.stringify(batch.events),JSON.stringify(batch.projections)]),
  };
  const ingest=list=>ingestLearningEvents({core,store,userId:A,items:list,now:()=>new Date().toISOString()});
  const recent=e=>({...e,occurredAt:new Date(Math.floor(Date.now()/1000)*1000-60000+counter*10).toISOString()});
  before(async()=>{
    db=new PGlite();
    await db.exec(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
      CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role; INSERT INTO auth.users VALUES ('${A}');
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated;`);
    const seed=buildSeed(JSON.parse(readFileSync(IDENTITIES_PATH,'utf8')),loadSources());
    await db.exec('BEGIN;\n'+read('transition/fresh-project-preflight.sql')+read('migrations/001_catalog.sql')+read('migrations/002_environment.sql')+
      catalogSeedSql(seed,{sourceRef:'7db7afee5acec66afd8612f186281dfe97b0cbf1'})+
      `INSERT INTO public.v2_environment VALUES (true,1,'local','${EPOCH.dataEpoch}','${EPOCH.epochStartedAt}');\nCOMMIT;`);
    await db.exec('BEGIN;\n'+read('transition/learning-preflight.sql')+read('migrations/003_learning.sql')+'\nCOMMIT;');
    await db.exec('BEGIN;\n'+read('migrations/004_item_learning.sql')+'\nCOMMIT;');
    await db.exec(itemDatasetSql([phrases]));
  });
  after(async()=>{await db?.close();});

  test('a reveal and a rating are two events; the server grades the rating; no word progress, no per-family table',async()=>{
    const t=items.buildTask('phrase-recall','redemittel','p_daily_5',ctx('srv-1'));
    const reveal=recent(event(t,'reveal',{sessionId:'srv'}));
    const rating=recent(event(t,'answer',{rawAnswer:'forgotten',sessionId:'srv'}));
    const malformed=recent(event(t,'answer',{rawAnswer:'Ich bin blockiert',sessionId:'srv'}));
    const result=await ingest([{event:reveal,task:t},{event:rating,task:t},{event:malformed,task:t}]);
    assert.deepEqual(result.results.map(r=>r.status+(r.reason?':'+r.reason:'')),['accepted','accepted','rejected:invalid-answer']);
    const rows=(await db.query("SELECT kind,exercise_id,dataset_id,item_id,word_id,evaluation->>'outcome' AS outcome,evaluation->>'source' AS source FROM public.learning_events ORDER BY sequence")).rows;
    assert.deepEqual(rows,[{kind:'reveal',exercise_id:'phrase-recall',dataset_id:'redemittel',item_id:'p_daily_5',word_id:null,outcome:null,source:null},
      {kind:'answer',exercise_id:'phrase-recall',dataset_id:'redemittel',item_id:'p_daily_5',word_id:null,outcome:'incorrect',source:'self-assessment'}]);
    assert.equal((await db.query('SELECT count(*)::int n FROM public.word_progress')).rows[0].n,0);
    assert.deepEqual((await ingest([{event:rating,task:t}])).results.map(r=>r.status),['duplicate']);
    const tables=(await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND (table_name ILIKE '%phrase%' OR table_name ILIKE '%redemittel%')")).rows;
    assert.deepEqual(tables,[]);
  });
});
