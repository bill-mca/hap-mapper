# What is in the R2 bucket

This is the register of everything stored in the `hap-mapper-tiles` R2 bucket.
For each object, it says how big it is, where it came from, and whether hapmap.app shows it.
Update it whenever an object is added, replaced or deleted, in the same commit as the page change that goes with it.

Last checked: 7 October 2026, by listing the bucket with `rclone lsl gudgenby-r2:hap-mapper-tiles` and fetching both deployed pages.

## How the site reads the bucket

Both Workers bind the bucket as `BUCKET` and serve COGs from it same-origin at `/cog/<key>`, through the range proxy in `worker/cog-proxy.js`.
The proxy exists because Cloudflare will not serve byte ranges for objects over 512 MB from a custom domain.

- **Production** is the `hapmap` Worker (`wrangler.jsonc`), serving `index.html`. It was last deployed on 21 September 2026, and the page it serves is byte-identical to `index.html` at `bbe3593`.
- **Dev** is the `hapmap-dev` Worker (`wrangler.dev.jsonc`) at `https://hapmap-dev.u5007063.workers.dev`, serving `dev/index.html`. It was last deployed on 29 September 2026. Both files are gitignored, so the dev layer list lives only on hectar and in the deployed Worker.

The bucket is also attached to the custom domain `tiles.hapmap.app`.
Nothing in any repo on hectar uses that domain any more.

The production page was checked through `hapmap.u5007063.workers.dev`.
On 7 October, `https://hapmap.app` itself reset the connection from hectar, so the custom domain could not be checked from here.

## The bucket today

The bucket holds 32.9 GB in 100,972 objects.
Sizes are in decimal gigabytes.

| key | size | uploaded | shown on |
|---|---|---|---|
| `cog/north-canberra-1955-cac80-3857.tif` | 14.36 GB | 2026-09-21 | **prod and dev** (1955) |
| `cog/canberra-1980-soc195-3857.tif` | 8.60 GB | 2026-09-29 | **dev** (1980) |
| `cog/canberra-1980-soc276-3857.tif` | 7.38 GB | 2026-09-09 | **prod** (1980) |
| `north-canberra-1955/{14..20}/…` (XYZ pyramid, 100,966 tiles) | 1.23 GB | 2026-03 | nothing |
| `cog/north-canberra-1955-odm-3857-jpeg.tif` | 0.72 GB | 2026-07-14 | nothing |
| `cog/north-canberra-1955-cac80-large.tif` | 0.57 GB | 2026-05-15 | nothing |
| `cog/canberra-1926-map3584-3857.tif` | 0.01 GB | 2026-09-29 | **dev** (1926) |

### Provenance

**`cog/north-canberra-1955-cac80-3857.tif`** is the complete 1955 CAC80-81-88 campaign.
It has 239 frames, restituted by MicMac on Gadi at 0.15 m.
It was reprojected from `~/hap-mosaics/CAC80-81-88_239frames_micmac-gadi_gray_modified.tif`, the hand-georeferenced copy in EPSG:7855 (commit `343daf7`).
This is inferred from two things: its western edge matches that file's to the hundredth of a second, and it was made 95 minutes after that file.
It is panchromatic with NoData=0.
The `~/hap-mosaics` README warns of about 13 m of internal distortion against 1980 that no affine transformation removes, and of two no-data gaps over Woden and Weston.
Local copy: `~/hap-mosaics/derived/`.

**`cog/canberra-1980-soc195-3857.tif`** is the 195-frame SOC276-279 block, made by ODM on Gadi from frames downsampled to 8,000 px (0.32 m).
The ODM output was 27% too large and turned 1.5°.
It was fitted to ACT 2025 imagery by a scale search, then an affine fit, then a thin-plate spline; the working files are in `~/hap-mosaics/coreg/soc195/`.
It is RGB.
Local copy: `~/hap-mosaics/derived/`.

