import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import * as core from '../packages/vocabulary-core/dist/index.js';
import { buildSeed, loadSources, IDENTITIES_PATH } from '../scripts/vocabulary-seed.mjs';
import { catalogSeedSql } from '../scripts/catalog-bootstrap.mjs';
import { itemDatasetSql } from '../scripts/item-dataset-sql.mjs';
import { formatDataset } from '../scripts/build-gap-datasets.mjs';
import { convertKasusDataset, KASUS_DATASET } from '../scripts/build-kasus-dataset.mjs';
import { ingestLearningEvents } from '../supabase/v2/functions/v2-learning-events/handler.js';
import { choiceDefinition, clozeDefinition, grade, itemStats, kasusStats, planKasusItems, rawAnswer, ruleOf, ruleRow, solvedSentence,
  variantOf } from '../public/v2/families/kasus/kasus-model.js';
import { commitInPartition, startInPartition } from '../public/v2/storage/learning-db.js';

// M4 (#336): FC07 Kasus (article, case, question) on the G3 item contracts, ClozeInput and ChoiceInput.
const json=path=>JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'));
const source={items:json('../public/data/kasus-a2.json'),rules:json('../public/data/kasus-rules.json')};
const kasus=json('../public/data/items/kasus-a2.json');
// Default definitions: exactly what the server intake uses.
const items=core.createItemExerciseRegistry([kasus]);
const A='00000000-0000-4000-8000-0000000000a4';
const owner={kind:'account',id:A};
const EPOCH={dataEpoch:'m4-test',epochStartedAt:'2026-01-01T00:00:00.000Z'};
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
const build=(variant,itemId,taskId)=>items.buildTask(`kasus-${variant}`,'kasus-a2',itemId,ctx(taskId));

describe('M4: converted dataset',()=>{
  test('the converter is deterministic, the committed dataset is current and covers every v1 item',()=>{
    const converted=convertKasusDataset(source,kasus);
    assert.equal(formatDataset(converted),readFileSync(new URL('../public/data/items/kasus-a2.json',import.meta.url),'utf8'));
    assert.deepEqual(convertKasusDataset(source,kasus),converted);
    assert.equal(kasus.items.length,source.items.length);
    assert.deepEqual(kasus.items.map(i=>i.id),source.items.map(i=>i.id));
    assert.equal(kasus.id,KASUS_DATASET.id); assert.equal(kasus.kind,'grammar-item');
    assert.ok(kasus.items.every(i=>i.wordIds.length===0));
    const variants={}; for (const i of kasus.items) variants[i.content.variant]=(variants[i.content.variant]??0)+1;
    assert.deepEqual(variants,{article:80,case:22,question:18});
  });
  test('v1 content is kept: sentence, highlighted phrase, options, answer, case, rule, explanation, translations, level',()=>{
    for (const [index,v1] of source.items.entries()) {
      const c=kasus.items[index].content;
      assert.deepEqual([c.variant,c.sentence,c.focus,c.options,c.answer,c.case,c.rule,c.explanation,c.translations.ru,c.translations.en,c.level],
        [v1.type,v1.sentence,v1.focus,v1.options,v1.answer,v1.case,v1.rule,v1.explanation,v1.translation_ru,v1.translation_en,v1.level],v1.id);
    }
  });
  test('every item points at its rule and the table row of its noun (the row form or its ein-/kein- form matches the answer)',()=>{
    for (const item of kasus.items) {
      const rule=ruleOf(source.rules,item.content); assert.ok(rule,item.id);
      const row=rule.table.rows[ruleRow(item.content)];
      const word=item.content.variant==='article' ? item.content.answer : item.content.focus.split(' ').at(-2);
      // Possessives share the ein-/kein- ending; ins/im are in das/in dem.
      const forms=[row.form,row.indef,...row.kein.split(' / ')].filter(f=>f!=='—');
      const contracted={ins:'das',im:'dem'}[word];
      assert.ok(forms.includes(word) || contracted===row.form || forms.some(f=>f.startsWith('mein') && word.endsWith(f.slice(4))) ||
        (word==='neue' && row.indef==='eine'),`${item.id}: ${word} vs ${row.gender.de}`);
    }
    assert.equal(ruleRow(items.getItem('kasus-a2','ka_art_01').content),0,'der Mann → maskulin');
    assert.equal(ruleRow(items.getItem('kasus-a2','ka_kas_03').content),3,'für die Kinder → Plural');
  });
  test('a changed source item gets a new content version and the dataset a new version; an unknown noun fails loudly',()=>{
    const changed=structuredClone(source); changed.items[5].explanation.en+=' (revised)';
    const next=convertKasusDataset(changed,kasus);
    assert.equal(next.version,String(Number(kasus.version)+1));
    assert.equal(next.items[5].contentVersion,kasus.items[5].contentVersion+1);
    assert.ok(next.items.every((item,i)=>i===5 || item.contentVersion===kasus.items[i].contentVersion));
    const unknown=structuredClone(source); const q=unknown.items.find(i=>i.type==='question');
    q.sentence=q.sentence.replace(q.focus,'den Elefanten'); q.focus='den Elefanten';
    assert.throws(()=>convertKasusDataset(unknown,kasus),/FOCUS_NOUN_GENDER/);
  });
});

