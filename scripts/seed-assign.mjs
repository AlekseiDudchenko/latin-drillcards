import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { assertPublishedWord } from '../packages/vocabulary-core/dist/index.js';
import { IDENTITIES_PATH, REPORT_PATH, assignIdentities, buildSeed, duplicateReport, loadSources } from './vocabulary-seed.mjs';

// npm run seed:assign [-- --confirm <wordId> ...] — give new deck entries a wordId (joining or reviving
// a word only for the same sense), bump contentVersion of changed words and rewrite the duplicate report.
// An entry whose meaning no longer matches its word fails; --confirm accepts it as the same meaning.
const args = process.argv.slice(2);
const confirm = args.flatMap((arg, i) => arg === '--confirm' && args[i + 1] ? [args[i + 1]] : []);
if (args.length !== confirm.length * 2) throw new Error('Usage: npm run seed:assign [-- --confirm <wordId> ...]');
const previous = existsSync(IDENTITIES_PATH) ? JSON.parse(readFileSync(IDENTITIES_PATH, 'utf8')) : undefined;
const unknown = confirm.find(id => !previous?.words.some(word => word.id === id));
if (unknown) throw new Error(`Unknown wordId to confirm: ${unknown}`);
const sources = loadSources();
const identities = assignIdentities(previous, sources, { confirm });
// Validate before writing, so a table that cannot build is never committed.
buildSeed(identities, sources).words.forEach(assertPublishedWord);
mkdirSync('content/vocabulary', { recursive: true });
writeFileSync(IDENTITIES_PATH, `${JSON.stringify(identities, null, 1)}\n`);
writeFileSync(REPORT_PATH, duplicateReport(identities, sources));
const before = new Set(previous?.words.map(word => word.id) ?? []);
const added = identities.words.filter(word => !before.has(word.id)).length;
console.log(`Vocabulary identities: ${identities.words.length} words from ${sources.entries.length} entries, ${added} new`);
