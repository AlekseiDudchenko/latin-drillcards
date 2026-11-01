import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeRemoteInPartition } from '../public/v2/storage/learning-db.js';
import { A, B, Device, localProgress, minutesAgo, mutex, network, noun, other, seed, service, startServer, verb } from './helpers/sync-harness.mjs';

// S3 (#295): acknowledgement races and recovery. Every race is driven by a held or failing
// request (controlled delay), not by instant mock answers.
let server;
const ids=list=>list.map(e=>e.eventId);
const sentOnce=(net,events)=>{const all=net.pushes().flatMap(p=>p.eventIds);return events.every(e=>all.filter(id=>id===e.eventId).length===1);};

describe('S3: acknowledgement races, owner/epoch changes and recovery',()=>{
  before(async()=>{server=await startServer();});
  after(async()=>{await server?.close();});

  test('a new item and a new answer to the item being sent stay pending after the old batch is acknowledged',async()=>{
    const net=network(server);const device=new Device({kind:'account',id:A});const timers=[];
    const first=device.answer(noun,'german-type',noun.lemma,minutesAgo(50));
    const held=net.hold('push'); // the old batch's ACK is late
    const sync=service(device,net,{timers});
    const pass=sync.sync();
    await held.arrived; // the server has committed the old batch, its response is still on the way
    net.fail('push','503'); // ...and the next push (the new answers) fails
    const sameItem=device.answer(noun,'article-choice',noun.article,minutesAgo(49));
    const newItem=device.answer(verb,'german-type',verb.lemma,minutesAgo(48));
    held.release();await pass;
    assert.deepEqual(device.data.outbox,ids([sameItem,newItem]),'only the acknowledged event left the outbox');
    assert.equal(device.data.facts.length,3,'local history is complete');
    assert.equal(sync.status.phase,'retrying');assert.equal(sync.status.pending,2);
    assert.deepEqual((await server.events(A)).map(r=>r.event_id),[first.eventId]);
    timers.shift().run();await sync.sync();
    assert.deepEqual(device.data.outbox,[]);
    assert.ok(sentOnce(net,[first]) && net.pushes().flatMap(p=>p.eventIds).filter(id=>id===sameItem.eventId).length>=1);
    assert.deepEqual((await server.events(A)).map(r=>r.event_id).sort(),ids([first,sameItem,newItem]).sort());
    for(const word of [noun,verb]) assert.deepEqual(localProgress(device,word.id),(await server.progress(A,word.id)).progress);
  });

  test('a partial ACK clears only confirmed events; a failing pull afterwards keeps all local history',async()=>{
    const net=network(server);const device=new Device({kind:'account',id:B});const timers=[];
    const events=[device.answer(other,'german-type',other.lemma,minutesAgo(40)),
      device.answer(other,'article-choice',other.article,minutesAgo(39)),device.answer(verb,'meaning-recall','forgotten',minutesAgo(38))];
    net.fail('push','truncate');
    const sync=service(device,net,{timers});
    await sync.sync();
    assert.deepEqual(device.data.outbox,ids(events.slice(1)));assert.equal(sync.status.phase,'retrying');
    const facts=structuredClone(device.data.facts);const projections=structuredClone(device.data.projections);
    net.fail('pull','503');
    timers.shift().run();await sync.sync();
    assert.deepEqual(device.data.outbox,[],'the acknowledgements were stored before the pull');
    assert.equal(sync.status.phase,'retrying');assert.equal(device.data.sync.cursor,0);
    assert.deepEqual(device.data.facts.map(f=>f.event),facts.map(f=>f.event),'a failed pull removes nothing');
    assert.deepEqual(device.data.projections,projections);
    timers.shift().run();await sync.sync();
    assert.equal(sync.status.phase,'idle');assert.equal(device.data.sync.cursor,3);assert.equal(device.data.facts.length,3);
  });

  test('an owner switch during an in-flight request stops the queue; the late ACK touches only the original owner',async()=>{
    const net=network(server);let signedIn=A;
    const device=new Device({kind:'account',id:A});const timers=[];
    const sent=device.answer(noun,'german-type',noun.lemma,minutesAgo(30));const queued=device.answer(verb,'german-type',verb.lemma,minutesAgo(29));
    const held=net.hold('push');
    const sync=service(device,net,{user:()=>signedIn,timers,batchSize:1});
    const pass=sync.sync();await held.arrived;
    signedIn=B;sync.stop(); // what the auth context does synchronously on the identity change
    held.release();await pass;
    assert.equal(sync.status.phase,'stopped');assert.equal(timers.length,0);
    assert.deepEqual(device.data.outbox,[queued.eventId],'the delivered batch is acknowledged in its own scope');
    assert.deepEqual(net.pushes().map(p=>p.user),[A],'nothing more is sent, and never with the new identity');
    assert.ok((await server.events(B)).every(r=>r.event_id!==queued.eventId && r.event_id!==sent.eventId));
  });

  test('an epoch reset during a send stops the service instead of writing or retrying into the retired scope',async()=>{
    const net=network(server);const device=new Device({kind:'account',id:A});const timers=[];
    device.answer(noun,'german-type',noun.lemma,minutesAgo(25));
    const held=net.hold('push');
    const sync=service(device,net,{timers});
    const pass=sync.sync();await held.arrived;
    device.retired=true; // LearningDatabase.reset() moved the owner to a new epoch meanwhile
    const before=structuredClone(device.data);
    held.release();await pass;
    assert.equal(sync.status.phase,'stopped');assert.equal(timers.length,0,'no retry loop on a retired scope');
    assert.deepEqual(device.data,before,'nothing was written into the retired partition');
    await sync.sync();assert.equal(net.log.length,1);
  });

  test('two tabs sharing one outbox send each answer once under the per-owner lock',async()=>{
    const net=network(server);const device=new Device({kind:'account',id:B});const lock=mutex();
    const events=[device.answer(noun,'german-type',noun.lemma,minutesAgo(20)),device.answer(verb,'german-type',verb.lemma,minutesAgo(19))];
    const held=net.hold('push');
    const tabs=[service(device,net,{lock}),service(device,net,{lock})];
    const passes=tabs.map(tab=>tab.sync());
    await held.arrived;held.release();await Promise.all(passes);
    assert.ok(sentOnce(net,events),'the second tab saw an empty outbox');
    assert.equal(net.pushes().length,1);
    assert.ok(tabs.every(tab=>tab.status.pending===0 && tab.status.phase==='idle'));
    // Without coordination both tabs would send the same events (safe through S1, but twice).
    const loose=network(server);const again=device.answer(other,'german-type',other.lemma,minutesAgo(18));
    const hold=loose.hold('push');const both=[service(device,loose),service(device,loose)].map(tab=>tab.sync());
    await hold.arrived;await new Promise(r=>setTimeout(r,20));hold.release();await Promise.all(both);
    assert.equal(loose.pushes().filter(p=>p.eventIds?.includes(again.eventId)).length,2);
  });

  test('a server record that conflicts with a local event is set aside; sync continues and progress follows the server',async()=>{
    const net=network(server);
    const phone=new Device({kind:'account',id:A});const laptop=new Device({kind:'account',id:A});
    const local=phone.answer(other,'german-type','Falsch',minutesAgo(15));
    const sameCommand=phone.answer(other,'article-choice',other.article,minutesAgo(14));
    // Another device already stored different events under the same eventId / commandId (e.g. a restored backup).
    laptop.answer(other,'german-type',other.lemma,minutesAgo(15),{patch:{eventId:local.eventId}});
    laptop.answer(other,'article-choice',other.article,minutesAgo(13),{patch:{commandId:sameCommand.commandId}});
    await service(laptop,net).sync();
    const statuses=[];const sync=service(phone,net,{statuses});
    await sync.sync();
    assert.equal(sync.status.phase,'idle','no permanent sync error');
    assert.equal(sync.status.pending,0);assert.equal(sync.status.conflicts,2);
    assert.deepEqual(phone.data.sync.conflicts.map(c=>[c.eventId,c.reason]),
      [[local.eventId,'event-conflict'],[sameCommand.eventId,'command-conflict']]);
    assert.deepEqual(phone.data.sync.conflicts[0].event,local,'the replaced local answer is kept for display');
    assert.deepEqual(localProgress(phone,other.id),(await server.progress(A,other.id)).progress);
    assert.deepEqual(phone.data.facts.map(f=>f.event.eventId).sort(),laptop.data.facts.map(f=>f.event.eventId).sort());
  });

  test('while the page stays open an idle pass runs periodically and picks up another device',async()=>{
    const net=network(server);const timers=[];
    const tablet=new Device({kind:'account',id:B});const desktop=new Device({kind:'account',id:B});
    const sync=service(tablet,net,{timers,idleSyncMs:60_000});
    await sync.sync();
    assert.deepEqual(timers.map(t=>t.ms),[60_000]);
    const elsewhere=desktop.answer(verb,'german-type',verb.lemma,minutesAgo(10));
    await service(desktop,net).sync();
    timers.shift().run();await sync.sync();
    assert.ok(tablet.data.facts.some(f=>f.event.eventId===elsewhere.eventId));
    assert.equal(timers.length,1,'the next idle pass is scheduled');
    sync.stop();assert.equal(timers.length,0);
  });

  test('server-refused answers stay in local history but not in local progress, as on the server',async()=>{
    const net=network(server);const device=new Device({kind:'account',id:B});
    const accepted=device.answer(noun,'german-type',noun.lemma,minutesAgo(9));
    const refused=device.answer(noun,'german-type','Falsch',minutesAgo(8),{catalogVersion:'not-on-server'});
    const before=localProgress(device,noun.id);
    const sync=service(device,net);await sync.sync();
    assert.deepEqual(device.data.sync.rejected,[{eventId:refused.eventId,reason:'unknown-catalog'}]);
    assert.ok(device.data.facts.some(f=>f.event.eventId===refused.eventId),'history keeps the refused answer');
    assert.deepEqual(localProgress(device,noun.id),(await server.progress(B,noun.id)).progress);
    assert.notDeepEqual(localProgress(device,noun.id),before,'the refused answer stopped counting');
    assert.ok(accepted);
  });

  test('local replay uses the word revision its facts were answered on, the same rule as the server',async()=>{
    const device=new Device({kind:'account',id:A});
    device.answer(noun,'german-type',noun.lemma,minutesAgo(5));
    // A later catalog revision drops the article: the newest-known rule would drop the article component.
    const revised={...noun,contentVersion:noun.contentVersion+1,acceptedGermanForms:[noun.lemma]};delete revised.article;
    const merged=mergeRemoteInPartition(device.data,[],[revised],new Date().toISOString());
    assert.ok('article' in merged.projections.find(p=>p.progress.wordId===noun.id).progress.components);
    assert.ok(merged.sync.words.some(w=>w.contentVersion===revised.contentVersion));
    assert.ok(seed.catalogVersion);
  });
});
