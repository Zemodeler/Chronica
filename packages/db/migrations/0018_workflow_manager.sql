-- Workflow Manager: audit column on turns and novel action proposals table (Issue #6).

ALTER TABLE "turns"
  ADD COLUMN "workflow_audit" jsonb;

CREATE TYPE "workflow_proposal_status" AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE "pending_workflow_proposals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "turn_id" uuid NOT NULL REFERENCES "turns"("id") ON DELETE CASCADE,
  "game_id" uuid NOT NULL REFERENCES "games"("id") ON DELETE CASCADE,
  "status" "workflow_proposal_status" NOT NULL DEFAULT 'pending',
  "intent" text NOT NULL,
  "target_entity_ids" jsonb NOT NULL,
  "estimated_mutation_description" text NOT NULL,
  "source" text NOT NULL,
  "source_ref" text NOT NULL,
  "reviewed_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "reviewed_at" timestamp with time zone,
  "review_note" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX "pending_workflow_proposals_game_idx" ON "pending_workflow_proposals" ("game_id");
CREATE INDEX "pending_workflow_proposals_status_idx" ON "pending_workflow_proposals" ("status");
