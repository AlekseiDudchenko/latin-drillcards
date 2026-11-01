import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { PGlite } from '@electric-sql/pglite';
import { parseV2Environment, v2Namespace, callbackUrl, assertServerEnvironment } from '../public/v2/environment-config.js';
import { publicEnvironment } from '../scripts/build-v2-environment.mjs';
import { V2AuthContext } from '../public/v2/auth-context.js';
import { smokeV2 } from '../scripts/v2-smoke.mjs';
import { createHealthHandler } from '../supabase/v2/functions/v2-health/handler.js';

const config={schemaVersion:1,configured:true,environment:'local',supabaseUrl:'http://127.0.0.1:54321',
  siteUrl:'http://localhost:5173/v2/',publishableKey:'sb_publishable_localtest1234',dataEpoch:'v2-test-1',epochStartedAt:'2026-10-27T00:00:00.000Z'};
const vars={DRILLCARDS_V2_ENV:'local',V2_SUPABASE_URL:config.supabaseUrl,V2_SITE_URL:config.siteUrl,
  V2_SUPABASE_PUBLISHABLE_KEY:config.publishableKey,V2_DATA_EPOCH:config.dataEpoch,V2_EPOCH_STARTED_AT:config.epochStartedAt};
const metadata={schema_version:1,environment:config.environment,data_epoch:config.dataEpoch,epoch_started_at:config.epochStartedAt};
const deferred=()=>{let resolve;let reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));
const session=id=>({user:{id}});
function authFixture({initial=null,delayInitial=false}={}) {
  let listener;let unsubscribed=false;const requests=[];const pending=deferred();let logoutError=null;
  const port={
    onAuthStateChange(fn){listener=fn;return {data:{subscription:{unsubscribe(){unsubscribed=true;}}}};},
    getSession(){return delayInitial?pending.promise:Promise.resolve({data:{session:initial},error:null});},
    async signInWithOAuth(options){requests.push(options);return {data:{},error:null};},
    async signOut(){if(!logoutError)listener?.('SIGNED_OUT',null);return {error:logoutError};},
  };
  const views=[];const scopes=[];
  const db={async scope(owner,epoch){const scope={owner,epoch};scopes.push(scope);return scope;}};
  const context=new V2AuthContext(port,db,config,'guest-test',v=>views.push(v));
  return {context,db,views,requests,pending,scopes,emit:(event,user)=>listener(event,user),setLogoutError:e=>{logoutError=e;},isUnsubscribed:()=>unsubscribed};
}

test('v2 config isolates project, environment and epoch and fixes its OAuth callback',()=>{
  const parsed=parseV2Environment(config);assert.deepEqual(parsed,config);
  assert.equal(callbackUrl(parsed),'http://localhost:5173/v2/environment.html');
  const namespaces=[config,{...config,dataEpoch:'next'},{...config,supabaseUrl:'http://127.0.0.1:54323'},
    {...config,environment:'preview',supabaseUrl:'https://abcdefghijklmnopqrst.supabase.co',siteUrl:'https://preview.example.org/v2/'}].map(c=>v2Namespace(parseV2Environment(c)));
  assert.equal(new Set(namespaces).size,4);
  assert.doesNotThrow(()=>assertServerEnvironment(parsed,metadata));
  for(const patch of [{environment:'production'},{data_epoch:'old'},{epoch_started_at:'2020-01-01T00:00:00Z'},{schema_version:2}])
    assert.throws(()=>assertServerEnvironment(parsed,{...metadata,...patch}));
});

test('config rejects secrets, unsafe URLs, arbitrary fields and incomplete hosted deployments',()=>{
  const jwt=role=>'e30.'+Buffer.from(JSON.stringify({role})).toString('base64url')+'.signature';
  assert.doesNotThrow(()=>parseV2Environment({...config,publishableKey:jwt('anon')}));
  for(const patch of [{publishableKey:'sb_secret_notpublic'},{publishableKey:jwt('service_role')},{publishableKey:'not-a-key'},
    {supabaseUrl:'http://user:password@localhost:54321'},
    {supabaseUrl:'http://localhost:54321/?secret=oops'},{siteUrl:'https://evil.example/v2/'},{siteUrl:'http://localhost:5173/'},
    {environment:'preview'},{serviceRoleKey:'private'},{dataEpoch:''},{epochStartedAt:'yesterday'}])
    assert.throws(()=>parseV2Environment({...config,...patch}));
  assert.throws(()=>publicEnvironment({DRILLCARDS_V2_ENV:'production'}));
});

