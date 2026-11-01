import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as core from '../packages/vocabulary-core/dist/index.js';
import { buildLevelTestDataset, serialize, senses, LEVEL_TEST_DATASET_PATH, LEVEL_TEST_DECKS } from '../scripts/build-level-test-dataset.mjs';
import { latestLevelResult, levelTestRuns, plannedLevels, progressOf, stepAfterAnswer } from '../public/v2/families/level-test/level-test-model.js';

// M8 (#340): the v1 level test as an assessment dataset, its choice adapter, the AssessmentPlanner/
// ScoringPolicy and the run results the page and the home screen read from the shared journal.
const dataset=JSON.parse(readFileSync(LEVEL_TEST_DATASET_PATH,'utf8'));
const registry=core.createItemExerciseRegistry([dataset]);
const v1=LEVEL_TEST_DECKS.flatMap(deck=>JSON.parse(readFileSync(`public/data/words-${deck}.json`,'utf8')).map(w=>({deck,...w})));
const owner={kind:'guest',id:'g'};
const EPOCH={dataEpoch:'m8',epochStartedAt:'2026-01-01T00:00:00.000Z'};
const context={owner,...EPOCH,asOf:'2026-04-01T00:00:00.000Z'};
const byId=new Map(dataset.items.map(i=>[i.id,i]));
const levelOf=id=>byId.get(id).content.level;

function plan(sessionId='run-1',seed='seed-1',answerLanguage='ru') {
  return core.planItemSession({registry,owner,sessionId,dataEpoch:EPOCH.dataEpoch,studyTimezone:'UTC',seed,createdAt:'2026-03-01T09:00:00.000Z',
    answerLanguage,datasetId:'level-test',items:core.planLevelTest(dataset,seed)});
}
let n=0;
/** A journal record for a task, built and evaluated as the Runner and the server would. */
function fact(task,sessionId,{correct=true,kind='answer',assisted=false,option}={}) {
  const id=++n;
  const content=byId.get(task.target.itemId).content;
  const rawAnswer=option ?? (correct ? content.correctOptionId : content.options.find(o=>o.id!==content.correctOptionId).id);
  const event={schemaVersion:1,kind,eventId:`e${id}`,commandId:`c${id}`,sessionId,taskId:task.id,target:task.target,exerciseId:task.exerciseId,
    intent:'assessment',answerLanguage:task.specification.answerLanguage,occurredAt:new Date(Date.parse('2026-03-01T10:00:00.000Z')+id*1000).toISOString(),
    studyTimezone:'UTC',taskVersion:task.taskVersion,contentVersion:task.contentVersion,policyVersion:core.ITEM_POLICY_VERSION,dataEpoch:EPOCH.dataEpoch,exposure:[],
    ...(kind==='answer'?{attemptId:`a${id}`,rawAnswer,assisted}:{})};
  return {owner,event,receivedAt:event.occurredAt,...(kind==='answer'?{evaluation:core.evaluateItemAnswer(registry,task,event)}:{})};
}
/** Answer the planned tasks in order: `pattern[i]` true/false per task, until the pattern ends. */
const answers=(p,pattern)=>pattern.map((correct,i)=>fact(p.tasks[i],p.sessionId,{correct}));
const block=(correct,total=10)=>Array.from({length:total},(_,i)=>i<correct);
const archive=(p,status='presenting')=>({state:{plan:p,status,taskIndex:0,revision:1},catalogVersion:'',words:[],datasets:[dataset]});

describe('M8: assessment dataset converted from the v1 level test',()=>{
  test('the committed dataset is current and has one question per v1 word of A1–B2',()=>{
    assert.equal(readFileSync(LEVEL_TEST_DATASET_PATH,'utf8'),serialize(buildLevelTestDataset()),'run npm run items:level-test');
    core.assertItemDataset(dataset);
    assert.equal(dataset.kind,'assessment');
    assert.match(dataset.version,/^level-test-[0-9a-f]{16}$/);
    assert.equal(dataset.items.length,v1.length);
    for(const w of v1) {
      const c=byId.get(w.id).content;
      assert.equal(c.level,w.deck); assert.equal(c.prompt.text,w.de); assert.equal(c.prompt.lang,'de');
      const answer=c.options.find(o=>o.id===c.correctOptionId);
      assert.equal(c.correctOptionId,w.id); assert.equal(answer.ru,w.ru); assert.equal(answer.en,w.en ?? w.ru);
    }
  });
  test('three distractors from the same level, none sharing a label or sense with another option (v1 rule)',()=>{
    const decks=new Map(dataset.items.map(i=>[i.id,i.content.level]));
    for(const item of dataset.items) {
      const {options,level}=item.content;
      assert.equal(options.length,4,item.id);
      assert.ok(options.every(o=>decks.get(o.id)===level),item.id);
      for(const lang of ['ru','en']) {
        const keys=options.map(o=>new Set([o[lang].toLowerCase(),...senses(o[lang])]));
        for(let i=0;i<keys.length;i++) for(let j=i+1;j<keys.length;j++) assert.ok(![...keys[i]].some(k=>keys[j].has(k)),`${item.id} ${lang}`);
      }
    }
  });
  test('word links point at v2 words, for links only',()=>{
    const ids=new Set(JSON.parse(readFileSync('content/vocabulary/identities.json','utf8')).words.map(w=>w.id));
    assert.ok(dataset.items.every(i=>i.wordIds.length===1&&ids.has(i.wordIds[0])));
  });
});

