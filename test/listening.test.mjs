import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as core from '../packages/vocabulary-core/dist/index.js';
import { SENTENCE_DATASET_PATH } from '../scripts/build-sentence-dataset.mjs';
import { nextSentence, poolStats, sentenceStats } from '../public/v2/families/sentences/sentences-model.js';

// M2 (#334): listening over the M1 sentence corpus — audio prompt, token and text answers.
const dataset=JSON.parse(readFileSync(SENTENCE_DATASET_PATH,'utf8'));
const registry=core.createItemExerciseRegistry([dataset]);
const owner={kind:'guest',id:'g'};
const EPOCH={dataEpoch:'m2',epochStartedAt:'2026-01-01T00:00:00.000Z'};
const ctx=(taskId='t',seed='seed',answerLanguage='ru')=>({answerLanguage,seed,taskId});
const build=(exerciseId,itemId,c=ctx())=>registry.buildTask(exerciseId,'sentences',itemId,c);
const solved=task=>[...task.specification.exercise.tokens].sort((a,b)=>+a.id.slice(1)-+b.id.slice(1)).map(t=>t.id);
let n=0;
function fact(task,rawAnswer,over={}) {
  const id=++n;
  const event={schemaVersion:1,kind:'answer',eventId:`e${id}`,commandId:`c${id}`,attemptId:`a${id}`,sessionId:`s${id}`,taskId:task.id,
    target:task.target,exerciseId:task.exerciseId,intent:'practice',answerLanguage:'ru',occurredAt:new Date(Date.parse('2026-03-01T10:00:00.000Z')+id*60000).toISOString(),
    studyTimezone:'UTC',taskVersion:task.taskVersion,contentVersion:task.contentVersion,policyVersion:core.ITEM_POLICY_VERSION,dataEpoch:EPOCH.dataEpoch,
    rawAnswer,assisted:false,exposure:[],...over};
  return {owner,event,receivedAt:event.occurredAt,evaluation:core.evaluateItemAnswer(registry,task,event)};
}
const replay=records=>core.projectExerciseProgress(records,{owner,...EPOCH,asOf:'2026-04-01T00:00:00.000Z'});

