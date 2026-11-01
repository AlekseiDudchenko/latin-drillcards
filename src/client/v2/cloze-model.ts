// Pure, DOM-free cloze (gap) model: definitions, slot state and per-slot evaluation.
// Knows nothing about grammar topics, SRS, storage or the server.

export interface ClozeOption { readonly id: string; readonly label: string }
export type ClozeSegment = { readonly kind: 'text'; readonly text: string } | { readonly kind: 'slot'; readonly slotId: string };
export type ClozeSlot =
  | { readonly slotId: string; readonly input: 'text' }
  | { readonly slotId: string; readonly input: 'choice'; readonly options: readonly ClozeOption[] };
export interface ClozeDefinition {
  readonly id: string;
  /** Content language of the sentence, options and typed answers. */
  readonly answerLang: string;
  readonly segments: readonly ClozeSegment[];
  /** Slot order is the focus and reading order; each slot appears exactly once in segments. */
  readonly slots: readonly ClozeSlot[];
}
export interface ClozeState {
  /** Raw draft per slotId: typed text, or the option ID for choice slots. */
  readonly values: Readonly<Record<string, string>>;
  readonly submitted: boolean;
}
export type SlotOutcome = 'correct' | 'incorrect';
/** Exercise-owned answer key. Text slots list accepted forms, choice slots accepted option IDs. */
export interface ClozeAnswerKey {
  readonly accepted: Readonly<Record<string, readonly string[]>>;
  /** Text comparison keeps case when true; default compares case-insensitively. */
  readonly caseSensitive?: boolean;
  /** Groups of slotIds whose accepted sets may be matched in any order (each set used once). */
  readonly interchangeable?: readonly (readonly string[])[];
}
export interface ClozeEvaluation {
  readonly slots: Readonly<Record<string, SlotOutcome>>;
  readonly correct: boolean;
  readonly correctCount: number;
  readonly total: number;
}

const MAX_GROUP = 6;

/** Splits a "Das ___ ist ___." template into segments with stable positional slot IDs. */
export function parseClozeTemplate(template: string, marker = '___'): { segments: ClozeSegment[]; slotIds: string[] } {
  if (!marker) throw new RangeError('Empty slot marker');
  const parts = template.split(marker);
  const segments: ClozeSegment[] = []; const slotIds: string[] = [];
  parts.forEach((text, index) => {
    if (text) segments.push({ kind: 'text', text });
    if (index < parts.length - 1) { const slotId = `slot-${index + 1}`; slotIds.push(slotId); segments.push({ kind: 'slot', slotId }); }
  });
  if (!slotIds.length) throw new RangeError('Template has no slots');
  return { segments, slotIds };
}

/** Deep copy plus structural checks; throws RangeError for an unusable definition. */
export function validateClozeDefinition(source: ClozeDefinition): ClozeDefinition {
  const slots = source.slots.map(slot => slot.input === 'choice'
    ? { slotId: slot.slotId, input: 'choice' as const, options: slot.options.map(option => ({ id: option.id, label: option.label })) }
    : { slotId: slot.slotId, input: 'text' as const });
  const definition: ClozeDefinition = { id: source.id, answerLang: source.answerLang,
    segments: source.segments.map(segment => ({ ...segment })), slots };
  if (!definition.id || !definition.answerLang || !slots.length) throw new RangeError('Invalid cloze definition');
  const ids = new Set<string>();
  for (const slot of slots) {
    if (!slot.slotId || ids.has(slot.slotId)) throw new RangeError('Slot IDs must be unique and non-empty');
    ids.add(slot.slotId);
    if (slot.input === 'choice' && (!slot.options.length || slot.options.some(option => !option.id || !option.label)
        || new Set(slot.options.map(option => option.id)).size !== slot.options.length)) throw new RangeError('Invalid slot options');
  }
  const order = definition.segments.flatMap(segment => segment.kind === 'slot' ? [segment.slotId] : []);
  if (order.length !== slots.length || order.some((slotId, index) => slotId !== slots[index]!.slotId))
    throw new RangeError('Each slot must appear exactly once in segments, in slot order');
  return definition;
}

export const emptyClozeState = (definition: ClozeDefinition): ClozeState =>
  ({ values: Object.fromEntries(definition.slots.map(slot => [slot.slotId, ''])), submitted: false });

const slotOf = (definition: ClozeDefinition, slotId: string) => definition.slots.find(slot => slot.slotId === slotId);
const filled = (value: string | undefined) => !!value && !!value.trim();

/** Normalizes a snapshot to every slot of the definition; throws on foreign slots or unknown options. */
export function validateClozeState(definition: ClozeDefinition, state: ClozeState): ClozeState {
  if (!state || typeof state.submitted !== 'boolean' || typeof state.values !== 'object' || state.values === null) throw new RangeError('Invalid cloze state');
  for (const slotId of Object.keys(state.values)) if (!slotOf(definition, slotId)) throw new RangeError(`Unknown slot ${slotId}`);
  const values: Record<string, string> = {};
  for (const slot of definition.slots) {
    const value = state.values[slot.slotId] ?? '';
    if (typeof value !== 'string') throw new RangeError('Invalid slot value');
    if (slot.input === 'choice' && value && !slot.options.some(option => option.id === value)) throw new RangeError('Unknown choice');
    values[slot.slotId] = value;
  }
  const next = { values, submitted: state.submitted };
  if (next.submitted && !isClozeComplete(definition, next)) throw new RangeError('Submitted cloze has empty slots');
  return next;
}

