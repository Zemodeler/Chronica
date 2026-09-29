-- What a burst did not do, and whether it is still getting anywhere.
--
-- `skipped` keeps every model call a burst decided not to make, every answer
-- it could not read and everything it dropped to keep one: before this they
-- were printed to the server's console and lost, so a burst that silently did
-- less than it was asked looked exactly like one that did everything.
-- `chronicle_calls` counts the historian's calls apart from the simulation's.
--
-- `progress_at` moves only when the burst gets somewhere -- a stage reported,
-- a model call answered, a passage written -- where `heartbeat_at` only says
-- the process is alive. A burst that is alive and stuck is reaped by the one;
-- a process that died is reaped by the other.
--
-- `idempotency_key` is the client's own id for an order, so sending the same
-- order twice (a retry after a dropped connection) finds the burst the first
-- send opened instead of paying for a second.
ALTER TABLE "simulation_bursts" ADD COLUMN IF NOT EXISTS "skipped" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "simulation_bursts" ADD COLUMN IF NOT EXISTS "chronicle_calls" integer DEFAULT 0 NOT NULL;
ALTER TABLE "simulation_bursts" ADD COLUMN IF NOT EXISTS "progress_at" timestamp with time zone;
ALTER TABLE "simulation_bursts" ADD COLUMN IF NOT EXISTS "idempotency_key" text;
CREATE UNIQUE INDEX IF NOT EXISTS "simulation_bursts_idempotency_idx" ON "simulation_bursts" ("game_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL;
