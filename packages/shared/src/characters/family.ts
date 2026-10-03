import { z } from "zod";
import { ElapsedStepSchema, EntityIdSchema, InheritanceRuleSchema, VisibilitySchema } from "../material-state";
import { currentAgeYears, LifeStageSchema } from "./age";

// Family, household, and life-contract graph (character-sim phase 5).
//
// A separate, typed graph from `characters/relationship-dimensions.ts`'s
// `SocialLink` (which stays a lighter-weight, sentiment-adjacent tag, e.g.
// "kin"/"spouse"/"rival"). Family/household structure needs provenance,
// start/end steps, and reciprocal semantics `SocialLink` was never built to
// carry, and inheritance/succession/eligibility all need to query it
// precisely. Feelings stay wherever they already lived: this schema carries
// no score of its own -- private sentiment is still exactly
// `DirectedRelation`/`RelationCause` (Phase 1/2), untouched.

export const FamilyLinkKindSchema = z.enum([
  "parent",
  "child",
  "sibling",
  "spouse_or_partner",
  "guardian",
  "ward",
  "other_relative",
  "household_head",
  "household_member",
  "dependant",
  // Named, so a model's schema writes the list once (see `AgreementKind`).
]).meta({ id: "FamilyKind" });
export type FamilyLinkKind = z.infer<typeof FamilyLinkKindSchema>;

const RECIPROCAL_KIND: Record<FamilyLinkKind, FamilyLinkKind> = {
  parent: "child",
  child: "parent",
  sibling: "sibling",
  spouse_or_partner: "spouse_or_partner",
  guardian: "ward",
  ward: "guardian",
  other_relative: "other_relative",
  household_head: "household_member",
  household_member: "household_head",
  dependant: "dependant",
};

/** The kind that describes the same link from `relatedCharacterId`'s side. */
export function reciprocalFamilyLinkKind(kind: FamilyLinkKind): FamilyLinkKind {
  return RECIPROCAL_KIND[kind];
}

/**
 * One directed instance of kinship or household structure. `characterId` is
 * `kind` *of* `relatedCharacterId` -- e.g. `kind: "parent"` means
 * `characterId` is the parent, `relatedCharacterId` the child. Only one row
 * is stored per relationship; `familyLinksOf` resolves the reciprocal view so
 * nothing is ever double-stored or allowed to drift.
 */
export const FamilyLinkSchema = z
  .object({
    id: EntityIdSchema,
    characterId: EntityIdSchema,
    relatedCharacterId: EntityIdSchema,
    kind: FamilyLinkKindSchema,
    startedAtStep: ElapsedStepSchema,
    endedAtStep: ElapsedStepSchema.nullable().default(null),
    visibility: VisibilitySchema,
    provenanceEventId: EntityIdSchema.nullable().default(null),
  })
  .strict();
export type FamilyLink = z.infer<typeof FamilyLinkSchema>;

export const HouseholdSchema = z
  .object({
    id: EntityIdSchema,
    name: z.string().trim().min(1).max(120),
    polityId: EntityIdSchema.nullable(),
    headCharacterId: EntityIdSchema.nullable(),
    active: z.boolean(),
  })
  .strict();
export type Household = z.infer<typeof HouseholdSchema>;

export interface FamilyGraphView {
  readonly familyLinks: readonly FamilyLink[];
}

/** One entry in a resolved, direction-agnostic family-graph query. */
export interface FamilyLinkView {
  readonly counterpartCharacterId: string;
  readonly kind: FamilyLinkKind;
  readonly link: FamilyLink;
}

/** Every currently-active family/household tie naming `characterId`, from either side. */
export function familyLinksOf(world: FamilyGraphView, characterId: string, atStep?: number): readonly FamilyLinkView[] {
  const views: FamilyLinkView[] = [];
  for (const link of world.familyLinks) {
    if (link.endedAtStep !== null && atStep !== undefined && link.endedAtStep <= atStep) continue;
    if (link.endedAtStep !== null && atStep === undefined) continue;
    if (link.characterId === characterId) {
      views.push({ counterpartCharacterId: link.relatedCharacterId, kind: link.kind, link });
    } else if (link.relatedCharacterId === characterId) {
      views.push({ counterpartCharacterId: link.characterId, kind: reciprocalFamilyLinkKind(link.kind), link });
    }
  }
  return views;
}

/** The youngest a bride and a groom may be: twelve and fourteen, as Roman law had it. */
export const MARRIAGE_AGE = { female: 12, male: 14 } as const;

