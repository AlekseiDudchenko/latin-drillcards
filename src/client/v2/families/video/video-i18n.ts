import type { Lang } from '../../../i18n.js';

/** Video (M6 / #338) labels; every key exists in EN, RU and DE. */
export interface VideoUiTranslations {
  title: string; interfaceLanguage: string; translation: string; video: string; task: string; viewDictation: string; viewSentences: string;
  mode: string; modeTokens: string; modeText: string; promptTokens: string; promptText: string; dictationTitle: string;
  replay: string; next: string; previous: string; tryAgain: string; restart: string; finished: string; segment: string; shorts: string;
  correct: string; wrong: string; translationHint: string; otherTranslations: string; stats: string; statsNew: string; videoStats: string;
  noAssembly: string; noData: string; loadError: string; saveError: string; retrySave: string; keyboard: string; level: string;
  mediaLoading: string; mediaOffline: string; mediaUnavailable: string; mediaFailed: string; mediaRetry: string; speakFallback: string;
  speakFailed: string;
}
const EN: VideoUiTranslations = {
  title: 'Video', interfaceLanguage: 'Interface language', translation: 'Translation language', video: 'Video', task: 'Task',
  viewDictation: 'Dictation', viewSentences: 'Sentences', mode: 'Answer by', modeTokens: 'Assembling', modeText: 'Typing',
  promptTokens: 'Watch the clip and assemble the phrase', promptText: 'Watch the clip and type the phrase', dictationTitle: 'Video dictation',
  replay: 'Replay clip', next: 'Next', previous: 'Previous', tryAgain: 'Try again', restart: 'Start over', finished: 'All clips done!',
  segment: 'Clip {n} of {total}', shorts: 'Shorts', correct: 'Correct!', wrong: 'Not quite. Correct: {target}', translationHint: 'Translation',
  otherTranslations: 'Other translations', stats: 'This clip: {answers} answers, {independent} right on the first try', statsNew: 'This clip: not answered yet',
  videoStats: 'This video ({mode}): {attempted} of {total} answered, accuracy {accuracy}',
  noAssembly: 'This video has no translations, so only the dictation is available.', noData: 'This video has no clips.',
  loadError: 'The video data could not be loaded.', saveError: 'The answer was not saved.', retrySave: 'Save again',
  keyboard: 'R replay · ← previous · → next · Enter: check, then next', level: 'Level {level}',
  mediaLoading: 'Loading the video…', mediaOffline: 'No connection. YouTube videos play only online; the answers you give are saved.',
  mediaUnavailable: 'This video is not available on YouTube right now.', mediaFailed: 'The YouTube player could not be loaded.',
  mediaRetry: 'Load the video again', speakFallback: 'Listen with the speech voice', speakFailed: 'The speech voice is not available either.',
};
const RU: VideoUiTranslations = {
  title: 'Видео', interfaceLanguage: 'Язык интерфейса', translation: 'Язык перевода', video: 'Видео', task: 'Задание',
  viewDictation: 'Диктант', viewSentences: 'Предложения', mode: 'Ответ', modeTokens: 'Сборка', modeText: 'Ввод',
  promptTokens: 'Посмотрите фрагмент и соберите фразу', promptText: 'Посмотрите фрагмент и напишите фразу', dictationTitle: 'Видеодиктант',
  replay: 'Повторить фрагмент', next: 'Дальше', previous: 'Назад', tryAgain: 'Ещё раз', restart: 'Начать заново', finished: 'Все фрагменты пройдены!',
  segment: 'Фрагмент {n} из {total}', shorts: 'Shorts', correct: 'Верно!', wrong: 'Не совсем. Правильно: {target}', translationHint: 'Перевод',
  otherTranslations: 'Другие переводы', stats: 'Этот фрагмент: ответов {answers}, с первой попытки {independent}', statsNew: 'Этот фрагмент: ещё без ответа',
  videoStats: 'Это видео ({mode}): отвечено {attempted} из {total}, точность {accuracy}',
  noAssembly: 'У этого видео нет переводов, поэтому доступен только диктант.', noData: 'В этом видео нет фрагментов.',
  loadError: 'Не удалось загрузить данные видео.', saveError: 'Ответ не сохранён.', retrySave: 'Сохранить ещё раз',
  keyboard: 'R повтор · ← назад · → дальше · Enter: проверить, затем дальше', level: 'Уровень {level}',
  mediaLoading: 'Загрузка видео…', mediaOffline: 'Нет соединения. Видео YouTube воспроизводится только онлайн; ваши ответы сохраняются.',
  mediaUnavailable: 'Это видео сейчас недоступно на YouTube.', mediaFailed: 'Не удалось загрузить плеер YouTube.',
  mediaRetry: 'Загрузить видео снова', speakFallback: 'Прослушать синтезатором речи', speakFailed: 'Синтезатор речи тоже недоступен.',
};
const DE: VideoUiTranslations = {
  title: 'Video', interfaceLanguage: 'Sprache der Oberfläche', translation: 'Übersetzungssprache', video: 'Video', task: 'Aufgabe',
  viewDictation: 'Diktat', viewSentences: 'Sätze', mode: 'Antwort', modeTokens: 'Zusammensetzen', modeText: 'Tippen',
  promptTokens: 'Sieh dir den Ausschnitt an und setze den Satz zusammen', promptText: 'Sieh dir den Ausschnitt an und schreibe den Satz', dictationTitle: 'Videodiktat',
  replay: 'Ausschnitt wiederholen', next: 'Weiter', previous: 'Zurück', tryAgain: 'Noch einmal', restart: 'Von vorn', finished: 'Alle Ausschnitte geschafft!',
  segment: 'Ausschnitt {n} von {total}', shorts: 'Shorts', correct: 'Richtig!', wrong: 'Nicht ganz. Richtig: {target}', translationHint: 'Übersetzung',
  otherTranslations: 'Weitere Übersetzungen', stats: 'Dieser Ausschnitt: {answers} Antworten, {independent} beim ersten Versuch richtig', statsNew: 'Dieser Ausschnitt: noch nicht beantwortet',
  videoStats: 'Dieses Video ({mode}): {attempted} von {total} beantwortet, Genauigkeit {accuracy}',
  noAssembly: 'Dieses Video hat keine Übersetzungen, daher gibt es nur das Diktat.', noData: 'Dieses Video hat keine Ausschnitte.',
  loadError: 'Die Videodaten konnten nicht geladen werden.', saveError: 'Die Antwort wurde nicht gespeichert.', retrySave: 'Erneut speichern',
  keyboard: 'R wiederholen · ← zurück · → weiter · Enter: prüfen, dann weiter', level: 'Niveau {level}',
  mediaLoading: 'Video wird geladen…', mediaOffline: 'Keine Verbindung. YouTube-Videos laufen nur online; deine Antworten werden gespeichert.',
  mediaUnavailable: 'Dieses Video ist auf YouTube gerade nicht verfügbar.', mediaFailed: 'Der YouTube-Player konnte nicht geladen werden.',
  mediaRetry: 'Video neu laden', speakFallback: 'Mit der Sprachausgabe anhören', speakFailed: 'Die Sprachausgabe ist auch nicht verfügbar.',
};
const TABLES: Record<Lang, VideoUiTranslations> = { en: EN, ru: RU, de: DE };
export const videoUiTranslations = (lang: Lang): VideoUiTranslations => TABLES[lang];
