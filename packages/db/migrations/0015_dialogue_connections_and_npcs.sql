ALTER TABLE "npc_chat_knowledgebases" ADD COLUMN IF NOT EXISTS "declared_connection" text NOT NULL DEFAULT 'contact';
ALTER TABLE "npc_chat_knowledgebases" ADD COLUMN IF NOT EXISTS "declared_connection_notes" text NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS "game_npc_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "game_id" uuid NOT NULL REFERENCES "games"("id") ON DELETE CASCADE,
  "character_id" text NOT NULL,
  "character" jsonb NOT NULL,
  "role_label" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "game_npc_records_game_character_unique" ON "game_npc_records" ("game_id", "character_id");
CREATE INDEX IF NOT EXISTS "game_npc_records_game_idx" ON "game_npc_records" ("game_id");
