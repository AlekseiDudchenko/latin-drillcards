import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const core = new URL('../packages/vocabulary-core/', import.meta.url);
rmSync(new URL('dist/', core), { recursive: true, force: true });
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'packages/vocabulary-core/tsconfig.json'], { cwd: root, stdio: 'inherit' });
const browserOutput = new URL('../public/v2/core/', import.meta.url);
rmSync(browserOutput, { recursive: true, force: true });
mkdirSync(browserOutput, { recursive: true });
// Identical ESM artifacts, with relative .js imports; no browser-only reimplementation.
cpSync(new URL('dist/', core), browserOutput, { recursive: true });
