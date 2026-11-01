import type { Task, Evaluation, WordExerciseRegistry, WordExerciseTask, UnavailableReason } from '../../../packages/vocabulary-core/dist/index.js';
import { cardUiTranslations, type Lang } from '../i18n.js';
import type { CardDefinition, CardPresentation } from './card-shell.js';

/** Pure view mapping. The consumer must commit an introduction event before mounting it. */
export function wordTaskCard(registry: WordExerciseRegistry, source: Task): CardDefinition {
  const task = registry.validateTask(source);
  if (task.target.kind !== 'word') throw new RangeError('Not a word task');
  const word = registry.getWord(task.target.wordId, task.contentVersion);
  const spec = task.specification;
  const input = task.exerciseId === 'introduction' ? { kind: 'introduction' as const }
    : task.input === 'choice' ? { kind: 'choice' as const, answerLang: spec.answer.lang, options: spec.options.map(option => ({ id: option.id, label: option.label })) }
      : task.input === 'text' ? { kind: 'text' as const, answerLang: 'la' }
      : { kind: 'reveal' as const, answer: spec.answer.text, answerLang: spec.answer.lang };
  const titleKey = task.exerciseId === 'target-type' ? 'wordTypeTitle' : task.exerciseId === 'target-with-article-type' ? 'wordArticleTypeTitle' : task.exerciseId === 'article-choice' ? 'articleTitle' : undefined;
  const title = titleKey ? Object.fromEntries((['en', 'ru', 'de'] as const).map(lang => [lang, cardUiTranslations(lang)[titleKey]])) as Record<Lang, string> : undefined;
  return { ...(title ? { title } : {}), id: task.id, prompt: spec.prompt, input, word, translationLanguage: spec.answerLanguage,
    speechText: [word.article, word.lemma].filter(Boolean).join(' '),
    // Introduction and from German: read up front. Into German: read after a correct answer.
    autoSpeak: task.exerciseId === 'introduction' || task.exerciseId === 'meaning-choice' || task.exerciseId === 'meaning-recall' ? 'start' : 'correct' };
}

export function wordTaskPresentation(task: WordExerciseTask, language: Lang, phase: 'question' | 'feedback'): CardPresentation {
  const open = task.exerciseId === 'introduction' || phase === 'feedback';
  return { language, permissions: { reveal: task.exerciseId === 'meaning-recall', details: open,
    speech: open || task.exerciseId === 'meaning-choice' || task.exerciseId === 'meaning-recall' } };
}

export function wordExerciseUnavailable(reason: UnavailableReason, language: Lang): string {
  const labels = cardUiTranslations(language);
  return reason === 'article-not-applicable' ? labels.articleUnavailable : reason === 'missing-translation' ? labels.missingTranslation
    : reason === 'insufficient-options' ? labels.insufficientOptions : labels.exerciseUnavailable;
}

/** The shell displays this text only after the Runner accepts the answer. */
export function wordTaskFeedback(task: WordExerciseTask, evaluation: Evaluation, language: Lang): NonNullable<CardPresentation['feedback']> {
  const kind = evaluation.outcome === 'unobserved' ? 'info' : evaluation.outcome;
  if (!['target-type', 'target-with-article-type', 'article-choice'].includes(task.exerciseId)) return { kind };
  const labels = cardUiTranslations(language);
  const names = { recall: labels.recallComponent, spelling: labels.spellingComponent, article: labels.articleComponent };
  const components = (['recall', 'spelling', 'article'] as const).flatMap(component => {
    const outcome = evaluation.components[component];
    return outcome ? [`${names[component]}: ${labels[outcome]}`] : [];
  });
  return { kind, message: `${components.join(' · ')}. ${labels.expectedAnswer}: ${task.specification.answer.text}` };
}
