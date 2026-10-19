# Plan: the page reads the catalog, and the timeline shows any year

Written 19 October 2026, and rewritten the same day after bilby's decisions.
This document says how hapmap.app can take its layers straight from the STAC catalog in the browser, and how a year on the timeline becomes every mosaic of that year, stacked.
It departs on purpose from two rules in bilby's `docs/specification.md`: one layer a year, and the midpoint date.
It also changes what a grey dot means; see the timeline below.
Nothing here is built yet.

## The rules, as bilby set them

1. A mosaic belongs to the year its flying **started**, so ACT 1962–63 is a 1962 mosaic.
2. Choosing a year turns on **every** mosaic of that year with imagery in view, the sharpest on top.
3. The slider can rest on **any** year, wherever the map is looking.
   Where nothing was flown that year, the map shows the most recent earlier mosaic instead.

## What the map draws

For the chosen year Y, the page takes every mosaic in view that started in Y or before, and stacks them:

- newer years above older ones;
- within a year, finer pixels above coarser ones.

Wherever a year-Y mosaic has imagery, it is what the visitor sees.
Where it has none, the most recent earlier mosaic shows through, and below everything, the OpenStreetMap street map.
The present day shows only when it is the year chosen.
Rule 3 then holds place by place, not just for the whole screen: at the opening view over Lake Burley Griffin in 1990, the 1990 mosaic covers two-thirds of the screen and 1985 fills the rest.

The stack is pruned from the top down, so the page loads little more raster than the visitor sees.
Walking from the chosen year backwards, and from the finest mosaic to the coarsest within a year, the page:

- stops as soon as the mosaics already drawn cover the whole view between them;
- skips any mosaic that would add less than 2% of the view not already covered.

The first rule does the work when zoomed in, where one mosaic usually fills the screen.
The second does it when zoomed out, where no mosaic fills the screen and the first rule never fires.

Tested on the real footprints for every year, with a 1280 × 800 screen:

| view | layers drawn, average (most), with no pruning | after the first rule | after both |
|---|---|---|---|
| Civic, street level | 5.9 (13) | 1.1 (2) | 1.1 (2) |
| Lake Burley Griffin, the opening view | 7.6 (16) | 2.4 (5) | 1.7 (3) |
| Canberra, zoom 11 | 10.2 (21) | 4.6 (9) | 2.9 (4) |
| The ACT, zoom 10 | 10.2 (21) | 10.2 (21) | 4.1 (8) |
| The region, zoom 8.5 | 13.2 (25) | 13.2 (25) | 4.8 (9) |

Some overfetch remains.
A mosaic drawn under a partial one still fetches its tiles across the whole of its bounding box in view, including the part hidden above it.
Because the page owns the `cog://` protocol handler, it could refuse a tile that the layers above it cover completely, and fetch only tiles that can be seen.
That depends on how maplibre-cog-protocol names its tiles, and should be checked before it is relied on.

The handle shows the chosen year.
When older mosaics show through, the attribution line says so and names them, for instance "1985; 1983 in places".

## The timeline

- One dot per year that has at least one mosaic in view, and no dot for any other year.
- A grey dot, for a year whose sharpest mosaic in view is coarser than the screen at this zoom (bilby, 19 October 2026).
  The handle turns grey the same way when every mosaic drawn is coarser than the screen.
- No lanes, and no pip per mosaic.
- The handle moves freely, snapping to whole years, and the map changes as it passes each dot.
- The arrow keys and the play button step through the dots that are lit.

With today's catalog the years are 1926, 1940, 1944, 1945, 1950, 1951, 1955, 1959, 1962, 1968, 1971, 1974, 1977, 1980, 1983, 1985, 1990 and 1992.
1971, 1977 and 1983 arrived this morning with the Deputy, Forum and Puppy runs.

## Reading the catalog from the browser

The catalog is static files, not a STAC API, so the page cannot ask it a question such as "what is in this box".
It fetches the records and asks the question itself.

### As the catalog stands: 86 files

Walking it means the catalog, its 25 collections, and all 60 items, in three rounds of requests.
That comes to about 770 kB gzipped.
Half of it is the native-grid items, which the page cannot use but cannot tell apart until it has fetched them.
Half of each Web Mercator item is the list of frames behind `source_frame`, which is needed only when someone clicks.

That works, with no change to the pipeline, but it is slow on a phone.

### Recommended: one more file in the catalog

`publish.py` in hap-mosaics also writes `stac/web-items.json`: a STAC ItemCollection of every published Web Mercator item, with the frame lists left out, linked from `catalog.json`.
For today's 25 Web Mercator items that file is 332 kB, or 68 kB gzipped, in one request.
When someone clicks, the page fetches that one item's full record for its frame list, and keeps it.

