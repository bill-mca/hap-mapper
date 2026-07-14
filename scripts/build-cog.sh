#!/usr/bin/env bash
#
# build-cog.sh — turn an ODM orthophoto into the COG(s) hap-mapper serves.
#
# Two hard constraints drive this pipeline (see README / worker/cog-proxy.js):
#
#   1. maplibre-cog-protocol only renders COGs whose ProjectedCSTypeGeoKey is
#      EPSG:3857 (or 102113). The ODM ortho is UTM 55S / EPSG:32755, which the
#      library hard-rejects — so every COG must be reprojected to 3857 first.
#
#   2. Cloudflare's CDN only serves HTTP Range requests from cache, and objects
#      over the 512 MB plan cache limit are never cached (→ 200 + full file,
#      which geotiff.js rejects). The COGs are therefore served through the
#      Worker's R2 binding (worker/cog-proxy.js), which returns real 206s at any
#      size. Size still matters for perf, hence the lossy variant below.
#
# Produces two COGs:
#   - <name>-3857.tif       DEFLATE lossless, 2-band gray+alpha  (production)
#   - <name>-3857-jpeg.tif  JPEG Q85, gray + internal mask (~3.4x smaller; A/B)
#
# Both are 2.2 Gpx panchromatic; band 1 = luminance. The lossless COG keeps the
# alpha as band 2; the JPEG COG can't carry an alpha band, so the alpha becomes
# an internal mask that maplibre-cog-protocol applies after the colour function.
#
# Requires: GDAL >= 3.1 (COG driver), rclone with a write-capable R2 remote.

set -euo pipefail

# --- config -----------------------------------------------------------------
# Source ODM orthophoto (already a valid COG, but in UTM 55S).
SRC="${SRC:-/home/bilby/tmp/odm/tif-fullres-test/output-large-fullres/odm_orthophoto/odm_orthophoto.tif}"

NAME="${NAME:-north-canberra-1955-odm}"
WORKDIR="${WORKDIR:-$(mktemp -d)}"

# R2: bucket + a *write-capable* rclone remote. The `tiles.hap-mapper.app`
# remote is read-only; `gudgenby-r2` has write access to this bucket.
R2_REMOTE="${R2_REMOTE:-gudgenby-r2}"
R2_BUCKET="${R2_BUCKET:-hap-mapper-tiles}"
R2_PREFIX="${R2_PREFIX:-cog}"

JPEG_QUALITY="${JPEG_QUALITY:-85}"

LOSSLESS="${WORKDIR}/${NAME}-3857.tif"
LOSSY="${WORKDIR}/${NAME}-3857-jpeg.tif"

# --- 1. reproject to EPSG:3857, lossless COG (production) --------------------
echo ">> reprojecting to EPSG:3857 (lossless DEFLATE COG) ..."
gdalwarp \
  -t_srs EPSG:3857 \
  -r cubic \
  -of COG \
  -co COMPRESS=DEFLATE -co PREDICTOR=2 -co BLOCKSIZE=256 \
  -co OVERVIEWS=AUTO -co RESAMPLING=CUBIC \
  -co NUM_THREADS=ALL_CPUS \
  -multi -wo NUM_THREADS=ALL_CPUS \
  --config GDAL_CACHEMAX 2048 \
  "$SRC" "$LOSSLESS"

# --- 2. lossy JPEG variant: gray band + internal mask -----------------------
# -b 1 keeps the luminance band; -mask 2 turns the alpha band into the COG's
# internal mask (JPEG can't store alpha). geotiff.js decodes grayscale JPEG;
# cogProtocol applies the mask for the mosaic's ragged edges.
echo ">> building lossy JPEG Q${JPEG_QUALITY} COG ..."
gdal_translate \
  -of COG \
  -b 1 -mask 2 \
  -co COMPRESS=JPEG -co QUALITY="${JPEG_QUALITY}" \
  -co BLOCKSIZE=256 -co OVERVIEWS=AUTO -co RESAMPLING=CUBIC \
  -co NUM_THREADS=ALL_CPUS \
  "$LOSSLESS" "$LOSSY"

# --- 3. validate + upload ---------------------------------------------------
for f in "$LOSSLESS" "$LOSSY"; do
  python3 - "$f" <<'PY' 2>/dev/null || true
import sys
from osgeo import gdal
gdal.UseExceptions()
ds = gdal.Open(sys.argv[1])
print(f"   {sys.argv[1].split('/')[-1]}: {ds.RasterXSize}x{ds.RasterYSize} "
      f"{ds.GetRasterBand(1).GetMetadataItem('COMPRESSION','IMAGE_STRUCTURE') or ds.GetMetadata('IMAGE_STRUCTURE').get('COMPRESSION')}")
PY
  key="${R2_PREFIX}/$(basename "$f")"
  echo ">> uploading -> ${R2_REMOTE}:${R2_BUCKET}/${key}"
  rclone copyto "$f" "${R2_REMOTE}:${R2_BUCKET}/${key}" \
    --s3-chunk-size=64M --s3-upload-concurrency=4 --stats-one-line -v
done

echo ">> done. Files in ${WORKDIR}"
echo "   Point index.html COG_1955 at location.origin + '/cog/<key>.tif' (served via worker/cog-proxy.js)."
