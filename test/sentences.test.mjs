import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as core from '../packages/vocabulary-core/dist/index.js';
import { buildSentenceDataset, serialize, SENTENCE_DATASET_PATH, SENTENCE_DECKS } from '../scripts/build-sentence-dataset.mjs';
import { linkedSentences, nextSentence, parseFilter, filterHash, pool, poolStats, sentenceStats, tagsOf, formatTag } from '../public/v2/families/sentences/sentences-model.js';

// M1 (#333): the v1 sentence corpus as an ItemDataset, the shared sentence adapter and the page model.
const dataset=JSON.parse(readFileSync(SENTENCE_DATASET_PATH,'utf8'));
const registry=core.createItemExerciseRegistry([dataset]);
const v1=SENTENCE_DECKS.flatMap(deck=>JSON.parse(readFileSync(`public/data/sentences-${deck}.json`,'utf8')).map(s=>({deck,...s})));
const owner={kind:'guest',id:'g'};
const EPOCH={dataEpoch:'m1',epochStartedAt:'2026-01-01T00:00:00.000Z'};
const ctx=(taskId='t',seed='seed')=>({answerLanguage:'ru',seed,taskId});
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

describe('M1: sentence dataset converted from v1',()=>{
  test('the committed dataset is current, versioned by content and keeps every v1 sentence and field',()=>{
    assert.equal(readFileSync(SENTENCE_DATASET_PATH,'utf8'),serialize(buildSentenceDataset()),'run npm run items:sentences');
    core.assertItemDataset(dataset);
    assert.match(dataset.version,/^sentences-[0-9a-f]{16}$/);
    assert.equal(dataset.items.length,v1.length);
    const items=new Map(dataset.items.map(i=>[i.id,i.content]));
    for(const s of v1) {
      const c=items.get(s.id);
      assert.equal(c.deck,s.deck); assert.equal(c.target,s.target); assert.deepEqual(c.tokens,s.tokens);
      assert.deepEqual(c.alternatives,s.alternatives ?? []); assert.deepEqual(c.tags,s.tags ?? []);
      assert.equal(c.translations.ru,s.translation_ru); assert.equal(c.translations.en,s.translation_en); assert.equal(c.translations.es,s.translation_es);
      assert.equal(c.explanation,s.explanation); assert.equal(c.variantOf,s.variant_of);
      assert.equal(c.tense,s.tense); assert.deepEqual(c.tenseVariants,s.tense_variants);
    }
    assert.ok(dataset.items.every(i=>i.wordIds.length===0),'no word link, hence no WordProgress');
  });

  test('every sentence is solvable in both translation languages, and never shown solved',()=>{
    for(const item of dataset.items) for(const answerLanguage of ['ru','en']) {
      const task=registry.buildTask('sentence-assembly','sentences',item.id,{answerLanguage,seed:'s',taskId:`t-${item.id}`});
      assert.equal(core.evaluateSentenceTokens(task.specification.exercise,solved(task)),'correct',item.id);
      const shown=task.specification.exercise.tokens.map(t=>t.text).join(' ');
      if(item.content.tokens.length>1) assert.notEqual(shown,item.content.tokens.join(' '),item.id);
    }
  });
});

describe('M1: the shared sentence adapter',()=>{
  const alt=registry.buildTask('sentence-assembly','sentences','s_b1_23',ctx());
  test('alternatives, punctuation and strict answers',()=>{
    const {tokens}=dataset.items.find(i=>i.id==='s_b1_23').content;
    const order=[0,1,2,3,4,5,6,9,7,8,10,11].map(i=>`t${i}`); // "… hat sie noch die Präsentation …"
    assert.equal(tokens[9],'noch');
    assert.equal(core.evaluateSentenceTokens(alt.specification.exercise,order),'correct','listed alternative');
    assert.equal(core.evaluateSentenceTokens(alt.specification.exercise,[...solved(alt)].reverse()),'incorrect');
    assert.ok(core.isSentenceCorrect('Ich heiße Anna','Ich heiße Anna.'),'a final full stop is neutral');
    assert.ok(!core.isSentenceCorrect('ich heiße Anna.','Ich heiße Anna.'),'case counts');
    for(const bad of [[],['t0','t0'],['zz'],'Ich heiße Anna',null]) assert.throws(()=>core.evaluateSentenceTokens(alt.specification.exercise,bad),/Invalid/);
  });
  test('the server registry evaluates it; same seed gives the same order; video segments reuse it',()=>{
    assert.ok(core.ITEM_EXERCISES.includes(core.SENTENCE_ASSEMBLY));
    const again=registry.buildTask('sentence-assembly','sentences','s_b1_23',ctx('other-task'));
    assert.deepEqual(again.specification.exercise.tokens,alt.specification.exercise.tokens,'a retry keeps the order');
    assert.deepEqual(core.SENTENCE_ASSEMBLY.targetKinds,['sentence','video-segment']);
    const video={...dataset,id:'video-fixture',kind:'video-segment',items:[dataset.items[0]]};
    const task=core.createItemExerciseRegistry([video]).buildTask('sentence-assembly','video-fixture','s1',ctx());
    assert.equal(task.target.kind,'video-segment');
  });
});

describe('M1: page model',()=>{
  test('filters: "all" is A1–C2, themed decks explicitly; tags per deck; hash round trip',()=>{
    assert.ok(pool(dataset,{deck:'all'}).every(i=>!['beruf','arch'].includes(i.content.deck)));
    assert.equal(pool(dataset,{deck:'beruf'}).length,v1.filter(s=>s.deck==='beruf').length);
    assert.ok(tagsOf(dataset,'b1').includes('passiv'));
    assert.ok(pool(dataset,{deck:'b1',tag:'passiv'}).every(i=>i.content.tags.includes('passiv')));
    assert.deepEqual(parseFilter(filterHash({deck:'b1',tag:'passiv'})),{deck:'b1',tag:'passiv'});
    assert.deepEqual(parseFilter('#deck=../x'),{deck:'all'});
    assert.equal(formatTag('konjunktiv_ii'),'Konjunktiv II');
  });
  test('linked tense family and word-order variant',()=>{
    assert.deepEqual(linkedSentences(dataset,'s_b1_147').tenses.map(t=>t.label),['Präs.','Prät.','Perf.','Plusq.','Fut. I']);
    assert.equal(linkedSentences(dataset,'s_b1_23').variant,'s_b1_23v');
    assert.deepEqual(linkedSentences(dataset,'s1'),{tenses:[]});
  });
  test('selection and statistics come from the journal; a retry is never independent',()=>{
    const filter={deck:'a1'};
    const first=pool(dataset,filter)[0].id;
    assert.equal(nextSentence(registry,replay([]),filter),first);
    const task=registry.buildTask('sentence-assembly','sentences',first,ctx('x1'));
    const wrong=fact(task,[...solved(task)].reverse());
    const retry=fact(registry.buildTask('sentence-assembly','sentences',first,ctx('x2')),solved(task),{assisted:true});
    const progress=replay([wrong,retry]);
    assert.deepEqual(sentenceStats(progress,first),{answers:2,independent:0});
    assert.notEqual(nextSentence(registry,progress,filter,first),first,'never the one just shown');
    const stats=poolStats(registry,progress,filter);
    assert.deepEqual({attempted:stats.attempted,total:stats.total,accuracy:stats.accuracy},{attempted:1,total:pool(dataset,filter).length,accuracy:0});
    assert.throws(()=>core.replayWord({id:'w-x'},[wrong],{owner,...EPOCH,asOf:'2026-04-01T00:00:00.000Z'}));
  });
});
