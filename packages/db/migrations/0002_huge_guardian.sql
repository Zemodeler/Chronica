ALTER TABLE "players" ADD COLUMN "auto_pass" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "standing_order" jsonb;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "watch_conditions" jsonb DEFAULT '[]'::jsonb NOT NULL;