# hap-mapper

A [topotijdreis.nl](https://www.topotijdreis.nl/)-style time-travel webmap for the Hap-Map project, showing historical aerial photography of Canberra at [hapmap.app](https://hapmap.app).

Drag the year handle on the timeline, or press the play button, to travel through the years.
The handle can rest on any year.
The map then shows every mosaic flown that year where it has imagery, the sharpest on top, and where nothing was flown that year, the most recent earlier photograph shows through.
An orange dot marks each year with imagery in view, so the dots change as the map moves.
A dot turns grey when the map is zoomed in past that year's sharpest photographs in view, so that each of their pixels is wider than a pixel of the screen; the handle turns grey the same way for what is drawn.
The line under the title says when the map is showing an earlier year than the handle.
The present day, at the top of the timeline, is Esri World Imagery.
Under every other year the OpenStreetMap street map shows wherever there are no photographs.

The search box at the top finds a present-day place through Nominatim, using MapLibre's geocoder plugin, and flies the map there.

Click the map to see which photograph that spot came from and the day it was flown.
"View photograph" opens GA's preview of it, with a link to download the full scan; clicking the preview opens it in a new tab.
"About this layer" says what each mosaic on screen is, how it was placed, and what is known to be wrong with it.
The credit line at the bottom names only what is on screen, with a link to each mosaic's catalog record.

[docs/specification.md](docs/specification.md) is bilby's specification for the site; it can be ahead of or behind what is built.

## How it fits together

- **The layers** come from the hap-mosaics STAC catalog (`claude-agent/hap-mosaics` on Gitea, `~/hap-mosaics` on hectar), which the page reads in the browser at `/stac/`.
  Every Web Mercator mosaic served from hapmap.app is a layer, filed under the year its flying started, so a newly published mosaic appears on the next page load, with no deploy.
- **[`layers.yaml`](layers.yaml)** names the catalog items the site leaves out, the present-day layer, and the street map underneath.
  It is what differs between production and dev.
- **The build**, `npm run build`, turns `layers.yaml` into `dist/site.json`, copies `index.html`, and builds [STAC Browser](https://github.com/radiantearth/stac-browser) into `dist/browse/`.
- **The Worker**, `worker/cog-proxy.js`, serves `dist/` and range-proxies everything else out of the R2 bucket: the COGs at `/cog/…` and the public catalog at `/stac/…`.
- **The bucket** is kept by hap-mosaics' `publish.py`, which uploads what is missing, writes the public catalog, and never overwrites or deletes.
  [docs/r2-inventory.md](docs/r2-inventory.md) is the register of what is in it.

For each year and view the page draws as few mosaics as it can: newest year first and the sharpest first within a year, skipping older mosaics that would add less than 2% of the view, and stopping once the view is covered.
[docs/timeline-plan.md](docs/timeline-plan.md) has the design and the numbers.
From the browser console, `hapmap.stack()` lists what is drawn.

The historical layers are Cloud-Optimized GeoTIFFs in EPSG:3857, because [`@geomatico/maplibre-cog-protocol`](https://github.com/geomatico/maplibre-cog-protocol) draws nothing else.
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
