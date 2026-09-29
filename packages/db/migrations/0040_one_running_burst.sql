-- One burst at a time per world, kept by the database rather than by a read
-- before the insert. Two orders sent together both read "nothing running" and
-- both opened a burst: they ran side by side on the same world for minutes,
-- the page showed the passages of both, and the loser was thrown away at the
-- commit. A stale row still blocks the insert until it is reaped, which
-- prepareBurst does first.
UPDATE "simulation_bursts" AS s SET "status" = 'failed', "error" = 'Superseded by a burst that ran beside it.', "ended_at" = now()
WHERE s."status" = 'running'
  AND EXISTS (
    SELECT 1 FROM "simulation_bursts" AS t
    WHERE t."game_id" = s."game_id" AND t."status" = 'running' AND t."started_at" > s."started_at"
  );
CREATE UNIQUE INDEX IF NOT EXISTS "simulation_bursts_one_running_idx" ON "simulation_bursts" ("game_id") WHERE "status" = 'running';
