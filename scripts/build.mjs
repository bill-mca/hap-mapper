// Build the site into dist/: the page, its settings, and STAC Browser.
//
// Vite bundles the page (index.html and src/, with MapLibre, the geocoder and
// geotiff.js from npm) into dist/ first; see vite.config.js.
//
// The page reads the hap-mosaics STAC catalog itself, in the browser, so the
// build no longer touches it. It writes /site.json from layers.yaml
// (scripts/site.mjs): the catalog items to leave out, the present-day
// imagery, and the dark backdrop.
// Each Worker serves the settings it was deployed with, which is how the dev
// and production sites can differ.
//
//     npm run build            # writes dist/
//     npm run deploy           # build, then deploy to the hapmap Worker
//     npm run deploy:dev       # build, then deploy to hapmap-dev

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { siteJson } from './site.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

async function main() {
    const site = siteJson(ROOT); // fail before the slow part

    await build({ root: ROOT, logLevel: 'warn' }); // empties dist/ first
    writeFileSync(join(DIST, 'site.json'), JSON.stringify(site));
    console.log(`site.json: ${site.exclude.length} items left out; base ${site.base.year} ${site.base.title}; backdrop ${site.backdrop.title}`);

    // Vite's build() set NODE_ENV=production in this process; left in place,
    // it makes the browser's `npm ci` skip the devDependencies it builds with.
    const { NODE_ENV, ...env } = process.env;
    execFileSync(join(ROOT, 'scripts', 'build-browser.sh'), [join(DIST, 'browse')], { stdio: 'inherit', env });
    console.log(`wrote ${DIST}`);
}

main().catch((err) => {
    console.error(err.message);
    process.exit(1);
});
