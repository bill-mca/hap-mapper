// Build the site into dist/: the page, its settings, and STAC Browser.
//
// The page reads the hap-mosaics STAC catalog itself, in the browser, so the
// build no longer touches it. It writes /site.json from layers.yaml: the
// catalog items to leave out, and the present-day imagery drawn underneath.
// Each Worker serves the settings it was deployed with, which is how the dev
// and production sites can differ.
//
//     npm run build            # writes dist/
//     npm run deploy           # build, then deploy to the hapmap Worker
//     npm run deploy:dev       # build, then deploy to hapmap-dev

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

function main() {
    const spec = YAML.parse(readFileSync(join(ROOT, 'layers.yaml'), 'utf8'));
    const exclude = spec.exclude || [];
    if (!spec.base) throw new Error('layers.yaml: no base layer');

    rmSync(DIST, { recursive: true, force: true });
    mkdirSync(DIST, { recursive: true });
    copyFileSync(join(ROOT, 'index.html'), join(DIST, 'index.html'));
    writeFileSync(join(DIST, 'site.json'), JSON.stringify({
        built: new Date().toISOString(),
        exclude,
        base: spec.base,
    }));
    console.log(`site.json: ${exclude.length} items left out; base ${spec.base.year} ${spec.base.title}`);

    execFileSync(join(ROOT, 'scripts', 'build-browser.sh'), [join(DIST, 'browse')], { stdio: 'inherit' });
    console.log(`wrote ${DIST}`);
}

try {
    main();
} catch (err) {
    console.error(err.message);
    process.exit(1);
}
