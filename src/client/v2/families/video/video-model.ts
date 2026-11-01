import { selectItems, summarizeExercise, type ExerciseProgressResult, type ItemDataset, type ItemExerciseRegistry,
  type ListeningMode } from '../../core/index.js';

// Pure model of the video page (M6 / #338): which videos exist, the URL state, segment order,
// selection and statistics. No DOM and no storage, so it is unit-tested directly.
export interface VideoEntry { readonly videoId: string; readonly title: string; readonly level: string; readonly shorts: boolean }
/** Every v1 video, in the v1 home order (long videos, then shorts). The unit test checks it against the sources. */
export const VIDEOS: readonly VideoEntry[] = Object.freeze([
  { videoId: 'J2dbsM9678o', title: 'Wie Uniqlo die Modebranche hops nimmt', level: 'B2', shorts: false },
  { videoId: 'ejmqbUNluuc', title: 'Darum ist Mieten schlauer als Kaufen', level: 'B2', shorts: false },
  { videoId: 'vF-xHBSonMk', title: 'Diese 10 Bücher haben mein Deutsch verändert', level: 'C1', shorts: false },
  { videoId: 'rBW65Jbesjw', title: 'Was ihr über Sonnencreme wisst, ist falsch', level: 'C1', shorts: false },
  { videoId: 'z_ujBh2lLGg', title: 'Ihr Traum war Topmodel — Maraam', level: 'B2', shorts: false },
  { videoId: '4JTUflVw1v4', title: 'Frage-Antwort: Ihre ganze Beauty-Routine', level: 'B1', shorts: true },
  { videoId: 'd2hv-koUGwg', title: 'Wetterprognose: Kommt eine neue Hitzewelle?', level: 'B2', shorts: true },
]);
const KNOWN = new Set(VIDEOS.map(video => video.videoId));
export type VideoView = 'dictation' | 'sentences';
export const DICTATION_EXERCISE: Record<ListeningMode, string> = { tokens: 'listening-tokens', text: 'listening-text' };
export const ASSEMBLY_EXERCISE = 'sentence-assembly';
export const datasetId = (videoId: string): string => `video-${videoId}`;
export const segmentId = (index: number): string => `seg-${index}`;
export const segmentIndex = (itemId: string): number => Number(itemId.slice(4));
export const isVideoExercise = (exerciseId: string | undefined): boolean =>
  exerciseId === ASSEMBLY_EXERCISE || exerciseId === DICTATION_EXERCISE.tokens || exerciseId === DICTATION_EXERCISE.text;

export interface VideoState { readonly videoId: string; readonly view: VideoView }
export function parseState(hash: string): VideoState {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const videoId = params.get('v') ?? '';
  return { videoId: KNOWN.has(videoId) ? videoId : VIDEOS[0]!.videoId, view: params.get('view') === 'sentences' ? 'sentences' : 'dictation' };
}
export const stateHash = (state: VideoState): string => `#${new URLSearchParams({ v: state.videoId, view: state.view }).toString()}`;

/** Standalone assembly needs a translation prompt (as in v1, only translated videos offer it). */
export const assemblyAvailable = (registry: ItemExerciseRegistry, dataset: ItemDataset, language: 'ru' | 'en'): boolean =>
  dataset.items.some(item => registry.isAvailable(ASSEMBLY_EXERCISE, dataset.id, item.id, { answerLanguage: language, seed: 'check', taskId: 'check' }));

/** A saved v1 position (`vd_pos_<id>`) clamped to the video. */
export const clampPosition = (value: unknown, segments: number): number => {
  const index = typeof value === 'string' ? Number.parseInt(value, 10) : NaN;
  return Number.isSafeInteger(index) && index >= 0 && index < segments ? index : 0;
};

/** Next standalone sentence: never answered first, then last wrong, then the oldest; never the one just shown. */
export function nextAssembly(registry: ItemExerciseRegistry, progress: ExerciseProgressResult, dataset: string, currentId?: string): string | undefined {
  const ordered = selectItems(registry, ASSEMBLY_EXERCISE, dataset, progress, Number.MAX_SAFE_INTEGER);
  return ordered.find(id => id !== currentId) ?? ordered[0];
}

export interface SegmentStats { readonly answers: number; readonly independent: number }
export function segmentStats(progress: ExerciseProgressResult, dataset: string, itemId: string, exerciseId: string): SegmentStats | undefined {
  const own = progress.items.find(p => p.exerciseId === exerciseId && p.datasetId === dataset && p.itemId === itemId);
  return own ? { answers: own.answers, independent: own.independentCorrect } : undefined;
}
export function videoStats(registry: ItemExerciseRegistry, progress: ExerciseProgressResult, dataset: string, exerciseId: string) {
  const all = summarizeExercise(registry, exerciseId, dataset, progress);
  return { total: all.applicable, attempted: all.attempted, accuracy: all.accuracy };
}
