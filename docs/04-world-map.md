# World map

## Purpose and presentation

The map is a living visual representation of where events happen and what changed. It remains visible beneath temporary panels and is read-only in Phase 1. Hover shows only a province name; click may focus or highlight a location but never opens a detailed information panel.

Use original atmospheric artwork, thin province borders, transparent realm-color overlays, clear capital and city markers, occasional force markers, and minimal effects. Do not copy Pax Historia assets, layouts, or branding. Never show character markers.

Render in this order:

```text
Base-world image
→ province and realm borders
→ ownership color overlays
→ city and capital markers
→ army markers
→ temporary war and event effects
```

At far zoom show the base image, realm overlays/borders, and capitals. At medium zoom add provinces, major cities, visible forces, and active war effects. At close zoom add towns, villages, forts, local forces, and additional labels.

## Scenario assets

Every scenario supplies immutable visual geography and mutable state separately:

1. A label-free, original **PNG** base-world image in sRGB. Use equirectangular/WGS84 alignment across longitude −180 to 180 and latitude −90 to 90; provide 4096×2048 pixels when possible, never less than 2048×1024.
2. An `application/geo+json` GeoJSON FeatureCollection using the same WGS84 coordinates and alignment.
3. Dynamic state keyed to stable feature/entity IDs.

The PNG only supplies coastlines, land texture, subtle relief, terrain, rivers, and other atmosphere. It never carries changing borders, labels, ownership, forces, or effects. The author must hold the rights to all supplied assets. The existing upload boundary limits GeoJSON files to 20 MiB.

Do not provide roads for Phase 1. Existing code can represent road features for later use, but the Phase 1 renderer and authoring requirement omit them.

## Target map contracts

The implementation-facing conceptual contract is:

```ts
type ProvinceProperties = {
  id: string
  name: string
  terrain?: string
  regionId?: string
}

type SettlementProperties = {
  id: string
  provinceId: string
  name: string
  type: "capital" | "city" | "town" | "village" | "fort" | "port"
}

type ProvinceMapState = {
  provinceId: string
  ownerRealmId: string | null
  controllerRealmId: string | null
  occupied: boolean
}

type SettlementMapState = {
  settlementId: string
  ownerRealmId: string | null
  underSiege: boolean
  damaged: boolean
}

type ArmyMapState = {
  id: string
  ownerRealmId: string
  provinceId: string
  position: [number, number]
  soldiers: number
  status: "idle" | "moving" | "besieging" | "retreating"
}
```

## Current-contract mapping

Current GeoJSON uses a `region` feature where this document says province; its feature `id` is the stable province ID, and `terrainId`, `tier`, `controllerPolityId`, and `controlFirmnessBps` live in its properties. A `settlement_anchor` point maps to `SettlementProperties`; current kinds are `city`, `town`, `village`, `fortress`, and `port`, while a capital is represented by its polity's `capitalSettlementId` rather than a settlement kind.

`DynamicMapOverlay` is the current delivery shape: `provinces` maps to live controller/control information, `settlements` maps to settlement identity and controller, and `forces` maps to an army's owner, province, optional coordinate, strength label, and movement. The target `ownerRealmId`, `occupied`, `underSiege`, `damaged`, numeric `soldiers`, and `besieging` status remain useful simulation concepts, but are not all fields of the current overlay. They must be derived from or added to authoritative state before presentation—never inferred from pixels.

## Interaction and events

Use small realm-colored flags or icons for forces. Brief effects communicate movement, battle, siege, city damage, occupation, and conquest color changes. Avoid persistent animations, excessive labels, outlines, or visual noise. After each AI-resolved turn, patch the overlay from committed state; save and restore it independently of the static PNG and GeoJSON.

## Validation and milestones

Before a scenario loads, require unique IDs, schema-valid geometry, valid settlement/province references, valid dynamic references, and matching image/GeoJSON coordinates. Reject overlapping province polygons during scenario validation. Missing optional settlement layers must not block loading.

1. Render the base PNG.
2. Load aligned province GeoJSON.
3. Render borders and ownership tints.
4. Add capital/city markers and zoom visibility.
5. Add dynamic force markers and province-name hover.
6. Add battle, siege, occupation, and city-damage effects.
7. Patch the map after turn resolution and restore saved dynamic state.
