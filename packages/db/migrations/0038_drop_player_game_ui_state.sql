-- The per-player UI state table held a generated starting cast and a selected
-- chat thread. The cast was a staging area for a materialization step in
-- packages/sim that no longer exists, and nothing reads or writes either
-- column, so the table goes with the code that described it.
DROP TABLE IF EXISTS "player_game_ui_state";
