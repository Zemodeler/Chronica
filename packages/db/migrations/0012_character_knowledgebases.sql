CREATE TABLE "character_knowledgebases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"character_id" text NOT NULL,
	"knowledgebase" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_knowledgebases_game_player_unique" UNIQUE("game_id","player_id")
);

ALTER TABLE "character_knowledgebases" ADD CONSTRAINT "character_knowledgebases_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "character_knowledgebases" ADD CONSTRAINT "character_knowledgebases_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;
