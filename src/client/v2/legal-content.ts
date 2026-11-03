import type { Lang } from '../i18n.js';

/** Contacts and legal texts of the site (DOM-free): the footer links here; privacy.html and terms.html render the texts. */
export const CONTACT = {
  email: 'alexey.dudchenko@gmail.com',
  author: 'Aleksei Dudchenko',
  authorUrl: 'https://de.linkedin.com/in/alekseidudchenko',
} as const;

export interface Link { readonly href: string; readonly text: string }
/** Text runs and links; pages render them as text nodes, never as HTML. */
export type Paragraph = readonly (string | Link)[];
export interface LegalSection { readonly title: string; readonly body: Paragraph }
export interface LegalText { readonly title: string; readonly updated: string; readonly intro: string; readonly sections: readonly LegalSection[] }

export type LegalPageId = 'privacy' | 'terms';
export const LEGAL_PAGES: Readonly<Record<LegalPageId, string>> = { privacy: 'privacy.html', terms: 'terms.html' };

const mail: Link = { href: `mailto:${CONTACT.email}`, text: CONTACT.email };
const googleApiPolicy: Link = { href: 'https://developers.google.com/terms/api-services-user-data-policy', text: 'Google API Services User Data Policy' };
const privacyPage = (text: string): Link => ({ href: `./${LEGAL_PAGES.privacy}`, text });

