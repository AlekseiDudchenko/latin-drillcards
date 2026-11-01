import { createWordExerciseRegistry, type Word, type Evaluation, type WordExerciseId, type WordExerciseTask } from './core/index.js';
import { cardUiTranslations, type Lang } from '../i18n.js';
import { createCardShell } from './card-shell.js';
import { wordTaskCard, wordTaskPresentation, wordExerciseUnavailable, wordTaskFeedback } from './word-task-card.js';

// Preview-only published-model fixtures; catalog ingestion is a separate task.
const catalog: Word[] = [
  ['tisch', 'Tisch', 'der', 'стол', 'table'], ['stuhl', 'Stuhl', 'der', 'стул', 'chair'],
  ['fenster', 'Fenster', 'das', 'окно', 'window'], ['tuer', 'Tür', 'die', 'дверь', 'door'],
].map(([id, lemma, article, ru, en]) => ({ schemaVersion: 1, contentVersion: 1, id, lemma, article: article as Word['article'],
  partOfSpeech: 'noun', senseId: 'preview', meanings: { ru: { preferred: ru, accepted: [ru] }, en: { preferred: en, accepted: [en] } },
  acceptedForms: [lemma], tags: ['home'], examples: [] }));
const registry = createWordExerciseRegistry(catalog, 'preview/1');
let task: WordExerciseTask;
let card: ReturnType<typeof createCardShell> | undefined;
let language: Lang = 'ru';
let phase: 'question' | 'feedback' = 'question';
let feedback: Evaluation | undefined;
const host = document.getElementById('card')!;
const mode = document.getElementById('exercise') as HTMLSelectElement;
const translation = document.getElementById('translation') as HTMLSelectElement;
function localize() {
  const labels = { ru: ['Упражнение', 'Язык перевода', 'Язык интерфейса', 'Ещё раз'],
    en: ['Exercise', 'Translation language', 'Interface language', 'Try again'],
    de: ['Übung', 'Übersetzungssprache', 'Sprache der Oberfläche', 'Noch einmal'] }[language];
  ['exerciseLabel', 'translationLabel', 'languageLabel', 'restart'].forEach((id, index) => { document.getElementById(id)!.textContent = labels[index]; });
  mode.options[0].textContent = `DE → ${translation.value.toUpperCase()}`;
  mode.options[1].textContent = `${translation.value.toUpperCase()} → DE`;
  mode.options[2].textContent = cardUiTranslations(language).revealTitle;
  mode.options[3].textContent = cardUiTranslations(language).introductionTitle;
  mode.options[4].textContent = cardUiTranslations(language).wordTypeTitle;
  mode.options[5].textContent = cardUiTranslations(language).articleTitle;
  mode.options[6].textContent = cardUiTranslations(language).wordArticleTypeTitle;
}
function mount() {
  localize();
  card?.dispose(); phase = 'question'; feedback = undefined;
  const definition = registry.get(mode.value);
  const context = { taskId: `preview-${mode.value}-${translation.value}`, seed: 'preview', answerLanguage: translation.value as 'ru' | 'en' };
  const availability = registry.availability(mode.value as WordExerciseId, catalog[0], context);
  if (!availability.available) { host.textContent = wordExerciseUnavailable(availability.reason, language); return; }
  task = definition.buildTask(catalog[0], context) as WordExerciseTask;
  // Production Runner records introduction before rendering this permitted state.
  card = createCardShell(host, wordTaskCard(registry, task), wordTaskPresentation(task, language, phase), {
    onReveal() {}, onSpeech() {},
    onContinue() {},
    onSubmit({ value }) {
      const result = definition.evaluate(task, value);
      phase = 'feedback'; feedback = result;
      card!.setPresentation({ ...wordTaskPresentation(task, language, phase), feedback: wordTaskFeedback(task, feedback, language) });
    },
  });
}
mode.addEventListener('change', mount); translation.addEventListener('change', mount);
document.getElementById('language')!.addEventListener('change', event => {
  language = (event.target as HTMLSelectElement).value as Lang; document.documentElement.lang = language;
  localize();
  if (card) card.setPresentation({ ...wordTaskPresentation(task, language, phase), ...(feedback ? { feedback: wordTaskFeedback(task, feedback, language) } : {}) });
});
document.getElementById('restart')!.addEventListener('click', mount);
window.addEventListener('pagehide', () => card?.dispose(), { once: true }); mount();
