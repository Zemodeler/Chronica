-- One burst now records several Chronicle entries: one per thread of events,
-- each with its own title and its own subjects, instead of a single passage
-- fusing a war and an embassy under a date range.
ALTER TABLE "chronicle_checkpoints" ADD COLUMN IF NOT EXISTS "ordinal" integer NOT NULL DEFAULT 0;
ALTER TABLE "chronicle_checkpoints" ADD COLUMN IF NOT EXISTS "subjects" jsonb NOT NULL DEFAULT '[]'::jsonb;

DROP INDEX IF EXISTS "chronicle_checkpoints_game_idx";
CREATE INDEX IF NOT EXISTS "chronicle_checkpoints_game_idx"
  ON "chronicle_checkpoints" ("game_id", "to_instant_sort_key", "ordinal");
