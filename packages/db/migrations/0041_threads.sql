-- Threads of history a player can follow. An entry records the storylines it
-- belongs to, so a thread is told from the entries the player read rather than
-- from the model's own summary of it; and a player's followed threads are
-- kept per save.
ALTER TABLE "chronicle_checkpoints" ADD COLUMN IF NOT EXISTS "storyline_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;
CREATE TABLE IF NOT EXISTS "followed_threads" (
  "game_id" uuid NOT NULL REFERENCES "games"("id") ON DELETE CASCADE,
  "storyline_id" text NOT NULL,
  "followed_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "followed_threads_game_storyline_idx" ON "followed_threads" ("game_id", "storyline_id");
