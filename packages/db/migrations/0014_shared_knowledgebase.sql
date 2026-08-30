-- Shared knowledgebase pools for NPC conversation knowledge.
-- Each row is one factual claim (fact, rumour, or plot) visible to all NPCs
-- in the same pool (polity, province, or dynasty).
-- Chronicle-fed game-wide entries will use pool_type = 'game' once the
-- chronicle system is wired — see docs/shared-knowledgebase-chronicle-integration.md.

CREATE TABLE IF NOT EXISTS shared_knowledgebase_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  pool_type TEXT NOT NULL,
  pool_key TEXT NOT NULL,
  body TEXT NOT NULL,
  source_npc_character_id TEXT NOT NULL,
  source_session_id UUID NOT NULL,
  step_occurred INTEGER NOT NULL DEFAULT 0,
  is_contradicted BOOLEAN NOT NULL DEFAULT FALSE,
  contradicts_ids TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS skb_game_pool_idx
  ON shared_knowledgebase_entries (game_id, pool_type, pool_key);
