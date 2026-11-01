import type { Lang } from '../i18n.js';

/** Chrome/Edge/Android fire `beforeinstallprompt`; iOS Safari never does and needs a manual "Share → Add to Home Screen" hint. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'install_dismissed';
const IOS_HINT_DELAY_MS = 4000;

const labels = {
  ru: { text: 'Установите DrillCards — быстрый доступ и занятия офлайн.', ios: 'Чтобы установить: нажмите «Поделиться», затем «На экран „Домой“».', install: 'Установить', later: 'Позже' },
  en: { text: 'Install DrillCards for quick access and offline practice.', ios: 'To install: tap the Share button, then “Add to Home Screen”.', install: 'Install', later: 'Not now' },
  de: { text: 'Installiere DrillCards für schnellen Zugriff und Üben offline.', ios: 'Zum Installieren: auf „Teilen“ tippen, dann „Zum Home-Bildschirm“.', install: 'Installieren', later: 'Später' },
} satisfies Record<Lang, Record<string, string>>;

function isStandalone(): boolean {
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

/** A dismissible install banner on every v2 page, never shown when already installed or after "Not now". Returns its cleanup. */
export function mountInstallPrompt(): () => void {
  if (isStandalone() || isDismissed()) return () => {};
  let deferred: BeforeInstallPromptEvent | null = null;
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
    banner.setAttribute('role', 'dialog'); banner.setAttribute('aria-label', 'DrillCards');
    const text = document.createElement('span'); text.className = 'install-text';
    const actions = document.createElement('span'); actions.className = 'install-actions';
    const accept = document.createElement('button'); accept.type = 'button'; accept.className = 'install-accept';
    const dismiss = document.createElement('button'); dismiss.type = 'button'; dismiss.className = 'install-dismiss';
    actions.append(accept, dismiss); banner.append(text, actions);
    dismiss.addEventListener('click', () => { remember(); close(); });
    accept.addEventListener('click', async () => {
      const event = deferred; if (!event) return;
      deferred = null; close();
      await event.prompt();
      await event.userChoice.catch(() => undefined);
      remember();
    });
    document.body.append(banner); render();
  }

  const onPrompt = (event: Event) => { event.preventDefault(); deferred = event as BeforeInstallPromptEvent; show('prompt'); };
  const onInstalled = () => { remember(); close(); };
  window.addEventListener('beforeinstallprompt', onPrompt);
  window.addEventListener('appinstalled', onInstalled);
  // Pages set <html lang> when the interface language changes.
  const observer = new MutationObserver(render);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  // iOS never fires the event: surface the manual hint once the visitor has stayed a little.
  if (isIosSafari()) timer = setTimeout(() => { if (!isStandalone() && !isDismissed()) show('ios'); }, IOS_HINT_DELAY_MS);

  return () => {
    clearTimeout(timer); observer.disconnect();
    window.removeEventListener('beforeinstallprompt', onPrompt); window.removeEventListener('appinstalled', onInstalled);
    close();
  };
}
