# A map as dense as Imperator: Rome

Status 2026-09-29: generator built and topology-checked (`scripts/map-gen`); nothing
else changed. Branch `worktree-imperator-density-map`.

## Goal

Replace the 780 provinces with about 4,400 organic ones, in the density of
Imperator's territories, over Europe, North Africa and Anatolia. Geography only:
the polities stay ours. No save compatibility is needed. Imperator's own files are
not used (see the generator README for the open-data method).

## Decided

- Provinces are grown from Pleiades settlements alive in 270 BCE, constrained by
  rivers, ridges and coast. Deserts and high massifs are left empty.
- Coverage is the game's current 780 provinces plus Turkey.
- One border, one arc: neighbours share exact vertices.

## The swap is bigger than the map (survey, 2026-09-29)

Things that break outright at this size:

1. `ScenarioMapRulesSchema.provinceCount` is capped at 2,000 (`packages/shared/src/world/map.ts`).
2. `edge.distance` is never read. All travel is in hops: `MARCH_DAYS_PER_PROVINCE = 8`,
   news 2 days per land hop capped at 30, hop limits of 12, 8, 6, 2, 1 in `movement.ts`,
   `levies.ts`, `cognition.ts`, `passage.ts`. A five times finer map makes every march
   and letter five times slower, and long marches ("no road at all leads there") fail.
3. `apps/web/lib/character-service.ts` puts every province into the declaration prompt.
4. Townless provinces get a fixed countryside population (`material/province-material.ts`),
   so population, manpower, tax and grain inflate four to five times.
5. The map geometry is not versioned with the scenario (asset id `…0202`).
6. About 110 test files use the scenario as a fixture and about 50 hard-code province ids.

Also: `slice.ts` ranks provinces by alphabetical opaque id and caps at 40, so the
army's own province can be dropped; `normalize-refs.ts` repairs ids by shape and
compiles a regex per province per delta; the client parses about 10 MB of GeoJSON
with zod, twice, on every window focus, and `prepareStaticWorldGeometry` is O(P²);
`/overlay` becomes about 500 KB per 15 s poll; distress facts fire per province.

## Order of work

Each step leaves the repo testable.

1. Raise the schema cap; make `provinceCount` real and enforce it in a test.
2. Freeze a reference layer from the current code (old polygons, `controllerFor`
   output, terrain, settlement homes) so the new build does not import the old builder.
3. Make the sim scale-free before swapping the map: cached adjacency index;
   travel, news, sail and levy timing and hop limits from `edge.distance`; slice
   ranking by relevance; countryside by area; distress facts per polity.
4. Client hot spots: fetch and parse the map once, grid the label neighbours, slim
   `/overlay`, drop client zod. Test with a synthetic 4,000-polygon fixture.
5. Named test anchors (`PUNIC_IDS`) and migrate the ~50 literal-id tests, still on
   the old ids.
6. Generator to graph: polities by overlay of the old map, settlements by
   point-in-polygon, terrain from the small set, edges with crossing types,
   ancient names, centroids, ids. Anatolian polities (see open questions).
7. Rewire `punic-wars-scenario.ts` to the anchors; scenario v36; new asset id `…0203`.
8. Update tests, e2e (`map-selection.spec.ts`), docs (`docs/architecture.md`).
9. Load-test: world JSON size (about 0.7 MB to 3-4 MB), burst commit, overlay poll,
   first paint.

## Open questions

- Anatolia needs polities. The graph only holds controlled provinces. Which peoples
  and kingdoms hold Asia Minor in 270 BCE, and are they written now or left for later
  with provinces held by no one?
- What is one "province of march" now? Keep travel times per kilometre (so the war
  plays as before) or per province (faster and finer)? Recommended: per kilometre.
- Which new provinces are `focus` (Messana, Rhegium, Carthage, Syracuse) so they keep
  unrest and famine? Almost all others are "quiet ground".
- Do Etna and the Messana strait stay as positions in one province or become provinces?
