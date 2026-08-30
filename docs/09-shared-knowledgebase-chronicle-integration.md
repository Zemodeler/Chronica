# Shared Knowledgebase — Chronicle Integration Guide

## Overview

The shared knowledgebase system stores factual claims (facts, rumours, plots) extracted from NPC
conversations and makes them available to other NPCs in the same social pool (polity, province,
dynasty). This document describes the **pending integration with the chronicle system**, which will
auto-populate pools with turn-level world events so NPCs "wake up" already knowing what happened.

## Current State

The function `ingestChronicleEntries` in `packages/db/src/queries/shared-knowledgebase.ts` is a
**no-op stub**. The chronicle system does not yet exist. When it is implemented, wiring it up
requires the steps below.

## What Needs to Change When the Chronicle is Built

### 1. Add metadata fields to `ChronicleEntry`

Chronicle entries need two optional fields so the shared knowledgebase can route them to the
correct pool:

```ts
// In the chronicle schema / type (wherever ChronicleEntry is defined):
associatedPolityId?: string;   // The polity this event primarily concerns
associatedProvinceId?: string; // The province where this event occurred
```

Without these, knowledge-scoped entries have no structural home and can only go to a game-wide
pool (which doesn't yet exist in the schema).

### 2. Call `ingestChronicleEntries` after turn resolution

After the chronicle entries for a resolved turn are written to the database, call:

```ts
import { ingestChronicleEntries } from "@chronica/db";

await ingestChronicleEntries(db, gameId, chronicleEntries.map(entry => ({
  body: entry.body,
  atStep: entry.atStep,
  audience: entry.audience,
  associatedPolityId: entry.associatedPolityId,
  associatedProvinceId: entry.associatedProvinceId,
})));
```

This should be called from the turn-resolution code path (likely in the worker), not from the
web server.

### 3. Implement the stub body in `ingestChronicleEntries`

Replace the `// TODO` comment with the actual routing logic:

```ts
export async function ingestChronicleEntries(db, gameId, entries) {
  for (const entry of entries) {
    if (entry.audience === "all_players") {
      // Public knowledge: game-wide pool (requires adding poolType "game" to schema first)
      await insertSharedEntry(db, gameId, "game", gameId, entry.body,
        "chronicle", "chronicle", entry.atStep);
    } else {
      // Positional knowledge: route to polity and/or province pool
      if (entry.associatedPolityId) {
        await insertSharedEntry(db, gameId, "polity", entry.associatedPolityId, entry.body,
          "chronicle", "chronicle", entry.atStep);
      }
      if (entry.associatedProvinceId) {
        await insertSharedEntry(db, gameId, "province", entry.associatedProvinceId, entry.body,
          "chronicle", "chronicle", entry.atStep);
      }
    }
  }
}
```

### 4. Add `poolType = "game"` to the schema (for `all_players` entries)

The current `shared_knowledgebase_entries` table accepts any text for `pool_type`. To add a
game-wide pool:

1. Add `"game"` to `SharedKnowledgebaseEntrySchema.poolType` enum in
   `packages/shared/src/dialogue/dialogue.ts`.
2. Ensure `listPoolEntries` in the dialogue service always includes `{ poolType: "game", poolKey: gameId }`
   in the pool specs for every NPC (so all NPCs read public chronicle entries).

## Pool Routing Rules

| Chronicle `audience` | `associatedPolityId` | `associatedProvinceId` | Destination pool |
|---|---|---|---|
| `all_players` | any | any | `game:{gameId}` |
| `knowledge_scoped` | set | — | `polity:{associatedPolityId}` |
| `knowledge_scoped` | — | set | `province:{associatedProvinceId}` |
| `knowledge_scoped` | set | set | both `polity` and `province` |
| `knowledge_scoped` | — | — | dropped (no structural home) |

## NPC Pool Membership

NPCs read from all pools their character traits map to:

| Character field | Pool type | Pool key |
|---|---|---|
| `polityId` | `polity` | character's `polityId` |
| `locationProvinceId` | `province` | character's current province |
| `dynastyId` | `dynasty` | character's `dynastyId` |
| _(always)_ | `game` | `gameId` _(once game pool is added)_ |

For discovered NPCs (`npc:discovered:*`) who don't exist in `world.characters`, the pool is
derived from the `locationProvinceId` stored in their knowledgebase row.
