# Why imagery is slow to load

Measured 21 October 2026 against `hapmap-dev` (the page at commit e20ee53), from hectar, in headless Chromium driven by agent-browser, at 1440 × 900.
Nothing here is fixed yet; this is the diagnosis and a ranked list of remedies.

## The short answer

When the year changes or the map moves, a new screen of imagery takes 3 to 19 seconds to settle.
Very little of that is Cloudflare or R2.
Most of it happens in the browser, in how `maplibre-cog-protocol` and the geotiff.js bundled inside it read the COGs:

1. Chrome runs range requests to the same COG one at a time.
2. Each block is downloaded several times, and the blocks are heavy.
3. A layer's header is read in a chain of tiny requests before its first tile can start.

The server adds about 100–250 ms to every read, and the first page load waits on a long chain of scripts and catalog files.

## What a year change costs

Each step starts from the opening view over Lake Burley Griffin, timed from `setYear` until MapLibre's `idle` event.
`idle` waits for the 800 ms fade, so 1.2 s is the floor.
The two columns are the page as deployed, and the same page with one change: COG reads sent with `cache: 'no-store'` (see the first cause).
Two rounds of each, interleaved; hectar's bandwidth swung between about 8 and 80 Mbit/s, so the numbers are noisy.

| step | as deployed | with `no-store` |
|---|---|---|
| 2025 → 1985 (Intent) | 19.0 s, 3.9 s | 5.8 s, 2.8 s |
| 1985 → 1968 | 15.9 s, 10.9 s | 4.9 s, 9.7 s |
| back to 1985 (already loaded) | 1.3 s, 1.2 s | 1.3 s, 1.3 s |
| 1985 → 1955 | 11.4 s, 4.5 s | 2.3 s, 5.0 s |
| zoom in two levels on 1955 | 8.5 s, 5.1 s | 1.3 s, 1.3 s |
| pan 700 px on 1955 | 4.9 s, 2.9 s | 0.9 s, 1.9 s |

A year already seen comes back at once: MapLibre keeps a hidden layer's tiles.

## The causes, largest first

### 1. Chrome queues range requests to the same URL

Every tile of a mosaic is a range request to the same URL, `/cog/<mosaic>.tif`.
Chrome lets only one request at a time write to a given HTTP-cache entry, so the rest wait in line, even though over HTTP/3 they could all go at once.

In the trace of a change to 1968, each tile reached its first byte in about 230 ms but had waited in Chrome's queue for a median of 1.9 s, and up to 6.5 s.
Twelve 600 kB reads fired together at one COG took 1.1–3.7 s with the default cache mode, and Chrome queued them one after another.
With `cache: 'no-store'`, or with a distinct URL for each request, none were queued.

geotiff.js offers no way to pass a cache mode, so the remedy is either a thin wrapper around `fetch` for `/cog/` URLs, or a vendored copy of the protocol whose geotiff client sets it.
A distinct URL per block, such as `/cog/<mosaic>.tif?r=<offset>-<length>` answered by the Worker, would do the same and keep blocks cacheable in the browser and at the edge.

### 2. Blocks are downloaded several times, and they are heavy

geotiff.js 3 only caches raw bytes when it is given a `blockSize`, and the protocol never gives one.
The protocol renders 256 px tiles in the web-map grid, but the COGs are blocked at 512 px on their own grid, so most map tiles straddle two or four COG blocks.
Each map tile then downloads every block it touches, whole, with no memory of its neighbours having just done the same.

One screen of 1968 asked for 15.0 MB, of which 5.4 MB was distinct: the same 614 kB block came down six times.

The blocks are heavy because the Blag Map mosaics are stored as RGBA with DEFLATE.
They are toned photographs, not colour ones, and DEFLATE does poorly on photographs.
One 512 × 512 block at full resolution, re-encoded:

| mosaic | as stored (DEFLATE) | JPEG q85, YCbCr | WebP q85 |
|---|---|---|---|
| 1968 (RGBA) | 496 kB | 51 kB | 39 kB |
| Intent (RGB) | 516 kB | 75 kB | |
| 1955 (grey) | 211 kB | 88 kB (grey JPEG) | |

