import { z } from "zod";
import { ElapsedStepSchema, EntityIdSchema, VisibilitySchema } from "../material-state";

/**
 * What two powers have standing between them (VISION §3, §27).
 *
 * Before this, the world held a trust score and nothing else, so "are Rome and
 * Carthage at war?" could not be answered from state at all -- only inferred
 * from prose, from whether armies happened to be fighting, and from a number
 * between -100 and 100. §3 puts treaty continuity squarely under what software
 * owns and §27 asks the orchestrator's slice to carry active wars; neither was
 * true.
 *
 * A war is a record like any other. What makes it a war is its kind, which is
 * why peace, alliance and tribute live here too: they are the same shape of
 * fact about two powers, they begin and end the same way, and a system that
 * modelled war alone would need a second one the moment anybody made peace.
 *
 * Deliberately not scored. How much a power *likes* another is `PolityStance`
 * and moves constantly; what they have *agreed* is this, and changes only when
 * somebody changes it.
 */

export const PolityAgreementKindSchema = z.enum([
  "war",
  "truce",
  "peace",
  "alliance",
  "non_aggression",
  "tributary",
  "trade_pact",
]);
export type PolityAgreementKind = z.infer<typeof PolityAgreementKindSchema>;

export const PolityAgreementSchema = z
  .object({
    id: EntityIdSchema,
    kind: PolityAgreementKindSchema,
    /**
     * The two parties. Unordered for every kind but one: a tributary agreement
     * runs from the tributary to the power it pays, so the order is the terms.
     */
    polityId: EntityIdSchema,
    otherPolityId: EntityIdSchema,
    /** What was agreed, or what the war is over, in plain language. */
    terms: z.string().trim().min(1).max(600),
    sinceStep: ElapsedStepSchema,
    /** A dated truce ends by itself; everything else runs until somebody ends it. */
    untilStep: ElapsedStepSchema.nullable().default(null),
    /** The letter that produced it, where one did. */
    sourceMessageId: EntityIdSchema.nullable().default(null),
    status: z.enum(["active", "ended"]).default("active"),
    endedAtStep: ElapsedStepSchema.nullable().default(null),
    endedReason: z.string().trim().min(1).max(300).nullable().default(null),
    visibility: VisibilitySchema.default("public"),
  })
  .strict()
  .refine((agreement) => agreement.polityId !== agreement.otherPolityId, {
    message: "A power holds no agreement with itself.",
    path: ["otherPolityId"],
  });
export type PolityAgreement = z.infer<typeof PolityAgreementSchema>;

const between = (agreement: PolityAgreement, a: string, b: string): boolean =>
  (agreement.polityId === a && agreement.otherPolityId === b) || (agreement.polityId === b && agreement.otherPolityId === a);

/** Every standing agreement between two powers, newest first. */
export function agreementsBetween(agreements: readonly PolityAgreement[], a: string, b: string): PolityAgreement[] {
  return agreements
    .filter((agreement) => agreement.status === "active" && between(agreement, a, b))
    .sort((first, second) => second.sinceStep - first.sinceStep);
}

/**
 * Are these two at war?
 *
 * The question the rest of the engine actually asks: whether an engagement is
 * a battle or an atrocity, whether a trade route is cut, whether a neighbour
 * has reason to care.
 */
export function atWar(agreements: readonly PolityAgreement[], a: string, b: string): boolean {
  return agreementsBetween(agreements, a, b).some((agreement) => agreement.kind === "war");
}

/** Every power this one is at war with. */
export function enemiesOf(agreements: readonly PolityAgreement[], polityId: string): string[] {
  return [
    ...new Set(
      agreements
        .filter((agreement) => agreement.status === "active" && agreement.kind === "war")
        .filter((agreement) => agreement.polityId === polityId || agreement.otherPolityId === polityId)
        .map((agreement) => (agreement.polityId === polityId ? agreement.otherPolityId : agreement.polityId)),
    ),
  ];
}

/**
 * Closes a dated truce whose day has come.
 *
 * Deterministic, so the tick can run it: a truce that expires only when
 * somebody remembers to end it is a peace, which is not what was agreed.
 */
export function expireDatedAgreements(agreements: readonly PolityAgreement[], atStep: number): PolityAgreement[] {
  return agreements.map((agreement) =>
    agreement.status === "active" && agreement.untilStep !== null && agreement.untilStep <= atStep
      ? { ...agreement, status: "ended" as const, endedAtStep: atStep, endedReason: "Its term ran out." }
      : agreement,
  );
}
