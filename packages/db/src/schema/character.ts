import { jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { CharacterKnowledgebase } from "@chronica/shared";
import { games } from "./game";
import { players } from "./game";

export const characterKnowledgebases = pgTable("character_knowledgebases", {
  id: uuid("id").defaultRandom().primaryKey(),
  gameId: uuid("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
  playerId: uuid("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
  /** Stable derived ID: "declared-<playerId>" — mirrors characterClaims.characterId. */
  characterId: text("character_id").notNull(),
  knowledgebase: jsonb("knowledgebase").notNull().$type<CharacterKnowledgebase>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("character_knowledgebases_game_player_unique").on(table.gameId, table.playerId),
]);
