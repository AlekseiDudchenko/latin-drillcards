import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import * as core from '../packages/vocabulary-core/dist/index.js';
import { buildSeed, loadSources, IDENTITIES_PATH } from '../scripts/vocabulary-seed.mjs';
import { catalogSeedSql } from '../scripts/catalog-bootstrap.mjs';
import { itemDatasetSql } from '../scripts/item-dataset-sql.mjs';
import { convertGapDatasets, formatDataset, GAP_DATASETS } from '../scripts/build-gap-datasets.mjs';
import { ingestLearningEvents } from '../supabase/v2/functions/v2-learning-events/handler.js';
import { clozeDefinition, familyStats, planGapItems, slotResults, solvedSentence, tenseVariants, answerText } from '../public/v2/families/gaps/gaps-model.js';
import { commitInPartition, startInPartition } from '../public/v2/storage/learning-db.js';

// M3 (#335): FC05 relative-pronoun gaps and FC06 Passiv on the G3 item contracts and the G2 ClozeInput model.
const json=path=>JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'));
const source={gaps:json('../public/data/gaps.json'),passiv:json('../public/data/passiv-gaps.json')};
const relative=json('../public/data/items/relative-pronoun-gaps.json');
const passiv=json('../public/data/items/passiv-gaps.json');
// Default definitions: exactly what the server intake uses.
const items=core.createItemExerciseRegistry([relative,passiv]);
const A='00000000-0000-4000-8000-0000000000a1';
const owner={kind:'account',id:A};
const EPOCH={dataEpoch:'m3-test',epochStartedAt:'2026-01-01T00:00:00.000Z'};
const ctx=taskId=>({answerLanguage:'ru',seed:'seed',taskId});
let counter=0;
const at=minutes=>new Date(Date.parse('2026-03-02T10:00:00.000Z')+minutes*60000).toISOString();
function answer(task,rawAnswer,over={}) {
  const id=++counter;
  return {schemaVersion:1,kind:'answer',eventId:`e-${id}`,commandId:`c-${id}`,attemptId:`a-${id}`,sessionId:'s-1',taskId:task.id,
    target:task.target,exerciseId:task.exerciseId,intent:'practice',answerLanguage:'ru',occurredAt:at(id),studyTimezone:'UTC',
    taskVersion:task.taskVersion,contentVersion:task.contentVersion,policyVersion:core.ITEM_POLICY_VERSION,dataEpoch:EPOCH.dataEpoch,
    exposure:[],assisted:false,rawAnswer,...over};
}
const fact=(e,task)=>({owner,event:e,receivedAt:e.occurredAt,evaluation:core.evaluateItemAnswer(items,task,e)});
const replay={owner,...EPOCH,asOf:'2026-03-10T00:00:00.000Z'};

describe('M3: converted datasets',()=>{
  test('the converter is deterministic and the committed datasets are current',()=>{
    const converted=convertGapDatasets(source,{relative,passiv});
    assert.equal(formatDataset(converted.relative),readFileSync(new URL('../public/data/items/relative-pronoun-gaps.json',import.meta.url),'utf8'));
    assert.equal(formatDataset(converted.passiv),readFileSync(new URL('../public/data/items/passiv-gaps.json',import.meta.url),'utf8'));
    assert.deepEqual(convertGapDatasets(source,{relative,passiv}),converted);
    assert.equal(relative.items.length,source.gaps.length); assert.equal(passiv.items.length,source.passiv.length);
    assert.deepEqual([relative.id,passiv.id],[GAP_DATASETS.relative.id,GAP_DATASETS.passiv.id]);
    assert.ok([relative,passiv].every(d=>d.kind==='grammar-item' && d.items.every(i=>i.wordIds.length===0)));
  });
  test('a changed source sentence gets a new content version and the dataset a new version; the rest keep theirs',()=>{
    const changed=structuredClone(source); changed.passiv[2].translation_en='The building has been fully renovated.';
    const next=convertGapDatasets(changed,{relative,passiv});
    assert.equal(next.passiv.version,String(Number(passiv.version)+1));
    assert.equal(next.passiv.items[2].contentVersion,passiv.items[2].contentVersion+1);
    assert.ok(next.passiv.items.every((item,i)=>i===2 || item.contentVersion===passiv.items[i].contentVersion));
    assert.equal(next.relative.version,relative.version);
  });
  test('v1 content is kept: answers, linked tense variants, translations, chips; typed relative pronouns accept welch-',()=>{
    const perf=passiv.items.find(i=>i.id==='pg_1_perf').content;
    assert.deepEqual(perf,{template:'Das Gebäude ___ komplett renoviert ___.',answers:[['ist'],['worden']],
      choices:[['wird','wurde','ist','war','worden','werden'],['wird','wurde','ist','war','worden','werden']],
      translations:{en:'The building has been completely renovated.',ru:'Здание было полностью отремонтировано.'},
      tense:'Perf.',tenseVariants:['pg_1_pres','pg_1_prat','pg_1_perf','pg_1_plusq','pg_1_fut1'],level:'B1'});
    assert.deepEqual(relative.items[0].content.answers,[['der','welcher']]);
    const prepositional=relative.items.find(i=>i.content.answers[0][0]==='vor dem').content;
    assert.deepEqual(prepositional.answers,[['vor dem','vor welchem']]);
    assert.ok(prepositional.choices[0].every(c=>c.startsWith('vor ')) && prepositional.choices[0].includes('vor dem'));
    assert.deepEqual(relative.items.find(i=>i.content.answers[0][0]==='dessen').content.answers,[['dessen']]);
  });
});