test('public build takes only an explicit allowlist and never serializes server/provider secrets',()=>{
  const built=publicEnvironment({...vars,SUPABASE_SERVICE_ROLE_KEY:'SERVICE_CANARY',SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET:'GOOGLE_CANARY',V2_DATABASE_URL:'postgres://private'});
  assert.deepEqual(built,config);
  assert.ok(!JSON.stringify(built).includes('CANARY'));
  assert.deepEqual(publicEnvironment({}),{schemaVersion:1,configured:false,environment:'local'});
  assert.throws(()=>publicEnvironment({V2_SITE_URL:config.siteUrl}));
});

test('auth restores a guest, switches accounts, keeps token refresh scope, and passes only Google callback',async()=>{
  const f=authFixture();await f.context.start();await flush();
  assert.deepEqual(f.context.view,{phase:'ready',owner:{kind:'guest',id:'guest-test'}});
  f.emit('SIGNED_IN',session('A'));await flush();
  assert.equal((await f.context.active.run(scope=>scope.owner)).id,'A');
  const count=f.scopes.length;f.emit('TOKEN_REFRESHED',session('A'));await flush();assert.equal(f.scopes.length,count);
  f.emit('SIGNED_IN',session('B'));await flush();assert.equal(f.context.view.owner.id,'B');
  await f.context.signIn();assert.deepEqual(f.requests,[{provider:'google',options:{redirectTo:callbackUrl(config),queryParams:{prompt:'select_account'}}}]);
  f.context.dispose();assert.equal(f.isUnsubscribed(),true);
});

test('sign-out invalidates immediately and rejects old async completions before returning to a guest',async()=>{
  const f=authFixture({initial:session('A')});await f.context.start();await flush();
  const pending=deferred();const old=f.context.active.run(()=>pending.promise);
  const result=f.context.signOut();
  await assert.rejects(f.context.active.run(()=>true),{name:'StaleLearningContext'});
  pending.resolve('private-A');await assert.rejects(old,{name:'StaleLearningContext'});
  await result;await flush();assert.equal(f.context.view.owner.kind,'guest');f.context.dispose();
});

test('a sign-out network error leaves no active account scope; retry works',async()=>{
  const f=authFixture({initial:session('A')});await f.context.start();await flush();
  f.setLogoutError(new Error('network'));await assert.rejects(f.context.signOut());
  assert.deepEqual(f.context.view,{phase:'error'});
  f.emit('TOKEN_REFRESHED',session('A'));await flush();
  assert.deepEqual(f.context.view,{phase:'error'},'background refresh must not reactivate a scope after attempted logout');
  await assert.rejects(f.context.active.run(()=>true),{name:'StaleLearningContext'});
  f.setLogoutError(null);await f.context.signOut();await flush();assert.equal(f.context.view.owner.kind,'guest');f.context.dispose();
});

test('late initial session, delayed scope and callbacks after disposal cannot restore the old user',async()=>{
  const f=authFixture({delayInitial:true});const a=deferred();
  f.db.scope=owner=>owner.id==='A'?a.promise:Promise.resolve({owner});
  const start=f.context.start();f.emit('SIGNED_IN',session('A'));f.emit('SIGNED_IN',session('B'));await flush();
  a.resolve({owner:{kind:'account',id:'A'}});f.pending.resolve({data:{session:session('A')},error:null});await start;await flush();
  assert.equal(f.context.view.owner.id,'B');
  f.context.dispose();f.emit('SIGNED_IN',session('A'));await flush();
  await assert.rejects(f.context.active.run(()=>true),{name:'StaleLearningContext'});
});

const health=(fetcher)=>createHealthHandler({supabaseUrl:'http://127.0.0.1:54321',publishableKey:config.publishableKey,
  environment:'local',allowedOrigins:['http://localhost:5173'],fetcher});
const response=(body,status=200)=>new Response(JSON.stringify(body),{status});

test('Edge health checks guest access and validates user tokens with Auth; it never returns identity or credentials',async()=>{
  const calls=[];
  const handler=health(async(url,options)=>{
    calls.push({path:new URL(url).pathname,headers:options.headers});
    if(String(url).includes('/auth/v1/user'))return response({id:'private-user-A'});
    return response(String(url).includes('v2_environment')?[metadata]:[{id:'word'}]);
  });
  for(const signedIn of [false,true]) {
    const headers={Origin:'http://localhost:5173',...(signedIn?{Authorization:'Bearer fake-test-token'}:{})};
    const res=await handler(new Request('https://functions.test/v2-health',{headers}));
    assert.equal(res.status,200);const data=await res.json();assert.equal(data.ok,true);assert.equal(data.signedIn,signedIn);
    assert.ok(!JSON.stringify(data).includes('private-user-A'));assert.ok(!JSON.stringify(data).includes('fake-test-token'));
    assert.equal(res.headers.get('Access-Control-Allow-Origin'),'http://localhost:5173');
  }
  assert.equal(calls.filter(c=>c.path==='/auth/v1/user').length,1);
  assert.ok(calls.filter(c=>c.path.startsWith('/rest/')).every(c=>!('Authorization' in c.headers)));
});

