-- Simulation Loop v1 storage (docs/VISION.md §33).
--
-- The turn system's storage was dropped wholesale in the previous change
-- (docs/plans/delete-chronicle-orders-turns.md) and nothing replaced it, so a
-- game currently has nowhere to keep its world at all. These five tables are
-- that replacement, split by lifetime rather than by turn:
--
--  * game_worlds          -- the live world document, one row per game, with a
--                            revision token so a slow burst and a fast
--                            conversation cannot silently overwrite each other.
--  * world_facts          -- the append-only historical record. Outside the
--                            world document on purpose: what is true and who
--                            knows it are different questions (VISION §14).
--  * scheduled_events     -- the future queue. A four-month recruitment is
--                            scheduled, not simulated through (VISION §17).
--  * simulation_bursts    -- one run of the loop, for inspection afterwards.
--  * chronicle_checkpoints / player_decisions -- what the player was actually
--                            shown, and the rare fork that needs their own
--                            authority (VISION §23).

-- ─── Part 1: retire the turn system's storage ────────────────────────────
--
-- The previous change deleted every line of code that reads these tables but
-- never wrote the migration to drop them, so the schema outlived its readers.
-- Nothing can interpret these rows any more; `world_facts` in particular also
-- collides by name with the new fact ledger, which would otherwise silently
-- keep the old shape under a CREATE TABLE IF NOT EXISTS.
--
-- Irreversible, and deliberately so: this is the point at which the turn era
-- stops being recoverable.

DROP TABLE IF EXISTS "invented_workflow_uses" CASCADE;
DROP TABLE IF EXISTS "invented_workflows" CASCADE;
DROP TABLE IF EXISTS "pending_workflow_proposals" CASCADE;
DROP TABLE IF EXISTS "capability_requests" CASCADE;
DROP TABLE IF EXISTS "chronicle_entries" CASCADE;
DROP TABLE IF EXISTS "turn_news_readiness" CASCADE;
DROP TABLE IF EXISTS "world_facts" CASCADE;
DROP TABLE IF EXISTS "world_events" CASCADE;
DROP TABLE IF EXISTS "orders" CASCADE;
DROP TABLE IF EXISTS "world_snapshots" CASCADE;
DROP TABLE IF EXISTS "turns" CASCADE;

ALTER TABLE "games" DROP COLUMN IF EXISTS "turn_mode";
ALTER TABLE "games" DROP COLUMN IF EXISTS "turn_timeout_seconds";
ALTER TABLE "games" DROP COLUMN IF EXISTS "news_timeout_seconds";
ALTER TABLE "games" DROP COLUMN IF EXISTS "agent_architecture_version";
ALTER TABLE "players" DROP COLUMN IF EXISTS "standing_order";
ALTER TABLE "players" DROP COLUMN IF EXISTS "auto_pass";
ALTER TABLE "players" DROP COLUMN IF EXISTS "watch_conditions";
ALTER TABLE "character_claims" DROP COLUMN IF EXISTS "introduced_at_turn_id";
ALTER TABLE "player_game_ui_state" DROP COLUMN IF EXISTS "chronicle_read_sequence";

DROP TYPE IF EXISTS "turn_status";
DROP TYPE IF EXISTS "world_event_kind";
DROP TYPE IF EXISTS "world_event_status";
DROP TYPE IF EXISTS "workflow_proposal_status";
DROP TYPE IF EXISTS "invented_workflow_status";

-- ─── Part 2: the simulation loop's own storage ───────────────────────────

DO $$ BEGIN
  CREATE TYPE "scheduled_event_status" AS ENUM ('pending', 'fired', 'cancelled', 'superseded');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "simulation_burst_status" AS ENUM ('running', 'committed', 'failed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "player_decision_status" AS ENUM ('open', 'resolved', 'expired');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "game_worlds" (
  "game_id" uuid PRIMARY KEY REFERENCES "games"("id") ON DELETE CASCADE,
  "world" jsonb NOT NULL,
  "schema_version" integer NOT NULL,
  "revision" integer NOT NULL DEFAULT 1,
  "state_hash" text NOT NULL,
  "instant_sort_key" bigint NOT NULL DEFAULT 0,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "world_facts" (
  "id" text PRIMARY KEY,
  "game_id" uuid NOT NULL REFERENCES "games"("id") ON DELETE CASCADE,
  "burst_id" uuid,
  "instant_sort_key" bigint NOT NULL,
  "kind" text NOT NULL,
  "summary" text NOT NULL,
  "visibility" text NOT NULL,
  "discovery_state" text NOT NULL,
  "knowable_at_sort_key" bigint,
  "significance" integer NOT NULL DEFAULT 0,
  "causal_depth" integer NOT NULL DEFAULT 0,
  "fact" jsonb NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "world_facts_game_time_idx" ON "world_facts" ("game_id", "instant_sort_key");
CREATE INDEX IF NOT EXISTS "world_facts_game_significance_idx" ON "world_facts" ("game_id", "significance");

CREATE TABLE IF NOT EXISTS "scheduled_events" (
  "id" text PRIMARY KEY,
  "game_id" uuid NOT NULL REFERENCES "games"("id") ON DELETE CASCADE,
  "due_instant_sort_key" bigint NOT NULL,
  "kind" text NOT NULL,
  "summary" text NOT NULL,
  "payload" jsonb NOT NULL,
  "status" "scheduled_event_status" NOT NULL DEFAULT 'pending',
  "cause_fact_id" text,
  "causal_depth" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "fired_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "scheduled_events_due_idx" ON "scheduled_events" ("game_id", "status", "due_instant_sort_key");

CREATE TABLE IF NOT EXISTS "simulation_bursts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "game_id" uuid NOT NULL REFERENCES "games"("id") ON DELETE CASCADE,
  "player_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "order_text" text,
  "status" "simulation_burst_status" NOT NULL DEFAULT 'running',
  "iterations" integer NOT NULL DEFAULT 0,
  "model_calls" integer NOT NULL DEFAULT 0,
  "outcome" text,
  "stop_reason" text,
  "accumulated_significance" integer NOT NULL DEFAULT 0,
  "error" text,
  "started_at" timestamp with time zone NOT NULL DEFAULT now(),
  "ended_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "simulation_bursts_game_idx" ON "simulation_bursts" ("game_id", "started_at");

CREATE TABLE IF NOT EXISTS "chronicle_checkpoints" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "game_id" uuid NOT NULL REFERENCES "games"("id") ON DELETE CASCADE,
  "burst_id" uuid REFERENCES "simulation_bursts"("id") ON DELETE SET NULL,
  "from_instant_sort_key" bigint NOT NULL,
  "to_instant_sort_key" bigint NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "fact_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "stop_reason" text NOT NULL,
  "read_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "chronicle_checkpoints_game_idx" ON "chronicle_checkpoints" ("game_id", "to_instant_sort_key");

CREATE TABLE IF NOT EXISTS "player_decisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "game_id" uuid NOT NULL REFERENCES "games"("id") ON DELETE CASCADE,
  "burst_id" uuid REFERENCES "simulation_bursts"("id") ON DELETE SET NULL,
  "prompt" text NOT NULL,
  "options" jsonb NOT NULL,
  "status" "player_decision_status" NOT NULL DEFAULT 'open',
  "chosen_option_id" text,
  "resolved_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "player_decisions_game_status_idx" ON "player_decisions" ("game_id", "status");
