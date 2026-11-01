export type V2Environment = 'local' | 'preview' | 'production';
export interface ReadyEnvironment {
  readonly schemaVersion: 1; readonly configured: true; readonly environment: V2Environment;
  readonly supabaseUrl: string; readonly publishableKey: string; readonly siteUrl: string;
  readonly dataEpoch: string; readonly epochStartedAt: string;
}
export type PublicEnvironment = ReadyEnvironment | {
  readonly schemaVersion: 1; readonly configured: false; readonly environment: 'local';
};
const fields = ['schemaVersion','configured','environment','supabaseUrl','publishableKey','siteUrl','dataEpoch','epochStartedAt'];
const loopback = (host: string): boolean => ['localhost','127.0.0.1','[::1]'].includes(host);
function publicUrl(value: unknown): URL {
  if (typeof value !== 'string') throw new Error('Missing public URL');
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || !['http:','https:'].includes(url.protocol))
    throw new Error('Invalid public URL');
  return url;
}
/** Allowlisted public contract. Never copy a server environment or arbitrary JSON into the client. */
export function parseV2Environment(input: unknown): PublicEnvironment {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid v2 environment');
  const v = input as Record<string, unknown>;
  if (Object.keys(v).some(k => !fields.includes(k)) || v.schemaVersion !== 1) throw new Error('Invalid public configuration fields');
  if (v.configured === false && v.environment === 'local' && Object.keys(v).length === 3)
    return { schemaVersion: 1, configured: false, environment: 'local' };
  if (v.configured !== true || !['local','preview','production'].includes(String(v.environment))) throw new Error('Incomplete v2 environment');
  const backend = publicUrl(v.supabaseUrl); const site = publicUrl(v.siteUrl);
  if (backend.pathname !== '/') throw new Error('Use the project API origin');
  if (v.environment === 'local') {
    if (!loopback(backend.hostname) || !loopback(site.hostname)) throw new Error('Local environment needs loopback URLs');
  } else if (backend.protocol !== 'https:' || backend.port !== '' || site.protocol !== 'https:' ||
      !/^[a-z0-9]{20}\.supabase\.co$/.test(backend.hostname) || loopback(site.hostname)) {
    throw new Error('Hosted environment needs HTTPS and a v2 project URL');
  }
  if (!site.pathname.endsWith('/v2/')) throw new Error('Site URL must end with /v2/');
  if (typeof v.publishableKey !== 'string') throw new Error('Missing publishable key');
  if (!/^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(v.publishableKey)) {
    // Legacy anon JWTs are still supported locally; a service-role JWT is never public.
    try {
      const part = v.publishableKey.split('.')[1]!;
      const payload = JSON.parse(atob(part.replace(/-/g,'+').replace(/_/g,'/')));
      if (v.publishableKey.split('.').length !== 3 || payload.role !== 'anon') throw new Error();
    } catch { throw new Error('Only a publishable/anon key may enter the client'); }
  }
  if (typeof v.dataEpoch !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(v.dataEpoch) ||
      typeof v.epochStartedAt !== 'string' || !Number.isFinite(Date.parse(v.epochStartedAt)) ||
      new Date(v.epochStartedAt).toISOString() !== v.epochStartedAt) throw new Error('Invalid data epoch');
  return Object.freeze({ schemaVersion:1, configured:true, environment:v.environment as V2Environment,
    supabaseUrl:backend.origin, publishableKey:v.publishableKey, siteUrl:site.href,
    dataEpoch:v.dataEpoch, epochStartedAt:v.epochStartedAt });
}
export function v2Namespace(config: ReadyEnvironment): string {
  return `drillcards-v2:${config.environment}:${new URL(config.supabaseUrl).host}:${config.dataEpoch}`;
}
export const callbackUrl = (config: ReadyEnvironment): string => new URL('environment.html',config.siteUrl).href;
export function assertServerEnvironment(config: ReadyEnvironment, data: unknown): void {
  const server = data as Record<string, unknown> | null;
  if (!server || server.schema_version !== 1 || server.environment !== config.environment ||
      server.data_epoch !== config.dataEpoch || new Date(String(server.epoch_started_at)).toISOString() !== config.epochStartedAt)
    throw new Error('Client/server environment mismatch');
}
