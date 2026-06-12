# hap-mapper

A [topotijdreis.nl](https://www.topotijdreis.nl/)-style time-travel webmap for
the Hap-Map project, showing historical aerial photography of North Canberra.

Drag the year handle on the timeline (or press the play button) to crossfade
between imagery years. Years with available imagery are marked with orange
dots on the timeline; currently 1955 (Geoscience Australia historical aerial
photography served from R2 via tiles.hapmap.app) and 2025 (Esri World
Imagery).

To add a new imagery year, append an entry to the `IMAGERY_YEARS` array in
`index.html`.
