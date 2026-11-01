import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import * as core from '../packages/vocabulary-core/dist/index.js';
import { buildVideoDataset, serialize, videoDatasetPath, videoSources, VIDEO_SOURCE } from '../scripts/build-video-datasets.mjs';
import { ASSEMBLY_EXERCISE, assemblyAvailable, clampPosition, datasetId, nextAssembly, parseState, segmentStats, stateHash, VIDEOS, videoStats }
  from '../public/v2/families/video/video-model.js';

// M6 (#338): every v1 video as versioned segments, served by the M2 listening (dictation) and
// M1 sentence (assembly) adapters, and the page model.
const sources=videoSources();
const datasets=sources.map(source=>JSON.parse(readFileSync(videoDatasetPath(source.videoId),'utf8')));
const owner={kind:'guest',id:'g'};
const EPOCH={dataEpoch:'m6',epochStartedAt:'2026-01-01T00:00:00.000Z'};
const ctx=(taskId='t',seed='seed',answerLanguage='ru')=>({answerLanguage,seed,taskId});
const solved=task=>[...task.specification.exercise.tokens].sort((a,b)=>+a.id.slice(1)-+b.id.slice(1)).map(t=>t.id);
let n=0;
function fact(registry,task,rawAnswer,over={}) {
  const id=++n;
  const event={schemaVersion:1,kind:'answer',eventId:`e${id}`,commandId:`c${id}`,attemptId:`a${id}`,sessionId:`s${id}`,taskId:task.id,
    target:task.target,exerciseId:task.exerciseId,intent:'practice',answerLanguage:'ru',occurredAt:new Date(Date.parse('2026-03-01T10:00:00.000Z')+id*60000).toISOString(),
    studyTimezone:'UTC',taskVersion:task.taskVersion,contentVersion:task.contentVersion,policyVersion:core.ITEM_POLICY_VERSION,dataEpoch:EPOCH.dataEpoch,
    rawAnswer,assisted:false,exposure:[],...over};
  return {owner,event,receivedAt:event.occurredAt,evaluation:core.evaluateItemAnswer(registry,task,event)};
}
const replay=records=>core.projectExerciseProgress(records,{owner,...EPOCH,asOf:'2026-04-01T00:00:00.000Z'});

describe('M6: video datasets converted from v1',()=>{
  test('one current dataset per v1 video, nothing else; the page lists the same videos',()=>{
    const v1=readdirSync('public/data').filter(name=>VIDEO_SOURCE.test(name));
    assert.equal(sources.length,7); assert.equal(v1.length,sources.length);
    const items=readdirSync('public/data/items').filter(name=>name.startsWith('video-')).sort();
    assert.deepEqual(items,sources.map(s=>`video-${s.videoId}.json`).sort());
    for(const source of sources) assert.equal(readFileSync(videoDatasetPath(source.videoId),'utf8'),serialize(buildVideoDataset(source)),'run npm run items:videos');
    assert.deepEqual(VIDEOS.map(v=>v.videoId).sort(),sources.map(s=>s.videoId).sort());
    for(const video of VIDEOS) {
      const source=sources.find(s=>s.videoId===video.videoId);
      assert.deepEqual([video.title,video.level,video.shorts],[source.title,source.level.toUpperCase(),source.shorts===true]);
    }
  });

  test('full coverage: every v1 segment keeps its sentence, tokens, translations and pause point, in order',()=>{
    let total=0;
    for(const [i,source] of sources.entries()) {
      const dataset=datasets[i];
      core.assertItemDataset(dataset);
      assert.equal(dataset.id,`video-${source.videoId}`); assert.equal(dataset.kind,'video-segment'); assert.equal(dataset.title,source.title);
      assert.match(dataset.version,new RegExp(`^video-${source.videoId}-[0-9a-f]{16}$`));
      assert.equal(dataset.items.length,source.segments.length);
      let start=0;
      source.segments.forEach((segment,index)=>{
        const item=dataset.items[index]; const c=core.videoSegmentContent(item.content);
        assert.ok(c,`${dataset.id}/${item.id}`);
        assert.equal(item.id,`seg-${index}`); assert.deepEqual(item.wordIds,[]);
        assert.equal(c.target,segment.sentence); assert.deepEqual(c.tokens,segment.tokens);
        for(const lang of ['ru','en','es']) assert.equal(c.translations[lang],segment[`translation_${lang}`]);
        assert.deepEqual(c.video,{videoId:source.videoId,index,start,end:segment.pauseAt,shorts:source.shorts===true});
        start=segment.pauseAt; total++;
      });
    }
    assert.equal(total,1634);
  });

  test('pause points must increase',()=>{
    assert.throws(()=>buildVideoDataset({videoId:'abcdefghijk',level:'b1',title:'x',segments:[{pauseAt:2,sentence:'A',tokens:['A']},{pauseAt:2,sentence:'B',tokens:['B']}]}),/increase/);
    assert.equal(core.videoSegmentContent({...datasets[0].items[0].content,video:{...datasets[0].items[0].content.video,end:0}}),null);
    assert.equal(core.videoSegmentContent(JSON.parse(readFileSync('public/data/items/sentences.json','utf8').split('\n')[1].replace(/,$/,'')).content),null,'a plain sentence is no video segment');
  });
});

