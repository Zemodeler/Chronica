import { jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { games, players } from "./game";

// Per-player UI state (goal: replace the temporary chat prototype).
//
// Presentation state only: which chat thread is selected, the generated
// starting cast. Never referenced from WorldState, resolveTurn's input, or
// worldStateHash -- structurally excluded from the deterministic snapshot by
// simply never being read by packages/sim.

export const playerGameUiState = pgTable("player_game_ui_state", {
  id: uuid("id").defaultRandom().primaryKey(),
  gameId: uuid("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
  playerId: uuid("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
  /** ResolvedRoleSchema-shaped. */
  generatedCast: jsonb("generated_cast").$type<unknown>(),
  selectedThreadId: text("selected_thread_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("player_game_ui_state_game_player_unique").on(table.gameId, table.playerId),
]);
