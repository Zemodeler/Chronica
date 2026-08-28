CREATE TABLE "player_game_ui_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"generated_cast" jsonb,
	"selected_thread_id" text,
	"chronicle_read_sequence" integer DEFAULT -1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "character_claims" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "character_claims" ADD COLUMN "introduced_at_turn_id" uuid;--> statement-breakpoint
ALTER TABLE "character_claims" ADD COLUMN "claimed_by" text;--> statement-breakpoint
ALTER TABLE "character_claims" ADD COLUMN "claim_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "turns" ADD COLUMN "changed_region_ids" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "player_game_ui_state" ADD CONSTRAINT "player_game_ui_state_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_game_ui_state" ADD CONSTRAINT "player_game_ui_state_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "player_game_ui_state_game_player_unique" ON "player_game_ui_state" USING btree ("game_id","player_id");--> statement-breakpoint
ALTER TABLE "character_claims" ADD CONSTRAINT "character_claims_introduced_at_turn_id_turns_id_fk" FOREIGN KEY ("introduced_at_turn_id") REFERENCES "public"."turns"("id") ON DELETE no action ON UPDATE no action;