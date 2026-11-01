import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import * as core from '../packages/vocabulary-core/dist/index.js';
import { buildSeed, loadSources, IDENTITIES_PATH } from '../scripts/vocabulary-seed.mjs';
import { catalogSeedSql } from '../scripts/catalog-bootstrap.mjs';
import { createLearningEventsHandler } from '../supabase/v2/functions/v2-learning-events/handler.js';
import { acknowledgeInPartition, commitInPartition, mergeRemoteInPartition, startInPartition } from '../public/v2/storage/learning-db.js';
import { SyncService, createSyncTransport, syncLabel } from '../public/v2/sync-service.js';

// Devices keep their partition in memory but run the exact transaction bodies of the
// IndexedDB adapter. The server is the real S1 handler, migrations and RLS in PGlite.
const A='00000000-0000-4000-8000-00000000000a';
const B='00000000-0000-4000-8000-00000000000b';
const EPOCH={dataEpoch:'s2-test',epochStartedAt:'2026-01-01T00:00:00.000Z'};
const REF='7db7afee5acec66afd8612f186281dfe97b0cbf1';
const URL_BASE='https://project.supabase.co';
const KEY='sb_publishable_test_123456789';
const read=path=>readFileSync(new URL(`../supabase/v2/${path}`,import.meta.url),'utf8');
const seed=buildSeed(JSON.parse(readFileSync(IDENTITIES_PATH,'utf8')),loadSources());
const registry=core.createWordExerciseRegistry(seed.words,seed.catalogVersion);
const noun=seed.words.find(w=>w.article && w.meanings.ru);
const verb=seed.words.find(w=>w.partOfSpeech==='verb' && w.meanings.ru);
const other=seed.words.find(w=>w.article && w.meanings.ru && w.id!==noun.id);
const stranger=seed.words.find(w=>w.partOfSpeech==='verb' && w.meanings.ru && w.id!==verb.id);
const tokens={'token-a':A,'token-b':B};
let db;

async function as(role,user,sql,params=[]) {
  await db.exec('BEGIN');
  try {
    await db.exec(`SET LOCAL ROLE ${role}`);
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[user ?? '']);
    const result=await db.query(sql,params);
    await db.exec('COMMIT');
    return result;
  } catch(error) { await db.exec('ROLLBACK'); throw error; }
}
const one=async(sql,params)=>(await as('service_role',null,sql,params)).rows[0].r;
const catalogs=new Map();
const serverStore={
  state:(userId,ids)=>one('SELECT public.v2_learning_state($1,$2,$3,$4,$5,$6) AS r',
    [userId,ids.wordIds,ids.taskIds,ids.eventIds,ids.commandIds,ids.attemptIds]),
  async catalog(version) {
    if(!catalogs.has(version)) {
      const snapshot=await one('SELECT public.v2_catalog_snapshot($1) AS r',[version]);
      catalogs.set(version,snapshot && core.createWordExerciseRegistry(snapshot.words,snapshot.catalogVersion));
    }
    return catalogs.get(version);
  },
  commit:(userId,batch)=>one('SELECT public.v2_commit_learning($1,$2,$3,$4::jsonb,$5::jsonb) AS r',
    [userId,batch.dataEpoch,batch.receivedAt,JSON.stringify(batch.events),JSON.stringify(batch.projections)]),
};
const handler=createLearningEventsHandler({supabaseUrl:URL_BASE,publishableKey:KEY,allowedOrigins:[],core,store:serverStore,
  fetcher:async(_url,init)=>{const id=tokens[init.headers.Authorization.slice(7)];return id ? Response.json({id}) : new Response('{}',{status:401});}});

