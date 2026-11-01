import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import * as core from '../packages/vocabulary-core/dist/index.js';
import { buildSeed, loadSources, IDENTITIES_PATH } from '../scripts/vocabulary-seed.mjs';
import { catalogSeedSql } from '../scripts/catalog-bootstrap.mjs';
import { itemDatasetSql } from '../scripts/item-dataset-sql.mjs';
import { formatDataset } from '../scripts/build-gap-datasets.mjs';
import { convertKonjunktiv2Datasets, KONJUNKTIV2_DATASETS, solvedSentence } from '../scripts/build-konjunktiv2-datasets.mjs';
import { ingestLearningEvents } from '../supabase/v2/functions/v2-learning-events/handler.js';
import { itemStats, nextItem, parseTrainer, textFromTokens, tokensFromText, trainerHash, trainerStats } from '../public/v2/families/konjunktiv2/konjunktiv2-model.js';

// M5 (#337): FC08 Konjunktiv II — four trainers × text/tokens on the G3 item contracts.
const json=path=>JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'));
const TRAINERS=['transformation','conditional','polite','past'];
const source=Object.fromEntries(TRAINERS.map(t=>[t,json(`../public/data/konjunktiv2-${t}.json`)]));
const committed=Object.fromEntries(TRAINERS.map(t=>[t,json(`../public/data/items/konjunktiv2-${t}.json`)]));
// Default definitions: exactly what the server intake uses.
const items=core.createItemExerciseRegistry(Object.values(committed));
const A='00000000-0000-4000-8000-0000000000a5';
const owner={kind:'account',id:A};
const EPOCH={dataEpoch:'m5-test',epochStartedAt:'2026-01-01T00:00:00.000Z'};
const ctx=(taskId,seed='seed')=>({answerLanguage:'ru',seed,taskId});
const id=(trainer,mode)=>`konjunktiv2-${trainer}-${mode}`;
const ds=trainer=>`konjunktiv2-${trainer}`;
let counter=0;
const at=minutes=>new Date(Date.parse('2026-03-02T10:00:00.000Z')+minutes*60000).toISOString();
function answer(task,rawAnswer,over={}) {
  const n=++counter;
  return {schemaVersion:1,kind:'answer',eventId:`e-${n}`,commandId:`c-${n}`,attemptId:`a-${n}`,sessionId:'s-1',taskId:task.id,
    target:task.target,exerciseId:task.exerciseId,intent:'practice',answerLanguage:'ru',occurredAt:at(n),studyTimezone:'UTC',
    taskVersion:task.taskVersion,contentVersion:task.contentVersion,policyVersion:core.ITEM_POLICY_VERSION,dataEpoch:EPOCH.dataEpoch,
    exposure:[],assisted:false,rawAnswer,...over};
}
const grade=(task,raw)=>core.evaluateItemAnswer(items,task,answer(task,raw)).outcome;
const fact=(e,task)=>({owner,event:e,receivedAt:e.occurredAt,evaluation:core.evaluateItemAnswer(items,task,e)});
const replay={owner,...EPOCH,asOf:'2026-03-10T00:00:00.000Z'};
/** Chip IDs spelling `words` in order (each chip once). */
function chips(task,words) {
  const free=[...task.specification.exercise.tokens];
  return words.map(word=>{ const i=free.findIndex(t=>t.text===word); assert.ok(i>=0,`chip ${word}`); return free.splice(i,1)[0].id; });
}

