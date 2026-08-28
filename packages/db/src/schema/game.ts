import { sql } from "drizzle-orm";
import { bigint, boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";

export const gameStatus = pgEnum("game_status", ["lobby", "active", "finished", "abandoned"]);
export const paymentStatus = pgEnum("payment_status", ["active", "payment_paused"]);
export const playerStatus = pgEnum("player_status", ["active", "idle", "eliminated", "vacated"]);
export const turnStatus = pgEnum("turn_status", ["collecting", "queued", "resolving", "news", "resolved", "cancelled", "failed"]);
export const scenarioVisibility = pgEnum("scenario_visibility", ["private", "unlisted", "public"]);

export const scenarios = pgTable("scenarios", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  period: text("period").notNull(),
  authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
  visibility: scenarioVisibility("visibility").notNull().default("private"),
  forkedFromScenarioId: uuid("forked_from_scenario_id"),
  currentVersion: integer("current_version").notNull().default(1),
  matchCount: integer("match_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("scenarios_author_slug_unique").on(table.authorId, table.slug)]);

export const scenarioVersions = pgTable("scenario_versions", {
  id: uuid("id").defaultRandom().primaryKey(),
  scenarioId: uuid("scenario_id").notNull().references(() => scenarios.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  mapAssetId: uuid("map_asset_id").references(() => scenarioMapAssets.id, { onDelete: "restrict" }),
  definition: jsonb("definition").notNull().$type<unknown>(),
  /**
   * The WorldState a game pinned to this version starts from.
   *
   * Kept beside `definition` rather than inside it: `definition` is validated against
   * ScenarioDefinitionSchema (rules only), and the starting world is a separate
   * document -- a fixed starting position, the way a chess scenario's rules and its
   * board setup are two different things (docs/03, docs/14).
   */
  initialWorld: jsonb("initial_world").notNull().$type<unknown>(),
  schemaVersion: integer("schema_version").notNull(),
  origin: text("origin").notNull(),
  parentVersion: integer("parent_version"),
  changedStages: text("changed_stages").array(),
  aiProfileVersion: integer("ai_profile_version"),
  validatedAt: timestamp("validated_at", { withTimezone: true }),
  generationProviderCostMicrounits: bigint("generation_provider_cost_microunits", { mode: "bigint" }).notNull().default(sql`0`),
  generationCreditChargeMicrocredits: bigint("generation_credit_charge_microcredits", { mode: "bigint" }).notNull().default(sql`0`),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("scenario_versions_scenario_version_unique").on(table.scenarioId, table.version)]);

/** Immutable validated GeoJSON supplied by an author. */
export const scenarioMapAssets = pgTable("scenario_map_assets", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
  objectKey: text("object_key").notNull(),
  mimeType: text("mime_type").notNull(),
  byteSize: bigint("byte_size", { mode: "bigint" }).notNull(),
  checksum: text("checksum").notNull(),
  featureCount: integer("feature_count").notNull(),
  boundingBox: jsonb("bounding_box").notNull().$type<unknown>(),
  rightsConfirmedAt: timestamp("rights_confirmed_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("scenario_map_assets_object_key_unique").on(table.objectKey)]);

export const games = pgTable("games", {
  id: uuid("id").defaultRandom().primaryKey(),
  scenarioId: uuid("scenario_id").notNull().references(() => scenarios.id),
  title: text("title").notNull(),
  status: gameStatus("status").notNull().default("lobby"),
  turnMode: text("turn_mode").notNull().default("all_submitted"),
  turnTimeoutSeconds: integer("turn_timeout_seconds").notNull().default(86_400),
  newsTimeoutSeconds: integer("news_timeout_seconds").notNull().default(60),
  aiProfileVersion: integer("ai_profile_version").notNull(),
  payerUserId: uuid("payer_user_id").notNull().references(() => users.id),
  creditRateCardVersion: integer("credit_rate_card_version").notNull(),
  creditBudgetMicrocredits: bigint("credit_budget_microcredits", { mode: "bigint" }).notNull(),
  creditSpentMicrocredits: bigint("credit_spent_microcredits", { mode: "bigint" }).notNull().default(sql`0`),
  paymentStatus: paymentStatus("payment_status").notNull().default("active"),
  paymentPauseReason: text("payment_pause_reason"),
  paymentPausedAt: timestamp("payment_paused_at", { withTimezone: true }),
  frozenDeadlineRemainingSeconds: integer("frozen_deadline_remaining_seconds"),
  scenarioVersion: integer("scenario_version").notNull(),
  libraryVersion: integer("library_version").notNull(),
  startingSeatCount: integer("starting_seat_count").notNull(),
  extraPrincipalsPerPlayer: integer("extra_principals_per_player").notNull().default(1),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  endRequestedAt: timestamp("end_requested_at", { withTimezone: true }),
  endRequestedBy: uuid("end_requested_by").references(() => users.id),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("games_host_idx").on(table.createdBy),
  index("games_payment_status_idx").on(table.paymentStatus),
]);

export const players = pgTable("players", {
  id: uuid("id").defaultRandom().primaryKey(),
  gameId: uuid("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  characterId: text("character_id").notNull(),
  status: playerStatus("status").notNull().default("active"),
  guestSessionVersion: integer("guest_session_version").notNull().default(1),
  /**
   * Opt-in. A player with no salient event and valid ongoing or standing orders is
   * counted as submitted at once (docs/04), so a quiet turn needs no input.
   */
  autoPass: boolean("auto_pass").notNull().default(false),
  /**
   * An OrderBatch to submit when the player does not.
   *
   * Standing orders describe future choices, while an OngoingAction is work already
   * in progress -- docs/14 is explicit that they are not the same shape, which is
   * why this is a batch here rather than a reference into the snapshot.
   */
  standingOrder: jsonb("standing_order").$type<unknown>(),
  /**
   * WatchConditionList: the player's "wake me if" rules.
   *
   * Per-player rather than in the world snapshot, deliberately. They change what a
   * player is told, never what happens, so putting them in the hashed document
   * would make one player's preferences part of another player's replay.
   */
  watchConditions: jsonb("watch_conditions").notNull().default(sql`'[]'::jsonb`).$type<unknown>(),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("players_game_user_unique").on(table.gameId, table.userId).where(sql`${table.userId} is not null`),
  index("players_game_status_idx").on(table.gameId, table.status),
]);

export const gameInvites = pgTable("game_invites", {
  id: uuid("id").defaultRandom().primaryKey(),
  gameId: uuid("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  reservedSeatRef: text("reserved_seat_ref"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  claimedPlayerId: uuid("claimed_player_id").references(() => players.id),
}, (table) => [uniqueIndex("game_invites_token_hash_unique").on(table.tokenHash), index("game_invites_game_idx").on(table.gameId)]);

export const turns = pgTable("turns", {
  id: uuid("id").defaultRandom().primaryKey(),
  gameId: uuid("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
  index: integer("index").notNull(),
  status: turnStatus("status").notNull(),
  seed: text("seed").notNull(),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
  deadlineAt: timestamp("deadline_at", { withTimezone: true }),
  resolutionCommittedAt: timestamp("resolution_committed_at", { withTimezone: true }),
  newsDeadlineAt: timestamp("news_deadline_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  claimedBy: text("claimed_by"),
  claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
  elapsedStepStart: integer("elapsed_step_start").notNull(),
  elapsedStepEnd: integer("elapsed_step_end"),
  stopReason: text("stop_reason"),
  /** Provinces whose controllerPolityId changed while resolving this turn. */
  changedRegionIds: text("changed_region_ids").array().notNull().default(sql`'{}'::text[]`),
}, (table) => [
  uniqueIndex("turns_game_index_unique").on(table.gameId, table.index),
  index("turns_claimable_idx").on(table.status, table.claimExpiresAt),
  index("turns_news_deadline_idx").on(table.status, table.newsDeadlineAt),
]);

export const orders = pgTable("orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  turnId: uuid("turn_id").notNull().references(() => turns.id, { onDelete: "cascade" }),
  playerId: uuid("player_id").notNull().references(() => players.id),
  rawText: text("raw_text").notNull(),
  directives: jsonb("directives").notNull().$type<unknown>(),
  intents: jsonb("intents").notNull().$type<unknown>(),
  assessmentAiCallId: uuid("assessment_ai_call_id"),
  parseSource: text("parse_source").notNull(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("orders_turn_player_unique").on(table.turnId, table.playerId)]);

export const turnNewsReadiness = pgTable("turn_news_readiness", {
  turnId: uuid("turn_id").notNull().references(() => turns.id, { onDelete: "cascade" }),
  playerId: uuid("player_id").notNull().references(() => players.id),
  readyAt: timestamp("ready_at", { withTimezone: true }),
  autoReady: boolean("auto_ready").notNull().default(false),
}, (table) => [uniqueIndex("turn_news_readiness_pk").on(table.turnId, table.playerId)]);

export const worldSnapshots = pgTable("world_snapshots", {
  turnId: uuid("turn_id").primaryKey().references(() => turns.id, { onDelete: "cascade" }),
  state: jsonb("state").notNull().$type<unknown>(),
  schemaVersion: integer("schema_version").notNull(),
  stateHash: text("state_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const chronicleEntries = pgTable("chronicle_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  turnId: uuid("turn_id").notNull().references(() => turns.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(),
  scope: text("scope").notNull(),
  scopeRef: text("scope_ref"),
  audience: text("audience").notNull(),
  visibility: text("visibility").notNull(),
  playerInvolvement: jsonb("player_involvement").notNull().$type<unknown>(),
  body: text("body").notNull(),
  facts: jsonb("facts").notNull().$type<unknown>(),
}, (table) => [uniqueIndex("chronicle_turn_sequence_unique").on(table.turnId, table.sequence)]);

export const characterClaims = pgTable("character_claims", {
  id: uuid("id").defaultRandom().primaryKey(),
  gameId: uuid("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
  characterId: text("character_id").notNull(),
  playerId: uuid("player_id").notNull().references(() => players.id),
  origin: text("origin").notNull(),
  declaration: text("declaration"),
  resolvedRole: jsonb("resolved_role").$type<unknown>(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  introducedAtTurnId: uuid("introduced_at_turn_id").references(() => turns.id),
  /** Worker lease, mirrors dialogueMessages. */
  claimedBy: text("claimed_by"),
  claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
  releasedAt: timestamp("released_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("character_claims_active_unique").on(table.gameId, table.characterId).where(sql`${table.releasedAt} is null`),
  uniqueIndex("character_claims_player_active_unique").on(table.gameId, table.playerId).where(sql`${table.releasedAt} is null`),
]);