describe('M4: three exercises, graded in the core',()=>{
  test('each item belongs to exactly its variant; tasks are deterministic with a per-task option order',()=>{
    for (const item of kasus.items) assert.deepEqual(['article','case','question'].filter(v=>items.isAvailable(`kasus-${v}`,'kasus-a2',item.id,ctx('t'))),
      [item.content.variant],item.id);
    const art=build('article','ka_art_01','t1');
    assert.deepEqual(build('article','ka_art_01','t1'),art);
    assert.deepEqual([art.input,art.taskVersion,art.assessedComponents],['cloze','kasus-article/1',[]]);
    assert.equal(art.specification.exercise.template,'Ich sehe ___ Mann dort.');
    assert.deepEqual(art.specification.exercise.slots[0].options.map(o=>o.id).sort(),['dem','den','der','die']);
    assert.deepEqual(art.specification.exercise.answers,[['den']]);
    const kas=build('case','ka_kas_01','t2');
    assert.deepEqual([kas.input,kas.specification.exercise.prompt],['choice',{text:'Ich sehe den Hund.',lang:'de',focus:'den Hund'}]);
    assert.equal(build('question','ka_frg_01','t3').input,'choice');
    // v1 listed the answer first in 109 of 120 items; the task order must not give it away.
    const firsts=kasus.items.map((item,i)=>{
      const t=items.buildTask(`kasus-${item.content.variant}`,'kasus-a2',item.id,ctx(`order-${i}`)).specification.exercise;
      return (t.options ?? t.slots[0].options)[0].id===item.content.answer;
    });
    assert.ok(firsts.filter(Boolean).length<70,`answer first in ${firsts.filter(Boolean).length} of 120`);
  });
  test('the chosen option is graded against the item answer',()=>{
    const art=build('article','ka_art_01','t4');
    assert.equal(core.evaluateItemAnswer(items,art,answer(art,{'slot-1':'den'})).outcome,'correct');
    assert.equal(core.evaluateItemAnswer(items,art,answer(art,{'slot-1':'dem'})).outcome,'incorrect');
    const kas=build('case','ka_kas_01','t5');
    assert.equal(core.evaluateItemAnswer(items,kas,answer(kas,'Akkusativ')).outcome,'correct');
    assert.equal(core.evaluateItemAnswer(items,kas,answer(kas,'Dativ')).outcome,'incorrect');
    const frg=build('question','ka_frg_04','t6');
    assert.equal(core.evaluateItemAnswer(items,frg,answer(frg,'Wohin?')).outcome,'correct');
    assert.equal(core.evaluateItemAnswer(items,frg,answer(frg,'Wo?')).outcome,'incorrect');
  });
  test('malformed answers are refused (RangeError), never graded as wrong',()=>{
    const art=build('article','ka_art_01','t7'); const kas=build('case','ka_kas_01','t8');
    for (const raw of ['den',null,{'slot-1':'des'},{'slot-1':'den','slot-2':'die'},{'slot-2':'den'},{'slot-1':' den'},{'slot-1':3}])
      assert.throws(()=>core.evaluateItemAnswer(items,art,answer(art,raw)),RangeError,JSON.stringify(raw));
    for (const raw of [{'slot-1':'Akkusativ'},'akkusativ','Genitiv','',['Dativ'],null])
      assert.throws(()=>core.evaluateItemAnswer(items,kas,answer(kas,raw)),RangeError,JSON.stringify(raw));
    // A task edited on the client (other options or another sentence) never reaches evaluate: the canonical rebuild differs.
    const forged={...kas,specification:{...kas.specification,exercise:{...kas.specification.exercise,options:[{id:'Dativ',label:'Dativ'},{id:'Genitiv',label:'Genitiv'}]}}};
    assert.throws(()=>core.evaluateItemAnswer(items,forged,answer(forged,'Dativ')),RangeError);
    assert.throws(()=>core.gradeKasusAnswer(items.getItem('kasus-a2','ka_kas_01'),forged.specification.exercise,'Dativ'),RangeError);
  });
});

