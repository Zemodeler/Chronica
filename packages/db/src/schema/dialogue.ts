import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { ConversationConsequence, ConversationMemoryEntry, Character } from "@chronica/shared";
import { games, players } from "./game";

export const dialogueSessions = pgTable("dialogue_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  gameId: uuid("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
  playerId: uuid("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
  npcCharacterId: text("npc_character_id"),
  isGroup: boolean("is_group").notNull().default(false),
  participantIds: jsonb("participant_ids").$type<string[]>().notNull().default([]),
  channel: text("channel").notNull().default("correspondence"),
  isClosed: boolean("is_closed").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("dialogue_sessions_player_npc_unique").on(table.gameId, table.playerId, table.npcCharacterId),
  index("dialogue_sessions_game_player_idx").on(table.gameId, table.playerId),
]);

export const dialogueMessages = pgTable("dialogue_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  sessionId: uuid("session_id").notNull().references(() => dialogueSessions.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(),
  speakerCharacterId: text("speaker_character_id").notNull(),
  isPlayerMessage: boolean("is_player_message").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("dialogue_messages_session_seq_unique").on(table.sessionId, table.sequence),
  index("dialogue_messages_session_idx").on(table.sessionId),
]);

export const npcChatKnowledgebases = pgTable("npc_chat_knowledgebases", {
  id: uuid("id").defaultRandom().primaryKey(),
  gameId: uuid("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
  playerId: uuid("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
  npcCharacterId: text("npc_character_id").notNull(),
  canonicalName: text("canonical_name").notNull(),
  personalitySummary: text("personality_summary").notNull().default(""),
  relationshipLabel: text("relationship_label").notNull().default("neutral"),
  declaredConnection: text("declared_connection").notNull().default("contact"),
  declaredConnectionNotes: text("declared_connection_notes").notNull().default(""),
  relationshipScore: integer("relationship_score").notNull().default(0),
  conversationMemory: jsonb("conversation_memory").$type<ConversationMemoryEntry[]>().notNull().default([]),
  significantEvents: jsonb("significant_events").$type<string[]>().notNull().default([]),
  consequences: jsonb("consequences").$type<ConversationConsequence[]>().notNull().default([]),
  relevancyScore: integer("relevancy_score").notNull().default(0),
  interactionCount: integer("interaction_count").notNull().default(0),
  locationProvinceId: text("location_province_id"),
  isAvailable: boolean("is_available").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("npc_chat_kb_player_npc_unique").on(table.gameId, table.playerId, table.npcCharacterId),
  index("npc_chat_kb_game_player_idx").on(table.gameId, table.playerId),
]);

/** Durable, game-local NPCs created during contact discovery. */
export const gameNpcRecords = pgTable("game_npc_records", {
  id: uuid("id").defaultRandom().primaryKey(),
  gameId: uuid("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
  characterId: text("character_id").notNull(),
  character: jsonb("character").$type<Character>().notNull(),
  roleLabel: text("role_label").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("game_npc_records_game_character_unique").on(table.gameId, table.characterId),
  index("game_npc_records_game_idx").on(table.gameId),
]);
