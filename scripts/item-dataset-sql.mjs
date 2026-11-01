import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { assertItemDataset, createItemExerciseRegistry } from '../packages/vocabulary-core/dist/index.js';
import { literal } from './catalog-bootstrap.mjs';

/** G3 (#332): publish item dataset versions. Returns SQL only, as one service-role transaction.
 * A published version is immutable: the same JSON again is a no-op, a different one fails. */
export function itemDatasetSql(datasets) {
  datasets.forEach(assertItemDataset);
  createItemExerciseRegistry(datasets); // one version per dataset, valid identities
  const sql = ['BEGIN;', 'SET LOCAL ROLE service_role;'];
  for (const dataset of datasets) {
    const json = literal(JSON.stringify(dataset)) + '::jsonb';
    sql.push(`INSERT INTO catalog_private.item_datasets(dataset_id,version,kind,dataset) VALUES (${literal(dataset.id)},${literal(dataset.version)},${literal(dataset.kind)},${json}) ON CONFLICT (dataset_id,version) DO NOTHING;`,
      `DO $item$ BEGIN IF (SELECT dataset FROM catalog_private.item_datasets WHERE dataset_id=${literal(dataset.id)} AND version=${literal(dataset.version)}) IS DISTINCT FROM ${json} THEN
  RAISE EXCEPTION 'Dataset ${dataset.id} version ${dataset.version} is published with other content; use a new version' USING ERRCODE='55000';
END IF; END $item$;`);
  }
  sql.push('COMMIT;');
  return sql.join('\n') + '\n';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.length < 3 || args[0] !== '--output') throw new Error('Usage: npm run catalog:datasets -- --output /tmp/datasets.sql dataset.json [...]');
  const datasets = args.slice(2).map(path => JSON.parse(readFileSync(path, 'utf8')));
  writeFileSync(args[1], itemDatasetSql(datasets));
  console.log(`Wrote ${datasets.length} item dataset version(s) to ${args[1]}. No database connection made.`);
}
