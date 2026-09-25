-- The engine's own account of where it and the model disagree.
--
-- A delta refused as unreadable never reaches the player, by design, and so
-- nobody saw it at all: the order simply did less than it said. Every refusal,
-- every act nobody obeyed and every detail the engine filled in itself is kept
-- here, per burst, so the ones that keep turning up can be found and fixed.
CREATE TABLE IF NOT EXISTS "delta_audit" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "game_id" uuid NOT NULL REFERENCES "games"("id") ON DELETE CASCADE,
  "burst_id" uuid NOT NULL REFERENCES "simulation_bursts"("id") ON DELETE CASCADE,
  "actor_kind" text NOT NULL,
  "actor_id" text NOT NULL,
  "op" text NOT NULL,
  "kind" text NOT NULL,
  "of_the_order" boolean NOT NULL,
  "attempt" text NOT NULL,
  "reason" text NOT NULL,
  "delta" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "delta_audit_burst_idx" ON "delta_audit" ("burst_id");
CREATE INDEX IF NOT EXISTS "delta_audit_kind_op_idx" ON "delta_audit" ("kind", "op");
