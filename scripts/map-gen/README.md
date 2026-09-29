# Province generator

Grows about 6,000 organic provinces for Europe, North Africa and the Near East as far as Iran, in the
density of Imperator: Rome's territories, from open data. Plan and decisions:
`docs/plans/imperator-density-map.md`.

## Method

1. **Seeds.** Pleiades places typed settlement or urban that were alive in 270 BCE
   (`pleiades-seeds.cjs`), de-duplicated to one per ~13 km. Where Pleiades is thin
   (Germania, Britain, the interior) filler seeds are added on a Poisson lattice.
2. **Land.** The polygons of the 780 provinces the game already simulates
   (frozen in `coverage.geojson`, see below), plus Turkey, Egypt, Arabia, the Levant, the Caucasus and Iran from the Natural Earth 50m countries file.
   Lakes (AWMC) are cut out.
3. **Growth.** Every province grows from its seed across a 1 km grid by cost distance
   (multi-source Dijkstra). A step costs more across noise, across ridge crests and
   steep slopes (AWS Terrarium elevation), and across major rivers (AWMC), so borders
   settle on watersheds and rivers and wander like real ones.
4. **Gaps.** Land above 2,000 m and land far from any real settlement (the farther
   south, the smaller the allowance) is left empty, as in Imperator, except within
   reach of the coast or a river, which leaves the Nile and wadi strips.
5. **Tracing.** Borders are walked once between junctions on the pixel lattice, smoothed
   once, and reused by both neighbours, so adjacent provinces share exact vertices.
   Output rings have no open ends, and every interior segment appears in exactly two
   provinces (verified 2026-09-29: 369,684 matched segments, 96,511 coast).

## Data (git-ignored, in `.map-gen-data/`, or `$MAP_GEN_DATA`)

| Input | Source | Licence |
| --- | --- | --- |
| `data/pleiades-places-latest.csv` | https://pleiades.stoa.org/downloads | CC BY 3.0 |
| `data/awmc/*` (coastline, rivers, inland water, sand) | https://github.com/AWMC/geodata, `Physical Shapefiles Apr 2024.zip` | ODbL |
| `data/terrarium/7/{x}/{y}.png` | https://s3.amazonaws.com/elevation-tiles-prod/terrarium | AWS Open Data terrain tiles |
| `coverage.geojson` | the old map's polygons, frozen before the swap | repo history |
| `old-map.json` | the old map's ids, owners and settlements, frozen before the swap | repo history |
| `seeds270.json` | `pleiades-seeds.cjs` | derived |

`shapefile` and `csv-parse` are installed into the data folder
(`npm i --prefix .map-gen-data shapefile csv-parse`), not into the repo.

## Run

```bash
node scripts/map-gen/fetch-elevation.cjs
node scripts/map-gen/pleiades-seeds.cjs x0=-18 x1=64 y0=15.5 y1=59 out=seeds270-v4.json
node --max-old-space-size=14336 scripts/map-gen/generate-provinces.cjs out=v4 x0=-18 x1=64 y0=15.5 y1=59 \
  nf=14 warp=2 ridge=1 crest=8 slope=4 min=140 seeds=seeds270-v4.json pin=scripts/map-gen/fill-pins.json
```

Writes `v4.json` (rings per province in lon/lat), `v4.svg` and `v4.png`. (The window is the shipped map's; the exact knobs of the
shipped run were not recorded. `fill-pins.json` pins the filler seeds of an earlier run, so widening the window does not move
them; `klat` is pinned for the same reason.)
Useful knobs: `nf` noise size, `crest`/`slope` ridge weight, `fill` filler spacing
(px, 1 px is about 1.1 km), `hl` highland cut in metres, `anatolia=0` to drop Turkey.

## From polygons to a game map (stream F)

