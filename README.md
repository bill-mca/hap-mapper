# hap-mapper

A [topotijdreis.nl](https://www.topotijdreis.nl/)-style time-travel webmap for the Hap-Map project, showing historical aerial photography of Canberra at [hapmap.app](https://hapmap.app).

Drag the year handle on the timeline, or press the play button, to crossfade between imagery years.
Years with imagery are marked with orange dots: 1926, 1944, 1945, 1955, 1968, 1974–75, 1980 and 2025 (Esri World Imagery).
1955 is the complete CAC80-81-88 campaign, restituted with MicMac and placed by hand; the others are Blag Map mosaics of Geoscience Australia's historical aerial photography.

Click the map on a Blag Map year to see which photograph that spot came from, the day it was flown, and how it was put in place.
From there you can show its tie points on the map, or on the photograph itself.
"About this layer" says what the current year is, how it was placed, and what is known to be wrong with it.

## How it fits together

- **The layers** are listed by catalog ID in [`layers.yaml`](layers.yaml).
  Everything else about them comes from the hap-mosaics STAC catalog (`claude-agent/hap-mosaics` on Gitea, `~/hap-mosaics` on hectar): the R2 key, grey or colour, the flight dates that give the timeline year and label, and which photograph made each pixel.
- **The build**, `npm run build`, joins the two into `dist/layers.json`, copies `index.html`, and builds [STAC Browser](https://github.com/radiantearth/stac-browser) into `dist/browse/`.
  It reads the catalog from `~/hap-mosaics/web/stac` when that is there, and from `https://hapmap.app/stac` otherwise.
- **The Worker**, `worker/cog-proxy.js`, serves `dist/` and range-proxies everything else out of the R2 bucket: the COGs at `/cog/…` and the public catalog at `/stac/…`.
- **The bucket** is kept by hap-mosaics' `publish.py`, which uploads what is missing, writes the public catalog, and never overwrites or deletes.
  [docs/r2-inventory.md](docs/r2-inventory.md) is the register of what is in it.

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
Then add the item ID to `layers.yaml` on `dev`, deploy, look, and open the pull request.
