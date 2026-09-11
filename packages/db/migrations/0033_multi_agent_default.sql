-- Make the multi-agent dispatcher the default resolution architecture.
--
-- Version 2 (agents/orchestrator.ts) becomes what a newly created campaign
-- gets. Version 1 (the single centralized Game Master call) is deprecated:
-- still fully supported, but no longer chosen for anything new.
--
-- Deliberately only the column default. Existing rows are left exactly as
-- they are, because an active story's resolution model must never change
-- mid-play -- a campaign that began under the single-GM path finishes under
-- it.

ALTER TABLE "games" ALTER COLUMN "agent_architecture_version" SET DEFAULT 2;