JPEG cannot carry alpha, so a JPEG COG uses an internal mask, which GDAL's COG driver writes on its own; the protocol reads masks, but with a second, chained read per tile.
WebP carries alpha in the block itself and avoids that read; it should be tried with the protocol before it is relied on.

COGs built with `-co TILING_SCHEME=GoogleMapsCompatible` would put every block exactly on a web-map tile, at an exact zoom level, so one map tile is one block and one request.

### 3. Each new layer reads its header in a chain of tiny requests

Before the first tile of a newly shown layer, geotiff walks the header: for 1968, seven 1 kB reads one after another, then seventeen 4-byte reads of tile offsets.
That took 0.85 s on a good run and 4.4 s when Chrome's queue was in the way.
Every layer in a stack pays it the first time it is drawn.

Reading the first 64 kB in one request would cover every IFD of these COGs.
Reading every mosaic's header in the background after the page loads, a few tens of kilobytes each, would take this cost off year changes entirely.

### 4. Every read goes to R2

The Worker reads each range straight from R2 and caches nothing.
From hectar, through Cloudflare's Melbourne edge to the Oceania bucket, a range read reaches its first byte in 80–290 ms, against about 45 ms for a static file on the same connection.
The COG responses carry no `Cache-Control`.

Since `publish.py` never overwrites an object, every COG key is immutable.
The Worker could keep each range in Cloudflare's Cache API under a key made of the URL and the range, which suits geotiff well, because the same block is always asked for with the same range.
That cuts the time to first byte to edge-cache speed for anyone who looks where someone else has looked, and saves R2 reads.

### 5. The first load waits on a long chain

The cold load took 6.9 s to settle:

| from | to | what |
|---|---|---|
| 0.0 s | 0.8 s | the page |
| 0.6 s | 1.6 s | MapLibre and the geocoder from unpkg |
| 1.7 s | 2.8 s | the COG protocol from esm.sh, 573 kB: all of geotiff, every codec |
| 2.9 s | 3.3 s | `/site.json` |
| 3.3 s | 5.3 s | the catalog, in three rounds: 1 + 25 + 47 files, each 300–700 ms through the Worker |
| 3.4 s | 6.7 s | OpenStreetMap and Esri tiles, 1.2–1.4 s each |

Nothing in the module runs until the esm.sh import has arrived, and the map is not even created until `/site.json` is back, so the first tiles of the present day wait about 4.8 s.
Creating the map first, and fetching `/site.json` and the catalog alongside the protocol, would save over a second.
`web-items.json`, already on the backlog, would collapse the three rounds of catalog into one.
Building the page with Vite and serving its scripts from the Worker would trim the protocol bundle and let them be cached for good.

## Smaller things

- **The imagery is drawn at half the resolution the COGs hold.**
  The protocol always renders 256 px tiles, so `tileSize: 512` (commit bbe3593) makes MapLibre ask for each tile a zoom level coarser and stretch it twofold.
  At street level in Civic, 1955 drawn with `tileSize: 256` is visibly crisper, but costs 112 reads instead of 51.
  The grey dot and grey handle assume full resolution, so they come on later than they should.
  Aligned COGs (cause 2) would let the page ask for 256 px tiles at a cost of one block each.
- **The protocol ignores MapLibre's abort signal**, so a tile for a view or year already left keeps downloading.
  A quick scrub from 1992 to 1955 started header reads on eight COGs that were never shown, but cost only 0.15 MB, because their headers were not done before they were hidden.
- **The stack is worked out only on `moveend`**, so a layer newly needed by a pan starts loading only when the pan stops.
- **No main-thread long tasks** were seen while 1955 loaded, despite its per-pixel colour function, so decoding is not the bottleneck on hectar; it may be on a phone.
- **`tile.openstreetmap.org`** took 1.4 s a tile from hectar, and its usage policy is not meant for an app's basemap.

## Remedies, in the order worth doing