describe('M3: one gap exercise per mode, graded per slot in the core',()=>{
  test('both families build select and type tasks for every item, deterministically',()=>{
    for (const dataset of [relative,passiv]) for (const item of dataset.items) for (const id of ['gap-select','gap-type']) {
      assert.ok(items.isAvailable(id,dataset.id,item.id,ctx('t')),`${id} ${item.id}`);
    }
    const t=items.buildTask('gap-select','passiv-gaps','pg_1_perf',ctx('t1'));
    assert.deepEqual(items.buildTask('gap-select','passiv-gaps','pg_1_perf',ctx('t1')),t);
    assert.equal(t.input,'cloze'); assert.equal(t.taskVersion,'gap-select/1'); assert.deepEqual(t.assessedComponents,[]);
    assert.deepEqual(t.specification.exercise.slots.map(s=>[s.slotId,s.input,s.options.map(o=>o.id).join()]),
      [['slot-1','choice','wird,wurde,ist,war,worden,werden'],['slot-2','choice','wird,wurde,ist,war,worden,werden']]);
    assert.deepEqual(items.buildTask('gap-type','relative-pronoun-gaps','rel-1',ctx('t2')).specification.exercise.slots,[{slotId:'slot-1',input:'text'}]);
    // The sample Passiv fixture of G3 (item-text content) is not a gap item.
    assert.equal(core.GAP_TYPE.isApplicable({id:'p',contentVersion:1,wordIds:[],content:{prompt:{text:'x',lang:'de'},answers:['wird']}}),false);
  });
  test('select mode: each slot is graded; one wrong slot makes the answer incorrect',()=>{
    const t=items.buildTask('gap-select','passiv-gaps','pg_1_perf',ctx('t3'));
    const item=items.getItem('passiv-gaps','pg_1_perf');
    assert.deepEqual(core.gradeGapAnswer(item,t.specification.exercise,{'slot-1':'ist','slot-2':'worden'}),{slots:{'slot-1':'correct','slot-2':'correct'},correct:true});
    assert.deepEqual(core.gradeGapAnswer(item,t.specification.exercise,{'slot-1':'war','slot-2':'worden'}),{slots:{'slot-1':'incorrect','slot-2':'correct'},correct:false});
    assert.equal(core.evaluateItemAnswer(items,t,answer(t,{'slot-1':'ist','slot-2':'worden'})).outcome,'correct');
    assert.equal(core.evaluateItemAnswer(items,t,answer(t,{'slot-1':'ist','slot-2':'werden'})).outcome,'incorrect');
  });
  test('type mode: case, Unicode and spacing are neutral; accepted alternatives count; everything else is wrong',()=>{
    const rel=items.buildTask('gap-type','relative-pronoun-gaps','rel-1',ctx('t4'));
    for (const value of ['der',' Der ','DER','welcher']) assert.equal(core.evaluateItemAnswer(items,rel,answer(rel,{'slot-1':value})).outcome,'correct',value);
    for (const value of ['die','dder','de r']) assert.equal(core.evaluateItemAnswer(items,rel,answer(rel,{'slot-1':value})).outcome,'incorrect',value);
    const id=relative.items.find(i=>i.content.answers[0][0]==='vor dem').id;
    const prep=items.buildTask('gap-type','relative-pronoun-gaps',id,ctx('t5'));
    assert.equal(core.evaluateItemAnswer(items,prep,answer(prep,{'slot-1':'vor   dem'})).outcome,'correct');
    const fut=items.buildTask('gap-type','passiv-gaps','pg_1_fut1',ctx('t6'));
    assert.equal(core.evaluateItemAnswer(items,fut,answer(fut,{'slot-1':'Wird','slot-2':'werden'})).outcome,'correct');
  });
  test('malformed answers are refused (RangeError), never graded as wrong',()=>{
    const t=items.buildTask('gap-select','passiv-gaps','pg_1_perf',ctx('t7'));
    const typed=items.buildTask('gap-type','passiv-gaps','pg_1_perf',ctx('t8'));
    for (const raw of ['ist',null,['ist','worden'],{'slot-1':'ist'},{'slot-1':'ist','slot-2':'worden','slot-3':'x'},
      {'slot-1':'ist','slot-2':'sind'},{'slot-1':'ist','slot-2':''},{'slot-1':'ist','slot-2':3}]) {
      assert.throws(()=>core.evaluateItemAnswer(items,t,answer(t,raw)),RangeError,JSON.stringify(raw));
    }
    for (const raw of [{'slot-1':'ist','slot-2':'   '},{'slot-1':'ist','slot-2':'x'.repeat(300)},{'slot-1':'ist\u0007','slot-2':'worden'}])
      assert.throws(()=>core.evaluateItemAnswer(items,typed,answer(typed,raw)),RangeError);
    // A typed answer that is no chip is fine in type mode.
    assert.equal(core.evaluateItemAnswer(items,typed,answer(typed,{'slot-1':'sind','slot-2':'worden'})).outcome,'incorrect');
  });
});

