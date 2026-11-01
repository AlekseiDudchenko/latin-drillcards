import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { assertDecks, assertPublishedWord } from '../packages/vocabulary-core/dist/index.js';
import { buildSeed, loadSources, IDENTITIES_PATH } from './vocabulary-seed.mjs';

export const literal = value => value == null ? 'NULL' : typeof value === 'number' ? String(value)
  : "E'" + String(value).replaceAll('\\', '\\\\').replaceAll("'", "''") + "'";
const array = values => `ARRAY[${values.map(literal).join(',')}]::text[]`;
export const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// FK order, with manifest inserted BEFORE sealing the publication. Its FK is
// deferred to the transaction's end.
const ORDER = ['words','content_revisions','word_revisions','word_translations','examples','example_translations',
  'word_examples','content_sources','content_reviews','publication_items','word_publications','catalog_imports'];

/** Collects rows per table and renders them as batched INSERTs in FK order. */
export function rowBuffer() {
  const tables = new Map();
  const add = (table, columns, values) => {
    const entry = tables.get(table) ?? { columns, rows: [] };
    entry.rows.push(values); tables.set(table, entry);
  };
  // Batches keep the full seed import small.
  const sql = () => ORDER.flatMap(table => {
    const entry = tables.get(table); if (!entry) return [];
    const out = [];
    for (let i=0;i<entry.rows.length;i+=250) {
      out.push(`INSERT INTO catalog_private.${table} (${entry.columns.join(',')}) VALUES\n`+
        entry.rows.slice(i,i+250).map(row=>'('+row.join(',')+')').join(',\n')+';');
    }
    return out;
  });
  return { add, sql };
}

/** Rows of one seed word's publication `word.contentVersion`.
 * `previous` maps `kind entityId` to the revisions of the word's previous publication:
 * an element whose body (including the revisions it pins) and sources are unchanged is
 * reused with its review, every other element gets a new revision. Returns the count of new revisions.
 */
export function addWordPublication(add, seed, sourceRef, word, previous = new Map()) {
  const prefix = `seed/${word.id}/${word.contentVersion}/`;
  const positions = {};
  let created = 0;
  // One revision, source and explicit editorial confirmation per included text.
  const revision = (kind, entityId, body, sources, { detail = false } = {}) => {
    const digest = hash(body);
    const prior = previous.get(kind + ' ' + entityId);
    const reused = prior?.hash === digest && prior.sources.join('\n') === [...sources].sort().join('\n');
    const id = reused ? prior.revisionId : prefix + kind + '/' + entityId;
    const reviewId = reused ? prior.reviewId : id + '/review';
    if (!reused) {
      created++;
      add('content_revisions', ['id','word_id','kind','entity_id','revision','content_hash'],
        [id,word.id,kind,entityId,word.contentVersion,digest].map(literal));
      for (const source of sources) {
        const deck = source.split(':')[0];
        const path = `public/data/words-${deck}${detail ? '-detail' : ''}.json`;
        if (!seed.source.files[path]) throw new Error(`Missing source file hash: ${path}`);
        add('content_sources', ['revision_id','provider','source_id','source_revision','source_url','attribution','license','fetched_at'],
          [id,'repository',source,seed.source.files[path],
            `https://github.com/AlekseiDudchenko/de-trainer/blob/${sourceRef}/${path}`,
            'de-trainer repository contributors','LicenseRef-RepositorySeed'].map(literal).concat('CURRENT_TIMESTAMP'));

      }
      add('content_reviews', ['id','revision_id','content_hash','decision','reviewer_kind'],
        [reviewId,id,digest,'confirmed','seed'].map(literal));
    }
    add('publication_items', ['word_id','content_version','revision_id','kind','review_id','position'],
      [word.id,word.contentVersion,id,kind,reviewId,positions[kind] ?? 0].map(literal));
    positions[kind] = (positions[kind] ?? 0) + 1;
    return { id, reused };
  };
  const sources = seed.provenance[word.id];
  if (!sources?.length) throw new Error(`Missing word provenance: ${word.id}`);
  const root = revision('word',word.id,{ lemma:word.lemma,partOfSpeech:word.partOfSpeech,article:word.article,
    acceptedGermanForms:word.acceptedGermanForms,tags:word.tags },sources);
  if (!root.reused) add('word_revisions', ['id','word_id','lemma','part_of_speech','article','accepted_german_forms','tags'],
    [root.id,word.id,word.lemma,word.partOfSpeech,word.article].map(literal)
      .concat(array(word.acceptedGermanForms),array(word.tags)));
  for (const [lang,meaning] of Object.entries(word.meanings)) {
    for (const text of [meaning.preferred,...meaning.accepted]) {
      // The entity is the text itself, not its position: reordering never relabels a translation.
      // Its order (preferred first) is the manifest position.
      const textSources = seed.translationSources?.[word.id]?.[lang]?.[text];
      if (!textSources?.length) throw new Error(`Missing translation provenance: ${word.id} ${lang} ${text}`);
      const t = revision('translation',`${word.id}/${lang}/${hash({ language:lang,text }).slice(0,16)}`,{ language:lang,text },textSources);
      if (!t.reused) add('word_translations', ['id','word_id','language','text'],[t.id,word.id,lang,text].map(literal));
    }
  }
  for (const example of word.examples) {
    const exampleSources = sources.filter(s => example.id.startsWith(s+':'));
    if (!exampleSources.length) throw new Error(`Missing example provenance: ${example.id}`);
    const origin = { detail: example.id.includes(':detail:') };
    // Translations and the association pin exact revisions, so a new text or root renews them too.
    const e = revision('example',example.id,{ text:example.de },exampleSources,origin);
    if (!e.reused) add('examples', ['id','word_id','text'],[e.id,word.id,example.de].map(literal));
    for (const [lang,text] of Object.entries(example.translations)) {
      const t = revision('example_translation',`${example.id}/${lang}`,{ exampleId:e.id,language:lang,text },exampleSources,origin);
      if (!t.reused) add('example_translations', ['id','word_id','example_id','language','text'],[t.id,word.id,e.id,lang,text].map(literal));
    }
    const a = revision('association',`${word.id}/${example.id}`,{ wordRevisionId:root.id,exampleId:e.id },exampleSources,origin);
    if (!a.reused) add('word_examples', ['id','word_id','word_revision_id','example_id'],[a.id,word.id,root.id,e.id].map(literal));
  }
  add('word_publications', ['word_id','content_version','word_revision_id'],[word.id,word.contentVersion,root.id].map(literal));
  return created;
}

