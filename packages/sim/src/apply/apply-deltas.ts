import { hiringGroups } from "./action-groups";
import {
  takenBy,
  openPeaceTable,
  ownerOf,
  settleOccupations,
  SIEGE_WORKS,
  reconcileCapitals,
  type SiegeWorkKind,
  DELTA_AUTHORITY_DOMAIN,
  adjustPolityLegitimacy,
  AGREEMENT_KIND_IN_WORDS,
  boundedId,
  SKILL_BY_BAND,
  faithNamed,
  agreementsBetween,
  agreementsBetweenSides,
  atWar,
  leaderOf,
  alliesLedBy,
  sameConfederation,
  applyDiplomaticAnswerToStance,
  diplomaticAnswerChangesTrust,
  diplomaticSituationKey,
  redundantDiplomaticOffer,
  sameNegotiation,
  offeredAgreementKinds,
  peaceOfferMetadata,
  isDelivered,
  newsDaysBetween,
  whereTheyHear,
  canMoveTo,
  passageFor,
  passagePlanFor,
  disbandForces,
  normalizeName,
  spelledAlike,
  threatWaitsOnAttack,
  termsAddedIn,
  describePassagePlan,
  marchDaysFor,
  sailDaysFor,
  type PassagePlan,
  warStanding,
  aptitude,
  readDepartments,
  officeholderPolity,
  AUDIT_DAYS,
  practise,
  skillShare,
  isAilment,
  AILMENT_DAYS,
  ENDED_BY_WAR,
  crossingAdmitted,
  allOffices,
  formationOf,
  putInPost,
  ranksIn,
  allTroopCategories,
  isPlotOpen,
  type Settlement,
  findPosition,
  mintPosition,
  provinceWithPosition,
  labelFromCategoryId,
  mintTroopCategory,
  warfareWith,
  forceLever,
  TRAIT_REGISTRY,
  canonicalTraitIds,
  clampWealth,
  deriveOfficeActions,
  findOfficeForRole,
  findOfficeSeatForRole,
  seatCharacterInOffice,
  vacateOfficesOf,
  reciprocalFamilyLinkKind,
  stableHash,
  fitStrengthOf,
  isNavalForce,
  isWaterCrossing,
  describeFerry,
  ferryDays,
  ensureProvinceMaterial,
  sackTheProvince,
  settlementShareBps,
  WorldStateSchema,
  type Province,
  type Force,
  type ForcePersonnelCategory,
  daysInSeason,
  monthOfDay,
  mustCrossAPass,
  adjacentTo,
  describeKm,
  MARCH_KM_PER_DAY,
  FASTEST_MARCH_KM_PER_DAY,
  buildAuthorityIndex,
  checkAuthority,
  CharacterSocialEventSchema,
  applySocialEvents,
  createCanonicalNpc,
  createPressure,
  decideOrderAttempt,
  findWorldReferenceViolations,
  receiveOrderAttempt,
  refreshPressure,
  resolvePressure,
  resolveRef,
  type AuthorityCheckResult,
  type AuthorityIndex,
  type AuthorityPower,
  type AuthorityScope,
  type FactProposalDraft,
  type MoneyTransaction,
  type Office,
  type OrderPartyRef,
  type OrderAttempt,
  type OrderStanding,
  type ScenarioWarfareRules,
  type PolityAgreementKind,
  type WorldDelta,
  type WorldState,
  estateTerms,
  hasPort,
  ventureTerms,
  VENTURE_PRICE_MONTHS,
  type EffectBand,
  type StandingEffect,
  improvementTerms,
  clampStandingShift,
  TAX_EXTRACTION_BPS,
  CUSTOMARY_TAX_BURDEN,
  hireFloorPerMonth,
  nearestShore,
} from "@chronica/shared";
import { findInvariantViolations } from "../invariants";
import { resolveEngagement, type BattleAccount } from "../battle";
import { assaultSiege } from "../siege-decisions";
import { fightRound, openEngagement } from "../engagements";
import { GrainRefused, breadWhereItStands, sendConvoy } from "../grain";
import { handOverForcesOf, killCharacter, mattersEnough } from "../mortality";
import { carryOutEnactment } from "../enact";
import { commandChanges } from "../command-changes";
import { endPolity } from "../polity-end";
import { LOAN_TERM_PERIODS, loanInstalment } from "../debts";
import { endObligationsOfEndedAgreements } from "../treaties";
import { trespassOf } from "../trespass";
import { SOVEREIGN_AGREEMENTS, chamberThatDecides, fleesHisMaster, listensAnyway, nobodyListens, nobodyRises, notHisToSpend } from "./nobody-listens";
import { isOwnBusiness } from "./own-business";
import { asGarrison, isGarrison, proportionalDraw } from "./detachments";
import { hireAtThePlace } from "./hiring-market";
import { budgetHolderOf, chargeVotedBudget, withinVotedBudget } from "../voted-budgets";
import { carryOutUnion, unionVerdict } from "../submission";
import { namesShips, owesShipsTo, requisitionAlliedHulls } from "../socii-navales";
import { sacrilegeOf, whoseToGive } from "./whose-to-give";
import { askOf } from "./asking";
import { endContract } from "../contracts";
import { accountOf, normalizeRefs, peopleNamedButNeverMade } from "./normalize-refs";
import { arrangementNetIncome, recruitSkillBiasIn } from "../standing-effects";
import { isBindingChamberQuestion, overruleCost, seatByOutcome, voteDayOf } from "../senate";
import { vetoFact } from "../tribunes";
import { constitutionOf, rulerOf, sovereignChamberOf } from "../constitutions";
import { attemptRegimeChange } from "../regime";
import { concernsOf } from "../questions";
import { assessExecution, daysInHand, domainOfWork, throughHand } from "../delegation";
import { chooseOverseer } from "../overseers";
import { PLOT_WORDS, plotOdds, plotResolvesIn } from "../plots";
import { kinOf, remember, teach } from "../grievances";
import { INTENT_LIFETIME_DAYS } from "../intents";
import { watchReading } from "../watch";
import type { ApplyContext, ApplyResult, AppliedDelta, AssumedDetail, AuthorityBreach, RejectedDelta } from "./context";
import { fillGaps } from "./fill-gaps";
import { musterRateFor, mustering, raiseLevy } from "../levies";
import { bandedShift, practiseInArmy } from "./army-practice";
import { restedCeilingOf } from "../campaign";
import { enemyFleetOff, perilsOfTheRoad } from "../crossings";
import { diplomaticAnswererOf } from "../letters";
import { moneyMadeBetween, newIssues } from "./what-a-batch-did";
import { journeysOf, onTheWayTo, settledCourse, shoreItMakesFor, turnOnTheRoad, wasTurnedOnTheRoad } from "./marches";
import { WORLD_THREAD_CAP, makeRoomForTheOrder, worldThreadsFull } from "../storyline-cap";

/**
 * Applies a validated batch of deltas to the world.
 *
 * This is the half of the engine the model does not own. Everything above it
 * decides *what should happen*; this decides whether the books still balance
 * afterwards, and it is the only code that writes `WorldState`.
 *
 * Three rules shape it:
 *
 *  1. **Rejection is friction, not failure** (VISION §8). A delta that cannot
 *     apply comes back in `rejected` with a reason the caller turns into a
 *     fact. The rest of the batch still applies, so an over-ambitious order
 *     partly succeeds instead of being refused.
 *  2. **Lack of authority does not block an act** (VISION §12). It is recorded
 *     as a breach and applied anyway -- that is what makes coups, embezzlement
 *     and unauthorized wars expressible at all.
 *  3. **A delta may not introduce a dangling reference.** Checked per delta and
 *     rolled back individually, so one bad reference costs one delta rather
 *     than the batch.
 */

class DeltaRejection extends Error {
  constructor(message: string, readonly kind: "world" | "reference") {
    super(message);
  }
}

/**
 * Refusing a delta, and saying whose fault it was.
 *
 * The kind decides where the refusal goes. "world" reaches the player as
 * friction -- the order was well formed and the world would not have it, which
 * is history and belongs in the record. "reference" does not: it is the engine
 * catching a payload that named something that does not exist, or named one
 * thing twice, and it goes to the debugging record instead.
 *
 * Getting that wrong is not cosmetic. A payload that put Rome's treasury on
 * both sides of its own wage bill surfaced in a live game as "Rome cannot be
 * both guarantor and debtor for Legio II" -- which reads as a law of the
 * Republic, is nothing of the kind, and left the player believing an ordinary
 * order was forbidden. Anything that is a mistake in the writing rather than a
 * fact about the world is "reference".
 */
/** A question's concerns, written down once it exists: what it enacts, what it is called, and what the model said. */
function withConcerns(world: WorldState, procedureId: string): WorldState {
  const procedure = world.material.politicalProcedures.find((candidate) => candidate.id === procedureId);
  if (procedure === undefined) return world;
  const concerns = concernsOf(world, procedure);
  if (concerns.length === 0) return world;
  return { ...world, material: { ...world.material, politicalProcedures: world.material.politicalProcedures.map((candidate) => (candidate.id === procedureId ? { ...candidate, concerns } : candidate)) } };
}

function reject(reason: string, kind: "world" | "reference" = "world"): never {
  throw new DeltaRejection(reason, kind);
}

/** Which scope a delta acts over, so authority is judged against the thing itself rather than the whole polity. */
function scopeOf(delta: WorldDelta, world: WorldState, resolve: (ref: string) => string | undefined, actorRef: OrderPartyRef): AuthorityScope {
  // Anything without a scope of its own is judged in the actor's own polity.
  // Reaching for the first polity in the world instead -- as this once did --
  // judged a Roman consul's every unscoped act against Carthage, and recorded
  // a breach for each one.
  const actorPolityId = actorRef.kind === "character"
    ? world.characters.find((character) => character.id === actorRef.id)?.polityId ?? null
    : actorRef.kind === "polity" ? actorRef.id : null;
  const polityFallback: AuthorityScope = { kind: "polity", id: actorPolityId ?? world.map.polities[0]?.id ?? "unknown" };
  switch (delta.op) {
    case "money_transfer":
      return { kind: "account", id: resolve(delta.fromAccountRef) ?? delta.fromAccountRef };
    case "income_source_upsert":
      return { kind: "account", id: resolve(delta.beneficiaryAccountRef) ?? delta.beneficiaryAccountRef };
    case "obligation_upsert":
      return { kind: "account", id: resolve(delta.payerAccountRef) ?? delta.payerAccountRef };
    // A man lending his own money is spending his own purse, and it is his to
    // lend: weighed against the borrower's account it made every private loan
    // to a government a breach of that government's treasury by the lender.
    // Taken by a government's official, it is the borrowing that is judged.
    case "loan_open": {
      const lenderId = delta.lenderKind === "character" && delta.lenderRef !== null ? resolve(delta.lenderRef) ?? delta.lenderRef : null;
      const lenderPurse = lenderId === null ? null : world.characters.find((character) => character.id === lenderId)?.personalAccountId ?? null;
      if (lenderId !== null && lenderPurse !== null && actorRef.kind === "character" && actorRef.id === lenderId) return { kind: "account", id: lenderPurse };
      return { kind: "account", id: resolve(delta.borrowerAccountRef) ?? delta.borrowerAccountRef };
    }
    // Raising men is the state's business -- unless a man pays for them out of
    // his own purse, which is a private company and his own affair: a merchant
    // fitting out a ship, a noble raising his clients. Weighed then against the
    // purse that pays, through the obligation that says who does.
    case "force_create": {
      // Men detached from an army are that army's business: a consul leaving
      // a garrison at Rhegium was judged as raising a new army at Rome's cost.
      if (delta.fromForceRef != null) return { kind: "force", id: resolve(delta.fromForceRef) ?? delta.fromForceRef };
      // An ally's hulls called for under its treaty: the caller's own government's act.
      if (actorPolityId !== null && namesShips(delta.categoryId) && owesShipsTo(world, resolve(delta.polityId) ?? delta.polityId, actorPolityId)) return { kind: "polity", id: actorPolityId };
      const obligationId = delta.payObligationRef == null ? undefined : resolve(delta.payObligationRef) ?? delta.payObligationRef;
      const payer = obligationId === undefined ? undefined : world.material.obligations.find((obligation) => obligation.id === obligationId)?.payerAccountId;
      const privately = payer !== undefined && world.material.accounts.find((account) => account.id === payer)?.owner.kind === "character";
      return privately ? { kind: "account", id: payer } : { kind: "polity", id: resolve(delta.polityId) ?? delta.polityId };
    }
    // A work is judged by the chest that pays for it, now that the chest does.
    case "project_create":
      return delta.fundingAccountRef === null ? polityFallback : { kind: "account", id: resolve(delta.fundingAccountRef) ?? delta.fundingAccountRef };
    case "force_modify":
      return { kind: "force", id: resolve(delta.forceRef) ?? delta.forceRef };
    case "force_reinforce":
      return { kind: "force", id: resolve(delta.forceRef) ?? delta.forceRef };
    case "force_attrition":
      return { kind: "force", id: resolve(delta.forceRef) ?? delta.forceRef };
    case "force_engage":
      return { kind: "force", id: resolve(delta.forceRef) ?? delta.forceRef };
    case "force_raid":
      return { kind: "force", id: resolve(delta.forceRef) ?? delta.forceRef };
    case "siege_lay":
      return { kind: "force", id: resolve(delta.forceRef) ?? delta.forceRef };
    // Bread paid for is spending from whoever pays; taken or sent, the army's business.
    case "force_provision":
      return delta.payAccountRef === null ? { kind: "force", id: resolve(delta.forceRef) ?? delta.forceRef } : { kind: "account", id: resolve(delta.payAccountRef) ?? delta.payAccountRef };
    // Raising a siege is the besieging army's act, whoever writes it.
    case "siege_lift": {
      const siegeId = resolve(delta.siegeRef) ?? delta.siegeRef;
      const forceId = world.sieges.find((siege) => siege.id === siegeId)?.forceId;
      return forceId === undefined ? polityFallback : { kind: "force", id: forceId };
    }
    case "polity_stance_shift":
      return { kind: "polity", id: resolve(delta.polityId) ?? delta.polityId };
    // Writing in a power's name is that power's act. A senator who writes to
    // Carthage over Rome's name is scoped to Rome and breaches for it, which is
    // exactly what private correspondence with a foreign power should be.
    case "diplomatic_message_send":
      return { kind: "polity", id: resolve(delta.fromPolityId) ?? delta.fromPolityId };
    case "agreement_open":
      return { kind: "polity", id: resolve(delta.polityId) ?? delta.polityId };
    case "polity_outlook_set":
      return { kind: "polity", id: resolve(delta.polityId) ?? delta.polityId };
    case "legitimacy_shift":
      return { kind: delta.target === "polity" ? "polity" : "institution", id: resolve(delta.targetId) ?? delta.targetId };
    case "province_material_shift":
      return { kind: "province", id: delta.provinceId };
    case "office_seat_set": {
      // Scoped to the power whose office it is: seating a man is an act over a
      // government, and judging it against the office itself would let anybody
      // who could name an office fill it. An office being made in this act has
      // no power yet; it will be the new holder's, which is where it is made.
      if (world.offices.some((office) => office.id === delta.officeId) || world.material.officeSeats.some((seat) => seat.officeId === delta.officeId)) {
        return { kind: "institution", id: delta.officeId };
      }
      const holderId = delta.holderCharacterRef === null ? null : resolve(delta.holderCharacterRef) ?? delta.holderCharacterRef;
      const holderPolity = world.characters.find((character) => character.id === holderId)?.polityId ?? null;
      return holderPolity === null ? polityFallback : { kind: "polity", id: holderPolity };
    }
    // Going through a department's books is an act over its power; through a
    // household's, weighed against the purse it pays into -- a man auditing
    // his own steward needs nobody's leave.
    case "audit_open": {
      const departmentId = delta.departmentRef == null ? null : resolve(delta.departmentRef) ?? delta.departmentRef;
      const department = departmentId === null ? undefined : world.departments.find((candidate) => candidate.id === departmentId);
      if (department !== undefined) return { kind: "polity", id: department.scope.id };
      const ownerId = delta.householdOwnerRef == null ? null : resolve(delta.householdOwnerRef) ?? delta.householdOwnerRef;
      const purse = world.characters.find((character) => character.id === ownerId)?.personalAccountId;
      return purse === undefined ? polityFallback : { kind: "account", id: purse };
    }
    case "province_control_set":
      return { kind: "province", id: delta.provinceId };
    case "settlement_control_set":
      return { kind: "settlement", id: delta.settlementId };
    case "capital_set":
      return { kind: "polity", id: resolve(delta.polityRef) ?? delta.polityRef };
    case "political_procedure_open":
      return delta.institutionRef === null
        ? polityFallback
        : { kind: "institution", id: resolve(delta.institutionRef) ?? delta.institutionRef };
    case "character_create":
      return { kind: "polity", id: resolve(delta.polityId) ?? delta.polityId };
    // Buying land is spending one's own money: the purse it comes out of is
    // what the act is weighed against, so a man buying a farm with his own
    // silver needs nobody's leave. A grant out of the public land is disposing
    // of the state's property, and is weighed like spending from its chest:
    // whoever may spend from the treasury of the power holding the province
    // may grant its land, and nobody else.
    case "holding_create": {
      if (delta.priceFromAccountRef !== null) return { kind: "account", id: resolve(delta.priceFromAccountRef) ?? delta.priceFromAccountRef };
      const controller = world.map.provinces.find((province) => province.id === delta.provinceId)?.controllerPolityId ?? null;
      if (controller === null) return polityFallback;
      const treasury = world.material.accounts.find((account) => account.owner.kind === "polity" && account.owner.id === controller);
      return treasury === undefined ? { kind: "polity", id: controller } : { kind: "account", id: treasury.id };
    }
    // Improving land is paid for, and the purse paying is what answers for
    // it: an owner improving his estate from his own money is his own
    // business, and improving it out of the treasury is not.
    case "holding_improve":
      return { kind: "account", id: resolve(delta.paidFromAccountRef) ?? delta.paidFromAccountRef };
    case "force_membership_set":
      return { kind: "force", id: resolve(delta.forceRef) ?? delta.forceRef };
    case "force_post_set":
      return { kind: "force", id: resolve(delta.forceRef) ?? delta.forceRef };
    // An arrangement kept at somebody's expense is weighed like the money that
    // keeps it: a shrine a man endows from his purse is his to endow, and one
    // kept out of the treasury is spending the treasury. Before, the account
    // paying the upkeep was never asked, so anybody who could found anything
    // could charge its keep to the state.
    case "generic_entity_create":
    case "generic_entity_update":
      return delta.upkeep == null ? polityFallback : { kind: "account", id: resolve(delta.upkeep.fromAccountRef) ?? delta.upkeep.fromAccountRef };
    // A man is hired by whoever pays him, and weighed like the money.
    case "service_contract_open":
      return { kind: "account", id: resolve(delta.employerAccountRef) ?? delta.employerAccountRef };
    case "service_contract_close": {
      const contract = world.material.contracts.find((candidate) => candidate.id === (resolve(delta.contractRef) ?? delta.contractRef));
      return contract === undefined ? polityFallback : { kind: "account", id: contract.employerAccountId };
    }
    // Trade is paid for, and weighed like the money it is paid with.
    case "trade_venture_open":
      return { kind: "account", id: resolve(delta.paidFromAccountRef) ?? delta.paidFromAccountRef };
    // Winding a venture up is its owner's business: weighed against the purse it pays into.
    case "trade_venture_close": {
      const ventureId = resolve(delta.ventureRef) ?? delta.ventureRef;
      const venture = world.material.ventures.find((candidate) => candidate.id === ventureId);
      const income = venture === undefined ? undefined : world.material.incomeSources.find((source) => source.id === venture.incomeSourceId);
      return income === undefined ? polityFallback : { kind: "account", id: income.beneficiaryAccountId };
    }
    default:
      return polityFallback;
  }
}

/**
 * What answering an order does to the two people in it (slice 11).
 *
 * Directed, because A's view of B is not B's view of A, and asymmetric where
 * the knowledge is: a man who says yes and does otherwise has not changed his
 * commander's opinion of him, because his commander does not know. That
 * asymmetry is the whole reason subversion is a separate status from refusal.
 *
 * Deliberately small numbers. One order is one order; it is the accumulation
 * that makes a relationship, and a legate who has refused you four times has
 * earned the -32 rather than been handed it.
 */
export function orderAnswerCauses(
  world: WorldState,
  decided: OrderAttempt,
  standing: OrderStanding,
): { subjectCharacterId: string; targetCharacterId: string; label: string; score: number; decayPerYearBps: number; dimensions?: Record<string, number> }[] {
  if (decided.issuerRef.kind !== "character" || decided.recipientRef.kind !== "character") return [];
  const issuer = decided.issuerRef.id;
  const recipient = decided.recipientRef.id;
  if (issuer === recipient) return [];
  const known = (id: string): boolean => world.characters.some((character) => character.id === id);
  if (!known(issuer) || !known(recipient)) return [];

  const cause = (subject: string, target: string, label: string, score: number, dimensions: Record<string, number>) =>
    ({ subjectCharacterId: subject, targetCharacterId: target, label, score, decayPerYearBps: 1_500, dimensions });

  switch (decided.status) {
    case "accepted":
      // Carrying out a lawful order is duty and earns a little; granting a
      // request you could have declined is a favour and earns more, and puts
      // the asker under an obligation he now owes.
      return standing === "binding"
        ? [cause(issuer, recipient, "He did as he was told.", 4, { trust: 6, respect: 4 })]
        : [
          cause(issuer, recipient, "He did it, and he did not have to.", 8, { trust: 10, affection: 6 }),
          cause(recipient, issuer, "He asked rather than commanded, and I obliged him.", 3, { obligation: 8 }),
        ];
    case "refused":
      return [
        cause(issuer, recipient, standing === "binding" ? "He refused me outright." : "He would not do it.", standing === "binding" ? -12 : -5,
          standing === "binding" ? { trust: -14, respect: -8 } : { affection: -6 }),
        // And he is the less afraid of him for having done it.
        cause(recipient, issuer, "I would not do as he asked, and am none the worse for it.", -3, { affection: -4, fear: -8 }),
      ];
    case "ignored":
      return [cause(issuer, recipient, "He gave me no answer at all.", -8, { trust: -10, respect: -6 })];
    case "delayed":
      return [cause(issuer, recipient, "He is taking his time about it.", -3, { trust: -4 })];
    case "subverted":
      // He knows what he did. His commander does not, which is the point.
      return [cause(recipient, issuer, "I agreed to his face and did otherwise.", -10, { trust: -12, respect: -6 })];
    default:
      return [];
  }
}

/**
 * One person's view of another, changed by something the engine did to them --
 * freed by him, sold by him. Slow to fade: a man remembers who made him free.
 */
function addRelationCause(
  world: WorldState,
  cause: { subjectCharacterId: string; targetCharacterId: string; label: string; score: number; dimensions: Record<string, number> },
  atStep: number,
  context: ApplyContext,
): WorldState {
  return applySocialEvents(
    world,
    [CharacterSocialEventSchema.parse({
      id: context.ids.next("social"),
      gameId: context.gameId,
      sourceTurnId: null, sourceSessionId: null, sourceMessageId: null,
      participantCharacterIds: [cause.subjectCharacterId, cause.targetCharacterId],
      kind: cause.score >= 0 ? "favour" : "insult",
      visibility: "polity",
      knownByCharacterIds: [cause.subjectCharacterId, cause.targetCharacterId],
      relationCauses: [{ ...cause, decayPerYearBps: 500 }],
      observedTraits: [],
      knowledgeClaims: [], proposedBeliefs: [], pressureChanges: [],
      commitmentProposal: null, introducedCharacter: null, introducedProfile: null,
      createdAtStep: atStep, appliedAtStep: null, appliedInTurnId: null,
      status: "proposed", rejectionReason: null,
    })],
    atStep,
    context.ids.next("social-batch"),
  ).world;
}

/** Puts the batch's handles back as they were, in place: callers hold this map. */
function restoreHandles(handles: Map<string, string>, asTheyWere: ReadonlyMap<string, string>): void {
  handles.clear();
  for (const [localId, id] of asTheyWere) handles.set(localId, id);
}

/** The pressure helpers hand back the two collections they touch; the world takes them. */
function withPressures(world: WorldState, next: { readonly characters: readonly WorldState["characters"][number][]; readonly characterPressures: readonly WorldState["characterPressures"][number][] }): WorldState {
  return { ...world, characters: [...next.characters], characterPressures: [...next.characterPressures] };
}

/** What a man recovers by resting, where nobody treats him. */
const REST_RECOVERY_BPS = 500;

/** What walking out on a paid contract costs a man's name. */
const WALKED_OUT_STANDING_BPS = 300;

/**
 * How many battles the map shows at once.
 *
 * A battle is a moment, not a condition: what the overlay is for is showing
 * where fighting is happening now, and an unbounded list would end a campaign
 * drawing every engagement of the whole war on top of each other.
 */
const MAX_SHOWN_BATTLES = 6;

/**
 * Words that assert a death, which `character_state_set` may not.
 *
 * Kept as a set rather than a single check because every one of these was a
 * plausible thing for an author to write, and the one that got through was the
 * plainest of them.
 */
const DEATH_CLAIMING_STATUSES = new Set(["dead", "deceased", "killed", "slain", "murdered", "assassinated", "executed"]);

/** Statuses that mean a person is in somebody else's hands. */
const CAPTIVE_STATUSES = new Set(["captured", "captive", "imprisoned", "prisoner", "hostage", "condemned", "arrested"]);

/** One step of a skill, and the most shifts can ever make of one. */
const SKILL_STEP = 10;
const SKILL_CEILING = 90;

const POWER_BY_OP: Record<WorldDelta["op"], AuthorityPower> = {
  money_transfer: "spend",
  income_source_upsert: "spend",
  obligation_upsert: "spend",
  project_create: "propose",
  project_milestone_update: "propose",
  force_create: "command",
  force_modify: "command",
  force_provision: "command",
  force_reinforce: "command",
  force_attrition: "command",
  character_create: "appoint",
  character_intent_set: "propose",
  social_events: "propose",
  generic_entity_create: "propose",
  generic_entity_update: "propose",
  loan_open: "spend",
  loan_settle: "spend",
  belief_set: "propose",
  force_engage: "command",
  authority_grant_upsert: "appoint",
  order_attempt_decide: "command",
  polity_stance_shift: "negotiate",
  polity_outlook_set: "propose",
  legitimacy_shift: "propose",
  province_material_shift: "propose",
  political_procedure_open: "propose",
  political_support_set: "propose",
  political_procedure_resolve: "override",
  holding_transfer: "punish",
  holding_create: "spend",
  holding_improve: "spend",
  force_membership_set: "command",
  force_post_set: "appoint",
  trade_venture_open: "spend",
  trade_venture_close: "spend",
  storyline_open: "propose",
  storyline_advance: "propose",
  character_pressure_set: "propose",
  character_state_set: "propose",
  force_raid: "command",
  diplomatic_message_send: "negotiate",
  diplomatic_message_answer: "negotiate",
  agreement_open: "negotiate",
  agreement_close: "negotiate",
  province_control_set: "command",
  settlement_control_set: "command",
  capital_set: "override",
  // "punish", because that is the power a plot arrogates: deciding that a man
  // has forfeited something, without a court and without a hearing. Nobody's
  // office grants it, so every plot is recorded as a breach by the man who
  // laid it -- which is the thread an investigator later pulls.
  covert_plot_open: "punish",
  contingency_arm: "command",
  siege_lay: "command",
  siege_lift: "command",
  contingency_disarm: "command",
  audit_open: "propose",
  polity_create: "override",
  office_seat_set: "appoint",
  // A family's own business: nobody's office grants it, and nobody's is needed.
  family_tie_set: "propose",
  // The power a court exercises, and the one a man with no court usurps.
  character_death: "punish",
  // Taking a man's freedom is the power of a court or a conqueror; giving it
  // back is his owner's, and is judged as the household's own business.
  legal_status_set: "punish",
  service_contract_open: "spend",
  service_contract_close: "spend",
  // Taking a state is the power nobody's office grants: every attempt is recorded as a breach.
  regime_change: "override",
};

/** The power an act needs: founding something is proposing it, and keeping it at an account's expense is spending from it. */
function powerOf(delta: WorldDelta): AuthorityPower {
  if ((delta.op === "generic_entity_create" || delta.op === "generic_entity_update") && delta.upkeep != null) return "spend";
  return POWER_BY_OP[delta.op];
}

/**
 * Which polity an act falls in, where that can be told.
 *
 * Used to decide whether an act is the actor's at all -- not to decide whether
 * they may do it, which is `checkAuthority`'s business.
 */
export function polityOfScope(scope: AuthorityScope, world: WorldState, offices: readonly Office[] = []): string | null {
  switch (scope.kind) {
    case "polity":
      return scope.id;
    case "province":
      return world.map.provinces.find((province) => province.id === scope.id)?.controllerPolityId ?? null;
    // An outlaw band belongs to no power, so no government's grant reaches it.
    case "force": {
      const force = world.material.forces.find((candidate) => candidate.id === scope.id);
      return force === undefined || force.outlaw === true ? null : force.polityId;
    }
    // An office is scoped as an institution of the government that has it.
    // Only the councils were looked in, so no seat of any office ever resolved
    // to a power: a consul seating his own legate breached, and a Roman
    // seating a Carthaginian was never asked whose office it was.
    case "institution":
      return world.material.institutions.find((institution) => institution.id === scope.id)?.polityId
        ?? allOffices(world, offices).find((office) => office.id === scope.id)?.polityId
        ?? null;
    case "account": {
      const owner = world.material.accounts.find((account) => account.id === scope.id)?.owner;
      if (owner === undefined) return null;
      if (owner.kind === "polity") return owner.id;
      return world.characters.find((character) => character.id === owner.id)?.polityId ?? null;
    }
    default:
      return null;
  }
}

/**
 * Whether a delta is the actor overreaching, or simply the world moving.
 *
 * The orchestrator speaks for the whole world, not only for the ruler whose
 * order it is answering: it gives the Boii a chieftain, decides what Carthage
 * privately wants, and moves a neighbour's army. Judging those against the
 * Roman consul recorded ten breaches for a single tax order and accused him of
 * insubordination for things he did not do -- the third time false
 * insubordination has come out of this check.
 *
 * So the exemption follows who is speaking. When a person acts for themselves,
 * through their own cognition, everything they do is theirs to answer for, and
 * a Carthaginian who moves a Roman legion has committed exactly the
 * insubordination VISION §12 is about. It is only when the world itself is
 * speaking that an act inside another power is somebody else's business.
 */
/** Whether an act falls inside a power other than the actor's own. */
function actsInsideAnotherPower(scope: AuthorityScope, world: WorldState, context: ApplyContext): boolean {
  const actorPolityId = actorPolityOf(world, context);
  const scopePolityId = polityOfScope(scope, world, context.offices);
  return actorPolityId !== null && scopePolityId !== null && scopePolityId !== actorPolityId;
}

function actorIsAnswerableFor(delta: WorldDelta, scope: AuthorityScope, world: WorldState, context: ApplyContext, ofTheOrder = false): boolean {
  // A rule firing is nobody's exercise of authority (`mechanics/run-mechanics.ts`).
  // Its money moves were warranted when the rule was attached -- an office
  // over the treasury, a consent given, the owner's own purse -- and the
  // warrant is what is checked, here, rather than the owner's standing today.
  // An unwarranted debit is refused as anybody's would be.
  if (context.firingMechanic !== undefined) {
    if (delta.op !== "money_transfer" || scope.kind !== "account") return false;
    return !context.firingMechanic.warrantedAccountIds.has(scope.id);
  }
  // The world's own business, said apart from the order: a seed carried out,
  // a promise falling due, the Senate filling a post. None of it is the ruler
  // acting, wherever it falls. Before the two were separated, this was
  // judged against him whenever it happened at home -- and with authority now
  // refusing rather than only recording, it would have been refused.
  if (context.actsForTheWorld === true && context.orderDeltas !== undefined && !ofTheOrder) return false;
  // Meaning to do something is not doing it. An intention has no scope of its
  // own, so it fell back to the whole polity, and an official who merely
  // resolved to act was recorded as having exceeded his authority over the
  // republic. Whatever he then actually does is checked on its own terms.
  if (delta.op === "character_intent_set") return false;
  // A thread of history is the world's bookkeeping, and a circumstance that
  // befalls someone is nobody's act. Neither is a power an office could hold,
  // so judging them against one would make the first seed to land at home an
  // act of insubordination by the ruler -- the sixth time this check would
  // have manufactured it.
  if (delta.op === "storyline_open" || delta.op === "storyline_advance" || delta.op === "character_pressure_set") return false;
  // What has become of a person's body is not an exercise of authority over
  // anything. Scoped to their polity -- where it falls through to -- a man
  // falling ill would be recorded as insubordination by whoever wrote it down,
  // which is the ninth way this check has found to manufacture it.
  if (delta.op === "character_state_set") return false;
  // A marriage or an adoption is two families' business, and nobody's office.
  if (delta.op === "family_tie_set") return false;
  // A duel or a suicide exercises no power over anyone. An execution does,
  // unless a court has already condemned the man: a question about him that
  // passed is the lawful form, and without one it is a killing the record
  // will want explained.
  if (delta.op === "character_death") {
    if (delta.manner !== "execution") return false;
    const doomedId = context.assignedIds?.get(delta.characterRef.replace(/^local:/, "")) ?? delta.characterRef;
    return !world.material.politicalProcedures.some((procedure) =>
      procedure.subjectKind === "character" && procedure.subjectId === doomedId && procedure.outcome === "passed");
  }
  // Writing down that a man exists -- the friend a letter is addressed to, the
  // steward who keeps the farm -- seats nobody and commands nothing. Scoped to
  // his power as an act of appointment, every letter to somebody the world had
  // not yet named was recorded as "made X an officer of the government" (E12).
  // Made with an office, it is a seat filled, and judged as one (`whoseToGive`).
  if (delta.op === "character_create" && delta.officeLabel === null) return false;
  // A country coming apart is not an act of office. Scoped to the power it
  // breaks from -- which for a rising is usually the ruler's own -- it would
  // have recorded the ruler as personally insubordinate for a rebellion in his
  // own provinces, which is the seventh way this check has found to manufacture
  // insubordination out of the world simply moving.
  if (delta.op === "polity_create") return false;
  // Answering an order put to *you* is not an exercise of authority over your
  // own power. Scoped to the decider's polity -- which is where it falls
  // through to -- every refusal and every acceptance would have recorded a
  // breach for the act of replying. It has never fired only because no order
  // attempt has ever been decided; fixing that without this would make
  // insubordination the ordinary consequence of answering your post, and is
  // the eighth way this check has found to manufacture it.
  if (delta.op === "order_attempt_decide") return false;
  // Joining an army is not an exercise of authority over it: any free man may
  // take service. Walking away from one without leave is -- but only the man
  // walking answers for it. Written by whoever is telling the world's story
  // about somebody else's desertion, it would record the teller as the
  // deserter, which is the tenth way this check could manufacture
  // insubordination. A discharge is the commander's to give, and is judged.
  if (delta.op === "force_membership_set" && delta.change !== "discharge") {
    return delta.change === "desert" && context.actorRef.kind === "character" && delta.characterRef === context.actorRef.id;
  }

  if (context.actsForTheWorld !== true) return true;


  // A polity's standing aims are nobody's personal act, whoever is speaking.
  if (delta.op === "polity_outlook_set") return false;

  const actorPolityId = context.actorRef.kind === "character"
    ? world.characters.find((character) => character.id === context.actorRef.id)?.polityId ?? null
    : context.actorRef.kind === "polity" ? context.actorRef.id : null;
  if (actorPolityId === null) return true;

  const scopePolityId = polityOfScope(scope, world, context.offices);
  // Where the act belongs to nobody in particular, the actor still answers for
  // it: an unattributable act is exactly where overreach would hide.
  if (scopePolityId === null) return true;
  return scopePolityId === actorPolityId;
}

export function applyDeltas(world: WorldState, deltas: readonly WorldDelta[], given: ApplyContext): ApplyResult {
  const context: ApplyContext = given.batchStart === undefined ? { ...given, batchStart: world } : given;
  const groups = hiringGroups(deltas, context.atomicGroups);
  if (groups.length === 0) return applyUngroupedDeltas(world, deltas, context);
  let result: ApplyResult = { world, applied: [], rejected: [], breaches: [], factProposals: [], battleAccounts: [], assignedIds: new Map(context.assignedIds ?? []), assumptions: [] };
  const visited = new Set<WorldDelta>();
  for (const delta of deltas) {
    if (visited.has(delta)) continue;
    const group = groups.find((candidate) => candidate.includes(delta)) ?? [delta];
    group.forEach((candidate) => visited.add(candidate));
    const hires = group.filter((candidate) => candidate.op === "service_contract_open" && candidate.company !== null);
    const redundant = group.filter((candidate) => candidate.op === "force_create" && hires.some((hire) => hire.op === "service_contract_open" && hire.company?.categoryId === candidate.categoryId && hire.company?.strength === candidate.authorizedStrength && /hir|charter|mercenar|contract/i.test(`${candidate.name} ${candidate.reason}`)));
    let tried = applyUngroupedDeltas(result.world, group.filter((candidate) => !redundant.includes(candidate)), { ...context, atomicGroups: undefined, assignedIds: result.assignedIds });
    if (tried.rejected.length === 0) for (const duplicate of redundant) {
      if (duplicate.op !== "force_create") continue;
      const hire = hires.find((candidate) => candidate.op === "service_contract_open" && candidate.company?.categoryId === duplicate.categoryId && candidate.company?.strength === duplicate.authorizedStrength);
      if (hire?.op !== "service_contract_open") continue;
      const contract = tried.world.material.contracts.find((candidate) => candidate.id === tried.assignedIds.get(hire.localId));
      if (contract?.forceId != null) {
        (tried.assignedIds as Map<string, string>).set(duplicate.localId, contract.forceId);
        const carriedHire = tried.applied.find((act) => act.written === hire);
        if (carriedHire !== undefined) tried = { ...tried, applied: [...tried.applied, { ...carriedHire, delta: duplicate, written: duplicate }] };
      }
    }
    if (group.length > 1 && tried.rejected.length > 0) {
      const failure = tried.rejected[0]!;
      result = { ...result, rejected: [...result.rejected, ...group.map((written) => ({ delta: written, written, reason: `Hiring was not completed: ${failure.reason}`, kind: failure.kind, ofTheOrder: context.orderDeltas?.has(written) === true }))] };
    } else result = { world: tried.world, assignedIds: tried.assignedIds,
      applied: [...result.applied, ...tried.applied], rejected: [...result.rejected, ...tried.rejected], breaches: [...result.breaches, ...tried.breaches],
      factProposals: [...result.factProposals, ...tried.factProposals], battleAccounts: [...result.battleAccounts, ...tried.battleAccounts], assumptions: [...result.assumptions, ...tried.assumptions] };
  }
  return result;
}

function applyUngroupedDeltas(world: WorldState, deltas: readonly WorldDelta[], given: ApplyContext): ApplyResult {
  // The world as the answer found it, for what must not count what the same answer did.
  const context: ApplyContext = given.batchStart === undefined ? { ...given, batchStart: world } : given;
  const assignedIds = new Map<string, string>(context.assignedIds ?? []);
  const applied: AppliedDelta[] = [];
  const rejected: RejectedDelta[] = [];
  const assumptions: AssumedDetail[] = [];
  const breaches: AuthorityBreach[] = [];
  const factProposals: FactProposalDraft[] = [];
  const battleAccounts: BattleAccount[] = [];

  const resolve = (ref: string): string | undefined => resolveRef(ref, assignedIds);
  let current = world;
  let violations = new Set(findWorldReferenceViolations(world));
  let invariants = new Set(findInvariantViolations(world));

  const authorityIndex: AuthorityIndex = buildAuthorityIndex(
    { officeSeats: world.material.officeSeats, forces: world.material.forces, accounts: world.material.accounts },
    world.authorityGrants,
    // Every office there is, and not only the scenario's: an office the world
    // made -- a quaestorship for the war chest -- conferred nothing here, so
    // its holder breached, or was ignored, every time he did his job.
    allOffices(world, context.offices),
    world.elapsedStep,
  );

  for (const written of deltas) {
    // A reference off by a little -- a province id cut in half, a keep paid
    // "from the temple" -- is put right before the act is judged; and a
    // person named and never made is made, rather than refusing the act that
    // named him.
    // Captured before anybody is made for this act, so a refusal takes them
    // back out with it: a person conjured for an act that never happened is
    // exactly the state-surviving-a-rollback this loop exists to prevent.
    const previous = current;
    /**
     * The handles this batch has minted, as they stood before this delta.
     *
     * Rolled back with the world, and for exactly the same reason. It was not,
     * and the consequence was a phantom: `mint` writes `local:x ->
     * character-<burst>-7` *before* the delta can be rejected, so a creation
     * that failed left the handle behind, and every later delta naming
     * `local:x` resolved to an id nothing had ever created. The world then
     * filled with "No character character-d4557447-...-13 exists to command
     * this force", "...to hold this intent", "...to take part in this" --
     * three refusals whose stated reason names an id the model never wrote and
     * cannot look up, instead of the one true reason, which is that the person
     * was never made.
     */
    const previousHandles = new Map(assignedIds);
    // Everything here is a courtesy -- putting a reference right, making
    // somebody named and never made -- and a courtesy must never be the thing
    // that takes a batch down. Before this was guarded, an empty social event
    // with no list of events in it threw from here, outside the per-act
    // guard below, and would have lost every act in the batch.
    let delta: WorldDelta = written;
    const ofTheOrder = context.orderDeltas?.has(written) === true;
    /** What the engine answered for the actor that the answer left out or got wrong. */
    let assumed: readonly string[] = [];
    try {
      // An arrangement paid from, or paid into, as if it had an account -- the
      // guild's fund, the church's collection -- is given one, empty. Paying
      // out of it then meets the honest answer that there is nothing in it.
      current = openFundsNamedIn(written, current, resolve);
      current = splitDetachmentsNamedIn(written, current, assignedIds, context);
      const named = peopleNamedButNeverMade(normalizeRefs(written, current, (handle) => assignedIds.has(handle), resolve), current, (handle) =>
        assignedIds.has(handle)
        // Somebody this batch tried to make and could not: the refusal of that
        // creation already says why, and a stand-in under another name would be
        // a different person pretending to be him.
        || rejected.some((rejection) => "localId" in rejection.delta && rejection.delta.localId === handle), resolve);
      for (const person of named.toMake) {
        const actorPolity = context.actorRef.kind === "character"
          ? current.characters.find((character) => character.id === context.actorRef.id)?.polityId ?? null
          : context.actorRef.kind === "polity" ? context.actorRef.id : null;
        const mentioned = named.delta as { polityId?: unknown; fromPolityId?: unknown; toPolityId?: unknown; toCharacterRef?: unknown; provinceId?: unknown; locationId?: unknown };
        // The man a letter is addressed to is of the power it is sent to. Made
        // of the sender's, a "Hiero II" of Rome answered Rome for Syracuse.
        const addressee = mentioned.toCharacterRef === `local:${person.handle}` ? mentioned.toPolityId : undefined;
        const polityId = [addressee, mentioned.polityId, mentioned.fromPolityId, actorPolity]
          .find((candidate): candidate is string => typeof candidate === "string" && current.map.polities.some((polity) => polity.id === candidate));
        const provinceId = [mentioned.provinceId, mentioned.locationId]
          .find((candidate): candidate is string => typeof candidate === "string" && current.map.provinces.some((province) => province.id === candidate)) ?? null;
        if (polityId === undefined) continue;
        try {
          current = applyOne(current, {
            op: "character_create", localId: person.handle, name: person.name, polityId, provinceId, age: 40,
            officeLabel: null, officeAuthorises: [], traits: [], standing: null, wealth: 0,
            generatedBecause: "Named in an order before anybody had made them.",
          }, context, assignedIds, resolve, () => undefined, () => undefined);
        } catch {
          // Leave the act to be refused on its own terms.
        }
      }
      delta = named.delta;
      // Who pays and where, when the answer named nothing that exists: the
      // actor's own purse, the place he stands. Only for the actor's own acts --
      // the world speaking for Carthage is not a Roman paying for it.
      if (context.actsForTheWorld !== true || ofTheOrder) {
        const filled = fillGaps(delta, current, context.actorRef, resolve);
        delta = filled.delta;
        assumed = filled.assumed;
      }
      // An army a man raises by his own order answers to him, whoever he puts
      // at its head. Legio II, raised on the consul's order "under Lucius
      // Papirius", was Papirius's to command and to keep: the consul who raised
      // it could not give it an order a season later.
      if (ofTheOrder && delta.op === "force_create" && context.actorRef.kind === "character") {
        const actorId = context.actorRef.id;
        const raiser = current.characters.find((character) => character.id === actorId);
        const forPolity = resolve(delta.polityId) ?? delta.polityId;
        if (raiser !== undefined && raiser.alive && raiser.polityId === forPolity && delta.controllerCharacterRef !== actorId) {
          delta = { ...delta, controllerCharacterRef: actorId };
        }
      }
    } catch {
      current = previous;
      restoreHandles(assignedIds, previousHandles);
      delta = written;
      assumed = [];
    }
    // Buffered per delta: a delta that is rolled back must not leave the world
    // asserting consequences that never happened.
    const emitted: FactProposalDraft[] = [];
    const emitFact = (fact: FactProposalDraft): void => {
      emitted.push(fact);
    };
    // Buffered with the facts, for the same reason: a delta rolled back must
    // not leave an account of a battle that never happened.
    const emittedAccounts: BattleAccount[] = [];
    const emitAccount = (account: BattleAccount): void => {
      emittedAccounts.push(account);
    };
    // Something the order made hang on a question still before a chamber --
    // "using my own money if Rome does not support it" -- waits for the vote,
    // rather than being done before the vote it hung on.
    if (context.actsForTheWorld !== true || ofTheOrder) {
      const waiting = awaitingTheQuestion(delta, current, context, new Set(assignedIds.values()));
      if (waiting !== null) {
        delta = waiting.delta;
        emitFact(waiting.fact);
      }
    }
    // Peace is made with the enemy, not declared at him. An order may dictate
    // one where the war is won (`warStanding`); short of that it is asked for
    // and bargained over with their envoy (`peace.ts`).
    if (ofTheOrder && delta.op === "agreement_open" && (delta.kind === "peace" || delta.kind === "truce")) {
      const us = resolve(delta.polityId) ?? delta.polityId;
      const them = resolve(delta.otherPolityId) ?? delta.otherPolityId;
      if (atWar(current.polityAgreements, us, them) && !warStanding(current, us, them).dictates && !warStanding(current, them, us).dictates) {
        const theirs = current.map.polities.find((polity) => polity.id === them)?.name ?? them;
        rejected.push({ delta, written, reason: `Peace with ${theirs} is not the order's to declare: the war is not won. It is asked for and bargained over with their envoy, or sent to them as terms.`, kind: "world", ofTheOrder });
        current = previous;
        restoreHandles(assignedIds, previousHandles);
        continue;
      }
    }
    let authority: AuthorityCheckResult;
    let answerable = true;
    try {
      const scope = scopeOf(delta, current, resolve, context.actorRef);
      // The player's own money is spent by the player. The world moving beside
      // an order may ruin him -- cut his trade, burn his stall, sue him -- but it
      // may not decide what he pays for: asked who paid for a spectacle, it once
      // answered "the merchant", and spent the purse his order needed.
      // A rule the world wrote may take from a purse it holds a warrant for,
      // the player's included: he can see the rule and the toll it takes, which
      // is not the world deciding what he pays for behind his back.
      // Nor does it decide what he means to do. "Privately consider how to
      // undermine the rival who has opposed me" was written into the ruler's
      // mind by the world's own business (R76): what befalls him is the
      // world's, what he intends is his.
      if (delta.op === "character_intent_set" && context.playerCharacterId != null && !ofTheOrder
        && (resolve(delta.actorCharacterRef) ?? delta.actorCharacterRef) === context.playerCharacterId
        && (context.actsForTheWorld === true || context.actorRef.id !== context.playerCharacterId)) {
        rejected.push({ delta, written, reason: "What the ruler intends is his own to say: the world may press on him, tempt him or threaten him, but not decide his mind for him.", kind: "world", ofTheOrder });
        current = previous;
        restoreHandles(assignedIds, previousHandles);
        continue;
      }
      const warranted = context.firingMechanic !== undefined && scope.kind === "account" && context.firingMechanic.warrantedAccountIds.has(scope.id);
      if (context.actsForTheWorld === true && !ofTheOrder && context.playerCharacterId != null && scope.kind === "account" && !warranted) {
        const account = current.material.accounts.find((candidate) => candidate.id === scope.id);
        if (account?.owner.kind === "character" && account.owner.id === context.playerCharacterId) {
          rejected.push({ delta, written, reason: `${account.id} is the player's own purse, and the world does not spend it for him: take it from somebody else, or leave it to his order.`, kind: "reference", ofTheOrder });
          current = previous;
          restoreHandles(assignedIds, previousHandles);
          continue;
        }
      }
      // A slave's purse is his master's. Asked first, because the owner's
      // grant over a purse would otherwise say it is his to spend.
      const unfree = context.actorRef.kind === "character" ? notHisToSpend(delta, current, context.actorRef.id, resolve) : null;
      if (unfree !== null) {
        rejected.push({ delta, written, reason: unfree, kind: "ignored", ofTheOrder });
        continue;
      }
      const flight = context.actorRef.kind === "character" ? fleesHisMaster(delta, current, context.actorRef.id) : null;
      if (flight !== null) {
        emitted.push({
          localId: `fled_${context.actorRef.id}`.slice(0, 60), kind: "runaway", summary: flight,
          affectedRefs: [{ kind: "character", id: context.actorRef.id }], visibility: "public", discoveryState: "public", knowableInDays: 0, significance: 35,
        });
      }
      // His words, his letters, what he founds with his own money: nobody's
      // authority is in question, at home or abroad.
      const ownBusiness = context.actorRef.kind === "character" && isOwnBusiness(delta, current, context.actorRef.id, resolve);
      answerable = !ownBusiness && actorIsAnswerableFor(delta, scope, current, context, ofTheOrder);
      // The order reaching into another power: no breach, since a Roman owes
      // Carthage no obedience to break, but no free pass either.
      const reachesAbroad = !ownBusiness && ofTheOrder && !answerable && actsInsideAnotherPower(scope, current, context);
      authority = checkAuthority(
        authorityIndex,
        {
          holder: context.actorRef,
          domain: DELTA_AUTHORITY_DOMAIN[delta.op],
          scope,
          power: powerOf(delta),
        },
        // Without this, `checkAuthority` matches scopes only exactly, so a
        // grant over Rome covered nothing *in* Rome: a consul with authority
        // over his own republic was recorded as insubordinate for putting a
        // motion to its own Senate.
        (granted, wanted) => granted.kind === "polity" && polityOfScope(wanted, current, context.offices) === granted.id,
      );
      authority = withinVotedBudget(authority, current, context.actorRef, scope, delta);
      // A colleague's army and an elected seat are not the government's to
      // hand about, however wide its grant (`whose-to-give.ts`).
      if (answerable && context.actorRef.kind === "character") {
        const judged = whoseToGive(delta, current, context.actorRef.id, authority, context.offices, context.successionRules, resolve);
        authority = judged.authority;
        // Not unlawful but done: not done at all. A motion nobody could put,
        // an act a tribune forbade.
        if (judged.forbidden !== undefined) {
          rejected.push({ delta, written, reason: judged.forbidden, kind: "ignored", ofTheOrder });
          continue;
        }
        // Done another way: put by the magistrate who agreed to, or made without the seat.
        if (judged.instead !== undefined) delta = judged.instead;
        if (judged.fact !== undefined) emitFact(judged.fact);
        // A favour asked of a man is put to him, and he answers it (`requests.ts`).
        if (judged.request !== undefined) {
          const asked = askOf(current, context.offices, context.ids, { issuerId: context.actorRef.id, ...judged.request });
          current = asked.world;
          applied.push({ delta, written, authority, ofTheOrder, changed: true });
          factProposals.push(...emitted, asked.fact);
          continue;
        }
      }
      // Carried by the chamber whose question it was: the vote is the authority.
      if (context.sanctionedDeltas?.has(written) === true && !authority.authorized) {
        authority = { ...authority, authorized: true, reason: "Carried by the vote it waited on." };
      }
      // An act outside one's authority happens only if the men, money or
      // ground it needs answer to the actor. Otherwise nobody moves.
      if (context.actorRef.kind === "character") {
        const unheard = delta.op === "polity_create"
          ? nobodyRises(delta, current, context.actorRef.id)
          : (answerable || reachesAbroad) && !authority.authorized
            ? nobodyListens(delta, current, context.actorRef.id, resolve, new Set(assignedIds.values()), context.offices, reachesAbroad)
            : null;
        // Nobody had to -- but somebody might, for the man's sake or their own.
        const willing = unheard === null || delta.op === "polity_create" ? null : listensAnyway(delta, current, context.actorRef.id, resolve, context.offices);
        if (unheard !== null && willing === null) {
          // War and peace not his to make are put to the chamber that makes
          // them, with him moving it. The act waits on the vote and is done
          // the day it carries (`advanceStages`, `sanctionedDeltas`).
          const motion = ofTheOrder && context.actorRef.kind === "character" ? layBeforeTheChamber(delta, current, context.actorRef.id, resolve) : null;
          let declined = "";
          if (motion !== null) {
            // Put by him, or by a magistrate he asks who agrees to put it (`whoseToGive`).
            const moved = applyUngroupedDeltas(current, [motion], { ...context, atomicGroups: undefined, assignedIds, orderDeltas: new Set([motion]) });
            declined = moved.rejected.length > 0 ? ` ${moved.rejected[0]!.reason}` : "";
            if (moved.applied.length > 0) {
              current = moved.world;
              for (const [handle, id] of moved.assignedIds) assignedIds.set(handle, id);
              applied.push(...moved.applied);
              factProposals.push(...moved.factProposals);
              breaches.push(...moved.breaches);
              rejected.push({ delta, written, reason: `${unheard} He moved it in the chamber instead, and it waits on the vote.`, kind: "ignored", ofTheOrder });
              continue;
            }
          }
          rejected.push({ delta, written, reason: `${unheard}${declined}`, kind: "ignored", ofTheOrder });
          continue;
        }
        if (willing !== null) {
          emitted.push({
            localId: `willing_${willing.listenerId}_${delta.op}`.slice(0, 60),
            kind: "done_unbidden",
            summary: willing.why,
            affectedRefs: [{ kind: "character", id: willing.listenerId }, { kind: "character", id: context.actorRef.id }],
            visibility: "polity",
            discoveryState: "polity",
            knowableInDays: 0,
            significance: 40,
          });
        }
      }
      const beforeAct = current;
      current = recordUnrecordedMoney(beforeAct, applyOne(current, delta, ofTheOrder ? { ...context, forTheOrder: true } : context, assignedIds, resolve, emitFact, emitAccount), delta, context);
      current = chargeVotedBudget(beforeAct, current, authority, delta);
      current = reconcileCapitals(current);
      // A tribune's person is sacrosanct.
      const sacrilege = context.actorRef.kind === "character" ? sacrilegeOf(delta, beforeAct, current, context.actorRef.id, context.offices, () => context.ids.next("cause")) : null;
      if (sacrilege !== null) {
        current = sacrilege.world;
        emitFact(sacrilege.fact);
      }
      // Whoever an army was taken from is told (a man giving his own away needs no telling).
      for (const told of commandChanges(beforeAct, current, ofTheOrder && context.actorRef.kind === "character" ? new Set([context.actorRef.id]) : new Set())) emitFact(told);
    } catch (error) {
      if (error instanceof DeltaRejection) {
        rejected.push({ delta, written, reason: error.message, kind: error.kind, ofTheOrder });
        current = previous;
        restoreHandles(assignedIds, previousHandles);
        continue;
      }
      // One bad delta is one bad delta. Rethrown, it left `applyDeltas`
      // entirely and took the whole burst with it: every other change in the
      // batch was lost, and the player's order came back as a failure of the
      // engine rather than of the one thing that went wrong. A handler can
      // always be reached with something it did not expect -- a field a schema
      // change made optional, a shape nobody anticipated -- and the worst that
      // should cost is the delta that carried it.
      rejected.push({
        delta,
        written,
        reason: `The engine could not carry out "${delta.op}": ${error instanceof Error ? error.message : String(error)}.`,
        kind: "reference",
        ofTheOrder,
      });
      current = previous;
      restoreHandles(assignedIds, previousHandles);
      continue;
    }

    const afterViolations = findWorldReferenceViolations(current);
    const introduced = afterViolations.filter((violation) => !violations.has(violation));
    if (introduced.length > 0) {
      rejected.push({ delta, written, reason: `Would leave a reference to something that does not exist: ${introduced[0]}.`, kind: "reference", ofTheOrder });
      current = previous;
      restoreHandles(assignedIds, previousHandles);
      continue;
    }
    violations = new Set(afterViolations);
    // And nothing it leaves may contradict another record (`invariants.ts`):
    // a second voyage on a fleet already sailing, a man in two armies, a
    // person made twice.
    const afterInvariants = findInvariantViolations(current);
    const broken = afterInvariants.filter((violation) => !invariants.has(violation));
    if (broken.length > 0) {
      rejected.push({ delta, written, reason: `It would leave the world at odds with itself: ${broken[0]}.`, kind: "world", ofTheOrder });
      current = previous;
      restoreHandles(assignedIds, previousHandles);
      continue;
    }
    invariants = new Set(afterInvariants);

    // An answer to an order already answered changes nothing, and is no part
    // of anybody's order (`order_attempt_decide`). A man "made" who turned out
    // to be somebody already living is nobody new: nothing changed, and nothing
    // is reported or answered for (E12).
    const changed = (delta.op === "diplomatic_message_send" ? current.diplomacy.length > previous.diplomacy.length
      : delta.op !== "character_create" || current.characters.length > previous.characters.length)
      && (delta.op !== "order_attempt_decide" || current.orderAttempts !== previous.orderAttempts);
    applied.push({ delta, written, authority, ofTheOrder, changed, madeMoney: moneyMadeBetween(previous, current) });
    if (changed && assumed.length > 0) assumptions.push({ delta, assumed, ofTheOrder });
    if (changed) factProposals.push(...emitted);
    battleAccounts.push(...emittedAccounts);
    if (changed && answerable && !authority.authorized) breaches.push({ delta, reason: authority.reason });
    // A letter over the government's name from a man who cannot bind it is
    // delivered, and read as what it is: accepted, it waits on ratification.
    if (changed && answerable && !authority.authorized && delta.op === "diplomatic_message_send") {
      const sent = new Set(previous.diplomacy.map((message) => message.id));
      current = { ...current, diplomacy: current.diplomacy.map((message) => (sent.has(message.id) ? message : { ...message, withoutAuthority: true })) };
    }
  }

  // One structural check at the end rather than per delta: the per-delta guard
  // above already catches the realistic failure, and re-parsing a whole world
  // once per delta is not worth the marginal safety.
  const parsed = WorldStateSchema.safeParse(current);
  // Only what this batch broke is this batch's fault. A world already invalid
  // when it came in -- a plan step slipped past its limit by the tick -- had
  // every batch after it refused as "would have left the world invalid", the
  // player's order with them, and was then saved anyway (E1).
  const broke = parsed.success ? [] : newIssues(parsed.error.issues, world);
  if (!parsed.success && broke.length === 0) {
    return { world: current, applied, rejected, breaches, factProposals, battleAccounts, assignedIds, assumptions };
  }
  if (!parsed.success) {
    return {
      world,
      applied: [],
      battleAccounts: [],
      breaches: [],
      rejected: deltas.map((delta) => ({
        delta,
        // The path matters more than the message: "Too small: expected array to
        // have >=1 items" names nothing on its own.
        reason: `The batch would have left the world invalid: ${describeIssue(broke[0])}.`,
        kind: "reference" as const,
      })),
      factProposals: [],
      assignedIds: new Map(),
      assumptions: [],
    };
  }

  return { world: parsed.data, applied, rejected, breaches, factProposals, battleAccounts, assignedIds, assumptions };
}

/** Basis points never leave 0..10 000, and the schema refuses anything that does. */
function clampBps(value: number): number {
  return Math.max(0, Math.min(10_000, Math.round(value)));
}

/** The signed -100..100 score every political cause is weighed on. */
function clampScore(value: number): number {
  return Math.max(-100, Math.min(100, Math.round(value)));
}

/** A Zod issue as something a person can act on: where it was, then what was wrong. */
function describeIssue(issue: { path: PropertyKey[]; message: string } | undefined): string {
  if (issue === undefined) return "unknown";
  const where = issue.path.map(String).join(".");
  return where.length === 0 ? issue.message : `${where}: ${issue.message}`;
}

function characterName(world: WorldState, id: string): string {
  return world.characters.find((character) => character.id === id)?.name ?? "somebody";
}

function polityName(world: WorldState, id: string): string {
  return world.map.polities.find((polity) => polity.id === id)?.name ?? id;
}

/**
 * A letter, as the record has it.
 *
 * Letters were objects in the world and nothing else: Rome wrote to Messana
 * and to Syracuse, Messana accepted, Hieron countered and wrote back -- and
 * the historian, who writes from facts, was told none of it. Sending one and
 * answering one are things that happened between two powers, known to both
 * (and to everybody, for an open letter; to the two writers, for a secret one).
 */
function letterFact(world: WorldState, letter: {
  readonly localId: string;
  readonly kind: string;
  readonly summary: string;
  readonly fromPolityId: string;
  readonly toPolityId: string;
  readonly characterIds: readonly string[];
  readonly visibility: "public" | "polity" | "private";
  readonly significance: number;
  /** Days it is on the road: what it says is not known where it is going until it gets there. */
  readonly travelDays?: number;
}): FactProposalDraft {
  const people = [...new Set(letter.characterIds)].filter((id) => world.characters.some((character) => character.id === id));
  const characters = people.map((id) => ({ kind: "character" as const, id }));
  return {
    localId: letter.localId.slice(0, 60),
    kind: letter.kind,
    summary: letter.summary.slice(0, 600),
    affectedRefs: [...characters, { kind: "polity" as const, id: letter.fromPolityId }, ...(letter.toPolityId === letter.fromPolityId ? [] : [{ kind: "polity" as const, id: letter.toPolityId }])],
    visibility: letter.visibility,
    discoveryState: (letter.travelDays ?? 0) > 0 ? "delayed" : letter.visibility,
    knowableInDays: letter.travelDays ?? 0,
    knownToRefs: letter.visibility === "private" ? characters : [],
    significance: letter.significance,
  };
}

/** A crossing of the strait itself, with the hulls on the beach: a day over, a day to land. */
const CROSSING_DAYS = 2;

/** The calendar month the act happens in, where the scenario's clock is known. */
const monthOf = (context: ApplyContext): number | null => (context.clock === undefined ? null : monthOfDay(context.now.day, context.clock));

/** Words that say nothing about which work a project is. */
const WORK_FILLER = new Set(["the", "and", "for", "from", "with", "into", "onto", "new", "project", "work", "works"]);

/**
 * Whether two projects are one work written twice: the same kind, and labels
 * whose words are the same, or one's words all found in the other's --
 * "Survey of the Anio water" and "Anio water survey" alike.
 */
export function sameWork(kindA: string, labelA: string, kindB: string, labelB: string): boolean {
  if (kindA.trim().toLowerCase() !== kindB.trim().toLowerCase()) return false;
  const words = (label: string): Set<string> => new Set(label.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2 && !WORK_FILLER.has(word)));
  const a = words(labelA);
  const b = words(labelB);
  if (a.size === 0 || b.size === 0) return labelA.trim().toLowerCase() === labelB.trim().toLowerCase();
  const [fewer, more] = a.size <= b.size ? [a, b] : [b, a];
  return fewer.size >= Math.min(2, more.size) && [...fewer].every((word) => more.has(word));
}

/** Acts that commit money, men or ground, which an order may make wait on a vote. */
const MAY_AWAIT_A_VOTE = new Set<WorldDelta["op"]>([
  "money_transfer", "service_contract_open", "loan_open", "project_create", "force_create", "force_modify", "force_engage",
  "holding_create", "trade_venture_open", "obligation_upsert", "agreement_open", "siege_lay", "force_raid",
]);

/** The words that make an act hang on something not yet known, and what follows them. */
const CONDITION = /\b(only if|only once|only when|unless|in case|if)\b([^.;]{0,120})/gi;
/** What a condition says about the outcome it waits for; one that says neither is not about a vote. */
const AGAINST = /\b(?:not|refuses?|rejects?|declines?|fails?|won't|doesn't|don't|denies|votes? (?:it )?down)\b/i;
const FOR = /\b(?:passes|pass|approves?|grants?|agrees?|accepts?|carries|supports?|votes? for|gives?)\b/i;

/**
 * The agreement an accepted letter opens: its kind, its parties the right way
 * round, its clauses. Shared by the acceptance and by a ratification carried
 * later (`ratification.ts`).
 */
export function acceptedAgreementDelta(replied: WorldState, message: WorldState["diplomacy"][number], kind: PolityAgreementKind, bound: string | null): WorldDelta {
  // Which power is bound is the whole of the terms for these; the power that
  // accepts an offer to be taken in is the one taken in.
  const ordered = ["tributary", "protectorate", "foedus", "military_access"].includes(kind);
  const [first, second] = ordered && bound === message.fromPolityId
    ? [message.fromPolityId, message.toPolityId]
    : [message.toPolityId, message.fromPolityId];
  return {
    op: "agreement_open",
    localId: `accepted_${message.id}`.slice(0, 60),
    kind,
    polityId: first,
    otherPolityId: second,
    terms: message.terms.slice(0, 600),
    forDays: message.forDays ?? null,
    sourceMessageRef: message.id,
    visibility: message.visibility === "private" ? "polity" : "public",
    reason: `${polityName(replied, message.toPolityId)} accepted "${message.subject}".`.slice(0, 240),
    // The terms it offered are the treaty's clauses, carried out now.
    ...(message.clauses === undefined ? {} : { clauses: message.clauses as NonNullable<Extract<WorldDelta, { op: "agreement_open" }>["clauses"]> }),
  };
}

/**
 * War, peace or a treaty ended, by a man whose office does not make them, as
 * the motion he can make instead: put to the chamber of his own power that
 * decides it, with him moving it. Null where no chamber decides it -- a king's
 * war is the king's -- or the act is not his own power's.
 */
export function layBeforeTheChamber(delta: WorldDelta, world: WorldState, actorId: string, resolve: (ref: string) => string | undefined): WorldDelta | null {
  if (delta.op !== "agreement_open" && delta.op !== "agreement_close") return null;
  const kind = delta.op === "agreement_open" ? delta.kind : world.polityAgreements.find((candidate) => candidate.id === (resolve(delta.agreementRef) ?? delta.agreementRef))?.kind;
  if (kind === undefined || !SOVEREIGN_AGREEMENTS.has(kind)) return null;
  const actor = world.characters.find((character) => character.id === actorId);
  if (actor === undefined || actor.polityId === null) return null;
  const ours = actor.polityId;
  let other: string | undefined;
  let what: string;
  if (delta.op === "agreement_open") {
    const sides = [resolve(delta.polityId) ?? delta.polityId, resolve(delta.otherPolityId) ?? delta.otherPolityId];
    if (!sides.includes(ours)) return null;
    other = sides.find((id) => id !== ours);
    what = delta.kind === "war" ? "war on" : `${delta.kind.replace(/_/g, " ")} with`;
  } else {
    const agreement = world.polityAgreements.find((candidate) => candidate.id === (resolve(delta.agreementRef) ?? delta.agreementRef));
    if (agreement === undefined || (agreement.polityId !== ours && agreement.otherPolityId !== ours)) return null;
    other = agreement.polityId === ours ? agreement.otherPolityId : agreement.polityId;
    what = `an end to the ${agreement.kind.replace(/_/g, " ")} with`;
  }
  const chamber = chamberThatDecides(world, ours, "war");
  if (chamber === undefined || other === undefined) return null;
  const otherName = world.map.polities.find((polity) => polity.id === other)?.name ?? other;
  // Only a magistrate who may convene the chamber puts a question to it. A
  // private man's motion is his own; who will put it for him is asked when it
  // is put (`whoseToGive`, `askAConvener`), rather than the friendliest
  // consul's name written on it unasked (L5).
  const war = delta.op === "agreement_open" && delta.kind === "war";
  return {
    op: "political_procedure_open",
    localId: `motion_${"localId" in delta ? delta.localId : delta.op}`.slice(0, 60),
    type: war || delta.op === "agreement_close" ? "council_deliberation" : "treaty_ratification",
    institutionRef: chamber.id,
    sponsorCharacterRef: actorId,
    subjectKind: "polity",
    subjectRef: other,
    label: `Motion of ${actor.name}: ${what} ${otherName}`.slice(0, 200),
    resolutionMechanism: "vote",
    deadlineInDays: 10,
    visibility: "public",
    enacts: null,
    concerns: [war || delta.op === "agreement_close" ? "war" : "peace"],
    reason: `${actor.name} holds no office that makes ${war ? "war" : "treaties"}, and moved it in the ${chamber.name}.`.slice(0, 240),
  } as WorldDelta;
}

/**
 * An act the order made conditional on a question still undecided, made to
 * wait for it.
 *
 * "Get a shipmaster to hire fifty ships, using my personal money if Rome does
 * not support it" was one clause of an order whose other clause put the fleet
 * to the Senate. The shipmaster was hired and his 900 paid on the spot, before
 * any senator had voted -- the condition was in the words, and nothing read
 * the words. The engine cannot know whether a condition holds before it does;
 * it can know that one was stated and that a question it could be about is
 * pending. Then the act becomes what a conditional plan is (`contingency_arm`,
 * "stand_to"): it waits on the vote, and when the vote is in the ruler is
 * handed his own words back to act on, with the outcome known.
 *
 * Only where the condition names the question, its chamber, the power it is
 * put to or the vote itself: an "if" about the weather is not about the Senate.
 */
export function awaitingTheQuestion(
  delta: WorldDelta,
  world: WorldState,
  context: ApplyContext,
  madeThisBatch: ReadonlySet<string>,
): { readonly delta: WorldDelta; readonly fact: FactProposalDraft } | null {
  if (!MAY_AWAIT_A_VOTE.has(delta.op) || context.actorRef.kind !== "character") return null;
  const actor = world.characters.find((character) => character.id === context.actorRef.id);
  if (actor === undefined || actor.polityId === null) return null;
  const record = delta as Record<string, unknown>;
  const said = ["reason", "label", "duties", "terms", "title"]
    .map((key) => record[key])
    .filter((value): value is string => typeof value === "string")
    .join(". ");
  // Each condition, with the outcome it waits for: "if Rome does not support
  // it" waits for a refusal, "unless the Senate pays" for the same.
  const clauses = [...said.matchAll(CONDITION)].flatMap((match) => {
    const text = match[2] ?? "";
    const against = AGAINST.test(text);
    if (!against && !FOR.test(text)) return [];
    const unless = match[1]!.toLowerCase() === "unless";
    return [{ text, outcome: against !== unless ? "failed" as const : "passed" as const }];
  });
  if (clauses.length === 0) return null;
  const pending = world.material.politicalProcedures.filter((procedure) => {
    if (procedure.resolvedAtStep !== null) return false;
    const chamber = world.material.institutions.find((institution) => institution.id === procedure.institutionId);
    return chamber?.polityId === actor.polityId || procedure.sponsorCharacterId === actor.id;
  });
  if (pending.length === 0) return null;
  const words = (text: string): string[] => text.toLowerCase().split(/[^a-z]+/).filter((word) => word.length >= 5);
  const polityName = world.map.polities.find((polity) => polity.id === actor.polityId)?.name ?? "";
  const scored = pending.map((procedure) => {
    const chamber = world.material.institutions.find((institution) => institution.id === procedure.institutionId);
    const marks = new Set([...words(procedure.label), ...words(chamber?.name ?? ""), ...words(polityName),
      "senate", "assembly", "council", "motion", "decree", "support", "vote", "votes", "voted"]);
    const hits = clauses.filter((clause) => clause.text.toLowerCase().split(/[^a-z]+/).some((word) => marks.has(word) || (word.length >= 4 && [...marks].some((mark) => mark.startsWith(word)))));
    // A question opened in this very answer is the likeliest one meant.
    return { procedure, hits, fresh: madeThisBatch.has(procedure.id) };
  }).filter((entry) => entry.hits.length > 0)
    .sort((a, b) => Number(b.fresh) - Number(a.fresh) || b.hits.length - a.hits.length || b.procedure.openedAtStep - a.procedure.openedAtStep);
  const chosen = scored[0];
  if (chosen === undefined) return null;
  const outcome = chosen.hits[0]!.outcome;
  const provinceId = actor.locationProvinceId
    ?? world.map.provinces.find((province) => province.controllerPolityId === actor.polityId)?.id
    ?? world.map.provinces[0]?.id;
  if (provinceId === undefined) return null;
  const label = (typeof record.label === "string" ? record.label : typeof record.reason === "string" ? record.reason : delta.op).slice(0, 160);
  const localId = ("localId" in delta && typeof delta.localId === "string" ? `awaits_${delta.localId}` : `awaits_${delta.op}_${chosen.procedure.id}`).slice(0, 60);
  const waiting: WorldDelta = {
    op: "contingency_arm",
    localId,
    label: `${label} (once the vote on ${chosen.procedure.label} is in)`.slice(0, 160),
    ownerCharacterRef: actor.id,
    trigger: { kind: "question_decided", procedureId: chosen.procedure.id, outcome },
    effect: "stand_to",
    provinceId,
    positionId: null,
    againstPolityId: null,
    fundingAccountRef: null,
    spend: 0,
    ambushForceRef: null,
    expiresInDays: null,
    standingOrder: said.slice(0, 400),
    reason: said.slice(0, 400) || label,
  };
  return {
    delta: waiting,
    fact: {
      localId: `awaits_${localId}`.slice(0, 60),
      kind: "order_awaits_vote",
      summary: `${actor.name} held back "${label}" until the vote on "${chosen.procedure.label}" is in, to be done if it ${outcome === "failed" ? "fails" : "passes"}.`.slice(0, 600),
      affectedRefs: [{ kind: "character", id: actor.id }],
      visibility: "private",
      discoveryState: "private",
      knowableInDays: 0,
      knownToRefs: [{ kind: "character", id: actor.id }],
      significance: 20,
    },
  };
}

/**
 * The marches an army is on that a new order for it overrides.
 *
 * An army goes where it was last told. Hieron's squadron was sent the wrong
 * way round Sicily, sent again the right way, and the first journey was never
 * called off: the tick walked it into Panormus anyway, and a battle was fought
 * at a place nobody had ordered it to. A new move cancels every march under
 * way for that army except one already bound where it is now sent (`keepTo`),
 * and the men's turning back is said.
 */
/**
 * Whether a force is on a journey the man it answers to set going, and the
 * one now sending it elsewhere is somebody else -- its own hired captain, say.
 * The transport hired to carry Legio I was on its way to the shore when its
 * captain sailed it off toward Rhegium on his own account, the sailing was
 * called off, and the crossing failed for want of it. Its master may turn it.
 */
function keptToItsWork(world: WorldState, forceId: string, actorId: string, to: string): boolean {
  const force = world.material.forces.find((candidate) => candidate.id === forceId);
  if (force === undefined || force.controllerCharacterId === null || force.controllerCharacterId === actorId) return false;
  const master = force.controllerCharacterId;
  return world.projects.some((project) => project.status === "in_progress"
    && project.sponsorEntityRef?.kind === "character" && project.sponsorEntityRef.id === master
    && project.completionOutcome?.kind === "force_move" && project.completionOutcome.provinceId !== to
    && (project.completionOutcome.forceId === forceId || (project.completionOutcome.fleetIds ?? []).includes(forceId)));
}

function callOffMarches(
  world: WorldState,
  forceId: string,
  keepTo: string | null,
  emitFact: (fact: FactProposalDraft) => void,
  // The journeys the new order leaves standing: by default those already on
  // its way (`onTheWayTo`).
  keeps: (project: WorldState["projects"][number]) => boolean = (project) => keepTo !== null && onTheWayTo(world, project, keepTo),
): WorldState {
  const overridden = journeysOf(world, forceId).filter((project) => !keeps(project));
  if (overridden.length === 0) return world;
  const cancelled = new Set(overridden.map((project) => project.id));
  const force = world.material.forces.find((candidate) => candidate.id === forceId);
  const provinceName = (id: string | null): string => world.map.provinces.find((province) => province.id === id)?.name ?? id ?? "where it was going";
  // It goes on from where the road had brought it, not from home with the
  // days already walked thrown away. A crossing's army has not left the shore.
  const walk = overridden.find((project) => project.kind !== "crossing");
  const onTheRoad = force === undefined || walk === undefined ? force : turnOnTheRoad(world, force, walk);
  for (const project of overridden) {
    const near = project === walk && onTheRoad !== undefined && onTheRoad.locationId !== force?.locationId ? provinceName(onTheRoad.locationId) : null;
    emitFact({
      localId: `called_off_${project.id}`.slice(0, 60),
      kind: "march_called_off",
      summary: `${force?.name ?? forceId} turned ${near === null ? "back from the road to" : `on the road near ${near}, short of`} ${provinceName(project.completionOutcome?.provinceId ?? null)}${keepTo === null ? "" : ` and makes for ${provinceName(keepTo)} instead`}: a later order sent it elsewhere, and "${project.label}" is called off.`.slice(0, 600),
      affectedRefs: [{ kind: "force", id: forceId }, { kind: "project", id: project.id }],
      visibility: "polity",
      discoveryState: "polity",
      knowableInDays: 0,
      // The man whose work it was is told: a second project of Carthage's
      // took the fleet the first was waiting on, and the first never knew.
      knownToRefs: [
        ...(project.sponsorEntityRef?.kind === "character" ? [{ kind: "character" as const, id: project.sponsorEntityRef.id }] : []),
        ...(force === undefined ? [] : [{ kind: "character" as const, id: force.controllerCharacterId }]),
      ],
      significance: 35,
    });
  }
  const projects = world.projects.map((project) => (cancelled.has(project.id) ? { ...project, status: "cancelled" as const } : project));
  return onTheRoad === undefined || onTheRoad === force
    ? { ...world, projects }
    : { ...world, projects, material: { ...world.material, forces: world.material.forces.map((candidate) => (candidate.id === forceId ? onTheRoad : candidate)) } };
}

/** The years a term of service runs, as written: "10 years", "ten years". Null when it names none. */
function yearsIn(terms: string): number | null {
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, twenty: 20, thirty: 30 };
  const match = /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty|thirty)\s+years?\b/i.exec(terms);
  if (match === null) return null;
  const value = /^\d+$/.test(match[1]!) ? Number(match[1]) : words[match[1]!.toLowerCase()]!;
  return value > 0 && value <= 40 ? value : null;
}

/**
 * A crossing that has to be arranged before it can be made (`passagePlanFor`):
 * the fleets sail to the shore, the army walks to it, and then it goes over.
 *
 * Three pieces of ordinary work -- a sailing, a march, a crossing -- each a
 * project the tick already knows how to finish, and the crossing waits for the
 * other two (`waitsForItsLegs`). Its stages are the engine's, from the plan, so
 * a crossing can no longer say it meets the legion at Rhegium while the legion
 * is left in Rome.
 */
function arrangeCrossing(
  world: WorldState,
  sent: Force,
  to: string,
  planned: PassagePlan,
  localId: string,
  context: ApplyContext,
  assignedIds: Map<string, string>,
  resolve: (ref: string) => string | undefined,
  emitFact: (fact: FactProposalDraft) => void,
  emitAccount: (account: BattleAccount) => void,
): WorldState {
  // Told again to cross where its crossing is already arranged, it is that
  // crossing under way, not a second one announced.
  const arranged = journeysOf(world, sent.id).find((project) => project.kind === "crossing" && project.completionOutcome?.provinceId === to);
  if (arranged !== undefined) {
    assignedIds.set(localId, arranged.id);
    return world;
  }
  // Its own walk to the shore is the crossing's march, not one to call off:
  // the legion told to make for Messana while it walked to Rhegium to take
  // ship for Messana turned back, and began again from Latium.
  const toTheShore = (shore: string) => (project: WorldState["projects"][number]): boolean => project.kind !== "crossing" && project.completionOutcome?.provinceId === shore;
  const fleetIds = planned.fleets.map((entry) => entry.fleet.id);
  const making = shoreItMakesFor(world, sent, to);
  const fromThere = making === null ? null : passagePlanFor(world, { ...sent, locationId: making.shore }, to, warfareWith(world, context.warfare), monthOf(context), fleetIds);
  const chosen = making !== null && fromThere?.embarkProvinceId === making.shore ? { ...fromThere, marchKm: making.marchKm } : planned;
  let next = callOffMarches(world, sent.id, to, emitFact, (project) => project.completionOutcome?.provinceId === to || toTheShore(chosen.embarkProvinceId)(project));
  const army = next.material.forces.find((force) => force.id === sent.id) ?? sent;
  // Turned on the road, it takes ship from the shore best reached from where it got to.
  const plan = army.locationId === sent.locationId ? chosen
    : passagePlanFor(next, army, to, warfareWith(next, context.warfare), monthOf(context), fleetIds) ?? chosen;
  const walking = journeysOf(next, army.id).find(toTheShore(plan.embarkProvinceId));
  const gatherDays = walking === undefined ? plan.gatherDays
    : Math.max(1, walking.startedAtStep + Math.max(0, ...walking.milestones.map((milestone) => milestone.requiredAtElapsedOffset)) - next.elapsedStep, ...plan.fleets.map((entry) => sailDaysFor(entry.sailKm)));
  const provinceName = (id: string): string => world.map.provinces.find((province) => province.id === id)?.name ?? id;
  const shore = provinceName(plan.embarkProvinceId);
  const leg = (mover: Force, days: number, kind: "march" | "sailing"): WorldDelta => ({
    op: "project_create",
    localId: `${kind}-${mover.id}`.slice(0, 60),
    kind,
    label: `${mover.name} ${kind === "march" ? "marches" : "sails"} to ${shore} for the crossing`.slice(0, 160),
    sponsorRef: context.actorRef,
    fundingAccountRef: null,
    milestones: [{ label: `Reaches ${shore}`.slice(0, 160), dueInDays: Math.max(1, days), costAmount: 0 }],
    completionOutcome: {
      kind: "force_move", label: `${mover.name} reaches ${shore}`.slice(0, 160), amount: 0,
      provinceId: plan.embarkProvinceId, polityId: null, commanderCharacterRef: null, forceRef: mover.id,
      beneficiaryAccountRef: null, cadenceDays: null, agreementKind: null, withPolityId: null,
    },
    reason: `To carry ${army.name} over to ${provinceName(to)}.`,
  });
  for (const entry of plan.fleets.filter((candidate) => candidate.sailKm > 0)) {
    next = applyOne(next, leg(entry.fleet, sailDaysFor(entry.sailKm), "sailing"), context, assignedIds, resolve, emitFact, emitAccount);
  }
  if (plan.marchKm > 0 && walking === undefined) next = applyOne(next, leg(army, Math.ceil(marchDaysFor(plan.marchKm)), "march"), context, assignedIds, resolve, emitFact, emitAccount);
  const fleets = plan.fleets.map((entry) => entry.fleet.name).join(" and ");
  const crossing: WorldDelta = {
    op: "project_create",
    localId,
    kind: "crossing",
    label: `${army.name} crosses to ${provinceName(to)} from ${shore}`.slice(0, 160),
    sponsorRef: context.actorRef,
    fundingAccountRef: null,
    milestones: [
      { label: `${army.name} and ${fleets} meet at ${shore}`.slice(0, 160), dueInDays: Math.max(1, gatherDays), costAmount: 0 },
      { label: `${army.name} is landed in ${provinceName(to)}`.slice(0, 160), dueInDays: Math.max(2, gatherDays + plan.crossingDays), costAmount: 0 },
    ],
    completionOutcome: null,
    reason: `${describePassagePlan(world, army, plan)}.`.slice(0, 400),
  };
  next = applyOne(next, crossing, context, assignedIds, resolve, emitFact, emitAccount);
  // The crossing's product is set here, not written through `project_create`:
  // it is the engine's, from a shore and fleets the model never named.
  const crossingId = assignedIds.get(localId);
  next = {
    ...next,
    projects: next.projects.map((project) => project.id !== crossingId ? project : {
      ...project,
      completionOutcome: {
        kind: "force_move" as const, label: `${army.name} arrives in ${provinceName(to)}`.slice(0, 160), amount: 0,
        provinceId: to, polityId: null, commanderCharacterId: null, forceId: army.id,
        beneficiaryAccountId: null, cadenceDays: null, agreementKind: null, withPolityId: null,
        fleetIds: plan.fleets.map((entry) => entry.fleet.id), embarkProvinceId: plan.embarkProvinceId,
      },
    }),
  };
  emitFact({
    localId: `crossing_${army.id}`.slice(0, 60),
    kind: "crossing_arranged",
    summary: `${describePassagePlan(world, army, plan)}: about ${gatherDays + plan.crossingDays} days until the last of it is landed in ${provinceName(to)}.`.slice(0, 600),
    affectedRefs: [{ kind: "force", id: army.id }, ...plan.fleets.map((entry) => ({ kind: "force" as const, id: entry.fleet.id })), { kind: "province", id: to }],
    visibility: "polity",
    discoveryState: "polity",
    knowableInDays: 0,
    significance: 45,
  });
  return next;
}

/**
 * An army sent somewhere it takes days to reach: a march project that moves it
 * on arrival, and word that it set out. `carried` says how it goes over water,
 * when it does. The rest of the order -- a new commander, fresh rations --
 * still happens today.
 */
function setOutOn(
  world: WorldState,
  force: Force,
  forceId: string,
  delta: Extract<WorldDelta, { op: "force_modify" }>,
  km: number,
  days: number,
  carried: string | null,
  context: ApplyContext,
  assignedIds: Map<string, string>,
  resolve: (ref: string) => string | undefined,
  emitFact: (fact: FactProposalDraft) => void,
  emitAccount: (account: BattleAccount) => void,
): WorldState {
  const provinceName = (id: string): string => world.map.provinces.find((province) => province.id === id)?.name ?? id;
  const to = delta.locationId!;
  // An army already on the road to that very place is not sent out
  // again: a commander asked three times in a season what to do
  // answered "move on Messana" three times, and three journeys were
  // made, three arrivals told. The march under way is the order
  // carried out; the rest of the order still happens today.
  // So is one sent to the shore its crossing leaves from: told Rhegium
  // while the crossing from Rhegium to Messana was arranged, the legion gave
  // the crossing up and set out from Latium again.
  const goesThere = (project: WorldState["projects"][number]): boolean => project.completionOutcome?.provinceId === to || project.completionOutcome?.embarkProvinceId === to;
  const underWay = journeysOf(world, forceId).some(goesThere);
  if (underWay) return applyOne(world, { ...delta, locationId: undefined }, context, assignedIds, resolve, emitFact, emitAccount);
  // A march kept as on the way (`onTheWayTo`) that this journey does not
  // take over is called off now, and the journey is reckoned again from
  // where the road had brought the army.
  const strayed = callOffMarches(world, forceId, to, emitFact, goesThere);
  if (strayed !== world) return applyOne(strayed, delta, context, assignedIds, resolve, emitFact, emitAccount);
  // Ships sail; only an army marches (R63).
  const sails = isNavalForce(force, warfareWith(world, context.warfare));
  const journey: WorldDelta = {
    op: "project_create",
    localId: `march-${forceId}`.slice(0, 60),
    kind: carried === null ? (sails ? "sailing" : "march") : "crossing",
    label: `${force.name} ${carried === null ? (sails ? "sails for" : "marches on") : "crosses to"} ${provinceName(to)}`.slice(0, 160),
    sponsorRef: context.actorRef,
    fundingAccountRef: null,
    milestones: [{ label: `Arrives in ${provinceName(to)}`.slice(0, 160), dueInDays: days, costAmount: 0 }],
    completionOutcome: {
      kind: "force_move", label: `${force.name} arrives in ${provinceName(to)}`.slice(0, 160), amount: 0,
      provinceId: to, polityId: null, commanderCharacterRef: null, forceRef: forceId,
      beneficiaryAccountRef: null, cadenceDays: null, agreementKind: null, withPolityId: null,
    },
    reason: carried === null ? `Marching about ${describeKm(km)}.` : `Crossing ${carried}.`,
  };
  const setOut = applyOne(world, journey, context, assignedIds, resolve, emitFact, emitAccount);
  // Turned, it goes on from where it got to; it did not set out from home again.
  const whence = wasTurnedOnTheRoad(force) ? `turned on the road near ${provinceName(force.locationId)} and makes` : `${sails ? "sailed" : "set out"} from ${provinceName(force.locationId)}`;
  emitFact({
    localId: `march_${forceId}`.slice(0, 60),
    kind: carried === null ? "march_begun" : "crossing_begun",
    summary: carried === null
      ? `${force.name} ${whence} for ${provinceName(to)}, about ${describeKm(km)} off: about ${days} days ${sails ? "at sea" : "on the road"}.`
      : `${force.name} began crossing from ${provinceName(force.locationId)} to ${provinceName(to)} ${carried}: about ${days} days until the last of it is over.`,
    affectedRefs: [{ kind: "force", id: forceId }, { kind: "province", id: to }],
    visibility: "polity",
    discoveryState: "polity",
    knowableInDays: 0,
    significance: carried === null ? 25 : 45,
  });
  return applyOne(setOut, { ...delta, locationId: undefined }, context, assignedIds, resolve, emitFact, emitAccount);
}

function applyOne(
  world: WorldState,
  delta: WorldDelta,
  context: ApplyContext,
  assignedIds: Map<string, string>,
  resolve: (ref: string) => string | undefined,
  /** For consequences the model is not permitted to author -- battle casualties. */
  emitFact: (fact: FactProposalDraft) => void,
  emitAccount: (account: BattleAccount) => void,
): WorldState {
  /**
   * A reference the handler cannot proceed without.
   *
   * Takes a possibly-absent ref rather than a string, because a handler
   * reaching for a field the schema would have defaulted must refuse rather
   * than throw. Every one of these is guaranteed present by the schema in the
   * live pipeline -- and "guaranteed by something else" is exactly the
   * assumption that turns one malformed delta into a crash the first time it
   * is wrong. `force_create` was written that way this week and found by a
   * test that fed it an unparsed payload.
   */
  const required = (ref: string | null | undefined, label: string): string => {
    if (ref === undefined || ref === null) reject(`${label} was not named.`, "reference");
    const resolved = resolve(ref);
    if (resolved === undefined) reject(`${label} refers to "${ref}", which nothing in this batch created.`, "reference");
    return resolved;
  };
  const mint = (prefix: string, localId: string | undefined): string => {
    const id = context.ids.next(prefix);
    if (localId !== undefined) assignedIds.set(localId, id);
    return id;
  };
  const atStep = world.elapsedStep;

  /**
   * A refusal that says what the writer probably meant.
   *
   * Engine ids are long -- `character-<burst uuid>-7` -- and a model copying
   * one back sometimes drops the prefix, writing `<burst uuid>-7`. The act is
   * then refused with "No character ... exists", which is true, unhelpful, and
   * gives the repair retry nothing to work with. Naming the near miss costs
   * nothing and is the difference between a lost intent and a corrected one.
   *
   * Deliberately a *message*, not a resolution. Binding a ref to something it
   * merely resembles is how one man's order ends up carried out by another.
   */
  const nearestTo = (ref: string): string => {
    const near = world.characters.find(
      (character) => character.id !== ref && (character.id.endsWith(`-${ref}`) || character.id.endsWith(ref)),
    );
    return near === undefined ? "" : ` Did you mean "${near.id}"?`;
  };

  /**
   * An offer accepted is the agreement it offered, made.
   *
   * Rome wrote to Messana taking the city in under Roman banners, Messana
   * accepted in so many words, and nothing stood between them afterwards: the
   * Mamertines went on begging Carthage for help and Hieron marched in, because
   * an accepted letter recorded an answer and bound nobody. So the engine opens
   * what was accepted -- through `agreement_open`, so foedus, war and
   * protection are judged exactly as a treaty written out would be. Where the
   * world will not have it (Messana already follows somebody by foedus), the
   * answer still stands and the reason is recorded.
   */
  const bindTheAcceptance = (replied: WorldState, message: WorldState["diplomacy"][number]): WorldState => {
    if (delta.op !== "diplomatic_message_answer") return replied;
    const offered = offeredAgreementKinds(message);
    const chosen = delta.agreementKind ?? null;
    const kind = chosen !== null && offered.includes(chosen)
      ? chosen
      : offered.length === 1 ? offered[0]! : null;
    if (kind === null) return replied;
    // Which power is bound is the whole of the terms for these; the power that
    // accepts an offer to be taken in is the one taken in.
    const bound = delta.boundPolityId == null ? message.toPolityId : resolve(delta.boundPolityId) ?? delta.boundPolityId;
    // Written by a man who could not bind his government: accepted, it waits
    // on the chamber that makes treaties, and is opened the day it ratifies.
    if (message.withoutAuthority === true && SOVEREIGN_AGREEMENTS.has(kind)) {
      const chamber = chamberThatDecides(replied, message.fromPolityId, "war");
      const sender = replied.characters.find((character) => character.id === message.fromCharacterId);
      if (chamber !== undefined && sender !== undefined && sender.alive) {
        const localId = `ratify_${message.id}`.slice(0, 60);
        const theirs = polityName(replied, message.toPolityId);
        const motion: WorldDelta = {
          op: "political_procedure_open", localId, type: "treaty_ratification", institutionRef: chamber.id, sponsorCharacterRef: sender.id,
          subjectKind: "polity", subjectRef: message.toPolityId,
          label: `Ratify the terms ${sender.name} agreed with ${theirs}: "${message.subject}"`.slice(0, 200),
          resolutionMechanism: "vote", deadlineInDays: 10, visibility: "public", enacts: null, concerns: [kind === "war" ? "war" : "peace"],
          reason: `${theirs} accepted terms written by a man who could not bind ${polityName(replied, message.fromPolityId)}; the ${chamber.name} decides whether they bind it.`.slice(0, 300),
        } as WorldDelta;
        try {
          const moved = applyOne(replied, motion, context, assignedIds, resolve, emitFact, emitAccount);
          const procedureId = assignedIds.get(localId);
          if (procedureId !== undefined) {
            emitFact(letterFact(moved, {
              localId: `awaits_ratification_${message.id}`,
              kind: "treaty_awaits_ratification",
              summary: `${theirs} accepted "${message.subject}", but ${sender.name} could not bind ${polityName(replied, message.fromPolityId)} to it: the ${chamber.name} must ratify it first.`,
              fromPolityId: message.fromPolityId,
              toPolityId: message.toPolityId,
              characterIds: [message.fromCharacterId],
              visibility: message.visibility === "private" ? "polity" : message.visibility,
              significance: 45,
            }));
            return { ...moved, diplomacy: moved.diplomacy.map((candidate) => (candidate.id === message.id
              ? { ...candidate, ratification: { procedureId, agreementKind: kind, boundPolityId: bound, status: "waiting" as const } }
              : candidate)) };
          }
        } catch (error) {
          if (!(error instanceof DeltaRejection)) throw error;
        }
      }
    }
    const opening = acceptedAgreementDelta(replied, message, kind, bound);
    try {
      const opened = applyOne(replied, opening, context, assignedIds, resolve, emitFact, emitAccount);
      const agreementId = opened.polityAgreements.find((agreement) => agreement.sourceMessageId === message.id && agreement.kind === kind)?.id ?? null;
      return { ...opened, diplomacy: opened.diplomacy.map((candidate) => (candidate.id === message.id ? { ...candidate, agreementId } : candidate)) };
    } catch (error) {
      if (!(error instanceof DeltaRejection)) throw error;
      emitFact(letterFact(replied, {
        localId: `unbound_${message.id}`,
        kind: "acceptance_unbound",
        summary: `${polityName(replied, message.toPolityId)} accepted "${message.subject}", but no ${kind.replace(/_/g, " ")} could be made of it: ${error.message}`,
        fromPolityId: message.fromPolityId,
        toPolityId: message.toPolityId,
        characterIds: [message.fromCharacterId],
        visibility: message.visibility,
        significance: 20,
      }));
      return replied;
    }
  };

  /**
   * An ultimatum refused is its threat carried out.
   *
   * "If they are not with us they are against us": the war opens when the
   * answer is a refusal -- by letter here, by silence in the tick -- through
   * `agreement_open`, so it is judged as any declaration would be.
   */
  const carryOutTheThreat = (replied: WorldState, message: WorldState["diplomacy"][number]): WorldState => {
    if (message.onRefusal !== "war" && message.onRefusal !== "war_if_attacked") return replied;
    // A threat of war for going on attacking waits for the attack: a refusal
    // of the words, with the pause kept, is not what it threatened (R15).
    if (threatWaitsOnAttack(message)) {
      emitFact(letterFact(replied, {
        localId: `threat_stands_${message.id}`,
        kind: "threat_stands",
        summary: `${polityName(replied, message.toPolityId)} refused "${message.subject}". ${polityName(replied, message.fromPolityId)}'s threat of war stands, and will be carried out if ${polityName(replied, message.toPolityId)} attacks.`,
        fromPolityId: message.fromPolityId,
        toPolityId: message.toPolityId,
        characterIds: [message.fromCharacterId],
        visibility: "public",
        significance: 40,
      }));
      return { ...replied, diplomacy: replied.diplomacy.map((candidate) => candidate.id === message.id ? { ...candidate, threatStandsSince: atStep } : candidate) };
    }
    const declaring: WorldDelta = {
      op: "agreement_open",
      localId: `threat_${message.id}`.slice(0, 60),
      kind: "war",
      polityId: message.fromPolityId,
      otherPolityId: message.toPolityId,
      terms: message.terms.slice(0, 600),
      forDays: null,
      sourceMessageRef: message.id,
      visibility: "public",
      reason: `${polityName(replied, message.toPolityId)} refused "${message.subject}".`.slice(0, 240),
    };
    try {
      const opened = applyOne(replied, declaring, context, assignedIds, resolve, emitFact, emitAccount);
      emitFact(letterFact(opened, {
        localId: `threat_${message.id}`,
        kind: "war_declared",
        summary: `${polityName(opened, message.fromPolityId)} made war on ${polityName(opened, message.toPolityId)}, as "${message.subject}" had said it would if refused.`,
        fromPolityId: message.fromPolityId,
        toPolityId: message.toPolityId,
        characterIds: [message.fromCharacterId],
        visibility: "public",
        significance: 70,
      }));
      return opened;
    } catch (error) {
      if (!(error instanceof DeltaRejection)) throw error;
      return replied;
    }
  };

  switch (delta.op) {
    case "money_transfer": {
      // A payment of nothing pays nothing: its "paid" goal of 0 once left the
      // order ledger, and with it the whole save, failing its schema (M1).
      if (delta.amount <= 0) reject(`Nothing to pay: "${delta.reason.slice(0, 120)}" named no sum.`, "reference");
      const fromId = required(delta.fromAccountRef, "The paying account");
      const from = world.material.accounts.find((account) => account.id === fromId);
      if (from === undefined) reject(`No account "${fromId}" exists to pay from.`, "reference");
      // What there is, if not all that was asked. A payment that could not be
      // met in full was refused in full, so a man with nine hundred who owed a
      // thousand paid nothing at all -- which is not how anybody short of
      // money behaves. Only an empty chest pays nothing.
      if (from.balance <= 0) reject(`Account "${fromId}" is empty, and ${delta.amount} could not be paid from it.`);
      const paying = Math.min(delta.amount, from.balance);
      const toId = delta.toAccountRef === null ? null : required(delta.toAccountRef, "The receiving account");
      if (toId !== null && !world.material.accounts.some((account) => account.id === toId)) {
        reject(`No account "${toId}" exists to receive payment.`, "reference");
      }
      if (paying < delta.amount) {
        emitFact({
          localId: `short_${fromId}_${delta.amount}`.slice(0, 60),
          kind: "payment_short",
          summary: `Of ${delta.amount} to be paid for ${delta.reason.slice(0, 160)}, only ${paying} could be found; ${delta.amount - paying} is still owed.`,
          affectedRefs: [{ kind: "account", id: fromId }, ...(toId === null ? [] : [{ kind: "account" as const, id: toId }])],
          visibility: "polity",
          discoveryState: "polity",
          knowableInDays: 0,
          significance: 20,
        });
      }
      return moveMoney(world, {
        from: fromId, to: toId, amount: paying, kind: toId === null ? "purchase" : "transfer",
        // A rule's toll is the rule's doing, and is filed under it: an order
        // that set up the arrangement can then call what it takes its own.
        causeId: context.firingMechanic?.entityId ?? context.actorRef.id, explanation: delta.reason,
      }, context);
    }

    case "income_source_upsert": {
      const beneficiaryId = required(delta.beneficiaryAccountRef, "The receiving account");
      if (!world.material.accounts.some((account) => account.id === beneficiaryId)) {
        reject(`No account "${beneficiaryId}" exists to receive this income.`, "reference");
      }
      // A government's revenue may be written as a figure: it is levied, and the
      // tick bounds what its lands can bear. A person's or an army's may not.
      // Written into a private purse, a figure came from nowhere, was lawful
      // (the purse's owner holds authority over it), and bypassed everything
      // the engine prices -- a merchant could be handed a thousand a month, and
      // an estate's engine-set yield could be rewritten to anything.
      const privatelyHeld = (accountId: string): boolean =>
        world.material.accounts.find((account) => account.id === accountId)?.owner.kind !== "polity";
      const FROM_SOMETHING = "A person's or an army's income comes from something that yields it -- an estate (holding_create, holding_improve), an office's pay, a venture standing in the world (generic_entity_create with an income effect) -- or is paid to him by somebody (obligation_upsert naming him as recipient).";
      if (privatelyHeld(beneficiaryId)) reject(`"${delta.label}" would pay a figure into ${beneficiaryId}, which is not a government's treasury. ${FROM_SOMETHING}`, "reference");
      const existingId = delta.incomeSourceRef === null ? null : required(delta.incomeSourceRef, "The income source");
      const existing = existingId === null ? undefined : world.material.incomeSources.find((source) => source.id === existingId);
      if (existing !== undefined) {
        if (existing.originKind === "holding" || privatelyHeld(existing.beneficiaryAccountId)) {
          reject(`"${existing.label}" is a private income; what it yields is set by what yields it. ${FROM_SOMETHING}`, "reference");
        }
        // Moving somebody's revenue to somebody else is not changing it: it is
        // taking whatever yields it, which is an act of its own.
        if (existing.beneficiaryAccountId !== beneficiaryId) {
          reject(`"${existing.label}" is paid to ${existing.beneficiaryAccountId}; an income is changed where it is paid. To take what yields it, take the land or the office.`, "reference");
        }
      }
      const base = {
        kind: delta.kind,
        label: delta.label,
        beneficiaryAccountId: beneficiaryId,
        // What an income comes from does not change because its amount did.
        originKind: existing?.originKind ?? ("polity" as const),
        originId: existing?.originId ?? beneficiaryId,
        amount: delta.amount,
        cadenceSteps: delta.cadenceDays,
        nextDueStep: atStep + delta.cadenceDays,
        collectionRateBps: delta.collectionRateBps ?? 10_000,
        counterpartyPolityId: delta.counterpartyPolityId,
        active: delta.active,
      };
      if (existingId !== null) {
        if (!world.material.incomeSources.some((source) => source.id === existingId)) reject(`No income source "${existingId}" exists to change.`, "reference");
        return {
          ...world,
          material: {
            ...world.material,
            incomeSources: world.material.incomeSources.map((source) => (source.id === existingId ? { ...source, ...base } : source)),
          },
        };
      }
      const id = mint("income", delta.localId);
      return { ...world, material: { ...world.material, incomeSources: [...world.material.incomeSources, { id, ...base }] } };
    }

    case "obligation_upsert": {
      const payerId = required(delta.payerAccountRef, "The paying account");
      if (!world.material.accounts.some((account) => account.id === payerId)) reject(`No account "${payerId}" exists to carry this obligation.`, "reference");
      const recipientId = delta.recipientAccountRef === null ? undefined : required(delta.recipientAccountRef, "The receiving account");
      // A man does not owe himself. Allowed through, the tick pays it every
      // cadence by moving money from an account to itself, and writes a
      // transaction the world schema rejects -- so the *next* load of that
      // save fails entirely and the game reports "This world has no state to
      // act on yet". One standing order of forty a month bricked a campaign
      // that had been running for three years.
      if (recipientId !== undefined && recipientId === payerId) {
        // Named as an engine rejection rather than a world one. It used to
        // surface in the player's own record as friction -- "Rome cannot be
        // both the one who owes and the one who is owed" -- which reads as a
        // rule of the world and is nothing of the kind: it is a payload that
        // put one account on both sides. The order was always possible.
        reject(
          `"${delta.label}" would have ${payerId} paying itself; wages and upkeep take no recipient at all, because the money goes to the men. Leave recipientAccountRef null, or name the army's own chest.`,
          "reference",
        );
      }
      const base = {
        kind: delta.kind,
        label: delta.label,
        payerAccountId: payerId,
        ...(recipientId === undefined ? {} : { recipientAccountId: recipientId }),
        amount: delta.amount,
        cadenceSteps: delta.cadenceDays,
        nextDueStep: atStep + delta.cadenceDays,
        priority: delta.priority,
        arrears: 0,
        missedPeriods: 0,
        active: delta.active,
      };
      const existingId = delta.obligationRef === null ? null : required(delta.obligationRef, "The obligation");
      if (existingId !== null) {
        if (!world.material.obligations.some((obligation) => obligation.id === existingId)) reject(`No obligation "${existingId}" exists to change.`, "reference");
        return {
          ...world,
          material: {
            ...world.material,
            obligations: world.material.obligations.map((obligation) => (obligation.id === existingId ? { ...obligation, ...base } : obligation)),
          },
        };
      }
      const id = mint("obligation", delta.localId);
      return { ...world, material: { ...world.material, obligations: [...world.material.obligations, { id, ...base }] } };
    }

    case "project_create": {
      // The same work for the same sponsor, ordered again while the first is
      // still going, is the first. Four "Anio water survey" projects once ran
      // side by side for one man, each paid, each reported: an order restated
      // in three later answers. The handle is the running one's, so whatever
      // else this answer says about it lands on the work under way.
      const sponsorOf = (ref: OrderPartyRef): string => `${ref.kind}:${resolve(ref.id) ?? ref.id}`;
      // A consul who orders the work and the Senate that votes it are one
      // sponsor to the reader: Rome's fleet of 150 ran twice, once under the
      // consul and once under the republic.
      const polityOfSponsor = (ref: OrderPartyRef): string | null =>
        ref.kind === "polity" ? (resolve(ref.id) ?? ref.id) : ref.kind === "character" ? (world.characters.find((c) => c.id === (resolve(ref.id) ?? ref.id))?.polityId ?? null) : null;
      // Only when the state pays for both. A consul's own villa, paid from his
      // own purse, is his affair and never the republic's work.
      const paidByTheState = (accountId: string | null | undefined): boolean =>
        accountId == null || world.material.accounts.find((account) => account.id === accountId)?.owner.kind === "polity";
      const deltaFunding = delta.fundingAccountRef == null ? null : (resolve(delta.fundingAccountRef) ?? delta.fundingAccountRef);
      const sameHouse = (a: OrderPartyRef, b: OrderPartyRef, existingFunding: string | null | undefined): boolean => {
        const [x, y] = [polityOfSponsor(a), polityOfSponsor(b)];
        return x !== null && x === y && paidByTheState(existingFunding) && paidByTheState(deltaFunding);
      };
      const running = world.projects.find((project) =>
        (project.status === "in_progress" || project.status === "proposed" || project.status === "funded")
        && (sponsorOf(project.sponsorEntityRef) === sponsorOf(delta.sponsorRef)
          || sameHouse(project.sponsorEntityRef, delta.sponsorRef, project.fundingAccountId))
        && sameWork(project.kind, project.label, delta.kind, delta.label));
      if (running !== undefined) {
        assignedIds.set(delta.localId, running.id);
        return world;
      }
      // A march written as a project overrides the army's other marches, as a
      // move written as an order does (`callOffMarches`).
      const marching = delta.completionOutcome?.kind === "force_move" ? delta.completionOutcome : null;
      if (marching !== null && marching.forceRef !== null && marching.provinceId !== null) {
        if (keptToItsWork(world, resolve(marching.forceRef) ?? marching.forceRef, context.actorRef.id, marching.provinceId)) reject(`${world.material.forces.find((force) => force.id === (resolve(marching.forceRef!) ?? marching.forceRef))?.name ?? "That force"} is already on the work its master sent it on, and keeps to it.`);
        const movingId = resolve(marching.forceRef) ?? marching.forceRef;
        const recent = settledCourse(world, movingId, marching.provinceId, context);
        if (recent !== undefined) reject(`${world.material.forces.find((force) => force.id === movingId)?.name ?? "That force"} set out on "${recent.label}" ${atStep - recent.startedAtStep} days ago and holds that course.`);
        // Already going there, or to the shore its crossing there leaves from:
        // that journey is this one.
        const already = journeysOf(world, movingId).find((project) => project.completionOutcome?.provinceId === marching.provinceId || project.completionOutcome?.embarkProvinceId === marching.provinceId);
        if (already !== undefined) {
          assignedIds.set(delta.localId, already.id);
          return world;
        }
        const turned = callOffMarches(world, movingId, marching.provinceId, emitFact);
        if (turned !== world) return applyOne(turned, delta, context, assignedIds, resolve, emitFact, emitAccount);
      }
      const id = mint("project", delta.localId);
      // Resolved here rather than at completion: the people and accounts an
      // outcome names exist now, and a reference that has gone stale by the
      // time the last milestone falls should fail loudly at proposal time.
      const outcome = delta.completionOutcome;
      const completionOutcome = outcome === null
        ? null
        : {
          kind: outcome.kind,
          label: outcome.label,
          amount: outcome.amount,
          provinceId: outcome.provinceId,
          polityId: outcome.polityId,
          commanderCharacterId: outcome.commanderCharacterRef === null ? null : required(outcome.commanderCharacterRef, "The commander this project is to raise a force for"),
          forceId: outcome.forceRef === null ? null : required(outcome.forceRef, "The force this project is to move"),
          beneficiaryAccountId: outcome.beneficiaryAccountRef === null ? null : required(outcome.beneficiaryAccountRef, "The account this project is to pay into"),
          cadenceDays: outcome.cadenceDays,
          agreementKind: outcome.agreementKind,
          withPolityId: outcome.withPolityId,
          ...(outcome.categoryId === undefined ? {} : { categoryId: outcome.categoryId }),
          ...(outcome.structureKind === undefined ? {} : { structureKind: outcome.structureKind }),
          ...(outcome.effects === undefined ? {} : { effects: outcome.effects }),
          ...(outcome.upkeep == null ? {} : { upkeep: upkeepFrom(world, outcome.upkeep, required) }),
        };
      // The same rule as `income_source_upsert`: a finished work may pay a
      // government's treasury, not a person's purse -- a man's income comes
      // from something he owns, and a project that ends in a building he owns
      // is a structure with an income effect, which the engine prices.
      if (completionOutcome?.kind === "income_source" && completionOutcome.beneficiaryAccountId !== null
        && world.material.accounts.find((account) => account.id === completionOutcome.beneficiaryAccountId)?.owner.kind !== "polity") {
        reject(`"${delta.label}" would end paying a figure into ${completionOutcome.beneficiaryAccountId}, which is not a government's treasury. A private work that pays is a building with an income effect ("structure").`, "reference");
      }
      if (completionOutcome?.categoryId !== undefined && !warfareWith(world, context.warfare).troopCategories.some((category) => category.id === completionOutcome.categoryId)) {
        reject(`No kind of troops "${completionOutcome.categoryId}" exists; the kinds are ${warfareWith(world, context.warfare).troopCategories.map((category) => category.id).join(", ")}.`, "reference");
      }
      // A project that ends with an army somewhere else has to have a way for
      // it to get there -- over water, in its own power's ships.
      if (completionOutcome?.kind === "force_move" && completionOutcome.forceId !== null && completionOutcome.provinceId !== null) {
        const moving = world.material.forces.find((force) => force.id === completionOutcome.forceId);
        if (moving === undefined) reject(`No force "${completionOutcome.forceId}" exists to move.${nearestTo(completionOutcome.forceId)}`, "reference");
        const passage = passageFor(world, moving, completionOutcome.provinceId, warfareWith(world, context.warfare), monthOf(context));
        if (passage.by === "sea" && !isNavalForce(moving, warfareWith(world, context.warfare))) {
          const plan = passagePlanFor(world, moving, completionOutcome.provinceId, warfareWith(world, context.warfare), monthOf(context));
          if (plan !== null) return arrangeCrossing(world, moving, completionOutcome.provinceId, plan, delta.localId, context, assignedIds, resolve, emitFact, emitAccount);
        }
        if (passage.by === null) {
          // Too far from its ships to go over today: the crossing is arranged
          // -- the fleets sent for, the army walked to the shore -- rather than
          // refused for the player to arrange by hand.
          const plan = passagePlanFor(world, moving, completionOutcome.provinceId, warfareWith(world, context.warfare), monthOf(context));
          if (plan === null) reject(passage.reason);
          return arrangeCrossing(world, moving, completionOutcome.provinceId, plan, delta.localId, context, assignedIds, resolve, emitFact, emitAccount);
        }
      }
      // An embassy whose whole point is an understanding must name the power it
      // is with, or it completes and the world is exactly as it was.
      if (outcome !== null && outcome.kind === "agreement" && (outcome.agreementKind === null || outcome.withPolityId === null)) {
        reject("A project that is to end in an agreement must say what the agreement is and which power it is with.", "reference");
      }
      if (outcome !== null && outcome.withPolityId !== null && !world.map.polities.some((polity) => polity.id === outcome.withPolityId)) {
        reject(`No power "${outcome.withPolityId}" exists to come to terms with.`, "reference");
      }
      const writtenFundingId = delta.fundingAccountRef === null ? null : required(delta.fundingAccountRef, "The funding account");
      if (writtenFundingId !== null && !world.material.accounts.some((account) => account.id === writtenFundingId)) {
        reject(`No account "${writtenFundingId}" exists to fund this project.`, "reference");
      }
      // A power's own work is paid from its treasury, not from whichever
      // senator's purse was named: the allied silver the Senate voted was
      // charged to Ogulnius (R41).
      const sponsorPolity = delta.sponsorRef.kind === "polity" ? (resolve(delta.sponsorRef.id) ?? delta.sponsorRef.id) : null;
      const writtenOwner = world.material.accounts.find((account) => account.id === writtenFundingId)?.owner;
      const treasury = sponsorPolity === null ? undefined : world.material.accounts.find((account) => account.owner.kind === "polity" && account.owner.id === sponsorPolity && account.status === "active");
      const fundingId = sponsorPolity !== null && writtenOwner?.kind === "character" && treasury !== undefined ? treasury.id : writtenFundingId;
      // Whose hands this passes through (VISION §13). A project is the
      // commonest form a delegated order takes, and until now the man given it
      // made no difference to it at all: two officials handed "find the money
      // for two new legions" produced identical milestones at identical cost,
      // however good or honest either of them was.
      //
      // The sponsor is who does the work. Code owns what it costs and how long
      // it takes; the model owns what they actually did about it.
      //
      // Unless it is a power's work the player ordered, or a power's work at
      // all: then whoever the engine puts over it does it (`overseers.ts`),
      // so a consul does not have to name a man for every fleet and wall.
      const sponsorId = delta.sponsorRef.kind === "character" ? resolve(delta.sponsorRef.id) ?? delta.sponsorRef.id : null;
      const overseerId = chooseOverseer(world, {
        kind: delta.kind,
        label: delta.label,
        sponsorEntityRef: sponsorId === null ? delta.sponsorRef : { ...delta.sponsorRef, id: sponsorId },
        fundingAccountId: fundingId,
        completionOutcome,
      }, context.playerCharacterId ?? null);
      const doerId = overseerId ?? sponsorId;
      const hand = doerId === null ? null : assessExecution(world, doerId, domainOfWork(delta.kind, delta.label));
      // A public work paid from a power's chest costs what whoever is in
      // charge of its works can make it cost: a seventh less, or more.
      const fundingOwner = fundingId === null ? undefined : world.material.accounts.find((account) => account.id === fundingId)?.owner;
      const worksScale = fundingOwner?.kind === "polity"
        ? 1 - skillShare(readDepartments(world).skill({ kind: "polity", id: fundingOwner.id }, "public_works_cost"), 0.15)
        : 1;
      const milestones = delta.milestones.map((milestone, index) => {
        const through = throughHand(milestone.costAmount, hand);
        return {
          id: `${id}-m${index + 1}`,
          label: milestone.label,
          requiredAtElapsedOffset: daysInHand(milestone.dueInDays, hand),
          costAmount: Math.max(0, Math.round(through.cost * worksScale)),
          status: "pending" as const,
          completedAtStep: null,
        };
      });

      // And what quietly does not arrive. A private fact, which is exactly
      // what `oversight.ts` discovers and what a rival can prosecute: this is
      // a story somebody can find out, not a modifier on a number.
      const skimmed = hand === null || fundingId === null
        ? 0
        : delta.milestones.reduce((sum, milestone) => sum + throughHand(milestone.costAmount, hand).skimmed, 0);
      let withSkim = world;
      if (skimmed > 0 && hand !== null && doerId !== null) {
        const funding = world.material.accounts.find((account) => account.id === fundingId);
        const purse = world.characters.find((character) => character.id === doerId)?.personalAccountId;
        const takeable = Math.min(skimmed, funding?.balance ?? 0);
        if (purse !== undefined && takeable > 0) {
          // In the books, as it would be: a line only the man himself can read.
          withSkim = moveMoney(world, {
            from: fundingId, to: purse, amount: takeable, kind: "diversion",
            causeId: id, explanation: `Part of what was voted for ${delta.label}`, visibility: "private",
          }, context);
          emitFact({
            localId: `skim_${id}`,
            kind: "peculation",
            summary: `${hand.name} let ${takeable} of what was voted for ${delta.label} find its way into his own purse.`,
            affectedRefs: [{ kind: "character", id: doerId }],
            visibility: "private",
            discoveryState: "private",
            knowableInDays: 0,
            knownToRefs: [{ kind: "character", id: doerId }],
            // Worth a chapter if anybody ever finds it.
            significance: 55,
          });
        }
      }
      const project = {
        id,
        kind: delta.kind,
        sponsorEntityRef: delta.sponsorRef,
        label: delta.label,
        status: "in_progress" as const,
        fundingAccountId: fundingId,
        overseerCharacterId: overseerId,
        reservationId: null,
        milestones,
        completionOutcome,
        linkedEntityIds: [],
        startedAtStep: atStep,
        targetCompletionStep: atStep + Math.max(...delta.milestones.map((milestone) => milestone.dueInDays)),
        completedAtStep: null,
        provenanceEventIds: [],
      };
      return { ...withSkim, projects: [...withSkim.projects, project] };
    }

    case "project_milestone_update": {
      const projectId = required(delta.projectRef, "The project");
      const project = world.projects.find((candidate) => candidate.id === projectId);
      if (project === undefined) reject(`No project "${projectId}" exists.`, "reference");
      // By id, or by the number or name it was written with: "milestone 0"
      // and "the second stage" name a stage as surely as its id does.
      const wanted = delta.milestoneId.trim();
      const ordinal = /^\d+$/.test(wanted) ? Number(wanted) : null;
      const stage = project.milestones.find((milestone) => milestone.id === wanted)
        ?? (ordinal === null ? undefined : project.milestones[ordinal] ?? project.milestones[ordinal - 1])
        ?? project.milestones.find((milestone) => milestone.label.toLowerCase() === wanted.toLowerCase());
      if (stage === undefined) reject(`Project "${projectId}" has no milestone "${delta.milestoneId}".`, "reference");
      const milestones = project.milestones.map((milestone) =>
        milestone.id === stage.id ? { ...milestone, status: delta.status, completedAtStep: atStep } : milestone,
      );
      const allDone = milestones.every((milestone) => milestone.status !== "pending");
      const updated = { ...project, milestones, status: allDone ? ("completed" as const) : project.status, completedAtStep: allDone ? atStep : null };
      return { ...world, projects: world.projects.map((candidate) => (candidate.id === projectId ? updated : candidate)) };
    }

    case "force_create": {
      const commanderId = required(delta.commanderCharacterRef, "The commander");
      const controllerId = required(delta.controllerCharacterRef, "The controller");
      if (!world.characters.some((character) => character.id === commanderId)) reject(`No character "${commanderId}" exists to command this force.${nearestTo(commanderId)}`, "reference");
      if (!world.map.provinces.some((province) => province.id === delta.locationId)) reject(`No province "${delta.locationId}" exists to raise this force in.`, "reference");
      const forcePolityId = required(delta.polityId, "The power this force answers to");
      if (!world.map.polities.some((polity) => polity.id === forcePolityId)) {
        reject(`No power "${forcePolityId}" exists for this force to answer to.`, "reference");
      }
      const payObligationId = delta.payObligationRef == null ? null : required(delta.payObligationRef, "The obligation that pays them");
      if (payObligationId !== null && !world.material.obligations.some((obligation) => obligation.id === payObligationId)) {
        reject(`No obligation "${payObligationId}" exists to pay this force.`, "reference");
      }
      const category = delta.categoryId === undefined
        ? { id: "infantry", label: "Infantry" }
        : warfareWith(world, context.warfare).troopCategories.find((candidate) => candidate.id === delta.categoryId);
      if (category === undefined) reject(`No kind of troops "${delta.categoryId}" exists; the kinds are ${warfareWith(world, context.warfare).troopCategories.map((candidate) => candidate.id).join(", ")}.`, "reference");
      if ("naval" in category && category.naval === true && delta.fromForceRef == null && /hir|charter|mercenar/i.test(`${delta.name} ${delta.reason}`)) {
        reject("Hired ships must come through a service_contract_open with their captain, company, and pay; they cannot be levied as men.");
      }
      // A band answering to no power is raised with somebody's own money, or it
      // is simply a government's army that has been called something else.
      if (delta.outlaw === true) {
        const payer = world.material.obligations.find((obligation) => obligation.id === payObligationId)?.payerAccountId;
        const owner = world.material.accounts.find((account) => account.id === payer)?.owner;
        if (owner?.kind !== "character") reject(`${delta.name} would answer to no power, so a private purse has to pay it: name the obligation that does.`, "reference");
      }
      const id = mint("force", delta.localId);
      // Men drawn from an army that exists are its men, not new ones: the
      // Campanians of Rhegium made a punitive legion were raised again from
      // Latium beside the garrison, which stayed whole under Decius (R09, R10).
      const fromId = delta.fromForceRef == null ? null : required(delta.fromForceRef, "The army its men come from");
      const source = fromId === null ? undefined : world.material.forces.find((candidate) => candidate.id === fromId);
      if (fromId !== null && source === undefined) reject(`No force "${fromId}" exists to draw men from.`, "reference");
      // Only men who are the actor's to dispose of: his own power's, his own
      // command's, or a power's that has made peace or submitted to his.
      if (source !== undefined) {
        const actorId = context.actorRef.kind === "character" ? context.actorRef.id : null;
        const settledWith = world.polityAgreements.some((agreement) => agreement.status === "active"
          && (agreement.kind === "peace" || agreement.kind === "tributary" || agreement.kind === "truce")
          && ((agreement.polityId === source.polityId && agreement.otherPolityId === forcePolityId) || (agreement.otherPolityId === source.polityId && agreement.polityId === forcePolityId)));
        if (source.polityId !== forcePolityId && source.controllerCharacterId !== actorId && source.commanderCharacterId !== actorId && !settledWith) {
          reject(`${source.name}'s men are not ${forcePolityId}'s to take: they answer to ${source.polityId}.`);
        }
      }
      // "Ten years in a punitive legion, then citizens again": the years read
      // from the words, which are kept as what is owed at the end.
      const years = delta.serviceTerms === undefined ? null : yearsIn(delta.serviceTerms);
      const service = delta.serviceTerms === undefined ? {} : {
        ...(years === null ? {} : { serviceUntilStep: atStep + years * 365 }),
        serviceTerms: delta.serviceTerms,
      };
      if (source !== undefined) {
        const drawn = Math.min(delta.authorizedStrength, source.personnel.reduce((sum, group) => sum + group.fit, 0));
        if (drawn <= 0) reject(`${source.name} has no men left to give.`);
        const shares = proportionalDraw(source.personnel, drawn);
        const taken = source.personnel.map((group, index) => ({ ...group, fit: shares[index]!, unavailable: [] })).filter((group) => group.fit > 0);
        const remaining = source.personnel.map((group, index) => ({ ...group, fit: group.fit - shares[index]! }));
        const emptied = remaining.every((group) => group.fit <= 0);
        const detached: Force = {
          id, name: delta.name, polityId: forcePolityId, ...(delta.outlaw === true ? { outlaw: true } : {}),
          commanderCharacterId: commanderId, controllerCharacterId: controllerId, locationId: source.locationId, positionId: null,
          authorizedStrength: drawn, personnel: taken,
          moraleBps: source.moraleBps, cohesionBps: source.cohesionBps, fatigueBps: source.fatigueBps,
          provisionStatus: source.provisionStatus, provisionedThroughStep: source.provisionedThroughStep,
          payObligationId, payArrearsPeriods: 0, ...service, history: [], memberCharacterIds: [],
        };
        const garrison = isGarrison(`${delta.name} ${delta.localId} ${delta.reason}`);
        const force = garrison ? asGarrison(world, detached) : detached;
        const chest = { id: context.ids.next("account"), owner: { kind: "force" as const, id }, currencyId: world.material.currency.id, balance: 0, status: "active" as const, visibility: "polity" as const };
        const withForce: WorldState = {
          ...world,
          material: {
            ...world.material,
            forces: [...world.material.forces.map((candidate) => candidate.id === source.id ? { ...candidate, personnel: remaining, authorizedStrength: Math.max(0, candidate.authorizedStrength - drawn) } : candidate), force],
            accounts: [...world.material.accounts, chest],
          },
        };
        emitFact({
          localId: `drawn_${id}`.slice(0, 60),
          kind: "force_reformed",
          summary: `${drawn} men of ${source.name} became ${delta.name}${emptied ? `, and ${source.name} is no more` : `; ${remaining.reduce((sum, group) => sum + Math.max(0, group.fit), 0)} remain in it`}.${delta.serviceTerms === undefined ? "" : ` ${delta.serviceTerms}`}`.slice(0, 600),
          affectedRefs: [{ kind: "force", id }, { kind: "force", id: source.id }, { kind: "polity", id: forcePolityId }],
          visibility: "polity",
          discoveryState: "polity",
          knowableInDays: 0,
          significance: 45,
        });
        if (garrison) emitFact({ localId: `garrison_${id}`.slice(0, 60), kind: "garrison_set", summary: `${delta.name} stands as the garrison of ${world.map.provinces.find((province) => province.id === delta.locationId)?.name ?? delta.locationId}, ${drawn} men under orders to hold it.`.slice(0, 600), affectedRefs: [{ kind: "force", id }, { kind: "province", id: delta.locationId }], visibility: "polity", discoveryState: "polity", knowableInDays: 0, significance: 40 });
        const settled = emptied ? disbandForces(withForce, new Set([source.id]), null) : withForce;
        // Left to hold a place the army is not in: drawn off here and sent there.
        return delta.locationId === source.locationId || !world.map.provinces.some((province) => province.id === delta.locationId) ? settled
          : applyOne(settled, { op: "force_modify", forceRef: id, locationId: delta.locationId, reason: delta.reason } as WorldDelta, context, assignedIds, resolve, emitFact, emitAccount);
      }
      // An ally's ships called for: raised in its harbours, at its cost (`socii-navales.ts`).
      const leader = actorPolityOf(world, context);
      if (leader !== null && "naval" in category && category.naval === true && owesShipsTo(world, forcePolityId, leader)) {
        const sent = requisitionAlliedHulls(world, { id, chestId: context.ids.next("account"), allyId: forcePolityId, name: delta.name, wanted: delta.authorizedStrength, commanderId, controllerId, categoryId: category.id, label: category.label, atStep });
        if (typeof sent === "string") reject(sent);
        emitFact({ localId: `requisitioned_${id}`.slice(0, 60), kind: "hulls_requisitioned", summary: `${sent.hulls} ${category.label.toLowerCase()} were requisitioned from ${world.map.polities.find((polity) => polity.id === forcePolityId)?.name ?? forcePolityId}, as its treaty with ${world.map.polities.find((polity) => polity.id === leader)?.name ?? leader} binds it, and gather at ${world.map.provinces.find((province) => province.id === sent.shore)?.name ?? sent.shore}.`.slice(0, 600), affectedRefs: [{ kind: "force", id }, { kind: "polity", id: forcePolityId }, { kind: "polity", id: leader }], visibility: "polity", discoveryState: "polity", knowableInDays: 0, significance: 40 });
        return sent.world;
      }
      // Raised out of a country and paid for, and a large levy musters over
      // days (`levies.ts`): whoever pays its wages pays its bounties.
      const payerAccountId = world.material.obligations.find((obligation) => obligation.id === payObligationId)?.payerAccountId ?? null;
      const levy = raiseLevy(world, { polityId: forcePolityId, provinceId: delta.locationId, men: delta.authorizedStrength, payerAccountId, pays: true, atStep, cause: id, ids: context.ids });
      if (levy.men <= 0) reject(levy.short ?? `No men could be raised for ${delta.name}.`);
      if (levy.short !== null) {
        emitFact({ localId: `levy_short_${id}`.slice(0, 60), kind: "levy_short", summary: levy.short, affectedRefs: [{ kind: "province", id: delta.locationId }, { kind: "polity", id: forcePolityId }], visibility: "polity", discoveryState: "polity", knowableInDays: 0, significance: 45 });
      }
      const levied = levy.world;
      const force = {
        id,
        name: delta.name,
        polityId: forcePolityId,
        ...(delta.outlaw === true ? { outlaw: true } : {}),
        commanderCharacterId: commanderId,
        controllerCharacterId: controllerId,
        locationId: delta.locationId,
        positionId: null,
        authorizedStrength: levy.men,
        personnel: [mustering(category.id, category.label, levy.men, atStep, id, musterRateFor(world, forcePolityId))],
        moraleBps: 6_000,
        cohesionBps: 5_000,
        fatigueBps: 0,
        provisionStatus: "provisioned" as const,
        provisionedThroughStep: atStep + 90,
        payObligationId,
        payArrearsPeriods: 0,
        ...service,
        history: [],
        memberCharacterIds: [],
      };
      // Every army carries a chest, empty until something fills it. It costs
      // nothing to have and it is the only place plunder can go: without one,
      // "they will be paid out of what they take" has nowhere to put what they
      // take, and an order about an army's own money has to be routed through
      // somebody's purse instead.
      const chest = {
        id: context.ids.next("account"),
        owner: { kind: "force" as const, id },
        currencyId: world.material.currency.id,
        balance: 0,
        status: "active" as const,
        visibility: "polity" as const,
      };
      return {
        ...levied,
        material: {
          ...levied.material,
          forces: [...levied.material.forces, force],
          accounts: [...levied.material.accounts, chest],
        },
      };
    }

    case "force_modify": {
      const forceId = required(delta.forceRef, "The force");
      const force = world.material.forces.find((candidate) => candidate.id === forceId);
      if (force === undefined) reject(`No force "${forceId}" exists.`, "reference");
      if (delta.locationId !== undefined && !world.map.provinces.some((province) => province.id === delta.locationId)) {
        reject(`No province "${delta.locationId}" exists to move this force to.`, "reference");
      }
      // Sent somewhere new, it is no longer going where it was sent before.
      // Its own ground written back beside a new name or commander is not an
      // order to halt, and leaves the road alone.
      if (delta.locationId !== undefined && delta.locationId !== force.locationId) {
        if (keptToItsWork(world, forceId, context.actorRef.id, delta.locationId)) reject(`${force.name} is already on the work its master sent it on, and keeps to it.`);
        // Somebody other than the player turning a force he sent out within
        // the fortnight holds his first course: Hannibal Gisco sent his fleet
        // to the Sikeloi coast, then Rhegium, then the Sikeloi coast, then
        // Rhegium again, one burst after another, and it never arrived.
        const recent = settledCourse(world, forceId, delta.locationId, context);
        if (recent !== undefined) reject(`${force.name} set out on "${recent.label}" ${atStep - recent.startedAtStep} days ago and holds that course.`);
        const turned = callOffMarches(world, forceId, delta.locationId, emitFact);
        if (turned !== world) return applyOne(turned, delta, context, assignedIds, resolve, emitFact, emitAccount);
      }
      // An army has to cross the ground between here and there. The map has
      // always said what that ground is; nothing ever asked it, so a legion
      // could be in Latium in one delta and Carthage in the next.
      let escort: readonly Force[] = [];
      let overWater: "strait" | "sea_lane" | null = null;
      if (delta.locationId !== undefined && delta.locationId !== force.locationId) {
        const verdict = canMoveTo(world, force.locationId, delta.locationId, context.terrains ?? []);
        // An army crossing water needs hulls to cross it in. This is the rule
        // that makes Sicily an island rather than another province of Italy.
        // Hulls enough for one crossing, already on the beach, and the army is
        // over today; fewer hulls, or hulls sent for, and the crossing is a
        // journey of loads, like any march that takes days.
        const ferried = verdict.allowed && isWaterCrossing(verdict.edge.crossing) && !isNavalForce(force, warfareWith(world, context.warfare))
          ? passageFor(world, force, delta.locationId, warfareWith(world, context.warfare), monthOf(context))
          : null;
        if (ferried !== null && ferried.by === null) {
          const plan = passagePlanFor(world, force, delta.locationId, warfareWith(world, context.warfare), monthOf(context), (delta.fleetRefs ?? []).map((ref) => resolve(ref) ?? ref));
          if (plan === null) reject(ferried.reason);
          const arranged = arrangeCrossing(world, force, delta.locationId, plan, `crossing-${forceId}`.slice(0, 60), context, assignedIds, resolve, emitFact, emitAccount);
          return applyOne(arranged, { ...delta, locationId: undefined }, context, assignedIds, resolve, emitFact, emitAccount);
        }
        // Never in one go past an enemy fleet: the crossing takes its days, and
        // is fought for when it is made (`crossings.ts`).
        const inOneGo = ferried?.by === "sea" && ferried.ferry.trips === 1 && ferried.ferry.gatherKm === 0
          && !enemyFleetOff(world, force, [force.locationId, delta.locationId], warfareWith(world, context.warfare));
        if (ferried?.by === "sea" && inOneGo) {
          escort = ferried.ferry.fleets;
          overWater = ferried.over;
        }
        if (ferried?.by === "sea" && !inOneGo) {
          const plan = passagePlanFor(world, force, delta.locationId, warfareWith(world, context.warfare), monthOf(context), (delta.fleetRefs ?? []).map((ref) => resolve(ref) ?? ref));
          if (plan !== null) {
            const arranged = arrangeCrossing(world, force, delta.locationId, plan, `crossing-${forceId}`.slice(0, 60), context, assignedIds, resolve, emitFact, emitAccount);
            return applyOne(arranged, { ...delta, locationId: undefined }, context, assignedIds, resolve, emitFact, emitAccount);
          }
          const days = CROSSING_DAYS + ferryDays(ferried.ferry);
          return setOutOn(world, force, forceId, delta, verdict.allowed ? verdict.edge.distance : 0, days, describeFerry(world, force, ferried.ferry), context, assignedIds, resolve, emitFact, emitAccount);
        }
        if (!verdict.allowed) {
          const provinceName = (id: string): string => world.map.provinces.find((province) => province.id === id)?.name ?? id;
          if (verdict.refusal.kind === "crossing_not_admitted") {
            reject(`${force.name} cannot make the ${verdict.refusal.crossing} crossing from ${provinceName(force.locationId)} to ${provinceName(delta.locationId)}.`);
          }
          const km = verdict.refusal.kind === "not_adjacent" ? verdict.refusal.km : null;
          if (km === null) {
            reject(`${force.name} stands in ${provinceName(force.locationId)} and cannot reach ${provinceName(delta.locationId)}: no road at all leads there.`);
          }
          const passage = passageFor(world, force, delta.locationId, warfareWith(world, context.warfare), monthOf(context));
          if (passage.by === null) {
            const plan = passagePlanFor(world, force, delta.locationId, warfareWith(world, context.warfare), monthOf(context), (delta.fleetRefs ?? []).map((ref) => resolve(ref) ?? ref));
            if (plan === null) reject(passage.reason);
            const arranged = arrangeCrossing(world, force, delta.locationId, plan, `crossing-${forceId}`.slice(0, 60), context, assignedIds, resolve, emitFact, emitAccount);
            return applyOne(arranged, { ...delta, locationId: undefined }, context, assignedIds, resolve, emitFact, emitAccount);
          }
          if (passage.by === "sea") {
            const plan = passagePlanFor(world, force, delta.locationId, warfareWith(world, context.warfare), monthOf(context), (delta.fleetRefs ?? []).map((ref) => resolve(ref) ?? ref));
            if (plan !== null) {
              const arranged = arrangeCrossing(world, force, delta.locationId, plan, `crossing-${forceId}`.slice(0, 60), context, assignedIds, resolve, emitFact, emitAccount);
              return applyOne(arranged, { ...delta, locationId: undefined }, context, assignedIds, resolve, emitFact, emitAccount);
            }
          }
          // Far off, but there is a road: the order is a march, and a march
          // takes days. It used to be refused, and the refusal was never put
          // right -- "march on Rhegium" from Rome simply did not happen unless
          // the model had thought to write a journey. Now the journey is made
          // for it, the army sets out, and it arrives when the road is walked.
          // A commander who can feed an army on the road moves it faster: a
          // quarter quicker at best, a quarter slower at worst.
          const quartermaster = world.characters.find((character) => character.id === force.commanderCharacterId);
          // And whoever is in charge of his power's supply, behind him: a
          // seventh either way on top.
          const supplied = readDepartments(world).headLift({ kind: "polity", id: force.polityId }, "supply");
          // And winter, when the roads are mud and the passes snow.
          // Only a pass on the map is a pass: asked whether there was a way by
          // land and river alone, a march with a crossing at the end of it was
          // timed as a winter pass.
          const overPass = mustCrossAPass(world, force.locationId, delta.locationId);
          // Ships sail it: a fleet sent 300 km along the coast was timed at a
          // marching pace and took 25 days.
          const days = isNavalForce(force, warfareWith(world, context.warfare))
            ? Math.max(1, sailDaysFor(km))
            // And how the army marches (`march_speed`): men carrying their own
            // kit, with a short baggage train, cover more road in a day.
            : daysInSeason(Math.max(Math.ceil(km / FASTEST_MARCH_KM_PER_DAY), Math.round((km / MARCH_KM_PER_DAY) * (1 - (quartermaster === undefined ? 0 : skillShare(aptitude(quartermaster, "logistics"), 0.25)) - supplied - Math.max(-0.35, Math.min(0.35, forceLever(warfareWith(world, context.warfare), force, "march_speed")))))), monthOf(context), overPass);
          const bySea = passage.by === "sea" ? passage.ferry : null;
          return setOutOn(world, force, forceId, delta, km, days + (bySea === null ? 0 : ferryDays(bySea)), bySea === null ? null : describeFerry(world, force, bySea), context, assignedIds, resolve, emitFact, emitAccount);
        }
      }
      const commanderId = delta.commanderCharacterRef === undefined ? undefined : required(delta.commanderCharacterRef, "The commander");
      if (commanderId !== undefined && !world.characters.some((character) => character.id === commanderId)) {
        reject(`No character "${commanderId}" exists to take command.${nearestTo(commanderId)}`, "reference");
      }
      const controllerId = delta.controllerCharacterRef === undefined ? undefined : required(delta.controllerCharacterRef, "The controller");
      if (controllerId !== undefined && !world.characters.some((character) => character.id === controllerId)) {
        reject(`No character "${controllerId}" exists to answer for this force.${nearestTo(controllerId)}`, "reference");
      }
      const newForcePolityId = delta.polityId === undefined ? undefined : required(delta.polityId, "The power this force answers to");
      if (newForcePolityId !== undefined && !world.map.polities.some((polity) => polity.id === newForcePolityId)) {
        reject(`No power "${newForcePolityId}" exists for this force to answer to.`, "reference");
      }
      // Who pays them. Resolved here rather than in the object literal because
      // `undefined` (leave it alone) and `null` (cut them loose) are different
      // orders and a spread cannot tell them apart.
      let payChange: { payObligationId: string | null; payArrearsPeriods: number } | null = null;
      // An army that changes sides stops being the old power's charge. Left
      // alone, a legion handed to Carthage would go on drawing Roman pay,
      // which is not a subtlety anybody intended -- so the wages lapse with
      // the allegiance unless this same order says who pays them now.
      if (delta.payObligationRef === undefined && newForcePolityId !== undefined && newForcePolityId !== force.polityId) {
        payChange = { payObligationId: null, payArrearsPeriods: 0 };
      }
      if (delta.payObligationRef !== undefined) {
        const payObligationId = delta.payObligationRef === null
          ? null
          : required(delta.payObligationRef, "The obligation that pays them");
        if (payObligationId !== null && !world.material.obligations.some((obligation) => obligation.id === payObligationId)) {
          reject(`No obligation "${payObligationId}" exists to pay ${force.name}.`, "reference");
        }
        // Arrears are what the men have noticed, and they have noticed it
        // about a paymaster who has now changed. A new one who is current
        // stops the grievance growing; it does not give back the morale the
        // old one cost, which stays where it fell until something lifts it.
        payChange = { payObligationId, payArrearsPeriods: 0 };
      }

      // Where in the province they stand.
      //
      // A position belongs to the ground, so moving province clears it unless
      // this same order says where they stand when they get there. A position
      // the province has no record of is made rather than refused: the map is a
      // drawing of the world and not the whole of it, and "hold the pass above
      // the camp" is a real order about real ground whether or not anybody drew
      // the pass.
      const standingIn = delta.locationId ?? force.locationId;
      const movedProvince = delta.locationId !== undefined && delta.locationId !== force.locationId;
      let positionChange: { positionId: string | null } | null = movedProvince ? { positionId: null } : null;
      let mintedInto: Province | null = null;
      if (delta.positionId !== undefined) {
        if (delta.positionId === null) {
          positionChange = { positionId: null };
        } else {
          const province = world.map.provinces.find((candidate) => candidate.id === standingIn);
          if (province === undefined) reject(`No province "${standingIn}" exists for ${force.name} to take up a position in.`, "reference");
          if (findPosition(province, delta.positionId) === undefined) {
            mintedInto = provinceWithPosition(province, mintPosition(
              province.id,
              delta.positionId,
              delta.newPosition?.label ?? labelFromCategoryId(delta.positionId),
              delta.newPosition?.type ?? "camp",
            ));
          }
          positionChange = { positionId: delta.positionId };
        }
      }

      const strength = Math.max(0, force.authorizedStrength + (delta.authorizedStrengthDelta ?? 0));
      // A rule firing has its own engine-set worth already (`mechanicWorth`); only what a model wrote is read by its size.
      const shiftOf = (value: number | undefined): number => (context.firingMechanic !== undefined ? value ?? 0 : bandedShift(value));
      const plain = {
        ...force,
        ...(delta.name === undefined ? {} : { name: delta.name }),
        ...(delta.standardId === undefined ? {} : { standardId: delta.standardId }),
        ...(delta.hold === undefined ? {} : { hold: delta.hold }),
        ...(delta.locationId === undefined ? {} : { locationId: delta.locationId }),
        ...(positionChange === null ? {} : positionChange),
        ...(commanderId === undefined ? {} : { commanderCharacterId: commanderId }),
        ...(controllerId === undefined ? {} : { controllerCharacterId: controllerId }),
        ...(newForcePolityId === undefined ? {} : { polityId: newForcePolityId }),
        ...(delta.provisionStatus === undefined ? {} : { provisionStatus: delta.provisionStatus }),
        ...(delta.provisionedForDays === undefined ? {} : { provisionedThroughStep: atStep + delta.provisionedForDays }),
        ...(payChange === null ? {} : payChange),
        ...(delta.battlePlan === undefined ? {} : { battlePlan: delta.battlePlan }),
        ...(delta.outlaw === undefined ? {} : { outlaw: delta.outlaw }),
        authorizedStrength: Math.max(1, strength),
        // The size of the change is read, not its number (`bandedShift`): an
        // order can rest an army or rouse it, not set its spirits to a figure.
        // And no order makes men steadier than their drill and their years
        // let them be (`restedCeilingOf`): that is what drill is for.
        moraleBps: clampBps(force.moraleBps + shiftOf(delta.moraleBpsDelta)),
        cohesionBps: context.firingMechanic !== undefined
          ? clampBps(force.cohesionBps + shiftOf(delta.cohesionBpsDelta))
          : Math.min(Math.max(force.cohesionBps, restedCeilingOf(force) + 1_000), clampBps(force.cohesionBps + shiftOf(delta.cohesionBpsDelta))),
        fatigueBps: clampBps(force.fatigueBps + shiftOf(delta.fatigueBpsDelta)),
      };
      // Drill, an officer's own formation, and a way of fighting this army
      // takes up of its commander's accord (`practiseInArmy`).
      const practice = practiseInArmy(world, plain, delta, resolve, atStep, context.actorRef.kind === "character" ? context.actorRef.id : null);
      for (const fact of practice.facts) emitFact(fact);
      const updated = practice.force;
      // A garrison that has turned pirate is news everywhere it might land.
      if (delta.outlaw !== undefined && delta.outlaw !== (force.outlaw === true)) {
        const home = world.map.polities.find((polity) => polity.id === force.polityId)?.name ?? force.polityId;
        emitFact({
          localId: `outlaw_${forceId}`.slice(0, 60),
          kind: delta.outlaw ? "gone_outlaw" : "come_in",
          summary: delta.outlaw
            ? `${force.name} has thrown off ${home} and answers to nobody now but the man who leads it.`
            : `${force.name} has come back under ${home}.`,
          affectedRefs: [{ kind: "force", id: forceId }, { kind: "polity", id: force.polityId }],
          visibility: "public",
          discoveryState: "public",
          knowableInDays: 0,
          significance: 55,
        });
      }
      // Crossing somebody else's border is not refused -- it is noticed. See
      // `trespassOf` for why a border is news and not a wall.
      const trespass = movedProvince ? trespassOf(world, updated, delta.locationId!) : null;
      if (trespass !== null) {
        emitFact({
          localId: `trespass_${forceId}`,
          kind: "trespass",
          summary: trespass.summary,
          affectedRefs: [
            { kind: "force", id: forceId },
            { kind: "polity", id: trespass.hostPolityId },
            { kind: "polity", id: updated.polityId },
            { kind: "province", id: delta.locationId! },
          ],
          visibility: "public",
          discoveryState: "public",
          knowableInDays: 0,
          knownToRefs: [],
          significance: 55,
        });
      }
      // The ships go where the army they carried went. A fleet that ferries an
      // army and stays behind has not sailed anywhere. And the sea takes what
      // the season lets it (`crossings.ts`).
      const voyage = overWater === null
        ? null
        : perilsOfTheRoad(world, updated, world.material.forces.filter((candidate) => escort.some((fleet) => fleet.id === candidate.id)), delta.locationId!, overWater, monthOf(context), atStep, `${forceId}:crossing`);
      if (voyage !== null && voyage.words !== "") {
        emitFact({
          localId: `storm_${forceId}`.slice(0, 60),
          kind: "storm_at_sea",
          summary: `${updated.name} crossed to ${world.map.provinces.find((candidate) => candidate.id === delta.locationId)?.name ?? delta.locationId}.${voyage.words}`.slice(0, 600),
          affectedRefs: [{ kind: "force", id: forceId }, ...escort.slice(0, 3).map((fleet) => ({ kind: "force" as const, id: fleet.id })), { kind: "province", id: delta.locationId! }],
          visibility: "public",
          discoveryState: "public",
          knowableInDays: 0,
          significance: 55,
        });
      }
      const escortIds = new Set(escort.map((fleet) => fleet.id));
      return {
        ...world,
        doctrines: practice.doctrines,
        ...(mintedInto === null ? {} : {
          map: {
            ...world.map,
            provinces: world.map.provinces.map((candidate) => (candidate.id === mintedInto.id ? mintedInto : candidate)),
          },
        }),
        material: {
          ...world.material,
          forces: world.material.forces.map((candidate) => {
            if (candidate.id === forceId) return voyage?.army ?? updated;
            if (escortIds.has(candidate.id) && delta.locationId !== undefined) return { ...(voyage?.fleets.find((fleet) => fleet.id === candidate.id) ?? candidate), locationId: delta.locationId, positionId: null };
            return candidate;
          }),
        },
      };
    }

    case "force_reinforce": {
      const forceId = required(delta.forceRef, "The force");
      const force = world.material.forces.find((candidate) => candidate.id === forceId);
      if (force === undefined) reject(`No force "${forceId}" exists to reinforce.`, "reference");
      // Men of the same kind added to a force this very answer raised are the
      // raising said twice: "raise Legio II, 5,000 men" became a levy of 5,000
      // and a reinforcement of 5,000 more, two bounties paid and 10,000 under
      // the standard.
      if ([...assignedIds.values()].includes(forceId) && force.personnel.some((row) => row.categoryId === delta.categoryId)) return world;

      // A kind of troops the world does not know yet is made, not refused.
      //
      // This used to reject, on the grounds that the resolver had no numbers
      // for an unknown category -- but the resolver has always fallen back to
      // an ordinary levy, so the refusal cost the order and bought nothing.
      // Rome took Carthaginian elephants into its legions; a world that cannot
      // be told so is missing a piece of the war, not guarding its arithmetic.
      // The numbers are still never the caller's: `newCategory` says what sort
      // of troops these are in bands, and `mintTroopCategory` says what those
      // words are worth.
      const known = allTroopCategories(world, context.warfare.troopCategories);
      const minted = known.some((category) => category.id === delta.categoryId)
        ? null
        : mintTroopCategory(delta.categoryId, {
          label: delta.newCategory?.label ?? labelFromCategoryId(delta.categoryId),
          ...(delta.newCategory == null ? {} : {
            weightBand: delta.newCategory.weightBand,
            steadinessBand: delta.newCategory.steadinessBand,
            mobilityBand: delta.newCategory.mobilityBand,
            naval: delta.newCategory.naval,
          }),
        });

      // Where they came from, if they came from somewhere. Men cannot be in
      // two armies at once, and a draft that leaves the old force at its old
      // strength has invented them.
      let forces = world.material.forces;
      let joining = delta.men;
      if (delta.fromForceRef !== null) {
        const sourceId = required(delta.fromForceRef, "The force they come from");
        const source = forces.find((candidate) => candidate.id === sourceId);
        if (source === undefined) reject(`No force "${sourceId}" exists for them to come from.`, "reference");
        if (source.id === forceId) reject(`${force.name} cannot reinforce itself.`, "reference");
        const available = fitStrengthOf(source);
        if (available <= 0) reject(`${source.name} has no men left to give.`);
        joining = Math.min(joining, available);

        // Taken off the top of the source, category by category, so a draft of
        // eight hundred from an army of two thousand leaves twelve hundred.
        let owed = joining;
        const drained = source.personnel.map((category) => {
          const taken = Math.min(category.fit, owed);
          owed -= taken;
          return { ...category, fit: category.fit - taken };
        });
        forces = forces.map((candidate) => (candidate.id === source.id
          ? {
            ...candidate,
            personnel: drained,
            authorizedStrength: Math.max(1, drained.reduce((sum, category) => sum + category.fit, 0)),
            history: [...candidate.history, {
              id: context.ids.next("personnel"),
              atStep,
              kind: "unavailable" as const,
              categoryId: drained[0]?.categoryId ?? delta.categoryId,
              count: joining,
              causeId: forceId,
            }].slice(-64),
          }
          : candidate));
      }

      // New men, not a draft: levied out of the country and paid for, and a
      // large levy comes in over days (`levies.ts`).
      let base = world;
      let arriving: Pick<ForcePersonnelCategory, "fit" | "unavailable"> = { fit: joining, unavailable: [] };
      if (delta.fromForceRef === null) {
        const payerAccountId = world.material.obligations.find((obligation) => obligation.id === force.payObligationId)?.payerAccountId ?? null;
        const levy = raiseLevy(world, { polityId: force.polityId, provinceId: force.locationId, men: joining, payerAccountId, pays: true, atStep, cause: forceId, ids: context.ids });
        if (levy.men <= 0) reject(levy.short ?? `No men could be raised for ${force.name}.`);
        if (levy.short !== null) {
          emitFact({ localId: `levy_short_${forceId}_${atStep}`.slice(0, 60), kind: "levy_short", summary: levy.short, affectedRefs: [{ kind: "force", id: forceId }, { kind: "province", id: force.locationId }], visibility: "polity", discoveryState: "polity", knowableInDays: 0, significance: 45 });
        }
        base = levy.world;
        forces = base.material.forces;
        joining = levy.men;
        arriving = mustering(delta.categoryId, delta.label, joining, atStep, context.ids.next("levy"), musterRateFor(world, force.polityId));
      }

      const existing = force.personnel.find((category) => category.categoryId === delta.categoryId && category.label === delta.label);
      const personnel = existing === undefined
        ? [...force.personnel, { categoryId: delta.categoryId, label: delta.label, fit: arriving.fit, unavailable: [...arriving.unavailable] }]
        : force.personnel.map((category) => (category === existing ? { ...category, fit: category.fit + arriving.fit, unavailable: [...category.unavailable, ...arriving.unavailable] } : category));
      const strength = personnel.reduce((sum, category) => sum + category.fit, 0) + arriving.unavailable.reduce((sum, band) => sum + band.count, 0);

      return {
        ...base,
        // A kind of troops the world had not heard of before now has. It is
        // ordinary state from here on: merged with the scenario's own list
        // wherever a category is read, so these men fight as what they are in
        // every battle after this one.
        troopCategories: minted === null ? world.troopCategories : [...world.troopCategories, minted],
        material: {
          ...base.material,
          forces: forces.map((candidate) => (candidate.id === forceId
            ? {
              ...candidate,
              personnel,
              // The establishment follows the men, as it does when they are
              // lost: an army of four thousand that takes in eight hundred is
              // an army of four thousand eight hundred on the books.
              authorizedStrength: Math.max(candidate.authorizedStrength, strength),
              history: [...candidate.history, {
                id: context.ids.next("personnel"),
                atStep,
                kind: "reinforcement" as const,
                categoryId: delta.categoryId,
                count: joining,
                // Where they came from, or the army itself for men raised to
                // it directly: `causeId` is not nullable, and a levy's cause
                // is the force it was levied for.
                causeId: (delta.fromForceRef === null ? undefined : resolve(delta.fromForceRef)) ?? forceId,
              }].slice(-64),
            }
            : candidate)),
        },
      };
    }

    case "force_attrition": {
      const forceId = required(delta.forceRef, "The force");
      const force = world.material.forces.find((candidate) => candidate.id === forceId);
      if (force === undefined) reject(`No force "${forceId}" exists.`, "reference");

      // A share of the men actually present, not a number somebody chose. The
      // author says "one in twenty" and this works out what that is -- which is
      // also why a storm cannot drown more men than are aboard.
      let lost = 0;
      const personnel = force.personnel.map((category) => {
        const gone = Math.min(category.fit, Math.floor((category.fit * delta.lossBps) / 10_000));
        lost += gone;
        return { ...category, fit: category.fit - gone };
      });

      const moraleBps = Math.min(10_000, Math.max(0, force.moraleBps + (delta.moraleBpsDelta ?? 0)));
      if (lost === 0) {
        // Too few men for the share to take one. The morale still goes: a camp
        // that has been sickening is a worse camp even where nobody died.
        return {
          ...world,
          material: { ...world.material, forces: world.material.forces.map((candidate) => (candidate.id === forceId ? { ...candidate, moraleBps } : candidate)) },
        };
      }

      const WORD: Readonly<Record<typeof delta.cause, string>> = {
        sickness: "to sickness",
        storm: "in the storm",
        starvation: "to hunger",
        exposure: "to the cold",
        desertion: "by desertion",
      };
      // The engine's own count, not the author's. A loss nobody can read in
      // the record is a loss that did not happen.
      emitFact({
        localId: `attrition_${forceId}`,
        kind: "force_attrition",
        summary: `${force.name} lost ${lost === 1 ? "a man" : `${lost} men`} ${WORD[delta.cause]}.`,
        affectedRefs: [{ kind: "force", id: forceId }],
        visibility: "polity",
        discoveryState: "polity",
        knowableInDays: 0,
        knownToRefs: [],
        significance: delta.cause === "desertion" ? 70 : 60,
      });

      return {
        ...world,
        material: {
          ...world.material,
          forces: world.material.forces.map((candidate) =>
            candidate.id !== forceId
              ? candidate
              : {
                ...candidate,
                personnel,
                moraleBps,
                authorizedStrength: Math.max(1, personnel.reduce((sum, category) => sum + category.fit, 0)),
                history: [
                  ...candidate.history,
                  {
                    id: context.ids.next("personnel"),
                    atStep: context.now.day,
                    kind: delta.cause === "desertion" ? ("desertion" as const) : ("attrition_death" as const),
                    categoryId: personnel[0]?.categoryId ?? "infantry",
                    count: lost,
                    causeId: forceId,
                  },
                ].slice(-64),
              }),
        },
      };
    }

    case "force_engage": {
      const attackerId = required(delta.forceRef, "The attacking force");
      const defenderId = required(delta.targetForceRef, "The force being attacked");
      const attacker = world.material.forces.find((force) => force.id === attackerId);
      if (attacker === undefined) reject(`No force "${attackerId}" exists to give battle.`, "reference");
      const defender = world.material.forces.find((force) => force.id === defenderId);
      if (defender === undefined) reject(`No force "${defenderId}" exists to be given battle.`, "reference");

      if (attacker.id === defender.id) reject("A force cannot give battle to itself.", "reference");
      // (b) An army on hold starts no battle, whoever orders it: the hold is
      // lifted by its own order first (`force_modify` with hold false).
      // Getting away is not attacking: an army on hold may still slip off by night.
      if (attacker.hold === true && delta.manoeuvre !== "withdraw_by_night") reject(`${attacker.name} is under orders to hold, and will not attack until the hold is lifted.`);
      // Armies of one power can fight each other -- a mutiny put down, a
      // consul marching on his colleague, a Rubicon -- so long as they answer
      // to different men. It was refused outright, which made civil war the
      // one kind of war this world could not have. One man's two armies still
      // will not fight each other: that is not strife, it is a mistake.
      // Whose side a force is on: its power's, or -- an outlaw band -- its own.
      const sideOf = (force: typeof attacker): string => (force.outlaw === true ? `outlaw:${force.id}` : force.polityId);
      const civilStrife = sideOf(attacker) === sideOf(defender);
      // One power's armies, or a leader's and its allies' by foedus: a Samnite
      // contingent camped with a consul's legions is attacked with them.
      const onOneSide = (force: typeof attacker, other: typeof attacker): boolean =>
        sideOf(force) === sideOf(other)
        || (force.outlaw !== true && other.outlaw !== true && sameConfederation(world.polityAgreements, force.polityId, other.polityId));
      if (civilStrife && (attacker.commanderCharacterId === defender.commanderCharacterId || attacker.controllerCharacterId === defender.controllerCharacterId)) {
        reject(`${attacker.name} and ${defender.name} answer to the same man and will not fight each other.`);
      }
      // Getting an army to where its enemy stands is movement, and movement is
      // somebody's decision. A battle is what happens once they are both there.
      if (attacker.locationId !== defender.locationId) {
        reject(`${attacker.name} stands in ${world.map.provinces.find((p) => p.id === attacker.locationId)?.name ?? attacker.locationId} and ${defender.name} in ${world.map.provinces.find((p) => p.id === defender.locationId)?.name ?? defender.locationId}; they cannot fight until one of them marches.`);
      }
      const living = (force: typeof attacker): number => force.personnel.reduce((sum, category) => sum + category.fit, 0);
      if (living(attacker) === 0 || living(defender) === 0) reject("An army with no men left in it cannot fight.");
      // Ships and armies do not fight each other. A fleet standing off a coast
      // blockades it; a legion on the shore cannot board it, and it cannot
      // storm the legion.
      if (isNavalForce(attacker, warfareWith(world, context.warfare)) !== isNavalForce(defender, warfareWith(world, context.warfare))) {
        reject(`${attacker.name} and ${defender.name} do not fight on the same element; ships blockade a coast, they do not give battle to an army on it.`);
      }
      // Attacking a power you are at peace with is a thing armies do -- it is
      // how most wars start -- but it is not an ordinary battle, and the world
      // must not slide into war without anybody having decided to. The attack
      // is refused until the peace is broken or a war declared, which are both
      // single deltas and both leave a record of who chose it.
      // Nobody makes peace with brigands: an outlaw band may be fought, and may
      // fight, without a war being declared on anybody.
      // An ally bound by foedus stands in its leader's peaces as well as its own.
      const standing = attacker.outlaw === true || defender.outlaw === true ? [] : agreementsBetweenSides(world.polityAgreements, attacker.polityId, defender.polityId);
      const peaceBetween = standing.find((agreement) => agreement.kind === "peace" || agreement.kind === "truce" || agreement.kind === "alliance" || agreement.kind === "non_aggression" || agreement.kind === "foedus");
      if (peaceBetween !== undefined && !standing.some((agreement) => agreement.kind === "war")) {
        reject(`${attacker.polityId} and ${defender.polityId} stand in ${AGREEMENT_KIND_IN_WORDS[peaceBetween.kind]}; break it or declare war before giving battle.`);
      }
      // With neither peace nor war between them, the attack is the war's
      // beginning, and the war is opened by it. Legio I stormed Messana with
      // Rome and the Mamertines at war on no account, so nothing afterwards
      // knew they were enemies: not the Mamertines, not the siege, not the
      // record, which had only a breach nobody would read.
      const outlawed = attacker.outlaw === true || defender.outlaw === true;
      if (!outlawed && attacker.polityId !== defender.polityId && !atWar(world.polityAgreements, attacker.polityId, defender.polityId)) {
        const where = world.map.provinces.find((province) => province.id === attacker.locationId)?.name ?? attacker.locationId;
        const opened = applyOne(world, {
          op: "agreement_open", localId: `attack_${attacker.id}_${atStep}`.slice(0, 60), kind: "war",
          polityId: attacker.polityId, otherPolityId: defender.polityId,
          terms: `War begun by ${attacker.name}'s attack at ${where}.`.slice(0, 600), forDays: null, sourceMessageRef: null, visibility: "public",
          reason: `${attacker.name} attacked ${defender.name}.`.slice(0, 240),
        }, context, assignedIds, resolve, emitFact, emitAccount);
        emitFact({
          localId: `war_by_attack_${attacker.id}`.slice(0, 60),
          kind: "war_declared",
          summary: `${polityName(world, attacker.polityId)} made war on ${polityName(world, defender.polityId)}, beginning it with ${attacker.name}'s attack at ${where}.`,
          affectedRefs: [{ kind: "polity", id: attacker.polityId }, { kind: "polity", id: defender.polityId }, { kind: "force", id: attacker.id }],
          visibility: "public",
          discoveryState: "public",
          knowableInDays: 0,
          significance: 70,
        });
        return applyOne(opened, delta, context, assignedIds, resolve, emitFact, emitAccount);
      }

      // Who else is on the field. One army against one was the whole of what a
      // battle could be, so a flank attack by a second army was a second battle
      // against an enemy that had to fight twice -- and always lost the second.
      //
      // Joining by themselves: the attacker's own power's armies in the province
      // under the same commander or the same controller (one general's hammer
      // and anvil), and every army of the defender's power standing there (a
      // camp attacked is attacked whole). Anybody else comes in by name.
      const rules = warfareWith(world, context.warfare);
      const onTheSameElement = (force: typeof attacker): boolean => isNavalForce(force, rules) === isNavalForce(attacker, rules);
      const here = world.material.forces.filter((force) =>
        force.locationId === attacker.locationId && force.id !== attacker.id && force.id !== defender.id && living(force) > 0 && onTheSameElement(force));
      const named = new Set((delta.alliedForceRefs ?? []).map((ref) => required(ref, "An army joining the attack")));
      for (const id of named) {
        const ally = world.material.forces.find((force) => force.id === id);
        if (ally === undefined) reject(`No force "${id}" exists to join the attack.`, "reference");
        if (ally.locationId !== attacker.locationId) {
          reject(`${ally.name} is not on the field: it stands in ${world.map.provinces.find((p) => p.id === ally.locationId)?.name ?? ally.locationId}, and the battle is in ${world.map.provinces.find((p) => p.id === attacker.locationId)?.name ?? attacker.locationId}.`);
        }
        const sameSideAsDefender = civilStrife
          ? ally.commanderCharacterId === defender.commanderCharacterId || ally.controllerCharacterId === defender.controllerCharacterId
          : onOneSide(ally, defender);
        if (sameSideAsDefender) reject(`${ally.name} stands with ${defender.name} and will not attack it.`);
      }
      const underTheSameMan = (force: typeof attacker, as: typeof attacker): boolean =>
        onOneSide(force, as) && (force.commanderCharacterId === as.commanderCharacterId || force.controllerCharacterId === as.controllerCharacterId);
      const attackerAllies = here.filter((force) => named.has(force.id) || underTheSameMan(force, attacker));
      // A camp attacked is attacked whole -- but in a civil war the camp is
      // divided, and only the defender's own man's armies stand with him.
      const defenderAllies = here.filter((force) => !attackerAllies.includes(force)
        && (civilStrife ? underTheSameMan(force, defender) : onOneSide(force, defender)));

      // The order opens a fight, or adds to one already begun, and its first
      // day is fought now (docs/plans/battles-that-last.md). The engine
      // decides each day after it until one side is beaten.
      const battleId = context.ids.next("battle");
      // At sea it is one day's battle and its pursuit, as it was: fleets beach
      // at night and do not camp in sight of each other for a week
      // (docs/plans/battles-that-last.md, decision 12).
      if (isNavalForce(attacker, rules)) {
        const seaFight = resolveEngagement({
          world, attacker, defender, attackerAllies, defenderAllies, posture: delta.posture,
          tactic: delta.tactic ?? attacker.battlePlan ?? null, defenderTactic: defender.battlePlan ?? null,
          warfare: rules, battleId, seed: `${context.gameId}:${battleId}`, playerCharacterId: context.playerCharacterId ?? null,
        }, world.material.forces.findIndex((force) => force.id === attackerId));
        for (const fact of seaFight.facts) emitFact(fact);
        if (seaFight.account !== undefined) emitAccount(seaFight.account);
        return {
          ...seaFight.world,
          conflicts: {
            ...seaFight.world.conflicts,
            battles: [...seaFight.world.conflicts.battles.filter((battle) => battle.battleId !== battleId), {
              battleId,
              participantForceIds: [attacker.id, ...attackerAllies.map((force) => force.id), defender.id, ...defenderAllies.map((force) => force.id)],
              attackerForceIds: [attacker.id, ...attackerAllies.map((force) => force.id)],
            }].slice(-MAX_SHOWN_BATTLES),
          },
        };
      }
      const opened = openEngagement(world, {
        attacker, defender, attackerAllies, defenderAllies, posture: delta.posture, atStep, id: context.ids.next("engagement"), manoeuvre: delta.manoeuvre,
      });
      // The plan given with the order is the army's own from now on, for every day of it.
      const planned = delta.tactic === null ? opened.world : {
        ...opened.world,
        material: { ...opened.world.material, forces: opened.world.material.forces.map((force) => (force.id === attacker.id ? { ...force, battlePlan: delta.tactic } : force)) },
      };
      const firstDay = fightRound(
        { world: planned, warfare: warfareWith(world, context.warfare), ids: context.ids, playerCharacterId: context.playerCharacterId ?? null },
        opened.engagement.id,
        atStep,
        world.material.forces.findIndex((force) => force.id === attackerId),
      );
      const engagement = { world: firstDay.world, facts: firstDay.facts, account: firstDay.battles[0] };
      for (const fact of engagement.facts) emitFact(fact);
      if (civilStrife) {
        const polityName = world.map.polities.find((polity) => polity.id === attacker.polityId)?.name ?? attacker.polityId;
        const commanderName = (force: typeof attacker): string => world.characters.find((character) => character.id === force.commanderCharacterId)?.name ?? force.name;
        emitFact({
          localId: `strife_${battleId}`,
          kind: "civil_strife",
          summary: `${polityName}'s own armies fought each other: ${commanderName(attacker)}'s ${attacker.name} fell upon ${commanderName(defender)}'s ${defender.name}.`,
          affectedRefs: [{ kind: "polity", id: attacker.polityId }, { kind: "force", id: attacker.id }, { kind: "force", id: defender.id },
            { kind: "character", id: attacker.commanderCharacterId }, { kind: "character", id: defender.commanderCharacterId }],
          visibility: "public",
          discoveryState: "public",
          knowableInDays: 0,
          significance: 85,
        });
      }
      if (engagement.account !== undefined) emitAccount(engagement.account);
      // The map has read `conflicts` from the beginning and nothing ever wrote
      // it, so a battle was fought, a province changed hands, and the map where
      // it happened showed nothing at all.
      // Romans killing Romans costs the Republic, whoever wins.
      const afterStrife = !civilStrife ? engagement.world : {
        ...engagement.world,
        material: {
          ...engagement.world.material,
          polityLegitimacy: adjustPolityLegitimacy(engagement.world.material.polityLegitimacy, attacker.polityId, -800, "Its own armies fought each other", context.ids.next("cause")),
        },
      };
      return {
        ...afterStrife,
        conflicts: {
          ...afterStrife.conflicts,
          battles: [
            ...afterStrife.conflicts.battles.filter((battle) => battle.battleId !== battleId),
            {
              battleId,
              participantForceIds: [attacker.id, ...attackerAllies.map((force) => force.id), defender.id, ...defenderAllies.map((force) => force.id)],
              attackerForceIds: [attacker.id, ...attackerAllies.map((force) => force.id)],
            },
          ].slice(-MAX_SHOWN_BATTLES),
        },
      };
    }

    case "character_create": {
      const newCharacterPolityId = required(delta.polityId, "The power this person belongs to");
      if (!world.map.polities.some((polity) => polity.id === newCharacterPolityId)) {
        reject(`No power "${newCharacterPolityId}" exists for this person to belong to.`, "reference");
      }
      const provinceId = delta.provinceId ?? world.map.provinces[0]?.id;
      if (provinceId === undefined) reject("The world has no province to place a new character in.", "reference");
      // Somebody of this exact name already living in this power is the man
      // meant, not a second one nobody can tell from him: a second "Publius
      // Nerius" was made for the second spying mission, and two "Abd al-Malik
      // of Gerrha" ruled one city (R74, R45). The handle is his.
      // Spelt a letter differently is still him ("Aristodemos" for
      // "Aristodemus"): one match only, or it is somebody else (E10).
      const twoWords = delta.name.trim().split(/\s+/).length >= 2;
      const alike = twoWords ? world.characters.filter((character) => character.alive && character.polityId === newCharacterPolityId && spelledAlike(character.name, delta.name)) : [];
      const sameMan = world.characters.find((character) => character.alive && character.polityId === newCharacterPolityId
        && normalizeName(character.name) === normalizeName(delta.name) && twoWords) ?? (alike.length === 1 ? alike[0] : undefined);
      if (sameMan !== undefined) {
        assignedIds.set(delta.localId, sameMan.id);
        return world;
      }
      const id = mint("character", delta.localId);
      // What the world says this person is worth, brought inside what somebody
      // of that description could plausibly have. Clamped, never rejected: a
      // rich merchant and a poor one are both merchants, and refusing the
      // whole creation over a number would cost the world the person.
      const purse = clampWealth(delta.wealth, delta.standing ?? delta.officeLabel, context.wealth);
      const created = createCanonicalNpc(world, {
        ...(purse > 0 ? { startingMoney: purse } : {}),
        characterId: id,
        name: delta.name,
        locationProvinceId: provinceId,
        polityId: newCharacterPolityId,
        officeId: null,
        createdAtStep: atStep,
        creationReason: delta.generatedBecause,
        ageYearsAtStart: delta.age,
      });
      if (created === null) reject(`Could not create "${delta.name}" at province "${provinceId}".`, "reference");
      // The registry's own words, not the free text. A live world was holding
      // "hellenistic_governor", "cavalry leader" and "protective of tribal
      // autonomy" as traits -- none of which mean anything to the dialogue
      // guidance NPC prompts read or to the incompatibilities the observation
      // rule checks, because both live in `TRAIT_REGISTRY` and none of those
      // are in it.
      // Raised where something trains people -- an academy, a war school --
      // and it shows. Bands the world gave still win: it said what he is.
      const trained = recruitSkillBiasIn(created.world, provinceId);
      const faith = delta.faith === undefined ? null : faithNamed(created.world, delta.faith, atStep, id);
      const withTraits = (faith?.world ?? created.world).characters.map((character) => {
        if (character.id !== id) return character;
        const skills = trained === 0
          ? character.skills
          : { ...character.skills, martial: clampSkill(character.skills.martial + trained), learning: clampSkill(character.skills.learning + Math.round(trained * 0.7)) };
        return {
          ...character,
          traits: canonicalTraitIds(delta.traits),
          skills: skillsFromBands(skills, delta.skills),
          ...(faith === null ? {} : { faithId: faith.faithId }),
          ...(delta.gender === undefined ? {} : { gender: delta.gender }),
          ...(delta.legalStatus === undefined || delta.legalStatus === "free" ? {} : {
            legalStatus: delta.legalStatus,
            ownerCharacterId: context.actorRef.kind === "character" ? context.actorRef.id : null,
          }),
        };
      });
      const founded = faith?.world ?? created.world;
      // Whose wife, whose son. Written as kinship the succession rules read,
      // not as a sentence in a fact: an heir nobody recorded is nobody's heir.
      let familyLinks = founded.familyLinks;
      if (delta.kin != null) {
        const kinId = required(delta.kin.ofCharacterRef, "The person they are kin to");
        if (!founded.characters.some((character) => character.id === kinId)) {
          reject(`No character "${kinId}" exists for ${delta.name} to be kin to.${nearestTo(kinId)}`, "reference");
        }
        familyLinks = [...familyLinks, {
          id: context.ids.next("family"),
          characterId: id,
          relatedCharacterId: kinId,
          kind: delta.kin.relation,
          startedAtStep: atStep,
          endedAtStep: null,
          visibility: "public" as const,
          provenanceEventId: null,
        }];
      }
      // The world says what it made this person: "Military Quaestor", "chief of
      // the Boii". That was parsed and thrown on the floor -- every generated
      // official came out holding no office, which is how the world's own
      // invented magistrates could never do anything a magistrate does.
      const withOffice: WorldState = { ...founded, characters: withTraits, familyLinks };
      if (delta.officeLabel === null) return withOffice;

      const known = allOffices(withOffice, context.offices);
      // Is there such an office at all -- not is there room in it. A
      // consulship whose seats are both filled is still a consulship, and
      // asked for another consul the world should enlarge the college rather
      // than invent a second consulship beside it.
      const existing = findOfficeForRole(known, newCharacterPolityId, delta.officeLabel);
      if (existing !== undefined) {
        const seat = findOfficeSeatForRole(withOffice, { offices: [existing] }, newCharacterPolityId, delta.officeLabel);
        return seatCharacterInOffice(withOffice, id, seat ?? { office: existing, vacantSeatId: null }, atStep);
      }

      // No such office yet -- so the government makes one. A scenario's list is
      // where a government starts, not the whole of what it may ever contain:
      // "name a quaestor to handle the war chest" used to match nothing and
      // leave the man holding no office at all, because there was no
      // quaestorship and no way to make one.
      const officeId = context.ids.next("office");
      const opened = openOffice(withOffice, officeId, delta.officeLabel, newCharacterPolityId, delta.officeAuthorises);
      return seatCharacterInOffice(opened, id, { office: { id: officeId, eligibilityRequirementIds: [] }, vacantSeatId: null }, atStep);
    }

    case "character_intent_set": {
      const actorId = required(delta.actorCharacterRef, "The acting character");
      if (!world.characters.some((character) => character.id === actorId)) reject(`No character "${actorId}" exists to hold this intent.${nearestTo(actorId)}`, "reference");
      const targetIds = delta.targetRefs.map((ref) => required(ref, "An intent target"));
      const intent = {
        id: context.ids.next("intent"),
        actorCharacterId: actorId,
        sourceGoalId: null,
        sourcePlotId: null,
        sourceCommitmentId: null,
        actionType: delta.actionType,
        targetIds,
        rationale: delta.rationale,
        prerequisites: [],
        intendedWorkflowIds: [],
        priority: delta.priority,
        status: "proposed" as const,
        createdAtStep: atStep,
        reviewedAtStep: null,
        // A month, unless he is asked again and means it still (`intents.ts`).
        expiresAtStep: atStep + INTENT_LIFETIME_DAYS,
        visibility: delta.visibility,
        sourceEventIds: [],
        resolutionReason: null,
      };
      return { ...world, characterIntents: [...world.characterIntents, intent] };
    }

    case "polity_stance_shift": {
      const stanceHolderId = required(delta.polityId, "The power holding the stance");
      const stanceTowardId = required(delta.towardPolityId, "The power it is held toward");
      if (stanceHolderId === stanceTowardId) reject("A polity holds no stance toward itself.", "reference");
      const known = new Set(world.map.polities.map((polity) => polity.id));
      if (!known.has(stanceHolderId) || !known.has(stanceTowardId)) reject("A stance must be between two polities that exist.", "reference");
      const existing = world.polityStances.find((stance) => stance.polityId === stanceHolderId && stance.towardPolityId === stanceTowardId);
      const clamp = (value: number) => Math.max(-100, Math.min(100, value));
      if (existing === undefined) {
        return {
          ...world,
          polityStances: [
            ...world.polityStances,
            { polityId: stanceHolderId, towardPolityId: stanceTowardId, trustScore: clamp(delta.trustDelta), lastShiftReason: delta.reason, lastShiftAtStep: atStep },
          ],
        };
      }
      return {
        ...world,
        polityStances: world.polityStances.map((stance) =>
          stance === existing
            ? { ...stance, trustScore: clamp(stance.trustScore + delta.trustDelta), lastShiftReason: delta.reason, lastShiftAtStep: atStep }
            : stance,
        ),
      };
    }

    case "polity_outlook_set": {
      const outlookPolityId = required(delta.polityId, "The power holding the outlook");
      if (!world.map.polities.some((polity) => polity.id === outlookPolityId)) {
        reject(`No polity "${outlookPolityId}" exists to hold an outlook.`, "reference");
      }
      const outlook = {
        polityId: outlookPolityId,
        primaryObjective: delta.primaryObjective,
        concerns: delta.concerns,
        intentions: delta.intentions,
        riskTolerance: delta.riskTolerance,
        updatedAtStep: atStep,
        lastChangeReason: delta.reason,
      };
      // A country holds one outlook at a time. Keeping the old one beside the
      // new would leave the world unable to say what it currently wants.
      const existing = world.polityOutlooks.some((candidate) => candidate.polityId === outlookPolityId);
      return {
        ...world,
        polityOutlooks: existing
          ? world.polityOutlooks.map((candidate) => (candidate.polityId === outlookPolityId ? outlook : candidate))
          : [...world.polityOutlooks, outlook],
      };
    }

    case "legitimacy_shift": {
      const legitimacyTargetId = required(delta.targetId, "The power or body whose standing moves");
      if (delta.target === "polity") {
        if (!world.map.polities.some((polity) => polity.id === legitimacyTargetId)) {
          reject(`No polity "${legitimacyTargetId}" exists to gain or lose standing.`, "reference");
        }
        // The shared helper already creates the record on first use, bounds the
        // result and records the cause. Reimplementing that here is how the two
        // would drift apart.
        const adjusted = adjustPolityLegitimacy(
          world.material.polityLegitimacy,
          legitimacyTargetId,
          delta.legitimacyBpsDelta,
          delta.causeLabel,
          context.ids.next("cause"),
        );
        const confidenceDelta = delta.institutionalConfidenceBpsDelta ?? 0;
        const withConfidence = confidenceDelta === 0
          ? adjusted
          : adjusted.map((entry) =>
            entry.polityId === legitimacyTargetId
              ? { ...entry, institutionalConfidenceBps: clampBps(entry.institutionalConfidenceBps + confidenceDelta) }
              : entry,
          );
        return { ...world, material: { ...world.material, polityLegitimacy: withConfidence } };
      }

      if (!world.material.institutions.some((institution) => institution.id === legitimacyTargetId)) {
        reject(`No institution "${legitimacyTargetId}" exists to gain or lose standing.`, "reference");
      }
      const cause = { id: context.ids.next("cause"), label: delta.causeLabel, score: clampScore(Math.round(delta.legitimacyBpsDelta / 10)), sourceId: legitimacyTargetId };
      const existing = world.material.institutionLegitimacy.find((entry) => entry.institutionId === legitimacyTargetId);
      const institutionLegitimacy = existing === undefined
        ? [...world.material.institutionLegitimacy, { institutionId: legitimacyTargetId, legitimacyBps: clampBps(5_000 + delta.legitimacyBpsDelta), causes: [cause] }]
        : world.material.institutionLegitimacy.map((entry) =>
          entry.institutionId === legitimacyTargetId
            ? { ...entry, legitimacyBps: clampBps(entry.legitimacyBps + delta.legitimacyBpsDelta), causes: [...entry.causes, cause] }
            : entry,
        );
      return { ...world, material: { ...world.material, institutionLegitimacy } };
    }

    case "province_material_shift": {
      if (!world.map.provinces.some((province) => province.id === delta.provinceId)) {
        reject(`No province "${delta.provinceId}" exists to be changed.`, "reference");
      }
      // A province with no material row yet is the ordinary case on an older
      // world, not an error: derive one from its settlements and then move it.
      const backfilled = ensureProvinceMaterial(world, atStep);
      const provinceMaterial = backfilled.material.provinceMaterial.map((material) => {
        if (material.provinceId !== delta.provinceId) return material;
        return {
          ...material,
          population: Math.max(0, material.population + (delta.populationDelta ?? 0)),
          availableManpower: Math.max(0, material.availableManpower + (delta.availableManpowerDelta ?? 0)),
          stabilityBps: clampBps(material.stabilityBps + (delta.stabilityBpsDelta ?? 0)),
          foodSecurityBps: clampBps(material.foodSecurityBps + (delta.foodSecurityBpsDelta ?? 0)),
          productiveCapacityBps: clampBps(material.productiveCapacityBps + (delta.productiveCapacityBpsDelta ?? 0)),
          warDamageBps: clampBps(material.warDamageBps + (delta.warDamageBpsDelta ?? 0)),
          taxCapacity: Math.max(0, material.taxCapacity + (delta.taxCapacityDelta ?? 0)),
          displacedPopulation: Math.max(0, material.displacedPopulation + (delta.displacedPopulationDelta ?? 0)),
          lastMaterialUpdateStep: atStep,
        };
      });
      return { ...backfilled, material: { ...backfilled.material, provinceMaterial } };
    }

    case "political_procedure_open": {
      const sponsorId = required(delta.sponsorCharacterRef, "The sponsor");
      if (!world.characters.some((character) => character.id === sponsorId)) {
        reject(`No character "${sponsorId}" exists to sponsor this.${nearestTo(sponsorId)}`, "reference");
      }
      const namedInstitutionId = delta.institutionRef === null ? null : required(delta.institutionRef, "The institution");
      if (namedInstitutionId !== null && !world.material.institutions.some((institution) => institution.id === namedInstitutionId)) {
        reject(`No institution "${namedInstitutionId}" exists to put this before.`, "reference");
      }
      // A deliberation about the state goes before the state's chamber. "Deliberate
      // on authorization for a larger army" was opened before nobody, to be
      // settled at its sponsor's discretion with no day set: the consul's own
      // petition for an army was folded into it and could never be voted on.
      // So does any vote that names no body: a consul's "put the Campanians'
      // punitive service to the Senate", about a group and not the state, was
      // refused three times for want of an institution, and his promise to the
      // player was then told as a refusal.
      const aboutTheState = namedInstitutionId === null && (delta.type === "council_deliberation" || delta.resolutionMechanism === "vote");
      const sponsorPolityId = world.characters.find((character) => character.id === sponsorId)?.polityId ?? null;
      const statePolityId = !aboutTheState ? null
        : (delta.subjectKind === "polity" && delta.subjectRef !== null ? resolve(delta.subjectRef) ?? delta.subjectRef : null) ?? sponsorPolityId;
      const chamberForIt = statePolityId === null ? null : sovereignChamberOf(world, statePolityId);
      const institutionId = namedInstitutionId ?? chamberForIt?.id ?? null;
      const resolutionMechanism = chamberForIt !== null && namedInstitutionId === null ? "vote" as const : delta.resolutionMechanism;
      // A vote needs a body to hold it. The schema enforces this too; catching
      // it here means the player hears why rather than losing the whole batch.
      if (resolutionMechanism === "vote" && institutionId === null) {
        reject("A question can only be put to a vote before an institution that can hold one.");
      }
      const subjectId = delta.subjectRef === null ? null : required(delta.subjectRef, "The subject");
      const existingQuestion = world.material.politicalProcedures.find((question) => question.institutionId === institutionId && question.subjectKind === delta.subjectKind && question.subjectId === subjectId && question.outcome === null && sameWork("political", question.label, "political", delta.label));
      if (existingQuestion !== undefined) {
        assignedIds.set(delta.localId, existingQuestion.id);
        if (delta.enacts == null || world.enactments.some((enactment) => enactment.procedureId === existingQuestion.id)) return withConcerns(world, existingQuestion.id);
      }
      // The constitution is changed only where it may be: before the chamber
      // that holds that power, or by the ruler's own decree where none does.
      const amendment = delta.enacts?.constitution;
      if (amendment !== undefined) {
        const lawPolity = world.material.institutions.find((institution) => institution.id === institutionId)?.polityId
          ?? world.characters.find((character) => character.id === sponsorId)?.polityId ?? null;
        if (lawPolity !== null) {
          const sovereign = sovereignChamberOf(world, lawPolity);
          const government = { offices: context.offices, successionRules: context.successionRules ?? [] };
          if (sovereign !== null && institutionId !== sovereign.id) {
            reject(`Only the ${sovereign.name} [${sovereign.id}] may change the constitution of ${world.map.polities.find((polity) => polity.id === lawPolity)?.name ?? lawPolity}; put it there.`);
          }
          if (sovereign === null && institutionId === null && rulerOf(world, lawPolity, government)?.id !== sponsorId) {
            const ruler = rulerOf(world, lawPolity, government);
            reject(`Where no chamber holds the constitution, only its ruler${ruler === null ? "" : `, ${ruler.name},`} may decree a change to it; anybody else may put it to his council, or take the state.`);
          }
        }
      }
      const id = existingQuestion?.id ?? mint("procedure", delta.localId);
      const procedure = existingQuestion ?? {
        id,
        type: delta.type,
        institutionId,
        sponsorCharacterId: sponsorId,
        subjectKind: delta.subjectKind,
        subjectId,
        label: delta.label,
        eligibilityRequirementIds: [],
        eligibleParticipantIds: [],
        stage: "gathering_support" as const,
        resolutionMechanism,
        openedAtStep: atStep,
        deadlineStep: delta.deadlineInDays === null ? null : atStep + delta.deadlineInDays,
        resolvedAtStep: null,
        visibility: delta.visibility,
        voteRecordId: null,
        outcome: null,
        outcomeReason: null,
        sourceEventIds: [],
        resultingEventIds: [],
        ...(delta.concerns === undefined ? {} : { concerns: [...delta.concerns] }),
      };
      const opened: WorldState = { ...world, material: { ...world.material, politicalProcedures: existingQuestion === undefined ? [...world.material.politicalProcedures, procedure] : world.material.politicalProcedures } };
      if (delta.enacts == null) return withConcerns(opened, id);
      // What it will do if carried, kept until then with every reference
      // resolved now: an account named today is the one that pays.
      const polityId = world.material.institutions.find((institution) => institution.id === institutionId)?.polityId
        ?? world.characters.find((character) => character.id === sponsorId)?.polityId;
      if (polityId == null) reject("A measure has to be some power's law; its sponsor belongs to none.", "reference");
      // The work it pays for, judged now as any project is and kept waiting on
      // the vote. The power sponsors it, so its chest pays and no one man's
      // hand is on the money.
      let withWork: WorldState = opened;
      let projectId: string | null = null;
      if (delta.enacts.project !== undefined) {
        const workLocalId = `${delta.localId}_work`.slice(0, 60);
        const built = applyOne(opened, {
          op: "project_create", localId: workLocalId, ...delta.enacts.project,
          sponsorRef: { kind: "polity", id: polityId }, reason: delta.reason,
        }, context, assignedIds, resolve, () => {}, emitAccount);
        projectId = assignedIds.get(workLocalId) ?? null;
        const work = built.projects.find((project) => project.id === projectId);
        if (work !== undefined) withWork = { ...opened, projects: [...opened.projects.filter((project) => project.id !== work.id), opened.projects.some((project) => project.id === work.id) ? work : { ...work, status: "proposed" as const }] };
      }
      const office = delta.enacts.office;
      const enacted = {
        ...withWork,
        enactments: [...withWork.enactments, {
          procedureId: id,
          budget: delta.enacts.budget === undefined ? null : { accountId: required(delta.enacts.budget.accountRef, "The budget account"), amount: delta.enacts.budget.amount, purpose: delta.enacts.budget.purpose, ...budgetHolderOf(world, delta.enacts.budget.holderRef, resolve, allOffices(world, context.offices)) },
          projectId,
          polityId,
          effects: delta.enacts.effects ?? [],
          upkeep: upkeepFrom(world, delta.enacts.upkeep, required),
          office: office === undefined ? null : {
            officeId: office.officeId,
            officeLabel: office.officeLabel ?? null,
            authorises: office.authorises ?? null,
            ...(office.termDays === undefined ? {} : { termDays: office.termDays }),
            seats: office.seats ?? null,
            abolish: office.abolish,
          },
          body: delta.enacts.body ?? null,
          department: (() => {
            const department = delta.enacts.department;
            if (department === undefined) return null;
            const departmentId = department.departmentRef == null ? null : required(department.departmentRef, "The department");
            if (departmentId !== null && !world.departments.some((candidate) => candidate.id === departmentId && candidate.abolishedAtStep === null)) {
              reject(`No department "${departmentId}" stands to reform or abolish.`, "reference");
            }
            if (departmentId === null && department.abolish) reject("A department has to exist to be abolished; name it.", "reference");
            return {
              departmentId,
              name: department.name ?? null,
              offices: [
                ...(department.headOfficeId === undefined ? [] : [{ officeId: department.headOfficeId, role: "head" as const }]),
                ...(department.officeIds ?? []).filter((officeId) => officeId !== department.headOfficeId).map((officeId) => ({ officeId, role: "officer" as const })),
                ...(department.deputyOfficeIds ?? []).map((officeId) => ({ officeId, role: "deputy" as const })),
              ].slice(0, 8).map((office) => ({ ...office, officeLabel: null, seats: null })),
              levers: department.levers?.slice(0, 12) ?? null,
              pay: department.pay ?? null,
              effects: department.effects ?? [],
              abolish: department.abolish,
            };
          })(),
          waiver: delta.enacts.waiver === undefined ? null : { characterId: required(delta.enacts.waiver.characterRef, "The man excused"), officeId: delta.enacts.waiver.officeId },
          franchise: delta.enacts.franchise === undefined ? null : { polityIds: delta.enacts.franchise.polityIds.map((ref) => required(ref, "The ally given the citizenship")), status: delta.enacts.franchise.status },
          // Land for the landless and debts eased, sized the day it passes (`reform-laws.ts`).
          land: delta.enacts.land === undefined ? null : { provinceId: delta.enacts.land },
          debt: delta.enacts.debt === undefined ? null : { interestCapBps: null, forgiveBps: delta.enacts.debt },
          // Its armies remade, carried out the day it passes (`military-reform.ts`).
          // A body to redraw has to be one the power's establishment has.
          military: (() => {
            const military = delta.enacts.military;
            if (military === undefined) return null;
            const establishment = world.establishments.find((candidate) => candidate.polityId === polityId);
            if (establishment === undefined && (military.redraw !== undefined || (military.drop ?? []).length > 0)) {
              reject(`${world.map.polities.find((polity) => polity.id === polityId)?.name ?? polityId} keeps no establishment of armies to redraw; adopt a doctrine or set its terms of service first.`, "reference");
            }
            if (military.redraw !== undefined && establishment?.bodies.some((body) => body.id === military.redraw!.bodyId) !== true) {
              reject(`No body "${military.redraw.bodyId}" in the establishment; it has ${establishment?.bodies.map((body) => body.id).join(", ") ?? "none"}.`, "reference");
            }
            return military;
          })(),
          constitution: amendment === undefined ? null : {
            form: amendment.form ?? null,
            commandTenure: amendment.commandTenure ?? null,
            chamber: amendment.chamber === undefined ? null : {
              institutionId: amendment.chamber.institutionRef == null ? null : required(amendment.chamber.institutionRef, "The chamber"),
              name: amendment.chamber.name ?? null,
              powers: amendment.chamber.powers ?? null,
              advisory: amendment.chamber.advisory ?? null,
              franchise: amendment.chamber.franchise ?? null,
              abolish: amendment.chamber.abolish,
            },
            succession: amendment.succession === undefined ? null : {
              officeId: amendment.succession.officeId,
              kind: amendment.succession.kind,
              institutionId: amendment.succession.institutionRef == null ? null : required(amendment.succession.institutionRef, "The chamber that elects"),
            },
          },
          enactedAtStep: null,
        }],
      } satisfies WorldState;
      return withConcerns(enacted, id);
    }

    case "political_support_set": {
      const procedureId = required(delta.procedureRef, "The question");
      if (!world.material.politicalProcedures.some((procedure) => procedure.id === procedureId)) {
        reject(`No open question "${procedureId}" exists to take a side on.`, "reference");
      }
      let supporterId = required(delta.supporterRef, "The supporter");
      // A faction the world made as an arrangement -- there is no other way to
      // make one -- takes sides as the political group it is.
      // An army backing a man's campaign -- "his influence with the Silver
      // Shields" -- takes sides as the military faction it is, led by its
      // commander.
      const asForce = delta.supporterKind === "group" ? world.material.forces.find((force) => force.id === supporterId) : undefined;
      if (asForce !== undefined) {
        const groupId = boundedId(asForce.id, "group");
        if (!world.material.politicalGroups.some((group) => group.id === groupId)) {
          world = {
            ...world,
            material: {
              ...world.material,
              politicalGroups: [...world.material.politicalGroups, {
                id: groupId, name: asForce.name.slice(0, 120), polityId: asForce.polityId, type: "military_command" as const,
                leaderCharacterId: asForce.commanderCharacterId, platform: [], resourceAccountId: null, publicReputationBps: 5_000, active: true,
              }],
            },
          };
        }
        supporterId = groupId;
      }
      const asArrangement = delta.supporterKind === "group" ? world.genericEntities.find((entity) => entity.id === supporterId) : undefined;
      if (asArrangement !== undefined) {
        const groupId = boundedId(asArrangement.id, "group");
        if (!world.material.politicalGroups.some((group) => group.id === groupId)) {
          const fund = world.material.accounts.find((account) => account.owner.kind === "entity" && account.owner.id === asArrangement.id);
          world = {
            ...world,
            material: {
              ...world.material,
              politicalGroups: [...world.material.politicalGroups, {
                id: groupId,
                name: asArrangement.label.slice(0, 120),
                polityId: asArrangement.ownerRef?.kind === "polity" ? asArrangement.ownerRef.id : actorPolityOf(world, context),
                type: "faction" as const,
                leaderCharacterId: asArrangement.ownerRef?.kind === "character" ? asArrangement.ownerRef.id : null,
                platform: [],
                resourceAccountId: fund?.id ?? null,
                publicReputationBps: 5_000,
                active: true,
              }],
            },
          };
        }
        supporterId = groupId;
      }
      // A voting bloc inside the body hearing the question is as real a
      // supporter as a faction outside it, and usually the one that decides.
      const supporterExists = delta.supporterKind === "character"
        ? world.characters.some((character) => character.id === supporterId)
        : world.material.politicalGroups.some((group) => group.id === supporterId)
          || world.material.institutions.some((institution) => institution.votingBlocs.some((bloc) => bloc.id === supporterId));
      if (!supporterExists) reject(`No faction or voting bloc "${supporterId}" exists to hold a position.`, "reference");
      // Once is a speech; the same man saying the same side again is not news.
      // Allied silver was argued for in near-identical words five days running,
      // each one an entry, while the order it was voted for went unreported (R58).
      const before = [...world.material.supportPositions].reverse()
        .find((candidate) => candidate.procedureId === procedureId && candidate.supporterKind === delta.supporterKind && candidate.supporterId === supporterId);
      const saidBefore = before !== undefined && before.position === delta.position;

      // Positions are append-only: someone who changes their mind leaves both
      // rows behind, and the later one is what counts. That is what lets the
      // world say a senator turned, rather than only that he opposes.
      const position = {
        id: context.ids.next("support"),
        procedureId,
        supporterKind: delta.supporterKind,
        supporterId,
        position: delta.position,
        influenceWeight: delta.influenceWeight,
        visibility: delta.visibility,
        reasons: [{ kind: delta.reasonKind, label: delta.reasonLabel, score: delta.position === "support" ? 50 : delta.position === "oppose" ? -50 : 0, sourceId: supporterId }],
        provenanceEventIds: [],
        changedAtStep: atStep,
      };
      // A tribune against a measure of his own republic forbids it. Said
      // aloud now; if he still holds to it on the day, the question is not put
      // to the vote at all (`holdVotes`).
      if (delta.supporterKind === "character" && delta.position === "oppose" && !saidBefore) {
        const procedure = world.material.politicalProcedures.find((candidate) => candidate.id === procedureId)!;
        const procedurePolity = world.material.institutions.find((institution) => institution.id === procedure.institutionId)?.polityId
          ?? world.characters.find((character) => character.id === procedure.sponsorCharacterId)?.polityId;
        const vetoing = allOffices(world, context.offices).find((office) => office.vetoes === true && office.polityId === procedurePolity
          && world.material.officeSeats.some((seat) => seat.officeId === office.id && seat.holderCharacterId === supporterId && seat.status === "held"));
        if (vetoing !== undefined) {
          const who = world.characters.find((character) => character.id === supporterId)?.name ?? supporterId;
          emitFact({
            localId: `veto_${procedureId}_${supporterId}`.slice(0, 60),
            kind: "veto",
            summary: `${who}, as ${vetoing.label}, forbade "${procedure.label}". Unless he relents, it cannot be put to the vote.`,
            affectedRefs: [{ kind: "character", id: supporterId }, { kind: "procedure", id: procedureId }, ...(procedurePolity === undefined || procedurePolity === null ? [] : [{ kind: "polity" as const, id: procedurePolity }])],
            visibility: "public",
            discoveryState: "public",
            knowableInDays: 0,
            significance: 55,
          });
        }
      }
      // A speech, where he made one: the debate as it went, day by day before
      // the vote, and not only a name in the tally afterwards. Dentatus took a
      // side four times in a campaign and not one word of it was recorded.
      if (delta.supporterKind === "character" && delta.words != null && !saidBefore) {
        const procedure = world.material.politicalProcedures.find((candidate) => candidate.id === procedureId)!;
        const house = world.material.institutions.find((institution) => institution.id === procedure.institutionId);
        const who = world.characters.find((character) => character.id === supporterId)?.name ?? supporterId;
        const side = delta.position === "support" ? "for" : delta.position === "oppose" ? "against" : "on";
        emitFact({
          localId: `speech_${procedureId}_${supporterId}_${atStep}`.slice(0, 60),
          kind: before === undefined ? "senate_speech" : "political_position_changed",
          summary: `${who} spoke ${side} "${procedure.label}"${house === undefined ? "" : ` in the ${house.name}`}: "${delta.words}"`.slice(0, 600),
          affectedRefs: [{ kind: "procedure", id: procedureId }, { kind: "character", id: supporterId }, ...(house === undefined ? [] : [{ kind: "polity" as const, id: house.polityId }])],
          visibility: "public",
          discoveryState: "public",
          knowableInDays: 0,
          significance: 35,
        });
      }
      // Speaking in the house makes a speaker: a point of rhetoric for each speech.
      const spoke = delta.supporterKind === "character" && delta.words != null && !saidBefore;
      if (saidBefore) return { ...world, characters: world.characters };
      return {
        ...world,
        characters: spoke ? world.characters.map((character) => (character.id === supporterId ? practise(character, "rhetoric", 1) : character)) : world.characters,
        material: { ...world.material, supportPositions: [...world.material.supportPositions, position] },
      };
    }

    case "political_procedure_resolve": {
      const procedureId = required(delta.procedureRef, "The question");
      const procedure = world.material.politicalProcedures.find((candidate) => candidate.id === procedureId);
      if (procedure === undefined) reject(`No question "${procedureId}" exists to settle.`, "reference");
      if (procedure.stage === "resolved" || procedure.stage === "withdrawn" || procedure.stage === "blocked") {
        reject(`The question "${procedureId}" has already been settled (${procedure.outcome ?? procedure.stage}).`);
      }
      // An election is decided by the count on its day (`holdElections`), not
      // by whoever writes the outcome. Resolving it here seated nobody -- this
      // handler only seats the subject of an appointment -- so the seat stayed
      // empty and the engine called the same election again.
      if (procedure.subjectKind === "office_seat" && procedure.resolutionMechanism === "vote" && (delta.outcome === "passed" || delta.outcome === "failed")) {
        reject(`"${procedure.label}" is decided when the ${world.material.institutions.find((institution) => institution.id === procedure.institutionId)?.name ?? "assembly"} votes on its day; stand a man for it, or back or oppose one, instead.`);
      }
      // Nor is any other question a chamber counts (`senate.ts`). It can be
      // withdrawn or blocked; carried or rejected is the house's to say.
      if (isBindingChamberQuestion(world, procedure) && (delta.outcome === "passed" || delta.outcome === "failed")) {
        reject(`"${procedure.label}" is decided when the ${world.material.institutions.find((institution) => institution.id === procedure.institutionId)?.name ?? "assembly"} votes on it, in ${Math.max(0, voteDayOf(procedure) - atStep)} days; speak for it or against it, or win men over, instead.`);
      }
      // A tribune's veto, said aloud as he closes it (`tribunes.ts`).
      const vetoed = delta.outcome === "blocked" && context.actorRef.kind === "character" ? vetoFact(world, procedure, context.actorRef.id, context.offices) : null;
      if (vetoed !== null) emitFact(vetoed);
      // Stage and outcome move together: the schema refuses a resolved
      // procedure with no outcome, and an unresolved one that has one.
      const stage = delta.outcome === "withdrawn" ? "withdrawn" as const : delta.outcome === "blocked" ? "blocked" as const : "resolved" as const;
      const settled = {
        ...procedure,
        stage,
        outcome: delta.outcome,
        outcomeReason: delta.outcomeReason,
        resolvedAtStep: atStep,
      };
      const settledWorld: WorldState = {
        ...world,
        material: {
          ...world.material,
          politicalProcedures: world.material.politicalProcedures.map((candidate) => (candidate.id === procedureId ? settled : candidate)),
        },
      };
      // Carried, it does what it said it would -- and a ruler who carries it
      // against his council's advice pays for doing so.
      let resolved = settledWorld;
      if (delta.outcome === "passed") {
        const overruled = overruleCost(settledWorld, settled, context.offices, context.successionRules ?? [], atStep);
        if (overruled.fact !== null) emitFact(overruled.fact);
        const enacted = carryOutEnactment(overruled.world, procedureId, atStep, context.ids, context.offices, context.successionRules ?? []);
        for (const fact of enacted.facts) emitFact(fact);
        resolved = enacted.world;
      }
      // A question about who holds an office has to move the office.
      return delta.outcome === "passed" ? seatByOutcome(resolved, procedure, atStep, context.offices) : resolved;
    }

    case "holding_create": {
      const holderId = required(delta.holderCharacterRef, "The holder");
      const holder = world.characters.find((character) => character.id === holderId);
      if (holder === undefined) reject(`No character "${holderId}" exists to hold this land.${nearestTo(holderId)}`, "reference");
      if (!holder.alive) reject(`${holder.name} is dead and can hold no land.`);
      const terms = estateTerms(world, delta.provinceId, delta.band);
      if (terms === null) reject(`No province "${delta.provinceId}" exists for this land to lie in.`, "reference");
      const purse = holder.personalAccountId === null ? undefined : world.material.accounts.find((account) => account.id === holder.personalAccountId);
      if (purse === undefined) reject(`${holder.name} has no purse of his own for the land's yield to be paid into.`);

      const holdingId = mint("holding", delta.localId);
      const incomeId = mint("income", undefined);
      // Bought outright, or on credit against the land itself.
      const bought = delta.priceFromAccountRef === null
        ? world
        : payOrBorrow(world, required(delta.priceFromAccountRef, "The account paying for it"), terms.price, delta.title, holdingId, context, emitFact);
      const inheritance = world.material.holdings[0]?.successionRuleId ?? "household";
      return {
        ...bought,
        material: {
          ...bought.material,
          incomeSources: [...bought.material.incomeSources, {
            id: incomeId,
            kind: "land",
            label: `Yield of ${delta.title}`,
            beneficiaryAccountId: purse.id,
            originKind: "holding",
            originId: holdingId,
            amount: terms.monthlyYield,
            cadenceSteps: 30,
            nextDueStep: atStep + 30,
            collectionRateBps: 10_000,
            counterpartyPolityId: null,
            active: true,
          }],
          holdings: [...bought.material.holdings, {
            id: holdingId,
            title: delta.title,
            territoryId: delta.provinceId,
            legalHolderCharacterId: holderId,
            incomeSourceId: incomeId,
            successionRuleId: inheritance,
            physicalControlBps: 10_000,
          }],
        },
      };
    }

    case "holding_improve": {
      const holdingId = required(delta.holdingRef, "The holding");
      const holding = world.material.holdings.find((candidate) => candidate.id === holdingId);
      if (holding === undefined) reject(`No holding "${holdingId}" exists to improve.`, "reference");
      const income = world.material.incomeSources.find((source) => source.id === holding.incomeSourceId);
      if (income === undefined) reject(`${holding.title} has no yield to improve.`, "reference");
      const monthly = Math.round(income.amount * (30 / Math.max(1, income.cadenceSteps)));
      const terms = improvementTerms(world, holding.territoryId, monthly, delta.band);
      if (terms === null) reject(`${holding.title} lies in no province the map knows.`, "reference");
      if (terms.added === 0) reject(`${holding.title} yields all its land can give; no more can be got out of it.`);
      const payerId = required(delta.paidFromAccountRef, "The account paying for the works");
      const payer = world.material.accounts.find((account) => account.id === payerId);
      if (payer === undefined) reject(`No account "${payerId}" exists to pay for the works.`, "reference");
      const addedPerCadence = Math.max(1, Math.round(terms.added * (Math.max(1, income.cadenceSteps) / 30)));
      const paid = payOrBorrow(world, payerId, terms.cost, `the works on ${holding.title}`, holding.id, context, emitFact);
      return {
        ...paid,
        material: {
          ...paid.material,
          incomeSources: paid.material.incomeSources.map((source) => (source.id === income.id ? { ...source, amount: source.amount + addedPerCadence } : source)),
        },
      };
    }

    case "force_membership_set": {
      const characterId = required(delta.characterRef, "The man");
      const person = world.characters.find((character) => character.id === characterId);
      if (person === undefined) reject(`No character "${characterId}" exists to ${delta.change}.${nearestTo(characterId)}`, "reference");
      if (!person.alive) reject(`${person.name} is dead.`);
      const forceId = required(delta.forceRef, "The army");
      const force = world.material.forces.find((candidate) => candidate.id === forceId);
      if (force === undefined) reject(`No force "${forceId}" exists.`, "reference");

      // How a man means to bear himself in the next battle: his own to say,
      // and read by the battle (`memberRates`) and by what it gives him after
      // (`recordTheFight`). A man not in the ranks has no next battle to bear.
      if (delta.change === "conduct") {
        if (!force.memberCharacterIds.includes(characterId)) reject(`${person.name} is not in the ranks of ${force.name}.`);
        if (delta.conduct === undefined) reject("Say how he means to bear himself: steady, glory or cautious.");
        if (person.service === undefined) return world;
        return { ...world, characters: world.characters.map((character) => (character.id === characterId && character.service !== undefined ? { ...character, service: { ...character.service, conduct: delta.conduct! } } : character)) };
      }

      if (delta.change === "enlist") {
        if (force.commanderCharacterId === characterId) reject(`${person.name} already commands ${force.name}.`);
        if (force.memberCharacterIds.includes(characterId)) return world;
        if (force.memberCharacterIds.length >= 40) reject(`${force.name} carries as many named men as it can.`);
        // One army at a time: a man who takes service in one has left the other.
        return {
          ...world,
          characters: world.characters.map((character) => (character.id === characterId ? { ...character, locationProvinceId: force.locationId } : character)),
          material: {
            ...world.material,
            forces: world.material.forces.map((candidate) => {
              if (candidate.id === forceId) return { ...candidate, memberCharacterIds: [...candidate.memberCharacterIds, characterId] };
              return candidate.memberCharacterIds.includes(characterId)
                ? { ...candidate, memberCharacterIds: candidate.memberCharacterIds.filter((id) => id !== characterId) }
                : candidate;
            }),
          },
        };
      }

      if (!force.memberCharacterIds.includes(characterId)) reject(`${person.name} is not in the ranks of ${force.name}.`);
      // Out of the ranks is out of the service record too, and out of any post
      // he held in it: a legionary discharged by order was struck from the
      // roll and went on "serving" in his own record, in his unit, at his rank
      // -- which is all the slice and his sheet read (E5). The discharge the
      // seasons owe a veteran has always done both (`ranks.ts`).
      const left: WorldState = {
        ...world,
        characters: world.characters.map((character) => (character.id === characterId && character.service !== undefined && character.service.forceId === forceId
          ? { ...character, service: { ...character.service, forceId: null, formationId: null, unitIndex: null, ...(delta.change === "discharge" ? { dischargedAtStep: atStep, dischargeClaim: character.service.dischargeClaim ?? "none" } : {}) } }
          : character)),
        material: {
          ...world.material,
          forces: world.material.forces.map((candidate) => (candidate.id === forceId
            ? { ...candidate, memberCharacterIds: candidate.memberCharacterIds.filter((id) => id !== characterId), posts: (candidate.posts ?? []).filter((post) => post.characterId !== characterId) }
            : candidate)),
        },
      };
      if (delta.change === "discharge") return left;

      // A deserter is a marked man: his own side knows what he did, and his
      // commander is the one it concerns -- the force is named in the fact, so
      // the attention router brings its commander to it.
      emitFact({
        localId: `deserted_${characterId}_${forceId}`.slice(0, 80),
        kind: "desertion",
        summary: `${person.name} deserted from the ranks of ${force.name}.`,
        // With the army's power named, or nobody at all could know of it.
        affectedRefs: [{ kind: "character", id: characterId }, { kind: "force", id: forceId }, { kind: "polity", id: force.polityId }],
        visibility: "polity",
        discoveryState: "polity",
        knowableInDays: 0,
        significance: 45,
      });
      return {
        ...left,
        characters: left.characters.map((character) => (character.id === characterId && !character.disqualifyingStatuses.includes("deserter")
          ? { ...character, disqualifyingStatuses: [...character.disqualifyingStatuses, "deserter"].slice(0, 8) }
          : character)),
      };
    }

    // Who may give the post was judged before this (`whoseToGive`); here the
    // man is put in it, in his own formation and unit unless another is named.
    case "force_post_set": {
      const forceId = required(delta.forceRef, "The army");
      const force = world.material.forces.find((candidate) => candidate.id === forceId);
      if (force === undefined) reject(`No force "${forceId}" exists.`, "reference");
      const characterId = required(delta.characterRef, "The man");
      const person = world.characters.find((character) => character.id === characterId);
      if (person === undefined) reject(`No character "${characterId}" exists to take a post.${nearestTo(characterId)}`, "reference");
      if (!person.alive) reject(`${person.name} is dead.`);
      const establishment = world.establishments.find((candidate) => candidate.polityId === force.polityId);
      const own = person.service?.forceId === force.id ? person.service : undefined;
      const formationId = delta.formationRef === undefined ? own?.formationId ?? null : required(delta.formationRef, "The formation");
      const formation = formationId === null ? (force.formations ?? [])[0] : formationOf(force, formationId);
      if (establishment === undefined || formation === undefined) reject(`${force.name} has no formations to hold posts in.`, "reference");
      const rank = ranksIn(establishment, formation.templateId).find((candidate) => candidate.id === delta.rankId);
      if (rank === undefined) {
        reject(`No rank "${delta.rankId}" in ${formation.bodyLabel}: ${ranksIn(establishment, formation.templateId).map((candidate) => candidate.id).join(", ")}.`, "reference");
      }
      if (rank.level === "ranks") reject(`${rank.label} is no post: a man is put back in the ranks by giving his post to another.`);
      if (rank.officeIds !== undefined) reject(`${rank.label} is held by whoever holds the office, not given in the army.`);
      const overUnit = rank.level === "unit" || rank.level === "sub";
      const unitIndex = !overUnit ? null : delta.unitIndex !== undefined ? Math.trunc(delta.unitIndex) : own?.formationId === formation.id ? own.unitIndex : null;
      if (overUnit && (unitIndex === null || unitIndex < 0 || unitIndex > 500)) reject(`Say which ${formation.bodyLabel} unit ${person.name} is to be ${rank.label} of.`);
      emitFact({
        localId: `posted_${characterId}_${rank.id}`.slice(0, 60),
        kind: "soldier_promoted",
        summary: `${person.name} is made ${rank.label} in ${force.name}.`,
        affectedRefs: [{ kind: "character", id: characterId }, { kind: "force", id: force.id }],
        visibility: "polity",
        discoveryState: "polity",
        knowableInDays: 0,
        significance: 45,
      });
      return putInPost(world, force.id, { formationId: formation.id, unitIndex, rankId: rank.id, characterId }, atStep);
    }

    case "trade_venture_open": {
      const ownerId = required(delta.ownerCharacterRef, "The owner");
      const owner = world.characters.find((character) => character.id === ownerId);
      if (owner === undefined) reject(`No character "${ownerId}" exists to own this venture.${nearestTo(ownerId)}`, "reference");
      if (!owner.alive) reject(`${owner.name} is dead.`);
      // One province named twice is trade in one market -- a stall in Rome's
      // streets, a shop in Syracuse -- and is as much a venture as a cargo
      // shipped between two.
      const from = world.map.provinces.find((province) => province.id === delta.fromProvinceId);
      const to = world.map.provinces.find((province) => province.id === delta.toProvinceId);
      if (from === undefined) reject(`No province "${delta.fromProvinceId}" exists to trade from.`, "reference");
      if (to === undefined) reject(`No province "${delta.toProvinceId}" exists to trade to.`, "reference");
      // Somewhere to buy and somewhere to sell: a province with no town has no market.
      if (from.settlements.length === 0 || to.settlements.length === 0) reject(`${from.settlements.length === 0 ? from.name : to.name} has no town to trade in.`);
      const purse = owner.personalAccountId === null ? undefined : world.material.accounts.find((account) => account.id === owner.personalAccountId);
      if (purse === undefined) reject(`${owner.name} has no purse of his own for the venture's return to be paid into.`);
      const terms = ventureTerms(world, from.id, to.id, delta.band);
      if (terms === null) reject("The venture's two places could not be found.", "reference");
      const payerId = required(delta.paidFromAccountRef, "The account paying for it");
      const payer = world.material.accounts.find((account) => account.id === payerId);
      if (payer === undefined) reject(`No account "${payerId}" exists to pay for this venture.`, "reference");

      // The power at the other end, if it is not his own: a war with it stops
      // the trade, through the same counterparty every foreign revenue names.
      const own = owner.polityId;
      const counterpartyPolityId = to.controllerPolityId !== null && to.controllerPolityId !== own
        ? to.controllerPolityId
        : from.controllerPolityId !== null && from.controllerPolityId !== own ? from.controllerPolityId : null;
      const ventureId = mint("venture", delta.localId);
      const incomeId = mint("income", undefined);
      // Goods can be had on credit from the merchants who sell them, against
      // nothing but the man's name.
      const funded = payOrBorrow(world, payerId, terms.price, delta.title, null, context, emitFact);
      return {
        ...funded,
        material: {
          ...funded.material,
          incomeSources: [...funded.material.incomeSources, {
            id: incomeId,
            kind: "trade",
            label: `Return of ${delta.title}`,
            beneficiaryAccountId: purse.id,
            originKind: "venture",
            originId: ventureId,
            amount: terms.monthlyReturn,
            cadenceSteps: 30,
            nextDueStep: atStep + 30,
            collectionRateBps: 10_000,
            counterpartyPolityId,
            active: true,
          }],
          ventures: [...funded.material.ventures, {
            id: ventureId,
            title: delta.title,
            ownerCharacterId: ownerId,
            fromProvinceId: from.id,
            toProvinceId: to.id,
            bySea: hasPort(world, from.id) && hasPort(world, to.id),
            incomeSourceId: incomeId,
            openedAtStep: atStep,
            interruptedBy: null,
            status: "running",
          }],
        },
      };
    }

    case "trade_venture_close": {
      const ventureId = required(delta.ventureRef, "The venture");
      const venture = world.material.ventures.find((candidate) => candidate.id === ventureId);
      if (venture === undefined) reject(`No venture "${ventureId}" exists to wind up.`, "reference");
      if (venture.status === "closed") return world;
      return {
        ...world,
        material: {
          ...world.material,
          incomeSources: world.material.incomeSources.map((source) => (source.id === venture.incomeSourceId ? { ...source, active: false } : source)),
          ventures: world.material.ventures.map((candidate) => (candidate.id === ventureId ? { ...candidate, status: "closed" as const } : candidate)),
        },
      };
    }

    case "holding_transfer": {
      const holdingId = required(delta.holdingRef, "The holding");
      const holding = world.material.holdings.find((candidate) => candidate.id === holdingId);
      if (holding === undefined) reject(`No holding "${holdingId}" exists to change hands.`, "reference");
      const toId = delta.toCharacterRef === null ? null : required(delta.toCharacterRef, "The new holder");
      if (toId !== null && !world.characters.some((character) => character.id === toId)) {
        reject(`No character "${toId}" exists to receive it.${nearestTo(toId)}`, "reference");
      }
      const moved = {
        ...holding,
        ...(toId === null ? {} : { legalHolderCharacterId: toId }),
        physicalControlBps: clampBps(holding.physicalControlBps + (delta.physicalControlBpsDelta ?? 0)),
      };
      return {
        ...world,
        material: { ...world.material, holdings: world.material.holdings.map((candidate) => (candidate.id === holdingId ? moved : candidate)) },
      };
    }

    case "generic_entity_create": {
      if (delta.provinceId != null && !world.map.provinces.some((province) => province.id === delta.provinceId)) {
        reject(`No province "${delta.provinceId}" exists for ${delta.label} to stand in.`, "reference");
      }
      const written = upkeepFrom(world, delta.upkeep, required);
      const priced = priceTheYield(world, null, { provinceId: delta.provinceId ?? null, ownerRef: delta.ownerRef, effects: delta.effects ?? [], upkeep: written }, delta.label, context, emitFact);
      const upkeep = priced.upkeep;
      const id = mint("entity", delta.localId);
      const founder = context.actorRef.kind === "character" ? context.actorRef.id : null;
      const entity = {
        id,
        kind: delta.kind,
        label: delta.label,
        ownerRef: delta.ownerRef,
        attributes: delta.attributes,
        linkedEntityIds: [],
        createdAtStep: atStep,
        provenanceEventIds: [],
        ...(delta.provinceId == null ? {} : { provinceId: delta.provinceId }),
        ...(delta.effects === undefined ? {} : { effects: delta.effects }),
        ...(upkeep === null ? {} : { upkeep }),
      };
      return foundFaithsOf({ ...priced.world, genericEntities: [...priced.world.genericEntities, entity] }, delta.effects ?? [], atStep, founder);
    }

    case "generic_entity_update": {
      const entityId = required(delta.entityRef, "The arrangement");
      const entity = world.genericEntities.find((candidate) => candidate.id === entityId);
      if (entity === undefined) reject(`No arrangement "${entityId}" exists to change.`, "reference");

      // Merge, never replace: an update that named one attribute would
      // otherwise quietly erase everything the arrangement already recorded.
      // A null is the one way to actually take an attribute away.
      const attributes: Record<string, string | number | boolean | null> = { ...entity.attributes };
      for (const [key, value] of Object.entries(delta.attributes)) {
        if (value === null) delete attributes[key];
        else attributes[key] = value;
      }
      if (delta.retire) attributes["retiredAtStep"] = atStep;

      const written = delta.upkeep === undefined ? undefined : upkeepFrom(world, delta.upkeep, required);
      // Only what the update adds is paid for: an arrangement that paid
      // nothing to found, from before founding had a price, keeps what it had.
      const priced = delta.effects === undefined && written === undefined
        ? { world, upkeep: written }
        : priceTheYield(
          world,
          { effects: entity.effects ?? [], upkeep: entity.upkeep ?? null },
          { provinceId: entity.provinceId ?? null, ownerRef: entity.ownerRef, effects: delta.effects ?? entity.effects ?? [], upkeep: written === undefined ? entity.upkeep ?? null : written },
          delta.label ?? entity.label,
          context,
          emitFact,
        );
      const upkeep = priced.upkeep ?? undefined;
      const updated = {
        ...entity,
        ...(delta.label === undefined ? {} : { label: delta.label }),
        attributes,
        ...(delta.effects === undefined ? {} : { effects: delta.effects }),
        ...(upkeep === undefined ? {} : { upkeep }),
      };
      const founder = context.actorRef.kind === "character" ? context.actorRef.id : null;
      return foundFaithsOf(
        { ...priced.world, genericEntities: priced.world.genericEntities.map((candidate) => (candidate.id === entityId ? updated : candidate)) },
        delta.effects ?? [],
        atStep,
        founder,
      );
    }

    case "loan_open": {
      const borrowerId = required(delta.borrowerAccountRef, "The borrowing account");
      const borrower = world.material.accounts.find((account) => account.id === borrowerId);
      if (borrower === undefined) reject(`No account "${borrowerId}" exists to receive the money.`, "reference");

      const lenderId = delta.lenderRef === null ? null : required(delta.lenderRef, "The lender");
      if (delta.lenderKind !== "foreign" && lenderId === null) {
        reject("A loan from someone in this world has to say who they are.", "reference");
      }
      const collateralId = delta.collateralHoldingRef === null ? null : required(delta.collateralHoldingRef, "The collateral");
      if (collateralId !== null && !world.material.holdings.some((holding) => holding.id === collateralId)) {
        reject(`No holding "${collateralId}" exists to pledge against it.`, "reference");
      }

      // Money from inside the world comes out of someone's own reserves, and
      // they have to actually have it. Money from outside does not: that is the
      // whole difference between a merchant of ours and a foreign banker.
      let lendingAccountId: string | null = null;
      let principal = delta.principal;
      if (delta.lenderKind !== "foreign") {
        const lenderAccount = world.material.accounts.find(
          (account) => account.owner.kind === delta.lenderKind && account.owner.id === lenderId,
        );
        // Nobody borrows from themselves. `obligation_upsert` has refused an
        // account paying itself since it bricked a three-year campaign, and
        // this door was left open beside it: a loan from Rome to Rome moved
        // the principal out of the treasury and straight back into it, and
        // left behind a debt-service obligation whose payer and recipient were
        // the same account -- the exact object that guard exists to prevent.
        if (lenderAccount !== undefined && lenderAccount.id === borrowerId) {
          reject(
            `${lenderId} cannot lend to its own account; a power funding something out of its own treasury spends from it, and does not borrow from itself.`,
            "reference",
          );
        }
        // Named, not identified: this reaches the player as friction, and
        // "character-0a73c811 holds 0" tells a ruler nothing about anybody.
        const lenderName = world.characters.find((character) => character.id === lenderId)?.name ?? lenderId ?? "The lender";
        if (lenderAccount === undefined) reject(`${lenderName} keeps no account to lend from.`, "reference");
        // A lender who has less than was asked lends what he has; one who has
        // nothing lends nothing.
        if (lenderAccount.balance <= 0) reject(`${lenderName} has nothing to lend.`);
        principal = Math.min(principal, lenderAccount.balance);
        lendingAccountId = lenderAccount.id;
      }

      const loanId = mint("loan", delta.localId);
      // Servicing goes through an ordinary obligation, so arrears, priority and
      // missed periods all behave as they do for army pay -- a debt crisis is
      // already modelled by whatever models an unpaid army.
      const serviceObligationId = context.ids.next("obligation");
      // Paid back in instalments over its term: interest and a share of the principal (`debts.ts`).
      const servicing = loanInstalment(principal, delta.interestBps, LOAN_TERM_PERIODS);
      const obligation = {
        id: serviceObligationId,
        kind: "debt_service" as const,
        label: `Repayment of ${delta.terms}`.slice(0, 120),
        payerAccountId: borrowerId,
        ...(delta.lenderKind === "foreign" ? {} : { recipientAccountId: world.material.accounts.find((account) => account.owner.kind === delta.lenderKind && account.owner.id === lenderId)?.id }),
        amount: servicing,
        cadenceSteps: delta.cadenceDays,
        nextDueStep: atStep + delta.cadenceDays,
        // Below army pay: a state short of money starves its creditors before
        // it starves its soldiers, and that choice is what causes the crisis.
        priority: 400,
        arrears: 0,
        missedPeriods: 0,
        active: true,
        remainingPeriods: LOAN_TERM_PERIODS,
      };

      const loan = {
        id: loanId,
        lenderKind: delta.lenderKind,
        lenderId,
        borrowerAccountId: borrowerId,
        principal,
        outstanding: principal,
        interestBps: delta.interestBps,
        cadenceSteps: delta.cadenceDays,
        serviceObligationId,
        terms: delta.terms,
        collateralHoldingId: collateralId,
        status: "active" as const,
        openedAtStep: atStep,
      };

      const lent = moveMoney(world, { from: lendingAccountId, to: borrowerId, amount: principal, kind: "transfer", causeId: loanId, explanation: `Lent: ${delta.terms}` }, context);
      return {
        ...lent,
        material: {
          ...lent.material,
          obligations: [...lent.material.obligations, obligation],
          loans: [...lent.material.loans, loan],
        },
      };
    }

    case "loan_settle": {
      const loanId = required(delta.loanRef, "The loan");
      const loan = world.material.loans.find((candidate) => candidate.id === loanId);
      if (loan === undefined) reject(`No loan "${loanId}" exists to settle.`, "reference");
      if (loan.status !== "active") reject(`The loan "${loanId}" is already ${loan.status}.`);

      if (delta.action === "renegotiate") {
        const renegotiated = {
          ...loan,
          interestBps: delta.newInterestBps ?? loan.interestBps,
          cadenceSteps: delta.newCadenceDays ?? loan.cadenceSteps,
          terms: delta.reason.slice(0, 300),
        };
        const remaining = world.material.obligations.find((obligation) => obligation.id === loan.serviceObligationId)?.remainingPeriods ?? LOAN_TERM_PERIODS;
        const servicing = loanInstalment(renegotiated.outstanding, renegotiated.interestBps, remaining);
        return {
          ...world,
          material: {
            ...world.material,
            loans: world.material.loans.map((candidate) => (candidate.id === loanId ? renegotiated : candidate)),
            obligations: world.material.obligations.map((obligation) =>
              obligation.id === loan.serviceObligationId
                ? { ...obligation, amount: servicing, cadenceSteps: renegotiated.cadenceSteps, remainingPeriods: remaining }
                : obligation,
            ),
          },
        };
      }

      if (delta.action === "default") {
        // The debt stops being serviced and stops being paid. What that costs
        // politically is for the creditor to decide, and they are a person.
        return {
          ...world,
          material: {
            ...world.material,
            loans: world.material.loans.map((candidate) => (candidate.id === loanId ? { ...candidate, status: "defaulted" as const } : candidate)),
            obligations: world.material.obligations.map((obligation) =>
              obligation.id === loan.serviceObligationId ? { ...obligation, active: false } : obligation,
            ),
          },
        };
      }

      if (delta.amount <= 0) reject("A repayment has to pay something.", "reference");
      const borrower = world.material.accounts.find((account) => account.id === loan.borrowerAccountId);
      if (borrower === undefined) reject(`No account "${loan.borrowerAccountId}" exists to repay from.`, "reference");
      // As much as there is: a debtor pays down what he can.
      if (borrower.balance <= 0) reject(`The account is empty and can repay nothing.`);
      const paying = Math.min(delta.amount, loan.outstanding, borrower.balance);

      const lenderAccount = loan.lenderKind === "foreign" || loan.lenderId === null
        ? undefined
        : world.material.accounts.find((account) => account.owner.kind === loan.lenderKind && account.owner.id === loan.lenderId);
      const repaid = moveMoney(world, { from: borrower.id, to: lenderAccount?.id ?? null, amount: paying, kind: "transfer", causeId: loanId, explanation: `Repaid on ${loan.terms}` }, context);

      const outstanding = loan.outstanding - paying;
      const settled = { ...loan, outstanding, status: outstanding === 0 ? ("repaid" as const) : loan.status };
      const remaining = world.material.obligations.find((obligation) => obligation.id === loan.serviceObligationId)?.remainingPeriods ?? LOAN_TERM_PERIODS;
      const servicing = loanInstalment(outstanding, loan.interestBps, remaining);
      return {
        ...repaid,
        material: {
          ...repaid.material,
          loans: repaid.material.loans.map((candidate) => (candidate.id === loanId ? settled : candidate)),
          obligations: repaid.material.obligations.map((obligation) =>
            obligation.id === loan.serviceObligationId
              ? { ...obligation, amount: servicing, active: outstanding > 0 }
              : obligation,
          ),
        },
      };
    }

    case "storyline_open": {
      // A country, a faction or a province named as a participant is the model
      // saying what the matter is about, not naming a person. Dropped rather
      // than refused: refusing threw away a whole plague because "rome" was
      // listed among the sick, and a cult because its movement was. A name
      // that is nothing in the world at all is still a malformed payload.
      const isThing = (id: string): boolean =>
        world.map.polities.some((polity) => polity.id === id)
        || world.map.provinces.some((province) => province.id === id)
        || world.genericEntities.some((entity) => entity.id === id)
        || world.material.forces.some((force) => force.id === id)
        || world.material.institutions.some((institution) => institution.id === id);
      const participantIds = delta.participantRefs
        .map((ref) => required(ref, "A storyline participant"))
        .filter((participantId) => !isThing(participantId));
      for (const participantId of participantIds) {
        if (!world.characters.some((character) => character.id === participantId)) reject(`No character "${participantId}" exists to take part in this.${nearestTo(participantId)}`, "reference");
      }
      if (delta.provinceId !== null && !world.map.provinces.some((province) => province.id === delta.provinceId)) {
        reject(`No province "${delta.provinceId}" exists for this to happen in.`, "reference");
      }
      // Bounded, or a world that opens a thread for every incident drowns the
      // slice in them. The cap is generous; the narrator stops seeding well
      // before it and the prompt asks for threads to be closed. The order's own
      // thread is never refused (E24): a seed taken up is the world's, though.
      const ordersOwn = context.actsForTheWorld !== true || (context.forTheOrder === true && delta.seedKey === null);
      if (!ordersOwn && worldThreadsFull(world)) {
        reject(`The world is already following ${WORLD_THREAD_CAP} threads of its own; close one before opening another.`);
      }
      const id = mint("storyline", delta.localId);
      const roomy = ordersOwn ? makeRoomForTheOrder(world, atStep, delta.title) : world;
      return {
        ...roomy,
        storylines: [
          ...roomy.storylines,
          {
            id,
            title: delta.title,
            participantIds: [...new Set(participantIds)],
            provinceId: delta.provinceId,
            phase: delta.phase,
            stakes: delta.stakes,
            history: [],
            nextDevelopment: delta.nextDevelopment,
            visibility: delta.visibility,
            origin: ordersOwn ? ("character" as const) : ("world" as const),
            openedByRef: context.actorRef,
            openedAtStep: atStep,
            updatedAtStep: atStep,
            closedAtStep: null,
            causalFactIds: [],
            seedKey: delta.seedKey,
          },
        ],
      };
    }

    case "storyline_advance": {
      const storylineId = required(delta.storylineRef, "The storyline");
      const storyline = world.storylines.find((candidate) => candidate.id === storylineId);
      if (storyline === undefined) reject(`No storyline "${storylineId}" exists to advance.`, "reference");
      if (storyline.phase === "closed") reject(`"${storyline.title}" is over; a closed thread is not advanced.`);
      const added = delta.addParticipantRefs.map((ref) => required(ref, "A new participant"));
      for (const participantId of added) {
        if (!world.characters.some((character) => character.id === participantId)) reject(`No character "${participantId}" exists to join this.${nearestTo(participantId)}`, "reference");
      }
      const phase = delta.phase ?? storyline.phase;
      return {
        ...world,
        storylines: world.storylines.map((candidate) =>
          candidate.id !== storylineId
            ? candidate
            : {
              ...candidate,
              phase,
              history: [...candidate.history, delta.development].slice(-24),
              nextDevelopment: delta.nextDevelopment ?? candidate.nextDevelopment,
              stakes: delta.stakes ?? candidate.stakes,
              participantIds: [...new Set([...candidate.participantIds, ...added])].slice(0, 16),
              updatedAtStep: atStep,
              closedAtStep: phase === "closed" ? atStep : candidate.closedAtStep,
            },
        ),
      };
    }

    case "character_state_set": {
      const characterId = required(delta.characterRef, "Whose health this is");
      const person = world.characters.find((character) => character.id === characterId);
      if (person === undefined) reject(`No character "${characterId}" exists to fall ill.${nearestTo(characterId)}`, "reference");
      const heirId = delta.heirRef === null ? null : required(delta.heirRef, "The named heir");
      if (heirId !== null && !world.characters.some((character) => character.id === heirId && character.alive)) {
        reject(`No living character "${heirId}" exists to inherit.`, "reference");
      }
      // A status that claims a death the engine did not carry out.
      //
      // `addStatuses` takes any word at all, so "kill Fabius" was written as
      // health to nothing and a tag reading `dead` -- and it worked, in the
      // sense that nothing refused it. What it produced was a man at no
      // health, marked dead, alive, and still commanding his army: the record
      // said one thing and the world another. Death has one door and this is
      // not it; an order to have somebody killed is `covert_plot_open`, which
      // decides whether it actually happened.
      // Getting better. Rest does a little, and a physician does what his
      // learning lets him: the model says he treats the man, the engine rolls
      // how it goes. A cure used to be whatever number was written.
      let healthDeltaBps = delta.healthDeltaBps;
      if (healthDeltaBps > 0) {
        const physicianId = delta.physicianRef == null ? null : required(delta.physicianRef, "The physician");
        const physician = physicianId === null ? undefined : world.characters.find((character) => character.id === physicianId && character.alive);
        if (physicianId !== null && physician === undefined) reject(`No living physician "${physicianId}" exists.${nearestTo(physicianId)}`, "reference");
        if (physician === undefined) {
          healthDeltaBps = Math.min(healthDeltaBps, REST_RECOVERY_BPS);
        } else {
          const skill = physician.skills.learning;
          const cured = stableHash([physician.id, characterId, atStep, "treatment"]) % 100 < Math.min(90, 25 + Math.round(skill * 0.6));
          healthDeltaBps = cured ? 1_500 + skill * 30 : 0;
          emitFact({
            localId: `treated_${characterId}`.slice(0, 60),
            kind: "treatment",
            summary: cured
              ? `${physician.name} treated ${person.name}, and he mended.`
              : `${physician.name} treated ${person.name}, and it did no good.`,
            affectedRefs: [{ kind: "character", id: characterId }, { kind: "character", id: physician.id }],
            visibility: "polity",
            discoveryState: "polity",
            knowableInDays: 0,
            significance: 15,
          });
        }
      }
      const claimsDeath = delta.addStatuses.filter((status) => DEATH_CLAIMING_STATUSES.has(status.trim().toLowerCase()));
      if (claimsDeath.length > 0) {
        reject(
          `"${claimsDeath[0]}" is not a state a person can be put into: this cannot end a life. A death somebody brings about is "character_death"; a secret one is a plot.`,
        );
      }

      // A journey to somewhere this map does not reach -- Egypt, from a map
      // of the western Mediterranean -- is the world answering, not a bad
      // reference: the traveller sets out and the record cannot follow him.
      if (delta.moveToProvinceId != null && !world.map.provinces.some((province) => province.id === delta.moveToProvinceId)) {
        const place = delta.moveToProvinceId.replace(/^punic-/, "").split(/[-_]+/).filter((word) => !/\d/.test(word)).map((word) => word[0]!.toUpperCase() + word.slice(1)).join(" ");
        reject(`${person.name} set out for ${place || "a far country"}, which lies beyond the lands this world maps; nothing of the journey can be followed there.`);
      }

      // A conversion, or a faith founded by the man who now holds it.
      const believes = delta.faith === undefined ? null : faithNamed(world, delta.faith, atStep, characterId);
      if (believes !== null) world = believes.world;

      const lifted = new Set(delta.removeStatuses);
      const statuses = [
        ...person.disqualifyingStatuses.filter((status) => !lifted.has(status)),
        ...delta.addStatuses.filter((status) => !person.disqualifyingStatuses.includes(status)),
      ];

      // Going over to another power. What he held in the old one he lays
      // down: its offices, and command of its armies -- unless this same
      // answer has already taken the army over with him.
      const newPolityId = delta.polityId === undefined ? undefined : required(delta.polityId, "The power they now belong to");
      if (newPolityId !== undefined && !world.map.polities.some((polity) => polity.id === newPolityId)) {
        reject(`No power "${newPolityId}" exists for ${person.name} to go over to.`, "reference");
      }
      let changed = world;
      if (newPolityId !== undefined && newPolityId !== person.polityId) {
        changed = handOverForcesOf(vacateOfficesOf(changed, characterId, "resignation", atStep), characterId, newPolityId);
      }

      // What he got better or worse at, one step at a time. A step is years
      // of a life, and nobody is made the best general in the world by one:
      // the ceiling sits above the bands the world may invent people at and
      // below the best the scenario authored.
      const skills = { ...person.skills };
      for (const shift of delta.skillShifts ?? []) {
        const now = skills[shift.skill];
        skills[shift.skill] = shift.direction === "better"
          ? Math.max(now, Math.min(SKILL_CEILING, now + SKILL_STEP))
          : Math.max(0, now - SKILL_STEP);
      }

      // What he wants. Taken up anew, or an ambition he already holds seen
      // through or given up -- matched by what it is called, since the world
      // names it the way he would.
      let ambitions = person.ambitions;
      for (const change of delta.ambitions ?? []) {
        if (change.change === "take_up") {
          if (ambitions.some((ambition) => ambition.status === "active" && ambition.label.toLowerCase() === change.label.toLowerCase())) continue;
          ambitions = [...ambitions, { id: context.ids.next("ambition"), label: change.label, kind: change.kind, targetId: null, status: "active" as const, steps: [] }];
          continue;
        }
        const wanted = change.label.toLowerCase();
        const held = ambitions.find((ambition) => ambition.status === "active"
          && (ambition.label.toLowerCase().includes(wanted) || wanted.includes(ambition.label.toLowerCase())));
        if (held === undefined) continue;
        ambitions = ambitions.map((ambition) => (ambition === held ? { ...ambition, status: change.change === "fulfil" ? "fulfilled" as const : "abandoned" as const } : ambition));
      }

      return {
        ...changed,
        // `alive` is untouched here and has no field to touch it with. A
        // health of zero is a man who cannot get out of bed, not a corpse:
        // a life ends through `killCharacter`, by time or by `character_death`.
        characters: changed.characters.map((character) => (character.id === characterId
          ? {
            ...character,
            healthBps: Math.max(0, Math.min(10_000, character.healthBps + healthDeltaBps)),
            prestigeBps: clampBps(character.prestigeBps + clampStandingShift(delta.standingDeltaBps ?? 0, delta.standingCause)),
            disqualifyingStatuses: statuses.slice(0, 8),
            // An ailment written now passes in its time; written again, its time starts over.
            ailmentsUntil: [
              ...(person.ailmentsUntil ?? []).filter((entry) => statuses.includes(entry.status) && !delta.addStatuses.includes(entry.status)),
              // A hard constitution mends sooner: up to two fifths either way.
              ...delta.addStatuses.filter(isAilment).map((status) => ({ status, untilStep: atStep + Math.max(3, Math.round(AILMENT_DAYS * (1 - skillShare(aptitude(person, "endurance"), 0.4)))) })),
            ],
            skills,
            ambitions: ambitions.slice(-12),
            ...(heirId === null ? {} : { heirCharacterId: heirId }),
            ...(delta.moveToProvinceId == null ? {} : { locationProvinceId: delta.moveToProvinceId }),
            ...(believes === null ? {} : { faithId: believes.faithId }),
            ...(newPolityId === undefined ? {} : { polityId: newPolityId }),
          }
          : character)),
      };
    }

    case "family_tie_set": {
      const personId = required(delta.characterRef, "The person");
      const relatedId = required(delta.relatedCharacterRef, "The person they are kin to");
      const person = world.characters.find((character) => character.id === personId);
      const related = world.characters.find((character) => character.id === relatedId);
      if (person === undefined) reject(`No character "${personId}" exists.${nearestTo(personId)}`, "reference");
      if (related === undefined) reject(`No character "${relatedId}" exists.${nearestTo(relatedId)}`, "reference");
      if (personId === relatedId) reject(`${person.name} cannot be kin to himself.`, "reference");

      // One row per tie, read from either side: "A is child of B" and "B is
      // parent of A" are the same tie, and storing both would count an
      // adopted son twice in every succession.
      const reciprocal = reciprocalFamilyLinkKind(delta.relation);
      const sameTie = (link: WorldState["familyLinks"][number]): boolean => link.endedAtStep === null && (
        (link.characterId === personId && link.relatedCharacterId === relatedId && link.kind === delta.relation)
        || (link.characterId === relatedId && link.relatedCharacterId === personId && link.kind === reciprocal));
      const standing = world.familyLinks.find(sameTie);

      if (delta.change === "end") {
        if (standing === undefined) reject(`${person.name} and ${related.name} have no such tie to end.`);
        return {
          ...world,
          familyLinks: world.familyLinks.map((link) => (link === standing ? { ...link, endedAtStep: atStep } : link)),
        };
      }
      if (!person.alive || !related.alive) reject(`${!person.alive ? person.name : related.name} is dead; no new tie can be made with the dead.`);
      if (standing !== undefined) return world;
      return {
        ...world,
        familyLinks: [...world.familyLinks, {
          id: context.ids.next("family"),
          characterId: personId,
          relatedCharacterId: relatedId,
          kind: delta.relation,
          startedAtStep: atStep,
          endedAtStep: null,
          visibility: "public" as const,
          provenanceEventId: null,
        }],
      };
    }

    case "service_contract_open": {
      // A town named where the man should be: he is found there (`hiring-market.ts`).
      const named = resolve(delta.employeeRef) ?? delta.employeeRef;
      const market = world.characters.some((character) => character.id === named) ? null : hireAtThePlace(world, named, delta.role, atStep, context.ids);
      if (market !== null) return applyOne(market.world, { ...delta, employeeRef: market.characterId }, context, assignedIds, resolve, emitFact, emitAccount);
      const id = mint("contract", delta.localId);
      const employerAccountId = required(delta.employerAccountRef, "The account that pays");
      const employer = world.material.accounts.find((account) => account.id === employerAccountId);
      if (employer === undefined) reject(`No account "${employerAccountId}" exists to pay for this.`, "reference");
      const employeeId = required(delta.employeeRef, "The man hired");
      const employee = world.characters.find((character) => character.id === employeeId && character.alive);
      if (employee === undefined) reject(`No living person "${employeeId}" exists to hire.${nearestTo(employeeId)}`, "reference");
      if (employer.owner.kind === "character" && employer.owner.id === employeeId) reject(`${employee.name} cannot hire himself.`, "reference");
      const farming = delta.role === "tax_farmer";
      if (farming && employer.owner.kind !== "polity") reject("A tax farm is let by a government's treasury, not by a private purse.", "reference");
      // The farmer pays for the farm; everybody else is paid.
      const payerId = farming ? employee.personalAccountId : employerAccountId;
      const payeeId = farming ? employerAccountId : employee.personalAccountId;
      const payer = world.material.accounts.find((account) => account.id === payerId);
      if (payer === undefined || payer.balance < delta.advance) {
        reject(`${delta.advance} cannot be paid up front for "${delta.label}": the account holds ${payer?.balance ?? 0}.`);
      }
      const endsAtStep = delta.termDays === null ? null : atStep + delta.termDays;
      let next: WorldState = moveMoney(world, {
        from: payerId ?? null, to: payeeId ?? null, amount: delta.advance, kind: farming ? "purchase" : "salary",
        causeId: id, explanation: `Paid down: ${delta.label}`,
      }, context);
      const obligationId = delta.monthlyPay > 0 ? context.ids.next("obligation") : null;
      if (obligationId !== null) {
        next = { ...next, material: { ...next.material, obligations: [...next.material.obligations, {
          id: obligationId, kind: "salary" as const, label: `${delta.label}`.slice(0, 120), payerAccountId: payerId, recipientAccountId: payeeId,
          amount: delta.monthlyPay, cadenceSteps: 30, nextDueStep: atStep + 30, priority: 400, arrears: 0, missedPeriods: 0, active: true,
        }] } };
      }

      // What the work needs, for as long as it is paid for.
      let incomeSourceId: string | null = null;
      let grantId: string | null = null;
      let forceId: string | null = null;
      let forceWas: { polityId: string; controllerCharacterId: string } | null = null;
      const counterpartPolityId = delta.counterpartPolityId === null ? null : required(delta.counterpartPolityId, "The power he is sent to");
      if (farming) {
        if (delta.provinceId === null) reject("A tax farm is the tax of a province; name which.", "reference");
        const province = world.map.provinces.find((candidate) => candidate.id === delta.provinceId);
        if (province === undefined || province.controllerPolityId !== employer.owner.id) reject(`${province?.name ?? delta.provinceId} is not a province of the power letting the farm.`, "reference");
        const material = world.material.provinceMaterial.find((row) => row.provinceId === province.id);
        // What the province bears at the customary rate: the farmer's take,
        // counted against the province like the government's own tax.
        const take = material === undefined ? 0 : Math.round(material.taxCapacity * material.stabilityBps / 10_000 * TAX_EXTRACTION_BPS / 10_000 * CUSTOMARY_TAX_BURDEN);
        incomeSourceId = context.ids.next("income");
        next = { ...next, material: { ...next.material, incomeSources: [...next.material.incomeSources, {
          id: incomeSourceId, kind: "tax" as const, label: `The tax farm of ${province.name}`.slice(0, 120), beneficiaryAccountId: employee.personalAccountId,
          originKind: "position" as const, originId: id, amount: take, cadenceSteps: 30, nextDueStep: atStep + 30, collectionRateBps: 10_000,
          counterpartyPolityId: null, active: true,
        }] } };
      }
      if (delta.role === "envoy" && employer.owner.kind === "polity") {
        grantId = context.ids.next("grant");
        next = { ...next, authorityGrants: [...next.authorityGrants, {
          id: grantId, holder: { kind: "character" as const, id: employeeId }, source: "delegation" as const, sourceRef: id,
          domain: "diplomatic" as const, scope: { kind: "polity" as const, id: employer.owner.id }, powers: ["negotiate" as const],
          standing: "delegated" as const, legitimacyBps: 10_000, visibility: "public" as const, grantedAtStep: atStep,
          expiresAtStep: endsAtStep, revokedAtStep: null, revocationReason: null, succeedsGrantId: null,
        }] };
      }
      // The army the work is for, when "forceRef" names the hirer's own and not
      // a company the man brings. A merchant hired to feed Legio I was refused
      // as "Legio I is not Nicias's to hire out": the one reading "forceRef"
      // had was the company hired, and had it passed, the legion would have
      // been handed to its own consul as a hired band.
      let servedForceName: string | null = null;
      if (delta.forceRef !== null) {
        const namedForceId = required(delta.forceRef, "The company hired");
        const force = world.material.forces.find((candidate) => candidate.id === namedForceId);
        if (force === undefined) reject(`No force "${namedForceId}" exists to hire.`, "reference");
        const hirer = employer.owner.kind === "character" ? employer.owner.id : context.actorRef.kind === "character" ? context.actorRef.id : force.controllerCharacterId;
        const hirerPolity = employer.owner.kind === "polity" ? employer.owner.id : world.characters.find((character) => character.id === hirer)?.polityId ?? force.polityId;
        const his = force.commanderCharacterId === employeeId || force.controllerCharacterId === employeeId;
        const theHirers = force.controllerCharacterId === hirer || force.commanderCharacterId === hirer || force.polityId === hirerPolity;
        if (!his && theHirers) {
          servedForceName = force.name;
        } else {
          if (!his) reject(`${force.name} is not ${employee.name}'s to hire out: a company is hired from the man who leads it.`);
          forceId = namedForceId;
          forceWas = { polityId: force.polityId, controllerCharacterId: force.controllerCharacterId };
          next = { ...next, material: { ...next.material, forces: next.material.forces.map((candidate) => (candidate.id === forceId
            ? { ...candidate, controllerCharacterId: hirer, polityId: hirerPolity, payObligationId: obligationId }
            : candidate)) } };
        }
      }
      // A captain hired with no company named brings one. "Find boats enough
      // to carry ten thousand men" hired a Campanian shipmaster and nothing
      // else: the treasury paid him every month, and no hull ever stood in
      // any province, so the legion never crossed.
      let broughtWords = "";
      if (delta.role === "mercenary" && delta.forceRef === null) {
        if (delta.company === null) {
          reject(`${employee.name} is hired as a mercenary with nothing to command: name the "company" he brings (its kind -- "warship" for hulls -- and how many), or the force he leads in "forceRef".`);
        }
        const category = warfareWith(world, context.warfare).troopCategories.find((candidate) => candidate.id === delta.company!.categoryId);
        if (category === undefined) reject(`No kind of troops "${delta.company.categoryId}" exists; the kinds are ${warfareWith(world, context.warfare).troopCategories.map((candidate) => candidate.id).join(", ")}.`, "reference");
        const hirer = employer.owner.kind === "character" ? employer.owner.id : context.actorRef.kind === "character" ? context.actorRef.id : employeeId;
        // A company musters where its captain already was, else beside the
        // man who hired it -- not at the place it is hired to serve. Transport
        // hired to carry Legio I to Messana was raised at Messana, the army
        // marched to meet it at a shore it never reached, and the crossing
        // failed. Ships muster on the nearest shore.
        const madeNow = [...assignedIds.values()].includes(employeeId);
        const hirerAt = world.characters.find((character) => character.id === hirer)?.locationProvinceId ?? null;
        const known = (id: string | null | undefined): id is string => id != null && world.map.provinces.some((province) => province.id === id);
        const musterAt = !madeNow && known(employee.locationProvinceId) ? employee.locationProvinceId : known(hirerAt) ? hirerAt : known(employee.locationProvinceId) ? employee.locationProvinceId : delta.provinceId;
        const naval = warfareWith(world, context.warfare).troopCategories.find((candidate) => candidate.id === delta.company!.categoryId)?.naval === true;
        const locationId = naval && known(musterAt) ? nearestShore(world, musterAt) : musterAt;
        if (!known(locationId)) reject(`No province "${locationId}" exists for ${employee.name}'s company to muster in.`, "reference");
        const hirerPolity = employer.owner.kind === "polity" ? employer.owner.id : world.characters.find((character) => character.id === hirer)?.polityId ?? employee.polityId;
        if (hirerPolity === null) reject(`Nobody who hired ${employee.name} belongs to a power his company could serve; a band answering to no power is raised with "force_create" as "outlaw".`);
        forceId = context.ids.next("force");
        // Whose they are once the contract ends: his own, under the power he came from.
        forceWas = { polityId: employee.polityId ?? hirerPolity, controllerCharacterId: employeeId };
        // What the money buys: a company is paid for at least the going rate
        // for its men or hulls over its term (`hireFloorPerMonth`). 400
        // warships were once hired for 900 down and nothing a month -- a
        // third of what the Republic paid to victual 18 -- so the captain
        // brings what the pay will keep.
        const months = Math.max(1, Math.round((delta.termDays ?? 90) / 30));
        const paid = delta.advance + delta.monthlyPay * months;
        const perHead = hireFloorPerMonth(category) * months;
        const affordable = Math.floor(paid / perHead);
        if (affordable < 1) reject(`${delta.advance} down and ${delta.monthlyPay} a month will not keep even one of ${category.label.toLowerCase()} for ${months} months: the going rate is about ${Math.ceil(perHead)} each over the term.`);
        const strength = Math.min(delta.company.strength, affordable);
        broughtWords = strength < delta.company.strength
          ? `, bringing ${strength} ${category.label.toLowerCase()} -- all the pay would keep of the ${delta.company.strength} asked for`
          : `, bringing ${strength} ${category.label.toLowerCase()}`;
        next = { ...next, material: { ...next.material,
          forces: [...next.material.forces, {
            id: forceId, name: delta.label.slice(0, 120), polityId: hirerPolity, commanderCharacterId: employeeId, controllerCharacterId: hirer,
            locationId, positionId: null, authorizedStrength: strength,
            personnel: [{ categoryId: category.id, label: category.label, fit: strength, unavailable: [] }],
            moraleBps: 6_000, cohesionBps: 5_000, fatigueBps: 0, provisionStatus: "provisioned" as const, provisionedThroughStep: atStep + 30,
            payObligationId: obligationId, payArrearsPeriods: 0, history: [], memberCharacterIds: [],
          }],
          accounts: [...next.material.accounts, {
            id: context.ids.next("account"), owner: { kind: "force" as const, id: forceId }, currencyId: world.material.currency.id,
            balance: 0, status: "active" as const, visibility: "polity" as const,
          }],
        } };
      }
      next = { ...next, material: { ...next.material, contracts: [...next.material.contracts, {
        id, role: delta.role, label: delta.label, employerAccountId, employeeCharacterId: employeeId, obligationId, incomeSourceId, grantId,
        advance: delta.advance, monthlyPay: delta.monthlyPay, duties: delta.duties, openedAtStep: atStep, endsAtStep,
        forceId, forceWas, provinceId: delta.provinceId, counterpartPolityId,
        journey: (delta.role === "agent" || delta.role === "envoy") && delta.provinceId !== null && employee.locationProvinceId !== delta.provinceId
          ? { fromProvinceId: employee.locationProvinceId, toProvinceId: delta.provinceId, arrivesAtStep: atStep + Math.max(1, newsDaysBetween(world, employee.locationProvinceId, delta.provinceId)), arrivedAtStep: null } : null,
        status: "active" as const,
      }] } };
      emitFact({
        localId: `hired_${id}`.slice(0, 60),
        kind: "contract_opened",
        summary: farming
          ? `${employee.name} took the tax farm of ${world.map.provinces.find((province) => province.id === delta.provinceId)?.name ?? delta.provinceId}, paying ${delta.advance} for it${delta.monthlyPay > 0 ? ` and ${delta.monthlyPay} a month` : ""}.`
          : `${employee.name} was hired: ${delta.label}${broughtWords}${servedForceName === null ? "" : `, in the service of ${servedForceName}`}${delta.advance > 0 ? `, ${delta.advance} paid down` : ""}${delta.monthlyPay > 0 ? `, ${delta.monthlyPay} a month` : ""}${endsAtStep === null ? "" : `, for ${delta.termDays} days`}.`,
        affectedRefs: [{ kind: "character", id: employeeId }, { kind: "account", id: employerAccountId }],
        knownToRefs: [{ kind: "character", id: employeeId }, ...(employer.owner.kind === "character" ? [{ kind: "character" as const, id: employer.owner.id }] : employer.owner.kind === "polity" && actorPolityOf(world, context) === employer.owner.id ? [context.actorRef] : [])],
        visibility: delta.role === "assassin" || delta.role === "agent" ? "private" : "polity",
        discoveryState: delta.role === "assassin" || delta.role === "agent" ? "private" : "polity",
        knowableInDays: 0,
        significance: 25,
      });
      return next;
    }

    case "service_contract_close": {
      const contractId = required(delta.contractRef, "The contract");
      const contract = world.material.contracts.find((candidate) => candidate.id === contractId);
      if (contract === undefined) reject(`No contract "${contractId}" exists.`, "reference");
      if (contract.status !== "active") reject(`"${contract.label}" has already ended.`);
      const actorId = context.actorRef.kind === "character" ? context.actorRef.id : null;
      const employerOwner = world.material.accounts.find((account) => account.id === contract.employerAccountId)?.owner;
      const walking = actorId === contract.employeeCharacterId;
      const early = contract.endsAtStep === null || contract.endsAtStep > atStep;
      // Walking out before the term is up is breaking it. The world may end a
      // contract of its own accord; a man ends only his own.
      let next = endContract(world, contract, walking && early ? "broken" : "ended", atStep);
      const employee = world.characters.find((character) => character.id === contract.employeeCharacterId);
      if (walking && early && employee !== undefined) {
        next = { ...next, characters: next.characters.map((character) => (character.id === employee.id
          // A man known to walk out on the people who pay him.
          ? { ...character, prestigeBps: clampBps(character.prestigeBps - WALKED_OUT_STANDING_BPS) }
          : character)) };
        if (employerOwner?.kind === "character") {
          next = addRelationCause(next, { subjectCharacterId: employerOwner.id, targetCharacterId: employee.id, label: "He took my money and walked out on me.", score: -12, dimensions: { trust: -20, respect: -8 } }, atStep, context);
        }
      }
      emitFact({
        localId: `closed_${contract.id}`.slice(0, 60),
        kind: walking && early ? "contract_broken" : "contract_ended",
        summary: walking && early
          ? `${employee?.name ?? "The man hired"} walked out on his contract before its term: ${contract.label}.`
          : `The contract was ended: ${contract.label}.`,
        affectedRefs: [{ kind: "character", id: contract.employeeCharacterId }, { kind: "account", id: contract.employerAccountId }],
        visibility: "polity",
        discoveryState: "polity",
        knowableInDays: 0,
        significance: 25,
      });
      return next;
    }

    case "regime_change": {
      const actorId = required(delta.actorCharacterRef, "Who is taking the state");
      const polityId = required(delta.polityRef, "The power whose government changes");
      const attempt = attemptRegimeChange({
        world,
        actorId,
        polityId,
        route: delta.route,
        form: delta.form,
        forceIds: delta.forceRefs.map((ref) => required(ref, "The army")),
        government: { offices: context.offices, successionRules: context.successionRules ?? [] },
        atStep,
        gameId: context.gameId,
      });
      if ("refused" in attempt) reject(attempt.refused);
      for (const fact of attempt.facts) emitFact(fact);
      return attempt.world;
    }

    case "legal_status_set": {
      const personId = required(delta.characterRef, "Whose standing this is");
      const person = world.characters.find((character) => character.id === personId && character.alive);
      if (person === undefined) reject(`No living person "${personId}" exists.${nearestTo(personId)}`, "reference");
      const actorId = context.actorRef.kind === "character" ? context.actorRef.id : null;
      const newOwnerId = delta.ownerRef === null ? null : required(delta.ownerRef, "The new owner");
      if (newOwnerId !== null && !world.characters.some((character) => character.id === newOwnerId && character.alive)) {
        reject(`No living person "${newOwnerId}" exists to own ${person.name}.${nearestTo(newOwnerId)}`, "reference");
      }
      const named = (id: string | null): string => world.characters.find((character) => character.id === id)?.name ?? "somebody";
      let changed: Partial<WorldState["characters"][number]>;
      let summary: string;
      let causes: { subjectCharacterId: string; targetCharacterId: string; label: string; score: number; dimensions: Record<string, number> }[] = [];

      if (person.legalStatus === "enslaved") {
        // Only his owner decides anything about him. The world telling its own
        // story (no actor, or the owner himself) is let through.
        if (actorId !== null && actorId !== person.ownerCharacterId) {
          reject(`${person.name} belongs to ${named(person.ownerCharacterId)}, and only his owner can free, sell or indulge him.`);
        }
        if (delta.status === "enslaved") {
          const to = newOwnerId ?? person.ownerCharacterId;
          changed = { ownerCharacterId: to, ...(delta.peculium === undefined ? {} : { peculium: delta.peculium }), ...(to !== person.ownerCharacterId ? { peculium: false } : {}) };
          summary = to !== person.ownerCharacterId
            ? `${named(person.ownerCharacterId)} sold ${person.name} to ${named(to)}.`
            : `${named(person.ownerCharacterId)} ${delta.peculium === true ? "allowed" : "took back"} ${person.name} a purse of his own.`;
        } else {
          // Freed, whatever the order called it: the old master is his patron for life.
          changed = { legalStatus: "freed", peculium: false };
          summary = `${named(person.ownerCharacterId)} set ${person.name} free. He is a freedman now, and ${named(person.ownerCharacterId)} his patron.`;
          if (person.ownerCharacterId !== null) {
            causes = [{ subjectCharacterId: person.id, targetCharacterId: person.ownerCharacterId, label: "He gave me my freedom.", score: 12, dimensions: { obligation: 30, affection: 10 } }];
          }
        }
      } else if (delta.status === "enslaved") {
        // Nobody is enslaved at large: he is already in somebody's hands.
        const held = person.disqualifyingStatuses.some((status) => CAPTIVE_STATUSES.has(status.toLowerCase()));
        if (!held) reject(`${person.name} is free and at large. He has to be taken -- captured, condemned -- before anybody can sell him.`);
        const to = newOwnerId ?? actorId;
        if (to === null) reject(`Somebody has to own ${person.name}; name who.`, "reference");
        changed = { legalStatus: "enslaved", ownerCharacterId: to, peculium: false };
        summary = `${person.name} was made a slave, the property of ${named(to)}.`;
        causes = [{ subjectCharacterId: person.id, targetCharacterId: to, label: "He made me a slave.", score: -20, dimensions: { affection: -30, fear: 20 } }];
      } else {
        // A freedman's standing is what it is; only the law makes him a citizen outright.
        reject(`${person.name} is already ${person.legalStatus === "freed" ? "a freedman" : "free"}. Only the law makes a freedman free-born.`);
      }

      emitFact({
        localId: `status_${person.id}`.slice(0, 60),
        kind: "legal_status",
        summary,
        affectedRefs: [{ kind: "character", id: person.id }, ...[person.ownerCharacterId, newOwnerId].filter((id): id is string => id !== null).map((id) => ({ kind: "character" as const, id }))],
        visibility: "public",
        discoveryState: "public",
        knowableInDays: 0,
        significance: 35,
      });
      let next: WorldState = { ...world, characters: world.characters.map((character) => (character.id === person.id ? { ...character, ...changed } : character)) };
      for (const cause of causes) next = addRelationCause(next, cause, atStep, context);
      return next;
    }

    case "character_death": {
      const doomedId = required(delta.characterRef, "Whose life this is");
      const doomed = world.characters.find((character) => character.id === doomedId);
      if (doomed === undefined || !doomed.alive) reject(`No living person "${doomedId}" exists.${nearestTo(doomedId)}`, "reference");
      const byId = delta.byCharacterRef === null ? null : required(delta.byCharacterRef, "Who did it");
      const by = byId === null ? undefined : world.characters.find((character) => character.id === byId && character.alive);
      if (byId !== null && by === undefined) reject(`No living person "${byId}" exists to do this.${nearestTo(byId)}`, "reference");
      const player = context.playerCharacterId ?? null;
      const actorId = context.actorRef.kind === "character" ? context.actorRef.id : null;
      const held = doomed.disqualifyingStatuses.some((status) => CAPTIVE_STATUSES.has(status.toLowerCase()));
      const where = world.map.provinces.find((province) => province.id === doomed.locationProvinceId);

      if (delta.manner === "execution") {
        if (by === undefined) reject(`Somebody has to order an execution; name who condemned ${doomed.name}.`, "reference");
        if (by.id === doomed.id) reject(`${doomed.name} cannot execute himself; that is a suicide.`, "reference");
        // Nobody is put to death at large. The condemned is in somebody's
        // hands -- a prisoner, a captive -- or, for a man of no account, taken
        // on the spot by soldiers who answer to whoever gave the word. A man
        // whose death would be an event has to have been taken first, which is
        // the warning: nobody who matters is executed out of a clear sky.
        const menThere = world.material.forces.some((force) => force.locationId === doomed.locationProvinceId
          && (force.commanderCharacterId === by.id || force.controllerCharacterId === by.id)
          && force.personnel.some((category) => category.fit > 0));
        const magistrateThere = by.officeId !== null && where?.controllerPolityId === by.polityId;
        const reach = menThere || magistrateThere;
        const matters = mattersEnough(world, doomed, player);
        if (!reach || (matters && !held)) {
          reject(matters && !held
            ? `${doomed.name} is not in ${by.name}'s hands: he is at large, and has to be taken before he can be put to death.`
            : `${doomed.name} is held where ${by.name} has neither men nor the power of a magistrate, and nobody there would carry out the sentence.`);
        }
        // His blood knows who gave the word, and does not forget it.
        const kin = kinOf(world, doomed.id);
        const killed = killCharacter(world, doomed.id, `He was put to death on the order of ${by.name}.`, atStep);
        for (const fact of killed.facts) emitFact({ ...fact, kind: "execution" });
        const mourned = remember(killed.world, kin.map((relative) => ({
          subjectCharacterId: relative, targetCharacterId: by.id, label: `He had ${doomed.name} put to death.`,
          score: -20, dimensions: { trust: -40, affection: -50, fear: 15 }, decayPerYearBps: 0,
        })), atStep, boundedId("executed", doomed.id));
        return kin.reduce((next, relative) => teach(next, relative, "bereaved", atStep), mourned);
      }

      if (delta.manner === "duel") {
        if (by === undefined || by.id === doomed.id) reject("A duel is fought between two people; name the other.", "reference");
        // The player fights only a duel he chose. Challenged, he is asked.
        if (player !== null && (doomed.id === player || by.id === player) && actorId !== player) {
          reject(`A challenge to ${doomed.id === player ? doomed.name : by.name} is his to accept or refuse; put it to him.`);
        }
        if (by.locationProvinceId !== doomed.locationProvinceId) reject(`${doomed.name} and ${by.name} are not in the same place, and cannot fight.`);
        // The engine says who falls, from what each man is with a sword and
        // what is left of his body; a roll hashed on the two of them and the
        // day, so a replay fights the same fight.
        const prowess = (man: typeof doomed): number => man.skills.martial * 2 + man.skills.body + man.healthBps / 100
          + (stableHash([context.gameId, atStep, man.id, "duel"]) % 60);
        const [winner, loser] = prowess(doomed) >= prowess(by) ? [doomed, by] : [by, doomed];
        const killed = killCharacter(world, loser.id, `He fell to ${winner.name} in single combat.`, atStep);
        for (const fact of killed.facts) emitFact({ ...fact, kind: "duel" });
        return {
          ...killed.world,
          characters: killed.world.characters.map((character) => (character.id === winner.id
            ? { ...character, healthBps: Math.max(500, character.healthBps - 1_500), prestigeBps: clampBps(character.prestigeBps + 500) }
            : character)),
        };
      }

      // A man's own hand. His own act always; otherwise only one who is held,
      // or whose life is already in the balance, or who is ruined -- a
      // beaten general, a captive king -- and never the player, whose death
      // is his own to choose.
      const ownAct = actorId === doomed.id;
      if (doomed.id === player && !ownAct) reject(`${doomed.name}'s life is his own to end, and he has not chosen to.`);
      const despairs = held
        || world.storylines.some((storyline) => storyline.phase !== "closed" && storyline.seedKey === `peril:${doomed.id}`)
        || world.characterPressures.some((pressure) => pressure.characterId === doomed.id && pressure.status === "active" && pressure.intensity >= 60 && (pressure.kind === "threat" || pressure.kind === "illness"));
      if (!ownAct && !despairs) reject(`Nothing has brought ${doomed.name} to the point of taking his own life.`);
      const killed = killCharacter(world, doomed.id, "He died by his own hand.", atStep);
      for (const fact of killed.facts) emitFact({ ...fact, kind: "suicide" });
      return killed.world;
    }

    case "force_raid": {
      const forceId = required(delta.forceRef, "The raiding force");
      const force = world.material.forces.find((candidate) => candidate.id === forceId);
      if (force === undefined) reject(`No force "${forceId}" exists to raid with.${nearestTo(forceId)}`, "reference");
      const province = world.map.provinces.find((candidate) => candidate.id === delta.provinceId);
      if (province === undefined) reject(`No province "${delta.provinceId}" exists to raid.`, "reference");
      if (force.locationId !== province.id) {
        const where = world.map.provinces.find((candidate) => candidate.id === force.locationId)?.name ?? force.locationId;
        reject(`${force.name} is in ${where}, not ${province.name}: it has to be there to raid it. March it in first.`);
      }
      const polityName = (id: string): string => world.map.polities.find((polity) => polity.id === id)?.name ?? id;
      if (province.controllerPolityId === force.polityId && force.outlaw !== true) {
        // Said as what did not happen, and who ordered it. Written as a maxim
        // -- "burning its farms is not a raid" -- a historian turned the
        // refusal into the man condemning the burning he had ordered.
        reject(`${force.name} were ordered to raid ${province.name} and did not: it is ${polityName(force.polityId)}'s own land, and its farmers are ${polityName(force.polityId)}'s own people. No farm was burned and nothing was taken.`);
      }
      if (province.controllerPolityId !== null && force.outlaw !== true && province.controllerPolityId !== force.polityId
        && sameConfederation(world.polityAgreements, force.polityId, province.controllerPolityId)
        && !atWar(world.polityAgreements, force.polityId, province.controllerPolityId)) {
        reject(`${force.name} were ordered to raid ${province.name} and did not: ${polityName(province.controllerPolityId)} are sworn allies of ${polityName(leaderOf(world.polityAgreements, province.controllerPolityId) ?? province.controllerPolityId)}, and nobody burns an ally's farms without first going to war with it.`);
      }
      const intoAccountId = delta.toAccountRef === null ? undefined : required(delta.toAccountRef, "Where the loot is sent");
      if (intoAccountId !== undefined && !world.material.accounts.some((account) => account.id === intoAccountId && account.status === "active")) {
        reject(`No account "${intoAccountId}" exists to send the loot to.`, "reference");
      }
      const seized = sackTheProvince(world, {
        provinceId: province.id,
        takerPolityId: force.polityId,
        takingForceId: force.id,
        atStep,
        cause: { kind: "action", id: forceId, explanation: delta.reason },
        transactionId: context.ids.next("txn"),
        shareBps: raidShareBps(force, warfareWith(world, context.warfare)),
        ...(intoAccountId === undefined ? {} : { intoAccountId }),
      });
      const victims = province.controllerPolityId === null ? "its people" : `the ${polityName(province.controllerPolityId)}`;
      emitFact({
        localId: `raid_${forceId}`,
        kind: "province_raided",
        summary: seized.taken > 0
          ? `${force.name} raided ${province.name}, burning farms and driving off what could be carried: ${seized.taken} taken from ${victims}.`
          : `${force.name} raided ${province.name}, and found nothing left worth carrying off.`,
        affectedRefs: [
          { kind: "force", id: forceId },
          { kind: "province", id: province.id },
          ...(province.controllerPolityId === null ? [] : [{ kind: "polity" as const, id: province.controllerPolityId }]),
          { kind: "polity", id: force.polityId },
        ],
        visibility: "public",
        discoveryState: "public",
        knowableInDays: 0,
        significance: 60,
      });
      return seized.world;
    }

    case "character_pressure_set": {
      const characterId = required(delta.characterRef, "The person under pressure");
      if (!world.characters.some((character) => character.id === characterId)) reject(`No character "${characterId}" exists to be under pressure.${nearestTo(characterId)}`, "reference");
      const strongest = world.characterPressures
        .filter((pressure) => pressure.characterId === characterId && pressure.kind === delta.kind && pressure.status === "active")
        .sort((a, b) => b.intensity - a.intensity || a.id.localeCompare(b.id))[0];
      if (delta.action === "resolve") {
        if (strongest === undefined) reject(`${characterId} is under no ${delta.kind} pressure to lift.`);
        return withPressures(world, resolvePressure(world, strongest.id));
      }
      if (delta.action === "refresh" && strongest !== undefined) {
        return withPressures(world, refreshPressure(world, strongest.id, atStep, delta.intensity, delta.reviewInDays));
      }
      return withPressures(world, createPressure(world, {
          id: context.ids.next("pressure"),
          characterId,
          kind: delta.kind,
          intensity: delta.intensity,
          label: delta.label,
          sourceEventId: null,
          atStep,
          reviewInSteps: delta.reviewInDays,
          expiresInSteps: delta.expiresInDays,
          visibility: delta.visibility,
        }));
    }

    case "diplomatic_message_send": {
      const senderId = required(delta.fromCharacterRef, "Whoever is writing");
      if (!world.characters.some((character) => character.id === senderId)) {
        reject(`No character "${senderId}" exists to send this.${nearestTo(senderId)}`, "reference");
      }
      const known = new Set(world.map.polities.map((polity) => polity.id));
      const letterFromId = required(delta.fromPolityId, "The power sending it");
      const letterToId = required(delta.toPolityId, "The power it is sent to");
      if (!known.has(letterFromId) || !known.has(letterToId)) {
        reject("A letter must be between two powers that exist.", "reference");
      }
      // A letter within one power is allowed: "Quintus writes to the Senate
      // asking to be made tribune" is a subject petitioning his own
      // government, which is most of what politics is. It was refused as "a
      // power does not write to itself", and the petition was lost.
      // A letter to a power, naming nobody, goes to the one person who answers
      // for that power's relations (`letters.ts`), not to all of its people.
      const recipientId = delta.toCharacterRef === null
        ? diplomaticAnswererOf(world, letterToId, context.offices, senderId)
        : required(delta.toCharacterRef, "The named recipient");
      if (recipientId !== null && !world.characters.some((character) => character.id === recipientId)) {
        reject(`No character "${recipientId}" exists to receive this.${nearestTo(recipientId)}`, "reference");
      }
      // A letter to a power goes to one of its own people. A Roman "Hiero II"
      // took Rome's letter to Syracuse and answered it for Syracuse.
      const recipientPolity = recipientId === null ? null : world.characters.find((character) => character.id === recipientId)?.polityId ?? null;
      if (recipientId !== null && recipientPolity !== null && recipientPolity !== letterToId) {
        const answerer = diplomaticAnswererOf(world, letterToId, context.offices, senderId);
        reject(`${characterName(world, recipientId)} is of ${polityName(world, recipientPolity)}, not ${polityName(world, letterToId)}: a letter to ${polityName(world, letterToId)} goes to one of its own${answerer === null ? "" : `, such as ${characterName(world, answerer)} ("${answerer}")`}, or to nobody named.`, "reference");
      }
      const inReplyToId = delta.inReplyToRef === null ? null : required(delta.inReplyToRef, "The letter this answers");
      if (inReplyToId !== null && !world.diplomacy.some((message) => message.id === inReplyToId)) {
        reject(`No letter "${inReplyToId}" exists to be answering.`, "reference");
      }
      const offer = peaceOfferMetadata(delta);
      const proposed = { ...delta, ...offer, fromPolityId: letterFromId, toPolityId: letterToId, fromCharacterId: senderId };
      const situationKey = diplomaticSituationKey(world, letterFromId, letterToId);
      const redundant = redundantDiplomaticOffer(world.diplomacy, proposed, atStep, situationKey);
      if (redundant !== undefined) {
        // Idempotent success, so repairs cannot turn suppression into a new
        // letter. References still resolve, but this is no progress for a plan.
        assignedIds.set(delta.localId, redundant.id);
        return world;
      }
      const previous = world.diplomacy.find((message) => sameNegotiation(message, proposed));
      const messageId = mint("message", delta.localId);
      // The road from the writer to the reader -- or, for a letter to a power
      // with nobody to take it, to its capital. The reply clock starts when it
      // arrives: "answer within ten days" is ten days from reading it.
      const writerAt = world.characters.find((character) => character.id === senderId)?.locationProvinceId ?? null;
      const readerAt = recipientId === null
        ? whereTheyHear(world, { kind: "polity", id: letterToId })
        : world.characters.find((character) => character.id === recipientId)?.locationProvinceId ?? null;
      const travelDays = writerAt === null || readerAt === null ? 0 : newsDaysBetween(world, writerAt, readerAt);
      const deliveredOnDay = atStep + travelDays;
      emitFact(letterFact(world, {
        localId: `letter_${messageId}`,
        kind: "letter_sent",
        summary: `${characterName(world, senderId)} wrote for ${polityName(world, letterFromId)} to ${recipientId === null ? polityName(world, letterToId) : `${characterName(world, recipientId)} of ${polityName(world, letterToId)}`}: "${delta.subject}". ${delta.terms}`,
        fromPolityId: letterFromId,
        toPolityId: letterToId,
        characterIds: [senderId, ...(recipientId === null ? [] : [recipientId])],
        visibility: delta.visibility,
        significance: offer.kind === "letter" && offer.proposes.length === 0 ? 8 : 15,
        travelDays,
      }));
      return {
        ...world,
        diplomacy: [
          ...world.diplomacy,
          {
            id: messageId,
            kind: offer.kind,
            fromPolityId: letterFromId,
            fromCharacterId: senderId,
            toPolityId: letterToId,
            toCharacterId: recipientId,
            subject: delta.subject,
            terms: delta.terms,
            sentAtStep: atStep,
            deliveredOnDay,
            replyDueByStep: delta.replyWithinDays === null ? null : deliveredOnDay + delta.replyWithinDays,
            status: "awaiting_reply" as const,
            answer: null,
            answerText: null,
            answeredAtStep: null,
            inReplyToMessageId: inReplyToId,
            ...(delta.negotiation === undefined ? {} : { negotiation: delta.negotiation }),
            negotiationId: previous?.negotiationId ?? previous?.id ?? messageId,
            negotiationOwnerCharacterId: previous?.negotiationOwnerCharacterId ?? previous?.fromCharacterId ?? senderId,
            situationKey,
            visibility: delta.visibility,
            proposes: offer.proposes,
            agreementId: null,
            ...(delta.onRefusal == null ? {} : { onRefusal: delta.onRefusal }),
            ...(delta.clauses === undefined || delta.clauses.length === 0 ? {} : { clauses: delta.clauses }),
          },
        ],
      };
    }

    case "diplomatic_message_answer": {
      const messageId = required(delta.messageRef, "The letter being answered");
      const storedMessage = world.diplomacy.find((candidate) => candidate.id === messageId);
      if (storedMessage === undefined) reject(`No letter "${messageId}" exists to answer.`, "reference");
      const message = { ...storedMessage, ...peaceOfferMetadata(storedMessage) };
      // Answering twice is not a second answer; it is the engine being asked to
      // rewrite a reply already sent and read.
      if (message !== undefined && message.status === "answered") {
        reject(`"${message.subject}" has already been answered.`);
      }
      // Nobody answers a letter still in the courier's bag.
      if (message !== undefined && !isDelivered(message, atStep)) {
        reject(`"${message.subject}" has not reached ${message.toCharacterId === null ? polityName(world, message.toPolityId) : characterName(world, message.toCharacterId)} yet: it arrives in ${message.deliveredOnDay! - atStep} day(s).`);
      }
      // An ally offered union answers by rule; the reply is only its voice (`submission.ts`).
      const ruled = unionVerdict(world, message);
      if (ruled !== null && (ruled.answer !== delta.answer || (delta.refusedClauses ?? []).length > 0 || delta.addedTerms != null)) return applyOne(world, { ...delta, answer: ruled.answer, answerText: `${delta.answerText} ${ruled.why}`.slice(0, 1_200), refusedClauses: [], addedTerms: null }, context, assignedIds, resolve, emitFact, emitAccount);
      // An acceptance that adds terms is an answer with terms of its own: the
      // player's reply is read for them (`termsAddedIn`), a model's is told in
      // "addedTerms". It binds nothing until the other side takes them (R13).
      const byThePlayer = context.playerCharacterId != null && context.actorRef.kind === "character" && context.actorRef.id === context.playerCharacterId;
      const added = delta.answer !== "accepted" || offeredAgreementKinds(message).length === 0
        ? null
        : delta.addedTerms ?? (byThePlayer ? termsAddedIn(delta.answerText) : null);
      // Each clause is agreed to or not: "we accept your protection, and
      // will not send the men" takes the one and not the other, and binds
      // neither until the other side agrees to what is left (E08).
      const refusedAt = new Set(delta.answer === "accepted" ? (delta.refusedClauses ?? []).filter((at) => at < (message.clauses?.length ?? 0)) : []);
      if (added !== null || refusedAt.size > 0) {
        const kept = message.clauses?.filter((_, at) => !refusedAt.has(at));
        const countered = applyOne(world, { ...delta, answer: "countered", addedTerms: null, refusedClauses: [] }, context, assignedIds, resolve, emitFact, emitAccount);
        const from = message.toCharacterId ?? (context.actorRef.kind === "character" ? context.actorRef.id : null);
        if (from === null) return countered;
        return applyOne(countered, {
          op: "diplomatic_message_send",
          localId: `counter_${message.id}`.slice(0, 60),
          kind: message.kind,
          fromPolityId: message.toPolityId,
          fromCharacterRef: from,
          toPolityId: message.fromPolityId,
          toCharacterRef: message.fromCharacterId,
          subject: `On "${message.subject}": accepted, on terms`.slice(0, 240),
          terms: `${message.terms.slice(0, 560)}${refusedAt.size === 0 ? "" : ` Without ${refusedAt.size === 1 ? "one of its clauses" : `${refusedAt.size} of its clauses`}.`}${added === null ? "" : ` And, in return: ${added}`}`.slice(0, 1_200),
          replyWithinDays: 30,
          inReplyToRef: message.id,
          visibility: message.visibility,
          ...(message.proposes === undefined ? {} : { proposes: message.proposes }),
          ...(message.negotiation === undefined ? {} : { negotiation: { ...message.negotiation, positions: [{ issue: "counteroffer", value: `${added ?? ""}; omitted clauses: ${[...refusedAt].join(",")}`.slice(0, 240) }] } }),
          ...(kept === undefined ? {} : { clauses: kept as never }),
          reason: `${delta.answerText}`.slice(0, 240),
        }, context, assignedIds, resolve, emitFact, emitAccount);
      }
      const answered = { ...message, status: "answered" as const, answer: delta.answer, answerText: delta.answerText, answeredAtStep: atStep };
      const repliedBeforeTable: WorldState = {
        ...world,
        diplomacy: world.diplomacy.map((candidate) => (candidate.id === messageId ? answered : candidate)),
        // How an approach was received is what moves the sender's opinion of
        // the power that received it -- silence hardest of all.
        polityStances: diplomaticAnswerChangesTrust(world.diplomacy, answered) ? [...applyDiplomaticAnswerToStance(world.polityStances, answered, atStep, (() => {
          const writer = world.characters.find((character) => character.id === message.fromCharacterId);
          const answererHand = world.characters.find((character) => character.id === (message.toCharacterId ?? (context.actorRef.kind === "character" ? context.actorRef.id : "")));
          // A letter in a power's name -- its writer or answerer holds one of its
          // offices -- goes out as well as that power's foreign business is run.
          const inCharge = readDepartments(world);
          const liftFor = (hand: typeof writer, polityId: string): number =>
            hand !== undefined && officeholderPolity(world, hand.id, hand.polityId) === polityId ? inCharge.headLift({ kind: "polity", id: polityId }, "foreign_letters") : 0;
          return { writer, answerer: answererHand, writerLift: liftFor(writer, message.fromPolityId), answererLift: liftFor(answererHand, message.toPolityId) };
        })())] : world.polityStances,
      };
      // "Let us discuss peace", accepted: the two sides sit down at the table (`world/peace-table.ts`).
      const replied: WorldState = message.kind === "peace_talks" && delta.answer === "accepted" ? openPeaceTable(repliedBeforeTable, message, atStep) : repliedBeforeTable;
      const answerer = message.toCharacterId ?? diplomaticAnswererOf(world, message.toPolityId, context.offices, message.fromCharacterId);
      const how = { accepted: "accepted", refused: "refused", countered: "answered with terms of its own", ignored: "let pass unanswered" }[delta.answer];
      // One person writing back to another is not a power answering a power:
      // "Rome answered with terms of its own Rome's letter" was a friend's reply.
      const betweenPeople = message.kind === "letter" && offeredAgreementKinds(message).length === 0 && message.toCharacterId !== null;
      const personalHow = { accepted: "agreed to", refused: "refused", countered: "wrote back to", ignored: "left unanswered" }[delta.answer];
      emitFact(letterFact(world, {
        localId: `reply_${messageId}`,
        kind: "letter_answered",
        summary: betweenPeople
          ? `${characterName(world, message.toCharacterId!)} ${personalHow} ${characterName(world, message.fromCharacterId)}'s letter "${message.subject}": ${delta.answerText}`
          : `${polityName(world, message.toPolityId)} ${how} ${polityName(world, message.fromPolityId)}'s letter "${message.subject}"${answerer === null ? "" : `, in the words of ${characterName(world, answerer)}`}: ${delta.answerText}`,
        fromPolityId: message.fromPolityId,
        toPolityId: message.toPolityId,
        characterIds: [message.fromCharacterId, ...(answerer === null ? [] : [answerer])],
        visibility: message.visibility,
        significance: delta.answer === "accepted" && offeredAgreementKinds(message).length > 0 ? 35 : 15,
      }));
      // A man who was handed an ultimatum does not forget who handed it him,
      // however he answered: he is the more afraid of him, and the less fond.
      const threatened = message.kind === "ultimatum" && answerer !== null
        ? remember(replied, [{
          subjectCharacterId: answerer, targetCharacterId: message.fromCharacterId, label: `He put an ultimatum to ${polityName(world, message.toPolityId)}: ${message.subject}`.slice(0, 200),
          score: -10, dimensions: { fear: 15, affection: -15, trust: -10 },
        }], atStep, boundedId("ultimatum", messageId))
        : replied;
      const settled = delta.answer === "accepted" ? bindTheAcceptance(threatened, answered)
        : delta.answer === "refused" || delta.answer === "ignored" ? carryOutTheThreat(threatened, answered) : threatened;
      // Taken in, or the refusal remembered, whatever else the letter offered (`submission.ts`).
      return ruled === null ? settled : carryOutUnion(settled, ruled, atStep, emitFact);
    }

    case "agreement_open": {
      const known = new Set(world.map.polities.map((polity) => polity.id));
      const partyId = required(delta.polityId, "The first party");
      const otherPartyId = required(delta.otherPolityId, "The other party");
      if (!known.has(partyId) || !known.has(otherPartyId)) {
        reject("An agreement must be between two powers that exist.", "reference");
      }
      if (partyId === otherPartyId) reject("A power holds no agreement with itself.", "reference");
      const sourceMessageId = delta.sourceMessageRef === null ? null : required(delta.sourceMessageRef, "The letter this came from");
      if (sourceMessageId !== null && !world.diplomacy.some((message) => message.id === sourceMessageId)) {
        reject(`No letter "${sourceMessageId}" exists for this to come from.`, "reference");
      }
      // A war declared in the same breath as an ultimatum to the same power is
      // the ultimatum's threat, not a war yet: it waits for the answer
      // (`carryOutTheThreat`). One sent in an earlier season and still
      // unanswered does not hold a ruler back who has stopped waiting.
      if (delta.kind === "war") {
        const pending = world.diplomacy.find((message) => message.kind === "ultimatum"
          && message.status === "awaiting_reply"
          && message.sentAtStep === atStep
          && ((message.fromPolityId === partyId && message.toPolityId === otherPartyId) || (message.fromPolityId === otherPartyId && message.toPolityId === partyId)));
        if (pending !== undefined) {
          emitFact(letterFact(world, {
            localId: `threat_made_${pending.id}`,
            kind: "war_threatened",
            summary: `${polityName(world, pending.fromPolityId)} will make war on ${polityName(world, pending.toPolityId)} if "${pending.subject}" is refused or goes unanswered.`,
            fromPolityId: pending.fromPolityId,
            toPolityId: pending.toPolityId,
            characterIds: [pending.fromCharacterId],
            visibility: pending.visibility,
            significance: 30,
          }));
          // What the letter already threatens stands: a war held back for the
          // next attack is not brought forward by being written twice.
          return { ...world, diplomacy: world.diplomacy.map((message) => (message.id === pending.id ? { ...message, onRefusal: message.onRefusal ?? ("war" as const) } : message)) };
        }
      }
      // A protectorate runs from the protected to the protector. Written the
      // other way round -- Carthage "protected by" the Mamertines -- it is
      // turned the right way: the lesser power is the one protected.
      let [fromId, toId] = [partyId, otherPartyId];
      if (delta.kind === "protectorate") {
        const held = (id: string): number => world.map.provinces.filter((province) => province.controllerPolityId === id).length;
        if (held(partyId) > held(otherPartyId)) [fromId, toId] = [otherPartyId, partyId];
        // Nobody is protected by two powers at once. Messana under Rome's
        // protection and then Carthage's was two treaties quietly contradicting
        // each other, when it was the very quarrel the First Punic War began with.
        const already = world.polityAgreements.find((agreement) => agreement.status === "active" && agreement.kind === "protectorate"
          && agreement.polityId === fromId && agreement.otherPolityId !== toId);
        if (already !== undefined) {
          reject(`${polityName(world, fromId)} are already under the protection of ${polityName(world, already.otherPolityId)}. A second protector must first see that one renounced or broken -- by the client, or by war.`);
        }
      }
      // The same thing twice is not two agreements. Peace declared while peace
      // already stands is a restatement, and a second war is still one war.
      const standing = agreementsBetween(world.polityAgreements, partyId, otherPartyId).find((agreement) => agreement.kind === delta.kind);
      // The acceptance of a letter opens what it offered (`bindTheAcceptance`);
      // the answerer writing the same treaty out beside it is saying so twice.
      if (standing !== undefined && sourceMessageId !== null && standing.sourceMessageId === sourceMessageId) return world;
      // Terms still waiting on their ratification are not made by writing them out again.
      if (sourceMessageId !== null && world.diplomacy.some((message) => message.id === sourceMessageId && message.ratification?.status === "waiting")) return world;
      // New terms between powers already at peace are added to the peace they
      // have. Rejected as a second peace, every cession after the first was
      // "accepted" and nothing came of it: a war ended with six provinces, and
      // the rest of Sicily could be had only by breaking the peace again.
      if (standing !== undefined && delta.kind !== "war" && (delta.clauses ?? []).length > 0) {
        const added = carryOutClauses(world, delta.clauses ?? [], standing.id, partyId, otherPartyId, required, context, emitFact, sourceMessageId);
        emitFact({
          localId: `terms_added_${delta.localId}`.slice(0, 60),
          kind: "treaty_amended",
          summary: `${polityName(world, partyId)} and ${polityName(world, otherPartyId)} added to the ${delta.kind.replace(/_/g, " ")} between them: ${delta.terms}`.slice(0, 600),
          affectedRefs: [{ kind: "polity", id: partyId }, { kind: "polity", id: otherPartyId }],
          visibility: delta.visibility === "private" ? "polity" : "public",
          discoveryState: delta.visibility === "private" ? "polity" : "public",
          knowableInDays: 0,
          significance: 60,
        });
        return {
          ...added,
          polityAgreements: added.polityAgreements.map((agreement) => (agreement.id === standing.id
            ? { ...agreement, terms: `${agreement.terms} ${delta.terms}`.slice(0, 600) }
            : agreement)),
        };
      }
      if (standing !== undefined) {
        reject(`${partyId} and ${otherPartyId} already stand in ${delta.kind}.`);
      }
      // An ally bound by foedus makes no war or peace but its leader's. It can
      // trade, and it can turn on its leader -- that is a revolt, and it ends
      // the foedus -- but anything else it must leave the foedus to do.
      const nameOf = (id: string): string => world.map.polities.find((polity) => polity.id === id)?.name ?? id;
      for (const [party, counterparty] of [[partyId, otherPartyId], [otherPartyId, partyId]] as const) {
        const leader = leaderOf(world.polityAgreements, party);
        if (leader === null || leader === counterparty || delta.kind === "trade_pact") continue;
        reject(`${nameOf(party)} are bound to ${nameOf(leader)} by foedus, and ${nameOf(leader)} makes their war and peace. They must break with ${nameOf(leader)} before they treat with ${nameOf(counterparty)}.`);
      }
      if (delta.kind === "foedus") {
        const leader = leaderOf(world.polityAgreements, partyId);
        if (leader !== null) reject(`${nameOf(partyId)} already follow ${nameOf(leader)} by foedus.`);
        if (leaderOf(world.polityAgreements, otherPartyId) !== null) reject(`${nameOf(otherPartyId)} follow another power themselves and cannot lead allies.`);
        if (alliesLedBy(world.polityAgreements, partyId).length > 0) reject(`${nameOf(partyId)} lead allies of their own and follow nobody.`);
      }
      // War and peace cannot both be true. Opening one closes the others, which
      // is what makes "accept the peace" a single act rather than a checklist.
      const opposed: Record<string, readonly string[]> = {
        // A protectorate is not a peace, so a war does not end one: a protector
        // at war with its own client has a revolt on its hands, which is a
        // different and more interesting thing than a lapsed treaty.
        // An ally that goes to war with its leader has left the foedus.
        war: ENDED_BY_WAR,
        peace: ["war"],
        truce: ["war"],
        alliance: ["war"],
        non_aggression: ["war"],
        // Enemies who swear the foedus -- the defeated usually did -- are at war no longer.
        foedus: ["war"],
        // Nobody is protected by two powers at once. That is the quarrel the
        // second protector is picking, and at Messana it was the war itself.
        protectorate: ["protectorate"],
      };
      const closes = new Set(opposed[delta.kind] ?? []);
      const agreementId = mint("agreement", delta.localId);
      // A war is the one agreement that is always news. Rome went to war with
      // Carthage on 15 July in a delta nobody wrote a fact for, and the player
      // learned of it from an ally's letter a month later. An attack and a
      // refused ultimatum tell it their own way (`attack_`, `threat_`).
      if (delta.kind === "war" && !/^(attack|threat)_/.test(delta.localId)) {
        emitFact({
          localId: `war_opened_${delta.localId}`.slice(0, 60),
          kind: "war_declared",
          summary: `${polityName(world, partyId)} and ${polityName(world, otherPartyId)} went to war. ${delta.terms}`.slice(0, 600),
          affectedRefs: [{ kind: "polity", id: partyId }, { kind: "polity", id: otherPartyId }],
          visibility: "public",
          discoveryState: "public",
          knowableInDays: 0,
          significance: 75,
        });
      }
      // What the treaty makes happen, carried out as it is made.
      const clauses = delta.kind === "peace" ? [...(delta.clauses ?? []), ...servesInTerms(world, delta.terms, partyId, otherPartyId, delta.clauses ?? [])] : delta.clauses ?? [];
      const carried = carryOutClauses(world, clauses, agreementId, partyId, otherPartyId, required, context, emitFact, sourceMessageId);
      // A peace settles what each side holds of the other's (`settleOccupations`).
      const bound = delta.kind !== "peace" ? carried : { ...carried, map: { ...carried.map, provinces: settleOccupations(carried.map.provinces, partyId, otherPartyId, atStep) } };
      // A power that surrendered in it is no more, and is party to nothing.
      if ((delta.clauses ?? []).some((clause) => clause.kind === "submission")) return {
        ...bound,
        storylines: bound.storylines.map((storyline) => {
          const source = world.diplomacy.find((message) => message.id === sourceMessageId);
          if (source === undefined || source.toCharacterId === null || storyline.phase === "closed" || storyline.provinceId === null
            || !storyline.participantIds.includes(source.fromCharacterId) || !storyline.participantIds.includes(source.toCharacterId)) return storyline;
          const focus = world.map.provinces.find((province) => province.id === storyline.provinceId);
          const surrendered = (delta.clauses ?? []).some((clause) => clause.kind === "submission"
            && (focus?.controllerPolityId === clause.polityId || focus?.settlements.some((city) => city.controllerPolityId === clause.polityId)));
          if (!surrendered) return storyline;
          return { ...storyline, phase: "closed" as const, updatedAtStep: atStep, closedAtStep: atStep,
            history: [...storyline.history, delta.reason].slice(-24), nextDevelopment: "The agreed surrender has been carried out." };
        }),
        // Keep the signed instrument on record even though surrender ended
        // one party. Otherwise the accepted offer had no treaty to link to.
        polityAgreements: [...bound.polityAgreements, { id: agreementId, kind: delta.kind, polityId: fromId, otherPolityId: toId,
          terms: delta.terms, sinceStep: atStep, untilStep: null, sourceMessageId, status: "ended" as const,
          endedAtStep: atStep, endedReason: "The surrender terms were carried out; the submitting power ceased to exist.", visibility: delta.visibility }],
      };
      // A peace calls off the knives either side had out for the other: an
      // attempt Decius laid on the consul during the war went ahead a fortnight
      // after Decius had accepted Rome's terms. Spying goes on.
      const sides = new Set([partyId, otherPartyId]);
      const polityOfPerson = (id: string): string | null => bound.characters.find((character) => character.id === id)?.polityId ?? null;
      const calledOff = delta.kind !== "peace" ? bound.covertPlots : bound.covertPlots.map((plot) => {
        if (plot.outcome !== null || plot.kind === "espionage") return plot;
        const by = polityOfPerson(plot.sponsorCharacterId);
        const at = polityOfPerson(plot.targetCharacterId);
        return by !== null && at !== null && by !== at && sides.has(by) && sides.has(at) ? { ...plot, outcome: "nothing" as const, resolvedAtStep: atStep } : plot;
      });
      // What it ends stops being paid on, here as anywhere (`treaties.ts`).
      return endObligationsOfEndedAgreements({
        ...bound,
        covertPlots: calledOff,
        polityAgreements: [
          ...bound.polityAgreements.map((agreement) =>
            agreement.status === "active" &&
            closes.has(agreement.kind) &&
            ((agreement.polityId === partyId && agreement.otherPolityId === otherPartyId) ||
              (agreement.polityId === otherPartyId && agreement.otherPolityId === partyId))
              ? { ...agreement, status: "ended" as const, endedAtStep: atStep, endedReason: delta.reason }
              : agreement,
          ),
          {
            id: agreementId,
            kind: delta.kind,
            polityId: fromId,
            otherPolityId: toId,
            terms: delta.terms,
            sinceStep: atStep,
            untilStep: delta.forDays === null ? null : atStep + delta.forDays,
            sourceMessageId,
            status: "active" as const,
            endedAtStep: null,
            endedReason: null,
            visibility: delta.visibility,
          },
        ],
      });
    }

    case "agreement_close": {
      const agreementId = required(delta.agreementRef, "The agreement being ended");
      const agreement = world.polityAgreements.find((candidate) => candidate.id === agreementId);
      if (agreement === undefined) reject(`No agreement "${agreementId}" exists to end.`, "reference");
      if (agreement.status === "ended") reject("That agreement has already ended.");
      // A treaty torn up stops being paid on -- as does one ended any other way (`treaties.ts`).
      return endObligationsOfEndedAgreements({
        ...world,
        polityAgreements: world.polityAgreements.map((candidate) =>
          candidate.id === agreementId ? { ...candidate, status: "ended" as const, endedAtStep: atStep, endedReason: delta.reason } : candidate,
        ),
      });
    }

    case "contingency_arm": {
      const ownerId = required(delta.ownerCharacterRef, "Whose plan this is");
      const owner = world.characters.find((character) => character.id === ownerId);
      if (owner === undefined) reject(`No character "${ownerId}" exists to lay this plan.${nearestTo(ownerId)}`, "reference");
      if (!world.map.provinces.some((province) => province.id === delta.provinceId)) {
        reject(`No province "${delta.provinceId}" exists to lay ${delta.label} in.`, "reference");
      }
      if (delta.againstPolityId !== null && !world.map.polities.some((polity) => polity.id === delta.againstPolityId)) {
        reject(`No power "${delta.againstPolityId}" exists for ${delta.label} to be laid against.`, "reference");
      }
      const ambushId = delta.ambushForceRef === null ? null : required(delta.ambushForceRef, "The force waiting to fall on them");
      if (ambushId !== null && !world.material.forces.some((force) => force.id === ambushId)) {
        reject(`No force "${ambushId}" exists to spring ${delta.label}.`, "reference");
      }

      // The money goes now, because that is what a trap is: pitch and timber
      // bought and put in place months before anybody walks into it. Only as
      // far as it actually goes -- a trap paid for out of an empty treasury is
      // a trap nobody built.
      let paid = world;
      let spend = delta.spend;
      const fundingId = delta.fundingAccountRef === null ? null : required(delta.fundingAccountRef, "The account this is paid from");
      if (fundingId !== null && spend > 0) {
        const account = world.material.accounts.find((candidate) => candidate.id === fundingId);
        if (account === undefined) reject(`No account "${fundingId}" exists to pay for ${delta.label}.`, "reference");
        spend = Math.min(spend, Math.max(0, account.balance));
        paid = moveMoney(world, { from: fundingId, to: null, amount: spend, kind: "purchase", causeId: delta.localId, explanation: `Laid ready: ${delta.label}` }, context);
      }

      // A question asked in the same order -- "petition for the command, and
      // once it is given, raise Legio II" -- is named by its handle.
      const trigger = delta.trigger.kind === "question_decided"
        ? { ...delta.trigger, procedureId: required(delta.trigger.procedureId, "The question it waits on") }
        : delta.trigger;
      if (trigger.kind === "question_decided" && !world.material.politicalProcedures.some((procedure) => procedure.id === trigger.procedureId)) {
        reject(`No question "${trigger.procedureId}" is before anybody for ${delta.label} to wait on.${nearestTo(trigger.procedureId)}`, "reference");
      }
      return {
        ...paid,
        contingencies: [...paid.contingencies, {
          id: context.ids.next("contingency"),
          label: delta.label,
          ownerCharacterId: ownerId,
          ownerPolityId: owner.polityId,
          trigger,
          effect: delta.effect,
          provinceId: delta.provinceId,
          positionId: delta.positionId,
          againstPolityId: delta.againstPolityId,
          preparationSpend: spend,
          ambushForceId: ambushId,
          armedReading: watchReading(trigger, paid),
          armedAtStep: atStep,
          expiresAtStep: delta.expiresInDays === null ? null : atStep + delta.expiresInDays,
          status: "armed" as const,
          sprungAtStep: null,
          tollBps: null,
          ...(delta.standingOrder == null ? {} : { standingOrder: delta.standingOrder }),
        }],
      };
    }

    case "siege_lay": {
      const forceId = required(delta.forceRef, "The army laying the siege");
      const force = world.material.forces.find((candidate) => candidate.id === forceId);
      if (force === undefined) reject(`No force "${forceId}" exists to lay a siege.${nearestTo(forceId)}`, "reference");
      const province = world.map.provinces.find((candidate) => candidate.id === force.locationId);
      if (province === undefined) reject(`${force.name} stands nowhere a siege can be laid.`, "reference");
      const settlement = delta.settlementId === null ? null : province.settlements.find((candidate) => candidate.id === delta.settlementId) ?? null;
      if (delta.settlementId !== null && settlement === null) {
        const elsewhere = world.map.provinces.find((candidate) => candidate.settlements.some((city) => city.id === delta.settlementId));
        reject(elsewhere === undefined
          ? `No city "${delta.settlementId}" exists to besiege.`
          : `${force.name} is in ${province.name}, and that city is in ${elsewhere.name}: march there first.`, elsewhere === undefined ? "reference" : "world");
      }
      const defenderId = settlement?.controllerPolityId ?? province.controllerPolityId;
      const name = (id: string): string => world.map.polities.find((polity) => polity.id === id)?.name ?? id;
      const place = settlement?.name ?? province.name;
      if (defenderId === null || defenderId === force.polityId) reject(`${place} is not held against ${force.name}: there is nothing there to besiege.`);
      // Laid by an army at war with the city, as an assault would be.
      if (!atWar(world.polityAgreements, force.polityId, defenderId)) {
        reject(`${name(force.polityId)} is not at war with ${name(defenderId)}: a siege of ${place} is an act of war, and the war is declared first ("agreement_open").`);
      }
      // Laid once: the same army at the same city is the siege already under way,
      // and an order naming works for it raises them there.
      const assaultIf = (next: WorldState, siegeId: string): WorldState => {
        if (delta.assault !== true) return next;
        const stormed = assaultSiege(next, siegeId, atStep, context.warfare, context.ids, context.playerCharacterId ?? null);
        for (const fact of stormed.facts) emitFact(fact);
        for (const account of stormed.battles) emitAccount(account);
        return stormed.world;
      };
      const standing = world.sieges.find((siege) => siege.status === "active" && siege.forceId === forceId && siege.provinceId === province.id && siege.settlementId === (settlement?.id ?? null));
      if (standing !== undefined) return assaultIf(raiseWorks(world, standing, force, delta.works ?? [], atStep, context, emitFact), standing.id);
      const siegeId = mint("siege", delta.localId);
      emitFact({
        localId: `siege_${siegeId}`.slice(0, 60),
        kind: "siege_laid",
        summary: `${force.name} laid siege to ${place}, held by ${name(defenderId)}.`,
        affectedRefs: [{ kind: "force", id: force.id }, { kind: "province", id: province.id }, { kind: "polity", id: force.polityId }, { kind: "polity", id: defenderId }],
        visibility: "public",
        discoveryState: "public",
        knowableInDays: 0,
        significance: 55,
      });
      const siege = {
        id: siegeId, forceId: force.id, provinceId: province.id, settlementId: settlement?.id ?? null,
        besiegerPolityId: force.polityId, defenderPolityId: defenderId,
        startedAtStep: atStep, pressedToStep: atStep, reportedAtStep: atStep,
        pressureBps: 0, awaiting: null, works: [], told: [], status: "active" as const, endedAtStep: null, endedReason: null,
      };
      return assaultIf(raiseWorks({ ...world, sieges: [...world.sieges, siege] }, siege, force, delta.works ?? [], atStep, context, emitFact), siege.id);
    }

    case "force_provision": {
      const forceId = required(delta.forceRef, "The army to be fed");
      const force = world.material.forces.find((candidate) => candidate.id === forceId);
      if (force === undefined) reject(`No force "${forceId}" exists to feed.${nearestTo(forceId)}`, "reference");
      if (isNavalForce(force, warfareWith(world, context.warfare))) reject(`${force.name} is a fleet, victualled in port, not an army to be fed in the field.`);
      let got: ReturnType<typeof breadWhereItStands>;
      try {
        if (delta.how === "convoy") {
          if (delta.fromProvinceId === null) reject("A convoy is sent from somewhere: name the province (\"fromProvinceId\").");
          got = sendConvoy(world, force, delta.fromProvinceId, delta.days, atStep, context.ids);
        } else {
          got = breadWhereItStands(world, force, delta.how, delta.days, atStep);
        }
      } catch (refusal) {
        if (refusal instanceof GrainRefused) reject(refusal.message);
        throw refusal;
      }
      let fed = got.world;
      if (got.cost > 0) {
        // Whoever was named pays; failing that, whoever pays the army; failing
        // that, its power's treasury.
        const named = delta.payAccountRef === null ? null : required(delta.payAccountRef, "Who pays for the bread");
        const obligationPayer = force.payObligationId === null ? undefined : world.material.obligations.find((obligation) => obligation.id === force.payObligationId)?.payerAccountId;
        const treasury = world.material.accounts.find((account) => account.owner.kind === "polity" && account.owner.id === force.polityId)?.id;
        const payer = named ?? obligationPayer ?? treasury ?? null;
        const purse = payer === null ? undefined : world.material.accounts.find((account) => account.id === payer);
        if (purse === undefined) reject(`Nobody is named to pay the ${got.cost} the bread costs.`, "reference");
        if (purse.balance < got.cost) reject(`The bread costs ${got.cost}, and ${purse.id} holds ${purse.balance}.`);
        fed = moveMoney(fed, { from: purse.id, to: got.sellerAccountId, amount: got.cost, kind: "purchase", causeId: forceId, explanation: `Bread for ${force.name}.` }, context);
      }
      for (const fact of got.facts) emitFact(fact);
      return fed;
    }

    case "siege_lift": {
      const siegeId = required(delta.siegeRef, "The siege");
      const siege = world.sieges.find((candidate) => candidate.id === siegeId);
      if (siege === undefined) reject(`No siege "${siegeId}" is under way.`, "reference");
      if (siege.status !== "active") reject("That siege is already over.");
      const force = world.material.forces.find((candidate) => candidate.id === siege.forceId);
      const place = world.map.provinces.flatMap((province) => province.settlements).find((city) => city.id === siege.settlementId)?.name
        ?? world.map.provinces.find((province) => province.id === siege.provinceId)?.name ?? siege.provinceId;
      emitFact({
        localId: `lifted_${siege.id}`.slice(0, 60),
        kind: "siege_lifted",
        summary: `${force?.name ?? "The besiegers"} raised the siege of ${place} after ${atStep - siege.startedAtStep} days. ${delta.reason}`.slice(0, 600),
        affectedRefs: [{ kind: "province", id: siege.provinceId }, { kind: "polity", id: siege.besiegerPolityId }, { kind: "polity", id: siege.defenderPolityId }, ...(force === undefined ? [] : [{ kind: "force" as const, id: force.id }])],
        visibility: "public",
        discoveryState: "public",
        knowableInDays: 0,
        significance: 50,
      });
      return { ...world, sieges: world.sieges.map((candidate) => (candidate.id === siege.id ? { ...candidate, status: "lifted" as const, endedAtStep: atStep, endedReason: delta.reason.slice(0, 300) } : candidate)) };
    }

    case "audit_open": {
      const auditorId = required(delta.auditorCharacterRef, "The man going through the books");
      const auditor = world.characters.find((character) => character.id === auditorId && character.alive);
      if (auditor === undefined) reject(`No living person "${auditorId}" exists to go through the books.${nearestTo(auditorId)}`, "reference");
      const departmentId = delta.departmentRef == null ? null : required(delta.departmentRef, "The department audited");
      const department = departmentId === null ? undefined : world.departments.find((candidate) => candidate.id === departmentId && candidate.abolishedAtStep === null);
      if (departmentId !== null && department === undefined) reject(`No department "${departmentId}" stands to be audited.`, "reference");
      const ownerId = delta.householdOwnerRef == null ? null : required(delta.householdOwnerRef, "Whose estates are audited");
      if (department === undefined && (ownerId === null || !world.characters.some((character) => character.id === ownerId))) {
        reject("An audit goes through a department's books or a household's; name one.", "reference");
      }
      const scope = department?.scope ?? { kind: "household" as const, id: ownerId! };
      // One audit of the same books at a time.
      if (world.audits.some((audit) => audit.status === "under_way" && audit.scope.id === scope.id && audit.departmentId === departmentId)) {
        reject("Those books are already being gone through.");
      }
      const orderedBy = context.actorRef.kind === "character" ? context.actorRef.id : auditorId;
      // Both sets of books, when both were named: the department's and the household's.
      const alsoHouseholdId = department !== undefined && ownerId !== null && world.characters.some((character) => character.id === ownerId) ? ownerId : null;
      // And the charge it answers, where the man whose books these are stands accused.
      const accused = alsoHouseholdId ?? (scope.kind === "household" ? scope.id : null);
      const allegation = accused === null ? undefined : world.characterPressures.find((pressure) => pressure.characterId === accused && pressure.status === "active"
        && /accus|divert|theft|embezzl|peculat|stole|funds/i.test(pressure.label));
      return {
        ...world,
        audits: [...world.audits, {
          id: mint("audit", delta.localId), orderedByCharacterId: orderedBy, auditorCharacterId: auditorId, scope, departmentId,
          startedAtStep: atStep, dueAtStep: atStep + AUDIT_DAYS, status: "under_way" as const,
          alsoHouseholdId, allegationPressureId: allegation?.id ?? null,
        }].slice(-200),
      };
    }

    case "contingency_disarm": {
      const planId = required(delta.contingencyRef, "The plan being called off");
      const plan = world.contingencies.find((candidate) => candidate.id === planId);
      if (plan === undefined) reject(`No plan "${planId}" exists to call off.`, "reference");
      if (plan.status !== "armed") reject(`${plan.label} is not standing armed, and cannot be called off.`);
      return {
        ...world,
        contingencies: world.contingencies.map((candidate) =>
          candidate.id === planId ? { ...candidate, status: "disarmed" as const } : candidate),
      };
    }

    case "covert_plot_open": {
      const targetId = required(delta.targetCharacterRef, "The person this is laid against");
      const target = world.characters.find((character) => character.id === targetId);
      if (target === undefined || !target.alive) reject(`No living person "${targetId}" exists to move against.${nearestTo(targetId)}`, "reference");
      const sponsorId = required(delta.sponsorCharacterRef, "The person who wants it done");
      const sponsor = world.characters.find((character) => character.id === sponsorId);
      if (sponsor === undefined) reject(`No person "${sponsorId}" exists to want this done.${nearestTo(sponsorId)}`, "reference");
      if (sponsorId === targetId) reject(`${target.name} cannot be the one plotting against himself.`);

      const agentId = delta.agentCharacterRef === null ? null : required(delta.agentCharacterRef, "The hand this is done by");
      const agent = agentId === null ? null : world.characters.find((character) => character.id === agentId) ?? null;
      if (agentId !== null && agent === null) reject(`No person "${agentId}" exists to carry this out.${nearestTo(agentId)}`, "reference");

      // A plot already standing against the same man, from the same quarter, is
      // that plot -- ordered twice, not doubled. Otherwise a player could stack
      // ten of them in one answer and turn a 12% chance into a certainty, which
      // is the whole thing the bounded odds exist to prevent.
      const alreadyLaid = world.covertPlots.find((plot) =>
        isPlotOpen(plot) && plot.targetCharacterId === targetId && plot.sponsorCharacterId === sponsorId);
      if (alreadyLaid !== undefined) {
        reject(`Something is already laid against ${target.name} on ${sponsor.name}'s account, and is not yet come to a head.`);
      }

      // The money goes first, and only as far as it actually goes: a plot paid
      // for out of an empty treasury is a plot nobody was paid for.
      let paid = world;
      const fundingId = delta.fundingAccountRef === null ? null : required(delta.fundingAccountRef, "The account this is paid from");
      // Money nobody paid buys nothing: an unpaid spend no longer bettered the odds.
      let spend = fundingId === null ? 0 : delta.spend;
      if (fundingId !== null && spend > 0) {
        const account = world.material.accounts.find((candidate) => candidate.id === fundingId);
        if (account === undefined) reject(`No account "${fundingId}" exists to pay for this.`, "reference");
        spend = Math.min(spend, Math.max(0, account.balance));
        // Money for a secret is paid in secret.
        paid = moveMoney(world, { from: fundingId, to: null, amount: spend, kind: "purchase", causeId: delta.localId, explanation: "Paid out on private business", visibility: "private" }, context);
      }

      // Settled here, once, and never rewritten. Neither this delta nor any
      // later one can move it: a player who writes "25/75" in his order is
      // telling the world how he rates his chances, not setting them.
      const odds = plotOdds(paid, { kind: delta.kind, target, sponsor, agent, spend });
      const plotId = context.ids.next("plot");

      // The thread it runs in, so this is several chronicles rather than one
      // line. Private: the world's own bookkeeping of a secret -- the people in
      // it see it because they are in it, and nobody else does.
      const storylineId = context.ids.next("storyline");

      return {
        ...paid,
        storylines: [...paid.storylines, {
          id: storylineId,
          title: PLOT_WORDS[delta.kind].title(target.name),
          participantIds: [sponsorId, ...(agentId === null ? [] : [agentId])],
          provinceId: target.locationProvinceId,
          phase: "brewing" as const,
          stakes: PLOT_WORDS[delta.kind].stakes(target.name),
          history: [`${sponsor.name} set something in motion, and told nobody who did not need to know.`],
          nextDevelopment: PLOT_WORDS[delta.kind].next,
          visibility: "private" as const,
          origin: "world" as const,
          openedByRef: { kind: "character" as const, id: sponsorId },
          openedAtStep: atStep,
          updatedAtStep: atStep,
          closedAtStep: null,
          causalFactIds: [],
          seedKey: null,
        }],
        covertPlots: [...paid.covertPlots, {
          id: plotId,
          kind: delta.kind,
          targetCharacterId: targetId,
          sponsorCharacterId: sponsorId,
          agentCharacterId: agentId,
          spend,
          fundingAccountId: fundingId,
          cover: delta.cover,
          successOddsBps: odds.successOddsBps,
          secrecyBps: odds.secrecyBps,
          openedAtStep: atStep,
          resolvesAtStep: atStep + plotResolvesIn(delta.expectedInDays),
          storylineId,
          outcome: null,
          resolvedAtStep: null,
          stirred: false,
          targetWarned: false,
        }],
      };
    }

    case "office_seat_set": {
      const holderId = delta.holderCharacterRef === null ? null : required(delta.holderCharacterRef, "The person taking the office");
      const holder = holderId === null ? undefined : world.characters.find((character) => character.id === holderId && character.alive);
      if (holderId !== null && holder === undefined) {
        reject(`No living character "${holderId}" exists to hold an office.`, "reference");
      }
      const known = allOffices(world, context.offices);
      let office = known.find((candidate) => candidate.id === delta.officeId);
      // An office the government does not have is made, the way a person
      // created holding one already made it. Looked for by name first, so that
      // "roman-tribune" finds a tribunate the world opened last year under its
      // own id instead of opening a second one beside it.
      if (office === undefined) {
        const label = delta.officeLabel ?? labelFromCategoryId(delta.officeId);
        if (holder === undefined) reject(`There is no ${label} to empty: the office was never held.`);
        const polityId = holder.polityId;
        if (polityId === null) reject(`${holder.name} belongs to no power that could have a ${label}.`);
        office = findOfficeForRole(known, polityId, label);
        if (office === undefined) {
          const officeId = context.ids.next("office");
          world = openOffice(world, officeId, label, polityId, []);
          office = allOffices(world, context.offices).find((candidate) => candidate.id === officeId)!;
        }
      }

      // Emptying it.
      if (holderId === null) {
        const seat = delta.seatId === null
          ? world.material.officeSeats.find((candidate) => candidate.officeId === office.id && candidate.status === "held")
          : world.material.officeSeats.find((candidate) => candidate.id === delta.seatId);
        if (seat?.holderCharacterId == null) reject(`No held seat of "${office.id}" to empty.`);
        const vacated = vacateOfficesOf(world, seat.holderCharacterId, delta.cause === "none" ? "removal" : delta.cause, atStep);
        // Put out of his place by another man, he knows whom to thank.
        const dismisser = context.actorRef.kind === "character" && context.actorRef.id !== seat.holderCharacterId ? context.actorRef.id : null;
        if (dismisser === null || (delta.cause !== "none" && delta.cause !== "removal")) return vacated;
        return teach(remember(vacated, [{
          subjectCharacterId: seat.holderCharacterId, targetCharacterId: dismisser, label: `He put me out of my place as ${office.label}.`.slice(0, 200),
          score: -12, dimensions: { trust: -15, respect: -10, affection: -10 },
        }], atStep, boundedId("dismissed", seat.id, atStep)), seat.holderCharacterId, "disgraced", atStep);
      }

      const placed = seatCharacterInOffice(
        world,
        holderId,
        delta.seatId === null
          ? { office, vacantSeatId: world.material.officeSeats.find((candidate) => candidate.officeId === office.id && candidate.status !== "held")?.id ?? null }
          : { office, vacantSeatId: delta.seatId },
        atStep,
      );
      // Patronage: a man given his place by another owes it to him, and knows
      // it. A seat taken for oneself is owed to nobody.
      const patronId = context.actorRef.kind === "character" && context.actorRef.id !== holderId ? context.actorRef.id : null;
      const seated: WorldState = patronId === null ? placed : {
        ...placed,
        characters: placed.characters.map((character) => {
          if (character.id !== holderId) return character;
          const cause = {
            id: boundedId("patronage", office.id, atStep), label: `Gave him his place as ${office.label}`.slice(0, 200), score: 15, occurredAtStep: atStep,
            decayPerYearBps: 1_500, encounterMemoryId: null, dimensions: { trust: 10, obligation: 25 },
          };
          const relations = character.relations.some((relation) => relation.subjectCharacterId === patronId)
            ? character.relations.map((relation) => (relation.subjectCharacterId === patronId ? { ...relation, causes: [...relation.causes.filter((known) => known.id !== cause.id), cause] } : relation))
            : [...character.relations, { subjectCharacterId: patronId, causes: [cause] }];
          return { ...character, relations };
        }),
      };
      const honouredOnly = patronId === null ? seated : teach(seated, holderId, "honoured", atStep);
      // A man put over the fleet commands it: Dentatus took the admiral's seat
      // "to be in charge of" the Roman Navy, and the navy went on under the
      // consul (R06). The office's own fleets, where its name is a sea command:
      // the power's largest that its patron commands, or that nobody does.
      const atSea = /\b(admiral|navarch|fleet|navy|naval|classis|duumvir navalis|praefect of the ships)\b/i.test(office.label) || /admiral|navarch|fleet|navy/i.test(office.id);
      const fleet = !atSea ? undefined : honouredOnly.material.forces
        .filter((force) => force.polityId === office.polityId && isNavalForce(force, warfareWith(world, context.warfare))
          && (force.commanderCharacterId === patronId || force.commanderCharacterId === null || force.controllerCharacterId === patronId))
        .sort((a, b) => b.personnel.reduce((sum, group) => sum + group.fit, 0) - a.personnel.reduce((sum, group) => sum + group.fit, 0))[0];
      const honoured = fleet === undefined ? honouredOnly : {
        ...honouredOnly,
        material: { ...honouredOnly.material, forces: honouredOnly.material.forces.map((force) => force.id === fleet.id ? { ...force, commanderCharacterId: holderId } : force) },
      };
      if (fleet !== undefined) {
        emitFact({
          localId: `takes_the_fleet_${fleet.id}`.slice(0, 60),
          kind: "command_given",
          summary: `${holder?.name ?? holderId}, as ${office.label}, takes command of ${fleet.name}.`,
          affectedRefs: [{ kind: "character", id: holderId }, { kind: "force", id: fleet.id }],
          visibility: "polity",
          discoveryState: "polity",
          knowableInDays: 0,
          significance: 35,
        });
      }
      if (delta.termDays === null) return honoured;
      return {
        ...honoured,
        material: {
          ...honoured.material,
          officeSeats: honoured.material.officeSeats.map((seat) =>
            seat.officeId === office.id && seat.holderCharacterId === holderId
              ? { ...seat, termExpiresAtStep: atStep + delta.termDays! }
              : seat),
        },
      };
    }

    case "capital_set": {
      const polityId = required(delta.polityRef, "The power designating its capital");
      const polity = world.map.polities.find((candidate) => candidate.id === polityId);
      if (polity === undefined || polity.endedAtStep != null) reject(`No surviving power "${polityId}" can designate a capital.`, "reference");
      const settlement = world.map.provinces.flatMap((province) => province.settlements).find((city) => city.id === delta.settlementId);
      if (settlement === undefined) reject(`No city "${delta.settlementId}" exists to be the capital.`, "reference");
      if (settlement.controllerPolityId !== polityId) reject(`${polity.name} does not hold ${settlement.name} and cannot make it its capital.`);
      if (polity.capitalSettlementId === settlement.id && polity.displacedCapital == null) reject(`${settlement.name} is already ${polity.name}'s capital.`);
      emitFact({
        localId: `capital_${polityId}_${atStep}`.slice(0, 60), kind: "capital_relocated",
        summary: `${polity.name} designated ${settlement.name} as its capital.`,
        affectedRefs: [{ kind: "polity", id: polityId }, { kind: "settlement", id: settlement.id }],
        visibility: "public", discoveryState: "public", knowableInDays: 0, significance: 60,
      });
      return { ...world, map: { ...world.map, polities: world.map.polities.map((candidate) => candidate.id === polityId
        ? { ...candidate, capitalSettlementId: settlement.id, displacedCapital: null,
          ...(candidate.formerCapitalSettlementIds === undefined ? {} : { formerCapitalSettlementIds: candidate.formerCapitalSettlementIds.filter((id) => id !== settlement.id) }) } : candidate) } };
    }
    case "settlement_control_set": {
      const drawn = world.map.provinces.find((candidate) =>
        candidate.settlements.some((settlement) => settlement.id === delta.settlementId));

      // A city the map never drew, in a province the map does have.
      //
      // Forty-one settlements are drawn across the whole Mediterranean, so any
      // campaign that goes anywhere will name one of the thousands that are
      // not: Hadrumentum, where an African landing actually happens, is not on
      // this map. Refusing the siege for that is the engine failing the order
      // over its own cartography. So the city is founded where it was said to
      // be and then changes hands like any other -- modestly, because nothing
      // is known about it beyond that it is there.
      let founded: Settlement | null = null;
      let province = drawn;
      if (province === undefined && delta.inProvinceId != null) {
        const ground = world.map.provinces.find((candidate) => candidate.id === delta.inProvinceId);
        if (ground === undefined) reject(`No province "${delta.inProvinceId}" exists for ${delta.settlementId} to stand in.`, "reference");
        founded = {
          id: delta.settlementId,
          name: delta.name ?? labelFromCategoryId(delta.settlementId),
          kind: "town",
          provinceId: ground.id,
          controllerPolityId: ground.controllerPolityId,
          size: 30,
          fortificationLevel: 2,
        };
        province = { ...ground, settlements: [...ground.settlements, founded] };
      }
      if (province === undefined) {
        reject(`No settlement "${delta.settlementId}" exists to change hands, and no province was named to found it in.`, "reference");
      }
      const settlement = province.settlements.find((candidate) => candidate.id === delta.settlementId)!;

      const takerId = delta.toPolityRef === null ? null : required(delta.toPolityRef, "The power taking the city");
      if (takerId !== null && !world.map.polities.some((polity) => polity.id === takerId)) {
        reject(`No power "${takerId}" exists to hold a city.`, "reference");
      }
      if (settlement.controllerPolityId === takerId) {
        reject(`${settlement.name} is already held by ${takerId ?? "nobody"}.`);
      }

      // Men at its walls, or the countryside around it. A city is taken by an
      // army standing in its province -- which is also the only way a garrison
      // can hold out in a place whose fields have already gone.
      const besieging = takerId !== null && world.material.forces.some(
        (force) => force.polityId === takerId && force.locationId === province.id,
      );
      if (takerId !== null && !besieging && province.controllerPolityId !== takerId) {
        reject(`${takerId} has no army before ${settlement.name} and does not hold the country around it, so it cannot take the city.`);
      }

      const settlements = province.settlements.map((candidate) =>
        candidate.id === settlement.id ? { ...candidate, controllerPolityId: takerId } : candidate);

      // A province whose every city has gone has gone. Held loosely: the
      // countryside has not been beaten, it has been left behind -- and this
      // only follows where there were cities to take in the first place.
      const allTaken = takerId !== null && settlements.length > 0
        && settlements.every((candidate) => candidate.controllerPolityId === takerId);

      let taken: WorldState = {
        ...world,
        map: {
          ...world.map,
          provinces: world.map.provinces.map((candidate) => (candidate.id === province.id
            ? {
              ...candidate,
              settlements,
              ...(allTaken ? { ...takenBy(candidate, takerId, world.polityAgreements), controlFirmnessBps: Math.min(candidate.controlFirmnessBps, 3_000), lostBy: candidate.controllerPolityId === null ? null : { polityId: candidate.controllerPolityId, atStep } } : {}),
            }
            : candidate)),
        },
      };

      // A city that surrenders is not a city that is stormed. Only a storm is
      // plundered, and only for what that city was worth against the rest of
      // its province.
      if (delta.sacked && takerId !== null) {
        const stormingForce = world.material.forces.find(
          (force) => force.polityId === takerId && force.locationId === province.id,
        );
        taken = sackTheProvince(taken, {
          provinceId: province.id,
          takerPolityId: takerId,
          takingForceId: stormingForce?.id ?? null,
          atStep,
          cause: { kind: "action", id: settlement.id, explanation: `The storming of ${settlement.name}` },
          transactionId: context.ids.next("txn"),
          // Read from `taken`, not `world`: a city founded by this very
          // delta is not on the old map, and its share of the province would
          // come back as nothing.
          shareBps: settlementShareBps(taken, settlement.id),
        }).world;
      }
      // Said, by the engine. A city changing hands wrote nothing, and Messana
      // passed to Rome with only a battle report saying the Mamertines "still
      // held" it -- the change was in the map and nowhere in the record.
      const loserId = settlement.controllerPolityId;
      emitFact({
        localId: `city_${settlement.id}_${atStep}`.slice(0, 60),
        kind: "city_taken",
        summary: `${settlement.name}${loserId === null ? "" : `, held by ${polityName(world, loserId)},`} ${delta.sacked ? "was stormed and sacked by" : "passed to"} ${takerId === null ? "no one" : polityName(world, takerId)}${allTaken ? `, and with it ${province.name}` : ""}.`,
        affectedRefs: [
          { kind: "settlement", id: settlement.id },
          { kind: "province", id: province.id },
          ...(takerId === null ? [] : [{ kind: "polity" as const, id: takerId }]),
          ...(loserId === null ? [] : [{ kind: "polity" as const, id: loserId }]),
        ],
        visibility: "public",
        discoveryState: "public",
        knowableInDays: 0,
        significance: 75,
      });
      return taken;
    }

    case "province_control_set": {
      const province = world.map.provinces.find((candidate) => candidate.id === delta.provinceId);
      if (province === undefined) reject(`No province "${delta.provinceId}" exists to change hands.`, "reference");
      const takerId = required(delta.toPolityRef, "The power taking the province");
      if (!world.map.polities.some((polity) => polity.id === takerId)) reject(`No power "${takerId}" exists to hold a province.`, "reference");
      if (province.controllerPolityId === takerId) reject(`${province.name} is already held by ${takerId}.`);

      // Reach, not land contiguity. An army standing in the province has taken
      // it; otherwise the taker must already hold ground next to it across a
      // crossing the map admits -- which is how Sicily is taken from Italy and
      // why Gaul is not taken from Latium.
      const armed = (force: (typeof world.material.forces)[number]): boolean => force.personnel.some((group) => group.fit > 0);
      const standing = world.material.forces.some((force) => force.polityId === takerId && force.locationId === province.id);
      // Ground taken today is not yet ground to take more from: counted as
      // held, one answer of twenty provinces flipped a whole coast from the
      // one province an army stood in.
      const before = new Set((context.batchStart ?? world).map.provinces.filter((candidate) => candidate.controllerPolityId === takerId).map((candidate) => candidate.id));
      const held = new Set(world.map.provinces.filter((candidate) => candidate.controllerPolityId === takerId && candidate.lostBy?.atStep !== atStep && before.has(candidate.id)).map((candidate) => candidate.id));
      const reach = adjacentTo(world, province.id).filter(({ edge }) => crossingAdmitted(world, edge, context.terrains ?? []));
      const nextToHeldGround = reach.some(({ provinceId: touches }) => held.has(touches));
      if (!standing && !nextToHeldGround) {
        reject(`${takerId} has no army in ${province.name} and holds no ground next to it, so it cannot take the province.`);
      }
      // Ground nobody holds is claimed from next door by saying so. Ground
      // another power holds is taken by men: an army in it, or one next to it
      // with nobody of the holder's standing in the way.
      if (!standing && province.controllerPolityId !== null) {
        const near = new Set(reach.map(({ provinceId: touches }) => touches));
        const armyNextDoor = world.material.forces.some((force) => force.polityId === takerId && near.has(force.locationId) && armed(force));
        const defended = world.material.forces.some((force) => force.polityId === province.controllerPolityId && force.locationId === province.id && armed(force));
        if (!armyNextDoor) reject(`${takerId} has no army in ${province.name} or next to it; ground another power holds is taken by men, not by saying so.`);
        if (defended) reject(`${province.name} is held by men of ${province.controllerPolityId}; it is taken by beating them or by a siege, not by saying so.`);
      }

      // Ground taken from a people who never answered to a centre is not held
      // by taking their centre. A conqueror who beats the Boii has beaten the
      // Boii he met; the rest of them have not been beaten and do not know they
      // are conquered. So the looser the power that lost it, the looser the
      // grip on it -- which is Pax Historia's "tribes fiercely resist being
      // conquered" expressed as the number the rest of the engine already reads.
      const loser = world.map.polities.find((polity) => polity.id === province.controllerPolityId);
      const ceiling = loser === undefined ? 10_000 : Math.max(1_000, loser.cohesionBps);
      const firmness = Math.min(delta.firmnessBps, ceiling);

      const taken: WorldState = {
        ...world,
        map: {
          ...world.map,
          provinces: world.map.provinces.map((candidate) =>
            candidate.id === province.id
              ? { ...candidate, ...takenBy(candidate, takerId, world.polityAgreements), controlFirmnessBps: firmness, lostBy: candidate.controllerPolityId === null ? null : { polityId: candidate.controllerPolityId, atStep } }
              : candidate),
        },
      };

      // Ground that changes hands is ground somebody has just been over. The
      // army standing in it takes what the place still has, into its own chest
      // where it has one; taking it damages the province, so the same ground
      // is worth less to whoever takes it next.
      const takingForce = world.material.forces.find(
        (force) => force.polityId === takerId && force.locationId === province.id,
      );
      // Ground nobody held is claimed, not taken: there is no one to plunder.
      const sack = province.controllerPolityId === null
        ? { world: taken }
        : sackTheProvince(taken, {
          provinceId: province.id,
          takerPolityId: takerId,
          takingForceId: takingForce?.id ?? null,
          atStep,
          cause: { kind: "action", id: province.id, explanation: `The taking of ${province.name}` },
          transactionId: context.ids.next("txn"),
        });
      emitFact({
        localId: `province_${province.id}_${atStep}`.slice(0, 60),
        kind: "province_control_change",
        summary: province.controllerPolityId === null
          ? `${polityName(world, takerId)} claimed ${province.name}, which no power had held.`
          : `${province.name}, held by ${polityName(world, province.controllerPolityId)}, passed to ${polityName(world, takerId)}.`,
        affectedRefs: [
          { kind: "province", id: province.id },
          { kind: "polity", id: takerId },
          ...(province.controllerPolityId === null ? [] : [{ kind: "polity" as const, id: province.controllerPolityId }]),
        ],
        visibility: "public",
        discoveryState: "public",
        knowableInDays: 0,
        significance: 70,
      });
      return sack.world;
    }

    case "polity_create": {
      const id = mint("polity", delta.localId);
      if (world.map.polities.some((polity) => polity.name.toLowerCase() === delta.name.toLowerCase())) {
        reject(`A power called "${delta.name}" already exists.`);
      }
      const parentId = delta.breaksFromPolityId === null ? null : required(delta.breaksFromPolityId, "The power it breaks away from");
      const parent = parentId === null ? undefined : world.map.polities.find((polity) => polity.id === parentId);
      if (parentId !== null && parent === undefined) {
        reject(`No power "${parentId}" exists to break away from.`, "reference");
      }

      const taken = delta.provinceIds.map((provinceId) => {
        const province = world.map.provinces.find((candidate) => candidate.id === provinceId);
        if (province === undefined) reject(`No province "${provinceId}" exists for the new power to hold.`, "reference");
        if (parentId !== null && province.controllerPolityId !== parentId) {
          reject(`${province.name} is not held by ${parentId}, so it cannot break away with them.`);
        }
        return province;
      });

      // A rebellion is a piece of a country coming away, not a scatter of
      // unconnected towns. Every province past the first has to touch one of
      // the others across a crossing the map admits.
      const wanted = new Set(taken.map((province) => province.id));
      const reached = new Set([taken[0]!.id]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const edge of world.map.edges) {
          if (!wanted.has(edge.from) || !wanted.has(edge.to)) continue;
          if (reached.has(edge.from) === reached.has(edge.to)) continue;
          if (!crossingAdmitted(world, edge, context.terrains ?? [])) continue;
          reached.add(edge.from);
          reached.add(edge.to);
          grew = true;
        }
      }
      if (reached.size !== wanted.size) reject(`The ground ${delta.name} claims does not hang together.`);

      const capitalSettlementId = delta.capitalSettlementId !== null
        && taken.some((province) => province.settlements.some((settlement) => settlement.id === delta.capitalSettlementId))
        ? delta.capitalSettlementId
        : taken.flatMap((province) => province.settlements)[0]?.id ?? null;

      // At war with what it left. A secession nobody contests is an
      // administrative reform, and the Chronicle has no use for one.
      const war = parentId === null ? [] : [{
        id: context.ids.next("agreement"),
        kind: "war" as const,
        polityId: parentId,
        otherPolityId: id,
        terms: delta.reason,
        sinceStep: atStep,
        untilStep: null,
        sourceMessageId: null,
        status: "active" as const,
        endedAtStep: null,
        endedReason: null,
        visibility: "public" as const,
      }];

      return {
        ...world,
        map: {
          ...world.map,
          polities: [
            ...world.map.polities,
            // A rising holds together by the thing that made it rise, and not
            // much else. It is never tighter than what it broke from, and
            // usually looser: nobody has yet built it a centre.
            // Governed as what it broke from was, until it decides otherwise: a
            // province of a republic rises as a republic, a kingdom's as a kingdom.
            { id, name: delta.name, capitalSettlementId, cohesionBps: Math.min(4_000, parent?.cohesionBps ?? 4_000), soldierPayPerThousand: null, ...(parentId === null ? {} : { governmentForm: constitutionOf(world, parentId)?.form ?? parent?.governmentForm ?? null }) },
          ],
          provinces: world.map.provinces.map((province) =>
            wanted.has(province.id)
              // Ground held by a rising is held loosely, whoever ends up with it.
              ? { ...province, controllerPolityId: id, controlFirmnessBps: 2_000 }
              : province),
        },
        polityAgreements: [...world.polityAgreements, ...war],
      };
    }

    case "belief_set": {
      const holderId = required(delta.holderCharacterRef, "The person who is to believe it");
      if (!world.characters.some((character) => character.id === holderId)) {
        reject(`No character "${holderId}" exists to believe anything.${nearestTo(holderId)}`, "reference");
      }
      const sourceId = delta.sourceCharacterRef === null ? null : required(delta.sourceCharacterRef, "Who they heard it from");
      if (sourceId !== null && !world.characters.some((character) => character.id === sourceId)) {
        reject(`No character "${sourceId}" exists to have told them.${nearestTo(sourceId)}`, "reference");
      }
      const subjectId = delta.subjectRef === null ? null : required(delta.subjectRef, "What it is about");

      // A belief is never checked against reality. That is the whole point of
      // VISION §14: what a person acts on is what they hold to be true, and a
      // planted falsehood has to be as storable as an eyewitness account.
      const belief = {
        id: context.ids.next("belief"),
        holderCharacterId: holderId,
        subjectEntityId: subjectId,
        claim: delta.claim,
        kind: delta.kind,
        sourceCharacterId: sourceId,
        sourceEventId: null,
        confidence: delta.confidence,
        visibility: delta.visibility,
        learnedAtStep: atStep,
        expiresAtStep: null,
        supersedesBeliefIds: [],
        status: "active" as const,
      };
      return { ...world, characterBeliefs: [...world.characterBeliefs, belief] };
    }

    case "authority_grant_upsert": {
      const existingId = delta.grantRef === null ? null : required(delta.grantRef, "The authority grant");
      const base = {
        holder: { ...delta.holder, id: resolve(delta.holder.id) ?? delta.holder.id },
        source: delta.source,
        sourceRef: null,
        domain: delta.domain,
        scope: { ...delta.scope, id: resolve(delta.scope.id) ?? delta.scope.id },
        powers: delta.powers,
        standing: delta.standing,
        legitimacyBps: 10_000,
        visibility: "public" as const,
        grantedAtStep: atStep,
        expiresAtStep: delta.expiresInDays === null ? null : atStep + delta.expiresInDays,
        revokedAtStep: null,
        revocationReason: null,
        succeedsGrantId: null,
      };
      if (existingId !== null) {
        if (!world.authorityGrants.some((grant) => grant.id === existingId)) reject(`No authority grant "${existingId}" exists to change.`, "reference");
        return { ...world, authorityGrants: world.authorityGrants.map((grant) => (grant.id === existingId ? { ...grant, ...base } : grant)) };
      }
      const id = mint("grant", delta.localId);
      return { ...world, authorityGrants: [...world.authorityGrants, { id, ...base }] };
    }

    case "order_attempt_decide": {
      const attemptId = required(delta.orderAttemptRef, "The order");
      const attempt = world.orderAttempts.find((candidate) => candidate.id === attemptId);
      if (attempt === undefined) reject(`No order attempt "${attemptId}" exists to answer.`, "reference");
      // Answered already: deciding it again does nothing, and is nobody's
      // refusal. Refused as the world's, "already been answered" was told to
      // the player and pinned by its words on a new order's parts (E6, M3).
      if (attempt.status !== "received" && attempt.status !== "delayed" && attempt.status !== "issued") return world;
      // An unauthorized order that is nonetheless obeyed is recorded as
      // subversion, never as compliance -- `decideOrderAttempt` enforces this,
      // and it is the difference between a lawful chain of command and a
      // private one.
      const received = attempt.status === "issued" ? receiveOrderAttempt(attempt) : attempt;
      const decided = decideOrderAttempt(received, delta.decision, delta.reason, atStep);

      // A refusal is an event. The person who gave the order will hear of it,
      // and the Chronicle now treats somebody's decision as history even where
      // nothing moved. The model is asked to write its own account of this in
      // the recipient's voice; this guarantees the event exists even when it
      // does not, which is how it was possible for an order to be refused and
      // for nobody, anywhere, to learn that it had been.
      if (decided.status === "refused" || decided.status === "ignored" || decided.status === "subverted") {
        const who = (ref: typeof decided.issuerRef): string => world.characters.find((character) => character.id === ref.id)?.name ?? ref.id;
        const verb = decided.status === "refused" ? "would not do as" : decided.status === "ignored" ? "gave no answer to" : "seemed to agree with, and did otherwise than";
        const subverted = decided.status === "subverted";
        emitFact({
          localId: `order_${attemptId}`,
          kind: `order_${decided.status}`,
          summary: `${who(decided.recipientRef)} ${verb} ${who(decided.issuerRef)} asked: ${delta.reason}`.slice(0, 600),
          affectedRefs: [decided.issuerRef, decided.recipientRef],
          visibility: subverted ? "private" : "polity",
          discoveryState: subverted ? "private" : "polity",
          knowableInDays: 0,
          knownToRefs: subverted ? [decided.recipientRef] : [decided.issuerRef, decided.recipientRef],
          // A legate defying a consul is a headline. A declined request joins
          // its thread without becoming one.
          significance: subverted ? 60 : attempt.standing === "binding" ? 55 : 40,
        });
      }
      // Answering somebody changes what they think of you, and what you think
      // of them. `applySocialEvents` has been able to write a relation cause
      // since the character system was built and nothing in the simulation
      // ever handed it one, so every NPC's view of the player was still the
      // single seed written at creation, step zero, in every save in the
      // database. An order answered is the commonest thing two people do to
      // each other here, so it is where the loop closes.
      const answered = orderAnswerCauses(world, decided, attempt.standing);
      const socially = answered.length === 0 ? world : applySocialEvents(
        world,
        [CharacterSocialEventSchema.parse({
          id: context.ids.next("social"),
          gameId: context.gameId,
          sourceTurnId: null, sourceSessionId: null, sourceMessageId: null,
          participantCharacterIds: [decided.issuerRef.id, decided.recipientRef.id],
          kind: decided.status === "accepted" ? "favour" : decided.status === "subverted" ? "deception" : "conversation",
          // A subversion is known to the man doing it and to nobody else --
          // which is exactly why it is worth doing.
          visibility: decided.status === "subverted" ? "private" : "polity",
          knownByCharacterIds: decided.status === "subverted"
            ? [decided.recipientRef.id]
            : [decided.issuerRef.id, decided.recipientRef.id],
          relationCauses: answered,
          observedTraits: [],
          knowledgeClaims: [], proposedBeliefs: [], pressureChanges: [],
          commitmentProposal: null, introducedCharacter: null, introducedProfile: null,
          createdAtStep: atStep, appliedAtStep: null, appliedInTurnId: null,
          status: "proposed", rejectionReason: null,
        })],
        atStep,
        context.ids.next("social-batch"),
      ).world;

      // A man who defied another and got away with it is a little bolder for it.
      const emboldened = (decided.status === "refused" || decided.status === "subverted") && decided.recipientRef.kind === "character"
        ? teach(socially, decided.recipientRef.id, "defied", atStep)
        : socially;
      return { ...emboldened, orderAttempts: emboldened.orderAttempts.map((candidate) => (candidate.id === attemptId ? decided : candidate)) };
    }

    case "social_events": {
      // Routed through the character system's own `applySocialEvents` rather
      // than reimplemented here: relationships, beliefs, pressures and
      // commitments have one applier, whether the cause was a conversation or
      // the world at large.
      const events = delta.events.map((draft) => {
        const participants = draft.participantCharacterRefs.map((ref, index) => required(ref, `Participant ${index + 1}`));
        for (const participantId of participants) {
          if (!world.characters.some((character) => character.id === participantId)) {
            reject(`No character "${participantId}" exists to take part in this.${nearestTo(participantId)}`, "reference");
          }
        }
        return CharacterSocialEventSchema.parse({
          id: context.ids.next("social"),
          gameId: context.gameId,
          sourceTurnId: null,
          sourceSessionId: null,
          sourceMessageId: null,
          participantCharacterIds: participants,
          kind: draft.kind,
          visibility: draft.visibility,
          knownByCharacterIds: participants,
          // These were both hardcoded empty, so a social event changed
          // nobody's opinion of anybody and nobody's character ever moved --
          // which is the whole of what a social event is for.
          relationCauses: draft.relationCauses.map((cause) => ({
            subjectCharacterId: required(cause.subjectCharacterRef, "Whose view of them this is"),
            targetCharacterId: required(cause.targetCharacterRef, "Who they are forming a view of"),
            label: cause.label,
            score: cause.score,
            decayPerYearBps: cause.decayPerYearBps,
            ...(cause.dimensions === undefined ? {} : { dimensions: cause.dimensions }),
          })),
          observedTraits: draft.observedTraits.map((observed) => ({
            subjectCharacterId: required(observed.subjectCharacterRef, "Whose character this is"),
            observerCharacterId: required(observed.observerCharacterRef, "Who is judging"),
            traitId: observed.traitId,
            note: observed.note,
          })),
          knowledgeClaims: [],
          proposedBeliefs: [],
          pressureChanges: [],
          commitmentProposal: null,
          introducedCharacter: null,
          introducedProfile: null,
          createdAtStep: atStep,
          appliedAtStep: null,
          appliedInTurnId: null,
          status: "proposed",
          rejectionReason: null,
        });
      });

      const outcome = applySocialEvents(world, events, atStep, context.ids.next("social-batch"));
      const refused = outcome.rejectedIds[0];
      if (refused !== undefined) reject(refused.reason);
      // A trait becoming true is a thing people notice about somebody, and the
      // second person to say it is what made it so. Recorded publicly: this is
      // reputation, which is by definition what others hold.
      for (const confirmed of outcome.traitsConfirmed) {
        const who = world.characters.find((character) => character.id === confirmed.characterId)?.name ?? confirmed.characterId;
        const label = TRAIT_REGISTRY[confirmed.traitId]?.label ?? confirmed.traitId;
        emitFact({
          localId: `trait_${confirmed.characterId}_${confirmed.traitId}`,
          kind: "reputation",
          summary: `${who} has a name now for being ${label.toLowerCase()}, and more than one person has said so.`,
          affectedRefs: [{ kind: "character", id: confirmed.characterId }],
          visibility: "public",
          discoveryState: "public",
          knowableInDays: 0,
          // Somebody's reputation settling is a quiet thing, and real.
          significance: 35,
        });
      }
      for (const lost of outcome.traitsLost) {
        const who = world.characters.find((character) => character.id === lost.characterId)?.name ?? lost.characterId;
        emitFact({
          localId: `trait_lost_${lost.characterId}_${lost.traitId}`,
          kind: "reputation",
          summary: `${who} is no longer thought ${(TRAIT_REGISTRY[lost.traitId]?.label ?? lost.traitId).toLowerCase()}: people have seen him be ${(TRAIT_REGISTRY[lost.contradictedBy]?.label ?? lost.contradictedBy).toLowerCase()}.`,
          affectedRefs: [{ kind: "character", id: lost.characterId }],
          visibility: "public",
          discoveryState: "public",
          knowableInDays: 0,
          significance: 35,
        });
      }
      return outcome.world;
    }
  }
}

/**
 * A new office in a government, made because somebody is being put in it.
 *
 * Both doors into an office come here -- a person created holding one, and a
 * person seated in one -- so that "the Senate names a tribune" and "a tribune
 * is created" cannot make two different kinds of tribune.
 */
function openOffice(world: WorldState, officeId: string, label: string, polityId: string, authorises: readonly string[]): WorldState {
  return {
    ...world,
    offices: [...world.offices, {
      id: officeId,
      label,
      polityId,
      // What the name of the office means, with whatever the caller said on
      // top of it. Asked to state the powers, the model has never once
      // done so -- every office the world has made came back authorising
      // nothing, which is a title rather than an office and leaves the man
      // it was created for in breach of it the first time he acts.
      authorisedActionIds: deriveOfficeActions(label, [...authorises]),
      sponsorableCategories: [],
      treasuryAccountId: null,
      treasuryPermissions: [],
      incomeSourceId: null,
      expectedBlocId: null,
      successionRuleId: "appointed-by-the-government",
      eligibilityRequirementIds: [],
    }],
  };
}

/**
 * The skills the world described, as numbers the engine chose.
 *
 * A band the world did not mention keeps what the canonical defaults gave --
 * an ordinary person -- so describing a general as a gifted soldier does not
 * also make him a gifted poet.
 */
function skillsFromBands(
  skills: WorldState["characters"][number]["skills"],
  bands: Extract<WorldDelta, { op: "character_create" }>["skills"],
): WorldState["characters"][number]["skills"] {
  if (bands == null) return skills;
  const next = { ...skills };
  for (const key of ["martial", "diplomacy"] as const) {
    const band = bands[key];
    if (band !== undefined) next[key] = SKILL_BY_BAND[band];
  }
  return next;
}

type TreatyClause = NonNullable<Extract<WorldDelta, { op: "agreement_open" }>["clauses"]>[number];

/**
 * A treaty's clauses, done.
 *
 * - An indemnity is owed from one party's treasury to the other's, period by
 *   period, for as many periods as were agreed. It falls into arrears like any
 *   debt, which is what makes a broken treaty something the world can see.
 * - A province ceded changes hands, held firmly: it was given, not taken.
 * - A hostage goes to live where the power holding him has its seat.
 *
 * A clause between powers who are not both parties to it, or about ground
 * neither of them holds, is refused: a treaty binds the two who made it.
 */
/**
 * An army a peace's words put into the other side's service, where no clause
 * says so: "the Campanian legion serves as a punitive legion for ten years,
 * maintained by Rome" was written as terms alone, and the legion stayed with
 * the Campanians. Only a force named in the terms, beside words of service.
 */
export function servesInTerms(world: WorldState, terms: string, partyId: string, otherPartyId: string, clauses: readonly TreatyClause[]): TreatyClause[] {
  if (!/\b(serv(e|es|ed|ing|ice)|enlist\w*|taken into|enters?|pass(es)? (in)?to)\b/i.test(terms)) return [];
  const words = (text: string): string[] => text.toLowerCase().split(/[^\p{L}]+/u).filter((word) => word.length > 3 && !["legion", "army", "force", "host", "company", "field"].includes(word));
  const said = new Set(words(terms).map((word) => word.slice(0, 6)));
  return world.material.forces
    .filter((force) => force.polityId === partyId || force.polityId === otherPartyId)
    .filter((force) => !clauses.some((clause) => clause.kind === "force_transfer" && clause.forceRef === force.id))
    .filter((force) => {
      const own = words(force.name.replace(/\bof\b.*$/i, ""));
      // Its name, and then within a few words the service: "the Campanian
      // legion serves", not a Roman army merely named beside it.
      return own.length > 0 && own.every((word) => said.has(word.slice(0, 6)))
        && new RegExp(`${own.at(-1)!.slice(0, 6)}\\p{L}*\\s+(\\S+\\s+){0,4}(serv|enlist|enter|pass|taken)`, "iu").test(terms);
    })
    .slice(0, 2)
    .map((force) => ({ kind: "force_transfer" as const, forceRef: force.id, toPolityId: force.polityId === partyId ? otherPartyId : partyId }));
}

function carryOutClauses(
  world: WorldState,
  clauses: readonly TreatyClause[],
  agreementId: string,
  partyId: string,
  otherPartyId: string,
  required: (ref: string, label: string) => string,
  context: ApplyContext,
  emitFact: (fact: FactProposalDraft) => void,
  sourceMessageId: string | null = null,
): WorldState {
  const parties = new Set([partyId, otherPartyId]);
  const otherOf = (id: string): string => (id === partyId ? otherPartyId : partyId);
  const treasuryOf = (polityId: string) => world.material.accounts.find((account) => account.owner.kind === "polity" && account.owner.id === polityId && account.status === "active");
  const name = (id: string): string => world.map.polities.find((polity) => polity.id === id)?.name ?? id;
  let next = world;
  for (const clause of clauses) {
    if (clause.kind === "indemnity") {
      const payerId = required(clause.payerPolityId, "The power paying the indemnity");
      if (!parties.has(payerId)) reject(`${name(payerId)} is not party to this treaty and cannot be bound to pay under it.`, "reference");
      const from = treasuryOf(payerId);
      const to = treasuryOf(otherOf(payerId));
      if (from === undefined || to === undefined) reject(`An indemnity needs a treasury on each side; ${from === undefined ? name(payerId) : name(otherOf(payerId))} keeps none.`, "reference");
      next = {
        ...next,
        material: {
          ...next.material,
          obligations: [...next.material.obligations, {
            id: context.ids.next("obligation"),
            kind: "tribute" as const,
            label: `Indemnity owed by ${name(payerId)} to ${name(otherOf(payerId))}`.slice(0, 120),
            payerAccountId: from.id,
            recipientAccountId: to.id,
            amount: clause.amount,
            cadenceSteps: clause.cadenceDays,
            nextDueStep: next.elapsedStep + clause.cadenceDays,
            priority: 450,
            arrears: 0,
            missedPeriods: 0,
            active: true,
            consequenceRef: agreementId,
            remainingPeriods: clause.periods,
          }],
        },
      };
      continue;
    }
    if (clause.kind === "cession") {
      const toId = required(clause.toPolityId, "The power the province is ceded to");
      const province = next.map.provinces.find((candidate) => candidate.id === clause.provinceId);
      if (province === undefined) reject(`No province "${clause.provinceId}" exists to be ceded.`, "reference");
      // Ceded by whoever owns it: occupied ground is still its owner's to give.
      const giver = ownerOf(province);
      if (!parties.has(toId) || giver === null || !parties.has(giver) || giver === toId) {
        reject(`${province.name} is not ${name(otherOf(toId))}'s to cede to ${name(toId)} under this treaty.`);
      }
      next = {
        ...next,
        map: {
          ...next.map,
          provinces: next.map.provinces.map((candidate) => (candidate.id === province.id
            ? {
              ...candidate,
              controllerPolityId: toId,
              ownerPolityId: null,
              controlFirmnessBps: 6_000,
              settlements: candidate.settlements.map((settlement) => (settlement.controllerPolityId === province.controllerPolityId || settlement.controllerPolityId === giver ? { ...settlement, controllerPolityId: toId } : settlement)),
              // Its people were not asked, and remember who they belonged to.
              yearning: { polityId: giver!, bps: 3_000, updatedAtStep: next.elapsedStep },
              lostBy: null,
            }
            : candidate)),
        },
      };
      emitFact({
        localId: `ceded_${province.id}`.slice(0, 60),
        kind: "province_ceded",
        summary: `${province.name} was ceded to ${name(toId)} by treaty.`,
        affectedRefs: [{ kind: "province", id: province.id }, { kind: "polity", id: toId }, { kind: "polity", id: otherOf(toId) }],
        visibility: "public",
        discoveryState: "public",
        knowableInDays: 0,
        significance: 70,
      });
      continue;
    }
    // An army handed over by the treaty: the peace made with the Campanians
    // of Rhegium put their legion into ten years of Roman service, and the
    // legion stayed Decius's -- the order waiting for it could never begin.
    if (clause.kind === "force_transfer") {
      const toId = required(clause.toPolityId, "The power the army passes to");
      const forceId = required(clause.forceRef, "The army handed over");
      const force = next.material.forces.find((candidate) => candidate.id === forceId);
      if (force === undefined) reject(`No force "${forceId}" exists to be handed over.`, "reference");
      if (!parties.has(toId) || !parties.has(force.polityId) || force.polityId === toId) reject(`${force.name} is not ${name(otherOf(toId))}'s to hand to ${name(toId)} under this treaty.`);
      // Who takes it: the man on the receiving side who wrote the terms,
      // else that power's head.
      const letter = sourceMessageId === null ? undefined : next.diplomacy.find((message) => message.id === sourceMessageId);
      const writers = letter === undefined ? [] : [letter.fromCharacterId, letter.toCharacterId];
      const government = { offices: context.offices, successionRules: context.successionRules ?? [] };
      const receiver = writers.map((id) => next.characters.find((character) => character.id === id && character.alive && character.polityId === toId)).find((character) => character !== undefined)
        ?? rulerOf(next, toId, government) ?? null;
      next = {
        ...next,
        material: {
          ...next.material,
          forces: next.material.forces.map((candidate) => candidate.id !== force.id ? candidate : {
            ...candidate,
            polityId: toId,
            controllerCharacterId: receiver?.id ?? candidate.controllerCharacterId,
            commanderCharacterId: receiver?.id ?? candidate.commanderCharacterId,
          }),
        },
      };
      emitFact({
        localId: `handed_over_${force.id}`.slice(0, 60),
        kind: "force_handed_over",
        summary: `By the treaty, ${force.name} passed into the service of ${name(toId)}${receiver === null ? "" : `, under ${receiver.name}`}.`.slice(0, 600),
        affectedRefs: [{ kind: "force", id: force.id }, { kind: "polity", id: toId }, { kind: "polity", id: otherOf(toId) }, ...(receiver === null ? [] : [{ kind: "character" as const, id: receiver.id }])],
        visibility: "public",
        discoveryState: "public",
        knowableInDays: 0,
        significance: 55,
      });
      continue;
    }
    if (clause.kind === "submission") {
      const submitting = required(clause.polityId, "The power surrendering");
      const to = required(clause.toPolityId, "The power it surrenders to");
      if (!parties.has(submitting) || !parties.has(to) || submitting === to) reject(`${name(submitting)} can only give itself up to the other party to this treaty.`, "reference");
      // A power gives itself up to a power that has beaten it, and to no other.
      const accepted = world.diplomacy.find((message) => message.id === sourceMessageId && message.answer === "accepted"
        && parties.has(message.fromPolityId) && parties.has(message.toPolityId)
        && message.clauses?.some((offered) => offered.kind === "submission" && offered.polityId === clause.polityId && offered.toPolityId === clause.toPolityId));
      if (accepted === undefined && !warStanding(next, to, submitting).dictates) reject(`${name(submitting)} has not been beaten by ${name(to)}, and will not give itself up to it.`);
      // Asked by letter and never fought over: a union, not a surrender.
      const fought = next.polityAgreements.some((agreement) => agreement.kind === "war"
        && ((agreement.polityId === to && agreement.otherPolityId === submitting) || (agreement.polityId === submitting && agreement.otherPolityId === to)));
      const ended = endPolity(next, submitting, "absorbed", to, next.elapsedStep, accepted !== undefined && !fought);
      next = ended.world;
      for (const fact of ended.facts) emitFact(fact);
      continue;
    }
    if (clause.kind === "undertaking") {
      const by = required(clause.byPolityId, "The power taking it on");
      if (!parties.has(by)) reject(`${name(by)} is not party to this treaty and takes nothing on under it.`, "reference");
      const government = { offices: context.offices, successionRules: context.successionRules ?? [] };
      // A garrison can negotiate through its named commander without having
      // a constitutional ruler. Keep the people who signed, before surrender
      // dissolves its offices and changes their polity.
      const instrument = world.diplomacy.find((message) => message.id === sourceMessageId && message.answer === "accepted");
      const representativeOf = (polityId: string) => {
        const id = instrument?.fromPolityId === polityId ? instrument.fromCharacterId : instrument?.toPolityId === polityId ? instrument.toCharacterId : null;
        return world.characters.find((character) => character.id === id && character.alive && character.polityId === polityId) ?? null;
      };
      const promisor = rulerOf(world, by, government) ?? representativeOf(by);
      const beneficiary = rulerOf(world, otherOf(by), government) ?? representativeOf(otherOf(by));
      if (promisor === null || beneficiary === null) reject(`An undertaking is somebody's word: ${promisor === null ? name(by) : name(otherOf(by))} has nobody at its head to give or take it.`, "reference");
      next = {
        ...next,
        commitments: [...next.commitments, {
          id: context.ids.next("commitment"),
          promisorCharacterId: promisor.id,
          beneficiaryCharacterId: beneficiary.id,
          actionKind: clause.duty,
          description: `Under the treaty: ${clause.what}`.slice(0, 400),
          conditions: "",
          form: "do" as const,
          requiredOfficeId: null,
          requiredResource: null,
          visibility: "public" as const,
          sourceEventId: agreementId,
          breachPressureKind: "political_danger" as const,
          status: "pending" as const,
          createdAtStep: next.elapsedStep,
          reviewAtStep: next.elapsedStep + clause.withinDays,
          resolvedAtStep: null,
          resolutionReason: null,
        }],
      };
      continue;
    }
    const hostageId = required(clause.characterRef, "The hostage");
    const heldById = required(clause.heldByPolityId, "The power holding the hostage");
    const hostage = next.characters.find((character) => character.id === hostageId && character.alive);
    if (hostage === undefined) reject(`No living person "${hostageId}" exists to be given as a hostage.`, "reference");
    if (!parties.has(heldById)) reject(`${name(heldById)} is not party to this treaty and holds no hostages under it.`, "reference");
    const capital = next.map.polities.find((polity) => polity.id === heldById)?.capitalSettlementId;
    const seat = next.map.provinces.find((province) => province.settlements.some((settlement) => settlement.id === capital))?.id ?? hostage.locationProvinceId;
    next = {
      ...next,
      characters: next.characters.map((character) => (character.id === hostageId
        ? {
          ...character,
          locationProvinceId: seat,
          disqualifyingStatuses: character.disqualifyingStatuses.includes("hostage") ? character.disqualifyingStatuses : [...character.disqualifyingStatuses, "hostage"].slice(0, 8),
        }
        : character)),
    };
  }
  return next;
}

/** Of a price, the share a buyer must have in hand to be given the rest on credit. */
const DEPOSIT_SHARE = 0.25;
/** What credit from a seller costs a month, in basis points of what is owed. */
const SELLER_CREDIT_BPS = 100;

/**
 * Money moving because an act moved it, and the line in the books that says so.
 *
 * Every balance this file changed, it changed by hand and wrote nothing down:
 * a shipmaster's 900 paid down, a thousand spent from a consul's purse to buy
 * votes, a loan's principal -- the purse was lighter and nothing anywhere said
 * why. The books are what an audit reads, what a promise is checked against,
 * and what the player's ledger shows; a sum that left no line there left the
 * world unexplained. So a sum moves only through here. `from` or `to` null is
 * money leaving or entering the modelled world.
 */
/**
 * Siege works raised at a siege: each paid for from the besiegers' power, at
 * so much for every thousand men, and ready when its days are done. One of a
 * kind at a time -- a second set of rams is the first set, rebuilt only if
 * the first was burned.
 */
function raiseWorks(
  world: WorldState,
  siege: WorldState["sieges"][number],
  force: Force,
  kinds: readonly SiegeWorkKind[],
  atStep: number,
  context: ApplyContext,
  emitFact: (fact: FactProposalDraft) => void,
): WorldState {
  const wanted = [...new Set(kinds)].filter((kind) => !siege.works.some((work) => work.kind === kind && work.status !== "burned"));
  if (wanted.length === 0) return world;
  const thousands = Math.max(1, force.personnel.reduce((sum, group) => sum + group.fit, 0) / 1_000);
  const cost = Math.round(wanted.reduce((sum, kind) => sum + SIEGE_WORKS[kind].costPerThousand * thousands, 0));
  const treasury = world.material.accounts.find((account) => account.owner.kind === "polity" && account.owner.id === force.polityId);
  if (treasury === undefined) reject(`${force.name}'s power keeps no treasury to pay for siege works.`, "reference");
  if (treasury.balance < cost) reject(`The works would cost ${cost}, and ${treasury.id} holds ${treasury.balance}.`);
  const paid = moveMoney(world, { from: treasury.id, to: null, amount: cost, kind: "purchase", causeId: siege.id, explanation: `Siege works before the city: ${wanted.map((kind) => SIEGE_WORKS[kind].label).join(", ")}.` }, context);
  const place = world.map.provinces.find((province) => province.id === siege.provinceId)?.name ?? siege.provinceId;
  emitFact({
    localId: `works_${siege.id}_${atStep}`.slice(0, 60),
    kind: "siege_event",
    summary: `${force.name} began raising ${wanted.map((kind) => SIEGE_WORKS[kind].label).join(" and ")} before ${place}.`,
    affectedRefs: [{ kind: "force", id: force.id }, { kind: "province", id: siege.provinceId }],
    visibility: "public",
    discoveryState: "public",
    knowableInDays: 0,
    significance: 40,
  });
  return {
    ...paid,
    sieges: paid.sieges.map((candidate) => (candidate.id !== siege.id ? candidate : {
      ...candidate,
      works: [...candidate.works.filter((work) => !wanted.includes(work.kind)), ...wanted.map((kind) => ({ kind, readyAtStep: atStep + SIEGE_WORKS[kind].days, status: "building" as const }))].slice(-8),
    })),
  };
}

interface Movement {
  readonly from: string | null;
  readonly to: string | null;
  readonly amount: number;
  readonly kind: MoneyTransaction["kind"];
  /** What moved it: the contract, the loan, the project -- or the act's own handle. */
  readonly causeId: string;
  readonly explanation: string;
  /** Who may read the line. The paying account's own, by default. */
  readonly visibility?: MoneyTransaction["visibility"];
}

function moveMoney(world: WorldState, movement: Movement, context: ApplyContext): WorldState {
  if (movement.amount <= 0 || (movement.from === null && movement.to === null) || movement.from === movement.to) return world;
  const accounts = world.material.accounts.map((account) => {
    if (account.id === movement.from) return { ...account, balance: account.balance - movement.amount };
    if (account.id === movement.to) return { ...account, balance: account.balance + movement.amount };
    return account;
  });
  const holder = world.material.accounts.find((account) => account.id === (movement.from ?? movement.to));
  const transaction: MoneyTransaction = {
    id: context.ids.next("txn"),
    atStep: world.elapsedStep,
    kind: movement.kind,
    amount: movement.amount,
    ...(movement.from === null ? {} : { sourceAccountId: movement.from }),
    ...(movement.to === null ? {} : { destinationAccountId: movement.to }),
    cause: { kind: "action", id: movement.causeId.slice(0, 120), explanation: (movement.explanation.trim() || "An act of this turn.").slice(0, 240) },
    visibility: movement.visibility ?? holder?.visibility ?? "polity",
  };
  return { ...world, material: { ...world.material, accounts, transactions: [...world.material.transactions, transaction] } };
}

/**
 * Whatever an act moved that no line records, recorded.
 *
 * `moveMoney` is the way a sum moves; this is the check that nothing went
 * round it -- a handler written tomorrow, a helper in another file that
 * touches a balance. Each account's change, less what the act's own lines
 * already say, is written down against the act, paired payer to payee where
 * the one sum plainly went to the other. An account the act opened is left
 * out: its first balance is an endowment, not a movement.
 */
function recordUnrecordedMoney(before: WorldState, after: WorldState, delta: WorldDelta, context: ApplyContext): WorldState {
  const earlier = new Map(before.material.accounts.map((account) => [account.id, account.balance]));
  const known = new Set(before.material.transactions.map((transaction) => transaction.id));
  const written = new Map<string, number>();
  for (const transaction of after.material.transactions) {
    if (known.has(transaction.id)) continue;
    if (transaction.sourceAccountId !== undefined) written.set(transaction.sourceAccountId, (written.get(transaction.sourceAccountId) ?? 0) - transaction.amount);
    if (transaction.destinationAccountId !== undefined) written.set(transaction.destinationAccountId, (written.get(transaction.destinationAccountId) ?? 0) + transaction.amount);
  }
  const unexplained = after.material.accounts.flatMap((account) => {
    const was = earlier.get(account.id);
    if (was === undefined) return [];
    const change = account.balance - was - (written.get(account.id) ?? 0);
    return change === 0 ? [] : [{ id: account.id, change }];
  });
  if (unexplained.length === 0) return after;
  const causeId = ("localId" in delta && typeof delta.localId === "string" ? delta.localId : delta.op).slice(0, 120);
  const explanation = ("reason" in delta && typeof delta.reason === "string" ? delta.reason : delta.op).slice(0, 240);
  const payers = unexplained.filter((entry) => entry.change < 0).map((entry) => ({ id: entry.id, left: -entry.change }));
  const payees = unexplained.filter((entry) => entry.change > 0).map((entry) => ({ id: entry.id, left: entry.change }));
  const lines: MoneyTransaction[] = [];
  const line = (from: string | null, to: string | null, amount: number): void => {
    const holder = after.material.accounts.find((account) => account.id === (from ?? to));
    lines.push({
      id: context.ids.next("txn"), atStep: after.elapsedStep, kind: "transfer", amount,
      ...(from === null ? {} : { sourceAccountId: from }), ...(to === null ? {} : { destinationAccountId: to }),
      cause: { kind: "action", id: causeId, explanation: explanation.trim() || delta.op }, visibility: holder?.visibility ?? "polity",
    });
  };
  for (const payer of payers) {
    for (const payee of payees) {
      if (payer.left === 0) break;
      const amount = Math.min(payer.left, payee.left);
      if (amount === 0) continue;
      line(payer.id, payee.id, amount);
      payer.left -= amount;
      payee.left -= amount;
    }
    if (payer.left > 0) line(payer.id, null, payer.left);
  }
  for (const payee of payees) if (payee.left > 0) line(null, payee.id, payee.left);
  return { ...after, material: { ...after.material, transactions: [...after.material.transactions, ...lines] } };
}

/**
 * Paying a price, in full if the money is there and on credit if a quarter of
 * it is.
 *
 * A price that could not be met in full was refused in full, so the only way
 * to buy land was to already have all of it in hand -- which is not how land,
 * or anything else, was ever bought. Below the deposit it is still refused;
 * above it the seller carries the rest as an ordinary debt, served monthly,
 * pledged against what was bought where it can be, and unpaid in the same
 * arrears as any other.
 */
export function payOrBorrow(
  world: WorldState,
  payerId: string,
  price: number,
  what: string,
  pledgedHoldingId: string | null,
  context: ApplyContext,
  emitFact: (fact: FactProposalDraft) => void,
): WorldState {
  const payer = world.material.accounts.find((account) => account.id === payerId);
  if (payer === undefined) reject(`No account "${payerId}" exists to pay for ${what}.`, "reference");
  if (payer.balance >= price) {
    return moveMoney(world, { from: payerId, to: null, amount: price, kind: "purchase", causeId: pledgedHoldingId ?? payerId, explanation: `Bought: ${what}` }, context);
  }
  const deposit = Math.ceil(price * DEPOSIT_SHARE);
  if (payer.balance < deposit) {
    reject(`${what} costs ${price}; ${payerId} holds ${payer.balance}, and nobody sells on credit without ${deposit} down.`);
  }
  const down = payer.balance;
  const owed = price - down;
  const loanId = context.ids.next("loan");
  const serviceId = context.ids.next("obligation");
  const atStep = world.elapsedStep;
  emitFact({
    localId: `credit_${loanId}`.slice(0, 60),
    kind: "bought_on_credit",
    summary: `${what} was bought for ${price}: ${down} paid down, and ${owed} owed to the seller at interest.`,
    affectedRefs: [{ kind: "account", id: payerId }],
    visibility: "polity",
    discoveryState: "polity",
    knowableInDays: 0,
    significance: 25,
  });
  const paidDown = moveMoney(world, { from: payerId, to: null, amount: down, kind: "purchase", causeId: loanId, explanation: `Paid down on ${what}` }, context);
  return {
    ...paidDown,
    material: {
      ...paidDown.material,
      obligations: [...paidDown.material.obligations, {
        id: serviceId,
        kind: "debt_service" as const,
        label: `Repayment of credit for ${what}`.slice(0, 120),
        payerAccountId: payerId,
        amount: loanInstalment(owed, SELLER_CREDIT_BPS, LOAN_TERM_PERIODS),
        cadenceSteps: 30,
        nextDueStep: atStep + 30,
        priority: 400,
        arrears: 0,
        missedPeriods: 0,
        active: true,
        remainingPeriods: LOAN_TERM_PERIODS,
      }],
      loans: [...paidDown.material.loans, {
        id: loanId,
        lenderKind: "foreign" as const,
        lenderId: null,
        borrowerAccountId: payerId,
        principal: owed,
        outstanding: owed,
        interestBps: SELLER_CREDIT_BPS,
        cadenceSteps: 30,
        serviceObligationId: serviceId,
        terms: `Credit from the seller on ${what}`.slice(0, 300),
        collateralHoldingId: pledgedHoldingId,
        status: "active" as const,
        openedAtStep: atStep,
      }],
    },
  };
}

/**
 * How much of a province one raid strips, in basis points of what is left.
 *
 * Men times how fast they move: a raid is what can be carried off before the
 * country rises, so horse strip more than foot. A hundred horsemen take a few
 * per cent of a province; a legion on the loose takes a quarter, and never
 * more, because a raid that took everything would be a conquest.
 */
function raidShareBps(force: WorldState["material"]["forces"][number], rules: ScenarioWarfareRules): number {
  const reach = force.personnel.reduce((sum, category) => {
    const mobility = rules.troopCategories.find((definition) => definition.id === category.categoryId)?.mobilityBps ?? 5_000;
    return sum + category.fit * (mobility / 5_000);
  }, 0);
  return Math.max(0, Math.min(2_500, Math.round(reach * 1.5)));
}

/**
 * Who pays a made thing's keep, as the world will store it. An account that
 * does not exist is refused as a malformed reference: a keep nobody can pay
 * would lapse on its first month and look, to the player, like the world
 * breaking what they built.
 */
function upkeepFrom(
  world: WorldState,
  upkeep: { readonly fromAccountRef: string; readonly band: "slight" | "marked" | "great" } | null | undefined,
  required: (ref: string, what: string) => string,
): { fromAccountId: string; band: "slight" | "marked" | "great" } | null {
  if (upkeep == null) return null;
  const fromAccountId = required(upkeep.fromAccountRef, "The account that pays its keep");
  if (!world.material.accounts.some((account) => account.id === fromAccountId)) reject(`No account "${fromAccountId}" exists to pay for its keep.`, "reference");
  return { fromAccountId, band: upkeep.band };
}

/**
 * What it costs to set going something that pays its owner.
 *
 * An arrangement could be made with an income effect and no keep, and then
 * paid its owner a share of the province every month for nothing -- a better
 * business than any venture or estate, because it had no price. A thing that
 * pays now costs what a venture of the same yield costs, in months of what it
 * clears, and is kept at a cost from its owner's account unless somebody else
 * was named to keep it. Paid down or bought on credit, like any other venture.
 *
 * `before` is what the thing already did, for an update: only the difference
 * is paid for.
 */
function priceTheYield(
  world: WorldState,
  before: { readonly effects: readonly StandingEffect[]; readonly upkeep: { readonly band: EffectBand } | null } | null,
  after: {
    readonly provinceId: string | null;
    readonly ownerRef: { readonly kind: string; readonly id: string } | null;
    readonly effects: readonly StandingEffect[];
    readonly upkeep: { fromAccountId: string; band: EffectBand } | null;
  },
  label: string,
  context: ApplyContext,
  emitFact: (fact: FactProposalDraft) => void,
): { world: WorldState; upkeep: { fromAccountId: string; band: EffectBand } | null } {
  const yields = after.effects.filter((effect) => effect.quantity === "income" && effect.direction === "raise");
  const ownerAccount = after.ownerRef === null ? null : accountOf(world, after.ownerRef.id);
  // Nobody to be paid, nothing to pay for: its income goes nowhere.
  if (yields.length === 0 || ownerAccount === null) return { world, upkeep: after.upkeep };
  const BANDS: readonly EffectBand[] = ["slight", "marked", "great"];
  const strongest = yields.reduce<EffectBand>((band, effect) => (BANDS.indexOf(effect.band) > BANDS.indexOf(band) ? effect.band : band), "slight");
  const upkeep = after.upkeep ?? { fromAccountId: ownerAccount, band: strongest };
  const clears = arrangementNetIncome(world, { provinceId: after.provinceId, ownerRef: after.ownerRef, effects: after.effects, upkeepBand: upkeep.band });
  const cleared = before === null ? 0 : Math.max(0, arrangementNetIncome(world, { provinceId: after.provinceId, ownerRef: after.ownerRef, effects: before.effects, upkeepBand: before.upkeep?.band ?? null }));
  const added = clears - cleared;
  if (added <= 0) return { world, upkeep };
  return { world: payOrBorrow(world, upkeep.fromAccountId, added * VENTURE_PRICE_MONTHS, label, null, context, emitFact), upkeep };
}

/**
 * Faiths a made thing preaches, founded as they are named, so a church
 * founded this turn is listed with its faith this turn and not a month later.
 */
function foundFaithsOf(world: WorldState, effects: readonly { readonly quantity: string; readonly faith?: string | undefined }[], atStep: number, founderId: string | null): WorldState {
  let next = world;
  for (const effect of effects) {
    if (effect.quantity === "conversion" && effect.faith !== undefined) next = faithNamed(next, effect.faith, atStep, founderId).world;
  }
  return next;
}

function clampSkill(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function actorPolityOf(world: WorldState, context: ApplyContext): string | null {
  if (context.actorRef.kind === "polity") return context.actorRef.id;
  if (context.actorRef.kind !== "character") return null;
  return world.characters.find((character) => character.id === context.actorRef.id)?.polityId ?? null;
}

/** Opens an empty fund for any arrangement this act pays from or into that has none and no owner to pay for it. */
function openFundsNamedIn(delta: WorldDelta, world: WorldState, resolve: (ref: string) => string | undefined): WorldState {
  let next = world;
  const visit = (node: unknown, key: string): void => {
    if (typeof node === "string") {
      if (!/account/i.test(key)) return;
      const id = node.startsWith("local:") ? resolve(node) ?? node : node;
      const entity = next.genericEntities.find((candidate) => candidate.id === id);
      if (entity === undefined || accountOf(next, entity.id) !== null) return;
      next = {
        ...next,
        material: {
          ...next.material,
          accounts: [...next.material.accounts, {
            id: boundedId(entity.id, "fund"),
            owner: { kind: "entity" as const, id: entity.id },
            currencyId: next.material.currency.id,
            balance: 0,
            status: "active" as const,
            visibility: "polity" as const,
          }],
        },
      };
      return;
    }
    if (Array.isArray(node)) node.forEach((item) => visit(item, key));
    else if (node !== null && typeof node === "object") for (const [childKey, value] of Object.entries(node)) visit(value, childKey);
  };
  visit(delta, "");
  return next;
}

/** Of the parent's men, what a detachment named but never made takes. */
const DETACHMENT_SHARE = 0.2;

/**
 * A detachment an answer named and never made: "local:silver-shields-scouts"
 * for scouts sent out from the Silver Shields.
 *
 * Nothing can raise an army from nothing, so a force handle nobody created is
 * ordinarily refused. But a handle that begins with an army that exists names
 * a part of it, and sending part of an army somewhere is the commonest order
 * there is. A fifth of its men go, under the same commander and the same
 * power; the parent is the smaller for it.
 */
function splitDetachmentsNamedIn(delta: WorldDelta, world: WorldState, assignedIds: Map<string, string>, context: ApplyContext): WorldState {
  let next = world;
  const visit = (node: unknown, key: string): void => {
    if (typeof node === "string") {
      if (!/force/i.test(key) || !node.startsWith("local:")) return;
      const handle = node.slice("local:".length);
      if (assignedIds.has(handle)) return;
      const slug = handle.toLowerCase().replace(/_/g, "-");
      const actorId = context.actorRef.kind === "character" ? context.actorRef.id : null;
      const theirs = next.material.forces.filter((force) => actorId !== null && (force.commanderCharacterId === actorId || force.controllerCharacterId === actorId));
      // Named after its parent -- "silver-shields-scouts" -- or, where the
      // name says only what they are ("pass_scouts"), drawn from the one army
      // the person giving the order leads.
      const parent = next.material.forces
        .filter((force) => slug.startsWith(`${force.id.toLowerCase()}-`) || slug.startsWith(`${force.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-`))
        .sort((a, b) => b.id.length - a.id.length)[0]
        ?? (theirs.length === 1 && /scout|detach|party|picket|patrol|guard|escort|squad|band|garrison|praesidi/i.test(slug) ? theirs[0] : undefined);
      if (parent === undefined) return;
      const personnel = parent.personnel
        .map((category) => ({ ...category, fit: Math.floor(category.fit * DETACHMENT_SHARE), unavailable: [] }))
        .filter((category) => category.fit > 0);
      if (personnel.length === 0) return;
      const id = context.ids.next("force");
      assignedIds.set(handle, id);
      const taken = new Map(personnel.map((category) => [category.categoryId, category.fit]));
      const name = handle.split(/[-_]+/).filter(Boolean).map((word) => word[0]!.toUpperCase() + word.slice(1)).join(" ");
      next = {
        ...next,
        material: {
          ...next.material,
          forces: [
            ...next.material.forces.map((force) => force.id !== parent.id ? force : {
              ...force,
              personnel: force.personnel.map((category) => ({ ...category, fit: category.fit - (taken.get(category.categoryId) ?? 0) })),
              authorizedStrength: Math.max(1, force.authorizedStrength - personnel.reduce((sum, category) => sum + category.fit, 0)),
            }),
            ((detached: Force) => (isGarrison(slug) ? asGarrison(next, detached) : detached))({
              ...structuredClone(parent),
              id,
              name: name.slice(0, 120),
              personnel,
              authorizedStrength: personnel.reduce((sum, category) => sum + category.fit, 0),
              payObligationId: parent.payObligationId,
              payArrearsPeriods: 0,
              history: [],
              memberCharacterIds: [],
            }),
          ],
        },
      };
      return;
    }
    if (Array.isArray(node)) node.forEach((item) => visit(item, key));
    else if (node !== null && typeof node === "object") for (const [childKey, value] of Object.entries(node)) visit(value, childKey);
  };
  visit(delta, "");
  return next;
}
