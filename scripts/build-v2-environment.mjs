import { mkdirSync,writeFileSync,copyFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseV2Environment } from '../public/v2/environment-config.js';

export function publicEnvironment(env) {
  const environment=env.DRILLCARDS_V2_ENV ?? 'local';
  const keys=['V2_SUPABASE_URL','V2_SUPABASE_PUBLISHABLE_KEY','V2_SITE_URL','V2_DATA_EPOCH','V2_EPOCH_STARTED_AT'];
  if(environment==='local' && keys.every(k=>!env[k])) return parseV2Environment({schemaVersion:1,configured:false,environment});
  return parseV2Environment({schemaVersion:1,configured:true,environment,supabaseUrl:env.V2_SUPABASE_URL,
    publishableKey:env.V2_SUPABASE_PUBLISHABLE_KEY,siteUrl:env.V2_SITE_URL,
    dataEpoch:env.V2_DATA_EPOCH,epochStartedAt:env.V2_EPOCH_STARTED_AT});
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const config=publicEnvironment(process.env);
  mkdirSync('public/v2/vendor',{recursive:true});
  copyFileSync('node_modules/@supabase/supabase-js/dist/umd/supabase.js','public/v2/vendor/supabase.js');
  copyFileSync('node_modules/@supabase/supabase-js/LICENSE','public/v2/vendor/SUPABASE-LICENSE');
  writeFileSync('public/v2/environment.json',JSON.stringify(config));
  console.log(`V2 public environment: ${config.environment}, ${config.configured?'configured':'not configured'}`);
}
