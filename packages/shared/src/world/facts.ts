import { z } from "zod";
import { OrderPartyRefSchema, type OrderPartyRef } from "./party-ref";
import { MoneyAmountSchema, EntityIdSchema, ElapsedStepSchema } from "../material-state";
import { WorldInstantSchema, type WorldInstant } from "./instant";
import { newsHasReached, type NewsWorld } from "./news";

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
    /**
     * The armies it names, as they stood when it happened: what a report of
     * them actually said. A count of another power's men was built from the
     * army's strength today, however old the report, so a scout's word from
     * before a battle already knew the battle's dead. Absent on facts from
     * before this was kept, and on facts that name no army.
     */
    forcesAsReported: z.array(z.object({ forceId: EntityIdSchema, men: z.number().int().nonnegative(), locationId: EntityIdSchema }).strict()).max(8).optional(),
  })
  .strict();
export type Fact = z.infer<typeof FactSchema>;

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
 *
 * The id factory is required. It used to default to `crypto.randomUUID()`,
 * which made a fact's id -- and every reference to it -- different on every
 * replay of the same burst; ids come from the burst's own factory.
 */
export function emitFacts(drafts: readonly FactDraft[], idFactory: () => string): Fact[] {
  return drafts.map((draft) => FactSchema.parse({ ...draft, id: idFactory() }));
}

/**
 * What an observer knows, including what their own polity knows.
 *
 * `factsVisibleTo` below cannot answer this on its own: it has no way to learn
 * which polity an observer belongs to, so it treats every `polity`-scoped fact
 * as unknown. That is a safe default for a pure function and a silent disaster
 * for a caller that forgets to pre-filter -- a government's own dispatches
 * became invisible to the government that sent them, and Chronicles came back
 * reading "nothing of note was recorded in this period".
 *
 * So this is the function callers should reach for. A `polity` fact is known to
 * an observer when their own polity, or the observer themselves, is among the
 * entities it affects -- and, like a public one, once word of it has reached
 * where they are (`newsArrivesAt`). Given no world there is no road, and only
 * the fact's own `knowableAtInstant` holds it back.
 */
export function factsKnownTo(
  facts: readonly Fact[],
  observer: OrderPartyRef,
  observerPolityId: string | null,
  atInstant: WorldInstant,
  world?: NewsWorld,
): Fact[] {
  const alreadyVisible = new Set<Fact>(factsVisibleTo(facts, observer, atInstant, world));
  return facts.filter((fact) => {
    if (alreadyVisible.has(fact)) return true;
    if (fact.visibility !== "polity") return false;
    const ours = fact.affectedEntities.some(
      (entity) =>
        (entity.kind === "polity" && observerPolityId !== null && entity.id === observerPolityId) ||
        (entity.kind === observer.kind && entity.id === observer.id),
    );
    return ours && newsHasReached(world, fact, observer, atInstant);
  });
}

/**
 * Filters a batch of Facts to those a specific observer may currently treat
 * as known, per Fact.visibility (the existing three-value tag, `visible()`
 * in `gm/read-tools.ts`'s own equivalent for the session-wide case) layered
 * with the new per-observer `discovery.discoveredBy` ledger:
 *
 * - `visibility: "public"` facts are visible once word of them has reached
 *   the observer (`newsArrivesAt`): the road from where it happened, and
 *   never before the fact's own `knowableAtInstant`.
 * - `visibility: "polity"` facts are visible to an observer sharing a
 *   polity-scoped affected entity (left to the caller to pre-filter by
 *   passing only same-polity facts, since polity membership is `WorldState`
 *   knowledge this pure function does not have).
 * - Any fact is visible to an observer in `discovery.discoveredBy`, at or
 *   after the instant they discovered it: the people in the room, and
 *   whoever found a secret out.
 *
 * This is the single function NPC-context and star-context builders should
 * call rather than reimplementing per-observer epistemic filtering.
 */
export function factsVisibleTo(facts: readonly Fact[], observer: OrderPartyRef, atInstant: WorldInstant, world?: NewsWorld): Fact[] {
  const atSortKey = atInstant.day * 1440 + atInstant.minute;
  return facts.filter((fact) => {
    const discoveredEntry = fact.discovery.discoveredBy.find(
      (entry) => entry.observerRef.kind === observer.kind && entry.observerRef.id === observer.id,
    );
    if (discoveredEntry !== undefined && discoveredEntry.atInstant.day * 1440 + discoveredEntry.atInstant.minute <= atSortKey) return true;
    return fact.visibility === "public" && newsHasReached(world, fact, observer, atInstant);
  });
}
