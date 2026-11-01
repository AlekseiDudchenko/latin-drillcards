import type { Word } from '../../../packages/vocabulary-core/dist/index.js';
import type { Lang } from '../i18n.js';
import { createCardShell, type CardDefinition, type CardPresentation } from './card-shell.js';
import { konjunktivTokenCard, sentenceAssemblyCard } from './token-tasks.js';

// Standalone preview fixture, not a catalog publication or a production exercise evaluator.
const word: Word = { schemaVersion: 1, contentVersion: 1, id: 'preview-tisch', senseId: 'furniture',
  lemma: 'Tisch', partOfSpeech: 'noun', article: 'der', meanings: { ru: { preferred: 'стол', accepted: ['стол'] } },
  acceptedForms: ['Tisch'], tags: [], examples: [{ id: 'example', text: 'Der Tisch steht am Fenster.', translations: { ru: 'Стол стоит у окна.' } }] };
// Published records (sentences-a2.json s_a2_1, konjunktiv2-transformation.json k2t_002) in a fixed
// display order so the preview is reproducible; "ich" appears twice with distinct token IDs.
const sentence = sentenceAssemblyCard({ id: 's_a2_1', target: 'Weil ich heute Spätdienst habe, kann ich nicht kommen.',
  tokens: ['Weil', 'ich', 'heute', 'Spätdienst', 'habe,', 'kann', 'ich', 'nicht', 'kommen'],
  translation_en: 'Because I have a late shift today, I can’t come.', translation_ru: 'Так как у меня сегодня поздняя смена, я не могу прийти.' },
'ru', [6, 3, 0, 8, 1, 5, 2, 7, 4]);
const konjunktiv = konjunktivTokenCard({ id: 'k2t_002', sentence: 'Wenn er (kommen) ___, wäre ich froh.', tokens: ['käme', 'kommen', 'würde', 'kämen', 'kommt'] },
  'ru', [2, 0, 4, 1, 3]);
const definitions: Record<'choice' | 'text' | 'reveal' | 'sentence' | 'konjunktiv', CardDefinition> = {
  choice: { id: 'preview-choice', prompt: { text: 'стол', lang: 'ru' }, input: { kind: 'choice', answerLang: 'la', options: [
    { id: 'table', label: 'der Tisch' }, { id: 'chair', label: 'der Stuhl' }, { id: 'window', label: 'das Fenster' }, { id: 'door', label: 'die Tür' },
  ] }, word, translationLanguage: 'ru', speechText: 'der Tisch' },
  text: { id: 'preview-text', prompt: { text: 'стол', lang: 'ru' }, input: { kind: 'text', answerLang: 'la' }, word, translationLanguage: 'ru', speechText: 'der Tisch' },
  reveal: { id: 'preview-reveal', prompt: { text: 'der Tisch', lang: 'la' }, input: { kind: 'reveal', answer: 'стол', answerLang: 'ru' }, word, translationLanguage: 'ru', speechText: 'der Tisch' },
  sentence, konjunktiv,
};
const modes = ['choice', 'text', 'reveal', 'sentence', 'konjunktiv'] as const;
let language: Lang = 'ru';
let mode: keyof typeof definitions = 'choice';
let presentation: CardPresentation;
let card: ReturnType<typeof createCardShell>;
const host = document.getElementById('card')!;
const demoLabels = {
  ru: ['Язык интерфейса', 'Выбор', 'Ввод', 'Вспомнить', 'Ещё раз', 'Сменить тему', 'Карточки', 'Предложение', 'Konjunktiv II'],
  en: ['Interface language', 'Choice', 'Typing', 'Recall', 'Try again', 'Switch theme', 'Cards', 'Sentence', 'Konjunktiv II'],
  de: ['Sprache der Oberfläche', 'Auswahl', 'Eingabe', 'Erinnern', 'Noch einmal', 'Design wechseln', 'Karten', 'Satz', 'Konjunktiv II'],
};
function localize() {
  const labels = demoLabels[language]; document.documentElement.lang = language;
  document.getElementById('languageLabel')!.textContent = labels[0];
  ['choice', 'text', 'reveal', 'restart'].forEach((id, index) => { document.getElementById(id)!.textContent = labels[index + 1]; });
  document.getElementById('theme')!.setAttribute('aria-label', labels[5]);
  document.querySelector('nav')!.setAttribute('aria-label', labels[6]);
  document.getElementById('sentence')!.textContent = labels[7]; document.getElementById('konjunktiv')!.textContent = labels[8];
}
function mount() {
  card?.dispose();
  presentation = { language, permissions: { reveal: true, details: false, speech: mode === 'reveal' } };
  card = createCardShell(host, definitions[mode], presentation, {
    onReveal() {},
    onSpeech() {},
    onSubmit() {
      presentation = { ...presentation, permissions: { reveal: true, details: true, speech: true }, feedback: { kind: 'info' } };
      card.setPresentation(presentation);
    },
  });
  modes.forEach(id => document.getElementById(id)!.setAttribute('aria-pressed', String(id === mode)));
}
for (const id of modes) document.getElementById(id)!.addEventListener('click', () => { mode = id; mount(); });
document.getElementById('language')!.addEventListener('change', event => {
  language = (event.target as HTMLSelectElement).value as Lang;
  localize(); presentation = { ...presentation, language }; card.setPresentation(presentation);
});
document.getElementById('theme')!.addEventListener('click', () => {
  document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
});
document.getElementById('restart')!.addEventListener('click', mount);
window.addEventListener('pagehide', () => card.dispose(), { once: true });
localize(); mount();
