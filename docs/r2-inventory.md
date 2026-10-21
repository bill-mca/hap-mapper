# What is in the R2 bucket

This is the register of everything stored in the `hap-mapper-tiles` R2 bucket.
For each object, it says how big it is, where it came from, how it was put in place on the map, and whether hapmap.app shows it.
It covers only what is in the bucket.
Update it whenever an object is added, replaced or deleted, in the same commit as the page change that goes with it.

Last checked: 7 October 2026, by listing the bucket with `rclone lsl gudgenby-r2:hap-mapper-tiles` and loading every layer of both deployed pages in a headless browser.

Since the evening of 7 October the bucket is kept by `publish.py` in the hap-mosaics repository (`~/hap-mosaics/metadata/`), which uploads whatever `mosaics.yaml` marks for publishing, writes the public STAC catalog under `stac/`, and lists any object nothing refers to.
It never overwrites a key or deletes anything.
The hap-mosaics catalog is now the full record of what each object is; this register keeps the history and the reasoning.

## How the site reads the bucket

Both Workers bind the bucket as `BUCKET` and serve any key same-origin at `/<key>`, through the range proxy in `worker/cog-proxy.js`: the COGs at `/cog/…` and the catalog at `/stac/…`.
The proxy exists because Cloudflare will not serve byte ranges for objects over 512 MB from a custom domain.

- **Production** is the `hapmap` Worker (`wrangler.jsonc`), serving the built `dist/` from the `main` branch (or, on 7 October, from `feat/stac-catalog`).
- **Dev** is the `hapmap-dev` Worker, now `wrangler.jsonc`'s `dev` environment, built from the `dev` branch. Until it is next deployed it still serves the old gitignored `dev/index.html` from `wrangler.dev.jsonc`, with ACTmapi layers that are not in the bucket.

Both were deployed on 7 October 2026.

The bucket has no public address of its own; it is reached only through the two Workers.
It was once attached to two custom domains as public handles.
`tiles.hap-mapper.app` was detached on 7 October 2026.
`tiles.hapmap.app` was detached on 14 October 2026, after a week in which only scanners and robots asked it for anything.
The bucket's public `r2.dev` URL is off.

## The bucket today

The bucket holds 25.3 GB in 8 objects.
Sizes are in decimal gigabytes.

| key | year | size | uploaded | shown on |
|---|---|---|---|---|
| `cog/north-canberra-1955-cac80-3857.tif` | 1955 | 14.36 GB | 2026-09-21 | prod and dev |
| `cog/canberra-1980-soc195-3857.tif` | 1980 | 8.60 GB | 2026-09-29 | nothing; kept until a full-scan Blag Map 1980 replaces it |
| `cog/act-1968-cacc4-c15-blag-3857.tif` | 1968 | 1.14 GB | 2026-10-07 | prod and dev |
| `cog/canberra-1980-soc276-279-blag-3857.tif` | 1980 | 0.52 GB | 2026-10-07 | prod and dev |
| `cog/canberra-1945-map1537-blag-3857.tif` | 1945 | 0.37 GB | 2026-10-07 | prod and dev |
| `cog/act-1974-75-cas896-920-blag-3857.tif` | 1974–75 | 0.18 GB | 2026-10-07 | prod and dev |
| `cog/canberra-1926-map3584-blag-3857.tif` | 1926 | 0.13 GB | 2026-10-07 | prod and dev |
| `cog/act-1944-map658-753-blag-3857.tif` | 1944 | 0.06 GB | 2026-10-07 | prod and dev |

Every object is an EPSG:3857 COG with 512 px blocks, DEFLATE compression and internal overviews.
Edges are transparent through NoData=0 in the grey files and through an alpha band in the colour ones.

### Web copies of the map's mosaics (21 October 2026)

`web/<name>.tif` holds a web copy of each Web Mercator COG the map shows, under the same file name as `cog/<name>.tif`: the same pixels on the same grid, re-encoded as RGBA WebP at quality 85, with 512 px blocks and the master's overviews.
A grey master becomes grey RGB, its NoData the alpha band.
They are not in the STAC catalog and `publish.py` did not put them there, so its orphan report lists them; they are derived from the masters, which stay the lossless record at `/cog/` for GIS use.
The Worker marks a catalog item with a `web` asset when its copy is here, and the map draws that instead.
`scripts/web-cogs.py` in this repository makes and uploads them; a changed master should get a web copy under a new name, since browsers keep ranges of a key for a day.

33 objects, 7.6 GB: the colour mosaics shrink eight- to ninefold (1968: 1.14 GB to 0.12 GB), the grey ones about twofold (1955: 14.36 GB to 6.00 GB).

### Added for the STAC catalog and the click popup (7 October 2026)