describe('M8: level-test-choice adapter (not ITEM_CHOICE: labels per answer language, assessment only)',()=>{
  const item=dataset.items[0];
  const build=(answerLanguage,taskId='t1',seed='s')=>registry.buildTask('level-test-choice','level-test',item.id,{answerLanguage,seed,taskId});
  test('labels follow the answer language; the order is fixed per task; the answer is not in the task',()=>{
    const ru=build('ru'); const en=build('en');
    assert.deepEqual(ru.specification.exercise.options.map(o=>o.id),en.specification.exercise.options.map(o=>o.id));
    assert.ok(ru.specification.exercise.options.some(o=>o.label==='стол')); assert.ok(en.specification.exercise.options.some(o=>o.label==='table'));
    assert.deepEqual(build('ru').specification.exercise,ru.specification.exercise);
    assert.equal(JSON.stringify(ru.specification).includes('correctOptionId'),false);
    const orders=new Set(Array.from({length:12},(_,i)=>build('ru',`t${i}`).specification.exercise.options[0].id));
    assert.ok(orders.size>1,'the correct option is not always first');
    assert.equal(ru.input,'choice'); assert.equal(ru.target.kind,'assessment');
  });
  test('evaluates by option ID on the server registry; malformed answers are rejected',()=>{
    assert.ok(core.ITEM_EXERCISES.includes(core.LEVEL_TEST_CHOICE));
    const task=build('en');
    assert.equal(core.LEVEL_TEST_CHOICE.evaluate(item,task.specification.exercise,'w_a1_1'),'correct');
    assert.equal(core.LEVEL_TEST_CHOICE.evaluate(item,task.specification.exercise,item.content.options[1].id),'incorrect');
    for(const bad of ['nope',null,1,['w_a1_1']]) assert.throws(()=>core.LEVEL_TEST_CHOICE.evaluate(item,task.specification.exercise,bad),/Unknown answer option/);
  });
  test('only assessment datasets; tasks carry the assessment intent, never practice',()=>{
    const practice={...dataset,id:'practice-fixture',kind:'grammar-item',items:[item]};
    assert.equal(core.createItemExerciseRegistry([practice]).isAvailable('level-test-choice','practice-fixture',item.id,{answerLanguage:'ru',seed:'s',taskId:'t'}),false);
    assert.equal(plan().intent,'assessment');
    const f=fact(plan().tasks[0],'run-1');
    assert.throws(()=>core.bindItemEvent(registry,plan().tasks[0],{...f.event,intent:'practice'}),/mismatch/);
  });
});

describe('M8: AssessmentPlanner',()=>{
  test('four blocks of ten, A1 → B2, chosen by the seed and reproducible',()=>{
    const items=core.planLevelTest(dataset,'seed-1');
    assert.equal(items.length,40);
    assert.deepEqual([...new Set(items.map(i=>levelOf(i.itemId)))],['a1','a2','b1','b2']);
    for(const level of core.LEVEL_TEST_LEVELS) assert.equal(items.filter(i=>levelOf(i.itemId)===level).length,10);
    assert.equal(new Set(items.map(i=>i.itemId)).size,40);
    assert.deepEqual(core.planLevelTest(dataset,'seed-1'),items);
    assert.notDeepEqual(core.planLevelTest(dataset,'seed-2'),items);
    const a1=items.slice(0,10).map(i=>Number(i.itemId.split('_').pop())).sort((a,b)=>a-b);
    assert.ok(a1[9]-a1[0]>100,'spread over the deck, not neighbours');
    assert.throws(()=>core.planLevelTest({items:dataset.items.slice(0,5)},'s'),/Not enough/);
  });
});

