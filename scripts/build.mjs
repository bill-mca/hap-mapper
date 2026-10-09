// Build the site into dist/: the page, its layer list, and STAC Browser.
//
// layers.yaml names the catalog items to show; everything else about each
// layer comes from the hap-mosaics STAC catalog, read from HAP_STAC (a folder
// or a URL). On hectar that defaults to ~/hap-mosaics/web/stac, which
// hap-mosaics' publish.py writes; anywhere else, to the public catalog at
// https://hapmap.app/stac. Each Worker then serves the layer list it was
// deployed with, so the dev and production sites cannot drift through
// anything they share.
//
//     npm run build            # writes dist/
//     npm run deploy           # build, then deploy to the hapmap Worker
//     npm run deploy:dev       # build, then deploy to hapmap-dev

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const SITE = 'https://hapmap.app';
const PUBLIC_STAC = `${SITE}/stac`;
const LOCAL_STAC = join(homedir(), 'hap-mosaics', 'web', 'stac');
const STAC = process.env.HAP_STAC || (existsSync(LOCAL_STAC) ? LOCAL_STAC : PUBLIC_STAC);

// ---------------------------------------------------------------------------
// Reading the catalog, from disk or over HTTP. Links in the web catalog are
// absolute under PUBLIC_STAC; a local copy is read at the same paths.

async function readJson(href) {
    if (STAC.startsWith('http')) {
        const res = await fetch(href.replace(PUBLIC_STAC, STAC));
        if (!res.ok) throw new Error(`${href}: HTTP ${res.status}`);
        return res.json();
    }
    return JSON.parse(readFileSync(join(STAC, href.replace(`${PUBLIC_STAC}/`, '')), 'utf8'));
}

async function itemIndex() {
    const root = await readJson(`${PUBLIC_STAC}/catalog.json`);
    const index = new Map();
    for (const child of root.links.filter((l) => l.rel === 'child')) {
        if (child.href.includes('/ga-frames/')) continue; // frame records, not layers
        const coll = await readJson(child.href);
        for (const link of coll.links.filter((l) => l.rel === 'item')) {
            const id = link.href.split('/').pop().replace(/\.json$/, '');
            index.set(id, link.href);
        }
    }
    return index;
}

// ---------------------------------------------------------------------------
// One timeline entry from one STAC item

// hapmap.app/cog/x.tif -> /cog/x.tif, so either Worker serves it from R2.
const local = (href) => (href ? href.replace(SITE, '') : null);

// The handle reads 1974–75 for a mosaic flown across a new year.
function labelFor(start, end) {
    const y0 = start.getUTCFullYear();
    const y1 = end.getUTCFullYear();
    return y0 === y1 ? String(y0) : `${y0}–${String(y1).slice(-2)}`;
}

// STAC Browser's address for a catalog object, in hash mode.
const browse = (href) => `/browse/#/${href.replace(`${PUBLIC_STAC}/`, '')}`;

function layerFromItem(item, href, override) {
    const p = item.properties;
    const start = new Date(p.start_datetime || p.datetime);
    const end = new Date(p.end_datetime || p.datetime);
    const data = item.assets.data;
    const bands = (data['eo:bands'] || []).map((b) => b.common_name || b.name);
    const sf = item.assets.source_frame;
    const fit = item.assets.frame_fit;
    const ties = item.assets.tie_points;
    if (!data.href.startsWith(SITE)) {
        throw new Error(`${item.id}: its data is not on hapmap.app; publish it first`);
    }
    return {
        id: item.id,
        year: start.getUTCFullYear(),
        label: override.label || labelFor(start, end),
        title: p.title,
        description: p.description,
        start: p.start_datetime,
        end: p.end_datetime,
        films: p['hap:films'],
        gsd: p.gsd,
        engine: p['hap:engine'],
        georef: {
            status: p['hap:georef_status'],
            method: p['hap:georef_method'],
            notes: p['hap:georef_notes'],
        },
        knownIssues: p['hap:known_issues'] || [],
        cog: local(data.href),
        bbox: item.bbox,
        gray: !bands.includes('red'),
        record: browse(href),
        // Which photograph made each pixel, for a Blag Map mosaic.
        sourceFrame: sf ? {
            cog: local(sf.href),
            // [value, GFID, title, date], compact: 621 frames for 1968
            classes: sf['classification:classes'].map((c) => [c.value, c.name, c.title, c['hap:date']]),
            frameRecord: local(sf['hap:frame_href']),
            frameBrowse: browse(sf['hap:frame_href']),
            fit: fit ? local(fit.href) : null,
            ties: ties ? local(ties['hap:ties_href']) : null,
        } : null,
    };
}

// ---------------------------------------------------------------------------

async function main() {
    const spec = YAML.parse(readFileSync(join(ROOT, 'layers.yaml'), 'utf8'));
    console.log(`catalog: ${STAC}`);
    const index = await itemIndex();

    const layers = [];
    for (const entry of spec.layers) {
        const override = typeof entry === 'string' ? { item: entry } : entry;
        const href = index.get(override.item);
        if (!href) throw new Error(`layers.yaml: ${override.item} is not in the published catalog`);
        layers.push(layerFromItem(await readJson(href), href, override));
    }
    layers.sort((a, b) => a.year - b.year);
    const base = { ...spec.base, label: String(spec.base.year) };

    rmSync(DIST, { recursive: true, force: true });
    mkdirSync(DIST, { recursive: true });
    copyFileSync(join(ROOT, 'index.html'), join(DIST, 'index.html'));
    writeFileSync(join(DIST, 'layers.json'), JSON.stringify({
        built: new Date().toISOString(),
        catalog: `${PUBLIC_STAC}/catalog.json`,
        layers,
        base,
        backdrop: spec.backdrop,
    }));
    for (const l of layers) {
        const frames = l.sourceFrame ? `, ${l.sourceFrame.classes.length} frames` : '';
        console.log(`  ${l.label.padEnd(8)} ${l.id}${l.gray ? ' (grey)' : ''}${frames}`);
    }

    execFileSync(join(ROOT, 'scripts', 'build-browser.sh'), [join(DIST, 'browse')], { stdio: 'inherit' });
    console.log(`wrote ${DIST}`);
}

main().catch((err) => {
    console.error(err.message);
    process.exit(1);
});
