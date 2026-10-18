# Plan: every Web Mercator mosaic on the map, and a timeline that knows where you are

Written 19 October 2026.
This document imagines a hapmap.app that takes every Web Mercator mosaic from the STAC catalog by itself, and a timeline that dims the years with nothing to show where the map is looking.
It follows the design ideals in bilby's `docs/specification.md` on `main`, and says where it has to interpret them.
Nothing here is built yet.

## Where things stand

The public catalog holds 48 items, and 24 of them are Web Mercator COGs served from hapmap.app.
The site shows 11, one per year, each named by hand in `layers.yaml`.

The other 13 are these:

- `canberra-1980-soc195-3857`, the sharp but badly placed ODM 1980 mosaic, which the plan has always meant to retire;
- twelve Blag Map runs from the eight benchmark sites, Proof, Memory, Steel, Milk, Intent, Timber, Tower and Ink.

The benchmark runs are what make this interesting.
Four of them bring years the site has never had: 1940 (Ink, around Gungahlin and Sutton), 1950 (Milk, north towards Gunning), 1951 (Tower, south through Tuggeranong and Michelago) and 1959 (Steel, west to Burrinjuck).
Timber reaches Cooma in 1944.
Proof, Memory and Intent fly the same films as the 1944, 1974–75 and 1985 layers; Proof and Intent reach a little past them to the east, and Memory lies within.

So the imagery is no longer a stack of Canberra-shaped layers.
Each year covers a different patch of country, at a different sharpness, and a timeline that treats every year alike now misleads.

## Choosing layers: the catalog decides, `layers.yaml` makes exceptions

The build takes every item that is:

- in EPSG:3857 (`proj:code`), with `hap:kind: web-cog`;
- served from hapmap.app, so its `data` asset is under `https://hapmap.app/cog/`;
- not marked as superseded.

`layers.yaml` stops being a list of what to show and becomes a short list of what to leave out:

```yaml
# Every Web Mercator mosaic in the catalog is shown, unless named here.
exclude:
  - canberra-1980-soc195-3857   # sharper, but worse placed and seamier; retire when a full-scan 1980 lands
```

This keeps the promise of the STAC plan, that dev and prod can differ only through this file.
A new mosaic appears on the next deploy without anyone touching hap-mapper; withholding one from production is one line on `main`.

The page could instead read the catalog when it loads, so a new mosaic would appear with no deploy at all.
That would cost a few dozen requests on every visit, and dev and prod would no longer be kept apart, so I recommend keeping the list at build time.

### One run per benchmark site

Proof has two runs, and Memory and Steel three each.
They cover the same ground from the same frames, so only the top one could ever be seen, and the browser would still fetch tiles for the others.
The catalog cannot yet say which run is the one to show: their descriptions differ only in the run name.
This needs a fact in `hap-mosaics`, such as `hap:preferred: true` on the chosen run in `mosaics.yaml`, or `deprecated: true` from STAC's version extension on the others.
Until then the build would take the first run alphabetically, which is a guess.

## From items to epochs: one layer a year

The specification asks for at most one layer a year, and says that different layers have different extents.
Once three mosaics fall in 1944, both can hold only if a timeline year is an *epoch*: one or more mosaics drawn together, each where it has data.

The build groups the items like this:

1. Each item's date is the midpoint of its flight dates, as the specification asks.
2. Items whose flight dates overlap belong to one epoch, so Memory (15 December 1974) joins 1974–75 rather than making a 1974 of its own.
3. Items whose midpoints fall in the same calendar year belong to one epoch, so Timber (March 1944) joins Proof and the ACT layer (December 1944).
4. The epoch's label runs from its earliest flight to its latest: `1974–75`.
   Its dot sits at the midpoint of the largest mosaic, so that the busy years stay where people expect them.

Inside an epoch, each mosaic is drawn as its own MapLibre layer, and the order decides which one shows where two overlap.
Mosaics with `hap:status: current` go on top, and benchmark runs (`reference`) underneath, where they fill the country the current mosaic does not reach.
Among equals, the sharper mosaic goes on top.

With today's catalog that gives fifteen epochs, listed here with the top mosaic first:

| epoch | mosaics, top first |
|---|---|
| 1926 | Canberra 1926 (1 m) |
| 1940 | Ink (3 m) |
| 1944 | ACT 1944 (5 m), Timber (2.5 m), Proof (4 m) |
| 1945 | Canberra 1945 (0.5 m) |
| 1950 | Milk (4 m) |
| 1951 | Tower (5 m) |
| 1955 | North Canberra 1955 (0.15 m) |
| 1959 | Steel (5 m) |
| 1962–63 | ACT 1962–63 (2.5 m) |
| 1968 | ACT 1968 (3 m) |
| 1974–75 | ACT 1974–75 (4 m), Memory (4 m) |
| 1980 | Canberra 1980 (2.5 m) |
| 1985 | ACT 1985 (2.5 m), Intent (2 m) |
| 1990 | ACT 1990 (2.5 m) |
| 1992 | ACT 1992 (3 m) |

