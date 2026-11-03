import { readFileSync, writeFileSync } from 'fs';

const version = readFileSync('VERSION', 'utf8').trim();

if (!version) throw new Error('VERSION file is empty');
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`VERSION must be MAJOR.MINOR.PATCH, got: "${version}"`);

writeFileSync('public/version.json', JSON.stringify({ version }));

const DATA_RE = /(<footer id="app-footer")(?:\s+data-version="[^"]*")?(>)([^<]*)(<\/footer>)/;
const OLD_RE = /(<footer id="app-footer">)[^<]*(<\/footer>)/;

function injectIntoHtml(htmlPath) {
  const html = readFileSync(htmlPath, 'utf8');
  if (DATA_RE.test(html)) {
    writeFileSync(htmlPath, html.replace(DATA_RE, `$1 data-version="v${version}"$2$3$4`));
    return;
  }
  if (OLD_RE.test(html)) {
    writeFileSync(htmlPath, html.replace(OLD_RE, `$1v${version}$2`));
    return;
  }
  throw new Error(`footer element not found in ${htmlPath}`);
}

injectIntoHtml('public/index.html');
injectIntoHtml('public/404.html');

// Stamp the compiled v2 module the site footer reads its version from.
const APP_VERSION_PATH = 'public/v2/app-version.js';
const APP_VERSION_RE = /export const APP_VERSION = '[^']*';/;
const appVersion = readFileSync(APP_VERSION_PATH, 'utf8');
if (!APP_VERSION_RE.test(appVersion)) throw new Error(`APP_VERSION constant not found in ${APP_VERSION_PATH}`);
writeFileSync(APP_VERSION_PATH, appVersion.replace(APP_VERSION_RE, `export const APP_VERSION = '${version}';`));

// Stamp the service worker so each release rolls the offline cache.
const SW_PATH = 'public/sw.js';
const sw = readFileSync(SW_PATH, 'utf8');
const stamped = sw.replace(/const VERSION = "[^"]*";/, `const VERSION = "${version}";`);
if (stamped === sw && !sw.includes(`const VERSION = "${version}";`)) {
  throw new Error(`VERSION constant not found in ${SW_PATH}`);
}
writeFileSync(SW_PATH, stamped);

console.log(`Version injected: ${version}`);
