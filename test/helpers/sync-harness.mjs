import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import * as core from '../../packages/vocabulary-core/dist/index.js';
import { buildSeed, loadSources, IDENTITIES_PATH } from '../../scripts/vocabulary-seed.mjs';
import { catalogSeedSql } from '../../scripts/catalog-bootstrap.mjs';
import { createLearningEventsHandler } from '../../supabase/v2/functions/v2-learning-events/handler.js';
import { RetiredScopeError, acknowledgeInPartition, commitInPartition, mergeRemoteInPartition, startInPartition } from '../../public/v2/storage/learning-db.js';
import { SyncService, createSyncTransport } from '../../public/v2/sync-service.js';

// Shared by the S3 race tests: real S1 handler, migrations and RLS reads in PGlite behind a
// fake network whose requests can be held, delayed or failed per path; devices run the
// IndexedDB adapter's pure transaction bodies in memory.
export const A='00000000-0000-4000-8000-00000000000a';
export const B='00000000-0000-4000-8000-00000000000b';
export const EPOCH={dataEpoch:'s3-test',epochStartedAt:'2026-01-01T00:00:00.000Z'};
const REF='7db7afee5acec66afd8612f186281dfe97b0cbf1';
const URL_BASE='https://project.supabase.co';
const KEY='sb_publishable_test_123456789';
const read=path=>readFileSync(new URL(`../../supabase/v2/${path}`,import.meta.url),'utf8');
export const seed=buildSeed(JSON.parse(readFileSync(IDENTITIES_PATH,'utf8')),loadSources());
export const registry=core.createWordExerciseRegistry(seed.words,seed.catalogVersion);
export const noun=seed.words.find(w=>w.article && w.meanings.ru);
export const verb=seed.words.find(w=>w.partOfSpeech==='verb' && w.meanings.ru);
export const other=seed.words.find(w=>w.article && w.meanings.ru && w.id!==noun.id);
const tokens={'token-a':A,'token-b':B};
export const minutesAgo=m=>new Date(Math.floor(Date.now()/1000)*1000-m*60000).toISOString();

export async function startServer() {
  const db=new PGlite();
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
  // One statement at a time: PGlite has a single connection and the network below is concurrent.
  let queue=Promise.resolve();
  const as=(role,user,sql,params=[])=>{
    const run=queue.then(async()=>{
      await db.exec('BEGIN');
      try {
        await db.exec(`SET LOCAL ROLE ${role}`);
        await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[user ?? '']);
        const result=await db.query(sql,params);
        await db.exec('COMMIT');
        return result;
      } catch(error) { await db.exec('ROLLBACK'); throw error; }
    });
    queue=run.catch(()=>{});
    return run;
  };
  const one=async(sql,params)=>(await as('service_role',null,sql,params)).rows[0].r;
  const catalogs=new Map();
  const store={
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
  const handler=createLearningEventsHandler({supabaseUrl:URL_BASE,publishableKey:KEY,allowedOrigins:[],core,store,
    fetcher:async(_url,init)=>{const id=tokens[init.headers.Authorization.slice(7)];return id ? Response.json({id}) : new Response('{}',{status:401});}});
  return {
    db,as,handler,close:()=>db.close(),
    events:async user=>(await as('service_role',null,'SELECT event_id,event FROM public.learning_events WHERE user_id=$1 ORDER BY sequence',[user])).rows,
    progress:async(user,word)=>(await as('service_role',null,'SELECT revision::int,progress FROM public.word_progress WHERE user_id=$1 AND word_id=$2',[user,word])).rows[0],
  };
}

const PATHS={push:'/functions/v1/v2-learning-events',pull:'/rest/v1/learning_events',words:'/rest/v1/catalog_words'};
/** Fake network. `fail(kind,'truncate')` answers only the first event of a push. `hold(kind)` keeps the next response of that kind (after the server processed it) until
 * released; `fail(kind, how)` fails the next request of that kind ('503' or 'drop' after delivery).
 */
export function network(server) {
  const log=[];const holds=[];const faults=[];let offline=false;
  async function fetcher(input,init={}) {
    const url=new URL(input);const user=tokens[init.headers?.Authorization?.slice(7)];
    const kind=Object.keys(PATHS).find(k=>PATHS[k]===url.pathname);
    const body=init.body ? JSON.parse(init.body) : undefined;
    log.push({kind,user,eventIds:body?.events?.map(i=>i.event.eventId)});
    if(offline) throw new TypeError('Failed to fetch');
    const fault=faults.findIndex(f=>f.kind===kind);
    const how=fault>=0 ? faults.splice(fault,1)[0].how : undefined;
    if(how==='503') return new Response('{}',{status:503});
    let response;
    if(kind==='push') response=await server.handler(new Request(url,{method:'POST',headers:init.headers,body:init.body}));
    else if(kind==='pull') {
      const after=Number(url.searchParams.get('sequence').slice(3));const limit=Number(url.searchParams.get('limit'));
      response=Response.json((await server.as('authenticated',user,`SELECT user_id,sequence::int AS sequence,event,evaluation,received_at
        FROM public.learning_events WHERE sequence>$1 ORDER BY sequence LIMIT $2`,[after,limit])).rows);
    } else if(kind==='words') {
      const ids=JSON.parse(`[${url.searchParams.get('id').slice(4,-1)}]`);
      response=Response.json((await server.as('authenticated',user,'SELECT word FROM public.catalog_words WHERE id=ANY($1)',[ids])).rows);
    } else response=new Response('{}',{status:404});
    const hold=holds.findIndex(h=>h.kind===kind);
    if(hold>=0) { const h=holds.splice(hold,1)[0];h.arrive();await h.released; }
    if(how==='drop') throw new TypeError('Connection reset after delivery');
    if(how==='truncate') { const data=await response.json();data.results=data.results.slice(0,1);return Response.json(data); }
    return response;
  }
  return {fetcher,log,
    set offline(value){offline=value;},
    fail(kind,how='503'){faults.push({kind,how});},
    hold(kind) {
      let arrive,release;const arrived=new Promise(r=>{arrive=r;});const released=new Promise(r=>{release=r;});
      holds.push({kind,arrive,released});return {arrived,release};
    },
    pushes:()=>log.filter(l=>l.kind==='push'),
  };
}

