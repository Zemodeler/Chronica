import { z } from "zod";
import { ElapsedStepSchema, EntityIdSchema, VisibilitySchema } from "../material-state";
import type { Character, RelationCause, RelationDimension } from "./character";

// Multidimensional social graph (character-sim phase 2).
//
// Every dimension here is derived from the existing cause ledger, never
// stored as a bare aggregate -- the same rule `computeOpinion` (Phase 1)
// already follows. This module only adds more dimensions to fold causes
// into, plus typed social links alongside the causal ledger.

/** Legacy rule: a cause authored before phase 2 (no `dimensions` map) counts entirely toward affection. */
const LEGACY_DIMENSION: RelationDimension = "affection";

function causeContribution(cause: RelationCause, dimension: RelationDimension): number {
  if (cause.dimensions !== undefined) return cause.dimensions[dimension] ?? 0;
  return dimension === LEGACY_DIMENSION ? cause.score : 0;
}

/** `subject`'s standing with `targetCharacterId` on one dimension, folded from directed causes. */
export function deriveRelationDimension(
  subject: Pick<Character, "relations">,
  targetCharacterId: string,
  dimension: RelationDimension,
): number {
  const relation = subject.relations.find((r) => r.subjectCharacterId === targetCharacterId);
  if (relation === undefined) return 0;
  const total = relation.causes.reduce((sum, cause) => sum + causeContribution(cause, dimension), 0);
  return Math.max(-100, Math.min(100, total));
}

/**
 * Public reputation is not directed at one observer -- it aggregates every
 * public-visibility cause anyone holds that names this character as its
 * target, i.e. what is generally known/said about them.
 */
export function deriveReputation(world: { readonly characters: readonly Character[] }, characterId: string): number {
  let total = 0;
  for (const character of world.characters) {
    const relation = character.relations.find((r) => r.subjectCharacterId === characterId);
    if (relation === undefined) continue;
    for (const cause of relation.causes) {
      total += causeContribution(cause, "reputation");
    }
  }
  return Math.max(-100, Math.min(100, total));
}

const DIMENSION_LABELS: Record<RelationDimension, readonly [string, string, string]> = {
  trust: ["wary", "neutral", "trusting"],
  affection: ["cold", "neutral", "fond"],
  fear: ["unafraid", "wary", "fearful"],
  respect: ["dismissive", "neutral", "respectful"],
  obligation: ["unbound", "neutral", "indebted"],
  reputation: ["ill-regarded", "unremarkable", "well-regarded"],
};

/** A readable label for one dimension's score, for dialogue/UI presentation. */
export function relationshipLabelFor(dimension: RelationDimension, score: number): string {
  const [low, mid, high] = DIMENSION_LABELS[dimension];
  if (score <= -30) return low;
  if (score >= 30) return high;
  return mid;
}

/** The strongest causes behind `subject`'s standing toward `targetCharacterId` on one dimension. */
export function strongestCauses(
  subject: Pick<Character, "relations">,
  targetCharacterId: string,
  dimension: RelationDimension,
  limit = 3,
): readonly RelationCause[] {
  const relation = subject.relations.find((r) => r.subjectCharacterId === targetCharacterId);
  if (relation === undefined) return [];
  return [...relation.causes]
    .sort((a, b) => Math.abs(causeContribution(b, dimension)) - Math.abs(causeContribution(a, dimension)))
    .slice(0, limit)
    .filter((cause) => causeContribution(cause, dimension) !== 0);
}

export const SocialLinkKindSchema = z.enum([
  "kin", "spouse", "friend", "patron", "client", "rival",
  "commander", "subordinate", "creditor", "debtor", "ally", "enemy",
]);
export type SocialLinkKind = z.infer<typeof SocialLinkKindSchema>;

export const SocialLinkSchema = z
  .object({
    id: EntityIdSchema,
    subjectCharacterId: EntityIdSchema,
    targetCharacterId: EntityIdSchema,
    kind: SocialLinkKindSchema,
    sourceEventId: EntityIdSchema.nullable(),
    createdAtStep: ElapsedStepSchema,
    visibility: VisibilitySchema,
  })
  .strict();
export type SocialLink = z.infer<typeof SocialLinkSchema>;

export interface SocialGraphView {
  readonly socialLinks: readonly SocialLink[];
}

/** Every typed social link naming `characterId` as either party. Multiple simultaneous kinds are normal. */
export function listSocialLinks(world: SocialGraphView, characterId: string): readonly SocialLink[] {
  return world.socialLinks.filter((link) => link.subjectCharacterId === characterId || link.targetCharacterId === characterId);
}

export type RelationshipModifyingAct = "favour" | "insult" | "betrayal" | "threat" | "promise";

const ACT_DIMENSION: Record<RelationshipModifyingAct, RelationDimension> = {
  favour: "affection",
  insult: "affection",
  betrayal: "trust",
  threat: "fear",
  promise: "obligation",
};
const ACT_DIRECTION: Record<RelationshipModifyingAct, 1 | -1> = {
  favour: 1,
  insult: -1,
  betrayal: -1,
  threat: 1,
  promise: 1,
};

/**
 * Whether an act of this kind could plausibly still move the relevant
 * dimension -- false once it is already saturated in that direction, which is
 * what keeps "excessive relationship changes" unrepresentable rather than
 * merely discouraged (the same guard Phase 1 applies to raw relation scores).
 */
export function canModifyRelationship(
  act: RelationshipModifyingAct,
  subject: Pick<Character, "relations">,
  targetCharacterId: string,
): boolean {
  const dimension = ACT_DIMENSION[act];
  const direction = ACT_DIRECTION[act];
  const current = deriveRelationDimension(subject, targetCharacterId, dimension);
  return direction > 0 ? current < 100 : current > -100;
}
