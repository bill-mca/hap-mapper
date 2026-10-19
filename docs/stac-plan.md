# Plan: a STAC catalog behind the map

Written 7 October 2026.
This document says how a catalog of the mosaics can drive hapmap.app, deploy it, serve GIS users, and let a visitor click any pixel to find the photograph it came from.
All of it was built on the evening of 7 October 2026; the section below, "As built", says where it departs from the plan.

## Where things stand

Every mosaic in `~/hap-mosaics` on hectar is now described in a [STAC](https://stacspec.org) catalog: 21 items in six collections, one collection per flying campaign.
The catalog validates against the STAC schemas.

The parts are these:

- `metadata/mosaics.yaml` holds what cannot be read off a raster: flight dates, films, PBS jobs, how each mosaic was georeferenced, its known faults, its status, and its R2 key.
- `metadata/build_stac.py` measures every file and writes the catalog.
  It records each mosaic's footprint, CRS, grid, bands, ground pixel size, SHA-256 and a thumbnail.
- `stac/` is the catalog, with relative links so it travels with the files.
- `CATALOG.md` is a readable summary, rebuilt each time.

Each item keeps two times apart.
`start_datetime` and `end_datetime` say when the photographs were flown, from GA's catalogue.
`created` says when the mosaic was made.

The 1968 Blag Map mosaic reached the site after the catalog was built, and is not in it yet.

## What the catalog can do for the site

- **Build the timeline.**
  `IMAGERY_YEARS` is a hand-kept list of year, R2 key, grey or colour, and label.
  All of that is in the catalog, so the list can be generated, and adding a year becomes a metadata change.
- **Show where each year has imagery.**
  Every item carries its footprint, so the timeline can grey out years with nothing in view, or outline a year's coverage on hover.
- **Say what each layer is.**
  Flight dates and films, frame count, pixel size, known faults, and a plain statement of how it was placed: for instance, that 1955 was moved into place by hand.
- **Write the attribution.**
  GA's CC BY 4.0 notice and the film numbers come from the metadata for every layer.
- **Point GIS users at the data**, as described below.

## Facts do not branch; the layer list does

The catalog holds two kinds of information, and only one of them belongs on a branch.

Facts about a mosaic are true or false, never "dev" or "prod": when 1955 was flown, that it sits about 220 m out of place, its checksum.
They live in a `hap-mosaics` repository on Gitea, on `main` only.
The repository tracks the metadata, the builder and the generated catalog; the rasters stay out of git.

What the site shows is exactly what differs between dev and prod.
It lives here, in hap-mapper, as a short `layers.yaml` listing the item IDs to show.
The timeline year and label come from each item's flight dates, so `1974–75` need not be written down.

- `main` is production; it deploys the `hapmap` Worker.
- `dev` is the dev site; it deploys `hapmap-dev`.
- Promotion is a pull request from `dev` into `main` on Gitea.

Each deploy builds the site's catalog from `layers.yaml` and the item metadata, and bundles it into the Worker's static assets.
Each Worker then serves the catalog it was deployed with, so dev and prod cannot drift apart through anything shared.
The site's catalog is a few megabytes, well within Workers' asset limits.

The `hap:hapmap.sites` field in `mosaics.yaml` goes away when this is built.

## R2 keys never change in place

Both Workers read one bucket, so a branch isolates anything only if objects never change once uploaded.

- An improved mosaic gets a new key, never an overwrite.
  The present naming (`-blag-` in the key) already does this; the publish script will refuse to overwrite.
- Uploading is a step of its own, with no branch.
  A script on hectar pushes any raster that `mosaics.yaml` marks for publishing and R2 does not yet hold, checking size and checksum.
  A dev branch can then refer to a new key without prod ever seeing it.
- Nothing is deleted automatically.
  The script lists objects that neither `main` nor `dev` refers to; deleting them stays a person's decision, because R2 deletion cannot be undone.

Only the upload step needs the rasters, so only it has to run on hectar.
Site deploys could later move to a Gitea Actions runner with a Cloudflare token.

## A public catalog for GIS users

The Worker in `worker/cog-proxy.js` already serves any R2 key with byte ranges and `Access-Control-Allow-Origin: *`.
So a catalog uploaded to R2 under `stac/` is reachable by browsers and GIS tools without touching the Worker.

| address | for |
|---|---|
| `https://hapmap.app/stac/catalog.json` | STAC clients: QGIS's browser panel, `pystac`, R's `rstac`, `odc-stac` into xarray |
| `https://hapmap.app/browse/` | STAC Browser, a static app: footprints on a map, thumbnails, metadata, download links |
| `https://hapmap.app/cog/<key>` | streaming with `/vsicurl/` in QGIS or GDAL, which reads only the tiles in view |

The web copy of the catalog is the same catalog with its asset links rewritten to `https://hapmap.app/cog/…`, holding only the items that are published.

## Clicking a pixel to find its photograph

Blag Map records, for every pixel of a mosaic, which frame supplied it.
The aim is that a visitor clicks the map and sees which photograph that spot came from, when it was taken, and how it was put in place.

### What goes into the catalog

For each Blag Map mosaic, the original-grid mosaic joins `~/hap-mosaics` as an item of its own, with the Web Mercator COG linked to it as `derived_from`.
Two of Blag Map's layers go with it as assets:

- `source_frame.tif`, which frame each pixel came from;
- `overlap_count.tif`, how many frames cover each pixel.

They are copied, not referenced, because `blag-map/out/` is a workspace and a re-run would overwrite them.

`footprints.gpkg` is not kept.
Nothing reads it but a person in QGIS, and what the click needs is in the catalog.

### One stable ID per frame: GA's GFID

Film and frame number do not identify a photograph in GA's catalogue.
In the March 2026 release, 10,613 film-and-frame pairs occur more than once, and even with the run number added 2,068 still do.
GA's `GFID` ("Global ID") is unique for all 1,192,731 records, and was the same in the June 2025 and March 2026 releases for the frames checked.
It is the UID, written without its braces.

### What the mosaic carries: three fields a frame

The STAC classification extension labels the values of `source_frame.tif`:

```json
{"value": 7, "name": "FC97BDE4-8F74-443D-870B-4142D74257E0",
 "title": "MAP658 frame 12898", "hap:date": "1944-12-16"}
```

The link is not repeated per frame; one template on the asset builds it:

```json
"hap:frame_href": "https://hapmap.app/frames/{name}.json"
```

That is about 100 bytes a frame.

The date is the most interesting field, and it is per frame for a reason: the 1974–75 mosaic mixes four flights over four months, so each pixel can name its own day.
GA records the day only, never the hour; every `DATE_START` reads `00:00:01`.
Some films carry only a year (1926) or no day (CAC81), so `hap:date` keeps GA's precision rather than inventing a 1 January.

### The frame records: a small copy of GA's catalogue

GA publishes its catalogue as a downloadable geodatabase, not as a service, and publishes each scan at a URL.
We host a record for each frame our mosaics use, as a STAC item at `hapmap.app/frames/<GFID>.json`, holding:

- GA's photo centre;
- date, film, run, frame, camera and scale, and the licence;
- links out to GA's full scan and its preview JPEG.

GA's scan URLs pad frame numbers inconsistently from film to film, so a URL built from film and frame can return 403.
Blag Map has already fetched every frame it used, so the records can carry the working URL.

That is about 1 KB a frame, a few megabytes in all.
STAC Browser turns each record into a page, and the popup can show GA's preview directly, since an `<img>` needs no CORS.

### What a click does

1. The page reads one pixel of `source_frame.tif` under the cursor, with a single range request.
2. It looks the value up in the classes and shows the title and date at once.
3. A link opens the frame's record.

The click needs a Web Mercator copy of `source_frame.tif` on the site's grid, resampled by nearest neighbour so frame numbers stay whole.
Its overviews must be built by nearest neighbour too.
Blag Map currently builds every overview with `AVERAGE`, which turns two neighbouring frames 12 and 14 into a meaningless 13 when zoomed out; blag-map backlog B52 fixes that.

## Showing how each frame was placed

Blag Map places each frame by matching it to a reference and resecting its camera.
It keeps the evidence, and the popup can show it.

### What is recorded

Per frame, in `locate/results.csv` and `resect/cameras.csv`: the points matched and the points the resection kept, the fit on the ground (`rms_ground_m`, 9.5 m median on 1944), the positional uncertainty, the camera tilt, how far GA's photo centre was from where the frame landed, what it was matched against, and whether it was resected or "rescued" from its neighbours.

Per point, in `locate/tie_points.npz`: the pixel on the photograph and the matching ground position.
For 1944 that is 103 frames in 1.4 MB.

Each point's residual, and whether the resection kept or rejected it, are computed in `resect.py` and then thrown away.
Keeping them is blag-map backlog B51.

### What the visitor sees

At a glance, in the popup:

> **MAP658 frame 12901** · 16 December 1944
> Placed by 180 of 195 points matched to ACT 2004/2012 imagery; fits to about ±6 m.
> GA's catalogue had this photo 96 m from where it belongs.
> [Show tie points] · [View photograph]

On request, the evidence itself:

- on the map, the frame's tie points as dots coloured by fit, with rejected points faint;
- on GA's preview, the same points where they fall on the photograph.

The reference line matters most.
The 1926 and 1945 frames were matched to the hand-corrected 1955 mosaic, so "±6 m" there means six metres from something that may itself be off.

### Where it fits

How a mosaic used a photograph belongs to the mosaic, not to the photograph, so none of it goes in the frame records.
Two more assets go on each Blag Map mosaic item, loaded only on a click:

| asset | holds | used for | size |
|---|---|---|---|
| `frame_fit` (JSON, keyed by GFID) | per frame: points, kept, fit, uncertainty, tilt, catalogue offset, reference, how placed | the popup text | ~0.2 KB a frame |
| `tie_points` (GeoParquet) | every point: GFID, u, v, E, N, residual, kept | GIS users and analysis | ~1 MB a mosaic |
| `ties/{name}.json` (web copy only) | the same points split by frame | "Show tie points" | 5–10 KB a frame |

MicMac and ODM tie frames to each other, not to the ground, so their mosaics can show a frame and its date but no evidence of placement.
Those are also the mosaics with the 200 m errors.

## Storage

| | size |
|---|---|
| The catalog as built, with thumbnails | 5.6 MB |
| Original-grid Blag Map mosaics, the five in the first build | ~1.25 GB |
| `source_frame` and `overlap_count` for those five | ~30 MB |
| Frame classes, frame records, `frame_fit` and tie points | ~25 MB |
| Native SfM mosaics, if published for GIS users | ~100 GB, about US$1.50 a month in R2 |

R2 charges nothing for egress.
The 1968 mosaic adds its share to each line.

## Steps

1. **hap-mosaics:** make it a Gitea repository; add the 1968 mosaic; drop `hap:hapmap.sites`.
2. **blag-map:** B51 (keep each tie point's residual and fate, and each frame's GFID) and B52 (nearest-neighbour overviews for label rasters).
3. **hap-mosaics:** add the original-grid Blag Map mosaics with `source_frame`, `overlap_count`, `frame_fit` and `tie_points`, and generate the frame records.
4. **Publish script** on hectar: upload what is missing, write the web catalog, report orphans, never delete.
5. **hap-mapper:** `layers.yaml`, a build step that turns it into the timeline, and the `dev` branch and Gitea remote.
6. **hap-mapper:** the click popup and the tie-point view.
7. **Public catalog:** `stac/` on R2, then STAC Browser at `/browse/`.

## As built (7 October 2026)

Every step above is done, and hapmap.app runs on it.
Where the build departs from the plan, or found something the plan did not know:

- **Frame records live at `hapmap.app/stac/ga-frames/<GFID>.json`**, not `/frames/`, so that they sit inside the catalog and STAC Browser reaches them without a Worker route of its own.
- **Tie points are larger than guessed.** The matcher keeps about two thousand points a frame, so a frame's tie file is about 90 KB, not 5–10 KB, and the six mosaics' tie points come to 154 MB as GeoParquet.
- **The 1980 `source_frame` was 8-bit.** That run predates Blag Map's 16-bit labels, so every frame past the 254th read as 255. Those pixels were given to the nearest camera nadir among frames 255–786, which is how Blag Map draws seams before refining them; near a seam between two late frames the popup may name the neighbour. A re-run of the mosaic would make it exact, and is in the backlog.
- **The 1926 and 1945 frames were matched as restituted scans**, cropped to their fiducial marks, so their tie points cannot be laid on GA's preview. The popup says so and shows them on the map only. The preview-frame years (1944, 1968, 1974–75 and 1980) show them on the photograph too.
- **GA pads frame numbers in three ways**: most films not at all, SOC278 to three digits, CAS898 to two. The probe tries every width on a film's shortest frame numbers.
- **The `derived/` copy of the 1968 COG was the first, banded upload**, not the colour-balanced one R2 serves. `publish.py` refused to overwrite R2 with it; `derived/` now holds R2's copy.
- **GA's catalogue now gives CAC81 its days** (3 and 4 November 1955); the 1955 collection's description still says the day is missing, and should be corrected.
- **GA's previews load in an `<img>`** on hapmap.app: the CloudFront rule that blocks scripts accepts an ordinary browser.

The code is in three places:

- blag-map, branch `stac-b51-b52` (pull request 3 on Gitea): B51, B52, the GFID matcher, the backfill and the patch origins.
- hap-mosaics (`claude-agent/hap-mosaics` on Gitea): `ingest_blag.py`, `build_stac.py` and `publish.py`.
- hap-mapper: `layers.yaml`, `scripts/build.mjs`, `scripts/build-browser.sh` and the popup in `index.html`.

## Open decisions

- **Which mosaics go public?**
  R2 holds only Web Mercator COGs today.
  GIS users would rather have the native UTM and MGA mosaics, at about 100 GB.
- **Publish mosaics whose placement is known to be wrong?**
  The recommendation is yes, with the warning prominent, since the warning is the honest record.
- **Workers Paid?**
  Panning a large COG makes many small requests, and the free plan's 100,000 a day could run out under a few keen QGIS users; the paid plan is $5 a month for 10 million.
- **A separate data domain?**
  `data.hapmap.app` would keep the data service apart from the map, now that `tiles.hapmap.app` is going.
- **Frame-level search later?**
  The whole GA catalogue (361 MB as a geodatabase) could become a static GeoParquet or PMTiles file on R2, to answer "every photograph of this spot" without a server.
