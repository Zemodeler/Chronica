-- docs/32, Phase 6: day-level authoritative time, alongside the existing
-- elapsed_step_start/end columns. elapsedStep remains what the live
-- pipeline actually advances by exactly 1 per turn until Phase 7's elastic
-- scheduler wires these in -- nullable so every turn resolved before this
-- phase still parses.

ALTER TABLE "turns" ADD COLUMN IF NOT EXISTS "elapsed_day_start" integer;
ALTER TABLE "turns" ADD COLUMN IF NOT EXISTS "elapsed_day_end" integer;
ALTER TABLE "turns" ADD COLUMN IF NOT EXISTS "stopping_fact_ids" text[];
ALTER TABLE "turns" ADD COLUMN IF NOT EXISTS "requested_player_decision" text;