/** Fake network in front of the real handler and RLS reads. `faults` injects failures per request. */
function network() {
  const log=[];const faults=[];let offline=false;
  const net={log,faults,fetcherHook:undefined};
  async function fetcher(input,init={}) {
    const url=new URL(input);const user=tokens[init.headers?.Authorization?.slice(7)];
    if(url.pathname==='/functions/v1/v2-learning-events') await net.fetcherHook?.();
    log.push({path:url.pathname,user});
    if(offline) throw new TypeError('Failed to fetch');
    const fault=faults.shift();
    if(fault==='status-503') return new Response('{}',{status:503});
    let response;
    if(url.pathname==='/functions/v1/v2-learning-events') {
      response=await handler(new Request(url,{method:'POST',headers:init.headers,body:init.body}));
    } else if(url.pathname==='/rest/v1/learning_events') {
      const after=Number(url.searchParams.get('sequence').slice(3));const limit=Number(url.searchParams.get('limit'));
      const rows=(await as('authenticated',user,`SELECT user_id,sequence::int AS sequence,event,evaluation,received_at
        FROM public.learning_events WHERE sequence>$1 ORDER BY sequence LIMIT $2`,[after,limit])).rows;
      response=Response.json(rows);
    } else if(url.pathname==='/rest/v1/catalog_words') {
      const ids=JSON.parse(`[${url.searchParams.get('id').slice(4,-1)}]`);
      response=Response.json((await as('authenticated',user,'SELECT word FROM public.catalog_words WHERE id=ANY($1)',[ids])).rows);
    } else response=new Response('{}',{status:404});
    if(fault==='lose-response') throw new TypeError('Connection reset after delivery');
    if(fault==='truncate-results') { const body=await response.json();body.results=body.results.slice(0,1);return Response.json(body); }
    return response;
  }
  Object.defineProperty(net,'offline',{get:()=>offline,set:value=>{offline=value;}});
  net.fetcher=fetcher;
  return net;
}

/** One device: an in-memory partition with the adapter's pure transaction bodies. */
class Device {
  constructor(owner,data) {
    this.owner=owner;this.epoch=EPOCH;
    this.data=data ?? {schemaVersion:1,owner,epoch:EPOCH,projectionAsOf:EPOCH.epochStartedAt,sessions:[],facts:[],projections:[],outbox:[]};
  }
  reload() { return new Device(this.owner,structuredClone(this.data)); }
  async snapshot() { return structuredClone(this.data); }
  async acknowledge(acks) { this.data=acknowledgeInPartition(this.data,acks);return this.snapshot(); }
  async mergeRemote(remote,words,asOf) { this.data=mergeRemoteInPartition(this.data,remote,words,asOf);return this.snapshot(); }
  /** Start a one-task session and commit its answer, as the Runner does offline. */
  answer(word,exerciseId,raw,occurredAt) {
    const id=crypto.randomUUID();
    const task=registry.get(exerciseId).buildTask(word,{taskId:`task-${id}`,seed:`seed-${id}`,answerLanguage:'ru'});
    const archive={catalogVersion:seed.catalogVersion,words:[...new Set([noun,verb,other,word])],state:{status:'ready',revision:0,taskIndex:0,
      plan:{schemaVersion:1,sessionId:`session-${id}`,owner:this.owner,dataEpoch:EPOCH.dataEpoch,createdAt:occurredAt,
        studyTimezone:'UTC',seed:`seed-${id}`,policyVersion:core.EVIDENCE_POLICY_VERSION,tasks:[task]}}};
    this.data=startInPartition(this.data,this,archive).next;
    const event={schemaVersion:1,kind:'answer',eventId:`event-${id}`,commandId:`command-${id}`,attemptId:`attempt-${id}`,
      sessionId:archive.state.plan.sessionId,taskId:task.id,target:task.target,exerciseId,intent:'learn-new',answerLanguage:'ru',
      occurredAt,studyTimezone:'UTC',taskVersion:task.taskVersion,contentVersion:task.contentVersion,
      policyVersion:core.EVIDENCE_POLICY_VERSION,dataEpoch:EPOCH.dataEpoch,rawAnswer:raw,assisted:false,exposure:[]};
    const {result,next}=commitInPartition(this.data,this,{owner:this.owner,dataEpoch:EPOCH.dataEpoch,event,receivedAt:occurredAt,
      session:{...archive.state,revision:1,status:'feedback'},expectedSessionRevision:0});
    assert.equal(result,'committed');this.data=next;
    return event;
  }
}
function service(device,net,{online=()=>!net.offline,user=()=>device.owner.id,timers=[],random=()=>1,now=()=>new Date().toISOString(),statuses=[]}={}) {
  const transport=createSyncTransport({supabaseUrl:URL_BASE,publishableKey:KEY},
    async()=>({userId:user(),accessToken:Object.keys(tokens).find(k=>tokens[k]===user())}),net.fetcher);
  return new SyncService(device,transport,{now,online,random,onStatus:s=>statuses.push(s),
    setTimer:(run,ms)=>{const t={run,ms};timers.push(t);return t;},clearTimer:t=>{const i=timers.indexOf(t);if(i>=0)timers.splice(i,1);}});
}
const minutesAgo=m=>new Date(Math.floor(Date.now()/1000)*1000-m*60000).toISOString();
const serverEvents=async user=>(await db.query('SELECT event_id,event FROM public.learning_events WHERE user_id=$1 ORDER BY sequence',[user])).rows;
const serverProgress=async(user,word)=>(await db.query('SELECT revision::int,progress FROM public.word_progress WHERE user_id=$1 AND word_id=$2',[user,word])).rows[0];
const localProgress=(device,word)=>device.data.projections.find(p=>p.progress.wordId===word).progress;

