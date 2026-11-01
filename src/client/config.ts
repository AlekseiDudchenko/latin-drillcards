export const IS_GH_PAGES: boolean = location.hostname.endsWith('github.io');

export function normalizePath(p: string): string {
  return p.endsWith('/') ? p : p + '/';
}

function detectBasePath(): string {
  const baseEl = document.querySelector('base[href]') as HTMLBaseElement | null;
  if (baseEl) {
    const href = baseEl.getAttribute('href')!;
    const path = new URL(href, location.origin).pathname;
    return normalizePath(path);
  }
  return IS_GH_PAGES ? '/latin-drillcards/' : '/';
}

export const BASE: string = detectBasePath();

export const ORIGIN_BASE: URL = new URL(BASE, location.origin);

export function url(p: string | URL): string {
  return new URL(p, ORIGIN_BASE).toString();
}

export function withBase(path: string): string {
  const normalized = path.startsWith('/') ? path.slice(1) : path;
  return (BASE + normalized).replace(/\/{2,}/g, '/');
}

export function stripBase(pathname: string): string {
  if (!BASE || BASE === '/') return pathname || '/';
  if (pathname.startsWith(BASE)) {
    const rest = pathname.slice(BASE.length);
    return rest ? (rest.startsWith('/') ? rest : '/' + rest) : '/';
  }
  return pathname || '/';
}

export function assetUrl(path: string): string {
  const trimmed = path.replace(/^\/+/, '');
  return new URL(trimmed, ORIGIN_BASE).toString();
}
export function isExternal(href: string): boolean {
  try {
    const u = new URL(href, location.href);
    return u.origin !== location.origin;
  } catch {
    return false;
  }
}
