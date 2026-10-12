-- A coin hold taken for a durable turn says which turn and which attempt.
--
-- The stale-hold sweep released every active hold older than a fixed age, as
-- though no call could outlive it. A durable turn's call can: the attempt
-- renews its lease while it waits, and a configured call timeout may exceed
-- the sweep's age. The sweep released such a hold under a live call, and its
-- settlement was then refused. A hold now names its turn (`turn_burst_id`)
-- and attempt (`turn_attempt`); the sweep expires an owned hold only once that
-- attempt no longer holds a live lease on the job, read under the hold's row
-- lock. Holds with no owner -- every hold written before this, and every call
-- that is not a turn's -- are expired by age, as before.
--
-- Additive and nullable: nothing stored is changed, and a build from before
-- this migration reads and writes the table as it did. To take it back out:
--   ALTER TABLE "credit_holds" DROP CONSTRAINT IF EXISTS "credit_holds_turn_owner_whole";
--   DROP INDEX IF EXISTS "credit_holds_turn_idx";
--   ALTER TABLE "credit_holds" DROP COLUMN IF EXISTS "turn_attempt", DROP COLUMN IF EXISTS "turn_burst_id";
ALTER TABLE "credit_holds" ADD COLUMN IF NOT EXISTS "turn_burst_id" uuid;--> statement-breakpoint
ALTER TABLE "credit_holds" ADD COLUMN IF NOT EXISTS "turn_attempt" integer;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_holds_turn_idx" ON "credit_holds" USING btree ("turn_burst_id","turn_attempt");--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "credit_holds" ADD CONSTRAINT "credit_holds_turn_owner_whole" CHECK (("credit_holds"."turn_burst_id" is null) = ("credit_holds"."turn_attempt" is null));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