describe('M8: ScoringPolicy (blocks, threshold, early finish, recommendation)',()=>{
  const tasks=core.planLevelTest(dataset,'seed-1').map(i=>({itemId:i.itemId,level:levelOf(i.itemId)}));
  const score=pattern=>core.scoreLevelTest(tasks,new Map(pattern.map((o,i)=>[tasks[i].itemId,o===true?'correct':o===false?'incorrect':o])));
  test('7/10 passes and moves on, 6/10 fails and ends the test early',()=>{
    const pass=score(block(7));
    assert.equal(pass.status,'in-progress'); assert.equal(pass.blocks[0].passed,true); assert.equal(pass.blocks[1].level,'a2');
    const fail=score(block(6));
    assert.equal(fail.status,'concluded'); assert.equal(fail.skipped,30);
    assert.deepEqual(fail.estimate,{level:'a1',start:'a1'});
    assert.deepEqual(fail.blocks.map(b=>b.level),['a1']);
  });
  test('a block is open until every question is answered, even when the outcome is already certain',()=>{
    const s=score(block(4,9).map(()=>false));
    assert.equal(s.status,'in-progress'); assert.equal(s.blocks[0].passed,null); assert.equal(s.estimate,undefined);
  });
  test('estimates: highest passed block, start one above; all passed → B2+ starting at B2',()=>{
    assert.deepEqual(score([...block(10),...block(3)]).estimate,{level:'a1',start:'a2'});
    assert.deepEqual(score([...block(8),...block(7),...block(6)]).estimate,{level:'a2',start:'b1'});
    assert.deepEqual(score([...block(7),...block(7),...block(7),...block(6)]).estimate,{level:'b1',start:'b2'});
    const all=score([...block(7),...block(9),...block(7),...block(7)]);
    assert.equal(all.status,'concluded'); assert.equal(all.skipped,0); assert.deepEqual(all.estimate,{level:'b2+',start:'b2'});
  });
  test('revealed or assisted answers (unobserved) are not correct',()=>{
    const s=score([...block(6),'unobserved','unobserved','unobserved','unobserved']);
    assert.equal(s.blocks[0].correct,6); assert.equal(s.blocks[0].passed,false);
  });
  test('the v1 estimate function keeps its boundaries',()=>{
    assert.deepEqual(core.estimateLevel([]),{level:'a1',start:'a1'});
    assert.deepEqual(core.estimateLevel([{level:'a1',passed:false}]),{level:'a1',start:'a1'});
    assert.deepEqual(core.estimateLevel([{level:'a1',passed:true},{level:'a2',passed:null}]),{level:'a1',start:'a2'});
  });
});

describe('M8: runs from the shared journal (one result per run, never WordProgress)',()=>{
  test('the first answer per question counts; a reveal or an assisted answer is unobserved; the run concludes early',()=>{
    const p=plan();
    const records=[...answers(p,block(6,9)),fact(p.tasks[0],p.sessionId,{correct:false})];
    records.push(fact(p.tasks[9],p.sessionId,{kind:'reveal'}),fact(p.tasks[9],p.sessionId,{correct:true}));
    const [run]=levelTestRuns({sessions:[archive(p,'abandoned')],facts:records},context);
    assert.equal(run.score.blocks[0].correct,6,'a later wrong answer does not replace the first correct one; the revealed one does not count');
    assert.equal(run.score.status,'concluded'); assert.deepEqual(run.score.estimate,{level:'a1',start:'a1'});
    assert.equal(stepAfterAnswer(run.score,9,40),'finish');
    assert.deepEqual(progressOf(run.score,9,40),{n:10,max:10});
    const assisted=levelTestRuns({sessions:[archive(p)],facts:[...answers(p,block(6,9)),fact(p.tasks[9],p.sessionId,{correct:true,assisted:true})]},context)[0];
    assert.equal(assisted.score.blocks[0].correct,6);
  });
  test('steps: next inside and between passed blocks, complete after the last question',()=>{
    const p=plan('run-2','seed-2');
    const mid=levelTestRuns({sessions:[archive(p)],facts:answers(p,block(7))},context)[0];
    assert.equal(stepAfterAnswer(mid.score,9,40),'next'); assert.deepEqual(progressOf(mid.score,10,40),{n:11,max:40});
    const all=levelTestRuns({sessions:[archive(p)],facts:answers(p,[...block(7),...block(7),...block(7),...block(7)])},context)[0];
    assert.equal(stepAfterAnswer(all.score,39,40),'complete');
  });
  test('the home screen shows the latest concluded run; a stopped run has no estimate',()=>{
    const done=plan('run-a','seed-a'); const stopped={...plan('run-b','seed-b'),createdAt:'2026-03-02T09:00:00.000Z'};
    const runs=levelTestRuns({sessions:[archive(stopped,'abandoned'),archive(done,'abandoned')],
      facts:[...answers(done,[...block(9),...block(5)]),...answers(stopped,block(10,4))]},context);
    assert.deepEqual(runs.map(r=>r.sessionId),['run-a','run-b']);
    assert.equal(runs[1].score.status,'in-progress');
    assert.equal(latestLevelResult(runs).sessionId,'run-a');
    assert.deepEqual(latestLevelResult(runs).score.estimate,{level:'a1',start:'a2'});
    assert.equal(latestLevelResult([runs[1]]),undefined);
  });
  test('test answers feed neither exercise statistics nor word progress',()=>{
    const p=plan('run-3','seed-3');
    const records=answers(p,block(10));
    assert.deepEqual(core.projectExerciseProgress(records,context).items,[]);
    assert.ok(records.every(r=>r.event.target.kind==='assessment'&&r.event.intent==='assessment'));
    assert.equal(core.projectAssessments(records,context).length,1);
    assert.deepEqual(plannedLevels(archive(p)).slice(0,1),[{itemId:p.tasks[0].target.itemId,level:'a1'}]);
  });
  test('other datasets and vocabulary sessions are not level test runs',()=>{
    const other={...plan(),datasets:[{datasetId:'sentences',version:'x'}]};
    assert.deepEqual(levelTestRuns({sessions:[{state:{plan:other,status:'completed',taskIndex:40,revision:3}}],facts:[]},context),[]);
  });
});
