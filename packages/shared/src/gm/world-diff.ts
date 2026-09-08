import type { WorldState } from "../world/world-state";

// Generic world-state diffing (GM refactor: structured Chronicle deltas
// without per-action logic).
//
// The Chronicle's "Map Changes" cards need to know exactly what changed
// after a tool call -- a province's controller, a force's location, an
// account's balance, a character's office. The old approach was a switch
// statement keyed on the workflow's `actionId`: one hand-written case per
// action, understanding that action's own parameters. That does not scale --
// there are dozens of built-in workflows, the Game Master can invent new
// ones at runtime with `define_action`, and a battle or a siege's real
// effect (casualties, a captured settlement, a routed army) was never one of
// the hand-written cases at all.
//
// This is the replacement: a small, declarative registry of the world's
// trackable entity collections (forces, provinces, characters, accounts,
// wars, diplomatic messages, political procedures -- more are one registry
// entry away, never a new case in a switch), and one generic function that
// diffs `before`/`after` world state across that registry. It has no idea
// which workflow ran. Whatever changed, on whichever entities, however it
// happened -- a built-in workflow, an invented one, a future one nobody has
// written yet -- comes out the same way.

/** One tracked field's before/after value on an entity that already existed. */
export interface EntityFieldChange {
  readonly field: string;
  readonly from: unknown;
  readonly to: unknown;
}

/** A single entity's change, as found by diffing one collection before/after one tool call. */
export interface EntityStateDelta {
  readonly entityType: string;
  readonly entityId: string;
  readonly entityName: string;
  readonly change: "created" | "deleted" | "updated";
  /** Present only for "updated": every tracked field that actually differed. */
  readonly fields?: readonly EntityFieldChange[];
}

interface TrackedRecord {
  readonly id: string;
  readonly [key: string]: unknown;
}

interface TrackedField {
  readonly field: string;
  /** Reads the field's value off an entity. Defaults to `entity[field]`; override for a computed value (e.g. a force's fit strength). */
  get(entity: TrackedRecord): unknown;
  /** Resolves a raw value (usually a referenced id) into something readable, using the world it came from. */
  resolve?(value: unknown, world: WorldState): unknown;
}

interface TrackedCollection {
  readonly entityType: string;
  select(world: WorldState): readonly TrackedRecord[];
  nameOf(entity: TrackedRecord, world: WorldState): string;
  readonly fields: readonly TrackedField[];
}

/** A tracked entity's own display name, when it has one worth showing; its id otherwise. */
function stringField(entity: TrackedRecord, key: string): string {
  const value = entity[key];
  return typeof value === "string" && value.length > 0 ? value : entity.id;
}

function field(name: string, resolve?: TrackedField["resolve"]): TrackedField {
  return resolve === undefined ? { field: name, get: (entity) => entity[name] } : { field: name, get: (entity) => entity[name], resolve };
}

function polityRef(id: unknown, world: WorldState): string {
  if (typeof id !== "string") return "unclaimed";
  return world.map.polities.find((polity) => polity.id === id)?.name ?? id;
}

function characterRef(id: unknown, world: WorldState): string {
  if (typeof id !== "string") return "nobody";
  return world.characters.find((character) => character.id === id)?.name ?? id;
}

function provinceRef(id: unknown, world: WorldState): string {
  if (typeof id !== "string") return "nowhere";
  return world.map.provinces.find((province) => province.id === id)?.name ?? id;
}

function fitStrengthOf(entity: TrackedRecord): number {
  const personnel = entity["personnel"];
  if (!Array.isArray(personnel)) return 0;
  return personnel.reduce((sum: number, category) => sum + (typeof category === "object" && category !== null && typeof (category as { fit?: unknown }).fit === "number" ? (category as { fit: number }).fit : 0), 0);
}

/**
 * The registry. Adding a new trackable entity type -- a new kind of workflow
 * target the Chronicle should surface -- is one entry here, never a new
 * branch anywhere else. Field lists are deliberately small: only what is
 * worth a player-facing "map changed" line, not every internal bookkeeping
 * field (fatigue decay, provisioning countdowns) that would otherwise fire
 * on nearly every turn.
 */
