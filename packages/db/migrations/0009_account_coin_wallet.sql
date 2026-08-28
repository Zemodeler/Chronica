ALTER TYPE "public"."user_role" ADD VALUE IF NOT EXISTS 'developer' BEFORE 'admin';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatar_key" text DEFAULT 'laurel' NOT NULL;--> statement-breakpoint
DROP INDEX IF EXISTS "users_username_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_unique" ON "users" USING btree (lower("username"));--> statement-breakpoint
CREATE TABLE "auth_request_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key_hash" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "auth_request_limits_key_time_idx" ON "auth_request_limits" USING btree ("key_hash","requested_at");--> statement-breakpoint
CREATE TABLE "ai_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"payer_user_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"routing_profile_version" integer NOT NULL,
	"rate_card_version" integer NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cache_read_tokens" integer NOT NULL,
	"cache_write_tokens" integer NOT NULL,
	"provider_cost_micro_units" bigint NOT NULL,
	"coin_charge_micro_units" bigint NOT NULL,
	"hold_id" uuid NOT NULL,
	"work_id" text NOT NULL,
	"outcome" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_calls_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id"),
	CONSTRAINT "ai_calls_payer_user_id_users_id_fk" FOREIGN KEY ("payer_user_id") REFERENCES "public"."users"("id"),
	CONSTRAINT "ai_calls_hold_id_credit_holds_id_fk" FOREIGN KEY ("hold_id") REFERENCES "public"."credit_holds"("id")
);--> statement-breakpoint
CREATE UNIQUE INDEX "ai_calls_idempotency_unique" ON "ai_calls" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "ai_calls_game_created_idx" ON "ai_calls" USING btree ("game_id","created_at");--> statement-breakpoint

-- The old displayed unit had 1,000 sub-units. Coins have 1,000,000, so scale
-- every persisted monetary integer together and preserve displayed quantities.
UPDATE "credit_wallets" SET "available_microcredits" = "available_microcredits" * 1000, "held_microcredits" = "held_microcredits" * 1000, "debt_microcredits" = "debt_microcredits" * 1000;--> statement-breakpoint
UPDATE "credit_lots" SET "granted_microcredits" = "granted_microcredits" * 1000, "remaining_microcredits" = "remaining_microcredits" * 1000, "held_microcredits" = "held_microcredits" * 1000;--> statement-breakpoint
UPDATE "credit_holds" SET
  "maximum_microcredits" = "maximum_microcredits" * 1000,
  "lot_allocation" = (
    SELECT coalesce(jsonb_agg(jsonb_set(item, '{microUnits}', to_jsonb(((item->>'microUnits')::bigint * 1000)::text))), '[]'::jsonb)
    FROM jsonb_array_elements("credit_holds"."lot_allocation") AS item
  );--> statement-breakpoint
UPDATE "credit_ledger_entries" SET "signed_microcredits" = "signed_microcredits" * 1000, "balance_after_microcredits" = "balance_after_microcredits" * 1000;--> statement-breakpoint
UPDATE "gift_codes" SET "grant_microcredits" = "grant_microcredits" * 1000;--> statement-breakpoint
UPDATE "billing_products" SET "grant_microcredits" = "grant_microcredits" * 1000;--> statement-breakpoint
UPDATE "billing_products" SET "active" = false;--> statement-breakpoint
UPDATE "games" SET "credit_budget_microcredits" = "credit_budget_microcredits" * 1000, "credit_spent_microcredits" = "credit_spent_microcredits" * 1000;--> statement-breakpoint
UPDATE "scenario_versions" SET "generation_credit_charge_microcredits" = "generation_credit_charge_microcredits" * 1000;--> statement-breakpoint