describe('M4: page model on the shared ClozeInput and ChoiceInput',()=>{
  test('article → one choice slot in the sentence; case/question → the sentence with its highlighted phrase',()=>{
    const art=build('article','ka_art_01','t9');
    const cloze=clozeDefinition(art);
    assert.deepEqual(cloze.segments,[{kind:'text',text:'Ich sehe '},{kind:'slot',slotId:'slot-1'},{kind:'text',text:' Mann dort.'}]);
    assert.deepEqual([cloze.id,cloze.answerLang,cloze.slots[0].input,cloze.slots[0].options],[art.id,'de','choice',art.specification.exercise.slots[0].options]);
    const frg=build('question','ka_frg_01','t10');
    const choice=choiceDefinition(frg);
    assert.deepEqual(choice.prompt,{text:'Ich sehe den Mann.',lang:'de',focus:'den Mann'});
    assert.deepEqual(choice.input,{kind:'choice',answerLang:'de',options:frg.specification.exercise.options});
    assert.deepEqual([variantOf(art),variantOf(frg)],['article','question']);
    assert.deepEqual(rawAnswer(art,'den'),{'slot-1':'den'}); assert.equal(rawAnswer(frg,'Wen?'),'Wen?');
    assert.deepEqual(grade(items,art,{'slot-1':'dem'}),{chosen:'dem',correct:false});
    assert.deepEqual(grade(items,frg,'Wen?'),{chosen:'Wen?',correct:true});
    assert.equal(solvedSentence(items.getItem('kasus-a2','ka_art_01').content),'Ich sehe den Mann dort.');
    assert.equal(solvedSentence(items.getItem('kasus-a2','ka_frg_01').content),'Ich sehe den Mann.');
  });
  test('sessions: a variant filter keeps that variant; "all" mixes them; unanswered first, then mistakes',()=>{
    const all=planKasusItems(items,'all',[],replay);
    assert.equal(all.length,10);
    assert.deepEqual(all.slice(0,3).map(i=>i.exerciseId),['kasus-article','kasus-case','kasus-question']);
    assert.deepEqual(all.slice(0,3).map(i=>i.itemId),['ka_art_01','ka_kas_01','ka_frg_01']);
    assert.ok(planKasusItems(items,'case',[],replay,30).every(i=>i.exerciseId==='kasus-case'));
    assert.equal(planKasusItems(items,'question',[],replay,30).length,18,'a filter never pads with other variants');
    const wrong=build('case','ka_kas_01','t11'); const right=build('case','ka_kas_02','t12');
    const records=[fact(answer(wrong,'Dativ'),wrong),fact(answer(right,'Dativ'),right)];
    const next=planKasusItems(items,'case',records,replay,22).map(i=>i.itemId);
    assert.deepEqual(next.slice(-2),['ka_kas_01','ka_kas_02'],'answered items come last, the mistake before the correct one');
    // Answers of one variant do not move another variant's queue.
    assert.equal(planKasusItems(items,'article',records,replay,1)[0].itemId,'ka_art_01');
  });
  test('statistics per variant and per sentence come from the journal; no word progress',()=>{
    const a=build('article','ka_art_01','t13'); const q=build('question','ka_frg_01','t14');
    const records=[fact(answer(a,{'slot-1':'den'}),a),fact(answer(q,'Was?'),q)];
    const progress=core.projectExerciseProgress(records,replay);
    assert.deepEqual(progress.items.map(p=>[p.exerciseId,p.itemId,p.lastOutcome]),[['kasus-article','ka_art_01','correct'],['kasus-question','ka_frg_01','incorrect']]);
    const stats=kasusStats(items,records,replay);
    assert.deepEqual([stats.article.attempted,stats.article.applicable,stats.article.accuracy],[1,80,1]);
    assert.deepEqual([stats.case.attempted,stats.case.applicable,stats.case.accuracy],[0,22,null]);
    assert.deepEqual([stats.question.attempted,stats.question.applicable,stats.question.accuracy,stats.question.incorrect],[1,18,0,1]);
    assert.deepEqual(itemStats(records,replay,a),{tasks:1,independentCorrect:1});
    assert.deepEqual(itemStats(records,replay,build('case','ka_kas_05','t15')),{tasks:0,independentCorrect:0});
    // The local store keeps the answer in the shared journal and outbox and projects no word.
    const plan=core.planItemSession({registry:items,owner,sessionId:'local-1',dataEpoch:EPOCH.dataEpoch,studyTimezone:'UTC',seed:'seed',
      createdAt:at(0),answerLanguage:'ru',datasetId:'kasus-a2',items:[{itemId:'ka_kas_01',exerciseId:'kasus-case'}]});
    const archive={state:{plan,status:'ready',taskIndex:0,revision:0},catalogVersion:'',words:[],datasets:[kasus]};
    const empty={schemaVersion:1,owner,epoch:EPOCH,projectionAsOf:EPOCH.epochStartedAt,sessions:[],facts:[],projections:[],outbox:[]};
    const presenting={...archive.state,status:'presenting',revision:1};
    const data={...startInPartition(empty,{owner,epoch:EPOCH},archive).next,sessions:[{...archive,state:presenting}]};
    const e={...answer(plan.tasks[0],'Akkusativ'),sessionId:'local-1'};
    const {next}=commitInPartition(data,{owner,epoch:EPOCH},{owner,dataEpoch:EPOCH.dataEpoch,event:e,receivedAt:e.occurredAt,
      session:{...presenting,status:'feedback',revision:2},expectedSessionRevision:1});
    assert.deepEqual([next.facts.length,next.outbox,next.projections],[1,[e.eventId],[]]);
    assert.deepEqual(next.facts[0].evaluation,{outcome:'correct',source:'automatic',components:{}});
  });
});

