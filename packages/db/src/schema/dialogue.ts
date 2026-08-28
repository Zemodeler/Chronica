import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { games, players, turns } from "./game";

export const dialogueSessionStatus = pgEnum("dialogue_session_status", ["resolving_contact", "open", "unavailable", "closed", "merged", "discarded"]);
export const dialogueMessageStatus = pgEnum("dialogue_message_status", ["pending", "claimed", "ready", "templated", "failed"]);

export const dialogueSessions = pgTable("dialogue_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  threadId: uuid("thread_id").notNull(),
  gameId: uuid("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
  turnId: uuid("turn_id").notNull().references(() => turns.id, { onDelete: "cascade" }),
  playerId: uuid("player_id").notNull().references(() => players.id),
  npcCharacterId: text("npc_character_id"),
  provisional: boolean("provisional").notNull().default(false),
  roleQuery: text("role_query"),
  baseStateHash: text("base_state_hash").notNull(),
  channel: text("channel").notNull(),
  visibility: jsonb("visibility").notNull().$type<unknown>(),
  threadContext: jsonb("thread_context").notNull().$type<unknown>(),
  overlay: jsonb("overlay").notNull().$type<unknown>(),
  status: dialogueSessionStatus("status").notNull(),
  claimedBy: text("claimed_by"),
  claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("dialogue_turn_player_npc_unique").on(table.turnId, table.playerId, table.npcCharacterId),
  index("dialogue_sessions_claim_idx").on(table.status, table.claimExpiresAt),
  index("dialogue_sessions_thread_idx").on(table.threadId, table.createdAt),
]);

export const dialogueMessages = pgTable("dialogue_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  sessionId: uuid("session_id").notNull().references(() => dialogueSessions.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(),
  speakerCharacterId: text("speaker_character_id").notNull(),
  body: text("body").notNull(),
  acts: jsonb("acts").notNull().$type<unknown>(),
  disclosedFactIds: jsonb("disclosed_fact_ids").notNull().$type<unknown>(),
  clientRequestId: text("client_request_id"),
  status: dialogueMessageStatus("status").notNull(),
  aiCallId: uuid("ai_call_id"),
  claimedBy: text("claimed_by"),
  claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("dialogue_messages_session_sequence_unique").on(table.sessionId, table.sequence),
  uniqueIndex("dialogue_messages_session_request_unique").on(table.sessionId, table.clientRequestId),
  index("dialogue_messages_claim_idx").on(table.status, table.claimExpiresAt),
]);
