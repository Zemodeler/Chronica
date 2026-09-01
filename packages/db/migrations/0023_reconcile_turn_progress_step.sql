-- Some local databases recorded migration 0022 before its SQL was added.
-- Repeat the schema change idempotently so those databases can create turns.
ALTER TABLE "turns" ADD COLUMN IF NOT EXISTS "progress_step" text;
