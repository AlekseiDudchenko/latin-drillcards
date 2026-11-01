import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { assertDecks, assertPublishedWord } from '../packages/vocabulary-core/dist/index.js';
import { buildSeed, loadSources, IDENTITIES_PATH } from './vocabulary-seed.mjs';
import { addWordPublication, literal, rowBuffer } from './catalog-bootstrap.mjs';

// #356: a new seed version into a catalog that already has users. Two steps, neither connects:
// a read-only state query, then the diff as one service-role transaction, which first checks
// that the catalog is still exactly the exported state.

/** Everything the diff depends on. A deck membership, publication, pointer or import changes it. */
const FINGERPRINT = `md5(concat_ws('|',
  (SELECT string_agg(id||'='||coalesce(published_version::text,'-'),',' ORDER BY id) FROM catalog_private.words),
  (SELECT string_agg(word_id||'@'||content_version,',' ORDER BY word_id,content_version) FROM catalog_private.word_publications),
  (SELECT string_agg(catalog_version,',' ORDER BY catalog_version) FROM catalog_private.catalog_imports),
  (SELECT string_agg(id||'='||title,',' ORDER BY id) FROM public.decks WHERE owner_id IS NULL),
  (SELECT string_agg(m.deck_id||'#'||m.position||'='||m.word_id,',' ORDER BY m.deck_id,m.position)
    FROM public.deck_memberships m JOIN public.decks d ON d.id=m.deck_id WHERE d.owner_id IS NULL)))`;

/** One JSON document: words, every publication with its model and manifest, shared decks. */
export const catalogStateQuery = `SELECT jsonb_build_object('schemaVersion',1,'fingerprint',${FINGERPRINT},
  'imports',(SELECT coalesce(jsonb_agg(catalog_version ORDER BY catalog_version),'[]') FROM catalog_private.catalog_imports),
  'words',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'senseId',sense_id,'publishedVersion',published_version) ORDER BY id),'[]')
    FROM catalog_private.words),
  'publications',(SELECT coalesce(jsonb_agg(jsonb_build_object('wordId',p.word_id,'contentVersion',p.content_version,
      'word',v.word,'items',items.items) ORDER BY p.word_id,p.content_version),'[]')
    FROM catalog_private.word_publications p
    JOIN catalog_private.published_word_versions v ON v.word_id=p.word_id AND v.content_version=p.content_version
    CROSS JOIN LATERAL (SELECT jsonb_agg(jsonb_build_object('revisionId',i.revision_id,'kind',i.kind,'entityId',r.entity_id,
        'hash',r.content_hash,'reviewId',i.review_id,'sources',(SELECT coalesce(jsonb_agg(s.source_id ORDER BY s.source_id),'[]')
          FROM catalog_private.content_sources s WHERE s.revision_id=i.revision_id AND s.provider='repository'))) AS items
      FROM catalog_private.publication_items i JOIN catalog_private.content_revisions r ON r.id=i.revision_id
      WHERE i.word_id=p.word_id AND i.content_version=p.content_version) items),
  'decks',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',d.id,'title',d.title,'wordIds',
      (SELECT coalesce(jsonb_agg(m.word_id ORDER BY m.position),'[]') FROM public.deck_memberships m WHERE m.deck_id=d.id)) ORDER BY d.id),'[]')
    FROM public.decks d WHERE d.owner_id IS NULL))::text AS state`;