test('Edge smoke rejects service-role keys rather than accidentally bypassing guest RLS',()=>{
  const jwt=role=>'e30.'+Buffer.from(JSON.stringify({role})).toString('base64url')+'.signature';
  const make=key=>createHealthHandler({supabaseUrl:config.supabaseUrl,publishableKey:key,environment:'local',allowedOrigins:[]});
  assert.throws(()=>make('sb_secret_private'));
  assert.throws(()=>make(jwt('service_role')));
  assert.doesNotThrow(()=>make(jwt('anon')));
});

test('Edge health denies bad origins/tokens, wrong epochs/environment and upstream failures without exposing errors',async()=>{
  let calls=0;const handler=health(async()=>{calls++;return response({},401);});
  assert.equal((await handler(new Request('https://f.test',{headers:{Origin:'https://evil.test'}}))).status,403);assert.equal(calls,0);
  assert.equal((await handler(new Request('https://f.test',{method:'POST'}))).status,405);
  assert.equal((await handler(new Request('https://f.test',{method:'OPTIONS',headers:{Origin:'http://localhost:5173'}}))).status,204);
  assert.equal((await handler(new Request('https://f.test',{headers:{Authorization:'Bearer forged'}}))).status,401);
  const failed=health(async()=>{throw new Error('SECRET_BACKEND_CANARY');});
  const res=await failed(new Request('https://f.test'));assert.equal(res.status,503);assert.ok(!(await res.text()).includes('CANARY'));
  const wrong=health(async url=>response(String(url).includes('v2_environment')?[{...metadata,environment:'production'}]:[{id:'word'}]));
  assert.equal((await wrong(new Request('https://f.test'))).status,503);
});

test('deployment smoke checks the configured generation without echoing a private access token',async()=>{
  const calls=[];
  const fetcher=async(url,options)=>{calls.push(options);return response({ok:true,signedIn:Boolean(options.headers.Authorization),
    schemaVersion:1,environment:config.environment,dataEpoch:config.dataEpoch,epochStartedAt:config.epochStartedAt});};
  assert.deepEqual(await smokeV2(config,{fetcher}),{ok:true,environment:'local',signedIn:false});
  const result=await smokeV2(config,{fetcher,accessToken:'PRIVATE_TOKEN_CANARY'});
  assert.equal(result.signedIn,true);assert.ok(!JSON.stringify(result).includes('CANARY'));
  assert.equal(calls[1].headers.Authorization,'Bearer PRIVATE_TOKEN_CANARY');
  await assert.rejects(smokeV2(config,{fetcher:async()=>response({},401)}));
  await assert.rejects(smokeV2(config,{fetcher:async()=>response({ok:true,signedIn:false,schemaVersion:1,environment:'production'})}));
});

test('prepared additive transition also works on an empty Supabase project with read-only metadata',async()=>{
  execFileSync(process.execPath,['scripts/prepare-v2-deployment.mjs'],{env:{...process.env,...vars,SUPABASE_SERVICE_ROLE_KEY:'SERVER_SECRET_CANARY'}});
  const root='build/v2/local';
  const toml=readFileSync(`${root}/supabase/config.toml`,'utf8');assert.ok(!toml.includes('SERVER_SECRET_CANARY'));
  assert.ok(!toml.includes('[auth]'));
  assert.ok(!toml.includes('GOOGLE'));
  const manifest=JSON.parse(readFileSync(`${root}/transition.json`,'utf8'));
  assert.equal(manifest.applyAutomatically,false);
  const db=new PGlite();
  try {
    await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
      GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;`);
    await db.exec(readFileSync(`${root}/transition.sql`,'utf8'));
    assert.equal((await db.query('SELECT count(*)::int n FROM public.catalog_words')).rows[0].n,1306);
    for(const role of ['anon','authenticated','service_role']) {
      await db.exec(`SET ROLE ${role}`);
      const actual=(await db.query('SELECT schema_version,environment,data_epoch,epoch_started_at FROM public.v2_environment')).rows[0];
      assert.doesNotThrow(()=>assertServerEnvironment(config,actual));
      await assert.rejects(db.exec("UPDATE public.v2_environment SET data_epoch='forged'"),{code:'42501'});
      await db.exec('RESET ROLE');
    }
  } finally {await db.close();}
});
