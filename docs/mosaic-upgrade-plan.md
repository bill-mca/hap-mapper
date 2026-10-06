# Plan: clean up the bucket and upgrade the mosaics

Written 7 October 2026.
[r2-inventory.md](r2-inventory.md) records what is in the bucket; this document says what to do about it.

## Where things stand

The public site shows two historical years.
The 1955 layer is sound.
The 1980 layer is about 200 m out of place.

The dev site shows a better 1980 layer and a rough 1926 one, but neither has reached production.

Blag Map has since made five new mosaics.
They improve on both dev layers, add three new years (1944, 1945 and 1974–75), and are small: about 1.3 GB between them, where the 1980 COGs in the bucket weigh 7 to 9 GB each.

The bucket also holds 2.5 GB that nothing reads: a Leaflet-era tile pyramid and two retired COGs.

## Decisions for bilby

These are the choices that change what we do.
Each has a recommendation.

1. **Which 1980 layer?**
   Blag Map's 1980 mosaic is the best placed and the most even in tone, but at 2.5 m it is soft at street zoom.
   The dev layer, SOC195, is eight times sharper (0.32 m), but it was bent into place with a thin-plate spline and shows its seams.
   *Recommendation:* put Blag Map's 1980 mosaic on production now, because it fixes a 200 m error.
   Keep SOC195 in the bucket until a full-scan Blag Map run of 1980 exists, then retire it.
2. **Both 1944 and 1945?**
   1944 covers a third of the ACT at 5 m; 1945 covers the inner city at 0.5 m.
   *Recommendation:* show both as separate years.
   Seen side by side, they are a fair demonstration of the trade between coverage and detail.
3. **What to call 1974–75 on the timeline?**
   The timeline marks whole years.
   *Recommendation:* mark it at 1974, label it "1974–75", and say which films are in it in the layer's attribution.
4. **Keep the `tiles.hapmap.app` custom domain?**
   Nothing uses it now, and once the pyramid is gone it only exposes the raw COGs.
   *Recommendation:* detach it from the bucket after step 1.

## The steps

Each step leaves the site working.
Each step that touches the bucket updates [r2-inventory.md](r2-inventory.md) and the session log in the same commit.

### 1. Delete what nothing reads

Delete the Leaflet tile pyramid (`north-canberra-1955/`, 1.23 GB, 100,966 objects), `cog/north-canberra-1955-odm-3857-jpeg.tif` (0.72 GB) and `cog/north-canberra-1955-cac80-large.tif` (0.57 GB).
Neither deployed page references them, and no repo on hectar does either.

Deletion from R2 cannot be undone, so confirm with bilby before running it.
Local copies of the two COGs survive in `~/hap-mosaics`; check that the pyramid also exists locally, or accept that it won't.

```sh
rclone purge  gudgenby-r2:hap-mapper-tiles/north-canberra-1955
rclone deletefile gudgenby-r2:hap-mapper-tiles/cog/north-canberra-1955-odm-3857-jpeg.tif
rclone deletefile gudgenby-r2:hap-mapper-tiles/cog/north-canberra-1955-cac80-large.tif
```

### 2. Make the new COGs

Reproject each Blag Map mosaic to Web Mercator as a COG.
Use 512 px blocks to match the page's `tileSize` (commit `bbe3593`), and keep NoData=0 so the edges are transparent.

```sh
gdalwarp -t_srs EPSG:3857 -r cubic -dstnodata 0 -of COG \
  -co COMPRESS=DEFLATE -co PREDICTOR=2 -co BLOCKSIZE=512 -co OVERVIEWS=AUTO \
  SRC.tif DST.tif
```

Name each file after where, when and what it is, with the method in the name, so that a later run never overwrites an earlier one under the same key:

| source | key |
|---|---|
| 1926 MAP3584 | `cog/canberra-1926-map3584-blag-3857.tif` |
| 1944 MAP658, MAP753 | `cog/act-1944-map658-753-blag-3857.tif` |
| 1945 MAP1537 | `cog/canberra-1945-map1537-blag-3857.tif` |
| 1974–75 CAS896–920 | `cog/act-1974-75-cas896-920-blag-3857.tif` |
| 1980 SOC276–279 | `cog/canberra-1980-soc276-279-blag-3857.tif` |

Upload each with `rclone copyto DST.tif gudgenby-r2:hap-mapper-tiles/<key> --s3-chunk-size=64M`, then check that the byte count in R2 matches the local file.

### 3. Try them on dev

Add or swap the layers in `dev/index.html`'s `IMAGERY_YEARS`, and deploy with `npx wrangler deploy -c wrangler.dev.jsonc`.
The four grey mosaics need the same `grayscaleWithNoData` colour function as 1955.

Check each layer by eye:

- it lines up with the 2025 imagery at roads and the lake shore;
- its edges and holes are transparent, not black (watch the RGB 1980 layer here, since it has no alpha band);
- it loads promptly at city zoom and at street zoom.

### 4. Promote to production

Carry the new layers into `index.html`.
Leave out dev's ACTmapi layers, which carry an unresolved licensing caveat.
Correct the README while there: it still says the COGs are "GPU-reprojected from UTM 55S", and lists only 1955, 1980 and 2025.
Commit, then deploy with `npx wrangler deploy`.

Because `dev/` is gitignored, this commit is the first place the new layer list is recorded.

### 5. Retire what the upgrade superseded

Once production no longer references them, delete:

- `cog/canberra-1980-soc276-3857.tif` (7.38 GB), the misplaced 1980 layer;
- `cog/canberra-1926-map3584-3857.tif` (0.01 GB), the preview-frame 1926 layer.

Delete `cog/canberra-1980-soc195-3857.tif` (8.60 GB) later, under decision 1.

## What the bucket will hold afterwards

| | now | after step 1 | after step 5 | once SOC195 goes |
|---|---|---|---|---|
| size | 32.9 GB | 30.4 GB | about 24.3 GB | about 15.7 GB |
| objects | 100,972 | 4 | 7 | 6 |

At R2's $0.015 a GB-month beyond the free 10 GB, the saving is pennies.
The real gain is a bucket where every object is shown on the site, or is plainly waiting its turn.

## Later

- A Blag Map run of the 1955 CAC campaign against the 2004 and 2012 reference.
  It would test the hand-georeferenced 1955 layer and might replace it.
- Full-scan Blag Map runs of 1980 and 1974–75, for sharpness at street zoom.
- The 1962–63, 1968, 1985, 1990 and 1992 sets that Blag Map has frame lists for but has not yet run.
