import type { Lang } from '../i18n.js';
import { openPageLearning, type AccountControls, type PageLearning } from './learning-context.js';
import { mountSiteNav } from './site-nav.js';
import { mountSiteFooter } from './site-footer.js';
import { mountInstallPrompt } from './install-prompt.js';

/** R1a (#325): the topmost line of every hosted v2 page — the Google photo and the sign-in / sign-out button. */
const labels = {
  ru: { guest: 'Гость: прогресс хранится только на этом устройстве.', account: 'Вы вошли: прогресс синхронизируется между устройствами.',
    loading: 'Загрузка…', error: 'Не удалось выполнить действие. Попробуйте ещё раз.', login: 'Войти', logout: 'Выйти', photo: 'Аккаунт Google', rejected: 'Сервер не принял ответов: {n}. Они не учитываются в прогрессе.', rejectedOk: 'Понятно' },
  en: { guest: 'Guest: progress is kept on this device only.', account: 'Signed in: progress syncs across your devices.',
    loading: 'Loading…', error: 'Could not complete the action. Please try again.', login: 'Sign in', logout: 'Sign out', photo: 'Google account', rejected: 'Answers refused by the server: {n}. They do not count towards progress.', rejectedOk: 'Got it' },
  de: { guest: 'Gast: Der Fortschritt bleibt nur auf diesem Gerät.', account: 'Angemeldet: Der Fortschritt wird zwischen deinen Geräten synchronisiert.',
    loading: 'Wird geladen…', error: 'Die Aktion ist fehlgeschlagen. Bitte erneut versuchen.', login: 'Anmelden', logout: 'Abmelden', photo: 'Google-Konto', rejected: 'Vom Server abgelehnte Antworten: {n}. Sie zählen nicht zum Fortschritt.', rejectedOk: 'Verstanden' },
} satisfies Record<Lang, Record<string, string>>;

/** Mounted before the page's <main>; follows the page's interface language through <html lang>. */
export function mountAccountBar(account: AccountControls): () => void {
  const bar = document.createElement('div'); bar.className = 'dc-account'; bar.id = 'account';
  // The state text is for assistive technology only; sighted users get the photo and the button.
  const status = document.createElement('p'); status.id = 'account-status'; status.className = 'dc-visually-hidden'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const photo = document.createElement('img'); photo.id = 'account-photo'; photo.width = 32; photo.height = 32; photo.referrerPolicy = 'no-referrer';
  const login = document.createElement('button'); login.type = 'button'; login.id = 'account-login';
  const logout = document.createElement('button'); logout.type = 'button'; logout.id = 'account-logout';
  // Answers the server refused never count: say so once per new refusal instead of failing silently.
  const warning = document.createElement('p'); warning.id = 'account-sync-warning'; warning.className = 'dc-account-warning'; warning.setAttribute('role', 'alert');
  const warningText = document.createElement('span');
  const warningOk = document.createElement('button'); warningOk.type = 'button'; warningOk.id = 'account-sync-warning-ok';
  warning.append(warningText, ' ', warningOk);
  bar.append(status, photo, login, logout, warning);
  document.body.prepend(bar);
  let failed = false;
  const act = (action: () => Promise<void>) => { failed = false; action().catch(() => { failed = true; render(); }); render(); };

  function render(): void {
    const lang = document.documentElement.lang as Lang; const t = labels[lang in labels ? lang : 'ru'];
    const state = account.state; const signedIn = state.owner?.kind === 'account';
    status.textContent = failed || state.phase === 'error' ? t.error : state.phase === 'loading' ? t.loading : signedIn ? t.account : t.guest;
    login.textContent = t.login; logout.textContent = t.logout;
    login.hidden = signedIn || state.phase === 'error'; login.disabled = state.phase !== 'ready';
    // After a failed sign-out the account is still stored: offer the retry.
    logout.hidden = !signedIn; logout.disabled = state.phase === 'loading';
    photo.hidden = !signedIn || !state.avatarUrl;
    if (state.avatarUrl && photo.src !== state.avatarUrl) photo.src = state.avatarUrl;
    photo.alt = photo.title = t.photo;
    const rejected = signedIn ? state.sync?.rejected ?? 0 : 0;
    warning.hidden = rejected <= seenRejected(state.owner?.id);
    warningText.textContent = t.rejected.replace('{n}', String(rejected)); warningOk.textContent = t.rejectedOk;
  }
  const seenKey = (id: string | undefined) => `dc-v2-rejected-seen:${id ?? ''}`;
  function seenRejected(id: string | undefined): number {
    try { return Number(localStorage.getItem(seenKey(id))) || 0; } catch { return 0; }
  }
  warningOk.addEventListener('click', () => {
    const state = account.state;
    try { localStorage.setItem(seenKey(state.owner?.id), String(state.sync?.rejected ?? 0)); } catch { /* shown again next time */ }
    warning.hidden = true;
  });
  login.addEventListener('click', () => act(() => account.signIn()));
  logout.addEventListener('click', () => act(() => account.signOut()));
  // A new account state replaces the error of an earlier click.
  const unsubscribe = account.subscribe(() => { failed = false; render(); });
  const observer = new MutationObserver(render);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  render();
  return () => { unsubscribe(); observer.disconnect(); bar.remove(); };
}

/** Every v2 page starts here: its learning store and catalog, plus the account bar on a hosted build. */
export async function openLearningPage(): Promise<PageLearning> {
  // The section bar and the footer do not depend on the learning store: they show even when opening the store fails.
  const unmountNav = mountSiteNav();
  const unmountFooter = mountSiteFooter();
  const unmountInstall = mountInstallPrompt();
  let learning: PageLearning;
  try { learning = await openPageLearning(); } catch (error) { unmountNav(); unmountFooter(); unmountInstall(); throw error; }
  if (!learning.account) return { ...learning, dispose: () => { unmountInstall(); unmountFooter(); unmountNav(); learning.dispose(); } };
  const unmount = mountAccountBar(learning.account);
  return { ...learning, dispose: () => { unmount(); unmountInstall(); unmountFooter(); unmountNav(); learning.dispose(); } };
}
