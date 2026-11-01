import { readdirSync, rmSync } from 'node:fs';
// Remove old compiled entrypoints, including those left by an earlier v1 build.
for (const entry of readdirSync('public')) {
  if (entry.endsWith('.js') && entry !== 'sw.js') rmSync(`public/${entry}`);
}
for (const dir of ['public/pages', 'public/components']) {
  rmSync(dir, { recursive: true, force: true });
}
rmSync('public/data/word-index.json', { force: true });
