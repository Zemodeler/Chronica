-- NPC chat system: drop the old turn-coupled dialogue tables and rebuild
-- them as always-on persistent sessions, then add the NPC knowledgebase table.

-- 1. Drop old tables (cascade removes all their indexes and constraints)
DROP TABLE IF EXISTS dialogue_messages CASCADE;
DROP TABLE IF EXISTS dialogue_sessions CASCADE;

-- 2. Drop old enums that are no longer used
DROP TYPE IF EXISTS dialogue_session_status;
DROP TYPE IF EXISTS dialogue_message_status;

-- 3. Create new dialogue_sessions table (no turn FK, no worker queue)
CREATE TABLE dialogue_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  npc_character_id TEXT,
  is_group BOOLEAN NOT NULL DEFAULT FALSE,
  participant_ids JSONB NOT NULL DEFAULT '[]',
  channel TEXT NOT NULL DEFAULT 'correspondence',
  is_closed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX dialogue_sessions_player_npc_unique
  ON dialogue_sessions (game_id, player_id, npc_character_id);

CREATE INDEX dialogue_sessions_game_player_idx
  ON dialogue_sessions (game_id, player_id);

-- 4. Create new dialogue_messages table (no worker queue columns)
CREATE TABLE dialogue_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES dialogue_sessions(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  speaker_character_id TEXT NOT NULL,
  is_player_message BOOLEAN NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX dialogue_messages_session_seq_unique
  ON dialogue_messages (session_id, sequence);

CREATE INDEX dialogue_messages_session_idx
  ON dialogue_messages (session_id);

-- 5. Create npc_chat_knowledgebases table
CREATE TABLE npc_chat_knowledgebases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  npc_character_id TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  personality_summary TEXT NOT NULL DEFAULT '',
  relationship_label TEXT NOT NULL DEFAULT 'neutral',
  relationship_score INTEGER NOT NULL DEFAULT 0,
  conversation_memory JSONB NOT NULL DEFAULT '[]',
  significant_events JSONB NOT NULL DEFAULT '[]',
  consequences JSONB NOT NULL DEFAULT '[]',
  relevancy_score INTEGER NOT NULL DEFAULT 0,
  interaction_count INTEGER NOT NULL DEFAULT 0,
  location_province_id TEXT,
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX npc_chat_kb_player_npc_unique
  ON npc_chat_knowledgebases (game_id, player_id, npc_character_id);

CREATE INDEX npc_chat_kb_game_player_idx
  ON npc_chat_knowledgebases (game_id, player_id);