`publish.py` added 24 objects, 2.40 GB, for the six Blag Map mosaics:

| key pattern | what | total |
|---|---|---|
| `cog/<mosaic>-blag-7855.tif` | each mosaic on its own grid (GDA2020 / MGA 55), as a COG, for GIS users | 2.33 GB |
| `cog/<mosaic>-blag-7855-source-frame.tif` | which photograph made each pixel (16-bit, nearest-neighbour overviews) | 23 MB |
| `cog/<mosaic>-blag-7855-overlap-count.tif` | how many photographs cover each pixel | 19 MB |
| `cog/<mosaic>-blag-3857-source-frame.tif` | the same labels in Web Mercator, read one pixel at a time by the map's click | 24 MB |

It also wrote the public STAC catalog under `stac/`: 3,769 files, 326 MB, with every mosaic on the site, the six above, a record for each of the 1,857 photographs they use (`stac/ga-frames/<GFID>.json`), each mosaic's `frame_fit.json` and `tie_points.parquet`, and each photograph's tie points (`stac/<collection>/<mosaic>-blag-7855/ties/<GFID>.json`).
The tie points are most of it: 154 MB as GeoParquet and 164 MB split by photograph, about 90 KB each, far more than the plan's guess of 5–10 KB, because the matcher keeps two thousand points a frame.

The SOC195 1980 COG is still published, since the plan keeps it until a full-scan Blag Map 1980 replaces it, so `publish.py` does not count it an orphan.

### Superseded 1962–63 and 1990 mosaics deleted (14 October 2026)

The 1962–63 and 1990 Blag Map mosaics were each rebuilt as a `-v2`, and the catalog marked the first versions `publish: false`.
Once `hapmap-dev` was showing the v2s, the sixteen v1 objects went: for each year, the 7855 and 3857 COGs, their two `source-frame` files, and the four records left under `stac/`.
That freed 1.44 GB.
No site, branch or catalog record referred to them.

## How Blag Map georeferences

Six of the files come from Blag Map (`~/repos/blag-map`), so its method is described once here.
Blag Map matches each frame against a reference image to find where it lies.
It then solves the frame's camera against the Copernicus GLO-30 terrain model and orthorectifies the frame through that camera.
Nothing is placed by hand.

The residuals quoted below are the cameras' own fit to their reference matches.
They show how well each block agrees with its reference, not an independent measure of accuracy.
A mosaic can be no better placed than the reference it was matched to.

Each Blag Map mosaic was reprojected from EPSG:7855 to 3857 with `gdalwarp -r cubic` and uploaded unchanged otherwise.

## Each object

### `cog/north-canberra-1955-cac80-3857.tif` (1955)

**Provenance.**
The complete 1955 CAC80-81-88 campaign: 239 frames, restituted by MicMac on Gadi at 0.15 m (commit `343daf7`).
It is panchromatic.
The `~/hap-mosaics` README warns of two no-data gaps over Woden and Weston.
Local copy: `~/hap-mosaics/derived/`.

**Georeferencing: manual.**
MicMac placed the block from GA's catalogue photo-centres, which left it about 220 m out.
bilby then moved it by hand on 21 September, making `~/hap-mosaics/CAC80-81-88_239frames_micmac-gadi_gray_modified.tif`, and this COG was reprojected from that file.
The correction kept the image north-up and unrotated: it shifted the origin by about +44 m E and +234 m N, and stretched the pixel from 0.1500 m to 0.1509 m.
What it was aligned to was not recorded.
A QGIS Georeferencer points file beside the source, dated 29 September, holds 8 ground control points (4 enabled), but it came after this COG and was not applied to it.
The README also reports about 13 m of internal distortion against 1980 that no affine transformation removes, so a shift and a stretch cannot fix every part of the block.

The 1926 and 1945 layers were matched against this mosaic, so any error in it carries into them.

### `cog/canberra-1980-soc195-3857.tif` (1980, not shown)

**Provenance.**
The 195-frame SOC276-279 block, made by ODM on Gadi from frames downsampled to 8,000 px (0.32 m).
It is RGB with an alpha band.
It was the dev site's 1980 layer until 7 October.
It is kept because it is eight times sharper than the Blag Map 1980 layer that replaced it.
Delete it once a full-scan Blag Map run of 1980 exists.
Local copy: `~/hap-mosaics/derived/`.

**Georeferencing: automated.**
The ODM output was 27% too large and turned 1.5°.
Scripts in `~/hap-mosaics/coreg/soc195/` fitted it to the ACT Government's December 2025 imagery (ACTmapi `ACT_Aerial_Imagery_202512`).
They ran a scale search, then an affine fit, then a thin-plate spline on 285 automatically matched control points to take out residual doming.

