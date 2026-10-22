# hap-mapper

A [topotijdreis.nl](https://www.topotijdreis.nl/)-style time-travel webmap for the Hap-Map project, showing historical aerial photography of Canberra at [hapmap.app](https://hapmap.app).

Drag the year handle on the timeline, or press the play button, to travel through the years.
On a touch screen, swipe two fingers up or down anywhere on the map to step between the years with a dot; the handle follows the fingers, so down is back in time, and a hint says so on the first visit.
The arrow keys do the same on a keyboard.
The map stays flat: the two-finger swipe that would tilt it into an oblique view changes the year instead, and pinching still zooms.
The handle can rest on any year.
A magenta dot marks each year with a mosaic that covers more than 30% of the view, or that fits wholly inside it, so the dots change as the map moves.
The map shows the year of the handle's dot, or of the nearest dot below it, and every mosaic of that year in view, the sharpest on top.
Nothing older shows through: wherever that year has no photograph, a dark grey map of today's Canberra shows instead.
A dot turns grey when the map is zoomed in past that year's sharpest photographs in view, so that each of their pixels is wider than a pixel of the screen; the handle turns grey the same way for what is drawn.
The present day, at the top of the timeline, is Esri World Imagery.
The page is dark: a charcoal map and timeline, with magenta for the dots, the handle and the play button.

There is no title card or layer panel: the map is the interface.
A small spinner in the middle of the map turns while anything is loading.
The search box at the top finds a present-day place through Nominatim, using MapLibre's geocoder plugin, and flies the map there.
Today's place, street and water names from OpenStreetMap are written over every year, from OpenFreeMap's vector tiles: light text in a dark halo, so it reads over any photograph.
The dark grey map comes from the same tiles, drawn by [`src/vector-map.js`](src/vector-map.js) in the greys of Esri's Dark Gray Canvas, which it replaced; it draws no names, so the labels are the only ones on the map.
The **Aa** button under the zoom buttons hides them, and the page remembers the choice.
The roads button below it lays today's roads, rail, building footprints, lakes and rivers over the year's photographs, light and semi-transparent so the photograph shows through; with the labels on too, it makes a hybrid map of the past.
It starts off, and the page remembers it too.

Click the map to see which photograph that spot came from and the day it was flown.
"View photograph" opens GA's preview of it, with a link to download the full scan; clicking the preview opens it in a new tab.
The credit line at the bottom names only what is on screen, with a link to each mosaic's catalog record.

[docs/specification.md](docs/specification.md) is bilby's specification for the site; it can be ahead of or behind what is built.

## How it fits together

- **The layers** come from the hap-mosaics STAC catalog (`claude-agent/hap-mosaics` on Gitea, `~/hap-mosaics` on hectar), published at `/stac/`.
  The page reads it in one request, from the Worker's `/web-items.json`, and walks `/stac/` itself only if that fails.
  Every Web Mercator mosaic served from hapmap.app is a layer, filed under the year its flying started, so a newly published mosaic appears on the next page load, with no deploy.
- **[`layers.yaml`](layers.yaml)** names the catalog items the site leaves out, the present-day layer, and the dark map underneath.
  `npx vite` serves `/site.json` from it fresh, so a change shows on reload.
  It is what differs between production and dev.
- **The page** is `index.html` and `src/`: `src/main.js` is the map and the timeline, and `src/cog.js` draws the COGs.
- **The build**, `npm run build`, bundles the page with [Vite](https://vite.dev/) into `dist/`, turns `layers.yaml` into `dist/site.json`, and builds [STAC Browser](https://github.com/radiantearth/stac-browser) into `dist/browse/`.
  `npx vite` serves the page locally, passing the catalog and the COGs through to the dev site.
- **The Worker**, `worker/cog-proxy.js`, serves `dist/` and range-proxies everything else out of the R2 bucket: the COGs at `/cog/…`, their web copies at `/web/…`, and the public catalog at `/stac/…`.
  It keeps the ranges it reads, in memory and in Cloudflare's edge cache, and makes `/web-items.json`, every Web Mercator item in the catalog in one file.
- **The web copies** are what the map draws: each mosaic's pixels on the same grid, re-encoded as RGBA WebP, a tenth the size of a colour master and half a grey one.
  `scripts/web-cogs.py` makes them from the masters in `~/hap-mosaics/derived/` and uploads them to `web/` in the bucket; the Worker finds them there.
  A mosaic without one is drawn from its published COG.
- **The bucket** is kept by hap-mosaics' `publish.py`, which uploads what is missing, writes the public catalog, and never overwrites or deletes.
  [docs/r2-inventory.md](docs/r2-inventory.md) is the register of what is in it.

For each year and view the page draws one year's mosaics, and only those in view.
[docs/timeline-plan.md](docs/timeline-plan.md) has the original design, in which older years filled the gaps; that is no longer so.
From the browser console, `hapmap.stack()` lists what is drawn.

The historical layers are Cloud-Optimized GeoTIFFs in EPSG:3857, which is all `src/cog.js` draws.
It reads each COG block once, from its own URL so the browser fetches them side by side, decodes it in a worker, and keeps it for every map tile that needs it; [docs/loading-performance.md](docs/loading-performance.md) says why.
The map is [MapLibre GL JS](https://maplibre.org/), whose WebGL renderer gives smooth raster-opacity crossfades.

## For GIS users

| address | for |
|---|---|
| `https://hapmap.app/stac/catalog.json` | STAC clients: QGIS, `pystac`, `rstac`, `odc-stac` |
| `https://hapmap.app/browse/` | STAC Browser: footprints, thumbnails, metadata, download links |
| `https://hapmap.app/cog/<key>` | streaming with `/vsicurl/` in QGIS or GDAL |

Each Blag Map mosaic is published twice: in Web Mercator for the map, and on its own grid (GDA2020 / MGA 55) for analysis, with its `source_frame`, `overlap_count` and tie points.

## Branches and deploying

- `main` is production: `npm run deploy` builds and deploys the `hapmap` Worker.
- `dev` is the dev site: `npm run deploy:dev` builds and deploys `hapmap-dev` (`https://hapmap-dev.u5007063.workers.dev`).
- Promotion is a pull request from `dev` into `main` on Gitea (`claude-agent/hap-mapper`).

To add an imagery year, describe the mosaic in hap-mosaics' `mosaics.yaml` with `publish: true`, and run its `build_stac.py` and `publish.py`.
It appears on both sites at once; to keep it off production while it is checked on dev, add its item ID to `exclude` in `layers.yaml` on `main`.
