/** Read-only deployment smoke. No service-role key, learning writes or raw errors.
 * @param {{supabaseUrl:string,publishableKey:string,environment:string,allowedOrigins:string[],fetcher?:typeof fetch}} options
 */
export function createHealthHandler({supabaseUrl,publishableKey,environment,allowedOrigins,fetcher=fetch}) {
  const backend=new URL(supabaseUrl);
  if(!['http:','https:'].includes(backend.protocol) || backend.username || backend.password || backend.pathname!=='/') throw new Error('Invalid backend');
  let publicKey=typeof publishableKey==='string' && /^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(publishableKey);
  if(!publicKey) {
    try { publicKey=publishableKey.split('.').length===3 &&
      JSON.parse(atob(publishableKey.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).role==='anon'; }
    catch { publicKey=false; }
  }
  if(!publicKey) throw new Error('Public API key required');
  if(!['local','preview','production'].includes(environment)) throw new Error('Environment required');
  const origins=new Set(allowedOrigins);
  /** @param {Request} request */
  return async request=>{
    const origin=request.headers.get('Origin');
    const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'};
    if(origin && !origins.has(origin)) return new Response(JSON.stringify({ok:false,error:'origin'}),{status:403,headers});
    if(origin) Object.assign(headers,{'Access-Control-Allow-Origin':origin,
      'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'GET,OPTIONS'});
    if(request.method==='OPTIONS') return new Response(null,{status:204,headers});
    if(request.method!=='GET') return new Response(JSON.stringify({ok:false,error:'method'}),{status:405,headers});
    const apiHeaders={apikey:publishableKey,Accept:'application/json'};
    const authorization=request.headers.get('Authorization');
    // Edge gateway verification is disabled for publishable keys; user identity
    // is checked with Auth itself, never by merely decoding a caller's JWT.
    const abort=new AbortController();const timer=setTimeout(()=>abort.abort(),8000);
    try {
      let signedIn=false;
      if(authorization) {
        if(!authorization.startsWith('Bearer ')) return new Response(JSON.stringify({ok:false,error:'auth'}),{status:401,headers});
        const auth=await fetcher(new URL('/auth/v1/user',backend),{headers:{...apiHeaders,Authorization:authorization},signal:abort.signal});
        if(!auth.ok) return new Response(JSON.stringify({ok:false,error:'auth'}),{status:401,headers});
        const user=await auth.json(); if(typeof user.id!=='string') throw new Error('Invalid Auth response');
        signedIn=true;
      }
      // Always read these as a guest: an authenticated success must not hide a
      // deployment that accidentally denies anonymous catalog access.
      const meta=await fetcher(new URL('/rest/v1/v2_environment?select=schema_version,environment,data_epoch,epoch_started_at',backend),{headers:apiHeaders,signal:abort.signal});
      const catalog=await fetcher(new URL('/rest/v1/catalog_words?select=id&limit=1',backend),{headers:apiHeaders,signal:abort.signal});
      if(!meta.ok || !catalog.ok) throw new Error('Catalog unavailable');
      const rows=await meta.json();const words=await catalog.json();const config=rows[0];
      if(rows.length!==1 || config.schema_version!==1 || config.environment!==environment || !/^[a-zA-Z0-9_-]{1,100}$/.test(config.data_epoch) || !Number.isFinite(Date.parse(config.epoch_started_at)) || !Array.isArray(words) || !words.length)
        throw new Error('Environment mismatch');
      return new Response(JSON.stringify({ok:true,signedIn,schemaVersion:1,environment:config.environment,
        dataEpoch:config.data_epoch,epochStartedAt:config.epoch_started_at}),{headers});
    } catch {return new Response(JSON.stringify({ok:false,error:'unavailable'}),{status:503,headers});}
    finally {clearTimeout(timer);}
  };
}
