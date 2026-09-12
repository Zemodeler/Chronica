-- Unified action runtime, Stage 7: let a queued turn survive a provider
-- failure or a crash mid-resolution instead of being silently dropped.
--
-- `resolve_attempts` tracks how many times resolution has been tried so a
-- transient failure can requeue the turn for retry (see `failTurn` in
-- packages/db/src/queries/resolution.ts) while still giving up after
-- MAX_TURN_RESOLVE_ATTEMPTS, rather than retrying a genuinely broken turn
-- forever. `claimed_by`/`claim_expires_at` already existed on this table but
-- were never populated -- `claimTurnForResolution` now gives every claim a
-- real lease, and `releaseExpiredTurnClaims` reclaims one whose holder
-- crashed before finishing, mirroring `world_events`' existing claim pattern.

ALTER TABLE "turns" ADD COLUMN "resolve_attempts" integer NOT NULL DEFAULT 0;
