-- docs/27: persist the current Game Master tool loop's own audit trail.
--
-- `turns.workflow_audit` is the older Workflow-Manager blob shape (candidates/
-- novelActionProposals/managerFailed) the GM refactor superseded; nothing
-- writes it for turns resolved by the current pipeline. This column carries
-- what `GameMasterSession` actually populates per call: policy violation,
-- dry-run/execution outcome, and final invocation.

ALTER TABLE "turns" ADD COLUMN IF NOT EXISTS "game_master_audit" jsonb;