`generate-provinces.cjs` now also writes, per province, the facts the game map needs:
its seed (Pleiades name and id), true area in km2 (the raster is stretched by latitude, so pixels are weighted by row),
centroid, mean and max elevation, mean slope (m/km), whether it touches the sea, coast length, river and sand share,
and its adjacency: neighbour, shared border length in km (from the smoothed shared arcs) and mean ground height along it.
It also writes `<out>.samples.json` (one point every 4 px inside each province, for overlays) and a 4 px sea bitmap
inside `<out>.json`. Closed arcs (islands, holes) are split before smoothing; before, they collapsed to a point and
about 140 islands lost their outline. Cells under 5 km2 merge into the neighbour they share the longest border with;
isolated islets under 30 km2 are dropped. The run prints the topology check (matched and coast segments, open rings 0).

```bash
# from the repo root
MAP_GEN_DATA=<dir> tsx scripts/map-gen/build-map-graph.ts in=v4
MAP_GEN_DATA=<dir> tsx scripts/map-gen/validate-map-graph.ts
```

`build-map-graph.ts` writes `packages/db/src/punic-wars-map-graph.ts`, `apps/web/public/maps/punic-wars-provinces.geojson`
and `scripts/map-gen/anchors.json`. After a rebuild, `resolve-extra-anchors.ts` rewrites `packages/db/src/punic-extra-ids.ts`
(the provinces holding the test anchors in `anchors-extra.json`, by point-in-polygon) and `describe-map-asset.ts` rewrites
`packages/db/src/punic-map-asset.ts` (the asset's database row: feature count, box, size, checksum); `npm run maps:graph`
runs all three. `out=<suffix>` on the builder and the validator writes and checks a `-<suffix>` build beside the shipped one.

`audit-settlements.cjs` compares every settlement's pin with the Pleiades place of the same name and lists those further than
5 km. Pins it found wrong are corrected in the builder's `CORRECTED` table, and the towns the story is about carry their own
size and walls in its `AUTHORED_TOWNS`. A city or town within 4 km of the AWMC coastline becomes a port.

- **Ids** are `<region slug>-<5 base36>`, hashed from the seed position. Regions are coarse boxes in `map-names.ts`.
- **Names** come from the most notable ancient place inside the province (Pleiades settlements, islands, peoples, forts, harbours;
  a settlement the game already names wins). `ancientNameOf` keeps Latin and Greek looking titles and drops modern and
  descriptive ones. Clashes become "Heraclea in Thrace"; provinces with no ancient place inside are "Uplands north-east of Vasio"
  (terrain, compass, nearest named province), and "Shore 65 miles south-west of X" only where nothing is near.
- **Terrain**: touching the sea is `coastal-plain`; south of 34.5N with no river `desert-steppe`; mean height over 700 m or steep
  `hills-uplands`; else `hills`. `mountain-pass` is never used. Any province carrying a water edge is forced `coastal-plain`.
- **Edges**: land borders from the shared arcs, `pass` where the border's mean height is over 1400 m and both sides are hills;
  distance is centre to centre in km. Landmasses are joined by a minimum spanning tree over the shortest gaps (`strait` up to
  80 km of sea, else `sea_lane`; a gap across empty ground is a `land` crossing). Big landmasses (6+ provinces) get up to three
  parallel crossings at a strait and a sea lane apiece up to 220 km; straits inside one landmass (Otranto, the Gulf of Corinth)
  are added where the march round is 14+ provinces.
- **Ownership**: each province takes the polity holding most of its sample points in the old map; a pass then flips near-split
  provinces so each polity's land matches what its old ground now amounts to. Unowned Anatolian provinces take the first
  matching territory in `anatolia-polities.json`. A capital, and any town the Anatolian file names, pulls its province into its
  polity. Each anchor province keeps its old province's owner.
- **Anchors** (`anchors.json`, `PUNIC_ANCHORS`): for every old id the scenario hard-codes, the new province holding the
  historically right point, with a justification; `PUNIC_OLD_REGION_PROVINCES` lists every new province that lay mostly in it.
