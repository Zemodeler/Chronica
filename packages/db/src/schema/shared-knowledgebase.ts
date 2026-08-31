import { boolean, index, integer, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { pgTable } from "drizzle-orm/pg-core";
import { games } from "./game";

/**
 * Shared knowledge pools that span multiple NPCs.
 *
 * Each entry records one factual claim (fact, rumour, or plot) extracted from
 * an NPC conversation and made available to other NPCs in the same pool.
 * Pool type + pool key identify the group: polity, province, or dynasty.
 *
 * Chronicle-fed entries (game-wide public events) will use poolType "game"
 * once the chronicle system is implemented — see
 * docs/shared-knowledgebase-chronicle-integration.md.
 */
export const sharedKnowledgebases = pgTable("shared_knowledgebase_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  gameId: uuid("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
  poolType: text("pool_type").notNull(),
  poolKey: text("pool_key").notNull(),
  body: text("body").notNull(),
  sourceNpcCharacterId: text("source_npc_character_id"),
  sourceSessionId: uuid("source_session_id"),
  stepOccurred: integer("step_occurred").notNull().default(0),
  isContradicted: boolean("is_contradicted").notNull().default(false),
  contradictsIds: text("contradicts_ids").array().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("skb_game_pool_idx").on(table.gameId, table.poolType, table.poolKey),
]);
