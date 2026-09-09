import { z } from "zod";
import { OrderPartyRefSchema, type OrderPartyRef } from "../actions/orders";
import { MoneyAmountSchema, EntityIdSchema, ElapsedStepSchema } from "../material-state";
import { WorldInstantSchema, type WorldInstant } from "./instant";
import type { FactualEvent } from "../gm/session";

/**
 * The durable historical record an event's resolution produces (docs/32,
 * Phase 7 -- "Reactions, visibility, and Chronicle").
 *
 * `Fact` evolves `gm/turn-report.ts`'s `TurnReportEvent` and `gm/session.ts`'s
 * `FactualEvent` into one queryable, discovery-capable superset, without
 * changing either of those existing shapes or their existing consumers
 * (Chronicle narration input, tool-loop audit) -- see `factualEventToFact`
 * below for the integration seam.
 */

export const FactVisibilitySchema = z.enum(["public", "polity", "private"]);
export type FactVisibility = z.infer<typeof FactVisibilitySchema>;

/**
 * The per-observer discovery timing axis, layered *on top of* the existing
 * three-value `visibility` tag -- not a replacement for it. `visible()` in
 * `gm/read-tools.ts` keeps reading `Fact.visibility` exactly as it reads
 * today's static tag; a new consumer additionally checks `discoveredBy` for
 * a specific observer to answer "has *this* character actually learned
 * this yet" (e.g. a secret conspiracy invisible to a polity context until a
 * valid discovery fact exposes it).
 */
export const FactDiscoveryStateSchema = z.enum([
  "public",
  "polity",
  "private",
  "delayed",
  "rumoured",
  "intercepted",
]);
export type FactDiscoveryState = z.infer<typeof FactDiscoveryStateSchema>;

export const FactDiscoveredBySchema = z
  .object({
    observerRef: OrderPartyRefSchema,
    atInstant: WorldInstantSchema,
    via: z.enum(["witnessed", "told", "document", "investigation", "rumour"]),
  })
  .strict();
export type FactDiscoveredBy = z.infer<typeof FactDiscoveredBySchema>;

export const FactDiscoverySchema = z
  .object({
    state: FactDiscoveryStateSchema,
    /** When "delayed"/"rumoured"/"intercepted": the instant it becomes actually knowable. Null otherwise. */
    knowableAtInstant: WorldInstantSchema.nullable().default(null),
    discoveredBy: z.array(FactDiscoveredBySchema).max(64).default([]),
  })
  .strict();
export type FactDiscovery = z.infer<typeof FactDiscoverySchema>;

export const FactResourceChangeSchema = z
  .object({
    accountId: EntityIdSchema.optional(),
    forceId: EntityIdSchema.optional(),
    delta: MoneyAmountSchema.optional(),
    other: z.string().max(120).optional(),
  })
  .strict();
export type FactResourceChange = z.infer<typeof FactResourceChangeSchema>;

/**
 * Thin placeholder -- the authority/order-attempt system (docs/32's Part B)
 * fills this in with its own concrete `AuthorityGrant`/`OrderAttempt` id
 * shapes. Append-only-extensible: never repurpose a field, only add.
 */
export const FactAuthorityChangeSchema = z
  .object({
    authorityGrantId: EntityIdSchema.optional(),
    kind: z.enum(["granted", "revoked", "breached", "expired"]).optional(),
  })
  .strict()
  .optional();
export type FactAuthorityChange = z.infer<typeof FactAuthorityChangeSchema>;

export const FactEvidenceSchema = z
  .object({
    provenance: z.enum(["direct_witness", "report", "document", "inference", "confession"]),
    reliability: z.number().min(0).max(1).default(1),
    /** A Fact may cite an earlier Fact as its own evidence. */
    sourceFactId: z.string().max(120).nullable().default(null),
  })
  .strict();
export type FactEvidence = z.infer<typeof FactEvidenceSchema>;

export const StarContextLevelSchema = z.enum([
  "person",
  "unit",
  "settlement",
  "province",
  "region",
  "theatre",
  "polity",
  "world",
]);
export type StarContextLevel = z.infer<typeof StarContextLevelSchema>;

export const FactSchema = z
  .object({
    id: EntityIdSchema,
    time: WorldInstantSchema,
    /** Back-reference for existing step-keyed joins (turns, orders). */
    atStep: ElapsedStepSchema,
    kind: z.string().min(1).max(80),
    summary: z.string().trim().min(1).max(600),
    affectedEntities: z.array(OrderPartyRefSchema).max(16).default([]),
    resourceChanges: z.array(FactResourceChangeSchema).max(8).default([]),
    authorityChange: FactAuthorityChangeSchema,
    /** The existing public/polity/private tag. Untouched field and meaning -- see the module comment above. */
    visibility: FactVisibilitySchema.default("public"),
    discovery: FactDiscoverySchema,
    evidence: FactEvidenceSchema.nullable().default(null),
    /** Which star-context/relevance scopes may treat this as a valid reaction trigger. */
    eligibleReactionScopes: z.array(StarContextLevelSchema).default([]),
    /** The `world_events` row that produced this fact, if any. */
    sourceEventId: z.string().max(120).nullable().default(null),
    sourceActionId: EntityIdSchema.nullable().default(null),
    /** Mirrors the producing event's causal depth, for the 3-layer reaction cap. */
    causalDepth: z.number().int().nonnegative().default(0),
  })
  .strict();
