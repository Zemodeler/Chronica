import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { games } from "./game";

export const productKind = pgEnum("billing_product_kind", ["pack", "subscription"]);
export const billingEventState = pgEnum("billing_event_state", ["pending", "claimed", "processed", "failed", "quarantined"]);
export const ledgerKind = pgEnum("credit_ledger_kind", ["grant", "hold", "settle", "release", "expire", "reversal", "adjustment"]);
export const holdStatus = pgEnum("credit_hold_status", ["active", "settled", "released", "expired"]);

export const billingCustomers = pgTable("billing_customers", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  providerCustomerRef: text("provider_customer_ref").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("billing_customers_user_unique").on(table.userId), uniqueIndex("billing_customers_provider_unique").on(table.providerCustomerRef)]);

export const billingProducts = pgTable("billing_products", {
  slug: text("slug").primaryKey(),
  kind: productKind("kind").notNull(),
  active: boolean("active").notNull().default(true),
  providerPriceRef: text("provider_price_ref").notNull(),
  currency: text("currency").notNull(),
  priceMinorUnits: bigint("price_minor_units", { mode: "bigint" }).notNull(),
  grantMicrocredits: bigint("grant_microcredits", { mode: "bigint" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const billingSubscriptions = pgTable("billing_subscriptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  providerSubscriptionRef: text("provider_subscription_ref").notNull(),
  productSlug: text("product_slug").notNull().references(() => billingProducts.slug),
  providerUpdatedAt: timestamp("provider_updated_at", { withTimezone: true }).notNull(),
  state: text("state").notNull(),
  currentPeriodStartsAt: timestamp("current_period_starts_at", { withTimezone: true }),
  currentPeriodEndsAt: timestamp("current_period_ends_at", { withTimezone: true }),
}, (table) => [uniqueIndex("billing_subscriptions_provider_unique").on(table.providerSubscriptionRef), index("billing_subscriptions_user_idx").on(table.userId)]);

export const billingEvents = pgTable("billing_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  providerEventRef: text("provider_event_ref").notNull(),
  type: text("type").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  normalizedPayload: jsonb("normalized_payload").notNull().$type<unknown>(),
  rawBodyHash: text("raw_body_hash").notNull(),
  processingState: billingEventState("processing_state").notNull().default("pending"),
  error: text("error"),
  claimedBy: text("claimed_by"),
  claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("billing_events_provider_unique").on(table.providerEventRef), index("billing_events_claim_idx").on(table.processingState, table.claimExpiresAt)]);

export const creditWallets = pgTable("credit_wallets", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  availableMicrocredits: bigint("available_microcredits", { mode: "bigint" }).notNull().default(sql`0`),
  heldMicrocredits: bigint("held_microcredits", { mode: "bigint" }).notNull().default(sql`0`),
  debtMicrocredits: bigint("debt_microcredits", { mode: "bigint" }).notNull().default(sql`0`),
  version: integer("version").notNull().default(1),
}, (table) => [
  uniqueIndex("credit_wallets_user_unique").on(table.userId),
  check("credit_wallets_available_non_negative", sql`${table.availableMicrocredits} >= 0`),
]);

export const creditLots = pgTable("credit_lots", {
  id: uuid("id").defaultRandom().primaryKey(),
  walletId: uuid("wallet_id").notNull().references(() => creditWallets.id, { onDelete: "cascade" }),
  sourceKind: text("source_kind").notNull(),
  sourceRef: text("source_ref").notNull(),
  grantedMicrocredits: bigint("granted_microcredits", { mode: "bigint" }).notNull(),
  remainingMicrocredits: bigint("remaining_microcredits", { mode: "bigint" }).notNull(),
  heldMicrocredits: bigint("held_microcredits", { mode: "bigint" }).notNull().default(sql`0`),
  grantedAt: timestamp("granted_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  creationOrder: bigint("creation_order", { mode: "bigint" }).notNull(),
}, (table) => [index("credit_lots_allocation_idx").on(table.walletId, table.expiresAt, table.creationOrder)]);

export const creditHolds = pgTable("credit_holds", {
  id: uuid("id").defaultRandom().primaryKey(),
  walletId: uuid("wallet_id").notNull().references(() => creditWallets.id),
  gameId: uuid("game_id").references(() => games.id),
  workId: text("work_id").notNull(),
  maximumMicrocredits: bigint("maximum_microcredits", { mode: "bigint" }).notNull(),
  lotAllocation: jsonb("lot_allocation").notNull().$type<unknown>(),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  status: holdStatus("status").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("credit_holds_work_idempotency_unique").on(table.idempotencyKey), index("credit_holds_lease_idx").on(table.status, table.leaseExpiresAt)]);

export const creditLedgerEntries = pgTable("credit_ledger_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  walletId: uuid("wallet_id").notNull().references(() => creditWallets.id),
  kind: ledgerKind("kind").notNull(),
  signedMicrocredits: bigint("signed_microcredits", { mode: "bigint" }).notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  sourceRef: text("source_ref"),
  gameId: uuid("game_id").references(() => games.id),
  workId: text("work_id"),
  holdId: uuid("hold_id").references(() => creditHolds.id),
  balanceAfterMicrocredits: bigint("balance_after_microcredits", { mode: "bigint" }).notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("credit_ledger_idempotency_unique").on(table.idempotencyKey), index("credit_ledger_wallet_created_idx").on(table.walletId, table.createdAt)]);

export const creditRateCards = pgTable("credit_rate_cards", {
  version: integer("version").primaryKey(),
  effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull(),
  rates: jsonb("rates").notNull().$type<unknown>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const giftCodes = pgTable("gift_codes", {
  id: uuid("id").defaultRandom().primaryKey(),
  codeHash: text("code_hash").notNull(),
  grantMicrocredits: bigint("grant_microcredits", { mode: "bigint" }).notNull(),
  codeExpiresAt: timestamp("code_expires_at", { withTimezone: true }),
  grantedCreditsExpireAt: timestamp("granted_credits_expire_at", { withTimezone: true }),
  maxRedemptions: integer("max_redemptions").notNull(),
  perAccountLimit: integer("per_account_limit").notNull().default(1),
  state: text("state").notNull().default("active"),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  auditNote: text("audit_note").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("gift_codes_hash_unique").on(table.codeHash)]);

export const giftRedemptions = pgTable("gift_redemptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  giftCodeId: uuid("gift_code_id").notNull().references(() => giftCodes.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  ordinal: integer("ordinal").notNull(),
  creditLotId: uuid("credit_lot_id").notNull().references(() => creditLots.id),
  redeemedAt: timestamp("redeemed_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("gift_redemptions_code_user_ordinal_unique").on(table.giftCodeId, table.userId, table.ordinal)]);

export const aiCalls = pgTable("ai_calls", {
  id: uuid("id").defaultRandom().primaryKey(),
  gameId: uuid("game_id").notNull().references(() => games.id),
  payerUserId: uuid("payer_user_id").notNull().references(() => users.id),
  operation: text("operation").notNull(),
  routingProfileVersion: integer("routing_profile_version").notNull(),
  rateCardVersion: integer("rate_card_version").notNull(),
  inputTokens: integer("input_tokens").notNull(),
  outputTokens: integer("output_tokens").notNull(),
  cacheReadTokens: integer("cache_read_tokens").notNull(),
  cacheWriteTokens: integer("cache_write_tokens").notNull(),
  providerCostMicroUnits: bigint("provider_cost_micro_units", { mode: "bigint" }).notNull(),
  coinChargeMicroUnits: bigint("coin_charge_micro_units", { mode: "bigint" }).notNull(),
  holdId: uuid("hold_id").notNull().references(() => creditHolds.id),
  workId: text("work_id").notNull(),
  outcome: text("outcome").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("ai_calls_idempotency_unique").on(table.idempotencyKey),
  index("ai_calls_game_created_idx").on(table.gameId, table.createdAt),
]);