### `cog/canberra-1980-soc276-279-blag-3857.tif` (1980)

**Provenance.**
The whole February 1980 colour flight, SOC276 to SOC279, from GA's preview images: 786 of 803 frames, at 2.5 m.
It uses flat-field correction, a gain solve and dynamic-programming seams, and bilby judged it the best of the methods tried.
Its tone is even across about 45 km, with two gaps where frames could not be located.
The COG was rebuilt with an alpha band so that its edges draw transparent.
Source: `~/repos/blag-map/out/soc1980_previews/mosaic_ortho_2p5_ff/mosaic_ortho.tif`.

**Georeferencing: automated**, by Blag Map against ACTmapi's 2004–05 urban imagery (150 mm) and, where that runs out, its 2012 imagery (100 mm), resampled to 1.2 m.
The median camera fits its matches to 3.0 m on the ground.

### `cog/act-1968-cacc4-c15-blag-3857.tif` (1968)

**Provenance.**
The 1968 colour cover of the whole ACT and beyond, films CAC/C4 to CAC/C15, from GA's previews: 621 of 792 frames over 3,944 km², at 3 m.
CAC/C16 was left out because GA serves no previews for it.
It uses flat-field correction, dynamic-programming seams, and a tone solve on brightness alone (`--colour-gain luma --gain-prior 50`), so the gains stay within 0.67–1.55 and no hue is invented.
Each film's colour cast is then drawn to the block's median (`--film-balance 1`).
It is the most even of the five 1968 runs, though the October films' spring green turns a little pink on bare ground.
It replaced, under the same key, a first version that left gain off and showed the runs as bands of different tone.
Source: `~/repos/blag-map/out/act1968/mosaic/mosaic.tif`, finished at 12:29 on 7 October 2026.

**Georeferencing: automated**, by Blag Map against a 2.8 m reference cut from the 1980 and 1974–75 references, both of ACTmapi's 2004–05 and 2012 imagery.
The median camera fits its matches to 6.7 m on the ground, about two pixels.
A few resections look false: the steepest camera is tilted 27°, where the median is 0.9°.
At street zoom over the inner city, it sits squarely on the 2025 imagery.

### `cog/canberra-1945-map1537-blag-3857.tif` (1945)

**Provenance.**
The inner city from full scans of MAP1537: 83 of 86 frames, at 0.5 m, grey.
Source: `~/repos/blag-map/out/map1537_1945_fullres/mosaic/mosaic.tif`.

**Georeferencing: automated**, by Blag Map against the hand-corrected 1955 mosaic, resampled to 0.5 m.
It was matched to an image of its own era rather than to modern imagery, as Blag Map's README advises for frames this old.
The median camera fits its matches to 1.1 m on the ground.

### `cog/act-1974-75-cas896-920-blag-3857.tif` (1974–75)

**Provenance.**
Films CAS896, CAS898, CAS919 and CAS920, two flights a year apart, run as one block from GA's previews: 236 of 290 frames over 2,119 km² of the ACT, at 4 m, grey.
Its tone drifts from hazy in the west to contrasty in the east.
Source: `~/repos/blag-map/out/act1974-75/mosaic/mosaic.tif`.

**Georeferencing: automated**, by Blag Map against ACTmapi's 2004–05 and 2012 imagery, resampled to 4.2 m.
The median camera fits its matches to 8.2 m on the ground, about two pixels.

### `cog/canberra-1926-map3584-blag-3857.tif` (1926)

**Provenance.**
Central Canberra from full scans of MAP3584: 31 of 32 frames, at 1 m, grey.
Six more frames of the film had no scan on hand, and were left out.
Source: `~/repos/blag-map/out/map3584_1926_fullres/mosaic/mosaic.tif`.

**Georeferencing: automated**, by Blag Map against the hand-corrected 1955 mosaic, resampled to 0.8 m.
The median camera fits its matches to 2.1 m on the ground.

### `cog/act-1944-map658-753-blag-3857.tif` (1944)

**Provenance.**
Films MAP658 and MAP753 from GA's previews: 100 of 123 frames over 1,263 km², a third of the ACT, at 5 m, grey.
There is a 1.5 by 2 km hole east of the inner south, where MAP658 frames 12876–12878 were never scanned.
There is also a strip of film rebate on the western edge, and haze with hot spots on MAP753.
Source: `~/repos/blag-map/out/act1944/mosaic/mosaic.tif`.

**Georeferencing: automated**, by Blag Map against ACTmapi's 2004–05 and 2012 imagery, resampled to 4.2 m.
At 5 m, the matches are landform, rivers and old roads that have outlasted the city.
The median camera fits its matches to 9.5 m on the ground, about two pixels.
