CREATE TABLE "scenario_map_assets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "owner_id" uuid,
  "object_key" text NOT NULL,
  "mime_type" text NOT NULL,
  "byte_size" bigint NOT NULL,
  "checksum" text NOT NULL,
  "feature_count" integer NOT NULL,
  "bounding_box" jsonb NOT NULL,
  "rights_confirmed_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "scenario_map_assets_object_key_unique" UNIQUE("object_key")
);
--> statement-breakpoint
ALTER TABLE "scenario_map_assets" ADD CONSTRAINT "scenario_map_assets_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "scenario_versions" ADD COLUMN "map_asset_id" uuid;
--> statement-breakpoint
ALTER TABLE "scenario_versions" ADD CONSTRAINT "scenario_versions_map_asset_id_scenario_map_assets_id_fk" FOREIGN KEY ("map_asset_id") REFERENCES "public"."scenario_map_assets"("id") ON DELETE restrict ON UPDATE no action;
