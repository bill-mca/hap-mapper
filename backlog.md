# Backlog

## Clean up the bucket and upgrade the mosaics

The steps are spelled out in [docs/mosaic-upgrade-plan.md](docs/mosaic-upgrade-plan.md).
What is in the bucket is in [docs/r2-inventory.md](docs/r2-inventory.md).

- [x] Settle the four decisions in the plan: the 1980 layer, 1944 beside 1945, the 1974–75 label, and the `tiles.hapmap.app` domain.
- [x] Delete the Leaflet tile pyramid and the two retired 1955 COGs (2.5 GB).
- [x] Reproject the five Blag Map mosaics to 3857 COGs and upload them.
- [x] Try the new layers on `hapmap-dev`.
- [x] Carry them into `index.html`, fix the README, and deploy to production.
- [x] Delete the misplaced SOC276 1980 COG and the preview-frame 1926 COG.
- [ ] Delete the SOC195 1980 COG once a full-scan Blag Map 1980 replaces it.
- [x] Detach `tiles.hapmap.app` from the bucket (14 October 2026).
- [x] Deploy `dev` so `hapmap-dev` shows the v2 1962–63 and 1990 mosaics, then delete the superseded v1 objects: four COGs, their four `source-frame` files and the eight leftover v1 records under `stac/` (1.44 GB, 14 October 2026).

## A STAC catalog behind the map

The design is in [docs/stac-plan.md](docs/stac-plan.md).
The catalog itself lives in `~/hap-mosaics` on hectar.

- [x] Catalog every mosaic in `~/hap-mosaics` as STAC, with a builder and a readable index.
- [x] Make `hap-mosaics` a Gitea repository, add the 1968 mosaic, and drop `hap:hapmap.sites`.
- [x] blag-map B51 and B52: keep tie-point residuals and GFIDs; nearest-neighbour overviews for `source_frame.tif`.
- [x] Add the original-grid Blag Map mosaics with `source_frame`, `overlap_count`, `frame_fit` and `tie_points`, and generate the frame records.
- [x] A publish script on hectar: upload what is missing, write the web catalog, report orphans, never delete.
- [x] `layers.yaml`, a build step that turns it into the timeline, a `dev` branch, and a Gitea remote.
- [x] The click popup: frame, date, link to its record, and the tie-point view.
- [x] Publish the catalog to `stac/` on R2, then STAC Browser at `/browse/`.
- [ ] Re-run the 1980 mosaic with today's Blag Map, so its `source_frame` is exact past frame 254 (now reconstructed by nearest camera nadir).
- [ ] Separate the 1944 and 1945 dots on the timeline: they overlap, so a click on 1944 lands on 1945.
- [ ] Deploy `dev` to `hapmap-dev`, retiring the old gitignored `dev/index.html` and its ACTmapi evaluation layers once bilby has finished with them.

## The page reads the catalog; the timeline shows any year

The design is in [docs/timeline-plan.md](docs/timeline-plan.md); three questions in it wait on bilby.

- [ ] hap-mosaics: `publish.py` writes `stac/web-items.json`, a slim ItemCollection of the Web Mercator items, linked from `catalog.json`.
- [ ] hap-mosaics: mark the benchmark runs and mosaics (SOC195) to keep off the site.
- [x] Page: load the catalog; for the chosen year, stack every mosaic in view from that year or before, newest year then finest on top; stop once the view is covered, and skip mosaics that add less than 2% of it.
- [x] Page: one dot per year with imagery in view; free slider; keys and play over the lit years.
- [x] Page: click and "About this layer" taken from the drawn stack.
- [x] Slim `layers.yaml` to `exclude` and the base layer, and `scripts/build.mjs` to `/site.json`; deployed to `hapmap-dev` (19 October 2026).
- [ ] bilby: pick the Proof, Memory and Steel runs, and say whether current mosaics should beat benchmark runs of similar sharpness.
- [ ] Cut unscanned holes out of the footprints in hap-mosaics, so older years show through them.
- [ ] Cull tiles hidden under the layers above, once a culled tile can be reloaded when the stack changes.
- [x] Promote to production: Gitea PR #2 merged, and `main` deployed by hand to `hapmap` (version 4409e8bf, 19 October 2026).
- [ ] Fix the Workers Builds auto-deploy from GitHub `main`: build 671e78a9 failed, probably for want of `npm run build` as its build command.

## The spec-candidate features, on dev

Ported by hand from `candidate/spec-pass` onto the stacked timeline (19 October 2026).

- [x] Bring bilby's `docs/specification.md` and `CLAUDE.md` onto `dev`.
- [x] No tie points anywhere, and a popup with just the photograph's name, date, "View photograph" and its record.
- [x] Clicking the preview opens it in a new tab; the caption links the full scan.
- [x] The subtitle, in the title card and the page description.
- [x] A search box at the top: MapLibre's geocoder plugin asking Nominatim.
- [x] OpenStreetMap under every year; the present day only in 2025.
- [x] A credit line for only what is on screen, linking each mosaic's catalog record.
- [x] Grey dots for years zoomed in past their sharpest mosaic in view, and a grey handle when everything drawn is.
- [x] Drop the title card, its "Showing …" line and the "About this layer" panel; the subtitle lives in the page title instead.
- [x] Draw the older years showing through at 40% opacity, so the newest year drawn reads as the main layer.
- [ ] bilby: the favicon.
- [x] The spec's unobtrusive loading cue: a small spinner in the middle of the map while tiles, the catalog, a search or a photograph are loading.

## Later

- [ ] A Blag Map run of the 1955 CAC campaign against the 2004 and 2012 reference, to test the hand-corrected 1955 layer and perhaps replace it.
- [ ] Full-scan Blag Map runs of 1980 and 1974–75, for sharpness at street zoom.
- [ ] The 1962–63, 1968, 1985, 1990 and 1992 sets, once Blag Map has run them.
- [ ] Find out why `https://hapmap.app` resets connections from hectar while the `workers.dev` address works.
