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

## Planned label behaviour

Keep labels separate from the immutable base image and GeoJSON boundaries, so they can react to zoom, ownership, and the historical scenario.

1. At far zoom, show only realm and major sea/geographic-feature labels. Prefer a realm's visual centre and suppress a label when it would collide with another higher-priority label.
2. At medium zoom, add province labels and capital names. Province labels use the polygon's visual centre (or an author-provided anchor when the centre falls outside a concave or coastal polygon).
3. At close zoom, add cities, towns, forts, ports, and local geographic-feature labels. Settlement labels use their point feature as the anchor.
4. Resolve collisions by the existing rule priority, then by importance; hide lower-priority labels rather than allowing overlap. Realm, capital, and currently selected labels take precedence.
5. Keep label content and typography presentation-only: the GeoJSON supplies feature names and anchors, while `MapVisualConfig.labels` supplies zoom bands, priority, and casing. Do not bake labels into the raster map.

## Scenario assets

Every scenario supplies immutable visual geography and mutable state separately:

1. A label-free, original **PNG** base-world image in sRGB. Use equirectangular/WGS84 alignment across longitude −180 to 180 and latitude −90 to 90; provide 4096×2048 pixels when possible, never less than 2048×1024.
2. An `application/geo+json` GeoJSON FeatureCollection using the same WGS84 coordinates and alignment.
3. Dynamic state keyed to stable feature/entity IDs.

The PNG only supplies coastlines, land texture, subtle relief, terrain, rivers, and other atmosphere. It never carries changing borders, labels, ownership, forces, or effects. The author must hold the rights to all supplied assets. The existing upload boundary limits GeoJSON files to 20 MiB.

Do not provide roads for Phase 1. Existing code can represent road features for later use, but the Phase 1 renderer and authoring requirement omit them.

### Scenario Designer — Flags

The Scenario Designer includes a **Flags** section. A scenario author may upload any image they have the right to use and add it to that scenario's flag catalogue. Uploaded flags are available as army standards in games created from the scenario.

Each flag entry has a stable `flagAssetId`, display name, image URL, and optional attribution/credit. The Designer accepts common image formats (`PNG`, `JPEG`, `WebP`, and `SVG`); it validates the file type and size, stores the original asset safely, and produces a web-sized preview. Preserve the image's aspect ratio and contain it within the standard marker frame—never crop a banner into a square.

An army may reference one catalogue `flagAssetId`. If it does not, the game uses the scenario's default standard. The in-game army details panel shows the available scenario catalogue when the player changes a standard; it must not offer assets from another scenario. Removing a flag that is in use requires the Designer to choose a replacement/default first, so existing armies never render with a broken image.

```ts
type ScenarioFlagAsset = {
  flagAssetId: string
  name: string
  imageUrl: string
  attribution?: string
}

type ArmyMapState = {
  // ...existing army fields
  flagAssetId?: string
}
```

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

`DynamicMapOverlay` is the current delivery shape: `provinces` maps to live controller/control information, `settlements` maps to settlement identity, controller, capital membership, siege, and damage state, and `forces` maps to an army's owner, province, optional coordinate, strength label, and movement. Capital membership derives from a polity's `capitalSettlementId`; it is not a separate simulation settlement kind. These values must be derived from authoritative state before presentation—never inferred from pixels.

## Interaction and events

Use small scenario-supplied flags or icons for forces. Movement uses its explicit path and progress to place the marker and show only its travelled route. Battle, siege, city damage, occupation, and conquest effects communicate current-turn state through typed committed presentation events: battles have a semantic coordinate; other effects target stable province or settlement IDs. Animate a marker only on its first appearance in a browser session, then retain the marker for the turn without a looping animation. Avoid excessive labels, outlines, or visual noise. After each AI-resolved turn, patch the overlay from committed state; save and restore it independently of the static PNG and GeoJSON.

## Validation and milestones

Before a scenario loads, require unique IDs, schema-valid geometry, valid settlement/province references, valid dynamic references, and matching image/GeoJSON coordinates. Reject overlapping province polygons during scenario validation. Missing optional settlement layers must not block loading.

1. Render the base PNG.
2. Load aligned province GeoJSON.
3. Render borders and ownership tints.
4. Add capital/city markers and zoom visibility.
5. Add dynamic force markers and province-name hover.
6. Add battle, siege, occupation, and city-damage effects.
7. Patch the map after turn resolution and restore saved dynamic state.
