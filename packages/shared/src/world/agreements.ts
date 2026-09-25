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
  /**
   * One power keeps its own government and another answers for it abroad.
   *
   * The kind this scenario is actually about and the only one it had no word
   * for. A city offered its own laws under somebody else's protection is not
   * an ally -- it is not an equal and has promised no army -- and it is not a
   * tributary, because it pays nothing. `messana-invites-a-protector` gates
   * the war that follows it, and what Messana was offered could be written in
   * a letter, accepted in a reply, and then recorded nowhere: the arrangement
   * that started the First Punic War left nothing standing in the world.
   *
   * Ordered like tribute, and for the same reason: the protected power is
   * named first, because which of the two is which is the whole of the terms.
   */
  "protectorate",
  /**
   * Leave to march an army across somebody else's land.
   *
   * Ordered like tribute: the power granted passage is named first, the host
   * second. It changes nothing a battle computes. What it changes is whether
   * the host has been wronged -- an army that crosses a border without it is
   * trespassing, the host hears of it, and the host may do something about it.
   */
  "military_access",
]);
export type PolityAgreementKind = z.infer<typeof PolityAgreementKindSchema>;

/**
 * Each kind as a noun a sentence can carry: "the military_access between Rome
 * and the Ardiaei" is what a raw id reads like when it reaches a Chronicle.
 */
export const AGREEMENT_KIND_IN_WORDS: Record<PolityAgreementKind, string> = {
  war: "war",
  truce: "truce",
  peace: "peace",
  alliance: "alliance",
  non_aggression: "pact of non-aggression",
  tributary: "tributary arrangement",
  trade_pact: "trade pact",
  protectorate: "protectorate",
  military_access: "grant of passage for armies",
};

export const PolityAgreementSchema = z
  .object({
    id: EntityIdSchema,
    kind: PolityAgreementKindSchema,
    /**
     * The two parties. Unordered for every kind but two: a tributary agreement
     * runs from the tributary to the power it pays, and a protectorate from
     * the protected power to its protector, so the order is the terms.
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

/**
 * Whether `moverPolityId`'s armies may stand on `hostPolityId`'s ground without
 * wronging it: at war (it is enemy ground, and trespass is the least of it),
 * allied, protecting or protected, or granted passage. Anything else is a
 * border crossed without leave.
 */
export function mayEnterWithoutLeave(
  agreements: readonly PolityAgreement[],
  moverPolityId: string,
  hostPolityId: string,
): boolean {
  if (moverPolityId === hostPolityId) return true;
  return agreementsBetween(agreements, moverPolityId, hostPolityId).some((agreement) =>
    agreement.kind === "war"
    || agreement.kind === "alliance"
    || agreement.kind === "protectorate"
    || (agreement.kind === "military_access" && agreement.polityId === moverPolityId));
}
