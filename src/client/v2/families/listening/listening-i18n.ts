import type { Lang } from '../../../i18n.js';

/** Listening (M2 / #334) labels; every key exists in EN, RU and DE. */
export interface ListeningUiTranslations {
  title: string; interfaceLanguage: string; translation: string; deck: string; allLevels: string; topic: string; allTopics: string;
  modeTokens: string; modeText: string; mode: string; promptTokens: string; promptText: string; play: string; playing: string;
  next: string; previous: string; tryAgain: string; autoSpeak: string; correct: string; wrong: string; translationHint: string;
  otherTranslations: string; explanation: string; stats: string; statsNew: string; poolStats: string; noData: string; loadError: string;
  saveError: string; retrySave: string; keyboard: string; level: string;
  ttsUnavailable: string; ttsNoGermanVoice: string; ttsFailed: string; ttsHelp: string;
}
const EN: ListeningUiTranslations = {
  title: 'Listening', interfaceLanguage: 'Interface language', translation: 'Translation language', deck: 'Level', allLevels: 'All levels A1–C2',
  topic: 'Topic', allTopics: 'All topics', mode: 'Answer by', modeTokens: 'Assembling', modeText: 'Typing',
  promptTokens: 'Listen and assemble the sentence', promptText: 'Listen and type the sentence', play: 'Play again', playing: 'Playing…',
  next: 'Next', previous: 'Previous', tryAgain: 'Try again', autoSpeak: 'Play each new sentence automatically', correct: 'Correct!',
  wrong: 'Not quite. Correct: {target}', translationHint: 'Translation', otherTranslations: 'Other translations', explanation: 'Explanation',
  stats: 'Listening this sentence: {answers} answers, {independent} right on the first try', statsNew: 'Listening this sentence: not answered yet',
  poolStats: 'This set ({mode}): {attempted} of {total} answered, accuracy {accuracy}', noData: 'No sentences for this filter.',
  loadError: 'Sentences could not be loaded.', saveError: 'The answer was not saved.', retrySave: 'Save again',
  keyboard: '← previous · → next · Enter: check, then next', level: 'Level {level}',
  ttsUnavailable: 'This browser cannot play speech. Open the page in a current Chrome, Edge or Safari, or set up speech output.',
  ttsNoGermanVoice: 'No German voice is installed. Add a German voice in your device settings, then press Play again.',
  ttsFailed: 'The audio could not be played. Press Play again.', ttsHelp: 'How to set up speech output',
};
const RU: ListeningUiTranslations = {
  title: 'Аудирование', interfaceLanguage: 'Язык интерфейса', translation: 'Язык перевода', deck: 'Уровень', allLevels: 'Все уровни A1–C2',
  topic: 'Тема', allTopics: 'Все темы', mode: 'Ответ', modeTokens: 'Сборка', modeText: 'Ввод',
  promptTokens: 'Прослушайте и соберите предложение', promptText: 'Прослушайте и напишите предложение', play: 'Прослушать ещё раз', playing: 'Звучит…',
  next: 'Дальше', previous: 'Назад', tryAgain: 'Ещё раз', autoSpeak: 'Проигрывать новое предложение сразу', correct: 'Верно!',
  wrong: 'Не совсем. Правильно: {target}', translationHint: 'Перевод', otherTranslations: 'Другие переводы', explanation: 'Объяснение',
  stats: 'Аудирование этого предложения: ответов {answers}, с первой попытки {independent}', statsNew: 'Аудирование этого предложения: ещё без ответа',
  poolStats: 'Этот набор ({mode}): отвечено {attempted} из {total}, точность {accuracy}', noData: 'Для этого фильтра нет предложений.',
  loadError: 'Не удалось загрузить предложения.', saveError: 'Ответ не сохранён.', retrySave: 'Сохранить ещё раз',
  keyboard: '← назад · → дальше · Enter: проверить, затем дальше', level: 'Уровень {level}',
  ttsUnavailable: 'Этот браузер не умеет озвучивать текст. Откройте страницу в актуальном Chrome, Edge или Safari или настройте озвучивание.',
  ttsNoGermanVoice: 'Немецкий голос не установлен. Добавьте его в настройках устройства и нажмите «Прослушать ещё раз».',
  ttsFailed: 'Не удалось воспроизвести звук. Нажмите «Прослушать ещё раз».', ttsHelp: 'Как настроить озвучивание',
};
const DE: ListeningUiTranslations = {
  title: 'Hörverstehen', interfaceLanguage: 'Sprache der Oberfläche', translation: 'Übersetzungssprache', deck: 'Niveau', allLevels: 'Alle Niveaus A1–C2',
  topic: 'Thema', allTopics: 'Alle Themen', mode: 'Antwort', modeTokens: 'Zusammensetzen', modeText: 'Tippen',
  promptTokens: 'Hör zu und setze den Satz zusammen', promptText: 'Hör zu und schreibe den Satz', play: 'Noch einmal hören', playing: 'Wird abgespielt…',
  next: 'Weiter', previous: 'Zurück', tryAgain: 'Noch einmal', autoSpeak: 'Neuen Satz sofort abspielen', correct: 'Richtig!',
  wrong: 'Nicht ganz. Richtig: {target}', translationHint: 'Übersetzung', otherTranslations: 'Weitere Übersetzungen', explanation: 'Erklärung',
  stats: 'Hörverstehen dieses Satzes: {answers} Antworten, {independent} beim ersten Versuch richtig', statsNew: 'Hörverstehen dieses Satzes: noch nicht beantwortet',
  poolStats: 'Diese Auswahl ({mode}): {attempted} von {total} beantwortet, Genauigkeit {accuracy}', noData: 'Keine Sätze für diesen Filter.',
  loadError: 'Die Sätze konnten nicht geladen werden.', saveError: 'Die Antwort wurde nicht gespeichert.', retrySave: 'Erneut speichern',
  keyboard: '← zurück · → weiter · Enter: prüfen, dann weiter', level: 'Niveau {level}',
  ttsUnavailable: 'Dieser Browser kann keinen Text vorlesen. Öffne die Seite in einem aktuellen Chrome, Edge oder Safari oder richte die Sprachausgabe ein.',
  ttsNoGermanVoice: 'Keine deutsche Stimme installiert. Füge sie in den Geräteeinstellungen hinzu und tippe dann auf „Noch einmal hören“.',
  ttsFailed: 'Der Ton konnte nicht abgespielt werden. Tippe auf „Noch einmal hören“.', ttsHelp: 'Sprachausgabe einrichten',
};
const TABLES: Record<Lang, ListeningUiTranslations> = { en: EN, ru: RU, de: DE };
export const listeningUiTranslations = (lang: Lang): ListeningUiTranslations => TABLES[lang];
