import { test,expect,type Page,type Route } from '@playwright/test';
const config={schemaVersion:1,configured:true,environment:'local',supabaseUrl:'http://127.0.0.1:54321',
  siteUrl:'http://localhost:5173/v2/',publishableKey:'sb_publishable_localtest1234',dataEpoch:'v2-test-1',epochStartedAt:'2026-10-27T00:00:00.000Z'};
const authKey='drillcards-v2:local:127.0.0.1:54321:v2-test-1:auth';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Expose-Headers':'Content-Range'};
const base64url=(value:unknown)=>btoa(JSON.stringify(value)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const token=(id:string)=>{
  const expires=Math.floor(Date.now()/1000)+3600;
  const access=[base64url({alg:'HS256',typ:'JWT'}),
    base64url({sub:id,role:'authenticated',exp:expires}),'test-signature'].join('.');
  return {access_token:access,refresh_token:'fake-refresh-token',token_type:'bearer',expires_in:3600,expires_at:expires,
    user:{id,aud:'authenticated',role:'authenticated',email:'test@example.invalid',app_metadata:{provider:'google'},user_metadata:{},created_at:'2026-10-27T00:00:00Z'}};
};
async function json(route:Route,body:unknown,status=200,extra:Record<string,string>={}) {
  await route.fulfill({status,headers:{...cors,...extra,'Content-Type':'application/json'},body:JSON.stringify(body)});
}
async function setup(page:Page,{account=false,epoch='v2-test-1',logoutError=false}={}) {
  await page.route('**/v2/environment.json*',route=>json(route,config));
  await page.route('http://127.0.0.1:54321/rest/v1/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith('v2_environment'))return json(route,[{schema_version:1,environment:'local',data_epoch:epoch,epoch_started_at:config.epochStartedAt}]);
    if(path.endsWith('catalog_words'))return json(route,[{word:{lemma:'Tisch'}},{word:{lemma:'lernen'}}],200,{'Content-Range':'0-1/1306'});
    const signedIn=route.request().headers()['authorization']?.includes('Bearer ey');
    return json(route,[{id:'a1',title:'A1',wordIds:['w-tisch']},...(signedIn?[{id:'personal',title:'Private deck A',wordIds:[]}]:[])]);
  });
  await page.route('http://127.0.0.1:54321/auth/v1/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith('/logout'))return json(route,logoutError?{msg:'temporary failure'}:{},logoutError?500:200);
    if(path.endsWith('/user'))return json(route,token('account-A').user);
    if(path.endsWith('/token'))return json(route,token('account-A'));
    return route.fulfill({status:200,contentType:'text/html',body:'Google sign-in requested'});
  });
  if(account)await page.addInitScript(({key,session})=>localStorage.setItem(key,JSON.stringify(session)),{key:authKey,session:token('account-A')});
}

test('unconfigured local build is explicit and does not enable sign-in',async({page})=>{
  await page.route('**/v2/environment.json*',route=>json(route,{schemaVersion:1,configured:false,environment:'local'}));
  await page.goto('/v2/environment.html');
  await expect(page.locator('#message')).toHaveText('Окружение v2 ещё не настроено.');
  await expect(page.locator('#login')).toBeDisabled();await expect(page.locator('#logout')).toBeHidden();
});

test('guest reads shared catalog through the self-hosted SDK and Google uses PKCE plus the fixed callback',async({page})=>{
  await setup(page);await page.goto('/v2/environment.html');
  await expect(page.locator('#auth-status')).toHaveText('Гость');
  await expect(page.locator('#catalog')).toHaveAttribute('data-owner','guest');
  await expect(page.locator('#catalog-count')).toContainText('1306');
  await expect(page.locator('#decks')).not.toContainText('Private deck A');
  await page.locator('#language').selectOption('en');await expect(page.locator('#login')).toHaveText('Sign in with Google');
  const navigation=page.waitForURL('**/auth/v1/authorize?**');await page.locator('#login').click();await navigation;
  const url=new URL(page.url());expect(url.searchParams.get('provider')).toBe('google');
  expect(url.searchParams.get('redirect_to')).toBe('http://localhost:5173/v2/environment.html');
  // Google must always offer the account chooser, so another account can be picked.
  expect(url.searchParams.get('prompt')).toBe('select_account');
  expect(url.searchParams.get('code_challenge_method')).toBe('s256');expect(url.searchParams.get('code_challenge')).toBeTruthy();
});

