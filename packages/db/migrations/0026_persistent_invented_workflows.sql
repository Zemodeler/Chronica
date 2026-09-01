CREATE TYPE "invented_workflow_status" AS ENUM ('active', 'disabled');

CREATE TABLE "invented_workflows" (
  "id" uuid PRIMARY KEY NOT NULL,
  "game_id" uuid NOT NULL REFERENCES "games"("id") ON DELETE CASCADE,
  "created_turn_id" uuid NOT NULL REFERENCES "turns"("id") ON DELETE CASCADE,
  "action_id" text NOT NULL,
  "intent" text NOT NULL,
  "description" text NOT NULL,
  "definition" jsonb NOT NULL,
  "status" "invented_workflow_status" NOT NULL DEFAULT 'active',
  "successful_use_count" integer NOT NULL DEFAULT 0,
  "last_used_at" timestamp with time zone,
  "disabled_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "disabled_at" timestamp with time zone,
  "disable_note" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "invented_workflows_game_action_unique" ON "invented_workflows" ("game_id", "action_id");
CREATE INDEX "invented_workflows_game_status_idx" ON "invented_workflows" ("game_id", "status");
CREATE INDEX "invented_workflows_usage_idx" ON "invented_workflows" ("successful_use_count", "last_used_at");

CREATE TABLE "invented_workflow_uses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workflow_id" uuid NOT NULL REFERENCES "invented_workflows"("id") ON DELETE CASCADE,
  "turn_id" uuid NOT NULL REFERENCES "turns"("id") ON DELETE CASCADE,
  "parameters" jsonb NOT NULL,
  "resolved_patch" jsonb,
  "success" boolean NOT NULL,
  "failure_reason" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX "invented_workflow_uses_workflow_idx" ON "invented_workflow_uses" ("workflow_id", "created_at");
CREATE INDEX "invented_workflow_uses_turn_idx" ON "invented_workflow_uses" ("turn_id");
