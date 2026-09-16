import { z } from "zod";

/**
 * Every coin-gated model call the engine makes.
 *
 * The first group is the Chat NPC system's own calls. The second is the
 * simulation loop's, and there are deliberately only three of them: VISION §29
 * budgets a normal player interaction at two to four major model calls, so
 * every stage that could be deterministic is (attention routing, arithmetic,
 * scheduling, pressure), and the ones that remain are the ones that genuinely
 * need judgment.
 */
export const AiOperationSchema = z.enum([
  "resolve_contact",
  "enrich_npc_profile",
  "dialogue_ordinary",
  "dialogue_principal",
  "extract_knowledge",
  "propose_social_events",
  "declare_character",
  "confirm_character",
  /** Reads the player's intent and proposes what the world does about it. */
  "simulate_orchestrate",
  /** One batched call answering for every actor the attention router selected. */
  "simulate_cognition",
  /** Writes the player's Chronicle, from what they could actually know. */
  "compose_chronicle",
]);
export type AiOperation = z.infer<typeof AiOperationSchema>;

/** Bundled assets only: a stored key can never become an arbitrary URL. */
export const AvatarKeySchema = z.enum([
  "laurel",
  "owl",
  "lion",
  "horse",
  "ship",
  "tower",
]);
export type AvatarKey = z.infer<typeof AvatarKeySchema>;

export const AccountRoleSchema = z.enum(["user", "developer", "admin"]);
export type AccountRole = z.infer<typeof AccountRoleSchema>;

export const CoinAmountStringSchema = z
  .string()
  .regex(/^\d+(?:\.\d{1,6})?$/, "Coin amounts must use at most six decimal places.")
  .refine((value) => {
    const [whole = "0", fraction = ""] = value.split(".");
    return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0")) <= 1_000_000_000_000n;
  }, "Coin amounts cannot exceed 1,000,000 coins.");

export const ProfileUpdateSchema = z.object({
  displayName: z.string().trim().min(2).max(80),
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,30}$/).or(z.literal("")),
  avatarKey: AvatarKeySchema,
}).strict();
export type ProfileUpdate = z.infer<typeof ProfileUpdateSchema>;

export const DeveloperGiftCreateSchema = z.object({
  grantCoins: CoinAmountStringSchema,
  codeExpiresAt: z.string().datetime({ offset: true }).optional().or(z.literal("")),
  grantedCoinsExpireAt: z.string().datetime({ offset: true }).optional().or(z.literal("")),
  auditNote: z.string().trim().min(3).max(500),
}).strict();
export type DeveloperGiftCreate = z.infer<typeof DeveloperGiftCreateSchema>;

export const TokenUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
}).strict();
export type TokenUsage = z.infer<typeof TokenUsageSchema>;

export const CoinRateSchema = z.object({
  inputMicroUnitsPerMillionTokens: z.string().regex(/^\d+$/),
  outputMicroUnitsPerMillionTokens: z.string().regex(/^\d+$/),
  cacheReadMicroUnitsPerMillionTokens: z.string().regex(/^\d+$/),
  cacheWriteMicroUnitsPerMillionTokens: z.string().regex(/^\d+$/),
}).strict();

export const CoinRateCardSchema = z.object({
  version: z.number().int().positive(),
  rates: z.record(AiOperationSchema, CoinRateSchema),
}).strict();
export type CoinRateCard = z.infer<typeof CoinRateCardSchema>;