The page still reads nothing but STAC: an ItemCollection is a standard STAC document, and STAC Browser and `pystac` read it too.

### What changes when the page reads the catalog

- **A new mosaic appears on the next page load**, with no build and no deploy, as soon as `publish.py` has run.
  That is the point, and it is also a change: today a mosaic reaches dev first and production later.
- **Dev and production read the same catalog**, so they can no longer differ in what they show.
  If that is still wanted, a draft flag in `mosaics.yaml` could reach the catalog as `hap:status: draft`, which production skips and dev shows.
- **`layers.yaml` goes**, apart from the present-day base layer, which can move into the page.
  Anything to keep off the site, such as SOC195, is marked in `mosaics.yaml` instead, so the catalog stays the single record.
- **`npm run build`** is left with copying the page and building STAC Browser.

## In the page

- One MapLibre source per mosaic, created when it first enters a stack and given its item's bounding box as `bounds`, so it never asks for tiles outside it.
- A mosaic not in the current stack is set to `visibility: none`, not opacity 0, so it fetches nothing.
- The coverage test needs no library: a grid of points across the view is tested against each footprint, after a bounding-box check.
  It runs when the map stops moving and when the year changes.
- A click asks the stack, from the top down, which mosaic has the point inside its footprint, and reads that mosaic's `source_frame`.

## Questions for bilby

1. **Which benchmark run is shown** where a site has several: Proof (a or b), Memory and Steel (a, b or c)?
   The sharpest-on-top rule cannot choose between runs of equal pixel size.
2. **SOC195 over the 1980 Blag Map mosaic?**
   Under rule 2 its 0.25 m pixels put it on top across central Canberra, although it is worse placed.
   The recommendation is to mark it as kept off the site.
3. **Is losing the dev-first step acceptable**, or should drafts be flagged?

## Steps

1. hap-mosaics: `publish.py` writes `stac/web-items.json` and links it; `mosaics.yaml` marks runs and mosaics to keep off the site.
2. hap-mapper: the page loads `web-items.json`, builds the year list, and draws the stack for the chosen year and view.
3. hap-mapper: the timeline's dots follow the view; free slider; keys and play.
4. hap-mapper: click and attribution from the drawn stack.
5. hap-mapper: retire `layers.yaml` and slim `scripts/build.mjs`.
6. Try it on `hapmap-dev` at Civic, Tharwa, Cooma and Yass, and on a phone.

## As built on hapmap-dev (19 October 2026)

The page now reads the catalog and draws the year stacks described above; `hapmap-dev` runs it.
Where the build departs from the plan, or found something the plan did not know:

- **The page walks the catalog**, because `web-items.json` does not exist yet.
  It fetches only items whose links contain `-3857`, the pipeline's name for a Web Mercator item, so the native-grid half of the catalog is never downloaded.
  That is 57 requests and about 2.4 seconds on hectar before the timeline appears; the map and the present day show at once.
  When `publish.py` links an ItemCollection from `catalog.json` with `rel: "items"`, the page reads that one file instead, with no change here.
- **The newest year in view keeps every mosaic.**
  The 2% rule applies only to the older years beneath it, so that a year with a dot always shows what the dot promises: at the opening view, 1962 shows the sliver of ACT 1962–63, with 1959 and 1955 beneath.
- **What is left out stays in `layers.yaml`**, as `exclude`, built into `/site.json`, because the hap-mosaics repository is not changed from here.
  SOC195 and runs b and c of Proof, Memory and Steel are left out; run a of each is shown until bilby picks.
- **Sharpest on top means the benchmark runs often win.**
  Proof (4 m) covers everything ACT 1944 (5 m) does around Canberra, so the current 1944 layer is never drawn there, and Intent (2 m) sits on top of ACT 1985 (2.5 m).
  If the current mosaics should win among equals, the sort needs `hap:status` before pixel size.
- **A footprint without its holes overstates coverage.**
  MAP658 has a block of frames that were never scanned, and Proof's footprint does not cut it out, so the page counts that block as covered and does not draw 1926 under it; there the present day shows through.
- **No tile culling yet.**
  The protocol names tiles `cog://<url>/{z}/{x}/{y}` and its TileJSON already carries each COG's bounds, so a wrapper could refuse tiles that the layers above cover.
  MapLibre keeps a refused tile in its cache when the stack later changes, though, so it needs a way to reload a source before it is worth doing.

Checked in headless Chromium against `hapmap-dev` at the opening view, Civic at street level, Tharwa, Cooma, Yass and the whole region, for 1930, 1944, 1962, 1987, 1990 and 2010; with the arrow keys, a drag, a click on a 1985 frame, the info panel, and at phone width.