test('restored account reads its private decks and sign-out resets the real learning scope to guest',async({page})=>{
  await setup(page,{account:true});await page.goto('/v2/environment.html');
  await expect(page.locator('#catalog')).toHaveAttribute('data-owner','account');
  await expect(page.locator('#decks')).toContainText('Private deck A');
  await page.locator('#logout').click();
  await expect(page.locator('#auth-status')).toHaveText('Гость');
  await expect(page.locator('#catalog')).toHaveAttribute('data-owner','guest');
  await expect(page.locator('#decks')).not.toContainText('Private deck A');
  const stored=await page.evaluate(key=>localStorage.getItem(key),authKey);expect(stored).toBeNull();
});

test('real SDK exchanges callback code for a session, removes code and activates the account',async({page})=>{
  await setup(page);
  await page.addInitScript(key=>localStorage.setItem(key+'-code-verifier',JSON.stringify('test-pkce-verifier')),authKey);
  const exchange=page.waitForRequest(request=>request.url().includes('/auth/v1/token?grant_type=pkce'));
  await page.goto('/v2/environment.html?code=test-auth-code');
  const request=await exchange;expect(request.postDataJSON().code_verifier).toBe('test-pkce-verifier');
  await expect(page.locator('#auth-status')).toHaveText('Вы вошли');
  await expect(page.locator('#catalog')).toHaveAttribute('data-owner','account');
  expect(new URL(page.url()).searchParams.has('code')).toBe(false);
});

test('sign-out failure clears the account catalog and cannot expose it while retry is pending',async({page})=>{
  await setup(page,{account:true,logoutError:true});await page.goto('/v2/environment.html');
  await expect(page.locator('#catalog')).toHaveAttribute('data-owner','account');
  await page.locator('#logout').click();await expect(page.locator('#message')).toContainText('Попробуйте ещё раз');
  await expect(page.locator('#catalog')).toBeHidden();await expect(page.locator('#decks')).toBeEmpty();
  await page.route('http://127.0.0.1:54321/auth/v1/logout?**',route=>json(route,{}));
  await page.locator('#logout').click();await expect(page.locator('#catalog')).toHaveAttribute('data-owner','guest');
});

test('a server epoch mismatch stops sign-in and catalogue reads',async({page})=>{
  await setup(page,{epoch:'old-epoch'});await page.goto('/v2/environment.html');
  await expect(page.locator('#message')).toHaveText('Не удалось подключиться к окружению v2.');
  await expect(page.locator('#login')).toBeDisabled();await expect(page.locator('#catalog')).toBeHidden();
});


test.describe('v2 environment under the existing offline worker',()=>{
  test.use({serviceWorkers:'allow'});
  test('a stale cached config cannot reconnect the new page to an old environment',async({page,request})=>{
    const current=await (await request.get('/v2/environment.json')).json();
    test.skip(current.configured,'This scenario verifies the default unconfigured build.');
    await page.goto('/v2/environment.html');
    await expect(page.locator('#message')).toHaveText('Окружение v2 ещё не настроено.');
    await page.evaluate(async stale=>{
      await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;
      if(!navigator.serviceWorker.controller)await new Promise<void>(resolve=>navigator.serviceWorker.addEventListener('controllerchange',()=>resolve(),{once:true}));
      const version=await (await fetch('/version.json')).json();
      const cache=await caches.open('drillcards-'+version.version);
      await cache.put('/v2/environment.json',new Response(JSON.stringify(stale),{headers:{'Content-Type':'application/json'}}));
    },config);
    await page.reload();await expect(page.locator('#message')).toHaveText('Окружение v2 ещё не настроено.');
    await expect(page.locator('#login')).toBeDisabled();
  });
});
