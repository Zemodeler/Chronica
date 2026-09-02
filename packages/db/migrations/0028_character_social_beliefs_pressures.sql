-- Character-sim phase 2: dialogue may now also propose beliefs and pressure
-- changes through the same phase-1 social-event ledger. Additive columns
-- only; every existing row defaults to an empty array. Hand-written for the
-- same reason as 0027: this environment's drizzle-kit requires an
-- interactive TTY to resolve an unrelated enum-naming prompt.

ALTER TABLE "character_social_events" ADD COLUMN IF NOT EXISTS "proposed_beliefs" jsonb NOT NULL DEFAULT '[]';
ALTER TABLE "character_social_events" ADD COLUMN IF NOT EXISTS "pressure_changes" jsonb NOT NULL DEFAULT '[]';