describe('M5: converted datasets cover all of v1',()=>{
  test('the converter is deterministic, the committed datasets are current and every v1 item is there',()=>{
    const converted=convertKonjunktiv2Datasets(source,committed);
    for (const t of TRAINERS) {
      assert.equal(formatDataset(converted[t]),readFileSync(new URL(`../public/data/items/konjunktiv2-${t}.json`,import.meta.url),'utf8'));
      assert.equal(committed[t].id,KONJUNKTIV2_DATASETS[t].id); assert.equal(committed[t].kind,'grammar-item');
      assert.equal(committed[t].items.length,source[t].length);
      assert.deepEqual(committed[t].items.map(i=>i.id),source[t].map(i=>i.id));
      assert.ok(committed[t].items.every(i=>i.wordIds.length===0 && i.content.trainer===t));
    }
    assert.deepEqual(TRAINERS.map(t=>committed[t].items.length),[25,20,20,20]);
    assert.deepEqual(convertKonjunktiv2Datasets(source,committed),converted);
  });
  test('sentences, all accepted answers and hints are kept; chips are the v1 chips (plus a missing second "würde")',()=>{
    for (const t of TRAINERS) source[t].forEach((v1,i)=>{
      const c=committed[t].items[i].content;
      assert.equal(c.template,v1.sentence); assert.deepEqual(c.answers,v1.answers); assert.equal(c.hint,v1.hint);
      assert.deepEqual(c.tokens.slice(0,v1.tokens.length),v1.tokens);
    });
    const extended=TRAINERS.flatMap(t=>committed[t].items.filter((item,i)=>item.content.tokens.length!==source[t][i].tokens.length)
      .map(item=>[item.id,item.content.tokens.slice(source[t].find(v=>v.id===item.id).tokens.length)]));
    assert.deepEqual(extended,[['k2c_012',['würden']],['k2c_013',['würde']],['k2c_018',['würdet']]]);
  });
  test('the spoken solution is the whole sentence; a lone "würde" gets its infinitive at the end of the clause',()=>{
    const sol=(t,itemId)=>committed[t].items.find(i=>i.id===itemId).content.solution;
    assert.equal(sol('transformation','k2t_001'),'Ich hätte gern mehr Zeit.');
    assert.equal(sol('transformation','k2t_005'),'Wir würden gern ins Kino gehen.');
    assert.equal(sol('transformation','k2t_021'),'Ich würde dir das Buch geben, wenn ich es hätte.');
    assert.equal(sol('transformation','k2t_013'),'Er würde gern Arzt.'); // "werden → würde": würde is the verb itself
    assert.equal(sol('conditional','k2c_001'),'Wenn ich reich wäre, würde ich um die Welt reisen.');
    assert.equal(sol('polite','k2p_001'),'Könnten Sie mir bitte helfen?');
    assert.equal(sol('past','k2v_014'),'Wenn wir früher losgefahren wären, hätten wir den Stau vermieden.');
    assert.ok(TRAINERS.every(t=>committed[t].items.every(i=>!/[()_]/.test(i.content.solution))));
    assert.throws(()=>solvedSentence('Wenn ich (sein) ___, (gehen) ___ ich.','wäre','x'),RangeError);
  });
  test('a changed v1 hint gives a new content version and dataset version; the rest keep theirs',()=>{
    const changed=structuredClone(source); changed.polite[3].hint='dürfen → dürfte (höflich)';
    const next=convertKonjunktiv2Datasets(changed,committed);
    assert.equal(next.polite.version,String(Number(committed.polite.version)+1));
    assert.equal(next.polite.items[3].contentVersion,committed.polite.items[3].contentVersion+1);
    assert.ok(next.polite.items.every((item,i)=>i===3 || item.contentVersion===committed.polite.items[i].contentVersion));
    assert.equal(next.past.version,committed.past.version);
  });
});

