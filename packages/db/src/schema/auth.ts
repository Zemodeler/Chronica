import { sql } from "drizzle-orm";
import { boolean, index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", ["user", "developer", "admin"]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("display_name").notNull(),
  email: text("email").notNull(),
  emailVerified: boolean("email_verified").notNull().default(false),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  image: text("image"),
  avatarKey: text("avatar_key").notNull().default("laurel"),
  username: text("username"),
  role: userRole("role").notNull().default("user"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("users_email_unique").on(table.email),
  uniqueIndex("users_username_unique").on(sql`lower(${table.username})`),
]);

export const authSessions = pgTable("auth_sessions", {
  // Application-supplied by better-auth's adapter in normal operation; this
  // default is a fallback for whenever that generation doesn't reach the
  // insert (observed with @better-auth/drizzle-adapter 1.7.1's "uuid" id
  // strategy on the verification/session/account models), not the primary
  // source of truth.
  id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
  token: text("token").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
}, (table) => [
  uniqueIndex("auth_sessions_token_unique").on(table.token),
  index("auth_sessions_user_idx").on(table.userId),
  index("auth_sessions_expiry_idx").on(table.expiresAt),
]);

export const authAccounts = pgTable("auth_accounts", {
  // Application-supplied by better-auth's adapter in normal operation; this
  // default is a fallback for whenever that generation doesn't reach the
  // insert (observed with @better-auth/drizzle-adapter 1.7.1's "uuid" id
  // strategy on the verification/session/account models), not the primary
  // source of truth.
  id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  // Better Auth keys an identity by its issuer and provider account ID. This
  // distinguishes local credentials from similarly named OAuth identities.
  issuer: text("issuer").notNull(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("auth_accounts_issuer_account_unique").on(table.issuer, table.accountId),
  uniqueIndex("auth_accounts_provider_account_unique").on(table.providerId, table.accountId),
  index("auth_accounts_user_idx").on(table.userId),
]);

export const authVerifications = pgTable("auth_verifications", {
  // Application-supplied by better-auth's adapter in normal operation; this
  // default is a fallback for whenever that generation doesn't reach the
  // insert (observed with @better-auth/drizzle-adapter 1.7.1's "uuid" id
  // strategy on the verification/session/account models), not the primary
  // source of truth.
  id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("auth_verifications_identifier_idx").on(table.identifier),
  index("auth_verifications_expiry_idx").on(table.expiresAt),
]);

export const authRequestLimits = pgTable("auth_request_limits", {
  id: uuid("id").defaultRandom().primaryKey(),
  keyHash: text("key_hash").notNull(),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("auth_request_limits_key_time_idx").on(table.keyHash, table.requestedAt)]);