const TRACKED_COLLECTIONS: readonly TrackedCollection[] = [
  {
    entityType: "force",
    select: (world) => world.material.forces,
    nameOf: (entity) => stringField(entity, "name"),
    fields: [
      field("name"),
      field("locationId", provinceRef),
      field("commanderCharacterId", characterRef),
      field("polityId", polityRef),
      { field: "fitStrength", get: fitStrengthOf },
      field("moraleBps"),
      field("provisionStatus"),
    ],
  },
  {
    entityType: "province",
    select: (world) => world.map.provinces,
    nameOf: (entity) => stringField(entity, "name"),
    fields: [field("controllerPolityId", polityRef), field("controlFirmnessBps")],
  },
  {
    entityType: "settlement",
    select: (world) => world.map.provinces.flatMap((province) => province.settlements),
    nameOf: (entity) => stringField(entity, "name"),
    fields: [field("controllerPolityId", polityRef), field("fortificationLevel")],
  },
  {
    entityType: "character",
    select: (world) => world.characters,
    nameOf: (entity) => stringField(entity, "name"),
    fields: [field("alive"), field("officeId"), field("locationProvinceId", provinceRef), field("polityId", polityRef)],
  },
  {
    entityType: "account",
    select: (world) => world.material.accounts,
    nameOf: (entity, world) => {
      const owner = entity["owner"] as { kind?: string; id?: string } | undefined;
      if (!owner?.id) return entity.id;
      return owner.kind === "polity" ? polityRef(owner.id, world) : characterRef(owner.id, world);
    },
    fields: [field("balance"), field("status")],
  },
  {
    entityType: "war",
    select: (world) => world.conflicts.wars.map((war) => ({ ...war, id: [war.polityAId, war.polityBId].sort().join("::") })),
    nameOf: (entity, world) => `${polityRef(entity["polityAId"], world)} vs ${polityRef(entity["polityBId"], world)}`,
    fields: [],
  },
  {
    entityType: "diplomaticMessage",
    select: (world) => world.diplomacy,
    nameOf: (entity) => stringField(entity, "subject"),
    fields: [field("status"), field("answer")],
  },
  {
    entityType: "politicalProcedure",
    select: (world) => world.material.politicalProcedures,
    nameOf: (entity) => stringField(entity, "type"),
    fields: [field("stage"), field("outcome"), field("resolvedAtStep")],
  },
];

function valuesDiffer(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return JSON.stringify(a) !== JSON.stringify(b);
  return a !== b;
}

/**
 * Diffs one collection: every entity present in `after` but not `before` is
 * "created", every entity present in `before` but not `after` is "deleted",
 * and every entity in both with at least one tracked field changed is
 * "updated" (with exactly the fields that changed). An entity absent from
 * both, or present in both with no tracked field different, contributes
 * nothing.
 */
function diffCollection(collection: TrackedCollection, before: WorldState, after: WorldState): EntityStateDelta[] {
  const beforeById = new Map(collection.select(before).map((entity) => [entity.id, entity]));
  const afterById = new Map(collection.select(after).map((entity) => [entity.id, entity]));
  const deltas: EntityStateDelta[] = [];

  for (const [id, entity] of afterById) {
    const prior = beforeById.get(id);
    if (prior === undefined) {
      deltas.push({ entityType: collection.entityType, entityId: id, entityName: collection.nameOf(entity, after), change: "created" });
      continue;
    }
    const fields: EntityFieldChange[] = [];
    for (const tracked of collection.fields) {
      const fromRaw = tracked.get(prior);
      const toRaw = tracked.get(entity);
      if (!valuesDiffer(fromRaw, toRaw)) continue;
      fields.push({
        field: tracked.field,
        from: tracked.resolve ? tracked.resolve(fromRaw, before) : fromRaw,
        to: tracked.resolve ? tracked.resolve(toRaw, after) : toRaw,
      });
    }
    if (fields.length > 0) deltas.push({ entityType: collection.entityType, entityId: id, entityName: collection.nameOf(entity, after), change: "updated", fields });
  }

  for (const [id, entity] of beforeById) {
    if (!afterById.has(id)) deltas.push({ entityType: collection.entityType, entityId: id, entityName: collection.nameOf(entity, before), change: "deleted" });
  }

  return deltas;
}

/**
 * The single entry point: everything that changed anywhere in the tracked
 * registry between two world-state snapshots, entirely independent of what
 * produced the change. Call it with the staged world immediately before and
 * immediately after one tool call (as `deriveBattleBrief` already does for
 * battles) to get that call's own effect; call it across a whole turn to get
 * the turn's complete effect. Either way, no caller needs to know which
 * workflow ran, built-in or invented.
 */
export function diffWorldState(before: WorldState, after: WorldState): EntityStateDelta[] {
  const deltas: EntityStateDelta[] = [];
  for (const collection of TRACKED_COLLECTIONS) deltas.push(...diffCollection(collection, before, after));
  return deltas;
}