describe('M3: page model on the shared ClozeInput',()=>{
  test('a task becomes a ClozeInput definition with the same slots; stored answers are shown again per slot',()=>{
    const t=items.buildTask('gap-select','passiv-gaps','pg_1_perf',ctx('t9'));
    const definition=clozeDefinition(t);
    assert.deepEqual(definition.segments,[{kind:'text',text:'Das Gebäude '},{kind:'slot',slotId:'slot-1'},{kind:'text',text:' komplett renoviert '},
      {kind:'slot',slotId:'slot-2'},{kind:'text',text:'.'}]);
    assert.equal(definition.answerLang,'de'); assert.equal(definition.id,t.id);
    assert.deepEqual(slotResults(items,t,{'slot-1':'war','slot-2':'worden'},false),{'slot-1':{outcome:'incorrect'},'slot-2':{outcome:'correct'}});
    assert.deepEqual(slotResults(items,t,{'slot-1':'war','slot-2':'worden'},true),{'slot-1':{outcome:'incorrect',expected:'ist'},'slot-2':{outcome:'correct'}});
    const content=items.getItem('passiv-gaps','pg_1_perf').content;
    assert.equal(solvedSentence(content),'Das Gebäude ist komplett renoviert worden.');
    assert.equal(answerText(content),'ist + worden');
    assert.deepEqual(tenseVariants(passiv,'pg_1_perf').map(v=>v.tense),['Präs.','Prät.','Perf.','Plusq.','Fut. I']);
    assert.deepEqual(tenseVariants(relative,'rel-1'),[]);
  });
  test('session selection: unanswered first, then mistakes; a tense filter; linked tenses stay together',()=>{
    const plain=planGapItems(items,'gap-select','passiv-gaps',[],replay,{limit:7});
    assert.deepEqual(plain,['pg_1_pres','pg_1_prat','pg_1_perf','pg_1_plusq','pg_1_fut1','pg_2_pres','pg_2_prat']);
    assert.deepEqual(planGapItems(items,'gap-select','passiv-gaps',[],replay,{tense:'Perf.',limit:3}),['pg_1_perf','pg_2_perf','pg_3_perf']);
    const t=items.buildTask('gap-select','passiv-gaps','pg_1_perf',ctx('t10'));
    const wrong=fact(answer(t,{'slot-1':'war','slot-2':'worden'}),t);
    const right=items.buildTask('gap-select','passiv-gaps','pg_1_pres',ctx('t11'));
    const records=[wrong,fact(answer(right,{'slot-1':'wird'}),right)];
    const next=planGapItems(items,'gap-select','passiv-gaps',records,replay,{limit:50});
    assert.equal(next.length,50);
    assert.deepEqual(next.slice(-2),['pg_1_perf','pg_1_pres'],'answered items come last, the mistake before the correct one');
    // Answers in one mode do not change the other mode's queue.
    assert.equal(planGapItems(items,'gap-type','passiv-gaps',records,replay,{limit:1})[0],'pg_1_pres');
    assert.deepEqual(planGapItems(items,'gap-type','relative-pronoun-gaps',[],replay),relative.items.slice(0,10).map(i=>i.id));
  });
  test('statistics per task and per family come from the journal; no word progress',()=>{
    const s1=items.buildTask('gap-select','passiv-gaps','pg_1_perf',ctx('t12'));
    const s2=items.buildTask('gap-type','relative-pronoun-gaps','rel-1',ctx('t13'));
    const records=[fact(answer(s1,{'slot-1':'ist','slot-2':'worden'}),s1),fact(answer(s2,{'slot-1':'die'}),s2)];
    const progress=core.projectExerciseProgress(records,replay);
    assert.deepEqual(progress.items.map(p=>[p.exerciseId,p.datasetId,p.itemId,p.lastOutcome]),
      [['gap-select','passiv-gaps','pg_1_perf','correct'],['gap-type','relative-pronoun-gaps','rel-1','incorrect']]);
    const p=familyStats(items,'passiv',records,replay);
    assert.deepEqual([p.select.attempted,p.select.applicable,p.select.accuracy,p.type.attempted],[1,50,1,0]);
    const r=familyStats(items,'relative',records,replay);
    assert.deepEqual([r.type.attempted,r.type.accuracy,r.type.incorrect,r.select.accuracy],[1,0,1,null]);
    // The local store keeps the answer in the shared journal and outbox and projects no word.
    const plan=core.planItemSession({registry:items,owner,sessionId:'local-1',dataEpoch:EPOCH.dataEpoch,studyTimezone:'UTC',seed:'seed',
      createdAt:at(0),answerLanguage:'ru',datasetId:'passiv-gaps',items:[{itemId:'pg_1_perf',exerciseId:'gap-select'}]});
    const archive={state:{plan,status:'ready',taskIndex:0,revision:0},catalogVersion:'',words:[],datasets:[passiv]};
    const empty={schemaVersion:1,owner,epoch:EPOCH,projectionAsOf:EPOCH.epochStartedAt,sessions:[],facts:[],projections:[],outbox:[]};
    const presenting={...archive.state,status:'presenting',revision:1};
    const data={...startInPartition(empty,{owner,epoch:EPOCH},archive).next,sessions:[{...archive,state:presenting}]};
    const e={...answer(plan.tasks[0],{'slot-1':'ist','slot-2':'worden'}),sessionId:'local-1'};
    const {next}=commitInPartition(data,{owner,epoch:EPOCH},{owner,dataEpoch:EPOCH.dataEpoch,event:e,receivedAt:e.occurredAt,
      session:{...presenting,status:'feedback',revision:2},expectedSessionRevision:1});
    assert.deepEqual([next.facts.length,next.outbox,next.projections],[1,[e.eventId],[]]);
    assert.deepEqual(next.facts[0].evaluation,{outcome:'correct',source:'automatic',components:{}});
  });
});

