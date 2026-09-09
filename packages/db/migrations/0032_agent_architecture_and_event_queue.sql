-- docs/32: agent architecture versioning + the persistent event queue
-- (Phase 7's "Core runtime") and canonical Fact ledger.
--
--  * games.agent_architecture_version -- 1 = today's single centralized Game
--    Master call, kept indefinitely for in-flight campaigns. 2 = the
--    multi-agent dispatcher (docs/32, Part B). Never changes mid-play.
--  * turns.instant_day_start/instant_minute_start/instant_day_end/
--    instant_minute_end -- minute-precision authoritative time, alongside
--    the existing day columns, populated only once the event queue is
--    actually driving resolution for a turn.
--  * world_events -- the scheduling queue; world_facts -- the canonical
--    Fact ledger produced by resolving events.

ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "agent_architecture_version" integer NOT NULL DEFAULT 1;

ALTER TABLE "turns" ADD COLUMN IF NOT EXISTS "instant_day_start" integer;
ALTER TABLE "turns" ADD COLUMN IF NOT EXISTS "instant_minute_start" integer;
ALTER TABLE "turns" ADD COLUMN IF NOT EXISTS "instant_day_end" integer;
ALTER TABLE "turns" ADD COLUMN IF NOT EXISTS "instant_minute_end" integer;

DO $$ BEGIN
  CREATE TYPE "world_event_kind" AS ENUM ('action_phase', 'world_process_tick', 'midnight_tick', 'order_deadline', 'reaction_window');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "world_event_status" AS ENUM ('pending', 'claimed', 'resolved', 'cancelled', 'superseded');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "world_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "game_id" uuid NOT NULL REFERENCES "games"("id") ON DELETE CASCADE,
  "scheduled_for_turn_id" uuid REFERENCES "turns"("id") ON DELETE SET NULL,
  "kind" "world_event_kind" NOT NULL,
  "status" "world_event_status" NOT NULL DEFAULT 'pending',
  "instant_sort_key" bigint NOT NULL,
  "instant_day" integer NOT NULL,
  "instant_minute" integer NOT NULL,
  "priority" integer NOT NULL DEFAULT 0,
  "is_player_action" boolean NOT NULL DEFAULT false,
  "subject_ref" jsonb NOT NULL,
  "action_id" text,
  "operation_id" text,
  "payload" jsonb NOT NULL,
  "causal_depth" integer NOT NULL DEFAULT 0,
  "caused_by_event_id" uuid,
  "caused_by_fact_id" text,
  "created_at_step" integer NOT NULL,
  "resolved_at_step" integer,
  "resolved_fact_ids" text[],
  "claimed_by" text,
  "claim_expires_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "world_events_game_pending_idx" ON "world_events" ("game_id", "status", "instant_sort_key", "priority");
CREATE INDEX IF NOT EXISTS "world_events_action_idx" ON "world_events" ("action_id");
CREATE INDEX IF NOT EXISTS "world_events_turn_idx" ON "world_events" ("scheduled_for_turn_id");

CREATE TABLE IF NOT EXISTS "world_facts" (
  "id" text PRIMARY KEY NOT NULL,
  "game_id" uuid NOT NULL REFERENCES "games"("id") ON DELETE CASCADE,
  "turn_id" uuid REFERENCES "turns"("id") ON DELETE SET NULL,
  "at_step" integer NOT NULL,
  "instant_day" integer NOT NULL,
  "instant_minute" integer NOT NULL,
  "kind" text NOT NULL,
  "visibility" text NOT NULL,
  "data" jsonb NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "world_facts_game_step_idx" ON "world_facts" ("game_id", "at_step");
CREATE INDEX IF NOT EXISTS "world_facts_game_kind_idx" ON "world_facts" ("game_id", "kind");
CREATE INDEX IF NOT EXISTS "world_facts_visibility_idx" ON "world_facts" ("game_id", "visibility");
