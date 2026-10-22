# The OpenFreeMap backdrop against Esri's

Measured 22 October 2026 from hectar, in headless Chromium on the RTX 5060 Ti, at 1400 × 900.
Two builds of hapmap-dev, served from Cloudflare as version previews:

- **Esri:** version 984a32eb (commit f8177c9), with Esri's World Dark Gray Base raster tiles under every year and the OpenFreeMap labels over them.
- **OpenFreeMap:** version 4efb34c4 (commit b293a0e), with the backdrop drawn from the same OpenFreeMap vector tiles as the labels, by `src/backdrop.js`.

The labels are the same in both, so both load OpenFreeMap's tiles.
The only difference is the backdrop.

## The short answer

The OpenFreeMap backdrop downloads a fifth less and makes 241 fewer requests a session, and it is no slower to draw.
It costs nothing extra to fetch, because the labels already bring its tiles; Esri's tiles were extra downloading alongside them.
Load times, tour times and panning are the same within the noise, on hectar and on one CPU core.

## Results

Medians of five runs of each build, each in a fresh browser with an empty cache, after a warm-up run of each.

| | Esri | OpenFreeMap |
|---|---|---|
| Downloaded in a session | 9.64 MB | 7.67 MB |
| Requests in a session | 395 | 154 |
| Load to the first complete map | 1.50 s | 1.48 s |
| … on one CPU core | 1.69 s | 1.63 s |
| Six-view tour, until each view's tiles arrive | 3.39 s | 3.35 s |
| … on one CPU core | 3.38 s | 3.44 s |
| Three-second pan, frames over 33 ms | 0 of 181 | 0 of 181 |
| … on one CPU core | 0–3 of ~176 | 0–3 of ~176 |
| JavaScript heap at the end | 75 MB | 81 MB |

The bytes break down the same way in every run:

| Host | Esri | OpenFreeMap |
|---|---|---|
| hapmap (page, catalog, mosaics) | 3.6 MB | 3.6 MB |
| OpenFreeMap (vector tiles, fonts) | 3.5 MB | 3.5 MB |
| Esri Dark Gray Base (241 tiles) | 1.9 MB | — |
| Esri World Imagery (2025) | 0.4 MB | 0.4 MB |

The tour takes the same time in both because OpenFreeMap's vector tiles set its pace in both: the labels wait for them whichever backdrop is drawn.
The six extra megabytes of heap are the backdrop's thirteen vector layers, laid out on the main thread.

## What the numbers leave out

- **Network speed.** Everything ran on hectar's connection, which is fast enough that the 2 MB saved hardly shows. At 10 Mbit/s, a phone on a good 4G signal, it is about 1.6 seconds of downloading saved in a session, and 241 requests fewer.
- **Phones.** One core of hectar's Ryzen is still faster than most phones, and the GPU stays an RTX 5060 Ti. The one-core runs show the vector backdrop does not lean on the CPU any harder; they do not show how a phone's GPU copes with it.
- **The first runs.** A first round of trials hung partway, on a race in the test script (waiting for an `idle` event that had already fired), and was thrown away; so was a round that, through a bug since fixed, measured a backdrop with no rivers.

## How it was measured

`scripts/compare-builds.py`, with the two preview URLs above:

```sh
uv run --with playwright python scripts/compare-builds.py out.json 5 esri=… ofm=…
systemd-run --user --scope -p CPUQuota=100% uv run --with playwright python scripts/compare-builds.py out.json 5 esri=… ofm=…
```

Bytes come from Playwright's request log, which sees MapLibre's web workers, where vector tiles are fetched.
Chrome's own DevTools log misses those requests, and its CPU and network throttling do not reach the workers either, so the slow runs hold the whole browser to one core with a cgroup instead.