describe('M6: dictation and assembly on the shared adapters',()=>{
  test('every segment is solvable in both dictation modes, with its clip as the prompt and the text hidden',()=>{
    for(const dataset of datasets) {
      const registry=core.createItemExerciseRegistry([dataset]);
      for(const item of dataset.items) {
        const c=item.content;
        const tokens=registry.buildTask('listening-tokens',dataset.id,item.id,ctx(`k${item.id}`));
        const typed=registry.buildTask('listening-text',dataset.id,item.id,ctx(`x${item.id}`));
        assert.equal(tokens.target.kind,'video-segment');
        assert.equal(core.evaluateListening(tokens.specification.exercise,solved(tokens)),'correct',`${dataset.id}/${item.id}`);
        assert.equal(core.evaluateListening(typed.specification.exercise,c.target.toLowerCase()),'correct',`${dataset.id}/${item.id}`);
        assert.deepEqual(typed.specification.exercise.media,{kind:'youtube',videoId:c.video.videoId,start:c.video.start,end:c.video.end});
        assert.equal(typed.specification.exercise.prompt,undefined);
      }
    }
  });

  test('standalone assembly: exactly the translated segments (as v1), solvable, the same token order as dictation',()=>{
    let assembled=0;
    for(const dataset of datasets) {
      const registry=core.createItemExerciseRegistry([dataset]);
      const translated=dataset.items.filter(item=>item.content.translations.ru);
      assert.equal(assemblyAvailable(registry,dataset,'ru'),translated.length>0);
      for(const item of dataset.items) {
        const available=registry.isAvailable(ASSEMBLY_EXERCISE,dataset.id,item.id,ctx());
        assert.equal(available,!!item.content.translations.ru);
        if(!available) continue;
        const task=registry.buildTask(ASSEMBLY_EXERCISE,dataset.id,item.id,ctx('a'));
        assert.equal(task.specification.exercise.prompt.text,item.content.translations.ru);
        assert.equal(core.evaluateSentenceTokens(task.specification.exercise,solved(task)),'correct');
        assert.deepEqual(task.specification.exercise.tokens,registry.buildTask('listening-tokens',dataset.id,item.id,ctx('d')).specification.exercise.tokens);
        assembled++;
      }
    }
    assert.equal(assembled,565);
    assert.deepEqual(VIDEOS.filter(v=>datasets.find(d=>d.id===datasetId(v.videoId)).items.some(i=>i.content.translations.ru)).map(v=>v.videoId),
      ['J2dbsM9678o','ejmqbUNluuc','4JTUflVw1v4','d2hv-koUGwg'],'v1 offered sentences for these videos');
  });

  test('statistics: dictation modes, assembly and the sentence corpus are counted apart',()=>{
    const dataset=datasets.find(d=>d.id==='video-4JTUflVw1v4');
    const registry=core.createItemExerciseRegistry([dataset]);
    const typed=registry.buildTask('listening-text',dataset.id,'seg-0',ctx('v1'));
    const built=registry.buildTask(ASSEMBLY_EXERCISE,dataset.id,'seg-0',ctx('v2'));
    const progress=replay([fact(registry,typed,'was machst du da'),fact(registry,built,[...solved(built)].reverse())]);
    assert.deepEqual(segmentStats(progress,dataset.id,'seg-0','listening-text'),{answers:1,independent:1});
    assert.deepEqual(segmentStats(progress,dataset.id,'seg-0',ASSEMBLY_EXERCISE),{answers:1,independent:0});
    assert.equal(segmentStats(progress,dataset.id,'seg-0','listening-tokens'),undefined);
    assert.deepEqual(videoStats(registry,progress,dataset.id,'listening-text'),{total:20,attempted:1,accuracy:1});
    assert.equal(progress.items.filter(p=>p.datasetId==='sentences').length,0);
    assert.equal(nextAssembly(registry,progress,dataset.id),'seg-1','an answered segment is not offered first');
  });
});

describe('M6: page model',()=>{
  test('URL state, saved position',()=>{
    assert.deepEqual(parseState('#v=4JTUflVw1v4&view=sentences'),{videoId:'4JTUflVw1v4',view:'sentences'});
    assert.deepEqual(parseState('#v=../x'),{videoId:VIDEOS[0].videoId,view:'dictation'});
    assert.deepEqual(parseState(stateHash({videoId:'d2hv-koUGwg',view:'dictation'})),{videoId:'d2hv-koUGwg',view:'dictation'});
    assert.equal(clampPosition('5',20),5); assert.equal(clampPosition('20',20),0); assert.equal(clampPosition('x',20),0); assert.equal(clampPosition(undefined,20),0);
  });
});