/** Writes one slot's draft. Submitted state is immutable: a second write returns it unchanged. */
export function setSlotValue(definition: ClozeDefinition, state: ClozeState, slotId: string, value: string): ClozeState {
  if (state.submitted) return state;
  const slot = slotOf(definition, slotId);
  if (!slot) throw new RangeError(`Unknown slot ${slotId}`);
  if (slot.input === 'choice' && value && !slot.options.some(option => option.id === value)) throw new RangeError('Unknown choice');
  return { ...state, values: { ...state.values, [slotId]: value } };
}

/** Clears every draft before submission; after submission nothing changes. */
export function resetCloze(definition: ClozeDefinition, state: ClozeState): ClozeState {
  return state.submitted ? state : emptyClozeState(definition);
}

export function isClozeComplete(definition: ClozeDefinition, state: ClozeState): boolean {
  return definition.slots.every(slot => filled(state.values[slot.slotId]));
}
export const hasClozeDraft = (state: ClozeState) => Object.values(state.values).some(value => value !== '');

/** Next empty slot after `fromSlotId` in slot order (wrapping), or null when all are filled. */
export function nextEmptySlot(definition: ClozeDefinition, state: ClozeState, fromSlotId?: string): string | null {
  const start = fromSlotId === undefined ? -1 : definition.slots.findIndex(slot => slot.slotId === fromSlotId);
  for (let step = 1; step <= definition.slots.length; step++) {
    const slot = definition.slots[(start + step + definition.slots.length) % definition.slots.length]!;
    if (!filled(state.values[slot.slotId])) return slot.slotId;
  }
  return null;
}

/** Trim, collapse whitespace, Unicode NFC; case-fold unless the task is case-sensitive. */
export function normalizeClozeText(value: string, caseSensitive = false): string {
  const text = value.normalize('NFC').trim().replace(/\s+/g, ' ');
  return caseSensitive ? text : text.toLocaleLowerCase('de');
}

function matches(slot: ClozeSlot, value: string, accepted: readonly string[], caseSensitive: boolean): boolean {
  if (!filled(value)) return false;
  if (slot.input === 'choice') return accepted.includes(value);
  const typed = normalizeClozeText(value, caseSensitive);
  return accepted.some(answer => normalizeClozeText(answer, caseSensitive) === typed);
}

/** All orders of 0..size-1, identity first so ties keep the authored slot order. */
function permutations(size: number): number[][] {
  if (size === 0) return [[]];
  return permutations(size - 1).flatMap(rest => Array.from({ length: size }, (_, step) => size - 1 - step)
    .map(at => [...rest.slice(0, at), size - 1, ...rest.slice(at)]));
}

/**
 * Per-slot evaluation for the exercise adapter (never called by the UI).
 * Interchangeable groups take the assignment of accepted sets that maximizes correct slots.
 */
export function evaluateCloze(definition: ClozeDefinition, key: ClozeAnswerKey, values: Readonly<Record<string, string>>): ClozeEvaluation {
  const caseSensitive = key.caseSensitive ?? false;
  for (const slot of definition.slots) if (!key.accepted[slot.slotId]?.length) throw new RangeError(`No accepted answer for ${slot.slotId}`);
  const result: Record<string, SlotOutcome> = {};
  const grouped = new Set<string>();
  for (const group of key.interchangeable ?? []) {
    if (group.length > MAX_GROUP || group.some(slotId => !slotOf(definition, slotId) || grouped.has(slotId))) throw new RangeError('Invalid interchangeable group');
    group.forEach(slotId => grouped.add(slotId));
    let best: SlotOutcome[] = group.map(() => 'incorrect');
    let bestScore = -1;
    for (const order of permutations(group.length)) {
      const outcomes = group.map((slotId, index): SlotOutcome =>
        matches(slotOf(definition, slotId)!, values[slotId] ?? '', key.accepted[group[order[index]!]!]!, caseSensitive) ? 'correct' : 'incorrect');
      const score = outcomes.filter(outcome => outcome === 'correct').length;
      if (score > bestScore) { best = outcomes; bestScore = score; }
    }
    group.forEach((slotId, index) => { result[slotId] = best[index]!; });
  }
  for (const slot of definition.slots) if (!grouped.has(slot.slotId))
    result[slot.slotId] = matches(slot, values[slot.slotId] ?? '', key.accepted[slot.slotId]!, caseSensitive) ? 'correct' : 'incorrect';
  const ordered = Object.fromEntries(definition.slots.map(slot => [slot.slotId, result[slot.slotId]!]));
  const correctCount = Object.values(ordered).filter(outcome => outcome === 'correct').length;
  return { slots: ordered, correct: correctCount === definition.slots.length, correctCount, total: definition.slots.length };
}
