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
node --max-old-space-size=14336 scripts/map-gen/generate-provinces.cjs out=map x0=-18 x1=64 y0=15.5 y1=59 \
  nf=14 warp=2 ridge=1 crest=8 slope=4 min=140 seeds=seeds270-v4.json pin=scripts/map-gen/fill-pins.json
```

Writes `map.json` (rings per province in lon/lat), `map.fill.json` (the filler seeds, to copy over `fill-pins.json`), `map.svg` and `map.png`. (The window is the shipped map's; the exact knobs of the
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
MAP_GEN_DATA=<dir> tsx scripts/map-gen/build-map-graph.ts
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

### Iraq, the desert belt and open desert (v5)

- Iraq and Kuwait come from the Natural Earth outlines like the other eastern countries; Iraq is settled ground except the
  Hamad and Wadi Hauran west of the Euphrates and Kuwait's desert (`ARID` in the generator). `iraq-polities.json` is the fourth
  polity file; its `seleucidCities` join `seleucid-empire` (two cities of uncertain site are dropped).
- Between lat 20 and 33 the Sahara and Arabia are masked by the natural land of their countries (`belt=0` turns it off), kept 7 px
  from the sea, so what survives is decided by settlements, rivers and coast and not by the old polygons or by borders.
  The lone-seed radius ramps from lat 33 to 37 instead of switching at 35, which had drawn a ruler-straight edge across Algeria.
- Every province carries `wetFrac`; `desert-steppe` needs it under 0.5. A desert-steppe province with no settlement, no river
  and no coast, 80 km or more from every town, has no controller (open desert). The validator allows nothing else unowned and
  reports outer edges that keep one heading for over `STRAIGHT_KM` (default 60) km.
- `fill-pins.json` pins the filler seeds of the latest run.

### Solid belts, and the ground the map leaves out

- **Africa (lon -18..37, lat 15.5..35.5)** is shaped as solid belts: land within about 120 km of a coast or a main (perennial) river,
  or 24 px of a town, is provinced whole; the open desert beyond stays empty. The belt tapers to a rounded end at Tarfaya (Cape Juby)
  on the Atlantic and at Syene and Philae on the Nile (the Canary Islands keep the full band), its edges are closed, opened and rounded
  with a mean filter, low ground it encloses is filled, rings of strips are opened, dead-end strips trimmed two cells deep and orphans
  removed (`bband`, `btown`, `bclose`, `bopen`, `bsmooth`, `hfill`, `ringgap`, `stub`, `cap`). The Sirhan/Najd corner of Arabia gets
  the same tidying without the band. The builder folds unowned bubbles inside owned country into their surroundings.
- **Land left out of the map** (massifs above 2,000 m, deep desert, land no province covers) is not written anywhere. The generator
  still labels it as one more cell of the arc network the provinces are traced from, so **a province's border with left-out land is
  smoothed like a border between two provinces**, not like coast: there is no gap and no overlap with the neighbour, and the edge
  stays a shared arc. That label is internal to the trace; dropping it would change the smoothing near the Alps and the massifs and
  so the provinces themselves.
- **Nile band to Meroe**: the belt is not cut by the southern wander (lon 28..36.5 lowers its limit to 15.4) and ends in a rounded cap
  at Meroe (16.93N 33.72E); Sudan is part of the Egypt-Arabia country rings so `kush` owns the band.
- **Towns keep a province**: every seed of the old map and the polity files gets a 10 px disc inside the belt scope (8 px island disc
  for a town off the mask's shore: Failaka, Tylos). The builder snaps settlements offshore up to 25 km onto the province shore, and the
  validator fails any settlement outside its own province.

### Who owns what: polity files, corrections, cleaning

Order in `build-map-graph.ts`: old map owners, then the six polity files (`anatolia`, `egypt-arabia`, `levant-caucasus-iran`, `iraq`,
`zagros`; a province is tested against `zagros-polities.json` first, then its own theatre's file, first match by province centre),
then the **ownership corrections**, then the cleaning.

- **Corrections**: every `scripts/map-gen/ownership-corrections*.json` (sorted by name, entries in order, later wins) is
  `{ assignments: [{ id, polity | "unowned", polygon | polygons, reason, sources, confidence, openDesert?, onlyFrom? }] }`. A province whose
  centre (a point inside it, nearest its centroid) lies in the polygon takes the polity. Polygons must be simple (they are closed if not);
  unknown polities and self-crossing polygons are reported and skipped. A province holding a capital or an anchor, or a town another
  polity's file gave to another polity, keeps its owner and the clash is printed as a conflict. Settlements in a corrected province follow it.
  Given-away land stays owned even where it is open desert, unless the entry says `"openDesert": "unowned"` (then the desert rule applies).
  `onlyFrom` limits an entry to provinces held by the listed polities (`ownership-corrections-vaspurakan.json` uses it).
- **Pinning**: every province a correction decides, changed or not, is fixed against the cleaning, except a group of one or two that
  stands as a spike or a neck (released, printed as "pins let go").
- **Cleaning** is two stages sharing the drift bound. Stage 1 (the old pass): iterated conditional modes on the border length plus a pull to
  the old map's owner, exclaves folded; polities may drift 8% from the old ground. Stage 2: a lighter pull, a curvature term (extra turns
  of a polity's border around a province), provinces with 60% or more of their border against one other polity move to it, moves that
  would cut their polity in two are refused, exclaves folded again; every polity stays within 10% of its land before and after stage 1
  (2% for a polity a correction gave land to or took from). Provinces with a settlement stay fixed. A piece of 8 provinces or more holding
  a polity-file town is a region, not an exclave (Persis behind the Zagros).
- **Measures** (`border-metrics.ts`, printed by the builder before, between and after the stages, and by the validator on the emitted
  graph as reported, non-failing lines): border km between polities and tortuosity (border length over half the convex hull perimeter of its
  edge midpoints) per pair; spikes (60% of a province's border against one polity, or one own neighbour and two foreign); necks (a province
  whose removal cuts off a piece of 2 or more, or at most two own neighbours and three foreign); teeth (a - b - a - b chains whose
  middle provinces have no kin); exclaves per landmass. The validator's figures use the graph's centre-to-centre edge lengths, so they
  differ from the builder's, which use shared border lengths.
- Rebuilding ownership never regrows provinces: `map.json` stays as it is and the builder reproduces the geometry byte for byte.

## Relief tiles

`build-relief-tiles.cjs` writes the sharp shaded relief under the atlas: an equirectangular tile pyramid,
`apps/web/public/maps/relief/tiles/{z}/{x}/{y}.webp` and `tiles.json` (about 3 MB in all, webp quality 80).

```bash
MAP_GEN_DATA=<dir> node scripts/map-gen/build-relief-tiles.cjs           # bounds lon -25..66, lat 14..62 by default
node scripts/map-gen/fetch-elevation.cjs x0=-25 x1=66 y0=14 y1=62         # first, for the Terrarium tiles that cover them
```

- **Grid.** World-aligned, 512 px tiles: z0 is 45 degrees to a tile and each level halves it; z3 is 5.625 degrees, 0.010986 degrees a
  pixel, the native resolution of Terrarium z7 (1.2 km at the equator). A tile is `x = floor((lon + 180) / tileDegrees)`,
  `y = floor((90 - lat) / tileDegrees)`. The client draws them straight into its lon/lat world space, so nothing is re-projected at
  draw time (`relief-tiles.ts`); it fetches only the tiles in view and tones each like the base raster (`atlas-tone.ts`).
- **Image.** Neutral, for the tone pass: land is Natural Earth II's own regional colour (land only, blurred until its shading is gone)
  under a new hillshade from the elevation, peaks lightened toward rock and snow; sea is blue with depth shading. The elevation is
  resampled from Web Mercator once, in memory.
- **Coast.** The land polygons the provinces were grown on (`coverage.geojson` plus the Natural Earth 50m countries), rasterised at
  full resolution, lakes (AWMC) cut out, lightly smoothed so the 1 km lattice leaves no staircase. Islands the polygons lack are kept
  where the elevation is at least 8 m and no polygon is near. The relief and the province coasts register to within a pixel of z3.
- **Edges.** The last degree of the box fades to transparent, so beyond it the whole-world Natural Earth II raster shows.

### Credits

The relief carries: elevation from the **AWS Open Data Terrain Tiles** (Mapzen Terrarium; derived from SRTM, GMTED2010, ETOPO1 and
others: https://registry.opendata.aws/terrain-tiles/), colour from **Natural Earth II with Shaded Relief and Water** and coasts from
the **Natural Earth 50m countries** (public domain, naturalearthdata.com), lakes and rivers from the **Ancient World Mapping Center**
(ODbL), settlements from **Pleiades** (CC BY 3.0). The site footer names them.
