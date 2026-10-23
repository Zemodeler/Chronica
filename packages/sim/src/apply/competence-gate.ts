import {
  ACT_WINDOW_DAYS,
  ACT_WORDS,
  DEFAULT_TAX_RATE_BPS,
  MAX_CUSTOMS_RATE_BPS,
  RIVAL_OPINION,
  SPENDING_YEAR_DAYS,
  actMarkOf,
  actWindowOpen,
  allOffices,
  coinageById,
  computeOpinion,
  economyOf,
  fitStrengthOf,
  mayAct,
  monthlyTakings,
  readDepartments,
  spendingAllowance,
  withActMark,
  type ActKind,
  type AuthorityCheckResult,
  type Office,
  type WorldDelta,
  type WorldState,
} from "@chronica/shared";
import { grainPrice } from "../grain";
import type { ApplyContext } from "./context";
import { SOVEREIGN_AGREEMENTS } from "./nobody-listens";
import { gravityOf, usurpedLately, type UsurpedAct } from "../usurpation";
import { safeLocalId } from "../safe-local-id";

/**
 * Who may do this act, asked of the constitution (docs/plans/government.md, "H0 as built").
 *
 * Authority used to be a list of orders an office was allowed (`authorisedActionIds`), and a guess from what the office
 * was called. An act outside the list was refused (`nobodyListens`) or recorded as a breach, and nothing said who
 * *should* decide it. Now, where the power has a constitution, the act's own competence is read from its parts
 * (`competenceOf`), and one of four things follows:
 *
 *  - **his own** (alone, or with a colleague who does not stop him): it is done, and the office is its authority
 *    whether or not a grant said so;
 *  - **a colleague's to stop**: a colleague of equal power who has interceded, or who thinks too ill of him to let it be,
 *    stops it (*par potestas*); and where one of them has settled the same matter this season, the other does not settle it
 *    again, unless his office is higher;
 *  - **the chamber's**: beyond his figure, or by the nature of the act, it is laid before the chamber that holds the power --
 *    the same way a war is (\`layBeforeTheChamber\`) -- and done the day it carries;
 *  - **none of his**: where he has a grant that says otherwise it is refused; where he has none, the engine answers as it
 *    always did.
 *
 * Acts the chamber has carried (\`sanctionedDeltas\`), and the fiscal officers' own, which the world's pass sanctions, are not
 * weighed again here: they are recorded (\`noteTheAct\`) so that the next man's act of the same kind finds the season taken.
 */

export type Gate =
  | { readonly kind: "authorize"; readonly authority: AuthorityCheckResult }
  | { readonly kind: "refuse"; readonly reason: string }
  /** Laid before the chamber: the motion is built here for a tax, a coin, a loan or a draw, and by `layBeforeTheChamber` for a treaty (null). */
  | { readonly kind: "refer"; readonly reason: string; readonly motion: WorldDelta | null; readonly usurp: UsurpedAct };

/** An act of the delta's, as the constitution has it: what it is, whose power's, and how large. */
interface Gated {
  readonly act: ActKind;
  readonly polityId: string;
  /** In the act's own unit (`WITHIN_UNIT`); undefined where there is no figure. */
  readonly magnitude: number | undefined;
  /** What a draw or a loan is for, as the motion says it. */
  readonly amount?: number;
  readonly label: string;
}

const AGREEMENT_ACT: Readonly<Record<string, ActKind>> = {
  war: "war", peace: "peace", alliance: "pacts", non_aggression: "pacts", tributary: "pacts", protectorate: "pacts", foedus: "pacts", trade_pact: "pacts", embargo: "embargoes",
};

