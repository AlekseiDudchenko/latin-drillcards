import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../packages/vocabulary-core/dist/index.js';
import { acknowledgeInPartition, requeueRefusedChoices, CHOICE_OPTIONS_REQUEUE } from '../public/v2/storage/learning-db.js';
import { A, B, Device, localProgress, minutesAgo, network, registry, seed, service, startServer } from './helpers/sync-harness.mjs';

// The planner builds choice options from the deck it was given; the server holds the whole catalog
// snapshot. A deck task must be accepted, and answers refused before that fix are sent once more.
let server;
const nouns=seed.words.filter(w=>w.partOfSpeech==='noun' && w.meanings.ru?.preferred);
// A "deck": a slice of the catalog, as a published deck is (the Latin fixture has few nouns: a smaller one).
const deck=nouns.slice(0,5);
const taskOf=(device,event)=>device.data.sessions.find(s=>s.state.plan.sessionId===event.sessionId).state.plan.tasks[0];

describe('choice options: deck-built tasks against the whole catalog snapshot',()=>{
  before(async()=>{server=await startServer();});
  after(async()=>{await server?.close();});

  test('meaning/target-choice answers built from a deck are accepted and count on both sides',async()=>{
    const net=network(server);const device=new Device({kind:'account',id:A});
    const events=deck.map((word,i)=>device.answer(word,i%2 ? 'target-choice' : 'meaning-choice',word.id,minutesAgo(60-i),{words:deck}));
    // The whole-catalog build differs for some of them: the old server refused exactly these.
    const differs=events.filter(e=>{
      const task=taskOf(device,e);
      return JSON.stringify(registry.get(e.exerciseId).buildTask(registry.getWord(e.target.wordId,e.contentVersion),
        {taskId:task.id,seed:task.specification.seed,answerLanguage:'ru'}))!==JSON.stringify(task);
    });
    assert.ok(differs.length>0,'the deck pool yields other distractors than the catalog');
    const sync=service(device,net);await sync.sync();
    assert.equal(sync.status.rejected,0);assert.deepEqual(device.data.outbox,[]);
    assert.deepEqual((await server.events(A)).map(r=>r.event_id).sort(),events.map(e=>e.eventId).sort());
    for(const word of deck) assert.deepEqual(localProgress(device,word.id),(await server.progress(A,word.id)).progress);
  });

  test('choice answers refused as invalid-task are requeued once, keep their study time and then count',async()=>{
    const net=network(server);const device=new Device({kind:'account',id:B});
    const choice=device.answer(deck[3],'meaning-choice',deck[3].id,minutesAgo(30),{words:deck});
    const typed=device.answer(deck[4],'target-type',deck[4].lemma,minutesAgo(29),{words:deck});
    // What the old server answered.
    device.data=acknowledgeInPartition(device.data,[{eventId:choice.eventId,status:'rejected',reason:'invalid-task'},
      {eventId:typed.eventId,status:'rejected',reason:'stale-epoch'}]);
    assert.deepEqual(device.data.outbox,[]);
    assert.equal(localProgress(device,deck[3].id)?.introducedAt ?? null,null,'a refused answer does not count');

    device.data=requeueRefusedChoices(device.data);
    assert.deepEqual(device.data.outbox,[choice.eventId],'only choice answers refused as invalid-task');
    assert.deepEqual(device.data.sync.rejected.map(r=>r.eventId),[typed.eventId]);
    assert.deepEqual(device.data.sync.requeued,[CHOICE_OPTIONS_REQUEUE]);
    assert.equal(requeueRefusedChoices(device.data),device.data,'applied once');

    const sync=service(device,net);await sync.sync();
    assert.deepEqual(device.data.outbox,[]);assert.equal(sync.status.rejected,1);
    assert.deepEqual(sync.status.rejectedReasons,{'stale-epoch':1});
    const stored=(await server.events(B)).find(r=>r.event_id===choice.eventId);
    assert.equal(stored.event.occurredAt,choice.occurredAt,'the original study time is kept');
    assert.deepEqual(localProgress(device,deck[3].id),(await server.progress(B,deck[3].id)).progress);
    assert.notEqual(localProgress(device,deck[3].id).introducedAt,null);
  });

  test('a guest partition and one without refusals are left unchanged',()=>{
    const guest=new Device({kind:'guest',id:'guest-1'});
    assert.equal(requeueRefusedChoices(guest.data),guest.data);
    const fresh=new Device({kind:'account',id:A});
    assert.equal(requeueRefusedChoices(fresh.data),fresh.data);
    assert.ok(core.CHOICE_OPTION_COUNT===4);
  });
});