**`cog/canberra-1980-soc276-3857.tif`** is the 27-frame SOC276/277 MicMac colour run at ZoomF=2 (commit `06a5fe1`).
**It sits about 200 m out of place** (+110 m E, +170 m N, a 0.15° turn and +1,368 ppm of scale), as measured on 21 September, twelve days after it was uploaded.
This is the 1980 layer the public site shows.
Local copy: `~/hap-mosaics/derived/`.

**`north-canberra-1955/{z}/{x}/{y}`** is the XYZ tile pyramid for zooms 14 to 20 that the old Leaflet site used (commit `284d151`).
Nothing has read it since the move to MapLibre and COGs in June.

**`cog/north-canberra-1955-odm-3857-jpeg.tif`** is the 160-frame ODM ortho of 1955, reprojected to 3857 and JPEG-compressed.
It was the dev layer in July and was superseded by the full CAC80-81-88 mosaic on 21 September.

**`cog/north-canberra-1955-cac80-large.tif`** is the first 1955 COG, from the Leaflet and georaster days (commit `dbd36c0`).
It is in UTM 55S (EPSG:32755), which `maplibre-cog-protocol` refuses to draw.

**`cog/canberra-1926-map3584-3857.tif`** is 32 MAP3584 *preview* frames (about 3.5 m a pixel), run through MicMac on Gadi.
It was fitted to the hand-georeferenced 1955 mosaic with a similarity transform: a turn of −0.62°, +3.7% scale and a median residual of about 7 m.
The dev page's own comment calls it "a placeholder until full scans exist".
The working files are in `~/hap-mosaics/coreg/map3584/`.

## Waiting to go in

These are the Blag Map mosaics (`~/repos/blag-map`, the camera-and-DEM pipeline), made between 2 and 7 October 2026.
None is in the bucket yet.
All are in GDA2020 / MGA 55 (EPSG:7855) with NoData=0 and internal overviews, so each needs reprojecting to 3857 before upload.
Sizes are as they sit on disk.

| mosaic | year | ground | GSD | size | reference it was fitted to | supersedes |
|---|---|---|---|---|---|---|
| `out/map3584_1926_fullres/mosaic/mosaic.tif` | 1926 | central Canberra, 32 full scans of MAP3584 | 1 m, grey | 140 MB | hand-georeferenced 1955 mosaic | `canberra-1926-map3584-3857.tif` |
| `out/act1944/mosaic/mosaic.tif` | 1944 | 1,263 km² of the ACT, MAP658 and MAP753 previews | 5 m, grey | 60 MB | ACT 2004 and 2012 imagery | nothing; a new year |
| `out/map1537_1945_fullres/mosaic/mosaic.tif` | 1945 | inner city, full scans of MAP1537 | 0.5 m, grey | 380 MB | hand-georeferenced 1955 mosaic | nothing; a new year |
| `out/act1974-75/mosaic/mosaic.tif` | 1974–75 | 2,119 km² of the ACT, CAS896, 898, 919 and 920 previews | 4 m, grey | 184 MB | ACT 2004 and 2012 imagery | nothing; a new year |
| `out/soc1980_previews/mosaic_ortho_2p5_ff/mosaic_ortho.tif` | 1980 | the whole February 1980 SOC flight, about 45 km, from previews | 2.5 m, RGB | 490 MB | ACT 2004 and 2012 imagery | `canberra-1980-soc276-3857.tif` outright; `canberra-1980-soc195-3857.tif` on placement and tone, though not on sharpness |

Known faults, from `~/repos/blag-map/progress.md`:

- **1944** has a 1.5 by 2 km hole east of the inner south, where MAP658 frames 12876–12878 were never scanned. There is also a strip of film rebate on the western edge, and haze with hot spots on MAP753.
- **1974–75** drifts in tone from hazy in the west to contrasty in the east.
- **1980** has two gaps where frames could not be located. Its tone is otherwise even across the whole flight.

There is no Blag Map mosaic of 1955 yet, so the deployed 1955 layer has nothing to replace it.
