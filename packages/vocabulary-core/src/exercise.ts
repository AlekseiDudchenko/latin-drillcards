import type { LearningTarget, TranslationLanguage, Word } from './content.js';
import type { Component } from './progress.js';

export type JsonValue = null | boolean | number | string | readonly JsonValue[] |
  { readonly [key: string]: JsonValue };
export type InputKind = 'choice' | 'text' | 'reveal' | 'tokens' | 'cloze';

export interface Task {
  readonly id: string;
  readonly target: LearningTarget;
  readonly exerciseId: string;
  readonly taskVersion: string;
  readonly contentVersion: number;
  readonly input: InputKind;
  readonly assessedComponents: readonly Component[];
  /** Versioned, exercise-specific prompt and answer specification; no HTML or callbacks. */
  readonly specification: JsonValue;
}

export interface Evaluation {
  readonly outcome: 'correct' | 'incorrect' | 'unobserved';
  readonly source: 'automatic' | 'self-assessment';
  readonly components: Readonly<Partial<Record<Component, 'correct' | 'incorrect' | 'unobserved'>>>;
}

export interface BuildContext {
  readonly answerLanguage: TranslationLanguage;
  readonly seed: string;
  readonly taskId: string;
}

/** Content adapters for other families use the same Task/Evaluation/Runner contract. */
export interface ExerciseDefinition<Content = Word> {
  readonly id: string;
  readonly version: string;
  isApplicable(content: Content, context: BuildContext): boolean;
  assessedComponents(content: Content): readonly Component[];
  buildTask(content: Content, context: BuildContext): Task;
  evaluate(task: Task, answer: JsonValue): Evaluation;
}
