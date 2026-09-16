import { sql } from "drizzle-orm";
import { bigint, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { games } from "./game";
import { users } from "./auth";

/**
 * The simulation loop's storage (VISION §33's "Simulation Loop v1").
 *
 * Deliberately five small tables rather than the one big `turns`/`worldSnapshots`
 * pair that was deleted with the old engine. The world document, the historical
 * record, the future queue, and what the player has been shown are four
 * different lifetimes -- keying them all to a turn is what made the old design
 * impossible to advance continuously.
 */

export const scheduledEventStatus = pgEnum("scheduled_event_status", ["pending", "fired", "cancelled", "superseded"]);
export const simulationBurstStatus = pgEnum("simulation_burst_status", ["running", "committed", "failed"]);
export const playerDecisionStatus = pgEnum("player_decision_status", ["open", "resolved", "expired"]);

/**
 * The live world: exactly one row per game.
 *
 * `revision` is the optimistic-concurrency token. A burst reads it, works for
 * several seconds, and commits only if nothing else moved the world meanwhile --
 * chat NPCs write here too, so "nothing else moved it" is a real condition.
 */
export const gameWorlds = pgTable("game_worlds", {
  gameId: uuid("game_id").primaryKey().references(() => games.id, { onDelete: "cascade" }),
  world: jsonb("world").notNull().$type<unknown>(),
  schemaVersion: integer("schema_version").notNull(),
  revision: integer("revision").notNull().default(1),
  stateHash: text("state_hash").notNull(),
  /** `instant.day * 1440 + instant.minute`, denormalized so "where is this world in time" needs no JSON parse. */
  instantSortKey: bigint("instant_sort_key", { mode: "number" }).notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * The historical record: append-only, and deliberately outside the world
 * document so it can be queried by time and visibility without loading a world
 * (VISION §14 -- what is true, versus who knows it).
 */
export const worldFacts = pgTable("world_facts", {
  id: text("id").primaryKey(),
  gameId: uuid("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
  burstId: uuid("burst_id"),
  instantSortKey: bigint("instant_sort_key", { mode: "number" }).notNull(),
  kind: text("kind").notNull(),
  summary: text("summary").notNull(),
  visibility: text("visibility").notNull(),
  discoveryState: text("discovery_state").notNull(),
  /** When a delayed/rumoured/intercepted fact becomes knowable -- news travels (VISION §16). */
  knowableAtSortKey: bigint("knowable_at_sort_key", { mode: "number" }),
  /** The actor's own judgment of how much this mattered; pressure accumulates from it (VISION §22). */
  significance: integer("significance").notNull().default(0),
  causalDepth: integer("causal_depth").notNull().default(0),
  fact: jsonb("fact").notNull().$type<unknown>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("world_facts_game_time_idx").on(table.gameId, table.instantSortKey),
  index("world_facts_game_significance_idx").on(table.gameId, table.significance),
]);

/**
 * The future queue (VISION §17): a four-month recruitment is scheduled, not
 * simulated through. The loop pops what is due, not what might be interesting.
 */
export const scheduledEvents = pgTable("scheduled_events", {
  id: text("id").primaryKey(),
  gameId: uuid("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
  dueInstantSortKey: bigint("due_instant_sort_key", { mode: "number" }).notNull(),
  kind: text("kind").notNull(),
  summary: text("summary").notNull(),
  payload: jsonb("payload").notNull().$type<unknown>(),
  status: scheduledEventStatus("status").notNull().default("pending"),
  causeFactId: text("cause_fact_id"),
  causalDepth: integer("causal_depth").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  firedAt: timestamp("fired_at", { withTimezone: true }),
}, (table) => [index("scheduled_events_due_idx").on(table.gameId, table.status, table.dueInstantSortKey)]);

/**
 * One run of the loop. Not bookkeeping for its own sake: an agentic loop that
 * cannot be inspected after it ran cannot be debugged, and this is also the
 * handle a burst would be moved onto a background job by.
 */
export const simulationBursts = pgTable("simulation_bursts", {
  id: uuid("id").defaultRandom().primaryKey(),
  gameId: uuid("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
  playerUserId: uuid("player_user_id").references(() => users.id, { onDelete: "set null" }),
  orderText: text("order_text"),
  status: simulationBurstStatus("status").notNull().default("running"),
  iterations: integer("iterations").notNull().default(0),
  modelCalls: integer("model_calls").notNull().default(0),
  outcome: text("outcome"),
  stopReason: text("stop_reason"),
  accumulatedSignificance: integer("accumulated_significance").notNull().default(0),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
}, (table) => [index("simulation_bursts_game_idx").on(table.gameId, table.startedAt)]);

/** What the player has actually been told (VISION §25) -- never the whole record, only what reached them. */
export const chronicleCheckpoints = pgTable("chronicle_checkpoints", {
  id: uuid("id").defaultRandom().primaryKey(),
  gameId: uuid("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
  burstId: uuid("burst_id").references(() => simulationBursts.id, { onDelete: "set null" }),
  fromInstantSortKey: bigint("from_instant_sort_key", { mode: "number" }).notNull(),
  toInstantSortKey: bigint("to_instant_sort_key", { mode: "number" }).notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  factIds: jsonb("fact_ids").notNull().$type<unknown>().default(sql`'[]'::jsonb`),
  stopReason: text("stop_reason").notNull(),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("chronicle_checkpoints_game_idx").on(table.gameId, table.toInstantSortKey)]);

/** VISION §23 outcome C: the rare development that genuinely needs the player's own authority. */
export const playerDecisions = pgTable("player_decisions", {
  id: uuid("id").defaultRandom().primaryKey(),
  gameId: uuid("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
  burstId: uuid("burst_id").references(() => simulationBursts.id, { onDelete: "set null" }),
  prompt: text("prompt").notNull(),
  options: jsonb("options").notNull().$type<unknown>(),
  status: playerDecisionStatus("status").notNull().default("open"),
  chosenOptionId: text("chosen_option_id"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("player_decisions_game_status_idx").on(table.gameId, table.status)]);
