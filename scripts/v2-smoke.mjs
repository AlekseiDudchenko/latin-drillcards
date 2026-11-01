import { pathToFileURL } from 'node:url';
import { publicEnvironment } from './build-v2-environment.mjs';
import { assertServerEnvironment } from '../public/v2/environment-config.js';

/** Optional access token stays in memory/headers and never enters artifacts or output. */
export async function smokeV2(config,{accessToken,fetcher=fetch}={}) {
  if(!config.configured) throw new Error('V2 is not configured');
  const headers={apikey:config.publishableKey,...(accessToken?{Authorization:`Bearer ${accessToken}`}:{})};
  const result=await fetcher(`${config.supabaseUrl}/functions/v1/v2-health`,{headers,signal:AbortSignal.timeout(12000)});
  if(!result.ok) throw new Error(`V2 smoke failed (HTTP ${result.status})`);
  const data=await result.json();
  assertServerEnvironment(config,{schema_version:data.schemaVersion,environment:data.environment,data_epoch:data.dataEpoch,epoch_started_at:data.epochStartedAt});
  if(data.ok!==true || data.signedIn!==Boolean(accessToken)) throw new Error('V2 smoke returned an unexpected result');
  return {ok:true,environment:config.environment,signedIn:data.signedIn};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {console.log(JSON.stringify(await smokeV2(publicEnvironment(process.env),{accessToken:process.env.V2_TEST_ACCESS_TOKEN})));}
  catch {console.error('V2 smoke failed. Check project, schema, function and login configuration.');process.exitCode=1;}
}
