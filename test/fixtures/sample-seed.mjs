// The textbook decks plus two sample decks (basic, verbs): rich enough to exercise merging, homonyms,
// retirement and item links, which the production catalog (textbook words only) does not cover.
import { fileURLToPath } from 'node:url';
import { assignIdentities, loadSources } from '../../scripts/vocabulary-seed.mjs';

export const SAMPLE_DECKS = Object.freeze([
  ['l1-a', 'Lectio I · A'], ['l1-b', 'Lectio I · B'], ['l1-t', 'Lectio I · T'],
  ['basic', 'Sample: basic vocabulary'], ['verbs', 'Sample: verbs'],
]);
export const sampleSources = loadSources(fileURLToPath(new URL('./sample-seed', import.meta.url)), SAMPLE_DECKS);
export const sampleIdentities = assignIdentities(undefined, sampleSources);