/** Diff of the exported catalog state against a seed. Throws instead of guessing. */
export function planCatalogImport(state, seed) {
  if (state?.schemaVersion !== 1) throw new Error('Unknown catalog state; export it with the state query of this commit');
  seed.words.forEach(assertPublishedWord);
  assertDecks(seed.decks, seed.words);
  const words = new Map(state.words.map(w => [w.id, w]));
  const publications = new Map();
  for (const p of state.publications) publications.set(p.wordId, [...(publications.get(p.wordId) ?? []), p]);
  const plan = { newWords: [], publish: [], point: [], retire: [], reserve: [], decks: [] };
  const errors = [];
  for (const word of seed.words) {
    const current = words.get(word.id);
    if (!current) { plan.newWords.push(word); continue; }
    if (current.senseId !== word.senseId) errors.push(`${word.id}: sense ${current.senseId} in the catalog, ${word.senseId} in the seed`);
    if (current.publishedVersion > word.contentVersion) {
      errors.push(`${word.id}: catalog has version ${current.publishedVersion}, seed only ${word.contentVersion}`);
      continue;
    }
    const history = (publications.get(word.id) ?? []).sort((a, b) => a.contentVersion - b.contentVersion);
    const same = history.find(p => p.contentVersion === word.contentVersion);
    // Publications are immutable: one contentVersion can only ever mean one model.
    if (same && !isDeepStrictEqual(same.word, word)) errors.push(`${word.id}: version ${word.contentVersion} is published with other content`);
    else if (!same) plan.publish.push({ word, previous: history.at(-1) });
    if (current.publishedVersion !== word.contentVersion) plan.point.push(word);
  }
  const seeded = new Set(seed.words.map(w => w.id));
  for (const id of seed.retiredWordIds ?? []) {
    const current = words.get(id);
    if (!current) plan.reserve.push(id);
    else if (current.publishedVersion != null) plan.retire.push(id);
  }
  const retired = new Set(seed.retiredWordIds ?? []);
  for (const w of state.words) if (w.publishedVersion != null && !seeded.has(w.id) && !retired.has(w.id))
    errors.push(`${w.id}: published in the catalog but neither published nor retired by the seed`);
  const shared = new Map(state.decks.map(d => [d.id, d]));
  for (const deck of seed.decks) {
    const current = shared.get(deck.id);
    if (!current || current.title !== deck.title || !isDeepStrictEqual(current.wordIds, deck.wordIds))
      plan.decks.push({ deck, exists: !!current, title: current?.title !== deck.title, members: !isDeepStrictEqual(current?.wordIds, deck.wordIds) });
  }
  const kept = new Set(seed.decks.map(d => d.id));
  for (const d of state.decks) if (!kept.has(d.id)) errors.push(`${d.id}: shared deck missing from the seed; removing a deck is a separate decision`);
  const changed = ['newWords','publish','point','retire','reserve','decks'].some(key => plan[key].length);
  if (state.imports.includes(seed.catalogVersion) && changed)
    errors.push(`Catalog ${seed.catalogVersion} was imported before, but the catalog no longer matches it`);
  if (errors.length) throw new RangeError(errors.join('\n'));
  plan.changed = changed || !state.imports.includes(seed.catalogVersion);
  return plan;
}

