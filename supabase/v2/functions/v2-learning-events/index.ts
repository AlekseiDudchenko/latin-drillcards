// @deno-types="../_shared/vocabulary-core/index.d.ts"
import * as core from '../_shared/vocabulary-core/index.js';
import { createLearningEventsHandler, createRestStore } from './handler.js';
// `npm run v2:prepare` copies the compiled shared core into functions/_shared.
// The secret key stays in the function runtime; browsers never receive it.
const keys:Record<string,string>=JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') ?? '{}');
const publishableKey=keys.default ?? Object.values(keys)[0] ?? Deno.env.get('SUPABASE_ANON_KEY');
const secrets:Record<string,string>=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}');
const serviceKey=secrets.default ?? Object.values(secrets)[0] ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if(!publishableKey || !serviceKey) throw new Error('API keys required');
const supabaseUrl=Deno.env.get('SUPABASE_URL')!;
Deno.serve(createLearningEventsHandler({
  supabaseUrl,
  publishableKey,
  allowedOrigins:(Deno.env.get('V2_ALLOWED_ORIGINS') ?? '').split(',').filter(Boolean),
  core,
  store:createRestStore({supabaseUrl,serviceKey,core}),
}));