describe('M3: the server evaluates gap answers through the shared intake',()=>{
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
    await db.exec(itemDatasetSql([relative,passiv]));
  });
  after(async()=>{await db?.close();});

  test('one answer is one event, graded by the server; no word progress, no per-family table',async()=>{
    const t=items.buildTask('gap-select','passiv-gaps','pg_1_perf',ctx('srv-1'));
    const right=recent(answer(t,{'slot-1':'ist','slot-2':'worden'},{sessionId:'srv'}));
    const typed=items.buildTask('gap-type','relative-pronoun-gaps','rel-1',ctx('srv-2'));
    const wrong=recent(answer(typed,{'slot-1':'die'},{sessionId:'srv'}));
    const malformed=recent(answer(t,{'slot-1':'ist'},{sessionId:'srv'}));
    const result=await ingest([{event:right,task:t},{event:wrong,task:typed},{event:malformed,task:t}]);
    assert.deepEqual(result.results.map(r=>r.status+(r.reason?':'+r.reason:'')),['accepted','accepted','rejected:invalid-answer']);
    const rows=(await db.query('SELECT exercise_id,dataset_id,item_id,word_id,evaluation->>\'outcome\' AS outcome FROM public.learning_events ORDER BY sequence')).rows;
    assert.deepEqual(rows,[{exercise_id:'gap-select',dataset_id:'passiv-gaps',item_id:'pg_1_perf',word_id:null,outcome:'correct'},
      {exercise_id:'gap-type',dataset_id:'relative-pronoun-gaps',item_id:'rel-1',word_id:null,outcome:'incorrect'}]);
    assert.equal((await db.query('SELECT count(*)::int n FROM public.word_progress')).rows[0].n,0);
    assert.deepEqual((await ingest([{event:right,task:t}])).results.map(r=>r.status),['duplicate']);
    const tables=(await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND (table_name ILIKE '%gap%' OR table_name ILIKE '%passiv%')")).rows;
    assert.deepEqual(tables,[]);
  });
});
