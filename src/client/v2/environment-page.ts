import type { SupabaseClient, createClient } from '@supabase/supabase-js';
import { assetUrl } from '../config.js';
import { LearningDatabase, StaleLearningContext } from './storage/learning-db.js';
import { assertServerEnvironment, parseV2Environment, v2Namespace, type ReadyEnvironment } from './environment-config.js';
import { V2AuthContext, type AuthView } from './auth-context.js';
import { SyncService, createSyncTransport, syncLabel, type SyncStatus } from './sync-service.js';
import { takeReturn } from './learning-context.js';

const labels={
  ru:{loading:'Загрузка…',guest:'Гость',account:'Вы вошли',login:'Войти через Google',logout:'Выйти',catalog:'Общий каталог',
    unavailable:'Не удалось подключиться к окружению v2.',unconfigured:'Окружение v2 ещё не настроено.',
    error:'Не удалось выполнить действие. Попробуйте ещё раз.',count:'Опубликованных слов',local:'Локальная проверка',preview:'Предварительная версия',production:'Версия v2',
    sent:'Все ответы отправлены на сервер.','saved-locally':'Сохранено на этом устройстве, ещё не отправлено: {n}.',sending:'Отправляем ответы…',
    offline:'Нет сети. Сохранено на этом устройстве: {n}.',retrying:'Не удалось отправить, повторим позже. Сохранено на этом устройстве: {n}.',
    rejected:'Сервер не принял ответов: {n}; они не учитываются в прогрессе.',conflicts:'Заменено версией с сервера: {n}.',syncNow:'Отправить сейчас'},
  en:{loading:'Loading…',guest:'Guest',account:'Signed in',login:'Sign in with Google',logout:'Sign out',catalog:'Shared catalog',
    unavailable:'Could not connect to the v2 environment.',unconfigured:'The v2 environment is not configured yet.',
    error:'Could not complete the action. Please try again.',count:'Published words',local:'Local check',preview:'Preview',production:'Version v2',
    sent:'All answers are sent to the server.','saved-locally':'Saved on this device, not sent yet: {n}.',sending:'Sending answers…',
    offline:'Offline. Saved on this device: {n}.',retrying:'Sending failed, will retry. Saved on this device: {n}.',
    rejected:'Answers refused by the server: {n}; they do not count towards progress.',conflicts:'Replaced by the server version: {n}.',syncNow:'Send now'},
  de:{loading:'Wird geladen…',guest:'Gast',account:'Angemeldet',login:'Mit Google anmelden',logout:'Abmelden',catalog:'Gemeinsamer Wortschatz',
    unavailable:'Die Verbindung zur V2-Umgebung ist fehlgeschlagen.',unconfigured:'Die V2-Umgebung ist noch nicht eingerichtet.',
    error:'Die Aktion ist fehlgeschlagen. Bitte erneut versuchen.',count:'Veröffentlichte Wörter',local:'Lokale Prüfung',preview:'Vorschau',production:'Version v2',
    sent:'Alle Antworten sind an den Server gesendet.','saved-locally':'Auf diesem Gerät gespeichert, noch nicht gesendet: {n}.',sending:'Antworten werden gesendet…',
    offline:'Offline. Auf diesem Gerät gespeichert: {n}.',retrying:'Senden fehlgeschlagen, neuer Versuch folgt. Auf diesem Gerät gespeichert: {n}.',
    rejected:'Vom Server abgelehnte Antworten: {n}; sie zählen nicht zum Fortschritt.',conflicts:'Durch die Serverversion ersetzt: {n}.',syncNow:'Jetzt senden'},
};
type Language=keyof typeof labels;
const $=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
let language:Language='ru';
let auth:V2AuthContext|undefined; let client:SupabaseClient|undefined; let db:LearningDatabase|undefined;
let config:ReadyEnvironment|undefined; let view:AuthView={phase:'loading'};
let request:AbortController|undefined; let disposed=false;
let error:'unconfigured'|'unavailable'|'error'|undefined;
/** While the page stays open, also check every minute (other devices, a missed trigger). */
const IDLE_SYNC_MS=60_000;
let sync:SyncService|undefined; let syncFor:AuthView|undefined;
const list=(id:string,values:string[])=>$(id).replaceChildren(...values.map(value=>{const li=document.createElement('li');li.textContent=value;return li;}));
function render():void {
  const t=labels[language];document.documentElement.lang=language;
  $('environment').textContent=config?t[config.environment]:'';
  $('auth-status').textContent=view.phase==='loading'?t.loading:view.phase==='error'?'':view.owner?.kind==='account'?t.account:t.guest;
  $('login').textContent=t.login;$('logout').textContent=t.logout;$('catalog-title').textContent=t.catalog;
  $<HTMLButtonElement>('login').disabled=!auth || view.phase!=='ready';
  $('login').hidden=view.owner?.kind==='account';$('logout').hidden=!auth || (view.owner?.kind!=='account' && view.phase!=='error');
  $('message').textContent=error?t[error]:'';
  renderSync();
}
/** Local save and server confirmation are different states; a guest never syncs. */
function renderSync():void {
  const t=labels[language];const status=sync?.status;
  $('sync-status').hidden=!status;$('sync-now').hidden=!status;$('sync-now').textContent=t.syncNow;
  if(!status) return;
  $<HTMLButtonElement>('sync-now').disabled=status.phase==='syncing';
  $('sync-status').dataset.state=syncLabel(status);
  $('sync-status').textContent=t[syncLabel(status)].replace('{n}',String(status.pending))+
    (status.rejected?' '+t.rejected.replace('{n}',String(status.rejected))+
      (status.rejectedReasons?' ('+Object.entries(status.rejectedReasons).map(([reason,n])=>`${reason}: ${n}`).join(', ')+')':''):'')+
    (status.conflicts?' '+t.conflicts.replace('{n}',String(status.conflicts)):'');
}
/** One service per signed-in owner. Any identity change stops it synchronously, before the next scope. */
function startSync(next:AuthView):void {
  if(next===syncFor) return; // a re-render (e.g. language) keeps the running service
  syncFor=next;sync?.stop();sync=undefined;
  if(next.phase!=='ready' || next.owner?.kind!=='account' || !auth || !client || !config) return;
  const sdk=client;const settings=config;
  void auth.active.run(async scope=>scope).then(scope=>{
    if(disposed || view!==next) return;
    sync=new SyncService(scope,createSyncTransport(settings,async()=>{
      const {data}=await sdk.auth.getSession();
      return data.session ? {userId:data.session.user.id,accessToken:data.session.access_token} : null;
    }),{now:()=>new Date().toISOString(),online:()=>navigator.onLine,random:Math.random,
      setTimer:(run,ms)=>setTimeout(run,ms),clearTimer:timer=>clearTimeout(timer as number),onStatus:renderSync,
      idleSyncMs:IDLE_SYNC_MS,...(navigator.locks ? {lock:<T,>(name:string,work:()=>Promise<T>)=>navigator.locks.request(name,work) as Promise<T>} : {})});
    renderSync();
    void sync.sync();
  }).catch(()=>{});
}
function changed(next:AuthView):void {
  // The fixed Google callback: a sign-in started on another v2 page continues there.
  if(next.phase==='ready' && next.owner?.kind==='account' && config){
    let target:string|undefined;try{target=takeReturn(sessionStorage,config);}catch{}
    if(target){disposed=true;sync?.stop();auth?.dispose();location.replace(target);return;}
  }
  view=next;request?.abort();$('catalog').hidden=true;list('decks',[]);list('words',[]);
  $('catalog-count').textContent='';$('catalog').removeAttribute('data-owner');
  error=next.phase==='error'?'error':undefined;startSync(next);render();
  if(next.phase!=='ready' || !auth || !client) return;
  const controller=new AbortController();request=controller;
  const active=auth;const sdk=client;
  void active.active.run(async scope=>{
    await scope.restore(new Date().toISOString());
    const words=await sdk.from('catalog_words').select('word',{count:'exact'}).order('id').limit(5).abortSignal(controller.signal);
    const decks=await sdk.from('catalog_decks').select('id,title,wordIds').order('id').abortSignal(controller.signal);
    if(words.error || decks.error) throw new Error('Catalog read failed');
    return {words:words.data,decks:decks.data,count:words.count};
  }).then(data=>{
    if(disposed || controller.signal.aborted) return;
    list('words',data.words.map((row:{word:{lemma:string}})=>row.word.lemma));
    list('decks',data.decks.map((row:{title:string;wordIds:unknown[]})=>`${row.title} · ${row.wordIds.length}`));
    $('catalog-count').textContent=`${labels[language].count}: ${data.count ?? data.words.length}`;
    $('catalog').dataset.owner=next.owner?.kind;$('catalog').hidden=false;
  }).catch(cause=>{
    if(disposed || controller.signal.aborted || cause instanceof StaleLearningContext) return;
    error='unavailable';render();
  });
}
async function init():Promise<void> {
  render();
  // A v1 service worker ignores Request.cache and may return an old environment.
  // A unique URL forces its cache miss without changing the current site's SW.
  const configUrl=new URL(assetUrl('v2/environment.json'));configUrl.searchParams.set('v2',crypto.randomUUID());
  const response=await fetch(configUrl,{cache:'no-store'});
  if(!response.ok) throw new Error('Missing environment');
  const parsed=parseV2Environment(await response.json());
  if(!parsed.configured){error='unconfigured';view={phase:'error'};render();return;}
  config=parsed;
  if(new URL(config.siteUrl).origin!==location.origin) throw new Error('Wrong deployment origin');
  const meta=await fetch(`${config.supabaseUrl}/rest/v1/v2_environment?select=schema_version,environment,data_epoch,epoch_started_at`,
    {headers:{apikey:config.publishableKey},cache:'no-store'});
  if(!meta.ok) throw new Error('Environment unavailable');
  const rows=await meta.json();if(!Array.isArray(rows) || rows.length!==1) throw new Error('Missing server configuration');
  assertServerEnvironment(config,rows[0]);
  if(disposed) return;
  const sdk=(window as unknown as {supabase:{createClient:typeof createClient}}).supabase;
  client=sdk.createClient(config.supabaseUrl,config.publishableKey,{auth:{storageKey:v2Namespace(config)+':auth',
    flowType:'pkce',detectSessionInUrl:true,persistSession:true,autoRefreshToken:true}});
  const namespace=v2Namespace(config);
  let guestId:string;
  try {guestId=localStorage.getItem(namespace+':guest') ?? crypto.randomUUID();localStorage.setItem(namespace+':guest',guestId);}
  catch {guestId=crypto.randomUUID();}
  db=await LearningDatabase.open(indexedDB,namespace+':learning');
  if(disposed){db.close();return;}
  auth=new V2AuthContext(client.auth,db,config,guestId,changed);
  await auth.start();
}
$('login').addEventListener('click',()=>{void auth?.signIn().catch(()=>{error='error';render();});});
$('logout').addEventListener('click',()=>{void auth?.signOut().catch(()=>{error='error';render();});});
$('sync-now').addEventListener('click',()=>{void sync?.sync();});
window.addEventListener('online',()=>{void sync?.sync();});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void sync?.sync();});
$('language').addEventListener('change',()=>{language=$<HTMLSelectElement>('language').value as Language;if(auth)changed(view);else render();});
window.addEventListener('pagehide',()=>{disposed=true;sync?.stop();request?.abort();auth?.dispose();db?.close();void client?.auth.stopAutoRefresh();},{once:true});
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
void init().catch(()=>{if(!disposed){auth?.dispose();auth=undefined;db?.close();view={phase:'error'};error='unavailable';render();}});
