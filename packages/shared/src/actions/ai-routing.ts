import { z } from "zod";

// Operation routing (ADR-0029, docs/05).
//
// These live in packages/shared and not in packages/ai, which does not exist
// until M2, because they are the contract *between* feature code and the AI
// layer rather than part of it. Feature code asks for an operation; the pinned
// profile chooses the tier; the adapter decides what that tier means. A caller
// that could name a tier or a model would defeat all three.

export const AiOperationSchema = z.enum([
  "resolve_solo_turn",
  "assess_orders",
  "adjudicate",
  "propose_events",
  "narrate",
  "generate_frame",
  "generate_political",
  "generate_geography",
  "generate_cast",
  "generate_situation",
  "resolve_role",
  "crystallise",
  "resolve_contact",
  "dialogue_ordinary",
  "dialogue_principal",
  "extract_knowledge",
  // Character creation operations — executed locally in the web server (not worker).
  "declare_character",
  "confirm_character",
  // Orders pipeline — three-step chain: interpret → assess → adjudicate.
  "interpret_order",
  // World simulation — Near (player's polity), Far (adjacent polities), Coarse (distant polities).
  "propose_near_events",
  "propose_far_events",
  "propose_coarse_events",
]);
export type AiOperation = z.infer<typeof AiOperationSchema>;

export const AiTierSchema = z.enum(["basic", "standard", "premium"]);
export type AiTier = z.infer<typeof AiTierSchema>;

export const AiRouteSchema = z
  .object({
    tier: AiTierSchema,
    reasoning: z.enum(["none", "standard", "extended"]),
    maxInputTokens: z.number().int().positive(),
    maxOutputTokens: z.number().int().positive(),
    /** Per resolved turn. `assess_orders` is one call however many directives. */
    maxCalls: z.number().int().positive(),
  })
  .strict();
export type AiRoute = z.infer<typeof AiRouteSchema>;

/**
 * Immutable operator configuration. A match pins a version at creation.
 *
 * Every operation must be present: there is no implicit fallback, because an
 * operation that fell through to a default would be an unpriced call nobody
 * chose. The profile carries no credentials and no model IDs.
 */
export const AiRoutingProfileSchema = z
  .object({
    version: z.number().int().positive(),
    routes: z.record(AiOperationSchema, AiRouteSchema),
  })
  .strict()
  .superRefine((profile, context) => {
    const missing = AiOperationSchema.options.filter((operation) => profile.routes[operation] === undefined);
    if (missing.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["routes"],
        message: `A routing profile must map every operation; missing: ${missing.join(", ")}.`,
      });
    }
  });
export type AiRoutingProfile = z.infer<typeof AiRoutingProfileSchema>;
