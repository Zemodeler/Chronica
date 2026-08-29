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