| remedy | where | effort | helps |
|---|---|---|---|
| Send COG reads with `cache: 'no-store'` | page | an hour | cause 1: zooms and pans 1.5–6.5× faster in the trial |
| A block cache, and a 64 kB first read | page (vendored protocol) | a day | causes 2 and 3: about 2.8× fewer bytes, one header request |
| Read every mosaic's header in the background after load | page | an hour | cause 3: year changes start with tiles |
| Create the map first; fetch site.json and the catalog alongside the scripts | page | an hour | cause 5 |
| `web-items.json` | hap-mosaics | in the backlog | cause 5 |
| Cache ranges at the edge, and mark COGs immutable | Worker | half a day | cause 4 |
| Re-encode as JPEG or WebP, `GoogleMapsCompatible` tiling | hap-mosaics, then re-upload | days, mostly machine time | cause 2: 2.4–13× fewer bytes per block; also full resolution |
| Bundle with Vite, serve scripts from the Worker | build | half a day | cause 5 |

## How it was measured

The scripts are not kept in the repository.
In outline: agent-browser opened the dev site with an init script that wrapped `fetch` to log each COG `Range` header (and, for the trial, to add `cache: 'no-store'`); each step called `hapmap.setYear` or moved `hapmap.map`, waited for `idle`, and dumped `performance.getEntriesByType('resource')`, whose `requestStart − startTime` is the time Chrome held a request back.
Server timings came from `curl -w` against `hapmap-dev.u5007063.workers.dev`, block sizes from `gdal_translate -srcwin` on `/vsicurl/`, and the protocol's behaviour from reading `@geomatico/maplibre-cog-protocol@0.9.0` and the esm.sh bundle the page actually loads.

## As built (21 October 2026)

The same day, every remedy above was built and deployed to `hapmap-dev` (version 952debd5).

- **`src/cog.js`** replaces maplibre-cog-protocol.
  Each range is read from its own URL (`/cog/x.tif?r=<start>-<end>`, with the matching `Range` header), so Chrome never queues them, and each stays cacheable.
  Header reads are rounded out to 64 kB blocks.
  COG blocks are decoded once, in workers (WebP and JPEG by the browser's own decoder), and kept in a 128 MB cache shared by every layer.
  Tiles are 512 px at the resolution the screen needs, from the overview no more than a quarter coarser; MapLibre's abort signal stops downloads no other tile is waiting for.
- **The page** starts the map before fetching anything, preloads `/site.json` and `/web-items.json`, follows the map with the stack while it moves, and reads the headers of mosaics in view in the background once the map is idle.
  Vite bundles it, with MapLibre, the geocoder and geotiff.js from npm; hashed assets are cached for a year.
- **The Worker** keeps closed ranges in memory (48 MB an isolate) and in the edge cache, marks them cacheable for a day, and serves `/web-items.json`: the catalog's 39 Web Mercator items, walked beside R2, without frame lists, in one request, kept five minutes.
- **Web copies**: `scripts/web-cogs.py` re-encoded the 33 mosaics the map shows as RGBA WebP at quality 85, on the same grid with the same overviews, 7.6 GB in all under `web/` in the bucket (see [r2-inventory.md](r2-inventory.md)).
  The map draws them; the lossless masters stay at `/cog/` for GIS use and the click popup.

Measured the same way as above, cold browser, the live `hapmap-dev` before (version 482e61a4, at its preview URL) and after, two interleaved rounds each:

| step | before | after | COG bytes, before → after |
|---|---|---|---|
| 2025 → 1985 (Intent) | 4.7 s, 4.9 s | 1.3 s, 1.3 s | 9.7 MB → 1.2–1.7 MB |
| 1985 → 1968 | 5.0 s, 5.0 s | 1.3 s, 1.3 s | 15.0 MB → 1.2 MB |
| 1985 → 1955 | 5.4 s, 4.6 s | 1.3 s, 1.3 s | 2.7 MB → 2.8 MB (from the master, before its web copy was up) |
| zoom in two levels on 1955 | 4.1 s, 3.6 s | 0.6 s, 0.7 s | 3.5 MB → 2.0 MB |
| pan 700 px on 1955 | 1.9 s, 1.4 s | 0.3 s, 0.3 s | 1.8 MB → 0.7 MB |

A year change now takes the 800 ms fade and little more; the new tiles are also at full resolution where the old ones were at half.
A fast scrub from 1992 to 1955 settles 3.1 s after it starts (it lasts 1.8 s), with five main-thread tasks over 50 ms, none over 70.

Still to do: the edge cache only works on a custom domain, so its effect will show on hapmap.app, not on `workers.dev`; and `/web-items.json` stands in for an ItemCollection that hap-mosaics' `publish.py` could write, which the page would read in its place.