describe('M5: eight definitions, each trainer with its own check rule',()=>{
  test('four trainers × text/tokens are registered for the server; each applies to its own trainer only',()=>{
    const ids=core.ITEM_EXERCISES.map(d=>d.id).filter(x=>x.startsWith('konjunktiv2-'));
    assert.deepEqual(ids,TRAINERS.flatMap(t=>[id(t,'text'),id(t,'tokens')]));
    assert.ok(core.KONJUNKTIV2_EXERCISES.every(d=>d.version===`${d.id}/1` && d.input===d.id.split('-').pop()));
    assert.equal(items.isAvailable(id('polite','text'),ds('polite'),'k2p_001',ctx('a')),true);
    assert.equal(items.isAvailable(id('past','text'),ds('polite'),'k2p_001',ctx('a')),false);
    assert.throws(()=>items.buildTask(id('past','tokens'),ds('conditional'),'k2c_001',ctx('a')),RangeError);
  });
  test('every v1 item is solvable in both modes with its first answer, and tasks survive the canonical rebuild',()=>{
    for (const t of TRAINERS) for (const item of committed[t].items) {
      const text=items.buildTask(id(t,'text'),ds(t),item.id,ctx(`x-${item.id}`));
      assert.equal(grade(text,item.content.answers[0]),'correct',item.id);
      const tokens=items.buildTask(id(t,'tokens'),ds(t),item.id,ctx(`y-${item.id}`));
      assert.equal(grade(tokens,chips(tokens,item.content.answers[0].replace(/,/g,'').split(' '))),'correct',item.id);
      assert.deepEqual(items.validateTask(JSON.parse(JSON.stringify(tokens))),tokens);
      assert.equal(tokens.specification.exercise.tokens.length,item.content.tokens.length);
    }
  });
  test('chip order is deterministic per seed and item (a retry keeps it) and differs between seeds',()=>{
    const order=(seed,task)=>items.buildTask(id('conditional','tokens'),ds('conditional'),'k2c_001',ctx(task,seed)).specification.exercise.tokens.map(t=>t.id);
    assert.deepEqual(order('s1','a'),order('s1','b'));
    assert.ok(['s2','s3','s4','s5'].some(seed=>order(seed,'a').join()!==order('s1','a').join()));
  });
  test('transformation, polite, past: case, punctuation and spacing are neutral; listed alternatives count',()=>{
    const tx=items.buildTask(id('transformation','text'),ds('transformation'),'k2t_002',ctx('t1'));
    for (const raw of ['käme','kommen würde','  Kommen   Würde! ','KÄME.']) assert.equal(grade(tx,raw),'correct',raw);
    for (const raw of ['kommt','würde kommen','kame']) assert.equal(grade(tx,raw),'incorrect',raw);
    const tt=items.buildTask(id('transformation','tokens'),ds('transformation'),'k2t_002',ctx('t2'));
    assert.equal(grade(tt,chips(tt,['kommen','würde'])),'correct');
    assert.equal(grade(tt,chips(tt,['würde','kommen'])),'incorrect');
    assert.equal(grade(tt,chips(tt,['kommt'])),'incorrect');
    const polite=items.buildTask(id('polite','text'),ds('polite'),'k2p_001',ctx('t3'));
    assert.equal(grade(polite,'könnten'),'correct'); assert.equal(grade(polite,'Können'),'incorrect');
    const past=items.buildTask(id('past','tokens'),ds('past'),'k2v_001',ctx('t4'));
    assert.equal(grade(past,chips(past,['gewusst','hätte'])),'correct');
    assert.equal(grade(past,chips(past,['hätte','gewusst'])),'incorrect');
    assert.equal(grade(items.buildTask(id('past','text'),ds('past'),'k2v_001',ctx('t5')),'Gewusst  hätte'),'correct');
  });
  test('conditional: typed answers need the comma between the two forms; chips are compared without it',()=>{
    const typed=items.buildTask(id('conditional','text'),ds('conditional'),'k2c_008',ctx('c1'));
    for (const raw of ['wäre, würden','wäre,würden','Wäre ,  würden.','wäre, gingen']) assert.equal(grade(typed,raw),'correct',raw);
    for (const raw of ['wäre würden','würden, wäre','wäre, würde']) assert.equal(grade(typed,raw),'incorrect',raw);
    const placed=items.buildTask(id('conditional','tokens'),ds('conditional'),'k2c_008',ctx('c2'));
    assert.equal(grade(placed,chips(placed,['wäre','würden'])),'correct');
    assert.equal(grade(placed,chips(placed,['würden','wäre'])),'incorrect');
    // The added chip makes k2c_013 solvable with chips ("verdienen würde, würde").
    const extended=items.buildTask(id('conditional','tokens'),ds('conditional'),'k2c_013',ctx('c3'));
    assert.equal(grade(extended,chips(extended,['verdienen','würde','würde'])),'correct');
  });
  test('malformed answers are refused (RangeError), never graded as wrong',()=>{
    const text=items.buildTask(id('polite','text'),ds('polite'),'k2p_001',ctx('m1'));
    const tokens=items.buildTask(id('polite','tokens'),ds('polite'),'k2p_001',ctx('m2'));
    for (const raw of ['','   ',['t0'],'a'.repeat(1000),'Könnten\u0000']) assert.throws(()=>grade(text,raw),RangeError,JSON.stringify(raw));
    for (const raw of [[],['t0','t0'],['nope'],'Könnten',[1]]) assert.throws(()=>grade(tokens,raw),RangeError,JSON.stringify(raw));
  });
});

