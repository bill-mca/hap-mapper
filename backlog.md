# Backlog

## Clean up the bucket and upgrade the mosaics

The steps are spelled out in [docs/mosaic-upgrade-plan.md](docs/mosaic-upgrade-plan.md).
What is in the bucket is in [docs/r2-inventory.md](docs/r2-inventory.md).

- [ ] Settle the four decisions in the plan: the 1980 layer, 1944 beside 1945, the 1974–75 label, and the `tiles.hapmap.app` domain.
- [ ] Delete the Leaflet tile pyramid and the two retired 1955 COGs (2.5 GB), once bilby confirms.
- [ ] Reproject the five Blag Map mosaics to 3857 COGs and upload them.
- [ ] Try the new layers on `hapmap-dev`.
- [ ] Carry them into `index.html`, fix the README, and deploy to production.
- [ ] Delete the misplaced SOC276 1980 COG and the preview-frame 1926 COG.
- [ ] Delete the SOC195 1980 COG once a full-scan Blag Map 1980 replaces it.
