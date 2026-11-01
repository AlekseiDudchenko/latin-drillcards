import { readFileSync,readdirSync,writeFileSync,mkdirSync,cpSync,rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { publicEnvironment } from './build-v2-environment.mjs';
import { buildSeed,loadSources,IDENTITIES_PATH } from './vocabulary-seed.mjs';
import { catalogSeedSql } from './catalog-bootstrap.mjs';
import { itemDatasetSql } from './item-dataset-sql.mjs';

const config=publicEnvironment(process.env);
if(!config.configured) throw new Error('Set the five public V2_* values before preparing deployment');
const root=`build/v2/${config.environment}`;
rmSync(root,{recursive:true,force:true});
const dir=`${root}/supabase`;
mkdirSync(dir,{recursive:true});
cpSync('supabase/v2/functions',`${dir}/functions`,{recursive:true});
// The intake function imports the same compiled core as the browser (npm run build first).
cpSync('packages/vocabulary-core/dist',`${dir}/functions/_shared/vocabulary-core`,{recursive:true});
cpSync('supabase/v2/transition/inventory.sql',`${root}/inventory.sql`);
cpSync('supabase/v2/transition/disable-v1.sql',`${root}/disable-v1.sql`);
const seed=buildSeed(JSON.parse(readFileSync(IDENTITIES_PATH,'utf8')),loadSources());
const ref=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
// Provenance URLs must describe the exact committed seed inputs, as in catalog:bootstrap.
const dirty=execFileSync('git',['status','--porcelain','--','public/data','content/vocabulary'],{encoding:'utf8'}).trim();
if(dirty) throw new Error(`Commit the seed sources first; uncommitted changes:\n${dirty}`);
const sql=val=>"E'"+val.replaceAll('\\','\\\\').replaceAll("'","''")+"'";
const load=path=>readFileSync(`supabase/v2/${path}`,'utf8');
const url=new URL(config.supabaseUrl);
const projectRef=url.hostname.endsWith('.supabase.co')?url.hostname.split('.')[0]:null;
writeFileSync(`${root}/transition.sql`,'BEGIN;\n'+load('transition/existing-project-preflight.sql')+'\n'+
  load('migrations/001_catalog.sql')+'\n'+load('migrations/002_environment.sql')+'\n'+catalogSeedSql(seed,{sourceRef:ref})+
  `INSERT INTO public.v2_environment(schema_version,environment,data_epoch,epoch_started_at) VALUES (1,${sql(config.environment)},${sql(config.dataEpoch)},${sql(config.epochStartedAt)});\nCOMMIT;\n`);
// S1 forward migration, applied after transition.sql (whose preflight refuses an existing catalog).
writeFileSync(`${root}/learning.sql`,'BEGIN;\n'+load('transition/learning-preflight.sql')+'\n'+load('migrations/003_learning.sql')+'\nCOMMIT;\n');
// G3 (#332): item targets on the same journal; applied after learning.sql, refuses a second run.
writeFileSync(`${root}/learning-items.sql`,'BEGIN;\n'+load('migrations/004_item_learning.sql')+'\nCOMMIT;\n');
// The item dataset versions the family pages load from public/data/items/: the intake rejects any other
// version (unknown-dataset), so publish exactly the deployed files. Idempotent; a changed file needs a new version.
const itemDatasets=readdirSync('public/data/items').filter(f=>f.endsWith('.json')).sort()
  .map(f=>JSON.parse(readFileSync(`public/data/items/${f}`,'utf8')));
writeFileSync(`${root}/item-datasets.sql`,itemDatasetSql(itemDatasets));
// A function-only CLI directory: no db migrations/seed or Auth config to push to
// the existing project. Database setup uses the reviewed one-time transaction.
writeFileSync(`${dir}/config.toml`,`project_id = "drillcards-v2-${config.environment}"
[functions.v2-health]
verify_jwt = false
[functions.v2-learning-events]
verify_jwt = false
`);
writeFileSync(`${dir}/functions.env.example`,`V2_ENVIRONMENT=${config.environment}\nV2_ALLOWED_ORIGINS=${new URL(config.siteUrl).origin}\n`);
writeFileSync(`${root}/transition.json`,JSON.stringify({schemaVersion:1,target:'existing-project',projectRef,
  supabaseUrl:config.supabaseUrl,commit:ref,catalogVersion:seed.catalogVersion,
  environment:config.environment,dataEpoch:config.dataEpoch,epochStartedAt:config.epochStartedAt,
  words:seed.words.length,decks:seed.decks.length,
  itemDatasets:itemDatasets.map(({id,version})=>({id,version})),preserveAuthUsers:true,preserveLegacyProgress:true,
  importLegacyProgress:false,legacyRuntime:'retired',disableLegacyApi:'disable-v1.sql',auth:{preserveGoogleProvider:true,preserveSiteUrl:true,addRedirect:new URL('environment.html',config.siteUrl).href},
  applyAutomatically:false},null,2)+'\n');
console.log(`Prepared ${root}: read-only inventory, additive transition, learning migrations, ${itemDatasets.length} item datasets, manifest and Edge Functions. No database or Auth changes performed.`);
