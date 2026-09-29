# Province generator

Grows about 4,400 organic provinces for Europe, North Africa and Anatolia, in the
density of Imperator: Rome's territories, from open data. Plan and decisions:
`docs/plans/imperator-density-map.md`.

## Method

1. **Seeds.** Pleiades places typed settlement or urban that were alive in 270 BCE
   (`pleiades-seeds.cjs`), de-duplicated to one per ~13 km. Where Pleiades is thin
   (Germania, Britain, the interior) filler seeds are added on a Poisson lattice.
2. **Land.** The polygons of the 780 provinces the game already simulates
   (`dump-coverage.ts`), plus Turkey from the Natural Earth 50m countries file.
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
| `coverage.geojson` | `dump-coverage.ts` | repo |
| `seeds270.json` | `pleiades-seeds.cjs` | derived |

`shapefile` and `csv-parse` are installed into the data folder
(`npm i --prefix .map-gen-data shapefile csv-parse`), not into the repo.

## Run

```bash
node scripts/map-gen/fetch-elevation.cjs
node scripts/map-gen/pleiades-seeds.cjs
cd apps/web && tsx --tsconfig ../../scripts/map-graph/tsconfig.json ../../scripts/map-gen/dump-coverage.ts
node --max-old-space-size=14336 scripts/map-gen/generate-provinces.cjs out=full x0=-18 x1=46 y0=26 y1=59 \
  nf=14 warp=2 ridge=1 crest=8 slope=4 min=140
```

Writes `full.json` (rings per province in lon/lat), `full.svg` and `full.png`.
Useful knobs: `nf` noise size, `crest`/`slope` ridge weight, `fill` filler spacing
(px, 1 px is about 1.1 km), `hl` highland cut in metres, `anatolia=0` to drop Turkey.
