# hap-mapper

A [topotijdreis.nl](https://www.topotijdreis.nl/)-style time-travel webmap for
the Hap-Map project, showing historical aerial photography of North Canberra.

Drag the year handle on the timeline (or press the play button) to crossfade
between imagery years. Years with available imagery are marked with orange
dots on the timeline; currently 1955 (the complete CAC80-81-88 campaign
mosaic, restituted via MicMac), 1980 (SOC276/277 colour restitution), and
2025 (Esri World Imagery). The historical layers are Cloud-Optimized
GeoTIFF orthomosaics stored in R2 and rendered client-side, GPU-reprojected
to Web Mercator from their native GDA2020/MGA-zone-55 grid, via
[`@geomatico/maplibre-cog-protocol`](https://github.com/geomatico/maplibre-cog-protocol).

The map is built on [MapLibre GL JS](https://maplibre.org/), whose WebGL
renderer reprojects the COG on the GPU and gives smooth raster-opacity
crossfades. There is no build step: MapLibre loads from a CDN `<script>` tag
and the COG protocol is imported as an ES module from esm.sh.

To add a new imagery year, append an entry to the `IMAGERY_YEARS` array in
`index.html`.
