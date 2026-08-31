CREATE TABLE "npc_commitments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "game_id" uuid NOT NULL REFERENCES "games"("id") ON DELETE CASCADE,
  "session_id" uuid NOT NULL REFERENCES "dialogue_sessions"("id") ON DELETE CASCADE,
  "npc_message_id" uuid NOT NULL REFERENCES "dialogue_messages"("id") ON DELETE CASCADE,
  "player_character_id" text NOT NULL,
  "npc_character_id" text NOT NULL,
  "promise_type" text NOT NULL,
  "promised_result" text NOT NULL,
  "conditions" text NOT NULL DEFAULT '',
  "rationale" text NOT NULL DEFAULT '',
  "status" text NOT NULL DEFAULT 'pending',
  "created_at_step" integer NOT NULL,
  "resolved_at_step" integer,
  "resolution_reason" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "npc_commitments_npc_message_unique" ON "npc_commitments" ("npc_message_id");
CREATE INDEX "npc_commitments_game_status_idx" ON "npc_commitments" ("game_id", "status");