/** Privileged initial editorial import, not a participant contribution/publish API.
 * Returns SQL only: never connects to a database or reads deployment credentials.
 */
export function catalogSeedSql(seed, { sourceRef } = {}) {
  if (!/^[0-9a-f]{40}$/.test(sourceRef ?? '')) throw new Error('A pinned repository commit is required');
  seed.words.forEach(assertPublishedWord);
  assertDecks(seed.decks, seed.words);
  const { add, sql: inserts } = rowBuffer();
  for (const word of seed.words) {
    add('words', ['id','sense_id'], [literal(word.id),literal(word.senseId)]);
    addWordPublication(add, seed, sourceRef, word);
  }
  // Retired IDs exist as words without a publication: reserved, never visible, never reused.
  for (const id of seed.retiredWordIds ?? []) add('words', ['id','sense_id'], [literal(id),literal(id)]);
  add('catalog_imports', ['catalog_version','seed_version','source_ref'], [seed.catalogVersion,seed.seedVersion,sourceRef].map(literal));
  const sql = [`-- Catalog ${seed.catalogVersion}; repository ${sourceRef}. No users or learning state.`, ...inserts()];
  sql.push('UPDATE catalog_private.words w SET published_version=p.content_version FROM catalog_private.word_publications p WHERE p.word_id=w.id;');
  for (const deck of seed.decks) {
    sql.push(`INSERT INTO public.decks(id,title) VALUES (${literal(deck.id)},${literal(deck.title)});`);
    if (deck.wordIds.length) sql.push('INSERT INTO public.deck_memberships(deck_id,word_id,position) VALUES\n'+
      deck.wordIds.map((id,i)=>`(${literal(deck.id)},${literal(id)},${i})`).join(',\n')+';');
  }
  return sql.join('\n')+'\n';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.length!==2 || args[0]!=='--output') throw new Error('Usage: npm run catalog:bootstrap -- --output /tmp/v2-catalog.sql');
  const seed = buildSeed(JSON.parse(readFileSync(IDENTITIES_PATH,'utf8')),loadSources());
  const sourceRef = execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  const preflight = readFileSync(new URL('../supabase/v2/transition/fresh-project-preflight.sql',import.meta.url),'utf8');
  // Source URLs pin this commit, so the hashed files must be exactly what it contains.
  const dirty = execFileSync('git',['status','--porcelain','--','public/data','content/vocabulary'],{encoding:'utf8'}).trim();
  if (dirty) throw new Error(`Commit the seed sources first; uncommitted changes:\n${dirty}`);
  const schema = readFileSync(new URL('../supabase/v2/migrations/001_catalog.sql',import.meta.url),'utf8');
  writeFileSync(args[1],'BEGIN;\n'+preflight+'\n'+schema+'\n'+catalogSeedSql(seed,{sourceRef})+'COMMIT;\n');
  console.log(`Wrote fresh v2 catalog bootstrap: ${seed.words.length} words, ${seed.decks.length} decks. No database connection made.`);
}