export type Fact = z.infer<typeof FactSchema>;

/**
 * One committed Fact per `FactualEvent` (`gm/session.ts`), called at the
 * point `resolution/pipeline.ts` already builds its `factualEvents` array --
 * every existing Fact producer (Game Master tool calls, world dynamics)
 * gets a Fact for free with no producer-side change. `discovery` defaults to
 * a state matching the event's own `visibility` tag with no discoverers yet
 * recorded, unless the caller supplies a richer discovery record.
 */
export function factualEventToFact(
  event: FactualEvent,
  time: WorldInstant,
  visibility: FactVisibility = "public",
  discovery?: FactDiscovery,
  overrides?: Partial<Pick<Fact, "eligibleReactionScopes" | "sourceEventId" | "causalDepth" | "authorityChange" | "evidence" | "affectedEntities">>,
): Fact {
  return FactSchema.parse({
    id: event.id,
    time,
    atStep: event.atStep,
    kind: event.actionId,
    summary: event.summary,
    affectedEntities: overrides?.affectedEntities ?? [],
    resourceChanges: [],
    authorityChange: overrides?.authorityChange,
    visibility,
    discovery: discovery ?? { state: visibility, knowableAtInstant: null, discoveredBy: [] },
    evidence: overrides?.evidence ?? null,
    eligibleReactionScopes: overrides?.eligibleReactionScopes ?? [],
    sourceEventId: overrides?.sourceEventId ?? null,
    sourceActionId: event.actionId ?? null,
    causalDepth: overrides?.causalDepth ?? 0,
  });
}

/**
 * A not-yet-persisted Fact: everything `FactSchema` needs except `id`
 * (assigned at emission) -- what a `world-tools`/event-loop handler returns
 * to describe what it changed.
 */
export type FactDraft = Omit<Fact, "id">;

/**
 * Assigns ids to a batch of drafted Facts, ready to persist to the canonical
 * `worldFacts` store. Pure and DB-agnostic: Facts are deliberately kept
 * outside the hashed `WorldState` document (see the module comment), so this
 * does not touch `WorldState` at all -- the caller (the event loop / a
 * world-tool executor) is responsible for appending the result to whatever
 * batch of facts it is threading through the current turn's resolution, and
 * for persisting it to `worldFacts` once the turn commits.
 */
export function emitFacts(drafts: readonly FactDraft[], idFactory: () => string = () => crypto.randomUUID()): Fact[] {
  return drafts.map((draft) => FactSchema.parse({ ...draft, id: idFactory() }));
}

/**
 * Filters a batch of Facts to those a specific observer may currently treat
 * as known, per Fact.visibility (the existing three-value tag, `visible()`
 * in `gm/read-tools.ts`'s own equivalent for the session-wide case) layered
 * with the new per-observer `discovery.discoveredBy` ledger:
 *
 * - `visibility: "public"` facts are always visible.
 * - `visibility: "polity"` facts are visible to an observer sharing a
 *   polity-scoped affected entity (left to the caller to pre-filter by
 *   passing only same-polity facts, since polity membership is `WorldState`
 *   knowledge this pure function does not have).
 * - `visibility: "private"` facts are visible only once `discovery.state`
 *   is no longer "private" (i.e. discovered/rumoured/intercepted and due)
 *   AND the observer appears in `discovery.discoveredBy`, at or after the
 *   instant they discovered it.
 *
 * This is the single function NPC-context and star-context builders should
 * call rather than reimplementing per-observer epistemic filtering.
 */
export function factsVisibleTo(facts: readonly Fact[], observer: OrderPartyRef, atInstant: WorldInstant): Fact[] {
  const atSortKey = atInstant.day * 1440 + atInstant.minute;
  return facts.filter((fact) => {
    if (fact.visibility === "public") return true;
    const discoveredEntry = fact.discovery.discoveredBy.find(
      (entry) => entry.observerRef.kind === observer.kind && entry.observerRef.id === observer.id,
    );
    if (discoveredEntry === undefined) return false;
    const discoveredSortKey = discoveredEntry.atInstant.day * 1440 + discoveredEntry.atInstant.minute;
    return discoveredSortKey <= atSortKey;
  });
}