export const LEGAL: Readonly<Record<LegalPageId, Readonly<Record<Lang, LegalText>>>> = {
  privacy: {
    ru: {
      title: 'Политика конфиденциальности', updated: 'Обновлено 3 ноября 2026 года',
      intro: 'Latin DrillCards — бесплатный тренажёр латинского языка. Здесь описано, какие данные обрабатывает приложение и зачем. Мы собираем только то, что нужно для его работы.',
      sections: [
        { title: 'Без аккаунта', body: ['Заниматься можно без входа. Тогда прогресс, настройки и язык интерфейса хранятся только в вашем браузере на этом устройстве (IndexedDB и localStorage) и нам не передаются.'] },
        { title: 'Вход через Google', body: ['Если вы входите через Google, мы получаем через Supabase Auth ваше имя, адрес электронной почты и фото профиля. Они нужны только для того, чтобы показать ваш аккаунт в приложении и связать с ним прогресс. Мы не продаём эти данные и не передаём их третьим лицам. Использование информации, полученной через API Google, соответствует ', googleApiPolicy, ', включая требования Limited Use.'] },
        { title: 'Синхронизация прогресса', body: ['Когда вы вошли, прогресс сохраняется в нашей базе данных (Supabase) и привязывается к аккаунту: какие задания вы выполняли, ваши ответы и их результат, время и часовой пояс каждого ответа, прогресс по каждому слову. Так можно продолжить занятия на другом устройстве.'] },
        { title: 'Хостинг и работа без интернета', body: ['Сайт размещён на Cloudflare Pages. Чтобы доставить страницы, Cloudflare обрабатывает технические данные, например IP-адрес. Файлы приложения сохраняются в браузере, чтобы оно работало без интернета.'] },
        { title: 'Озвучивание', body: ['Слова и предложения озвучивает синтез речи вашего устройства; некоторые браузеры отправляют текст для озвучивания на серверы своего разработчика.'] },
        { title: 'Cookie и аналитика', body: ['Latin DrillCards не использует cookie, аналитику и рекламные трекеры.'] },
        { title: 'Удаление данных', body: ['Вы можете выйти из аккаунта в любой момент — после этого ничего не синхронизируется. Чтобы удалить данные на устройстве, очистите данные сайта в настройках браузера. Чтобы удалить аккаунт и синхронизированный прогресс, напишите на ', mail, '.'] },
        { title: 'Контакты', body: ['Вопросы об этой политике присылайте на ', mail, '.'] },
      ],
    },
    en: {
      title: 'Privacy policy', updated: 'Last updated: 3 November 2026',
      intro: 'Latin DrillCards is a free Latin trainer. This policy explains which data the app processes and why. We collect only what it needs to work.',
      sections: [
        { title: 'Without an account', body: ['You can practise without signing in. Your progress, settings and interface language then stay in your browser on this device (IndexedDB and localStorage) and are not sent to us.'] },
        { title: 'Google sign-in', body: ['If you sign in with Google, we receive your name, email address and profile picture through Supabase Auth. We use them only to show your account in the app and to link your progress to it. We do not sell this data or share it with third parties. Our use of information received from Google APIs adheres to the ', googleApiPolicy, ', including the Limited Use requirements.'] },
        { title: 'Progress sync', body: ['When you are signed in, your progress is stored in our database (Supabase) and linked to your account: the exercises you did, your answers and their results, the time and time zone of each answer, and the progress of every word. This lets you continue on another device.'] },
        { title: 'Hosting and offline use', body: ['The site is hosted on Cloudflare Pages. To deliver the pages, Cloudflare processes technical data such as your IP address. The app keeps its files in your browser so that it works offline.'] },
        { title: 'Speech', body: ['Words and sentences are read aloud by your device’s speech synthesis; some browsers send the text to their vendor’s servers to do this.'] },
        { title: 'Cookies and analytics', body: ['Latin DrillCards does not use cookies, analytics or advertising trackers.'] },
        { title: 'Deleting your data', body: ['You can sign out at any time; after that nothing is synced. To delete the data on this device, clear the site data in your browser settings. To delete your account and synced progress, email ', mail, '.'] },
        { title: 'Contact', body: ['Send questions about this policy to ', mail, '.'] },
      ],
    },
    de: {
      title: 'Datenschutzerklärung', updated: 'Stand: 3. November 2026',
      intro: 'Latin DrillCards ist ein kostenloser Lateintrainer. Hier steht, welche Daten die App verarbeitet und wozu. Wir erheben nur, was für ihren Betrieb nötig ist.',
      sections: [
        { title: 'Ohne Konto', body: ['Sie können ohne Anmeldung üben. Dann bleiben Fortschritt, Einstellungen und Oberflächensprache nur in Ihrem Browser auf diesem Gerät (IndexedDB und localStorage) und werden nicht an uns übertragen.'] },
        { title: 'Anmeldung mit Google', body: ['Wenn Sie sich mit Google anmelden, erhalten wir über Supabase Auth Ihren Namen, Ihre E-Mail-Adresse und Ihr Profilbild. Wir nutzen sie nur, um Ihr Konto in der App anzuzeigen und Ihren Fortschritt damit zu verknüpfen. Wir verkaufen diese Daten nicht und geben sie nicht an Dritte weiter. Die Nutzung von Informationen aus Google-APIs entspricht der ', googleApiPolicy, ', einschließlich der Limited-Use-Anforderungen.'] },
        { title: 'Synchronisierung des Fortschritts', body: ['Wenn Sie angemeldet sind, wird Ihr Fortschritt in unserer Datenbank (Supabase) gespeichert und mit Ihrem Konto verknüpft: bearbeitete Aufgaben, Ihre Antworten und deren Ergebnis, Zeitpunkt und Zeitzone jeder Antwort sowie der Fortschritt je Wort. So können Sie auf einem anderen Gerät weiterlernen.'] },
        { title: 'Hosting und Offline-Nutzung', body: ['Die Website wird über Cloudflare Pages bereitgestellt. Um die Seiten auszuliefern, verarbeitet Cloudflare technische Daten wie Ihre IP-Adresse. Die App speichert ihre Dateien in Ihrem Browser, damit sie auch offline funktioniert.'] },
        { title: 'Sprachausgabe', body: ['Wörter und Sätze liest die Sprachsynthese Ihres Geräts vor; manche Browser senden den Text dafür an die Server ihres Herstellers.'] },
        { title: 'Cookies und Analyse', body: ['Latin DrillCards verwendet keine Cookies, keine Analysewerkzeuge und keine Werbe-Tracker.'] },
        { title: 'Löschung Ihrer Daten', body: ['Sie können sich jederzeit abmelden; danach wird nichts mehr synchronisiert. Um die Daten auf diesem Gerät zu löschen, entfernen Sie die Websitedaten in Ihren Browsereinstellungen. Um Ihr Konto und den synchronisierten Fortschritt löschen zu lassen, schreiben Sie an ', mail, '.'] },
        { title: 'Kontakt', body: ['Fragen zu dieser Datenschutzerklärung richten Sie bitte an ', mail, '.'] },
      ],
    },
  },
  terms: {
    ru: {
      title: 'Условия использования', updated: 'Обновлено 3 ноября 2026 года',
      intro: 'Эти условия действуют при использовании Latin DrillCards. Пользуясь приложением, вы их принимаете.',
      sections: [
        { title: 'Сервис', body: ['Latin DrillCards — бесплатный тренажёр для изучения латинского языка. Им можно пользоваться без аккаунта; вход через Google необязателен и нужен, чтобы синхронизировать прогресс между устройствами.'] },
        { title: 'Учебные материалы', body: ['Мы тщательно готовим слова, переводы, примеры и задания, но в них возможны ошибки. Приложение помогает учиться и не заменяет преподавателя, курс или экзамен.'] },
        { title: 'Добросовестное использование', body: ['Используйте приложение для личного обучения. Не мешайте его работе, не перегружайте его автоматическими запросами и не пытайтесь получить доступ к данным других пользователей.'] },
        { title: 'Аккаунт', body: ['За свой аккаунт Google отвечаете вы. Вы можете перестать пользоваться Latin DrillCards в любой момент и попросить удалить синхронизированные данные — см. ', privacyPage('Политику конфиденциальности'), '.'] },
        { title: 'Доступность и изменения', body: ['Latin DrillCards предоставляется бесплатно и «как есть». Мы можем менять, приостанавливать или прекращать работу приложения и отдельных функций и не гарантируем, что оно всегда доступно и работает без ошибок.'] },
        { title: 'Ответственность', body: ['Поскольку сервис бесплатный, мы отвечаем только за умысел и грубую неосторожность, если обязательные нормы закона не предусматривают иное.'] },
        { title: 'Изменение условий', body: ['Мы можем обновлять эти условия. Дата в начале страницы показывает действующую редакцию.'] },
        { title: 'Контакты', body: ['Вопросы присылайте на ', mail, '.'] },
      ],
    },
    en: {
      title: 'Terms of use', updated: 'Last updated: 3 November 2026',
      intro: 'These terms apply when you use Latin DrillCards. By using the app, you accept them.',
      sections: [
        { title: 'The service', body: ['Latin DrillCards is a free trainer for learning Latin. You can use it without an account; signing in with Google is optional and syncs your progress across devices.'] },
        { title: 'Learning content', body: ['We prepare words, translations, examples and exercises carefully, but they may contain mistakes. The app supports your learning and does not replace a teacher, a course or an exam.'] },
        { title: 'Fair use', body: ['Use the app for your own learning. Do not disrupt it, overload it with automated requests or try to access other users’ data.'] },
        { title: 'Your account', body: ['You are responsible for your Google account. You can stop using Latin DrillCards at any time and ask us to delete your synced data — see the ', privacyPage('Privacy policy'), '.'] },
        { title: 'Availability and changes', body: ['Latin DrillCards is provided free of charge and “as is”. We may change, pause or discontinue the app or any of its features, and we do not guarantee that it is always available or free of errors.'] },
        { title: 'Liability', body: ['As the service is free, we are liable only for intent and gross negligence, unless mandatory law provides otherwise.'] },
        { title: 'Changes to these terms', body: ['We may update these terms. The date at the top shows the version in force.'] },
        { title: 'Contact', body: ['Send questions to ', mail, '.'] },
      ],
    },
    de: {
      title: 'Nutzungsbedingungen', updated: 'Stand: 3. November 2026',
      intro: 'Diese Bedingungen gelten für die Nutzung von Latin DrillCards. Mit der Nutzung der App erkennen Sie sie an.',
      sections: [
        { title: 'Der Dienst', body: ['Latin DrillCards ist ein kostenloser Trainer zum Lateinlernen. Sie können ihn ohne Konto nutzen; die Anmeldung mit Google ist freiwillig und synchronisiert Ihren Fortschritt zwischen Ihren Geräten.'] },
        { title: 'Lerninhalte', body: ['Wir erstellen Wörter, Übersetzungen, Beispiele und Übungen sorgfältig, sie können aber Fehler enthalten. Die App unterstützt das Lernen und ersetzt keine Lehrkraft, keinen Kurs und keine Prüfung.'] },
        { title: 'Faire Nutzung', body: ['Nutzen Sie die App für Ihr eigenes Lernen. Stören Sie ihren Betrieb nicht, überlasten Sie sie nicht mit automatisierten Anfragen und versuchen Sie nicht, auf Daten anderer Nutzer zuzugreifen.'] },
        { title: 'Ihr Konto', body: ['Für Ihr Google-Konto sind Sie selbst verantwortlich. Sie können Latin DrillCards jederzeit nicht mehr nutzen und die Löschung Ihrer synchronisierten Daten verlangen – siehe ', privacyPage('Datenschutzerklärung'), '.'] },
        { title: 'Verfügbarkeit und Änderungen', body: ['Latin DrillCards wird kostenlos und „wie besehen“ bereitgestellt. Wir können die App oder einzelne Funktionen jederzeit ändern, pausieren oder einstellen und garantieren nicht, dass sie stets verfügbar und fehlerfrei ist.'] },
        { title: 'Haftung', body: ['Da der Dienst kostenlos ist, haften wir nur für Vorsatz und grobe Fahrlässigkeit, soweit zwingendes Recht nichts anderes vorsieht.'] },
        { title: 'Änderungen dieser Bedingungen', body: ['Wir können diese Bedingungen aktualisieren. Das Datum oben zeigt die geltende Fassung.'] },
        { title: 'Kontakt', body: ['Fragen richten Sie bitte an ', mail, '.'] },
      ],
    },
  },
};
