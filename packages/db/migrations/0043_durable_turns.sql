-- Turns as durable work, and a record that can be paged.
--
-- A turn used to run inside the web process that took the order (Next's
-- `after`), so a restart failed every turn in flight and nothing could take
-- one up again. `turn_jobs` holds the order as it was given and who is
-- carrying it out: a worker leases the job, renews the lease while it works,
-- and commits under it; a lease that lapses is taken up by another worker, a
-- bounded number of times. `turn_job_attempts` keeps each lease and how it
-- ended. `turn_job_calls` keeps every model request an attempt made, written
-- before the provider is asked: a worker that dies mid-call leaves a row the
-- next lease marks `uncertain`, and an answered request is handed back to a
-- later attempt that asks the very same thing, rather than asked and paid for
-- again.
--
-- Nothing already stored is changed. A running burst with no job (written
-- before this migration, or by a letter or peace table) is reaped as before.
--
-- The Chronicle's reading order gets an index with the id as its last tie, so
-- a page boundary never falls between rows that sort as one; and a burst's
-- passages get a unique (burst, ordinal), so a commit replayed after a lost
-- acknowledgement cannot enter them twice. That index is created only where
-- the stored record already holds to it: an old save that somehow does not is
-- left as it is (and a notice says so), never rewritten or refused.
DO $$ BEGIN
  CREATE TYPE "public"."turn_call_status" AS ENUM('started', 'answered', 'failed', 'uncertain');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."turn_job_status" AS ENUM('queued', 'leased', 'committed', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "turn_jobs" (
	"burst_id" uuid PRIMARY KEY NOT NULL,
	"game_id" uuid NOT NULL,
	"status" "turn_job_status" DEFAULT 'queued' NOT NULL,
	"input" jsonb NOT NULL,
	"input_version" integer DEFAULT 1 NOT NULL,
	"base_revision" integer NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"committed_attempt" integer,
	"committed_revision" integer,
	"followups_pending" boolean DEFAULT false NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "turn_jobs_burst_id_simulation_bursts_id_fk" FOREIGN KEY ("burst_id") REFERENCES "public"."simulation_bursts"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "turn_jobs_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "turn_job_attempts" (
	"burst_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"worker" text NOT NULL,
	"outcome" text DEFAULT 'running' NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "turn_job_attempts_burst_id_turn_jobs_burst_id_fk" FOREIGN KEY ("burst_id") REFERENCES "public"."turn_jobs"("burst_id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "turn_job_calls" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"burst_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"operation" text NOT NULL,
	"request_hash" text NOT NULL,
	"occurrence" integer NOT NULL,
	"status" "turn_call_status" DEFAULT 'started' NOT NULL,
	"replayed_from" bigint,
	"response" text,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "turn_job_calls_burst_id_turn_jobs_burst_id_fk" FOREIGN KEY ("burst_id") REFERENCES "public"."turn_jobs"("burst_id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "turn_job_attempts_burst_attempt_idx" ON "turn_job_attempts" USING btree ("burst_id","attempt");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "turn_job_calls_attempt_request_idx" ON "turn_job_calls" USING btree ("burst_id","attempt","request_hash","occurrence");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "turn_job_calls_request_idx" ON "turn_job_calls" USING btree ("burst_id","request_hash","occurrence");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "turn_jobs_claim_idx" ON "turn_jobs" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "turn_jobs_lease_idx" ON "turn_jobs" USING btree ("status","lease_expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "turn_jobs_game_idx" ON "turn_jobs" USING btree ("game_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chronicle_checkpoints_reading_idx" ON "chronicle_checkpoints" USING btree ("game_id","to_instant_sort_key" DESC NULLS LAST,"created_at" DESC NULLS LAST,"ordinal" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM "chronicle_checkpoints"
    WHERE "burst_id" IS NOT NULL
    GROUP BY "burst_id", "ordinal"
    HAVING count(*) > 1
  ) THEN
    RAISE NOTICE 'chronicle_checkpoints already holds a burst with two passages at one ordinal; chronicle_checkpoints_burst_ordinal_idx was not created and the stored record was left as it is.';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS "chronicle_checkpoints_burst_ordinal_idx" ON "chronicle_checkpoints" USING btree ("burst_id","ordinal") WHERE "chronicle_checkpoints"."burst_id" IS NOT NULL;
  END IF;
END $$;
