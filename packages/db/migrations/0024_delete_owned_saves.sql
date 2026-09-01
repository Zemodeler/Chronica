-- Keep account billing and AI-use audit history when a player permanently deletes a save.
ALTER TABLE "credit_holds" DROP CONSTRAINT "credit_holds_game_id_games_id_fk";
ALTER TABLE "credit_holds" ADD CONSTRAINT "credit_holds_game_id_games_id_fk"
  FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE SET NULL;

ALTER TABLE "credit_ledger_entries" DROP CONSTRAINT "credit_ledger_entries_game_id_games_id_fk";
ALTER TABLE "credit_ledger_entries" ADD CONSTRAINT "credit_ledger_entries_game_id_games_id_fk"
  FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE SET NULL;

ALTER TABLE "ai_calls" ALTER COLUMN "game_id" DROP NOT NULL;
ALTER TABLE "ai_calls" DROP CONSTRAINT "ai_calls_game_id_games_id_fk";
ALTER TABLE "ai_calls" ADD CONSTRAINT "ai_calls_game_id_games_id_fk"
  FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE SET NULL;
