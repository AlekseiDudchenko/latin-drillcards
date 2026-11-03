import type { Lang } from '../i18n.js';

/** Chrome/Edge/Android fire `beforeinstallprompt`; iOS Safari never does and needs a manual "Share → Add to Home Screen" hint. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'install_dismissed';
const IOS_HINT_DELAY_MS = 4000;

const labels = {
  ru: { text: 'Установите Latin DrillCards — быстрый доступ и занятия офлайн.', ios: 'Чтобы установить: нажмите «Поделиться», затем «На экран „Домой“».', install: 'Установить', later: 'Позже' },
  en: { text: 'Install Latin DrillCards for quick access and offline practice.', ios: 'To install: tap the Share button, then “Add to Home Screen”.', install: 'Install', later: 'Not now' },
  de: { text: 'Installiere Latin DrillCards für schnellen Zugriff und Üben offline.', ios: 'Zum Installieren: auf „Teilen“ tippen, dann „Zum Home-Bildschirm“.', install: 'Installieren', later: 'Später' },
} satisfies Record<Lang, Record<string, string>>;

export function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}
function isDismissed(): boolean { try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; } }
function remember(): void { try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* storage blocked: the banner may return */ } }

function isIosSafari(): boolean {
  const ua = navigator.userAgent;
  // iPadOS 13+ reports as a Mac; touch support tells them apart.
  const device = /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  return device && /safari/i.test(ua) && !/crios|fxios|edgios/i.test(ua);
}

// The browser's install offer, shared by the banner and the footer's "Get the app" link (#420): the link
// still installs after the banner was dismissed, and either one using the offer closes the banner.
let offer: BeforeInstallPromptEvent | null = null;
const watchers = new Set<() => void>();
const notify = () => { for (const watcher of watchers) watcher(); };
function onPrompt(event: Event): void { event.preventDefault(); offer = event as BeforeInstallPromptEvent; notify(); }
function onInstalled(): void { offer = null; remember(); notify(); }

/** Keeps the browser's install offer while anyone watches; `onChange` runs when it arrives, is used, or the app gets installed. */
export function watchInstallOffer(onChange: () => void): () => void {
  if (!watchers.size) { window.addEventListener('beforeinstallprompt', onPrompt); window.addEventListener('appinstalled', onInstalled); }
  watchers.add(onChange);
  return () => {
    watchers.delete(onChange);
    if (!watchers.size) { window.removeEventListener('beforeinstallprompt', onPrompt); window.removeEventListener('appinstalled', onInstalled); }
  };
}

export const hasInstallOffer = (): boolean => offer !== null;

/** Opens the browser's install dialog; false when the browser offers none (iOS, Firefox, or the offer was used). */
export async function promptInstall(): Promise<boolean> {
  const event = offer; if (!event) return false;
  offer = null; notify();
  await event.prompt();
  await event.userChoice.catch(() => undefined);
  remember();
  return true;
}

/** A dismissible install banner on every v2 page, never shown when already installed or after "Not now". Returns its cleanup. */
export function mountInstallPrompt(): () => void {
  if (isStandalone() || isDismissed()) return () => {};
  let banner: HTMLElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let mode: 'prompt' | 'ios' = 'prompt';

  const copy = () => { const lang = document.documentElement.lang as Lang; return labels[lang in labels ? lang : 'ru']; };
  function close(): void { banner?.remove(); banner = null; }

  function render(): void {
    if (!banner) return;
    const t = copy();
    banner.querySelector('.install-text')!.textContent = mode === 'ios' ? t.ios : t.text;
    const accept = banner.querySelector<HTMLButtonElement>('.install-accept')!;
    accept.textContent = t.install; accept.hidden = mode !== 'prompt';
    banner.querySelector('.install-dismiss')!.textContent = t.later;
  }

  function show(next: 'prompt' | 'ios'): void {
    mode = next;
    if (banner) { render(); return; }
    banner = document.createElement('div'); banner.id = 'install-banner'; banner.className = 'install-banner';
    banner.setAttribute('role', 'dialog'); banner.setAttribute('aria-label', 'Latin DrillCards');
    const text = document.createElement('span'); text.className = 'install-text';
    const actions = document.createElement('span'); actions.className = 'install-actions';
    const accept = document.createElement('button'); accept.type = 'button'; accept.className = 'install-accept';
    const dismiss = document.createElement('button'); dismiss.type = 'button'; dismiss.className = 'install-dismiss';
    actions.append(accept, dismiss); banner.append(text, actions);
    dismiss.addEventListener('click', () => { remember(); close(); });
    accept.addEventListener('click', () => { void promptInstall(); });
    document.body.append(banner); render();
  }

  // The offer arrived: offer it; it was used here or from the footer, or the app got installed: nothing left to offer.
  const unwatch = watchInstallOffer(() => { if (hasInstallOffer()) show('prompt'); else if (mode === 'prompt') close(); });
  // Pages set <html lang> when the interface language changes.
  const observer = new MutationObserver(render);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  // iOS never fires the event: surface the manual hint once the visitor has stayed a little.
  if (isIosSafari()) timer = setTimeout(() => { if (!isStandalone() && !isDismissed()) show('ios'); }, IOS_HINT_DELAY_MS);

  return () => { clearTimeout(timer); observer.disconnect(); unwatch(); close(); };
}