describe('M4: the server evaluates Kasus answers through the shared intake',()=>{
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
    await db.exec(itemDatasetSql([kasus]));
  });
  after(async()=>{await db?.close();});

  test('one answer is one event, graded by the server for every variant; no word progress, no per-family table',async()=>{
    const art=build('article','ka_art_02','srv-1'); const kas=build('case','ka_kas_02','srv-2'); const frg=build('question','ka_frg_02','srv-3');
    const right=recent(answer(art,{'slot-1':'die'},{sessionId:'srv'}));
    const wrong=recent(answer(kas,'Akkusativ',{sessionId:'srv'}));
    const question=recent(answer(frg,'Wem?',{sessionId:'srv'}));
    const malformed=recent(answer(frg,'Wessen?',{sessionId:'srv'}));
    const result=await ingest([{event:right,task:art},{event:wrong,task:kas},{event:question,task:frg},{event:malformed,task:frg}]);
    assert.deepEqual(result.results.map(r=>r.status+(r.reason?':'+r.reason:'')),['accepted','accepted','accepted','rejected:invalid-answer']);
    const rows=(await db.query('SELECT exercise_id,item_id,word_id,evaluation->>\'outcome\' AS outcome FROM public.learning_events ORDER BY sequence')).rows;
    assert.deepEqual(rows,[{exercise_id:'kasus-article',item_id:'ka_art_02',word_id:null,outcome:'correct'},
      {exercise_id:'kasus-case',item_id:'ka_kas_02',word_id:null,outcome:'incorrect'},
      {exercise_id:'kasus-question',item_id:'ka_frg_02',word_id:null,outcome:'correct'}]);
    assert.equal((await db.query('SELECT count(*)::int n FROM public.word_progress')).rows[0].n,0);
    assert.deepEqual((await ingest([{event:right,task:art}])).results.map(r=>r.status),['duplicate']);
    const tables=(await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name ILIKE '%kasus%'")).rows;
    assert.deepEqual(tables,[]);
  });
});