const percent = (bps: number): string => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)} in a hundred`;

/** Months of what the power takes in that a sum comes to. A power that takes in nothing is asked for a sum it cannot give. */
function inMonths(world: WorldState, polityId: string, amount: number): number {
  const takings = monthlyTakings(world, polityId);
  return takings <= 0 ? (amount > 0 ? Number.POSITIVE_INFINITY : 0) : amount / takings;
}

/** The act a delta is, in the constitution's terms, or null where it is none of the twelve. */
export function gatedAct(delta: WorldDelta, world: WorldState, resolve: (ref: string) => string | undefined, actorPolityId: string | null = null): Gated | null {
  const id = (ref: string): string => resolve(ref) ?? ref;
  const ownerOfAccount = (ref: string | null | undefined): string | null => {
    if (ref == null) return null;
    const owner = world.material.accounts.find((account) => account.id === id(ref))?.owner;
    return owner?.kind === "polity" ? owner.id : null;
  };
  switch (delta.op) {
    case "tax_policy_set": {
      const polityId = id(delta.polityId);
      const memory = economyOf(world);
      if (delta.scope === "customs") {
        const now = memory.customsRates.find((entry) => entry.polityId === polityId)?.rateBps ?? 0;
        const wanted = Math.min(MAX_CUSTOMS_RATE_BPS, delta.rateBps);
        return { act: "customs", polityId, magnitude: wanted > now ? wanted : 0, label: `the customs of ${nameOf(world, polityId)} be laid at ${percent(wanted)}` };
      }
      const policy = memory.taxPolicies.find((entry) => entry.polityId === polityId)?.rateBps ?? DEFAULT_TAX_RATE_BPS;
      const provinceId = delta.scope === "province" && delta.provinceId !== null ? id(delta.provinceId) : null;
      const row = provinceId === null ? undefined : world.material.provinceMaterial.find((candidate) => candidate.provinceId === provinceId);
      const now = row?.taxRateBps ?? policy;
      // A tax of a kind the power did not lay before (the land levy turned into a tithe, a tribute of men into coin) is a new tax, and no
      // magistrate lays a new tax: it is the chamber's whatever the rate. Within custom, a rate is a magistrate's (Polybius 6.13, 6.14; docs/plans/government.md).
      const laidBefore = memory.taxPolicies.find((entry) => entry.polityId === polityId)?.regime;
      if (delta.scope === "polity" && laidBefore !== undefined && delta.regime !== laidBefore) {
        return { act: "tax_rate", polityId, magnitude: Number.POSITIVE_INFINITY, label: `the tribute of ${nameOf(world, polityId)} be laid anew, as a ${delta.regime.replace(/_/g, " ")} at ${percent(delta.rateBps)}` };
      }
      // Easing a rate is never beyond a man's competence: only asking more is the chamber's.
      return { act: "tax_rate", polityId, magnitude: delta.rateBps > now ? delta.rateBps : 0, label: `the tribute of ${nameOf(world, polityId)} be laid at ${percent(delta.rateBps)}` };
    }
    case "coinage_debase": {
      const coinage = coinageById(world, id(delta.coinageId));
      if (coinage === undefined || coinage.issuerPolityId === null) return null;
      const wanted = delta.targetSilverBps ?? Math.round((coinage.silverBps * (10_000 + (delta.stepBps ?? 0))) / 10_000);
      const step = Math.round((Math.abs(wanted - coinage.silverBps) * 10_000) / Math.max(1, coinage.silverBps));
      return { act: "coinage", polityId: coinage.issuerPolityId, magnitude: step, label: `${coinage.name} be struck with ${wanted < coinage.silverBps ? "less" : "more"} silver` };
    }
    case "loan_open": {
      const polityId = ownerOfAccount(delta.borrowerAccountRef);
      if (polityId === null) return null;
      return { act: "loans", polityId, magnitude: inMonths(world, polityId, delta.principal), amount: delta.principal, label: `${delta.principal} be borrowed in the name of ${nameOf(world, polityId)}` };
    }
    case "money_transfer": {
      const polityId = ownerOfAccount(delta.fromAccountRef);
      if (polityId === null) return null;
      return { act: "spending", polityId, magnitude: undefined, amount: delta.amount, label: `${delta.amount} be drawn from the treasury of ${nameOf(world, polityId)}` };
    }
    // Hiring men or ships is a draw on the chest as much as a payment is: what is promised for the term, and the advance.
    case "service_contract_open": {
      const polityId = ownerOfAccount(delta.employerAccountRef);
      if (polityId === null) return null;
      const months = Math.max(1, Math.round((delta.termDays ?? 90) / 30));
      const amount = delta.advance + delta.monthlyPay * months;
      return { act: "spending", polityId, magnitude: undefined, amount, label: `${amount} be promised from the treasury of ${nameOf(world, polityId)} to hire men` };
    }
    // Bread bought or sent for an army is spending from the chest of the power that pays (the army's, "army only": a consul's own word to his allowance); taken from the country it costs the chest nothing.
    case "force_provision": {
      if (delta.how === "requisition") return null;
      const force = world.material.forces.find((candidate) => candidate.id === id(delta.forceRef));
      if (force === undefined) return null;
      const paid = delta.payAccountRef == null ? undefined : world.material.accounts.find((account) => account.id === id(delta.payAccountRef!));
      if (paid !== undefined && !(paid.owner.kind === "polity" && paid.owner.id === force.polityId)) return null;
      const amount = Math.max(1, Math.round((fitStrengthOf(force) * delta.days / 1_000) * grainPrice(world, force.polityId, force.locationId)));
      return { act: "spending", polityId: force.polityId, magnitude: undefined, amount, label: `${amount} be drawn from the chest of ${nameOf(world, force.polityId)} for the bread of ${force.name}` };
    }
    // A work begun out of the chest is spending it, for all it is paid for in instalments.
    case "project_create": {
      const polityId = ownerOfAccount(delta.fundingAccountRef);
      if (polityId === null) return null;
      const amount = delta.milestones.reduce((sum, stage) => sum + stage.costAmount, 0);
      if (amount <= 0) return null;
      return { act: "spending", polityId, magnitude: undefined, amount, label: `${amount} be spent out of the chest of ${nameOf(world, polityId)} on ${delta.label}` };
    }
    // Calling the men out is the levy: a consul's with his colleague, a praetor's, the Elders' in Carthage.
    case "force_create": {
      if (delta.outlaw === true || delta.fromForceRef != null) return null;
      const polityId = id(delta.polityId);
      return { act: "levy", polityId, magnitude: undefined, label: `a levy be held in ${nameOf(world, polityId)}` };
    }
    case "public_benefaction": {
      if (delta.kind !== "dole") return null;
      const polityId = ownerOfAccount(delta.payerAccountRef);
      if (polityId === null) return null;
      return { act: "grain", polityId, magnitude: inMonths(world, polityId, delta.amount), amount: delta.amount, label: `${delta.amount} be spent on bread for the people of ${nameOf(world, polityId)}` };
    }
    case "agreement_open": {
      const act = AGREEMENT_ACT[delta.kind];
      if (act === undefined || !SOVEREIGN_AGREEMENTS.has(delta.kind)) return null;
      // Whichever side is the actor's own: a treaty is written with either power first.
      const sides = [id(delta.polityId), id(delta.otherPolityId)];
      const ours = sides.find((side) => side === actorPolityId) ?? sides[0]!;
      return { act, polityId: ours, magnitude: undefined, label: `${delta.kind.replace(/_/g, " ")} be made with ${nameOf(world, sides.find((side) => side !== ours) ?? ours)}` };
    }
    case "agreement_close": {
      const agreement = world.polityAgreements.find((candidate) => candidate.id === id(delta.agreementRef));
      if (agreement === undefined) return null;
      const act = AGREEMENT_ACT[agreement.kind];
      if (act === undefined || !SOVEREIGN_AGREEMENTS.has(agreement.kind)) return null;
      const ours = agreement.otherPolityId === actorPolityId ? agreement.otherPolityId : agreement.polityId;
      return { act: agreement.kind === "war" ? "peace" : act, polityId: ours, magnitude: undefined, label: `the ${agreement.kind.replace(/_/g, " ")} with ${nameOf(world, ours === agreement.polityId ? agreement.otherPolityId : agreement.polityId)} be ended` };
    }
    default:
      return null;
  }
}

const nameOf = (world: WorldState, polityId: string): string => world.map.polities.find((polity) => polity.id === polityId)?.name ?? polityId;

/** The concerns a motion about an act carries, so the blocs of the chamber lean by what each wants. */
const CONCERNS: Readonly<Record<ActKind, readonly string[]>> = {
  tax_rate: ["taxes"], customs: ["taxes", "trade"], coinage: ["coinage"], loans: ["spending"], grain: ["grain", "spending"],
  pacts: ["peace", "trade"], embargoes: ["trade"], levy: ["levy"], war: ["war"], peace: ["peace"], appointment: ["new_office"], spending: ["spending"],
};

/** The motion that lays an act before its chamber, put by the man who would have done it. */
function motionFor(world: WorldState, actorId: string, gated: Gated, bodyId: string, why: string): WorldDelta {
  const actor = world.characters.find((character) => character.id === actorId)!;
  return {
    op: "political_procedure_open",
    localId: safeLocalId(`motion_${gated.act}_${actorId}`).slice(0, 60),
    type: "council_deliberation",
    institutionRef: bodyId,
    sponsorCharacterRef: actorId,
    subjectKind: "polity",
    subjectRef: gated.polityId,
    label: `Motion of ${actor.name}: that ${gated.label}`.slice(0, 200),
    resolutionMechanism: "vote",
    deadlineInDays: 10,
    visibility: "public",
    enacts: null,
    concerns: [...CONCERNS[gated.act]],
    reason: why.slice(0, 240),
  } as WorldDelta;
}

export interface GateInput {
  readonly delta: WorldDelta;
  readonly written: WorldDelta;
  readonly world: WorldState;
  readonly context: ApplyContext;
  readonly resolve: (ref: string) => string | undefined;
  readonly authority: AuthorityCheckResult;
  /** The act is the player's order, so what is beyond it may be laid before the chamber for him. */
  readonly ofTheOrder: boolean;
}

/** The colleagues of equal power a man has in an office, alive and seated. */
function colleaguesOf(world: WorldState, officeId: string, actorId: string): string[] {
  return world.material.officeSeats
    .filter((seat) => seat.status === "held" && seat.officeId === officeId && seat.holderCharacterId !== null && seat.holderCharacterId !== actorId
      && world.characters.some((character) => character.id === seat.holderCharacterId && character.alive))
    .map((seat) => seat.holderCharacterId!);
}

/**
 * Weighs an act against the competence of the man who does it: null where the act is none of this layer's concern
 * (no constitution, not an act of the twelve, not his power's, not his to answer for), else what follows from it.
 */
export function competenceGate(input: GateInput): Gate | null {
  const { delta, world, context, resolve, authority } = input;
  if (context.actorRef.kind !== "character" || context.firingMechanic !== undefined) return null;
  // The world's own business, said apart from the order (a peace carried out, a promise falling due), is nobody's exercise of his charge.
  if (context.actsForTheWorld === true && !input.ofTheOrder) return null;
  // A treaty an accepted letter has already made binds by the letter (`bindTheAcceptance`).
  if (delta.op === "agreement_open" && delta.sourceMessageRef != null) return null;
  // The chamber has carried it: the vote is the authority, and the act is recorded as done.
  if (context.sanctionedDeltas?.has(input.written) === true) return null;
  const actor = world.characters.find((character) => character.id === context.actorRef.id && character.alive);
  // Men bought out of nowhere for his own power's army (no army they are drawn from) are a draw on the chest as much as a payment is:
  // the chamber that will not open it to a man who defied it does not hire for him either (a playtest hired 1,000 men the turn after
  // the walls were refused for exactly that).
  if (delta.op === "force_reinforce" && delta.fromForceRef === null && actor !== undefined && usurpedLately(world, actor.id)) {
    const force = world.material.forces.find((candidate) => candidate.id === (resolve(delta.forceRef) ?? delta.forceRef));
    if (force !== undefined && force.polityId === actor.polityId) {
      return { kind: "refuse", reason: `The ${world.material.institutions.find((institution) => institution.polityId === force.polityId && institution.advisory !== true)?.name ?? "chamber"} will not open the public chest to ${actor.name}, who did what it had not allowed: the money for hired men is not his to draw until it has forgiven him.` };
    }
  }
  const gated = gatedAct(delta, world, resolve, actor?.polityId ?? null);
  if (gated === null) return null;
  // A man acts for his own power only; another's is judged where it always was (`nobodyListens`).
  if (actor === undefined || actor.polityId !== gated.polityId) return null;
  const spend = gated.act === "spending";
  const offices = context.offices;
  const may = standingFor(world, actor.id, gated, offices);
  // A work begun at the state's cost by a man with no charge in it (no seat of any office, and not its head) is not his to begin: a soldier's word does not open the chest.
  if (may === null && delta.op === "project_create" && !world.material.officeSeats.some((seat) => seat.status === "held" && seat.holderCharacterId === actor.id)
    && !readDepartments(world).rulers(gated.polityId).some((ruler) => ruler.id === actor.id)) {
    return { kind: "refuse", reason: `${actor.name} holds no charge in ${nameOf(world, gated.polityId)}: the public chest is opened on a magistrate's word, not a private man's, and works are not raised at the state's cost on his.` };
  }
  if (may === null) return null;
  const deed = ACT_WORDS[gated.act];
  // The chamber that was not asked votes him nothing: what he draws on the public chest after doing a great act without its leave is refused (`usurpation.ts`).
  if (spend && usurpedLately(world, actor.id)) {
    return { kind: "refuse", reason: `The ${world.material.institutions.find((institution) => institution.polityId === gated.polityId && institution.advisory !== true)?.name ?? "chamber"} will not open the public chest to ${actor.name}, who did what it had not allowed: the money is not his to draw until it has forgiven him.` };
  }

  switch (may.grade) {
    case "forbidden":
      // Where nothing of his gave him the act, the engine answers as it did; where a grant did, the constitution says it is not his.
      return authority.authorized ? { kind: "refuse", reason: may.why } : null;
    case "by_the_body": {
      const body = may.body;
      if (body === null) return { kind: "refuse", reason: may.why };
      // The chamber has already voted this money to him: spending it is the vote carried out, not a second question for the chamber.
      if (spend && authority.authorized && authority.grant?.source === "law" && authority.grant.cap !== undefined) return null;
      // A vote that is spent down says so, instead of moving the same money again.
      if (spend && authority.grant === null && authority.reason.startsWith("The vote (")) return { kind: "refuse", reason: authority.reason };
      // Treaties are laid by the same path a war is (`layBeforeTheChamber`), which is how an unauthorised man's already go; only an authorised man's come here.
      const treaty = delta.op === "agreement_open" || delta.op === "agreement_close";
      if (treaty && !authority.authorized) return null;
      const motion = treaty ? null : motionFor(world, actor.id, gated, body.id, `${actor.name} may not decide it alone, and moved it in the ${body.name}.`);
      return { kind: "refer", reason: may.why, motion, usurp: { act: gated.act, polityId: gated.polityId, label: gated.label, gravity: gravityOf(gated.act, delta), officeId: may.officeId, officeLabel: may.officeLabel, bodyId: body.id } };
    }
    case "alone":
    case "with_colleague": {
      const now = world.elapsedStep;
      const mark = actMarkOf(world.actMarks, gated.polityId, gated.act, spend ? may.officeId : null);
      if (mark !== undefined && actWindowOpen(mark, now) && mark.byCharacterId !== actor.id) {
        const all = allOffices(world, offices);
        const mine = all.find((office) => office.id === may.officeId)?.rank ?? 0;
        const theirs = mark.byOfficeId === null ? Number.POSITIVE_INFINITY : all.find((office) => office.id === mark.byOfficeId)?.rank ?? 0;
        if (theirs >= mine) {
          const who = mark.byCharacterId === null ? "the chamber" : world.characters.find((character) => character.id === mark.byCharacterId)?.name ?? "another";
          return { kind: "refuse", reason: `${who} settled this ${now - mark.atStep} days ago${mark.byCharacterId === null ? " by decree" : ""}, and it is not decided twice in a season: ${actor.name} may not ${deed} again until it is out.` };
        }
      }
      if (may.grade === "with_colleague") {
        for (const colleagueId of colleaguesOf(world, may.officeId, actor.id)) {
          const colleague = world.characters.find((character) => character.id === colleagueId)!;
          if (computeOpinion(colleague, actor.id) <= RIVAL_OPINION) {
            return { kind: "refuse", reason: `${colleague.name}, who holds the same office as ${actor.name} and thinks ill of him, would not let it be: either may act, and the other may stop it, and he stopped it.` };
          }
        }
      }
      if (authority.authorized) return null;
      return { kind: "authorize", authority: { authorized: true, grant: null, standing: "lawful", reason: may.why } };
    }
  }
}

