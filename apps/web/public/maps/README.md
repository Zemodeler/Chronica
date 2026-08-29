# Natural Earth source assets

- `natural-earth-50m-admin0-countries.geojson` is the Natural Earth 1:50m
  Admin 0 Countries dataset. It is a global, 242-feature country-boundary
  source that includes Europe and Africa.
- `natural-earth-ii-blue-oceans.png` is the Natural Earth II flat-ocean base
  map, 4000 × 2000 pixels. It is label-free and intended as an atmospheric
  equirectangular base image.

Natural Earth data is public domain. Source pages:

- https://www.naturalearthdata.com/about/terms-of-use/
- https://github.com/nvkelso/natural-earth-vector
- https://www.shadedrelief.com/NE2/

These are source assets, not a ready-to-load Chronica scenario. Before use in
the game, derive the required `region` features and stable Chronica IDs from
the country geometry; do not use this country layer as an authoritative
province map.

## Current regional boundary source

`apps/web/lib/europe-north-africa-geojson.ts` loads 879 ADM1 boundaries
from 50 Europe and Northern Africa country layers supplied by geoBoundaries
gbOpen. It is normalized to Chronica's `province` feature contract and uses
WGS84 longitude/latitude, matching the equirectangular base image. The
geometry is clipped to longitude −25° to 60° and latitude 15° to 72° and
rounded to five decimal places, keeping it under the 20 MiB upload limit.

- Metadata endpoint: https://www.geoboundaries.org/api/current/gbOpen/ALL/ADM1/
- Geographic selection: `Continent = Europe` or `UNSDG-subregion = Northern Africa`
- Source licences vary by country; preserve the geoBoundaries attribution metadata when redistributing.

## Europe and North Africa raster subset

`europe-north-africa/` contains only the Natural Earth II tiles intersecting
longitude −25° to 60° and latitude 15° to 72° (Europe and North Africa). The
tile tree uses standard XYZ paths, with the available zoom levels recorded in
`europe-north-africa/tiles.json`. `europe-north-africa-z6.png` is a 4096 ×
4352 PNG preview assembled from the deepest available regional tiles.

Regenerate this subset from a compatible Natural Earth MBTiles source with:

```sh
python3 scripts/extract-natural-earth-region.py SOURCE.mbtiles apps/web/public/maps/europe-north-africa
```
