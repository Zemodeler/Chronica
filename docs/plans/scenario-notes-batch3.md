# Scenario notes, batch 3

Scenario DATA changed in batch 3, so a version bump is needed (the lead bumps once, at the end; `built-in-versions.ts` and the scenario pin were not touched here).

Intended version note, in the age's words:

> **Ostia and the merchant's start.** Rome has a harbour: Ostia, at the mouth of the Tiber, is a port of the province that holds the city, so a venture from Rome sails by sea
> (the castrum at the river's mouth is dated by excavation and Livy's tradition to about 349-338 BCE; the seventh-century foundation under Ancus Marcius is legend; its being
> Rome's port by 270 is certain, its size a guess). A declared merchant begins with at least twenty-five thousand drachmae (a first venture, or a firm that can sail),
> and a senator with at least sixty thousand, so the two classes keep apart.

What changed, and where:

| Change | File | Hook |
| --- | --- | --- |
| The settlement `settlement-ostia` (kind `port`, size 3, fortification 2, province `it-l865w`, controller `rome`) | `packages/db/src/punic-wars-ostia.ts` | `punic-wars-scenario.ts`, the loop that groups the graph's settlements by province, now reads `[...PUNIC_WARS_GRAPH_SETTLEMENTS, ...OSTIA_SETTLEMENTS]` |
| The equestrian band's floor 10,000 to 25,000; the senatorial band's floor 25,000 to 60,000 | `packages/db/src/punic-wars-merchant-start.ts` | `punic-wars-scenario.ts`, the `wealth.bands` entries read `EQUESTRIAN_FLOOR` and `SENATORIAL_FLOOR` |

What else the version carries, though it is engine and not data (a pinned scenario saved before it keeps its old rules as the engine reads them): the estate and venture shares
(`material/estates.ts`, `material/ventures.ts`) are a tenth and about a fifth of what they were and the prices are as they were, so an estate pays six in the hundred a year and
a venture seventeen; a cargo's margin is five to twenty-four in the hundred a voyage; and a firm needs 8,500 to sail. The hub count is unchanged (Rome's province was a hub
already; `rome-has-ostia.test.ts` pins forty to eighty).

The web draws Ostia on the map where the generated GeoJSON (`public/maps/punic-wars-provinces.geojson`, made by `scripts/map-gen`) has none: `apps/web/lib/punic-wars-map.ts` adds the point (41.755 N, 12.289 E) until the map is next generated with it.

A game saved before the bump has no Ostia in Rome's province and keeps its old wealth bands: the engine's rules above apply to it all the same.
