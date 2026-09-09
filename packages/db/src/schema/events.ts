import { bigint, boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { games, turns } from "./game";

/**
 * The persistent event queue (docs/32, Phase 7 -- the multi-agent living
 * world spec's "Core runtime").
 *
 * Deliberately a relational table beside the snapshot, not a `WorldState`
 * field: `WorldState` is one big versioned document hashed once per
 * committed turn, appropriate for slow-changing authoritative state but
 * wrong for a queue that may hold dozens of small, independently-scheduled
 * future events (a construction tick, a fleet's arrival, an order's
 * deadline) whose status changes far more often than the world itself does.
 * Same "operational record beside the snapshot" pattern as the existing
 * `pendingWorkflowProposals`/`capabilityRequests` tables.
 *
 * Facts produced by resolving an event *do* fold into the committed
 * `WorldState`/Chronicle -- see `worldFacts` below and `world/facts.ts`'s
 * `factualEventToFact`. This table is scheduling metadata only.
 */
export const worldEventKind = pgEnum("world_event_kind", [
  "action_phase",
  "world_process_tick",
  "midnight_tick",
  "order_deadline",
  "reaction_window",
]);

export const worldEventStatus = pgEnum("world_event_status", [
  "pending",
  "claimed",
  "resolved",
  "cancelled",
  "superseded",
]);

export const worldEvents = pgTable("world_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  gameId: uuid("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
  /**
   * The turn whose resolution window this event was claimed inside. Null
   * while merely queued for a future day the current turn hasn't reached.
   */
  scheduledForTurnId: uuid("scheduled_for_turn_id").references(() => turns.id, { onDelete: "set null" }),
  kind: worldEventKind("kind").notNull(),
  status: worldEventStatus("status").notNull().default("pending"),
  /**
   * Flattened `WorldInstant` (`day * 1440 + minute`, see `world/instant.ts`),
   * so the core "select next due event" query is a single btree-friendly
   * `ORDER BY instant_sort_key ASC, priority DESC, is_player_action DESC`.
   * `instantDay`/`instantMinute` are kept alongside purely for readability
   * and so a migration/backfill script doesn't need to unpack the bigint.
   */
  instantSortKey: bigint("instant_sort_key", { mode: "number" }).notNull(),
  instantDay: integer("instant_day").notNull(),
  instantMinute: integer("instant_minute").notNull(),
  /** Higher resolves first among events tied at the same instant. */
  priority: integer("priority").notNull().default(0),
  /**
   * A player's ready action at an instant resolves before an unrelated
   * event at that same instant -- an 11:00 world event still occurs first,
   * this flag only breaks a tie, never overrides an earlier instant.
   */
  isPlayerAction: boolean("is_player_action").notNull().default(false),
  subjectRef: jsonb("subject_ref").notNull().$type<{ kind: string; id: string }>(),
  actionId: text("action_id"),
  operationId: text("operation_id"),
  /** Validated per-kind against `WorldEventPayloadSchema` (world/event-queue.ts) at enqueue and claim time. */
  payload: jsonb("payload").notNull().$type<unknown>(),
  /** Causal-chain depth for the 3-layer reaction cap; reset to 0 when a capped chain reopens on a later day. */
  causalDepth: integer("causal_depth").notNull().default(0),
  causedByEventId: uuid("caused_by_event_id"),
  causedByFactId: text("caused_by_fact_id"),
  createdAtStep: integer("created_at_step").notNull(),
  resolvedAtStep: integer("resolved_at_step"),
  resolvedFactIds: text("resolved_fact_ids").array(),
  claimedBy: text("claimed_by"),
  claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("world_events_game_pending_idx").on(table.gameId, table.status, table.instantSortKey, table.priority),
  index("world_events_action_idx").on(table.actionId),
  index("world_events_turn_idx").on(table.scheduledForTurnId),
]);

/**
 * Canonical Fact ledger (`world/facts.ts`'s `FactSchema`), the durable
 * historical record an event's resolution produces. Kept as first-class
 * rows -- like `worldEvents`, jsonb-per-turn growth inside `WorldState`
 * would force a whole-document rewrite per fact and isn't needed for
 * determinism hashing. `chronicleEntries.facts` may keep a denormalized
 * copy for read performance; this table is the canonical store new
 * discovery/visibility queries (`factsVisibleTo`) read from.
 */
export const worldFacts = pgTable("world_facts", {
  id: text("id").primaryKey(),
  gameId: uuid("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
  turnId: uuid("turn_id").references(() => turns.id, { onDelete: "set null" }),
  atStep: integer("at_step").notNull(),
  instantDay: integer("instant_day").notNull(),
  instantMinute: integer("instant_minute").notNull(),
  kind: text("kind").notNull(),
  visibility: text("visibility").notNull(),
  data: jsonb("data").notNull().$type<import("@chronica/shared").Fact>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("world_facts_game_step_idx").on(table.gameId, table.atStep),
  index("world_facts_game_kind_idx").on(table.gameId, table.kind),
  index("world_facts_visibility_idx").on(table.gameId, table.visibility),
]);
