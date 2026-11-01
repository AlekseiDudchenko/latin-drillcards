import type { Lang } from '../../../i18n.js';

/** Level test (M8 / #340) labels; shared session and card labels come from i18n.ts. Every key exists in EN, RU and DE. */
export interface LevelTestUiTranslations {
  title: string; intro: string; translation: string; start: string; continueTitle: string; continueLine: string;
  progress: string; level: string; pick: string; correct: string; wrong: string; next: string; stop: string;
  resultTitle: string; resultLevel: string; startWith: string; retake: string; blockLine: string; passed: string; failed: string;
  stoppedEarly: string; incomplete: string; notProgress: string; lastResult: string; homeResult: string; takeTest: string;
  keyboard: string; loadError: string;
}
const EN: LevelTestUiTranslations = {
  title: 'Level test', intro: 'Four blocks of 10 words, A1 → B2. A block counts from 70 % correct; the test stops at the first block below that.',
  translation: 'Translation language', start: 'Start the test', continueTitle: 'Test in progress', continueLine: 'Question {n} of up to {max}.',
  progress: 'Question {n} / {max}', level: 'Level {level}', pick: 'Choose the translation', correct: 'Correct!', wrong: 'Wrong. Correct: {answer}',
  next: 'Next', stop: 'Stop the test', resultTitle: 'Your result', resultLevel: '≈ {level}', startWith: 'Start with {level}',
  retake: 'Take the test again', blockLine: '{correct}/{total}', passed: 'passed', failed: 'not passed',
  stoppedEarly: 'The test stopped after the first block below 70 %.', incomplete: 'The last test was stopped before the end: no result.',
  notProgress: 'The test does not change your word progress.', lastResult: 'Last result: ≈ {level} ({date}).',
  homeResult: 'Level test: ≈ {level}. Recommended start: {start}.', takeTest: 'Level test',
  keyboard: '1–4 choose · Enter check, then next', loadError: 'The level test could not be loaded.',
};
const RU: LevelTestUiTranslations = {
  title: 'Тест уровня', intro: 'Четыре блока по 10 слов, A1 → B2. Блок засчитан от 70 % верных; тест останавливается на первом блоке ниже порога.',
  translation: 'Язык перевода', start: 'Начать тест', continueTitle: 'Тест не закончен', continueLine: 'Вопрос {n} из максимум {max}.',
  progress: 'Вопрос {n} / {max}', level: 'Уровень {level}', pick: 'Выберите перевод', correct: 'Верно!', wrong: 'Неверно. Правильно: {answer}',
  next: 'Дальше', stop: 'Прервать тест', resultTitle: 'Ваш результат', resultLevel: '≈ {level}', startWith: 'Начать с {level}',
  retake: 'Пройти ещё раз', blockLine: '{correct}/{total}', passed: 'пройден', failed: 'не пройден',
  stoppedEarly: 'Тест остановлен после первого блока ниже 70 %.', incomplete: 'Последний тест прерван до конца: результата нет.',
  notProgress: 'Тест не меняет прогресс слов.', lastResult: 'Последний результат: ≈ {level} ({date}).',
  homeResult: 'Тест уровня: ≈ {level}. Рекомендуем начать с {start}.', takeTest: 'Тест уровня',
  keyboard: '1–4 выбор · Enter проверить, затем дальше', loadError: 'Не удалось загрузить тест уровня.',
};
const DE: LevelTestUiTranslations = {
  title: 'Einstufungstest', intro: 'Vier Blöcke mit je 10 Wörtern, A1 → B2. Ein Block zählt ab 70 % richtig; der Test endet beim ersten Block darunter.',
  translation: 'Übersetzungssprache', start: 'Test starten', continueTitle: 'Test läuft noch', continueLine: 'Frage {n} von höchstens {max}.',
  progress: 'Frage {n} / {max}', level: 'Niveau {level}', pick: 'Wähle die Übersetzung', correct: 'Richtig!', wrong: 'Falsch. Richtig: {answer}',
  next: 'Weiter', stop: 'Test abbrechen', resultTitle: 'Dein Ergebnis', resultLevel: '≈ {level}', startWith: 'Mit {level} beginnen',
  retake: 'Test wiederholen', blockLine: '{correct}/{total}', passed: 'bestanden', failed: 'nicht bestanden',
  stoppedEarly: 'Der Test endete nach dem ersten Block unter 70 %.', incomplete: 'Der letzte Test wurde vor dem Ende abgebrochen: kein Ergebnis.',
  notProgress: 'Der Test ändert deinen Wortfortschritt nicht.', lastResult: 'Letztes Ergebnis: ≈ {level} ({date}).',
  homeResult: 'Einstufungstest: ≈ {level}. Empfohlener Start: {start}.', takeTest: 'Einstufungstest',
  keyboard: '1–4 wählen · Enter prüfen, dann weiter', loadError: 'Der Einstufungstest konnte nicht geladen werden.',
};
const TABLES: Record<Lang, LevelTestUiTranslations> = { en: EN, ru: RU, de: DE };
export const levelTestUiTranslations = (lang: Lang): LevelTestUiTranslations => TABLES[lang];
export const fill = (template: string, values: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? '');