/**
 * What a man may do about this act, of all the offices he holds. A draw is weighed against the year's allowance: months of
 * the power's takings, the sum already drawn counted in.
 */
function standingFor(world: WorldState, actorId: string, gated: Gated, offices: readonly Office[]): ReturnType<typeof mayAct> {
  if (gated.act !== "spending") return mayAct(world, actorId, gated.act, { offices, ...(gated.magnitude === undefined ? {} : { magnitude: gated.magnitude }) });
  const first = mayAct(world, actorId, "spending", { offices });
  if (first === null) return null;
  const allowance = spendingAllowance(world, first.officeId, offices);
  const months = allowance === null || allowance.amount === null ? 0 : inMonths(world, gated.polityId, allowance.spent + (gated.amount ?? 0));
  return mayAct(world, actorId, "spending", { offices, magnitude: months });
}

/**
 * Writes down who decided what, after an act is done: the memory behind "one decider to a season" and a year's allowance.
 * Done for every act of the twelve that changed the world, whoever's, so the fiscal officers' own are counted too.
 */
export function noteTheAct(before: WorldState, after: WorldState, delta: WorldDelta, context: ApplyContext, resolve: (ref: string) => string | undefined): WorldState {
  if (after === before || context.actorRef.kind !== "character") return after;
  const actorId = context.actorRef.id;
  const actor = before.characters.find((character) => character.id === actorId);
  const gated = gatedAct(delta, before, resolve, actor?.polityId ?? null);
  if (gated === null || actor === undefined || actor.polityId !== gated.polityId) return after;
  const spend = gated.act === "spending";
  // Only what is decided once a season, or counted against a year's allowance, is kept.
  if (!spend && ACT_WINDOW_DAYS[gated.act] === 0) return after;
  const may = standingFor(before, actorId, gated, context.offices);
  if (spend && may === null) return after;
  // Carried by the chamber and moved by a man who could not have done it himself: the chamber's decision, not his.
  const decreed = context.sanctionedDeltas !== undefined && may !== null && may.grade === "by_the_body";
  const now = before.elapsedStep;
  const prior = actMarkOf(after.actMarks, gated.polityId, gated.act, spend ? may?.officeId ?? null : null);
  const fresh = prior === undefined || now - prior.sinceStep >= SPENDING_YEAR_DAYS;
  const mark = {
    polityId: gated.polityId,
    act: gated.act,
    officeId: spend ? may?.officeId ?? null : null,
    byCharacterId: decreed ? null : actorId,
    byOfficeId: decreed ? null : may?.officeId ?? null,
    atStep: now,
    sinceStep: spend && !fresh ? prior!.sinceStep : now,
    total: spend ? (fresh ? 0 : prior!.total) + (gated.amount ?? 0) : 0,
  };
  return { ...after, actMarks: withActMark(after.actMarks, mark) };
}
