// Vite bundles the page: index.html, src/, and MapLibre, the geocoder and
// geotiff.js from npm, into dist/, served by the Worker.
//
// `npx vite` serves the page locally and passes the catalog and the COGs
// through to the dev site (or to $HAPMAP_ORIGIN). /site.json it makes itself,
// from this checkout's layers.yaml, so a change there shows on reload.

import { defineConfig } from 'vite';
import { siteJson } from './scripts/site.mjs';

const localSite = {
    name: 'local-site-json',
    configureServer(server) {
        server.middlewares.use('/site.json', (req, res) => {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(siteJson(server.config.root)));
        });
    },
};

const origin = process.env.HAPMAP_ORIGIN || 'https://hapmap-dev.u5007063.workers.dev';
const through = { target: origin, changeOrigin: true, headers: { 'User-Agent': 'Mozilla/5.0 hap-mapper vite' } };

export default defineConfig({
    plugins: [localSite],
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        target: 'es2022',
        chunkSizeWarningLimit: 1500,
    },
    worker: {
        format: 'es',
    },
    server: {
        proxy: {
            '/cog/': through,
            '/web/': through,
            '/stac/': through,
            '/browse/': through,
            '/web-items.json': through,
        },
    },
});
