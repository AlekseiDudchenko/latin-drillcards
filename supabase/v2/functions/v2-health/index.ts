import { createHealthHandler } from './handler.js';
// Publishable keys and legacy anon keys are public; this endpoint needs no admin key.
const keys:Record<string,string>=JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') ?? '{}');
const key=keys.default ?? Object.values(keys)[0] ?? Deno.env.get('SUPABASE_ANON_KEY');
if(!key) throw new Error('Public API key required');
Deno.serve(createHealthHandler({
  supabaseUrl:Deno.env.get('SUPABASE_URL')!,
  publishableKey:key,
  environment:Deno.env.get('V2_ENVIRONMENT')!,
  allowedOrigins:(Deno.env.get('V2_ALLOWED_ORIGINS') ?? '').split(',').filter(Boolean),
}));