/** One device: an in-memory partition with the adapter's pure transaction bodies. `retire()` simulates
 * an epoch reset or guest transfer of this scope (its partition rejects every later write).
 */
export class Device {
  constructor(owner,data) {
    this.owner=owner;this.epoch=EPOCH;this.retired=false;
    this.data=data ?? {schemaVersion:1,owner,epoch:EPOCH,projectionAsOf:EPOCH.epochStartedAt,sessions:[],facts:[],projections:[],outbox:[]};
  }
  check() { if(this.retired) throw new RetiredScopeError('Stale data epoch'); }
  async snapshot() { this.check();return structuredClone(this.data); }
  async acknowledge(acks) { this.check();this.data=acknowledgeInPartition(this.data,acks);return structuredClone(this.data); }
  async mergeRemote(remote,words,asOf) { this.check();this.data=mergeRemoteInPartition(this.data,remote,words,asOf);return structuredClone(this.data); }
  /** Start a one-task session on `words` and commit its answer, as the Runner does. */
  answer(word,exerciseId,raw,occurredAt,{words=[noun,verb,other,word],catalogVersion=seed.catalogVersion,patch={}}={}) {
    this.check();
    const id=crypto.randomUUID();
    const pool=core.createWordExerciseRegistry([...new Set(words)],catalogVersion);
    const task=pool.get(exerciseId).buildTask(word,{taskId:`task-${id}`,seed:`seed-${id}`,answerLanguage:'ru'});
    const archive={catalogVersion,words:[...new Set(words)],state:{status:'ready',revision:0,taskIndex:0,
      plan:{schemaVersion:1,sessionId:`session-${id}`,owner:this.owner,dataEpoch:EPOCH.dataEpoch,createdAt:occurredAt,
        studyTimezone:'UTC',seed:`seed-${id}`,policyVersion:core.EVIDENCE_POLICY_VERSION,tasks:[task]}}};
    this.data=startInPartition(this.data,this,archive).next;
    const event={schemaVersion:1,kind:'answer',eventId:`event-${id}`,commandId:`command-${id}`,attemptId:`attempt-${id}`,
      sessionId:archive.state.plan.sessionId,taskId:task.id,target:task.target,exerciseId,intent:'learn-new',answerLanguage:'ru',
      occurredAt,studyTimezone:'UTC',taskVersion:task.taskVersion,contentVersion:task.contentVersion,
      policyVersion:core.EVIDENCE_POLICY_VERSION,dataEpoch:EPOCH.dataEpoch,rawAnswer:raw,assisted:false,exposure:[],...patch};
    const {result,next}=commitInPartition(this.data,this,{owner:this.owner,dataEpoch:EPOCH.dataEpoch,event,receivedAt:occurredAt,
      session:{...archive.state,revision:1,status:'feedback'},expectedSessionRevision:0});
    assert.equal(result,'committed');this.data=next;
    return event;
  }
}
export function service(device,net,{online=()=>true,user=()=>device.owner.id,timers=[],random=()=>1,statuses=[],lock,idleSyncMs,batchSize}={}) {
  const transport=createSyncTransport({supabaseUrl:URL_BASE,publishableKey:KEY},
    async()=>({userId:user(),accessToken:Object.keys(tokens).find(k=>tokens[k]===user())}),net.fetcher);
  return new SyncService(device,transport,{now:()=>new Date().toISOString(),online,random,onStatus:s=>statuses.push(s),
    setTimer:(run,ms)=>{const t={run,ms};timers.push(t);return t;},clearTimer:t=>{const i=timers.indexOf(t);if(i>=0)timers.splice(i,1);},
    ...(lock ? {lock} : {}),...(idleSyncMs ? {idleSyncMs} : {}),...(batchSize ? {batchSize} : {})});
}
/** A Web Locks-like exclusive lock: requests for one name run one after another. */
export function mutex() {
  const tails=new Map();
  return (name,work)=>{
    const previous=tails.get(name) ?? Promise.resolve();
    const result=previous.then(()=>work());
    tails.set(name,result.catch(()=>{}));
    return result;
  };
}
export const localProgress=(device,word)=>device.data.projections.find(p=>p.progress.wordId===word)?.progress;
