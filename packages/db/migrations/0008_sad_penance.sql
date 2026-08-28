ALTER TABLE "auth_accounts" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;--> statement-breakpoint
ALTER TABLE "auth_sessions" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;--> statement-breakpoint
ALTER TABLE "auth_verifications" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;