import { sql } from "drizzle-orm";
import { bigint, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";

export const gameStatus = pgEnum("game_status", ["lobby", "active", "finished", "abandoned"]);
export const paymentStatus = pgEnum("payment_status", ["active", "payment_paused"]);
export const playerStatus = pgEnum("player_status", ["active", "idle", "eliminated", "vacated"]);
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
  claimedPlayerId: uuid("claimed_player_id").references(() => players.id, { onDelete: "cascade" }),
}, (table) => [uniqueIndex("game_invites_token_hash_unique").on(table.tokenHash), index("game_invites_game_idx").on(table.gameId)]);

export const characterClaims = pgTable("character_claims", {
  id: uuid("id").defaultRandom().primaryKey(),
  gameId: uuid("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
  characterId: text("character_id").notNull(),
  playerId: uuid("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
  origin: text("origin").notNull(),
  declaration: text("declaration"),
  resolvedRole: jsonb("resolved_role").$type<unknown>(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  /** Worker lease, mirrors dialogueMessages. */
  claimedBy: text("claimed_by"),
  claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
  releasedAt: timestamp("released_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("character_claims_active_unique").on(table.gameId, table.characterId).where(sql`${table.releasedAt} is null`),
  uniqueIndex("character_claims_player_active_unique").on(table.gameId, table.playerId).where(sql`${table.releasedAt} is null`),
]);

