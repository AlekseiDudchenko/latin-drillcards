import type { Lang } from '../i18n.js';
import { cardUiTranslations } from '../i18n.js';
import { createClozeCard, evaluateCloze, parseClozeTemplate, type ClozeAnswerKey, type ClozeCardDefinition,
  type ClozePresentation, type ClozeSlotResult } from './cloze-input.js';

// Standalone preview fixtures shaped like v1 gaps.json / passiv-gaps.json items. The adapters
// below are demo-only; the component itself receives a definition and never evaluates or saves.
interface Fixture { readonly definition: ClozeCardDefinition; readonly key: ClozeAnswerKey }
const PASSIV_BANK = ['wird', 'wurde', 'wurden', 'ist', 'war', 'worden', 'werden'];

function fromTemplate(id: string, template: string, answers: readonly (readonly string[])[], input: 'text' | 'choice',
  extra: Partial<ClozeCardDefinition> = {}, bank = PASSIV_BANK): Fixture {
  const { segments, slotIds } = parseClozeTemplate(template);
  const options = bank.map(label => ({ id: label, label }));
  const slots = slotIds.map(slotId => input === 'choice' ? { slotId, input, options } : { slotId, input });
  return { definition: { id, answerLang: 'la', segments, slots, ...extra },
    key: { accepted: Object.fromEntries(slotIds.map((slotId, index) => [slotId, answers[index]!])) } };
}
const passivPerfekt = (input: 'text' | 'choice') => fromTemplate(`pg_1_perf-${input}`, 'Das Gebäude ___ komplett renoviert ___.',
  [['ist'], ['worden']], input, { prompt: { text: 'Здание было полностью отремонтировано.', lang: 'ru' } });
const fixtures = {
  // Relative pronoun gap: one typed slot; "welcher" is an accepted alternative by the task rules.
  gap: fromTemplate('gap-1', 'Der Mann, ___ neben uns wohnt, ist sehr nett.', [['der', 'welcher']], 'text'),
  passivChoice: passivPerfekt('choice'),
  passivText: passivPerfekt('text'),
  // The same option is the right answer for both slots.
  repeated: fromTemplate('pg-repeated', 'Die Fenster ___ geputzt, und die Türen ___ gestrichen.', [['wurden'], ['wurden']], 'choice',
    { prompt: { text: 'Окна помыли, а двери покрасили.', lang: 'ru' } }),
};
type Mode = keyof typeof fixtures;

let language: Lang = 'ru';
let mode: Mode = 'gap';
let presentation: ClozePresentation;
let card: ReturnType<typeof createClozeCard>;
const host = document.getElementById('card')!;
const demoLabels: Record<Lang, string[]> = {
  ru: ['Язык интерфейса', 'Пропуск', 'Passiv · выбор', 'Passiv · ввод', 'Повтор варианта', 'Ещё раз', 'Сменить тему', 'Задания'],
  en: ['Interface language', 'Gap', 'Passive · choice', 'Passive · typing', 'Repeated option', 'Try again', 'Switch theme', 'Tasks'],
  de: ['Sprache der Oberfläche', 'Lücke', 'Passiv · Auswahl', 'Passiv · Eingabe', 'Wiederholte Option', 'Noch einmal', 'Design wechseln', 'Aufgaben'],
};
function localize() {
  const labels = demoLabels[language]; document.documentElement.lang = language;
  document.getElementById('languageLabel')!.textContent = labels[0]!;
  ['gap', 'passivChoice', 'passivText', 'repeated', 'restart'].forEach((id, index) => { document.getElementById(id)!.textContent = labels[index + 1]!; });
  document.getElementById('theme')!.setAttribute('aria-label', labels[6]!);
  document.querySelector('nav')!.setAttribute('aria-label', labels[7]!);
}
function mount() {
  card?.dispose();
  const { definition, key } = fixtures[mode];
  presentation = { language };
  card = createClozeCard(host, definition, presentation, {
    onSubmit({ values }) {
      const evaluation = evaluateCloze(definition, key, values);
      const slotResults: Record<string, ClozeSlotResult> = {};
      for (const slot of definition.slots) {
        const outcome = evaluation.slots[slot.slotId]!;
        const answer = key.accepted[slot.slotId]![0]!;
        const expected = slot.input === 'choice' ? slot.options.find(option => option.id === answer)?.label : answer;
        slotResults[slot.slotId] = outcome === 'correct' ? { outcome } : { outcome, expected };
      }
      presentation = { ...presentation, slotResults, feedback: { kind: evaluation.correct ? 'correct' : 'incorrect' } };
      card.setPresentation(presentation);
    },
  }, undefined, { labels: cardUiTranslations });
  (Object.keys(fixtures) as Mode[]).forEach(id => document.getElementById(id)!.setAttribute('aria-pressed', String(id === mode)));
}
for (const id of Object.keys(fixtures) as Mode[]) document.getElementById(id)!.addEventListener('click', () => { mode = id; mount(); });
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
