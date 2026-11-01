import { test,expect,type Page,type Route } from '@playwright/test';

// S3 (#295) on the real page: SDK session, Chromium IndexedDB and SyncService; only the network is stubbed.
// The old batch's response is held (controlled delay) while a new answer is saved.
const config={schemaVersion:1,configured:true,environment:'local',supabaseUrl:'http://127.0.0.1:54321',
  siteUrl:'http://localhost:5173/v2/',publishableKey:'sb_publishable_localtest1234',dataEpoch:'v2-test-1',epochStartedAt:'2026-10-27T00:00:00.000Z'};
const namespace='drillcards-v2:local:127.0.0.1:54321:v2-test-1';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Expose-Headers':'Content-Range'};
const base64url=(value:unknown)=>btoa(JSON.stringify(value)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const token=(id:string)=>{
  const expires=Math.floor(Date.now()/1000)+3600;
  const access=[base64url({alg:'HS256',typ:'JWT'}),base64url({sub:id,role:'authenticated',exp:expires}),'test-signature'].join('.');
  return {access_token:access,refresh_token:'fake-refresh-token',token_type:'bearer',expires_in:3600,expires_at:expires,
    user:{id,aud:'authenticated',role:'authenticated',email:'test@example.invalid',app_metadata:{provider:'google'},user_metadata:{},created_at:'2026-10-27T00:00:00Z'}};
};
const json=(route:Route,body:unknown,status=200)=>route.fulfill({status,headers:{...cors,'Content-Type':'application/json'},body:JSON.stringify(body)});
type Fact={event:{eventId:string};evaluation:unknown};
// Compiled browser modules, imported inside the page (no TypeScript resolution here).
const modules={store:'/v2/storage/learning-db.js',core:'/v2/core/index.js'};

/** Fake backend whose journal grows only on accepted pushes; repeated event IDs are duplicates. */
async function backend(page:Page) {
  const server={mode:'ok' as 'ok'|'fail',hold:undefined as Promise<void>|undefined,after:undefined as 'ok'|'fail'|undefined,arrived:undefined as (()=>void)|undefined,pushes:[] as {authorization?:string;eventIds:string[]}[],rows:[] as unknown[],facts:new Map<string,Fact>()};
  await page.route('**/v2/environment.json*',route=>json(route,config));
  await page.route('http://127.0.0.1:54321/rest/v1/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname.endsWith('v2_environment'))return json(route,[{schema_version:1,environment:'local',data_epoch:config.dataEpoch,epoch_started_at:config.epochStartedAt}]);
    if(url.pathname.endsWith('learning_events')) {
      const after=Number(url.searchParams.get('sequence')!.slice(3));
      return json(route,server.rows.filter(row=>(row as {sequence:number}).sequence>after));
    }
    if(url.pathname.endsWith('catalog_words'))return json(route,[]);
    return json(route,[]);
  });
  await page.route('http://127.0.0.1:54321/functions/v1/v2-learning-events',async route=>{
    const body=route.request().postDataJSON() as {events:{event:{eventId:string}}[]};
    server.pushes.push({authorization:route.request().headers()['authorization'],eventIds:body.events.map(item=>item.event.eventId)});
    if(server.mode==='fail')return json(route,{ok:false,error:'unavailable'},503);
    const hold=server.hold;server.hold=undefined;
    const results=body.events.map(({event})=>{
      if(server.rows.some(row=>(row as {event:{eventId:string}}).event.eventId===event.eventId))return {eventId:event.eventId,status:'duplicate'};
      const fact=server.facts.get(event.eventId)!;
      server.rows.push({user_id:'account-A',sequence:server.rows.length+1,event:fact.event,evaluation:fact.evaluation,received_at:new Date().toISOString()});
      return {eventId:event.eventId,status:'accepted'};
    });
    // A held request is processed now (the server has it) but its response arrives only on release.
    if(hold){server.arrived?.();await hold;}
    if(server.after){const next=server.after;server.after=undefined;server.mode=next;}
    return json(route,{ok:true,journalRevision:server.rows.length,results});
  });
  await page.route('http://127.0.0.1:54321/auth/v1/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith('/logout'))return json(route,{});
    if(path.endsWith('/user'))return json(route,token('account-A').user);
    return json(route,token('account-A'));
  });
  await page.addInitScript(({key,session})=>{if(!sessionStorage.getItem('seeded')){localStorage.setItem(key,JSON.stringify(session));sessionStorage.setItem('seeded','1');}},
    {key:namespace+':auth',session:token('account-A')});
  return server;
}
/** Commit one answer into the account's local store, exactly as the Runner would (event + outbox atomically). */
async function answer(page:Page,server:Awaited<ReturnType<typeof backend>>):Promise<string> {
  const fact=await page.evaluate(async({name,epoch,modules})=>{
    const { LearningDatabase }=await import(modules.store);
    const core=await import(modules.core);
    const word={schemaVersion:1,contentVersion:1,id:'table',lemma:'Tisch',article:'der',partOfSpeech:'noun',senseId:'table',
      meanings:{ru:{preferred:'стол',accepted:[]}},acceptedForms:[],tags:[],examples:[]};
    const id=crypto.randomUUID();const at=new Date(Math.floor(Date.now()/1000)*1000-60000).toISOString();
    const task=core.createWordExerciseRegistry([word],'catalog/1').get('target-type').buildTask(word,{taskId:'task-'+id,seed:'seed',answerLanguage:'ru'});
    const owner={kind:'account',id:'account-A'};
    const state={status:'ready',revision:0,taskIndex:0,plan:{schemaVersion:1,sessionId:'session-'+id,owner,dataEpoch:epoch.dataEpoch,
      createdAt:at,studyTimezone:'UTC',seed:'seed',policyVersion:core.EVIDENCE_POLICY_VERSION,tasks:[task]}};
    const db=await LearningDatabase.open(indexedDB,name);const scope=await db.scope(owner,epoch);
    await scope.startSession({catalogVersion:'catalog/1',words:[word],state});
    const event={schemaVersion:1,kind:'answer',eventId:'event-'+id,commandId:'command-'+id,attemptId:'attempt-'+id,sessionId:'session-'+id,
      taskId:task.id,target:task.target,exerciseId:'target-type',intent:'learn-new',answerLanguage:'ru',occurredAt:at,studyTimezone:'UTC',
      taskVersion:task.taskVersion,contentVersion:1,policyVersion:core.EVIDENCE_POLICY_VERSION,dataEpoch:epoch.dataEpoch,
      rawAnswer:'Tisch',assisted:false,exposure:[]};
    await scope.commit({owner,dataEpoch:epoch.dataEpoch,event,receivedAt:new Date().toISOString(),
      session:{...state,revision:1,status:'feedback'},expectedSessionRevision:0});
    const data=await scope.snapshot();db.close();
    return data.facts.find((f:{event:{eventId:string}})=>f.event.eventId===event.eventId);
  },{name:namespace+':learning',epoch:{dataEpoch:config.dataEpoch,epochStartedAt:config.epochStartedAt},modules});
  server.facts.set(fact.event.eventId,fact);
  return fact.event.eventId;
}
const outbox=(page:Page)=>page.evaluate(async({name,epoch,modules})=>{
  const { LearningDatabase }=await import(modules.store);
  const db=await LearningDatabase.open(indexedDB,name);
  const data=await (await db.scope({kind:'account',id:'account-A'},epoch)).snapshot();db.close();
  return {outbox:data.outbox,cursor:data.sync?.cursor ?? 0,facts:data.facts.length};
},{name:namespace+':learning',epoch:{dataEpoch:config.dataEpoch,epochStartedAt:config.epochStartedAt},modules});

