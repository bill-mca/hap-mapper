# hap-mapper

A [topotijdreis.nl](https://www.topotijdreis.nl/)-style time-travel webmap for
the Hap-Map project, showing historical aerial photography of North Canberra.

Drag the year handle on the timeline (or press the play button) to crossfade
between imagery years. Years with available imagery are marked with orange
dots on the timeline; currently 1926, 1944, 1945, 1955, 1968, 1974–75, 1980 and
2025 (Esri World Imagery). 1955 is the complete CAC80-81-88 campaign,
restituted with MicMac; the others are Blag Map
mosaics of Geoscience Australia's historical aerial photography.

The historical layers are Cloud-Optimized GeoTIFFs stored in R2, reprojected
to Web Mercator (EPSG:3857) before upload, because
[`@geomatico/maplibre-cog-protocol`](https://github.com/geomatico/maplibre-cog-protocol)
draws nothing else. The Worker in `worker/cog-proxy.js` serves them
same-origin with proper range responses. What is in the bucket, where each
mosaic came from, and how each was georeferenced is recorded in
[docs/r2-inventory.md](docs/r2-inventory.md).

The map is built on [MapLibre GL JS](https://maplibre.org/), whose WebGL
renderer gives smooth raster-opacity crossfades. There is no build step:
MapLibre loads from a CDN `<script>` tag and the COG protocol is imported as
an ES module from esm.sh.

To add a new imagery year, upload its 3857 COG to R2, record it in the
inventory, and add a `cogYear({...})` entry to the `IMAGERY_YEARS` array in
`index.html`.