`layers.json` becomes a list of epochs, each holding its mosaics.
Each mosaic carries what it carries now, plus its footprint and ground pixel size.
The footprints, simplified to a few metres and rounded to five decimal places, come to a few tens of kilobytes in all.

## The timeline knows where you are

Each time the map stops moving, the page compares every epoch's footprints with the view, and gives each dot one of three looks:

- **covered**: the epoch has imagery in view, sharp enough for this zoom: an ordinary dot;
- **coarse**: it has imagery in view, but every mosaic there is coarser than the zoom can show: a hollow dot;
- **not here**: nothing in view: a faint grey dot.

"Coarse" means a ground pixel of the sharpest mosaic in view spans more than two screen pixels.
At zoom 15 over Canberra a screen pixel is about 2 m, so a 2.5 m mosaic is fine and a 4 m one is coarse.

The test needs no library.
A grid of points across the view, eight by eight, is tested against each footprint, with a bounding-box check first; that is a few hundred thousand cheap sums, done once a pan.
A footprint smaller than a grid cell is caught by also asking whether any of its corners lies in the view.

Here is what the timeline would show in some sample views, worked out from the real footprints.
A tilde marks a coarse epoch; a percentage, one that covers only part of the view.

| view | zoom | epochs lit | which |
|---|---|---|---|
| Lake Burley Griffin, the opening view | 14 | 11 of 15 | 1926 (45%), 1944, 1945, 1955, 1962–63 (2%), 1968, 1974–75, 1980, 1985, 1990 (23%), 1992 |
| Civic, street level | 18 | 10 | 1944~, 1945~, 1955, 1959~ (46%), 1968~, 1974–75~, 1980, 1985~, 1990~ (32%), 1992~ |
| Gungahlin | 15 | 8 | 1940 (64%), 1959~, 1968, 1974–75~, 1980, 1985, 1990, 1992 |
| Tharwa | 15 | 9 | 1944~ (16%), 1951~, 1962–63 (77%), 1968, 1974–75~, 1980 (88%), 1985 (82%), 1990 (93%), 1992 |
| Cooma | 15 | 1 | 1944 |
| Yass | 15 | 0 | none |

Partial cover could earn a fourth look, such as a half-filled dot, but the specification asks for subtle cues and three is already plenty.

### What the dimming changes

- Dragging the handle snaps only to lit epochs, so a drag never lands on an empty map.
- The arrow keys and the play button step only through lit epochs.
- A grey dot can still be clicked.
  It flies the map to that epoch's footprint, which turns the grey dots into a way of discovering where the old photographs are.
- If the visitor pans off the edge of the epoch they are looking at, the page keeps it selected and lets the base map show through.
  Jumping to another year without being asked would be more confusing than an empty patch.
- When nothing at all is lit, as at Yass, the handle says so quietly: "No historical imagery here".

## Fetching only what is seen

Fifteen epochs make twenty-odd MapLibre sources, against eleven today.
Two changes keep that from costing the visitor:

- Every source gets its item's bounding box as `bounds`, so MapLibre never asks for a tile outside it.
- Epochs that are not showing get `visibility: none` instead of opacity 0.
  As I understand MapLibre, a layer at opacity 0 still fetches its tiles, so today every year downloads on every pan.
  The fade can be kept for the epoch being left and the one arriving.
  This needs measuring in a browser before it is relied on.

## Clicking and attribution

A click asks the active epoch's mosaics, top first, whether the point lies in their footprint, and queries the `source_frame` of the first that says yes.
SOC195 has no `source_frame`, which is one more reason to leave it out.

The specification asks for attribution that describes only the visible layers and links each to its STAC listing.
The same coverage test gives that list: the mosaics of the active epoch that intersect the view.

## Questions for bilby

1. **Which benchmark run is shown** for Proof (a or b), Memory (a, b or c) and Steel (a, b or c)?
   However it is decided, it should be recorded in `hap-mosaics`, not here.
2. **Should benchmark runs fill in around the current mosaics?**
   The recommendation is yes, underneath, so they add country without hiding the current layer.
   The alternative is to show them only where no current mosaic exists in that year, which comes to the same thing on today's catalog.
3. **Does SOC195 stay out?**
   The recommendation is yes, as today.
4. **Should a grey dot fly to its coverage when clicked**, or do nothing?

## Steps

1. hap-mosaics: record the preferred benchmark runs.
2. `scripts/build.mjs`: select items from the catalog, apply `exclude`, group them into epochs, and write footprints and pixel sizes into `layers.json`.
3. `index.html`: one MapLibre layer per mosaic, switched by epoch, with `bounds` and `visibility`.
4. `index.html`: the coverage test, the three dot styles, and snapping, keys and play that follow it.
5. `index.html`: the click and the attribution, taken from the mosaics in view.
6. Try it on `hapmap-dev`, at the sample views above and on a phone.

## Not covered here

- Dots that crowd one another: 1944 and 1945 sit a quarter of a year apart, and 1950 and 1951 not much more.
  The backlog already has an item for 1944 and 1945; the same fix should serve both.
- The specification's base layer is OpenStreetMap, and the site draws Esri World Imagery.
- The specification says tie points are never shown, and the dev site has a button for them.