/** What a marriage asks of the two people in it, and of the world around them. */
export interface MarriageView extends FamilyGraphView {
  readonly elapsedStep: number;
  readonly characters: readonly {
    readonly id: string;
    readonly name: string;
    readonly alive: boolean;
    readonly gender: "male" | "female";
    readonly ageYearsAtStart: number;
    readonly birthStep: number | null;
  }[];
  readonly material: { readonly officeSeats: readonly { readonly officeId: string; readonly holderCharacterId: string | null; readonly status: string }[] };
}

/** Whether she is a Vestal: sworn to the goddess for thirty years, and nobody's to marry. */
export function isVestal(world: Pick<MarriageView, "material">, characterId: string): boolean {
  return world.material.officeSeats.some((seat) => seat.holderCharacterId === characterId && seat.status === "held" && /vestal/i.test(seat.officeId));
}

/**
 * Why these two cannot be married, or null if they can (play-test L10).
 *
 * A tie of marriage was written with no guard at all: a man could be made
 * the husband of a Vestal, of a girl of six, of his own sister, of a second
 * wife beside the first, or of another man. Both living, a man and a woman,
 * old enough, neither married already, not near kin, and not a Vestal.
 */
export function marriageBar(world: MarriageView, aId: string, bId: string): string | null {
  const a = world.characters.find((character) => character.id === aId);
  const b = world.characters.find((character) => character.id === bId);
  if (a === undefined || b === undefined) return "one of them does not exist";
  if (!a.alive || !b.alive) return `${!a.alive ? a.name : b.name} is dead`;
  if (a.gender === b.gender) return `${a.name} and ${b.name} are both ${a.gender === "male" ? "men" : "women"}`;
  for (const person of [a, b]) {
    const age = currentAgeYears(person, world.elapsedStep);
    if (age < MARRIAGE_AGE[person.gender]) return `${person.name} is ${age}, too young to marry`;
    if (isVestal(world, person.id)) return `${person.name} is a Vestal, sworn to the goddess`;
    const spouse = familyLinksOf(world, person.id, world.elapsedStep).find((view) => view.kind === "spouse_or_partner" && view.counterpartCharacterId !== (person === a ? b.id : a.id));
    if (spouse !== undefined) return `${person.name} is married already`;
  }
  const near = familyLinksOf(world, a.id, world.elapsedStep).find((view) => view.counterpartCharacterId === b.id && (view.kind === "parent" || view.kind === "child" || view.kind === "sibling"));
  if (near !== undefined) return `${a.name} and ${b.name} are too near kin`;
  return null;
}

/** Every child of `characterId`: the counterpart of each link where `characterId` is the parent. */
export function childrenOf(world: FamilyGraphView, characterId: string): readonly string[] {
  return familyLinksOf(world, characterId)
    .filter((view) => view.kind === "parent")
    .map((view) => view.counterpartCharacterId);
}

// ---------------------------------------------------------------------------
// Marriage, partnership, guardianship, and household contracts.
// ---------------------------------------------------------------------------

export const LifeContractTypeSchema = z.enum([
  "marriage_or_partnership",
  "guardianship",
  "adoption_or_heir_designation",
  "household_membership",
]);
export type LifeContractType = z.infer<typeof LifeContractTypeSchema>;

export const LifeContractStatusSchema = z.enum(["active", "dissolved", "widowed", "separated"]);

/**
 * A scenario-configurable life contract: the social/legal fact, never an
 * implied sentiment. Reuses Phase 4's `EligibilityRequirement`/
 * `resolveEligibility` verbatim for "prerequisites and eligibility" and
 * "consent/authority requirements" -- no parallel eligibility system.
 */
export const LifeContractSchema = z
  .object({
    id: EntityIdSchema,
    type: LifeContractTypeSchema,
    partyCharacterIds: z.array(EntityIdSchema).min(1).max(4),
    institutionId: EntityIdSchema.nullable().default(null),
    eligibilityRequirementIds: z.array(EntityIdSchema).default([]),
    status: LifeContractStatusSchema,
    visibility: VisibilitySchema,
    startedAtStep: ElapsedStepSchema,
    endedAtStep: ElapsedStepSchema.nullable().default(null),
    sourceEventId: EntityIdSchema.nullable().default(null),
    resolutionReason: z.string().trim().max(400).nullable().default(null),
  })
  .strict();
export type LifeContract = z.infer<typeof LifeContractSchema>;

// ---------------------------------------------------------------------------
// Scenario-authored life rules.
// ---------------------------------------------------------------------------

export const ScenarioLifeRulesSchema = z
  .object({
    lifeStages: z.array(LifeStageSchema).default([]),
    inheritanceRules: z.array(InheritanceRuleSchema).default([]),
    reviewIntervalSteps: z.number().int().positive().max(3_660).default(4),
  })
  .strict();
export type ScenarioLifeRules = z.infer<typeof ScenarioLifeRulesSchema>;