describe('M5: page model',()=>{
  test('trainer in the URL hash; unknown values fall back to transformation',()=>{
    assert.equal(parseTrainer('#trainer=past'),'past'); assert.equal(parseTrainer('#trainer=nope'),'transformation');
    assert.equal(parseTrainer(''),'transformation'); assert.equal(trainerHash('polite'),'#trainer=polite');
  });
  test('a draft moves between text and chips without being lost',()=>{
    const task=items.buildTask(id('conditional','tokens'),ds('conditional'),'k2c_001',ctx('d1'));
    const tokens=task.specification.exercise.tokens;
    const placed=tokensFromText('Wäre, würde',tokens);
    assert.deepEqual(placed.answer.map(i=>tokens.find(t=>t.id===i).text),['wäre','würde']);
    assert.equal(placed.pool.length+placed.answer.length,tokens.length);
    assert.equal(textFromTokens(placed,tokens),'wäre würde');
    // Words without a free chip are dropped; a word typed twice uses a chip once.
    assert.deepEqual(tokensFromText('xyz wäre wäre',tokens).answer.map(i=>tokens.find(t=>t.id===i).text),['wäre']);
  });
  test('selection: unanswered first, never the shown one; statistics per sentence and per trainer and mode, no word progress',()=>{
    const empty=core.projectExerciseProgress([],replay);
    assert.equal(nextItem(items,empty,'polite','text'),'k2p_001');
    assert.equal(nextItem(items,empty,'polite','text','k2p_001'),'k2p_002');
    const a=items.buildTask(id('polite','text'),ds('polite'),'k2p_001',ctx('s1'));
    const b=items.buildTask(id('polite','tokens'),ds('polite'),'k2p_001',ctx('s2'));
    const records=[fact(answer(a,'Kannst'),a),fact(answer(b,chips(b,['Könnten']),{assisted:true}),b)];
    const progress=core.projectExerciseProgress(records,replay);
    assert.equal(nextItem(items,progress,'polite','text'),'k2p_002');
    assert.deepEqual(itemStats(progress,'polite','k2p_001'),{answers:2,independent:0});
    assert.equal(itemStats(progress,'polite','k2p_002'),undefined);
    const s=trainerStats(items,progress,'polite');
    assert.deepEqual([s.text.attempted,s.text.applicable,s.text.accuracy,s.tokens.attempted],[1,20,0,1]);
    assert.deepEqual(trainerStats(items,progress,'past').text.attempted,0);
    assert.ok(records.every(r=>r.event.target.kind==='grammar-item'));
  });
});

describe('M5: the server evaluates Konjunktiv II answers through the shared intake',()=>{
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
    await db.exec(itemDatasetSql(Object.values(committed)));
  });
  after(async()=>{await db?.close();});

  test('one answer is one event graded by the server with the trainer rule; no word progress, no per-family table',async()=>{
    const typed=items.buildTask(id('conditional','text'),ds('conditional'),'k2c_001',ctx('srv-1'));
    const placed=items.buildTask(id('past','tokens'),ds('past'),'k2v_001',ctx('srv-2'));
    const right=recent(answer(typed,'wäre,würde',{sessionId:'srv'}));
    const typedAgain=items.buildTask(id('conditional','text'),ds('conditional'),'k2c_001',ctx('srv-1b'));
    const noComma=recent(answer(typedAgain,'wäre würde',{sessionId:'srv'}));
    const chipsRight=recent(answer(placed,chips(placed,['gewusst','hätte']),{sessionId:'srv'}));
    const malformed=recent(answer(placed,['nope'],{sessionId:'srv'}));
    const result=await ingest([{event:right,task:typed},{event:noComma,task:typedAgain},{event:chipsRight,task:placed},{event:malformed,task:placed}]);
    assert.deepEqual(result.results.map(r=>r.status+(r.reason?':'+r.reason:'')),['accepted','accepted','accepted','rejected:invalid-answer']);
    const rows=(await db.query('SELECT exercise_id,dataset_id,item_id,word_id,evaluation->>\'outcome\' AS outcome FROM public.learning_events ORDER BY sequence')).rows;
    assert.deepEqual(rows,[
      {exercise_id:'konjunktiv2-conditional-text',dataset_id:'konjunktiv2-conditional',item_id:'k2c_001',word_id:null,outcome:'correct'},
      {exercise_id:'konjunktiv2-conditional-text',dataset_id:'konjunktiv2-conditional',item_id:'k2c_001',word_id:null,outcome:'incorrect'},
      {exercise_id:'konjunktiv2-past-tokens',dataset_id:'konjunktiv2-past',item_id:'k2v_001',word_id:null,outcome:'correct'}]);
    assert.equal((await db.query('SELECT count(*)::int n FROM public.word_progress')).rows[0].n,0);
    assert.deepEqual((await ingest([{event:right,task:typed}])).results.map(r=>r.status),['duplicate']);
    const tables=(await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND (table_name ILIKE '%konjunktiv%' OR table_name ILIKE '%k2%')")).rows;
    assert.deepEqual(tables,[]);
  });
});
