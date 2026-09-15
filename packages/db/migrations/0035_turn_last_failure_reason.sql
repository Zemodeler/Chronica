-- A permanently failed turn (status = 'failed', resolve_attempts exhausted)
-- previously discarded the reason it failed -- `failTurn` took a `_reason`
-- parameter and never persisted it. Kept here as internal diagnostic text
-- (never shown to a player verbatim) so a failed turn is diagnosable after
-- the fact, and so the resolution API can tell a player their turn needs a
-- retry instead of looking identical to a turn still in progress. Also
-- written by the durable worker's precondition checks in `resolveQueuedTurn`,
-- which used to bypass `failTurn` entirely.

ALTER TABLE "turns" ADD COLUMN "last_failure_reason" text;