test('an answer saved while the previous batch is in flight stays pending after that batch is acknowledged',async({page})=>{
  const server=await backend(page);
  await page.goto('/v2/environment.html');
  const status=page.locator('#sync-status');
  await expect(status).toHaveAttribute('data-state','sent');
  server.mode='fail';
  const first=await answer(page,server);
  let release!:()=>void;
  server.hold=new Promise<void>(resolve=>{release=resolve;});
  const arrived=new Promise<void>(resolve=>{server.arrived=resolve;});
  server.mode='ok';server.after='fail'; // the held batch succeeds, the next push fails
  await page.locator('#sync-now').click();
  await arrived;
  const second=await answer(page,server); // committed while the first batch's ACK is still on the way
  release();
  await expect(status).toHaveAttribute('data-state','retrying');
  await expect(status).toHaveText('Не удалось отправить, повторим позже. Сохранено на этом устройстве: 1.');
  expect((await outbox(page)).outbox).toEqual([second]);
  expect(server.rows.map(row=>(row as {event:{eventId:string}}).event.eventId)).toEqual([first]);
  server.mode='ok';
  await page.locator('#sync-now').click();
  await expect(status).toHaveAttribute('data-state','sent');
  expect(await outbox(page)).toEqual({outbox:[],cursor:2,facts:2});
  expect(server.rows.map(row=>(row as {event:{eventId:string}}).event.eventId)).toEqual([first,second]);
});