describe('M2: listening adapter',()=>{
  test('both modes are registered for sentences and video segments',()=>{
    assert.ok(core.ITEM_EXERCISES.includes(core.LISTENING_TOKENS) && core.ITEM_EXERCISES.includes(core.LISTENING_TEXT));
    for(const def of [core.LISTENING_TOKENS,core.LISTENING_TEXT]) assert.deepEqual(def.targetKinds,['sentence','video-segment']);
    assert.deepEqual([core.LISTENING_TOKENS.input,core.LISTENING_TEXT.input],['tokens','text']);
  });

  test('every sentence is solvable in both modes; the audio is the target and the prompt is not the text',()=>{
    for(const item of dataset.items) {
      const tokens=build('listening-tokens',item.id,ctx(`k-${item.id}`));
      const typed=build('listening-text',item.id,ctx(`x-${item.id}`));
      assert.equal(core.evaluateListening(tokens.specification.exercise,solved(tokens)),'correct',item.id);
      assert.equal(core.evaluateListening(typed.specification.exercise,item.content.target),'correct',item.id);
      for(const task of [tokens,typed]) {
        const ex=task.specification.exercise;
        assert.deepEqual(ex.audio,{text:item.content.target,lang:'de'});
        assert.equal(ex.prompt,undefined,'no text prompt: the audio is the prompt');
      }
      assert.equal(typed.specification.exercise.tokens,undefined,'typing shows no tokens');
      if(item.content.tokens.length>1) assert.notEqual(tokens.specification.exercise.tokens.map(t=>t.text).join(' '),item.content.tokens.join(' '),item.id);
    }
  });

  test('typing uses the v1 dictation rule; alternatives count; invalid answers are rejected',()=>{
    const task=build('listening-text','s1');
    const ex=task.specification.exercise;
    assert.equal(ex.target,'Ich heiße Anna.');
    for(const ok of ['Ich heiße Anna.','ich heiße anna','  Ich  heiße, Anna!  ','ICH HEIẞE ANNA']) assert.equal(core.evaluateListening(ex,ok),'correct',ok);
    assert.equal(core.evaluateListening(ex,'Ich heisse Anna'),'incorrect','ß is a letter, not neutral');
    assert.equal(core.evaluateListening(ex,'Ich heiße'),'incorrect');
    const alt=build('listening-text','s_b1_23').specification.exercise;
    assert.equal(core.evaluateListening(alt,alt.alternatives[0]),'correct','a listed alternative');
    for(const bad of ['', '   ', 'x'.repeat(501), 'a\u0000b', ['t0'], null]) assert.throws(()=>core.evaluateListening(ex,bad),/Invalid/);
    assert.ok(core.isListeningTextCorrect('Straße 12','straße 12.'));
    assert.ok(!core.isListeningTextCorrect('?!','.'),'punctuation alone is never an answer');
  });

  test('assembly while listening uses the shared sentence check; a retry keeps the order',()=>{
    const task=build('listening-tokens','s_b1_23');
    const {tokens}=dataset.items.find(i=>i.id==='s_b1_23').content;
    assert.equal(tokens[9],'noch');
    const order=[0,1,2,3,4,5,6,9,7,8,10,11].map(i=>`t${i}`);
    assert.equal(core.evaluateListening(task.specification.exercise,order),'correct');
    assert.equal(core.evaluateListening(task.specification.exercise,[...solved(task)].reverse()),'incorrect');
    assert.throws(()=>core.evaluateListening(task.specification.exercise,'text'),/Invalid/);
    assert.deepEqual(build('listening-tokens','s_b1_23',ctx('other')).specification.exercise.tokens,task.specification.exercise.tokens);
    assert.deepEqual(task.specification.exercise.tokens,build('sentence-assembly','s_b1_23').specification.exercise.tokens,'same order as the builder for one seed');
  });

  test('translation and explanation travel with the task for after the answer; no translation needed to listen',()=>{
    const ex=build('listening-text','s1',ctx('t','seed','en')).specification.exercise;
    assert.deepEqual(ex.translation,{text:'My name is Anna.',lang:'en'});
    assert.ok(ex.explanation);
    const bare={...dataset,items:[{...dataset.items[0],content:{...dataset.items[0].content,translations:{}}}]};
    const task=core.createItemExerciseRegistry([bare]).buildTask('listening-text','sentences','s1',ctx());
    assert.equal(task.specification.exercise.translation,undefined);
    assert.equal(core.buildListeningExercise(dataset.items[0],ctx(),'text',{text:'Hallo.',lang:'de'}).audio.text,'Hallo.','an own audio source (M6)');
  });

  test('a video segment reuses listening with its own target kind',()=>{
    const video={...dataset,id:'video-fixture',kind:'video-segment',items:[dataset.items[0]]};
    const task=core.createItemExerciseRegistry([video]).buildTask('listening-text','video-fixture','s1',ctx());
    assert.equal(task.target.kind,'video-segment');
  });
});

describe('M2: statistics are per exercise',()=>{
  test('listening answers never count as assembly of the same sentence, and the two modes are apart',()=>{
    const typed=build('listening-text','s1',ctx('l1'));
    const assembled=build('listening-tokens','s1',ctx('l2'));
    const progress=replay([fact(typed,'ich heiße anna'),fact(assembled,[...solved(assembled)].reverse())]);
    assert.deepEqual(sentenceStats(progress,'s1','listening-text'),{answers:1,independent:1});
    assert.deepEqual(sentenceStats(progress,'s1','listening-tokens'),{answers:1,independent:0});
    assert.equal(sentenceStats(progress,'s1'),undefined,'the builder has no answer for s1');
    assert.equal(poolStats(registry,progress,{deck:'a1'}).attempted,0);
    assert.equal(poolStats(registry,progress,{deck:'a1'},'listening-text').attempted,1);
    assert.equal(nextSentence(registry,progress,{deck:'a1'},undefined),'s1','still new for the builder');
    assert.notEqual(nextSentence(registry,progress,{deck:'a1'},undefined,'listening-text'),'s1');
  });
});
