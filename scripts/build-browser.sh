#!/usr/bin/env bash
# Build STAC Browser (https://github.com/radiantearth/stac-browser) for
# hapmap.app/browse/, pointed at the public catalog. The build is cached in
# .cache/stac-browser/<version>/ and only redone when the version or the
# catalog URL changes. Usage: scripts/build-browser.sh <out-dir>
set -euo pipefail
VERSION=v5.1.0
CATALOG_URL=${HAP_CATALOG_URL:-https://hapmap.app/stac/catalog.json}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
CACHE="$ROOT/.cache/stac-browser/$VERSION"
STAMP="$CACHE/.built-for"
OUT=${1:?usage: build-browser.sh <out-dir>}

if [[ ! -f "$STAMP" || "$(cat "$STAMP")" != "$CATALOG_URL" ]]; then
  rm -rf "$CACHE"
  git -c advice.detachedHead=false clone --quiet --depth 1 --branch "$VERSION" https://github.com/radiantearth/stac-browser.git "$CACHE/src"
  # --include=dev: build.mjs runs Vite first, which sets NODE_ENV=production,
  # and npm ci would then skip the devDependencies STAC Browser builds with.
  (cd "$CACHE/src" && npm ci --include=dev --no-audit --no-fund --loglevel=error \
    && SB_catalogUrl="$CATALOG_URL" SB_catalogTitle="Hap-Map catalog" \
       SB_pathPrefix=/browse/ SB_historyMode=hash npm run build >/dev/null)
  mv "$CACHE/src/dist" "$CACHE/dist"
  find "$CACHE/dist" -name "*.map" -delete   # 34 MB nobody reads
  rm -rf "$CACHE/src"
  echo "$CATALOG_URL" > "$STAMP"
fi
rm -rf "$OUT"
cp -r "$CACHE/dist" "$OUT"
