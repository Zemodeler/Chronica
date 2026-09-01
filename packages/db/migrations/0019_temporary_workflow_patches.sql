ALTER TABLE "pending_workflow_proposals"
  ADD COLUMN "temporary_patch" jsonb,
  ADD COLUMN "implementation_report" text;
