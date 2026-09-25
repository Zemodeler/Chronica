-- The burst no longer runs inside the HTTP request. It reports where it has
-- got to, and what it has written so far, through burst_progress; whether it
-- is still alive is the heartbeat on its simulation_bursts row, not the age of
-- the row. A process that dies mid-turn stops beating, and the game is free
-- again in ninety seconds instead of fifteen minutes.
ALTER TABLE "simulation_bursts" ADD COLUMN IF NOT EXISTS "heartbeat_at" timestamp with time zone;
UPDATE "simulation_bursts" SET "heartbeat_at" = "started_at" WHERE "heartbeat_at" IS NULL;

CREATE TABLE IF NOT EXISTS "burst_progress" (
  "id" bigserial PRIMARY KEY,
  "burst_id" uuid NOT NULL REFERENCES "simulation_bursts"("id") ON DELETE CASCADE,
  "game_id" uuid NOT NULL REFERENCES "games"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "payload" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "burst_progress_burst_idx" ON "burst_progress" ("burst_id", "id");
