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
- [ ] Deploy `dev` so `hapmap-dev` shows the v2 1962–63 and 1990 mosaics, then delete the superseded v1 objects: four COGs, their four `source-frame` files and the eight leftover v1 records under `stac/` (1.44 GB).

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

## Later

- [ ] A Blag Map run of the 1955 CAC campaign against the 2004 and 2012 reference, to test the hand-corrected 1955 layer and perhaps replace it.
- [ ] Full-scan Blag Map runs of 1980 and 1974–75, for sharpness at street zoom.
- [ ] The 1962–63, 1968, 1985, 1990 and 1992 sets, once Blag Map has run them.
- [ ] Find out why `https://hapmap.app` resets connections from hectar while the `workers.dev` address works.
