import type { Lang } from '../i18n.js';

/** How to install Latin DrillCards as an app on each kind of device (#420), DOM-free; install.html renders it. */
export type InstallPlatform = 'ios' | 'android' | 'desktop' | 'mac-safari';
export const INSTALL_PLATFORMS: readonly InstallPlatform[] = ['ios', 'android', 'desktop', 'mac-safari'];

export interface PlatformGuide { readonly title: string; readonly steps: readonly string[]; readonly note?: string }
export interface InstallGuide {
  readonly title: string; readonly lead: string; readonly install: string; readonly installed: string; readonly yourDevice: string;
  readonly platforms: Readonly<Record<InstallPlatform, PlatformGuide>>;
}

/** The device a visitor is on, from the user agent; iPadOS 13+ reports as a Mac, touch support tells them apart. */
export function installPlatform(userAgent: string, maxTouchPoints: number): InstallPlatform {
  if (/iphone|ipad|ipod/i.test(userAgent) || (/macintosh/i.test(userAgent) && maxTouchPoints > 1)) return 'ios';
  if (/android/i.test(userAgent)) return 'android';
  // Chrome, Edge, Opera and Firefox on a Mac install like on any computer; only Safari has its own menu.
  if (/macintosh/i.test(userAgent) && /safari/i.test(userAgent) && !/chrome|chromium|edg|opr|firefox/i.test(userAgent)) return 'mac-safari';
  return 'desktop';
}

/** The visitor's platform first, then the others in their usual order. */
export function platformOrder(current: InstallPlatform): readonly InstallPlatform[] {
  return [current, ...INSTALL_PLATFORMS.filter(platform => platform !== current)];
}

export const INSTALL_GUIDE: Readonly<Record<Lang, InstallGuide>> = {
  ru: {
    title: 'Скачать приложение',
    lead: 'Latin DrillCards можно установить как приложение: оно открывается с главного экрана или из Dock в отдельном окне и работает без интернета. Магазин приложений не нужен.',
    install: 'Установить', installed: 'Приложение уже установлено: вы открыли его с главного экрана.', yourDevice: 'Ваше устройство',
    platforms: {
      ios: { title: 'iPhone и iPad', steps: ['Откройте Latin DrillCards в Safari.', 'Нажмите «Поделиться» — квадрат со стрелкой.', 'Выберите «На экран „Домой“» и нажмите «Добавить».'] },
      android: { title: 'Android', steps: ['Откройте Latin DrillCards в Chrome.', 'Откройте меню ⋮ в правом верхнем углу.', 'Выберите «Установить приложение» или «Добавить на главный экран».'] },
      desktop: { title: 'Компьютер: Chrome и Edge', steps: ['Откройте Latin DrillCards в Chrome или Edge.', 'Нажмите значок установки в адресной строке или откройте меню браузера.', 'Выберите «Установить Latin DrillCards».'],
        note: 'Firefox на компьютере не устанавливает веб-приложения — откройте сайт в Chrome или Edge.' },
      'mac-safari': { title: 'Mac: Safari', steps: ['Откройте Latin DrillCards в Safari (macOS Sonoma или новее).', 'В меню «Файл» выберите «Добавить в Dock».'] },
    },
  },
  en: {
    title: 'Get the app',
    lead: 'Install Latin DrillCards as an app: it opens from your home screen or Dock in its own window and works offline. No app store needed.',
    install: 'Install', installed: 'The app is already installed: you opened it from your home screen.', yourDevice: 'Your device',
    platforms: {
      ios: { title: 'iPhone and iPad', steps: ['Open Latin DrillCards in Safari.', 'Tap Share — the square with an arrow.', 'Choose “Add to Home Screen”, then tap “Add”.'] },
      android: { title: 'Android', steps: ['Open Latin DrillCards in Chrome.', 'Open the ⋮ menu in the top right corner.', 'Choose “Install app” or “Add to Home screen”.'] },
      desktop: { title: 'Computer: Chrome and Edge', steps: ['Open Latin DrillCards in Chrome or Edge.', 'Click the install icon in the address bar, or open the browser menu.', 'Choose “Install Latin DrillCards”.'],
        note: 'Firefox on a computer cannot install web apps — open the site in Chrome or Edge.' },
      'mac-safari': { title: 'Mac: Safari', steps: ['Open Latin DrillCards in Safari (macOS Sonoma or later).', 'In the File menu, choose “Add to Dock”.'] },
    },
  },
  de: {
    title: 'App herunterladen',
    lead: 'Du kannst Latin DrillCards als App installieren: Sie startet vom Home-Bildschirm oder aus dem Dock in einem eigenen Fenster und funktioniert offline. Ein App Store ist nicht nötig.',
    install: 'Installieren', installed: 'Die App ist bereits installiert: Du hast sie vom Home-Bildschirm geöffnet.', yourDevice: 'Dein Gerät',
    platforms: {
      ios: { title: 'iPhone und iPad', steps: ['Öffne Latin DrillCards in Safari.', 'Tippe auf „Teilen“ – das Quadrat mit dem Pfeil.', 'Wähle „Zum Home-Bildschirm“ und tippe auf „Hinzufügen“.'] },
      android: { title: 'Android', steps: ['Öffne Latin DrillCards in Chrome.', 'Öffne das Menü ⋮ oben rechts.', 'Wähle „App installieren“ oder „Zum Startbildschirm hinzufügen“.'] },
      desktop: { title: 'Computer: Chrome und Edge', steps: ['Öffne Latin DrillCards in Chrome oder Edge.', 'Klicke auf das Installationssymbol in der Adressleiste oder öffne das Browsermenü.', 'Wähle „Latin DrillCards installieren“.'],
        note: 'Firefox kann auf dem Computer keine Web-Apps installieren – öffne die Seite in Chrome oder Edge.' },
      'mac-safari': { title: 'Mac: Safari', steps: ['Öffne Latin DrillCards in Safari (ab macOS Sonoma).', 'Wähle im Menü „Ablage“ den Befehl „Zum Dock hinzufügen“.'] },
    },
  },
};
