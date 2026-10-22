// Vite bundles the page: index.html, src/, and MapLibre, the geocoder and
// geotiff.js from npm, into dist/, served by the Worker.
//
// `npx vite` serves the page locally and passes the catalog, the COGs and the
// settings through to the dev site (or to $HAPMAP_ORIGIN).

import { defineConfig } from 'vite';

const origin = process.env.HAPMAP_ORIGIN || 'https://hapmap-dev.u5007063.workers.dev';
const through = { target: origin, changeOrigin: true, headers: { 'User-Agent': 'Mozilla/5.0 hap-mapper vite' } };

export default defineConfig({
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
            '/site.json': through,
            '/web-items.json': through,
        },
    },
});
