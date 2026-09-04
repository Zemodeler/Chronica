-- Game Master refactor.
--
-- Two additions, both write-only from the resolution pipeline's point of view:
--
--  * turns.game_master_report -- the structured turn report plus the factual
--    event log the Chronicle was built from, kept beside the existing
--    workflow_audit so a committed turn can be reconstructed and reviewed
--    without re-running any model.
--  * capability_requests -- the non-mutating record of an action the Game
--    Master needed and no registered workflow covers. This replaces the
--    invented-workflow escape hatch: a row here changed nothing, and a
--    developer decides offline whether it becomes a real typed workflow.

ALTER TABLE "turns" ADD COLUMN IF NOT EXISTS "game_master_report" jsonb;

CREATE TABLE IF NOT EXISTS "capability_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "game_id" uuid NOT NULL REFERENCES "games"("id") ON DELETE CASCADE,
  "turn_id" uuid NOT NULL REFERENCES "turns"("id") ON DELETE CASCADE,
  "at_step" integer NOT NULL,
  "actor_id" text NOT NULL,
  "proposed_tool_name" text NOT NULL,
  "requested_intent" text NOT NULL,
  "request" jsonb NOT NULL,
  -- 'unsupported' until a developer acts on it. There is deliberately no
  -- status that causes execution: converting one means writing a workflow.
  "status" text NOT NULL DEFAULT 'unsupported',
  "review_note" text,
  "reviewed_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "reviewed_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "capability_requests_game_idx" ON "capability_requests" ("game_id", "created_at");
CREATE INDEX IF NOT EXISTS "capability_requests_tool_idx" ON "capability_requests" ("proposed_tool_name");

-- Ordinary play can no longer execute a runtime-generated template
-- (packages/shared/src/workflows/executor.ts has no invented path at all).
-- Existing rows stay readable for migration review; disabling them here makes
-- the intent explicit in the data rather than only in code.
UPDATE "invented_workflows" SET
  "status" = 'disabled',
  "disabled_at" = now(),
  "disable_note" = COALESCE("disable_note", 'Disabled by the Game Master refactor: invented workflows are no longer executable. Convert to a registered typed workflow to restore this capability.')
WHERE "status" = 'active';