describe('S2: owner outbox, retry and two devices against the S1 intake',()=>{
  before(async()=>{
    db=new PGlite();
    await db.exec(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
      CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
      INSERT INTO auth.users VALUES ('${A}'),('${B}');`);
    await db.exec('BEGIN;\n'+read('transition/fresh-project-preflight.sql')+read('migrations/001_catalog.sql')+
      read('migrations/002_environment.sql')+catalogSeedSql(seed,{sourceRef:REF})+
      `INSERT INTO public.v2_environment VALUES (true,1,'local','${EPOCH.dataEpoch}','${EPOCH.epochStartedAt}');\nCOMMIT;`);
    await db.exec('BEGIN;\n'+read('transition/learning-preflight.sql')+read('migrations/003_learning.sql')+'\nCOMMIT;');
  });
  after(async()=>{await db?.close();});

  test('offline answers are sent after online and after reload; a lost response never doubles them',async()=>{
    const net=network();net.offline=true;
    const phone=new Device({kind:'account',id:A});
    const first=phone.answer(noun,'target-type',noun.lemma,minutesAgo(40));
    const sync=service(phone,net);
    assert.equal(syncLabel(sync.status),'sending','nothing is called sent before the outbox is read');
    await sync.sync();
    assert.equal(sync.status.phase,'offline');assert.equal(sync.status.pending,1);assert.equal(syncLabel(sync.status),'offline');
    assert.equal(net.log.length,0,'no request while the browser reports offline');
    assert.deepEqual(await serverEvents(A),[]);
    net.offline=false;await sync.sync();
    assert.deepEqual((await serverEvents(A)).map(r=>r.event_id),[first.eventId]);
    assert.equal(sync.status.pending,0);assert.equal(syncLabel(sync.status),'sent');

    // Reload while offline with a new answer; the new page's startup sync sends it.
    const second=phone.answer(noun,'article-choice',noun.article,minutesAgo(39));
    const reloaded=phone.reload();
    // The server stores it but the response is lost: the outbox keeps it and the retry is a duplicate.
    net.faults.push('lose-response');
    const timers=[];const afterReload=service(reloaded,net,{timers});
    await afterReload.sync();
    assert.equal(afterReload.status.phase,'offline');assert.equal(afterReload.status.pending,1);assert.equal(timers.length,1);
    const stored=await serverEvents(A);const progress=await serverProgress(A,noun.id);
    assert.deepEqual(stored.map(r=>r.event_id),[first.eventId,second.eventId]);
    timers.shift().run();await afterReload.sync();
    assert.equal(afterReload.status.pending,0);
    assert.deepEqual(await serverEvents(A),stored,'retry did not add a second answer');
    assert.deepEqual(await serverProgress(A,noun.id),progress,'retry did not advance the projection');
    assert.deepEqual(localProgress(reloaded,noun.id),progress.progress,'device projection equals the server one');
    assert.equal(reloaded.data.facts.length,2);
  });

  test('two devices and late delivery converge on one projection; older pages never overwrite newer records',async()=>{
    const net=network();
    const phone=new Device({kind:'account',id:B});const laptop=new Device({kind:'account',id:B});
    // The laptop answered first but stays offline; its answer arrives after the phone's.
    const early=laptop.answer(verb,'meaning-recall','forgotten',minutesAgo(50));
    const late=phone.answer(verb,'target-type',verb.lemma,minutesAgo(45));
    const phoneSync=service(phone,net);const laptopSync=service(laptop,net);
    await phoneSync.sync();
    await laptopSync.sync();
    await phoneSync.sync();
    const server=await serverProgress(B,verb.id);
    assert.deepEqual((await serverEvents(B)).map(r=>r.event_id),[late.eventId,early.eventId]);
    for(const device of [phone,laptop]) {
      assert.deepEqual(device.data.facts.map(f=>f.event.eventId).sort(),[early.eventId,late.eventId].sort());
      assert.deepEqual(localProgress(device,verb.id),server.progress);
      assert.equal(device.data.sync.cursor,2);assert.equal(device.data.outbox.length,0);
    }
    // A word only answered elsewhere arrives with its published model.
    const elsewhere=laptop.answer(stranger,'target-type',stranger.lemma,minutesAgo(44));
    await laptopSync.sync();await phoneSync.sync();
    assert.deepEqual(phone.data.sync.words.map(w=>w.id),[stranger.id]);
    assert.deepEqual(localProgress(phone,stranger.id),(await serverProgress(B,stranger.id)).progress);
    assert.ok(phone.data.facts.some(f=>f.event.eventId===elsewhere.eventId));
    // A delayed response carrying an older page is a no-op: union by eventId, cursor never decreases.
    const before=structuredClone(phone.data);
    const stale=(await db.query(`SELECT sequence::int AS sequence,event,evaluation,received_at FROM public.learning_events
      WHERE user_id=$1 AND sequence<=2 ORDER BY sequence`,[B])).rows.map(r=>({sequence:r.sequence,event:r.event,
      receivedAt:r.received_at.toISOString(),...(r.evaluation ? {evaluation:r.evaluation} : {})}));
    await phone.mergeRemote(stale,[],phone.data.projectionAsOf);
    assert.deepEqual(phone.data.facts,before.facts);assert.equal(phone.data.sync.cursor,3);
    assert.deepEqual(phone.data.projections,before.projections);
  });

  test('an error or partial success keeps the rest pending, with growing backoff',async()=>{
    const net=network();const timers=[];const statuses=[];
    const device=new Device({kind:'account',id:A});
    const events=[device.answer(other,'target-type','Falsch',minutesAgo(30)),device.answer(other,'article-choice',other.article,minutesAgo(29))];
    const sync=service(device,net,{timers,statuses,random:()=>1});
    net.faults.push('status-503');
    await sync.sync();
    assert.equal(sync.status.phase,'retrying');assert.equal(sync.status.pending,2);assert.equal(timers[0].ms,2000);
    assert.equal(syncLabel(sync.status),'retrying');
    // The next attempt is accepted for one event only: that one is acknowledged, the other is retried later.
    net.faults.push('truncate-results');
    timers.shift().run();await sync.sync();
    assert.deepEqual(device.data.outbox,[events[1].eventId]);
    assert.equal(sync.status.phase,'retrying');assert.equal(timers[0].ms,4000,'second failure doubles the delay');
    timers.shift().run();await sync.sync();
    assert.equal(sync.status.phase,'idle');assert.equal(device.data.outbox.length,0);
    assert.ok(statuses.some(s=>s.phase==='syncing'));
    // A permanent rejection leaves the outbox with its reason instead of being resent forever.
    const bad=device.answer(other,'target-type',other.lemma,minutesAgo(28));
    device.data.sessions=device.data.sessions.map(s=>s.state.plan.sessionId===bad.sessionId ? {...s,state:{...s.state,plan:{...s.state.plan,
      tasks:s.state.plan.tasks.map(t=>({...t,specification:{...t.specification,catalogVersion:'not-on-server'}}))}}} : s);
    await sync.sync();
    assert.equal(sync.status.pending,0);assert.deepEqual(device.data.sync.rejected,[{eventId:bad.eventId,reason:'unknown-catalog'}]);
    assert.equal(sync.status.rejected,1);
  });

  test('a commit during the push request is not a partial failure; the next batch sends it',async()=>{
    const net=network();const device=new Device({kind:'account',id:A});
    const timers=[];let during;
    device.answer(noun,'target-type',noun.lemma,minutesAgo(15));
    net.fetcherHook=async()=>{net.fetcherHook=undefined;during=device.answer(noun,'article-choice',noun.article,minutesAgo(14));};
    const first=service(device,net,{timers});
    await first.sync();
    assert.equal(first.status.phase,'idle');assert.equal(timers.length,0,'no backoff after a fully acknowledged batch');
    assert.equal(first.status.pending,0);assert.deepEqual(device.data.outbox,[]);
    assert.ok((await serverEvents(A)).some(r=>r.event_id===during.eventId));
  });

  test('a commit after the last merge with a concurrent sync() is sent and never reported as sent early',async()=>{
    const net=network();const device=new Device({kind:'account',id:A});
    const statuses=[];const second=service(device,net,{statuses});
    const merge=device.mergeRemote.bind(device);let late;let concurrent;
    device.mergeRemote=async(...args)=>{
      const result=await merge(...args);
      if(!late){late=device.answer(other,'target-type',other.lemma,minutesAgo(13));concurrent=second.sync();}
      return result;
    };
    device.answer(other,'article-choice',other.article,minutesAgo(12));
    await second.sync();await concurrent;
    device.mergeRemote=merge;
    assert.ok((await serverEvents(A)).some(r=>r.event_id===late.eventId));
    assert.equal(second.status.pending,0);assert.deepEqual(device.data.outbox,[]);
    const idle=statuses.filter(s=>s.phase==='idle');
    assert.ok(idle.length>=1 && idle.slice(0,-1).every(s=>s.pending>0),'the pass that missed the late answer did not report it sent');
  });

  test('a sync() after the pass\'s last check but before it settled still starts one more pass',async()=>{
    const net=network();const device=new Device({kind:'account',id:A});
    let woken;let wakeup;
    const third=service(device,net,{statuses:{push(status){
      if(status.phase==='idle' && !woken) queueMicrotask(()=>{
        woken=device.answer(verb,'target-type',verb.lemma,minutesAgo(11));wakeup=third.sync();});
    }}});
    device.answer(verb,'meaning-recall','forgotten',minutesAgo(10));
    await third.sync();
    assert.ok(wakeup,'the sync() call landed in the settle window');
    await wakeup;
    assert.ok((await serverEvents(A)).some(r=>r.event_id===woken.eventId),'the woken pass sent the answer');
    assert.equal(device.data.outbox.length,0);assert.equal(third.status.pending,0);
  });

  test('an account switch stops the other owner\'s queue: nothing is sent or read with the new identity',async()=>{
    const net=network();let signedIn=A;
    const device=new Device({kind:'account',id:A});
    device.answer(noun,'target-type',noun.lemma,minutesAgo(20));
    const sync=service(device,net,{user:()=>signedIn});
    signedIn=B; // another account signed in on this browser before the queue was sent
    const before=(await serverEvents(B)).length;
    await sync.sync();
    assert.equal(sync.status.phase,'stopped');assert.equal(syncLabel(sync.status),'saved-locally');
    assert.equal(net.log.length,0,'no request carries the old queue with the new token');
    assert.equal(device.data.outbox.length,1,'the old owner keeps its pending answer on the device');
    assert.equal((await serverEvents(B)).length,before);
    await sync.sync();assert.equal(net.log.length,0,'a stopped service stays stopped');
    // stop() from the auth switch cancels the scheduled retry as well.
    const timers=[];signedIn=A;net.faults.push('status-503');
    const again=service(device,net,{timers});
    await again.sync();assert.equal(timers.length,1);
    again.stop();assert.equal(timers.length,0);assert.equal(again.status.phase,'stopped');
    // A guest queue has no server owner; a response row of another owner never enters this journal.
    assert.throws(()=>new SyncService(new Device({kind:'guest',id:'g'}),{},{}),/account/);
    const foreign=createSyncTransport({supabaseUrl:URL_BASE,publishableKey:KEY},async()=>({userId:A,accessToken:'token-a'}),
      async()=>Response.json([{user_id:B,sequence:1,event:{},evaluation:null,received_at:'2026-10-28T10:00:00Z'}]));
    await assert.rejects(foreign.pull({kind:'account',id:A},0,10),{kind:'owner'});
  });
});
