ALTER TABLE "credit_wallets" ADD CONSTRAINT "credit_wallets_available_non_negative" CHECK ("credit_wallets"."available_microcredits" >= 0);
