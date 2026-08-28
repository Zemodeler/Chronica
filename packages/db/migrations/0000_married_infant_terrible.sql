CREATE TYPE "public"."user_role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TYPE "public"."billing_event_state" AS ENUM('pending', 'claimed', 'processed', 'failed', 'quarantined');--> statement-breakpoint
CREATE TYPE "public"."credit_hold_status" AS ENUM('active', 'settled', 'released', 'expired');--> statement-breakpoint
CREATE TYPE "public"."credit_ledger_kind" AS ENUM('grant', 'hold', 'settle', 'release', 'expire', 'reversal', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."billing_product_kind" AS ENUM('pack', 'subscription');--> statement-breakpoint
CREATE TYPE "public"."dialogue_message_status" AS ENUM('pending', 'claimed', 'ready', 'templated', 'failed');--> statement-breakpoint
CREATE TYPE "public"."dialogue_session_status" AS ENUM('resolving_contact', 'open', 'unavailable', 'closed', 'merged', 'discarded');--> statement-breakpoint
CREATE TYPE "public"."game_status" AS ENUM('lobby', 'active', 'finished', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('active', 'payment_paused');--> statement-breakpoint
CREATE TYPE "public"."player_status" AS ENUM('active', 'idle', 'eliminated', 'vacated');--> statement-breakpoint
CREATE TYPE "public"."scenario_visibility" AS ENUM('private', 'unlisted', 'public');--> statement-breakpoint
CREATE TYPE "public"."turn_status" AS ENUM('collecting', 'queued', 'resolving', 'news', 'resolved', 'cancelled', 'failed');--> statement-breakpoint
CREATE TABLE "auth_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"email_verified_at" timestamp with time zone,
	"image" text,
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider_customer_ref" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_event_ref" text NOT NULL,
	"type" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"normalized_payload" jsonb NOT NULL,
	"raw_body_hash" text NOT NULL,
	"processing_state" "billing_event_state" DEFAULT 'pending' NOT NULL,
	"error" text,
	"claimed_by" text,
	"claim_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_products" (
	"slug" text PRIMARY KEY NOT NULL,
	"kind" "billing_product_kind" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"provider_price_ref" text NOT NULL,
	"currency" text NOT NULL,
	"price_minor_units" bigint NOT NULL,
	"grant_microcredits" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider_subscription_ref" text NOT NULL,
	"product_slug" text NOT NULL,
	"provider_updated_at" timestamp with time zone NOT NULL,
	"state" text NOT NULL,
	"current_period_starts_at" timestamp with time zone,
	"current_period_ends_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "credit_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_id" uuid NOT NULL,
	"game_id" uuid,
	"work_id" text NOT NULL,
	"maximum_microcredits" bigint NOT NULL,
	"lot_allocation" jsonb NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"status" "credit_hold_status" NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_id" uuid NOT NULL,
	"kind" "credit_ledger_kind" NOT NULL,
	"signed_microcredits" bigint NOT NULL,
	"idempotency_key" text NOT NULL,
	"source_ref" text,
	"game_id" uuid,
	"work_id" text,
	"hold_id" uuid,
	"balance_after_microcredits" bigint NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_id" uuid NOT NULL,
	"source_kind" text NOT NULL,
	"source_ref" text NOT NULL,
	"granted_microcredits" bigint NOT NULL,
	"remaining_microcredits" bigint NOT NULL,
	"held_microcredits" bigint DEFAULT 0 NOT NULL,
	"granted_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"creation_order" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_rate_cards" (
	"version" integer PRIMARY KEY NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"rates" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"available_microcredits" bigint DEFAULT 0 NOT NULL,
	"held_microcredits" bigint DEFAULT 0 NOT NULL,
	"debt_microcredits" bigint DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gift_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_hash" text NOT NULL,
	"grant_microcredits" bigint NOT NULL,
	"code_expires_at" timestamp with time zone,
	"granted_credits_expire_at" timestamp with time zone,
	"max_redemptions" integer NOT NULL,
	"per_account_limit" integer DEFAULT 1 NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"created_by" uuid NOT NULL,
	"audit_note" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gift_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gift_code_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"credit_lot_id" uuid NOT NULL,
	"redeemed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dialogue_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"speaker_character_id" text NOT NULL,
	"body" text NOT NULL,
	"acts" jsonb NOT NULL,
	"disclosed_fact_ids" jsonb NOT NULL,
	"status" "dialogue_message_status" NOT NULL,
	"ai_call_id" uuid,
	"claimed_by" text,
	"claim_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dialogue_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"game_id" uuid NOT NULL,
	"turn_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"npc_character_id" text,
	"provisional" boolean DEFAULT false NOT NULL,
	"role_query" text,
	"base_state_hash" text NOT NULL,
	"channel" text NOT NULL,
	"visibility" jsonb NOT NULL,
	"thread_context" jsonb NOT NULL,
	"overlay" jsonb NOT NULL,
	"status" "dialogue_session_status" NOT NULL,
	"claimed_by" text,
	"claim_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "character_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"character_id" text NOT NULL,
	"player_id" uuid NOT NULL,
	"origin" text NOT NULL,
	"declaration" text,
	"resolved_role" jsonb,
	"released_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "chronicle_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"turn_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"scope" text NOT NULL,
	"scope_ref" text,
	"audience" text NOT NULL,
	"visibility" text NOT NULL,
	"player_involvement" jsonb NOT NULL,
	"body" text NOT NULL,
	"facts" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"reserved_seat_ref" text,
	"expires_at" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"claimed_player_id" uuid
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scenario_id" uuid NOT NULL,
	"title" text NOT NULL,
	"status" "game_status" DEFAULT 'lobby' NOT NULL,
	"turn_mode" text DEFAULT 'all_submitted' NOT NULL,
	"turn_timeout_seconds" integer DEFAULT 86400 NOT NULL,
	"news_timeout_seconds" integer DEFAULT 60 NOT NULL,
	"ai_profile_version" integer NOT NULL,
	"payer_user_id" uuid NOT NULL,
	"credit_rate_card_version" integer NOT NULL,
	"credit_budget_microcredits" bigint NOT NULL,
	"credit_spent_microcredits" bigint DEFAULT 0 NOT NULL,
	"payment_status" "payment_status" DEFAULT 'active' NOT NULL,
	"payment_pause_reason" text,
	"payment_paused_at" timestamp with time zone,
	"frozen_deadline_remaining_seconds" integer,
	"scenario_version" integer NOT NULL,
	"library_version" integer NOT NULL,
	"starting_seat_count" integer NOT NULL,
	"extra_principals_per_player" integer DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	"end_requested_at" timestamp with time zone,
	"end_requested_by" uuid,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"turn_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"raw_text" text NOT NULL,
	"directives" jsonb NOT NULL,
	"intents" jsonb NOT NULL,
	"assessment_ai_call_id" uuid,
	"parse_source" text NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"user_id" uuid,
	"character_id" text NOT NULL,
	"status" "player_status" DEFAULT 'active' NOT NULL,
	"guest_session_version" integer DEFAULT 1 NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scenario_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scenario_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"schema_version" integer NOT NULL,
	"origin" text NOT NULL,
	"parent_version" integer,
	"changed_stages" text[],
	"ai_profile_version" integer,
	"validated_at" timestamp with time zone,
	"generation_provider_cost_microunits" bigint DEFAULT 0 NOT NULL,
	"generation_credit_charge_microcredits" bigint DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scenarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"period" text NOT NULL,
	"author_id" uuid,
	"visibility" "scenario_visibility" DEFAULT 'private' NOT NULL,
	"forked_from_scenario_id" uuid,
	"current_version" integer DEFAULT 1 NOT NULL,
	"match_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "turn_news_readiness" (
	"turn_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"ready_at" timestamp with time zone,
	"auto_ready" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"index" integer NOT NULL,
	"status" "turn_status" NOT NULL,
	"seed" text NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"deadline_at" timestamp with time zone,
	"resolution_committed_at" timestamp with time zone,
	"news_deadline_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"claimed_by" text,
	"claim_expires_at" timestamp with time zone,
	"elapsed_step_start" integer NOT NULL,
	"elapsed_step_end" integer,
	"stop_reason" text
);
--> statement-breakpoint
CREATE TABLE "world_snapshots" (
	"turn_id" uuid PRIMARY KEY NOT NULL,
	"state" jsonb NOT NULL,
	"schema_version" integer NOT NULL,
	"state_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD CONSTRAINT "auth_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_customers" ADD CONSTRAINT "billing_customers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_product_slug_billing_products_slug_fk" FOREIGN KEY ("product_slug") REFERENCES "public"."billing_products"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_holds" ADD CONSTRAINT "credit_holds_wallet_id_credit_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."credit_wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_holds" ADD CONSTRAINT "credit_holds_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger_entries" ADD CONSTRAINT "credit_ledger_entries_wallet_id_credit_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."credit_wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger_entries" ADD CONSTRAINT "credit_ledger_entries_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger_entries" ADD CONSTRAINT "credit_ledger_entries_hold_id_credit_holds_id_fk" FOREIGN KEY ("hold_id") REFERENCES "public"."credit_holds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_lots" ADD CONSTRAINT "credit_lots_wallet_id_credit_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."credit_wallets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_wallets" ADD CONSTRAINT "credit_wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_codes" ADD CONSTRAINT "gift_codes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_redemptions" ADD CONSTRAINT "gift_redemptions_gift_code_id_gift_codes_id_fk" FOREIGN KEY ("gift_code_id") REFERENCES "public"."gift_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_redemptions" ADD CONSTRAINT "gift_redemptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_redemptions" ADD CONSTRAINT "gift_redemptions_credit_lot_id_credit_lots_id_fk" FOREIGN KEY ("credit_lot_id") REFERENCES "public"."credit_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dialogue_messages" ADD CONSTRAINT "dialogue_messages_session_id_dialogue_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."dialogue_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dialogue_sessions" ADD CONSTRAINT "dialogue_sessions_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dialogue_sessions" ADD CONSTRAINT "dialogue_sessions_turn_id_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."turns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dialogue_sessions" ADD CONSTRAINT "dialogue_sessions_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_claims" ADD CONSTRAINT "character_claims_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_claims" ADD CONSTRAINT "character_claims_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chronicle_entries" ADD CONSTRAINT "chronicle_entries_turn_id_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."turns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_invites" ADD CONSTRAINT "game_invites_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_invites" ADD CONSTRAINT "game_invites_claimed_player_id_players_id_fk" FOREIGN KEY ("claimed_player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_scenario_id_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_payer_user_id_users_id_fk" FOREIGN KEY ("payer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_end_requested_by_users_id_fk" FOREIGN KEY ("end_requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_turn_id_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."turns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_versions" ADD CONSTRAINT "scenario_versions_scenario_id_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turn_news_readiness" ADD CONSTRAINT "turn_news_readiness_turn_id_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."turns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turn_news_readiness" ADD CONSTRAINT "turn_news_readiness_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turns" ADD CONSTRAINT "turns_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_snapshots" ADD CONSTRAINT "world_snapshots_turn_id_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."turns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_accounts_provider_account_unique" ON "auth_accounts" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "auth_accounts_user_idx" ON "auth_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_sessions_token_unique" ON "auth_sessions" USING btree ("token");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_idx" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_sessions_expiry_idx" ON "auth_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "auth_verifications_identifier_idx" ON "auth_verifications" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "auth_verifications_expiry_idx" ON "auth_verifications" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_customers_user_unique" ON "billing_customers" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_customers_provider_unique" ON "billing_customers" USING btree ("provider_customer_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_events_provider_unique" ON "billing_events" USING btree ("provider_event_ref");--> statement-breakpoint
CREATE INDEX "billing_events_claim_idx" ON "billing_events" USING btree ("processing_state","claim_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_subscriptions_provider_unique" ON "billing_subscriptions" USING btree ("provider_subscription_ref");--> statement-breakpoint
CREATE INDEX "billing_subscriptions_user_idx" ON "billing_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_holds_work_idempotency_unique" ON "credit_holds" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "credit_holds_lease_idx" ON "credit_holds" USING btree ("status","lease_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_ledger_idempotency_unique" ON "credit_ledger_entries" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "credit_ledger_wallet_created_idx" ON "credit_ledger_entries" USING btree ("wallet_id","created_at");--> statement-breakpoint
CREATE INDEX "credit_lots_allocation_idx" ON "credit_lots" USING btree ("wallet_id","expires_at","creation_order");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_wallets_user_unique" ON "credit_wallets" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gift_codes_hash_unique" ON "gift_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "gift_redemptions_code_user_ordinal_unique" ON "gift_redemptions" USING btree ("gift_code_id","user_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "dialogue_messages_session_sequence_unique" ON "dialogue_messages" USING btree ("session_id","sequence");--> statement-breakpoint
CREATE INDEX "dialogue_messages_claim_idx" ON "dialogue_messages" USING btree ("status","claim_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "dialogue_turn_player_npc_unique" ON "dialogue_sessions" USING btree ("turn_id","player_id","npc_character_id");--> statement-breakpoint
CREATE INDEX "dialogue_sessions_claim_idx" ON "dialogue_sessions" USING btree ("status","claim_expires_at");--> statement-breakpoint
CREATE INDEX "dialogue_sessions_thread_idx" ON "dialogue_sessions" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "character_claims_active_unique" ON "character_claims" USING btree ("game_id","character_id") WHERE "character_claims"."released_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "chronicle_turn_sequence_unique" ON "chronicle_entries" USING btree ("turn_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "game_invites_token_hash_unique" ON "game_invites" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "game_invites_game_idx" ON "game_invites" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "games_host_idx" ON "games" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "games_payment_status_idx" ON "games" USING btree ("payment_status");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_turn_player_unique" ON "orders" USING btree ("turn_id","player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "players_game_user_unique" ON "players" USING btree ("game_id","user_id") WHERE "players"."user_id" is not null;--> statement-breakpoint
CREATE INDEX "players_game_status_idx" ON "players" USING btree ("game_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "scenario_versions_scenario_version_unique" ON "scenario_versions" USING btree ("scenario_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "scenarios_author_slug_unique" ON "scenarios" USING btree ("author_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "turn_news_readiness_pk" ON "turn_news_readiness" USING btree ("turn_id","player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "turns_game_index_unique" ON "turns" USING btree ("game_id","index");--> statement-breakpoint
CREATE INDEX "turns_claimable_idx" ON "turns" USING btree ("status","claim_expires_at");--> statement-breakpoint
CREATE INDEX "turns_news_deadline_idx" ON "turns" USING btree ("status","news_deadline_at");