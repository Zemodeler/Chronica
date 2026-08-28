-- Better Auth 1.7 keys identities by issuer and account ID. Preserve existing
-- local credentials and OAuth accounts while bringing earlier rows forward.
ALTER TABLE "auth_accounts" ADD COLUMN IF NOT EXISTS "issuer" text;--> statement-breakpoint
UPDATE "auth_accounts"
SET "issuer" = CASE
  WHEN "provider_id" = 'credential' THEN 'local:credential'
  ELSE 'oauth:' || "provider_id"
END
WHERE "issuer" IS NULL;--> statement-breakpoint
ALTER TABLE "auth_accounts" ALTER COLUMN "issuer" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "auth_accounts_issuer_account_unique" ON "auth_accounts" USING btree ("issuer","account_id");