/** The import transaction, or null when the catalog already is this seed. */
export function catalogImportSql(state, seed, { sourceRef } = {}) {
  if (!/^[0-9a-f]{40}$/.test(sourceRef ?? '')) throw new Error('A pinned repository commit is required');
  const plan = planCatalogImport(state, seed);
  if (!plan.changed) return { plan, sql: null };
  const { add, sql: inserts } = rowBuffer();
  let created = 0;
  for (const word of plan.newWords) {
    add('words', ['id','sense_id'], [literal(word.id),literal(word.senseId)]);
    created += addWordPublication(add, seed, sourceRef, word);
  }
  for (const { word, previous } of plan.publish) {
    // Only elements that changed get a new revision; the old publication keeps its manifest.
    const base = new Map((previous?.items ?? []).map(item => [item.kind + ' ' + item.entityId, item]));
    created += addWordPublication(add, seed, sourceRef, word, base);
  }
  for (const id of plan.reserve) add('words', ['id','sense_id'], [literal(id),literal(id)]);
  add('catalog_imports', ['catalog_version','seed_version','source_ref'], [seed.catalogVersion,seed.seedVersion,sourceRef].map(literal));
  plan.revisions = created;
  const pointers = [...plan.newWords, ...plan.point].map(w => [w.id, w.contentVersion]).concat(plan.retire.map(id => [id, null]));
  const sql = [
    `-- Catalog ${seed.catalogVersion} over ${state.fingerprint}; repository ${sourceRef}. No users or learning state.`,
    'BEGIN;',
    "SET LOCAL lock_timeout = '5s';",
    'SET LOCAL ROLE service_role;',
    "SELECT pg_advisory_xact_lock(hashtextextended('drillcards-v2-catalog-import',0));",
    `DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM catalog_private.catalog_imports WHERE catalog_version=${literal(seed.catalogVersion)}) THEN
    RAISE EXCEPTION 'Catalog ${seed.catalogVersion} is already imported; nothing changed' USING ERRCODE='55000';
  END IF;
  IF ${FINGERPRINT} IS DISTINCT FROM ${literal(state.fingerprint)} THEN
    RAISE EXCEPTION 'Catalog changed since its state was exported; export it again' USING ERRCODE='55000';
  END IF;
END $$;`,
    ...inserts(),
  ];
  // Retired words keep their row and history; only the current pointer goes.
  if (pointers.length) sql.push('UPDATE catalog_private.words w SET published_version=v.version FROM (VALUES\n'+
    pointers.map(([id, version]) => `(${literal(id)},${literal(version)}::integer)`).join(',\n')+') v(id,version) WHERE w.id=v.id;');
  // Shared decks are rewritten from the seed; personal decks (owner_id set) are never touched.
  for (const { deck, exists, title, members } of plan.decks) {
    if (!exists) sql.push(`INSERT INTO public.decks(id,title) VALUES (${literal(deck.id)},${literal(deck.title)});`);
    else if (title) sql.push(`UPDATE public.decks SET title=${literal(deck.title)} WHERE id=${literal(deck.id)} AND owner_id IS NULL;`);
    if (!members) continue;
    if (exists) sql.push(`DELETE FROM public.deck_memberships WHERE deck_id=${literal(deck.id)};`);
    if (deck.wordIds.length) sql.push('INSERT INTO public.deck_memberships(deck_id,word_id,position) VALUES\n'+
      deck.wordIds.map((id,i)=>`(${literal(deck.id)},${literal(id)},${i})`).join(',\n')+';');
  }
  sql.push('COMMIT;');
  return { plan, sql: sql.join('\n')+'\n' };
}

export const summary = plan => !plan.changed ? 'Nothing to import: the catalog already is this seed.' :
  `${plan.newWords.length} new words, ${plan.publish.length} new publications (${plan.revisions} new revisions), ` +
  `${plan.point.length - plan.publish.length} pointer moves, ${plan.retire.length} retired, ${plan.reserve.length} reserved IDs, ` +
  `${plan.decks.length} shared decks rewritten.`;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const usage = 'Usage: npm run catalog:import -- --state-query /tmp/catalog-state.sql\n' +
    '       npm run catalog:import -- --state /tmp/catalog-state.json --output /tmp/catalog-import.sql';
  if (args.length === 2 && args[0] === '--state-query') {
    // Read-only and quiet, so `psql -qAt` prints only the JSON.
    writeFileSync(args[1], `BEGIN READ ONLY;\nSET LOCAL ROLE service_role;\n${catalogStateQuery};\nROLLBACK;\n`);
    console.log(`Wrote the read-only catalog state query to ${args[1]}. No database connection made.`);
  } else if (args.length === 4 && args[0] === '--state' && args[2] === '--output') {
    const seed = buildSeed(JSON.parse(readFileSync(IDENTITIES_PATH,'utf8')),loadSources());
    const sourceRef = execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
    // Source URLs pin this commit, so the hashed files must be exactly what it contains.
    const dirty = execFileSync('git',['status','--porcelain','--','public/data','content/vocabulary'],{encoding:'utf8'}).trim();
    if (dirty) throw new Error(`Commit the seed sources first; uncommitted changes:\n${dirty}`);
    const { plan, sql } = catalogImportSql(JSON.parse(readFileSync(args[1],'utf8')),seed,{sourceRef});
    if (sql) writeFileSync(args[3],sql);
    console.log(`${summary(plan)}${sql ? ` Wrote ${args[3]}.` : ' No file written.'} No database connection made.`);
  } else throw new Error(usage);
}
