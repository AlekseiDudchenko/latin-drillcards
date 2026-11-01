/** S1 (#319): server intake of learning events. Owner comes only from the verified
 * Auth session; tasks are rebuilt from the pinned catalog snapshot (words) or dataset
 * version (items, G3 #332) and answers are re-evaluated by the shared core before one
 * atomic commit RPC with per-word CAS.
 */
export const MAX_EVENTS=100;
export const MAX_BODY_BYTES=512*1024;
export const MAX_ATTEMPTS=5;

/** Shared JSON payloads are validated by the core at runtime, not by these annotations.
 * @typedef {any} Json
 * @typedef {{eventId:string|null,status:'accepted'|'duplicate'|'rejected',reason?:string}} Result
 * @typedef {{state:(userId:string,ids:Record<string,string[]>)=>Promise<Json>,catalog:(version:string)=>Promise<Json>,dataset:(datasetId:string,version:string)=>Promise<Json>,commit:(userId:string,batch:Json)=>Promise<Json>}} Store
 */

/** @param {Json} value @returns {string} */
function canonical(value) {
  if(Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if(value!==null && typeof value==='object') return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'undefined';
}
/** @param {Json} a @param {Json} b */
const same=(a,b)=>canonical(a)===canonical(b);
/** @param {unknown} value @returns {value is Record<string,Json>} */
const record=value=>value!==null && typeof value==='object' && !Array.isArray(value);

/** Rejections are permanent for that event: retrying the same payload cannot succeed. */
class Rejected extends Error {
  /** @param {string} reason */
  constructor(reason) { super(reason); this.reason=reason; }
}

/**
 * @param {{core:Json,store:Store,userId:string,items:Json[],now:()=>string}} options
 * @returns {Promise<{journalRevision:number,results:Result[]}>}
 */
export async function ingestLearningEvents({core,store,userId,items,now}) {
  if(typeof userId!=='string' || !userId) throw new Error('Owner required');
  const owner={kind:'account',id:userId};
  for(let attempt=1;;attempt++) {
    const receivedAt=now();
    const parsed=items.map(item=>record(item) && core.isLearningEvent(item.event) ? {event:item.event,task:item.task} : null);
    const events=parsed.flatMap(p=>p ? [p.event] : []);
    const words=[...new Set(events.filter(e=>e.target.kind==='word').map(e=>e.target.wordId))];
    const state=await store.state(userId,{wordIds:words,taskIds:[...new Set(events.map(e=>e.taskId))],
      eventIds:events.map(e=>e.eventId),commandIds:events.map(e=>e.commandId),
      attemptIds:events.filter(e=>e.kind==='answer').map(e=>e.attemptId)});
    const tasks=new Map(state.tasks.map((/** @type {Json} */ t)=>[t.taskId,t]));
    /** @type {Json[]} */
    const stored=state.matches.map((/** @type {Json} */ f)=>f.event);
    /** @type {Result[]} */
    const results=[];
    /** @type {Json[]} */
    const fresh=[];
    for(const [index,item] of parsed.entries()) {
      const eventId=record(items[index]) && record(items[index].event) && typeof items[index].event.eventId==='string' ? items[index].event.eventId : null;
      try {
        if(!item) throw new Rejected('invalid-event');
        const {event,task}=item;
        const prior=[...stored,...fresh.map(f=>f.event)].find(e=>e.eventId===event.eventId || e.commandId===event.commandId ||
          (event.kind==='answer' && e.kind==='answer' && e.attemptId===event.attemptId));
        if(prior) {
          if(!same(prior,event)) throw new Rejected('event-conflict');
          results.push({eventId,status:'duplicate'});continue;
        }
        if(event.dataEpoch!==state.dataEpoch) throw new Rejected('stale-epoch');
        if(event.target.kind!=='word') {
          // G3 (#332): items of a pinned dataset version, re-evaluated by the shared item adapters.
          const datasetVersion=record(task) && record(task.specification) ? task.specification.datasetVersion : undefined;
          if(typeof datasetVersion!=='string' || !datasetVersion) throw new Rejected('invalid-task');
          const items=await store.dataset(event.target.datasetId,datasetVersion);
          if(!items) throw new Rejected('unknown-dataset');
          let canonicalTask;
          try { canonicalTask=items.validateTask(task); } catch { throw new Rejected('invalid-task'); }
          try { core.bindItemEvent(items,canonicalTask,event); } catch { throw new Rejected('task-mismatch'); }
          const archived=tasks.get(canonicalTask.id) ?? fresh.find(f=>f.task.id===canonicalTask.id);
          if(archived && (!same(archived.task,canonicalTask) || (archived.sessionId ?? archived.event.sessionId)!==event.sessionId)) throw new Rejected('task-conflict');
          let evaluation;
          if(event.kind==='answer') {
            try { evaluation=core.evaluateItemAnswer(items,canonicalTask,event); } catch { throw new Rejected('invalid-answer'); }
          }
          // No word projection: an item never becomes word evidence.
          fresh.push({event,task:canonicalTask,...(evaluation ? {evaluation} : {})});
          results.push({eventId,status:'accepted'});continue;
        }
        const catalogVersion=record(task) && record(task.specification) ? task.specification.catalogVersion : undefined;
        if(typeof catalogVersion!=='string' || !catalogVersion) throw new Rejected('invalid-task');
        const registry=await store.catalog(catalogVersion);
        if(!registry) throw new Rejected('unknown-catalog');
        let canonicalTask;
        try { canonicalTask=registry.validateTask(task); } catch { throw new Rejected('invalid-task'); }
        if(event.taskId!==canonicalTask.id || !same(event.target,canonicalTask.target) || event.exerciseId!==canonicalTask.exerciseId ||
            event.taskVersion!==canonicalTask.taskVersion || event.contentVersion!==canonicalTask.contentVersion ||
            event.answerLanguage!==canonicalTask.specification.answerLanguage || event.policyVersion!==core.EVIDENCE_POLICY_VERSION ||
            (event.kind==='answer' && canonicalTask.exerciseId==='introduction') ||
            (event.kind==='introduction' && canonicalTask.exerciseId!=='introduction')) throw new Rejected('task-mismatch');
        const archived=tasks.get(canonicalTask.id) ?? fresh.find(f=>f.task.id===canonicalTask.id);
        if(archived && (!same(archived.task,canonicalTask) || (archived.sessionId ?? archived.event.sessionId)!==event.sessionId)) throw new Rejected('task-conflict');
        let evaluation;
        if(event.kind==='answer') {
          // Uploaded evaluations/solutions are never read: only the shared evaluator decides.
          try { evaluation=core.evaluateWordAnswer(registry,canonicalTask,event); } catch { throw new Rejected('invalid-answer'); }
        }
        fresh.push({event,task:canonicalTask,word:registry.getWord(event.target.wordId,event.contentVersion),
          ...(evaluation ? {evaluation} : {})});
        results.push({eventId,status:'accepted'});
      } catch(error) {
        if(!(error instanceof Rejected)) throw error;
        results.push({eventId,status:'rejected',reason:error.reason});
      }
    }
    // Replay each affected word from its complete journal; a calendar/identity
    // conflict rejects only that word's new events.
    const projections=[];
    for(const entry of state.words) {
      const added=fresh.filter(f=>f.event.target.wordId===entry.wordId);
      if(!added.length) continue;
      const word=[entry.word,...added.map(f=>f.word)].filter(Boolean).reduce((a,b)=>b.contentVersion>a.contentVersion ? b : a);
      try {
        const records=[...entry.facts,...added.map(f=>({event:f.event,receivedAt,...(f.evaluation ? {evaluation:f.evaluation} : {})}))]
          .map(f=>({...f,owner}));
        const replay=core.replayWord(word,records,{owner,dataEpoch:state.dataEpoch,epochStartedAt:state.epochStartedAt,asOf:receivedAt});
        projections.push({wordId:entry.wordId,expectedRevision:entry.revision,progress:replay.progress,
          replay:{version:replay.version,clockPolicyVersion:replay.clockPolicyVersion,quarantined:replay.quarantined,deferredEventIds:replay.deferredEventIds}});
      } catch(error) {
        if(!(error instanceof RangeError)) throw error;
        for(const f of added) {
          results[results.findIndex(r=>r.status==='accepted' && r.eventId===f.event.eventId)]={eventId:f.event.eventId,status:'rejected',reason:'projection-conflict'};
          fresh.splice(fresh.indexOf(f),1);
        }
      }
    }
    if(!fresh.length) return {journalRevision:state.journalRevision,results};
    try {
      const committed=await store.commit(userId,{dataEpoch:state.dataEpoch,receivedAt,
        events:fresh.map(f=>({event:f.event,task:f.task,...(f.evaluation ? {evaluation:f.evaluation} : {})})),projections});
      return {journalRevision:committed.journalRevision,results};
    } catch(error) {
      // Another commit changed a word in between: re-read and replay both answers.
      if(/** @type {Json} */ (error)?.code!=='40001' || attempt>=MAX_ATTEMPTS) throw error;
    }
  }
}

/** PostgREST adapter for the three service RPCs. Catalog snapshots are immutable and cached.
 * @param {{supabaseUrl:string,serviceKey:string,core:Json,fetcher?:typeof fetch}} options
 * @returns {Store}
 */
export function createRestStore({supabaseUrl,serviceKey,core,fetcher=fetch}) {
  const backend=new URL(supabaseUrl);
  const headers={apikey:serviceKey,'Content-Type':'application/json',Accept:'application/json',
    ...(serviceKey.split('.').length===3 ? {Authorization:`Bearer ${serviceKey}`} : {})};
  /** @param {string} name @param {Json} body */
  async function rpc(name,body) {
    const response=await fetcher(new URL(`/rest/v1/rpc/${name}`,backend),{method:'POST',headers,body:JSON.stringify(body)});
    const data=await response.json().catch(()=>null);
    if(!response.ok) throw Object.assign(new Error('RPC failed'),{code:data?.code});
    return data;
  }
  /** @type {Map<string,Promise<Json>>} */
  const catalogs=new Map();
  /** @type {Map<string,Promise<Json>>} */
  const datasets=new Map();
  return {
    state:(userId,ids)=>rpc('v2_learning_state',{p_user_id:userId,p_word_ids:ids.wordIds,p_task_ids:ids.taskIds,
      p_event_ids:ids.eventIds,p_command_ids:ids.commandIds,p_attempt_ids:ids.attemptIds}),
    catalog(version) {
      if(!catalogs.has(version)) catalogs.set(version,rpc('v2_catalog_snapshot',{p_catalog_version:version})
        .then(snapshot=>snapshot && core.createWordExerciseRegistry(snapshot.words,snapshot.catalogVersion))
        .catch(error=>{catalogs.delete(version);throw error;}));
      return /** @type {Promise<Json>} */ (catalogs.get(version));
    },
    dataset(datasetId,version) {
      const key=JSON.stringify([datasetId,version]);
      if(!datasets.has(key)) datasets.set(key,rpc('v2_item_dataset',{p_dataset_id:datasetId,p_version:version})
        .then(dataset=>dataset && core.createItemExerciseRegistry([dataset]))
        .catch(error=>{datasets.delete(key);throw error;}));
      return /** @type {Promise<Json>} */ (datasets.get(key));
    },
    commit:(userId,batch)=>rpc('v2_commit_learning',{p_user_id:userId,p_data_epoch:batch.dataEpoch,p_received_at:batch.receivedAt,
      p_events:batch.events,p_projections:batch.projections}),
  };
}

/**
 * @param {{supabaseUrl:string,publishableKey:string,allowedOrigins:string[],core:Json,store:Store,fetcher?:typeof fetch,now?:()=>string}} options
 */
export function createLearningEventsHandler({supabaseUrl,publishableKey,allowedOrigins,core,store,fetcher=fetch,now=()=>new Date().toISOString()}) {
  const backend=new URL(supabaseUrl);
  if(!publishableKey) throw new Error('Public API key required');
  const origins=new Set(allowedOrigins);
  /** @param {Request} request */
  return async request=>{
    const origin=request.headers.get('Origin');
    const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'};
    /** @param {number} status @param {Json} body */
    const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers});
    if(origin && !origins.has(origin)) return reply(403,{ok:false,error:'origin'});
    if(origin) Object.assign(headers,{'Access-Control-Allow-Origin':origin,
      'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS'});
    if(request.method==='OPTIONS') return new Response(null,{status:204,headers});
    if(request.method!=='POST') return reply(405,{ok:false,error:'method'});
    const authorization=request.headers.get('Authorization');
    if(!authorization?.startsWith('Bearer ')) return reply(401,{ok:false,error:'auth'});
    let userId;
    try {
      // The token is verified by Auth itself; any owner field in the body is ignored.
      const auth=await fetcher(new URL('/auth/v1/user',backend),{headers:{apikey:publishableKey,Authorization:authorization}});
      if(!auth.ok) return reply(401,{ok:false,error:'auth'});
      const user=await auth.json();
      if(typeof user?.id!=='string' || user.is_anonymous===true) return reply(401,{ok:false,error:'auth'});
      userId=user.id;
    } catch { return reply(503,{ok:false,error:'unavailable'}); }
    let body;
    try {
      const text=await request.text();
      if(new TextEncoder().encode(text).length>MAX_BODY_BYTES) return reply(413,{ok:false,error:'size'});
      body=JSON.parse(text);
    } catch { return reply(400,{ok:false,error:'body'}); }
    if(!record(body) || !Array.isArray(body.events) || !body.events.length || body.events.length>MAX_EVENTS) return reply(400,{ok:false,error:'body'});
    try {
      const result=await ingestLearningEvents({core,store,userId,items:body.events,now});
      return reply(200,{ok:true,...result});
    } catch(error) {
      const conflict=/** @type {Json} */ (error)?.code==='40001';
      return reply(conflict ? 409 : 503,{ok:false,error:conflict ? 'conflict' : 'unavailable'});
    }
  };
}
