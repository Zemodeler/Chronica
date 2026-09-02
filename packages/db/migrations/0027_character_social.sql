-- Character-sim phase 1: canonical character projection + the chat/simulation
-- boundary (docs/TODO). Hand-written rather than drizzle-kit-generated: this
-- environment's drizzle-kit requires an interactive TTY prompt to resolve an
-- unrelated enum-naming step that a non-interactive shell cannot answer.

CREATE TABLE IF NOT EXISTS "character_profiles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "game_id" uuid NOT NULL REFERENCES "games"("id") ON DELETE CASCADE,
  "character_id" text NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "role_label" text NOT NULL,
  "biography" text,
  "voice_summary" text,
  "presentation_details" jsonb NOT NULL DEFAULT '{}',
  "updated_at_step" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "character_profiles_game_character_unique" ON "character_profiles" ("game_id", "character_id");

CREATE TABLE IF NOT EXISTS "character_social_events" (
  "id" text PRIMARY KEY,
  "game_id" uuid NOT NULL REFERENCES "games"("id") ON DELETE CASCADE,
  "source_turn_id" text,
  "source_session_id" text,
  "source_message_id" text,
  "participant_character_ids" jsonb NOT NULL,
  "kind" text NOT NULL,
  "visibility" text NOT NULL,
  "known_by_character_ids" jsonb NOT NULL DEFAULT '[]',
  "relation_causes" jsonb NOT NULL DEFAULT '[]',
  "knowledge_claims" jsonb NOT NULL DEFAULT '[]',
  "commitment_proposal" jsonb,
  "introduced_character" jsonb,
  "introduced_profile" jsonb,
  "created_at_step" integer NOT NULL,
  "applied_at_step" integer,
  "applied_in_turn_id" text,
  "status" text NOT NULL DEFAULT 'proposed',
  "rejection_reason" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "character_social_events_game_status_idx" ON "character_social_events" ("game_id", "status");
