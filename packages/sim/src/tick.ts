import {
  spendFromReservation,
  reconcileCapitals,
  isOwedATurn,
  AGREEMENT_KIND_IN_WORDS,
  DEFAULT_STRUCTURE_EFFECTS,
  effectWorth,
  advanceProvinceMaterial,
  applyDiplomaticAnswerToStance,
  diplomaticAnswerChangesTrust,
  sameNegotiation,
  domesticRevenuePolity,
  provinceTaxCapacity,
  taxBurdens,
  agreementsBetween,
  atWar,
  expireDatedAgreements,
  kmBetween,
  passageFor,
  describeFerry,
  practise,
  skillShare,
  readDepartments,
  activeDepartments,
  leverDefinition,
  type SubSkill,
  aimsAtWar,
  leaderOf,
  settleOrphanedOccupations,
  isOccupied,
  warsOf,
  openWar,
  threatWaitsOnAttack,
  isNavalForce,
  nextDueMilestone,
  warfareWith,
  forceLever,
  type FactProposalDraft,
  type MoneyObligation,
  type ProvinceTargets,
  type ScenarioLifeRules,
  type ScenarioWarfareRules,
  type ScenarioClock,
  monthOfDay,
  type MoneyTransaction,
  type WorldState,
  type Project,
  recordTenures,
  obligationAmountNow,
  provinceGrainPriceBps,
  tradePremiumBps,
  liveProvinceIds,
  type ProvinceMaterial,
  allOffices,
} from "@chronica/shared";
import { projectConflicts } from "./conflicts";
import { trespassOf } from "./trespass";
import { provinceTargetsFrom, settleStandingEffects } from "./standing-effects";
import { reviewLives } from "./mortality";
import { resolvePlots } from "./plots";
import { reviewContingencies } from "./contingencies";
import type { BattleAccount } from "./battle";
import { returnTheMended } from "./battle";
import { keepTheRanks } from "./ranks";
import { pressSieges } from "./sieges";
import { fightEngagements, noteWhoFaces } from "./engagements";
import { deliverConvoys } from "./grain";
import { keepBlockades } from "./blockades";

import { keepTheField } from "./campaign";
import { interceptCrossings, perilsOfTheRoad } from "./crossings";
import { raiseLevy } from "./levies";
import { lapseAilments } from "./ailments";
import { reviewPowers } from "./polity-end";
import { settleUnionOffers } from "./submission";
import { betweenHarvests, reviewTheLand } from "./economy";
import { endObligationsOfEndedAgreements, keepTreaties } from "./treaties";
import { keepPromises } from "./promises";
import { settleDebts, termTheLoans } from "./debts";
import { reviewUnrest } from "./unrest";
import type { IdFactory } from "./ports";
import { holdElections, type ElectionGovernment } from "./elections";
import { holdVotes } from "./senate";
import { ensureConstitutions, keepThrones } from "./constitutions";
import { reviewSociety } from "./society";
import { occupyOpenCountry } from "./occupation";
import { raiseOpenings } from "./openings";
import { keepContracts } from "./contracts";
import { newsReach, powersNearThePlayer } from "./far-powers";
import { keepCommandTenure } from "./command-tenure";
import { keepDepartments } from "./departments";
import { assignOverseers, polityOfWork } from "./overseers";
import { fillAppointments } from "./appointments";
import { reviewSkills } from "./skill-decline";
import { sweepThreadsOverTheCap } from "./storyline-cap";

/** A blockade looser than this does not shut a port's trade. */
const LOOSE_BLOCKADE_BPS = 5_000;

/** The world with its conflict overlay brought back in step with it. */
const projectConflictsInto = (world: WorldState): WorldState => ({ ...world, conflicts: projectConflicts(world) });

/**
 * Everything that happens because time passed, and for no other reason.
 *
 * VISION §7 is explicit that there is no reason to invoke a model to calculate
 * a monthly surplus: once a tax is established, collecting it is arithmetic.
 * The same is true of army pay, and of a recruitment project reaching the date
 * its next milestone falls due. This is that half of the world.
 *
 * It runs only while a burst is advancing the clock, because the clock only
 * advances while the player's order is being carried out -- the world does not
 * move on its own between orders. So a burst that spans sixty days collects
 * two months of revenue and pays two months of wages, in one pass, with no
 * model call at all.
 *
 * What it will not do is decide anything. A treasury that cannot meet the
 * army's wages accrues arrears and emits a fact saying so; whether that becomes
 * a mutiny is for an actor to judge, not for this.
 */

/** Guards a pathological cadence from being replayed thousands of times in one span. */
const MAX_PERIODS_PER_TICK = 24;
/** A warship's crew a month, and a soldier's: the scenario's own rates (`punic-wars-scenario.ts`). */
const WARSHIP_PAY = 210 / 40;
const SOLDIER_PAY = 35 / 1_000;
/** How long a crossing waits, each time, for the march or the sailing that brings its army to the shore. */
const LEG_WAIT_DAYS = 3;

export interface TickInput {
  readonly world: WorldState;
  /** The scenario's rules of war -- how long unpaid wages take to bite. */
  readonly warfare?: ScenarioWarfareRules | undefined;
  /**
   * The scenario's own age bands. Absent, nobody ages and nobody dies -- which
   * was every game up to now, because nothing passed this in.
   */
  readonly life?: ScenarioLifeRules | undefined;
  /** Whose death ends the game rather than the man. Never taken by a roll without a peril first. */
  readonly playerCharacterId?: string | null | undefined;
  /** The scenario's offices and how they are filled. Absent, no office is refilled by election. */
  readonly government?: ElectionGovernment | undefined;
  /** The day the world is advancing to. Everything due at or before it resolves. */
  readonly toDay: number;
  readonly ids: IdFactory;
  /** The scenario's calendar. Absent, there are no seasons: no winter, no shut sea, no summer fevers. */
  readonly clock?: ScenarioClock | undefined;
}

export interface TickResult {
  readonly world: WorldState;
  /** What the passage of time made true, ready to be materialized like any other fact. */
  readonly factProposals: readonly FactProposalDraft[];
  /** Plain lines for the Chronicle, which would otherwise never hear about routine upkeep. */
  readonly notes: readonly string[];
  /** Whoever died of the passage of time this tick, so the caller can ask who follows. */
  readonly died: readonly string[];
  /**
   * Plans that sprang by themselves this tick.
   *
   * Handed out so the burst can stop and give the ruler back the wheel: a man
   * who laid a trap against exactly this moment is owed the moment, not a
   * paragraph about it a month later.
   */
  readonly sprungContingencies: readonly string[];
  /** Battles the tick itself started -- a sprung ambush, a relief falling on siege lines, a fleet stopping a crossing, enemies meeting on one field -- for whoever writes them up. */
  readonly contingencyBattles: readonly BattleAccount[];
}

/**
 * What a power's courts and grain office do for its ground: order and food
 * come back as fast as whoever runs them can bring them back -- up to three
 * in ten faster, or slower. Nothing changes where they are middling.
 */
function withGovernment(
  targets: Map<string, ProvinceTargets>,
  world: WorldState,
  inCharge: ReturnType<typeof readDepartments>,
): Map<string, ProvinceTargets> {
  const next = new Map(targets);
  const scales = new Map<string, { stability: number; food: number }>();
  for (const province of world.map.provinces) {
    if (province.controllerPolityId === null) continue;
    let scale = scales.get(province.controllerPolityId);
    if (scale === undefined) {
      const scope = { kind: "polity" as const, id: province.controllerPolityId };
      scale = { stability: 1 + skillShare(inCharge.skill(scope, "courts"), 0.3), food: 1 + skillShare(inCharge.skill(scope, "grain"), 0.3) };
      scales.set(province.controllerPolityId, scale);
    }
    if (scale.stability === 1 && scale.food === 1) continue;
    next.set(province.id, { ...(next.get(province.id) ?? {}), stabilityRecoveryScale: scale.stability, foodRecoveryScale: scale.food });
  }
  return next;
}

/**
 * A power pressing its lands past what they bear settles them lower, on top of
 * whatever stands in them: the temple still calms the town, and the tax still
 * sours it.
 */
function withTaxUnrest(
  targets: Map<string, ProvinceTargets>,
  world: WorldState,
  burdens: ReadonlyMap<string, { readonly stabilityShiftBps: number }>,
): Map<string, ProvinceTargets> {
  const next = new Map(targets);
  for (const province of world.map.provinces) {
    const shift = province.controllerPolityId === null ? 0 : burdens.get(province.controllerPolityId)?.stabilityShiftBps ?? 0;
    if (shift === 0) continue;
    const current = next.get(province.id) ?? {};
    next.set(province.id, { ...current, stabilityShiftBps: (current.stabilityShiftBps ?? 0) + shift });
  }
  return next;
}

/** Of a province's monthly tax capacity: the most a finished work there can yield -- a great market's share. */
const PROJECT_INCOME_CEILING_SHARE = 0.15;

function incomeCeilingOf(world: WorldState, provinceId: string | null, beneficiaryAccountId: string, cadenceDays: number): number {
  const capacity = (id: string): number => provinceTaxCapacity(world, id) ?? 0;
  let monthly: number;
  if (provinceId !== null && world.map.provinces.some((province) => province.id === provinceId)) {
    monthly = capacity(provinceId);
  } else {
    const owner = world.material.accounts.find((account) => account.id === beneficiaryAccountId)?.owner;
    const held = owner?.kind === "polity" ? world.map.provinces.filter((province) => province.controllerPolityId === owner.id) : [];
    monthly = held.length === 0 ? 0 : held.reduce((sum, province) => sum + capacity(province.id), 0) / held.length;
  }
  // A world with no towns to reckon by has nothing to bound it against.
  if (monthly <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(1, Math.round(monthly * PROJECT_INCOME_CEILING_SHARE * (cadenceDays / 30)));
}

/** Days without a development before the world stops following a thread. */
const STORYLINE_IDLE_DAYS = 180;

/**
 * What a term in an office teaches: the skills of the work it was in charge
 * of. It was read from what the office was called, so a quaestor learned the
 * tax roll whether or not he had ever been let near it. A department's
 * officers learn its levers; the head of a state learns to hold men to their
 * duty; an office in charge of nothing teaches only what its missions do.
 */
function taughtBy(world: WorldState, officeId: string): readonly SubSkill[] {
  const skills = new Set<SubSkill>();
  for (const department of activeDepartments(world)) {
    const staffs = department.officeIds.includes(officeId) || department.headOfficeId === officeId || department.deputyOfficeIds.includes(officeId);
    if (!staffs) continue;
    for (const lever of department.levers) for (const skill of leverDefinition(lever).skills) if (skill !== "stewardship") skills.add(skill);
  }
  if (skills.size === 0 && world.constitutions.some((constitution) => constitution.rulerOfficeId === officeId)) skills.add("authority");
  return [...skills].slice(0, 2);
}

/** Two points of what the office asked of him, split between what it asked. */
function learnedInOffice<C extends Pick<WorldState["characters"][number], "skills">>(character: C, skills: readonly SubSkill[]): C {
  if (skills.length === 0) return character;
  const each = skills.length === 1 ? 2 : 1;
  return skills.reduce((learning, skill) => practise(learning, skill, each), character);
}

export function runDeterministicTick(given: TickInput): TickResult {
  const month = given.clock === undefined ? null : monthOfDay(given.toDay, given.clock);
  // Crossings an enemy fleet stands across are fought for before anything
  // lands (`crossings.ts`).
  const intercepted = given.warfare === undefined
    ? { world: given.world, facts: [] as FactProposalDraft[], battles: [] as BattleAccount[] }
    : interceptCrossings({ world: given.world, toDay: given.toDay, month, warfare: given.warfare, ids: given.ids, playerCharacterId: given.playerCharacterId ?? null });
  // Before anything is paid: nothing is paid on a treaty that has ended, and a
  // loan's instalment is what it still owes (`treaties.ts`, `debts.ts`).
  const beforePayments = termTheLoans(endObligationsOfEndedAgreements(intercepted.world));
  const input: TickInput = beforePayments === given.world ? given : { ...given, world: beforePayments };
  const facts: FactProposalDraft[] = [...intercepted.facts];
  const notes: string[] = [];
  let accounts = input.world.material.accounts;
  let reservations = input.world.material.reservations;
  const transactions: MoneyTransaction[] = [...input.world.material.transactions];
  let localId = 0;
  /** What an account can spend without touching money set aside for something else. */
  const spendableOf = (accountId: string, ownReservationId: string | null): number =>
    Math.max(0, balanceOf(accountId) - reservations
      .filter((reservation) => reservation.accountId === accountId && reservation.status === "active" && reservation.id !== ownReservationId)
      .reduce((sum, reservation) => sum + reservation.remainingAmount, 0));

  const balanceOf = (accountId: string): number => accounts.find((account) => account.id === accountId)?.balance ?? 0;
  const credit = (accountId: string, amount: number): void => {
    accounts = accounts.map((account) => (account.id === accountId ? { ...account, balance: Math.max(0, account.balance + amount) } : account));
  };
  const nextLocalId = (prefix: string): string => `${prefix}_${(localId += 1)}`;

  // ── Income ────────────────────────────────────────────────────────────
  //
  // Collected silently. A treasury that fills as expected is not history, and
  // a fact per tax payment would drown every Chronicle in bookkeeping.
  let collected = 0;
  /**
   * A war cuts what it is a war with.
   *
   * Income sources have carried a `counterpartyPolityId` from the beginning --
   * "revenue that comes from another power should name that power, so a war can
   * cut it" -- and nothing ever cut one, because until agreements existed there
   * was no way to ask whether two powers were at war. Sicilian grain went on
   * arriving in Rome throughout a Sicilian war.
   */
  const ownerPolityOf = (accountId: string): string | null => {
    const owner = input.world.material.accounts.find((account) => account.id === accountId)?.owner;
    if (owner === undefined) return null;
    if (owner.kind === "polity") return owner.id;
    return input.world.characters.find((character) => character.id === owner.id)?.polityId ?? null;
  };
  const severed = (source: { readonly counterpartyPolityId: string | null; readonly beneficiaryAccountId: string }): boolean => {
    if (source.counterpartyPolityId === null) return false;
    const ours = ownerPolityOf(source.beneficiaryAccountId);
    return ours !== null && atWar(input.world.polityAgreements, ours, source.counterpartyPolityId);
  };

  /**
   * Powers whose sea trade is shut in by somebody else's fleet.
   *
   * A blockade is where a navy pays for itself politically: enemy ships sitting
   * off a port stop the trade that comes through it, without anybody ordering
   * anything each month. It requires a war -- a fleet at anchor in peacetime is
   * a visit.
   */
  const blockaded = new Set<string>();
  for (const province of input.world.map.provinces) {
    const controller = province.controllerPolityId;
    if (controller === null || !province.settlements.some((settlement) => settlement.kind === "port")) continue;
    const besiegers = input.world.material.forces.filter(
      (force) => force.locationId === province.id && force.polityId !== controller && isNavalForce(force, input.warfare === undefined ? undefined : warfareWith(input.world, input.warfare)) && atWar(input.world.polityAgreements, force.polityId, controller),
    );
    // A few ships watching a harbour do not shut it: a blockade already known
    // to be loose lets trade half through (`blockades.ts`), which is nothing
    // the monthly reckoning can split, so it counts as open.
    const known = input.world.blockades.find((blockade) => blockade.status === "active" && blockade.provinceId === province.id && blockade.blockadedPolityId === controller);
    if (besiegers.length > 0 && (known === undefined || known.tightnessBps >= LOOSE_BLOCKADE_BPS)) blockaded.add(controller);
  }
  const blockadedTrade = (source: { readonly kind: string; readonly beneficiaryAccountId: string }): boolean => {
    if (source.kind !== "trade") return false;
    const ours = ownerPolityOf(source.beneficiaryAccountId);
    return ours !== null && blockaded.has(ours);
  };

  // What each power's own lands can bear this month, weighed before anything
  // is collected (see `taxBurdens`). A power asking more than that gets what
  // there is, every domestic revenue in the same proportion.
  const burdens = taxBurdens(input.world);
  const shortfalls = new Map<string, { asked: number; raised: number }>();

  // A venture is cut at its own ports, not wherever its owner's country has
  // one. An enemy fleet -- at war with the owner's power -- off either end of a
  // sea venture stops it; one off some other harbour does not.
  const ventureById = new Map(input.world.material.ventures.map((venture) => [venture.id, venture]));
  const fleetOff = (provinceId: string, polityId: string | null): boolean =>
    polityId !== null && input.world.material.forces.some((force) =>
      force.locationId === provinceId
      && force.polityId !== polityId
      && isNavalForce(force, input.warfare === undefined ? undefined : warfareWith(input.world, input.warfare))
      && atWar(input.world.polityAgreements, force.polityId, polityId));
  const ventureCut = (source: { readonly originKind: string; readonly originId: string }): "war" | "blockade" | null => {
    if (source.originKind !== "venture") return null;
    const venture = ventureById.get(source.originId);
    if (venture === undefined || venture.status !== "running") return null;
    const owner = input.world.characters.find((character) => character.id === venture.ownerCharacterId)?.polityId ?? null;
    if (venture.bySea && (fleetOff(venture.fromProvinceId, owner) || fleetOff(venture.toProvinceId, owner))) return "blockade";
    return null;
  };
  const ventureState = new Map<string, "war" | "blockade" | null>();

  // Who manages the money. A power's taxes are gathered as well as whoever is
  // in charge of the tax roll can gather them -- its treasury's officers,
  // averaged, or the ruler himself where nobody has been given it -- and a
  // man's estates and ventures pay as well as he or his steward runs them: up
  // to a seventh more, or less. It was the best tax man among all the
  // magistrates, whoever he was, and a king's own gift for it never counted.
  const inCharge = readDepartments(input.world);
  const handling = (source: WorldState["material"]["incomeSources"][number], levied: string | null): number => {
    if (levied !== null) return 1 + skillShare(inCharge.skill({ kind: "polity", id: levied }, "tax_roll"), 0.15);
    if (source.originKind !== "holding" && source.originKind !== "venture") return 1;
    const owner = input.world.material.accounts.find((account) => account.id === source.beneficiaryAccountId)?.owner;
    if (owner?.kind !== "character") return 1;
    const lever = `${source.originKind === "venture" ? "venture" : "estate"}:${source.id}` as const;
    return 1 + skillShare(inCharge.skill({ kind: "household", id: owner.id }, lever), 0.15);
  };

  // Nothing pays into a dead man's purse. His estate is settled the day he
  // dies and every source it knew of is moved or ended; this catches any that
  // is pointed at a locked account afterwards, rather than filling it again.
  const lockedAccounts = new Set(input.world.material.accounts.filter((account) => account.status !== "active").map((account) => account.id));
  const incomeSources = input.world.material.incomeSources.map((source) => {
    if (!source.active || lockedAccounts.has(source.beneficiaryAccountId)) return source;
    if (source.originKind === "venture") {
      const cut = severed(source) ? "war" as const : ventureCut(source);
      ventureState.set(source.originId, cut);
      if (cut !== null) return source;
    } else if (severed(source) || blockadedTrade(source)) {
      // Cut, not cancelled: the route is still there, and peace -- or the
      // fleet sailing away -- restores it.
      return source;
    }
    let due = source.nextDueStep;
    let periods = 0;
    while (due <= input.toDay && periods < MAX_PERIODS_PER_TICK) {
      const levied = domesticRevenuePolity(input.world, source);
      const share = levied === null ? 1 : burdens.get(levied)?.collectedShare ?? 1;
      // A venture earns by the markets at its two ends (`tradePremiumBps`):
      // grain carried into a famine sells dear.
      const route = source.originKind === "venture" ? ventureById.get(source.originId) : undefined;
      const premium = route === undefined ? 10_000
        : tradePremiumBps(provinceGrainPriceBps(input.world, route.fromProvinceId), provinceGrainPriceBps(input.world, route.toProvinceId));
      // And it earns little where the war has reached either end: ground at
      // war, occupied, or under blockade (docs/plans/a-living-world.md §10).
      // A grain merchant feels Egypt's war in his ledger.
      const disrupted = route === undefined ? 10_000 : Math.min(...[route.fromProvinceId, route.toProvinceId].map((provinceId) => routeOpenBps(input.world, provinceId)));
      const owed = Math.round((source.amount * source.collectionRateBps / 10_000) * premium / 10_000 * disrupted / 10_000);
      // A good collector gathers what is owed better; he cannot gather what
      // the land does not have. He brings in more only as far as the land has
      // room to give, so his gift fades as a tax nears what it bears, and a
      // tax pressed past it he can only collect worse.
      const handled = handling(source, levied);
      const burden = levied === null ? undefined : burdens.get(levied);
      const room = burden === undefined || burden.asked <= 0 ? Infinity : burden.bearable / burden.asked;
      const received = Math.round(owed * Math.min(share * handled, handled > 1 ? Math.max(share, room) : Infinity));
      if (levied !== null && share < 1) {
        const tally = shortfalls.get(levied) ?? { asked: 0, raised: 0 };
        shortfalls.set(levied, { asked: tally.asked + owed, raised: tally.raised + received });
      }
      if (received > 0) {
        credit(source.beneficiaryAccountId, received);
        collected += received;
        transactions.push({
          id: input.ids.next("txn"),
          atStep: due,
          kind: source.kind === "tax" ? "tax" : "income",
          amount: received,
          destinationAccountId: source.beneficiaryAccountId,
          cause: { kind: "scheduled_income", id: source.id, explanation: source.label },
          visibility: "polity",
        });
      }
      due += source.cadenceSteps;
      periods += 1;
    }
    return periods === 0 ? source : { ...source, nextDueStep: due };
  });

  // ── Obligations ───────────────────────────────────────────────────────
  //
  // Paid in priority order, so that when money runs short it is the least
  // important creditor who goes unpaid rather than whichever happened to be
  // first in the array.
  const byPriority = [...input.world.material.obligations].sort((a, b) => b.priority - a.priority);
  const settled = new Map<string, MoneyObligation>();
  let paid = 0;
  const newlyUnpaid: MoneyObligation[] = [];

  // An army's keep is partly bread, bought at what grain costs on its
  // paymaster's ground (`obligationAmountNow`): a famine year makes every legion dearer.
  for (const obligation of byPriority) {
    if (!obligation.active) continue;
    const amount = obligationAmountNow(input.world, obligation);
    let due = obligation.nextDueStep;
    let periods = 0;
    let arrears = obligation.arrears;
    let missed = obligation.missedPeriods;
    let wentUnpaid = false;
    let remaining = obligation.remainingPeriods;

    while (due <= input.toDay && periods < MAX_PERIODS_PER_TICK && (remaining === undefined || remaining > 0)) {
      const owed = amount + arrears;
      const available = balanceOf(obligation.payerAccountId);
      if (available >= owed && owed > 0) {
        credit(obligation.payerAccountId, -owed);
        if (obligation.recipientAccountId !== undefined) credit(obligation.recipientAccountId, owed);
        paid += owed;
        transactions.push({
          id: input.ids.next("txn"),
          atStep: due,
          kind: obligation.kind === "army_pay" || obligation.kind === "army_upkeep" ? "upkeep" : "transfer",
          amount: owed,
          sourceAccountId: obligation.payerAccountId,
          // Never to itself. An obligation whose payer and recipient are the
          // same account is refused at creation now, but one already standing
          // in a live world would otherwise write a transaction the schema
          // rejects -- and a world that will not parse is a world that cannot
          // be loaded at all.
          ...(obligation.recipientAccountId === undefined || obligation.recipientAccountId === obligation.payerAccountId
            ? {}
            : { destinationAccountId: obligation.recipientAccountId }),
          cause: { kind: "obligation", id: obligation.id, explanation: obligation.label },
          // The order that set it up spends what it pays (`spentForOrderPart`).
          ...(obligation.sourceActionId == null ? {} : { sourceActionId: obligation.sourceActionId }),
          visibility: "polity",
        });
        arrears = 0;
        if (remaining !== undefined) remaining -= 1;
      } else if (owed > 0) {
        arrears = owed;
        missed += 1;
        wentUnpaid = true;
      }
      due += obligation.cadenceSteps;
      periods += 1;
    }

    if (periods > 0) {
      settled.set(obligation.id, {
        ...obligation,
        nextDueStep: due,
        arrears,
        missedPeriods: missed,
        // Paid off: an indemnity of ten instalments is over after the tenth.
        ...(remaining === undefined ? {} : { remainingPeriods: remaining, active: remaining > 0 }),
      });
    }
    if (wentUnpaid) newlyUnpaid.push(settled.get(obligation.id)!);
  }

  const obligations = input.world.material.obligations.map((obligation) => settled.get(obligation.id) ?? obligation);

  // Unlike income, an unpaid army is emphatically history.
  for (const unpaid of newlyUnpaid) {
    facts.push({
      localId: nextLocalId("arrears"),
      kind: "obligation_unpaid",
      summary: `${unpaid.label} went unpaid; ${unpaid.arrears} is now owed, over ${unpaid.missedPeriods} missed period(s).`,
      affectedRefs: [{ kind: "account", id: unpaid.payerAccountId }],
      visibility: "polity",
      discoveryState: "polity",
      knowableInDays: 0,
      // Wages in arrears are how armies stop being yours.
      significance: Math.min(90, 25 + unpaid.missedPeriods * 15),
    });
    notes.push(`${unpaid.label} could not be paid.`);
  }

  if (collected > 0 || paid > 0) notes.push(`Revenue of ${collected} was collected and ${paid} paid out in standing obligations.`);

  /**
   * Debt that stops being served (VISION §20).
   *
   * Servicing itself is already an obligation and needs nothing here. What does
   * need saying is that a creditor is a person: a state that has missed three
   * payments has not merely a line in arrears but someone with a claim on it,
   * and that fact is what wakes them. After enough missed periods the loan is
   * in default whether or not anybody declared one.
   */
  const DEFAULT_AFTER_MISSED_PERIODS = 3;
  const loans = input.world.material.loans.map((loan) => {
    if (loan.status !== "active" || loan.serviceObligationId === null) return loan;
    const servicing = obligations.find((obligation) => obligation.id === loan.serviceObligationId);
    if (servicing === undefined || servicing.missedPeriods < DEFAULT_AFTER_MISSED_PERIODS) return loan;

    const lender = loan.lenderKind === "foreign" || loan.lenderId === null ? "its creditors" : loan.lenderId;
    facts.push({
      localId: nextLocalId("default"),
      kind: "loan_defaulted",
      summary: `The debt of ${loan.outstanding} owed on ${loan.terms} has gone unserviced for ${servicing.missedPeriods} periods; ${lender} is no longer being paid.`,
      affectedRefs: [
        { kind: "account", id: loan.borrowerAccountId },
        ...(loan.lenderKind === "character" && loan.lenderId !== null ? [{ kind: "character" as const, id: loan.lenderId }] : []),
      ],
      visibility: "polity",
      discoveryState: "polity",
      knowableInDays: 0,
      // A state that stops paying its creditors is the beginning of a crisis,
      // not an accounting detail.
      significance: 75,
    });
    notes.push(`The loan on ${loan.terms} fell into default.`);
    return { ...loan, status: "defaulted" as const };
  });

  const defaultedObligationIds = new Set(
    loans.filter((loan) => loan.status === "defaulted").map((loan) => loan.serviceObligationId).filter((id): id is string => id !== null),
  );
  const servicedObligations = defaultedObligationIds.size === 0
    ? obligations
    : obligations.map((obligation) => (defaultedObligationIds.has(obligation.id) ? { ...obligation, active: false } : obligation));

  /**
   * What unpaid wages do to an army (VISION §6, §7).
   *
   * `Force.payArrearsPeriods` was never written and the scenario's own
   * `arrearsMoralePeriods` / `arrearsDesertionPeriods` were read by nobody, so
   * a treasury could stop paying its legions indefinitely and the legions never
   * noticed. Missed periods now reach the force that the obligation pays: first
   * its morale, then its men.
   */
  const MORALE_LOSS_BPS_PER_PERIOD = 800;
  const DESERTION_RATE_PER_PERIOD = 0.03;
  const unpaidForces = input.world.material.forces.map((force) => {
    // A term of service run out is said on its day, with what was promised at
    // its end, and said once (R11).
    if (force.serviceUntilStep !== undefined && force.serviceUntilStep <= input.toDay) {
      facts.push({
        localId: nextLocalId("service_ended"),
        kind: "service_ended",
        summary: `The men of ${force.name} have served the term they were bound to.${force.serviceTerms === undefined ? "" : ` What was promised them: ${force.serviceTerms}`}`.slice(0, 600),
        affectedRefs: [{ kind: "force", id: force.id }, { kind: "polity", id: force.polityId }],
        visibility: "polity",
        discoveryState: "polity",
        knowableInDays: 0,
        significance: 55,
      });
      const { serviceUntilStep: _served, ...rest } = force;
      force = rest;
    }
    if (force.payObligationId === null) return force;
    const paying = obligations.find((obligation) => obligation.id === force.payObligationId);
    if (paying === undefined || paying.missedPeriods === force.payArrearsPeriods) return force;

    const missed = paying.missedPeriods;
    // Men who are used to waiting for their pay wait longer before they sulk
    // and desert (`pay_discipline`); men who serve for the coin, not so long.
    const patience = Math.round(forceLever({ establishments: input.world.establishments, doctrines: input.world.doctrines, today: input.world.elapsedStep }, force, "pay_discipline"));
    const moralePeriods = Math.max(1, (input.warfare?.arrearsMoralePeriods ?? 1) + patience);
    const desertionPeriods = Math.max(moralePeriods + 1, (input.warfare?.arrearsDesertionPeriods ?? 3) + patience);
    if (missed < moralePeriods) return { ...force, payArrearsPeriods: missed };

    const moraleBps = Math.max(0, force.moraleBps - MORALE_LOSS_BPS_PER_PERIOD * (missed - moralePeriods + 1));
    if (missed < desertionPeriods) {
      facts.push({
        localId: nextLocalId("grumbling"),
        kind: "force_unpaid",
        summary: `${force.name} has gone ${missed} pay period(s) unpaid, and knows it.`,
        affectedRefs: [{ kind: "force", id: force.id }],
        visibility: "polity",
        discoveryState: "polity",
        knowableInDays: 0,
        significance: 40,
      });
      return { ...force, payArrearsPeriods: missed, moraleBps };
    }

    // Men leave. They are gone, not resting -- desertion is permanent.
    // Fewer, where whoever is in charge of the levy can hold men to their
    // duty: up to three in ten fewer, or more.
    const held = 1 - skillShare(inCharge.skill({ kind: "polity", id: force.polityId }, "levy"), 0.3);
    const leaving = Math.round(DESERTION_RATE_PER_PERIOD * (missed - desertionPeriods + 1) * held * 10_000) / 10_000;
    let lost = 0;
    const personnel = force.personnel.map((category) => {
      const gone = Math.min(category.fit, Math.floor(category.fit * leaving));
      lost += gone;
      return { ...category, fit: category.fit - gone };
    });
    if (lost === 0) return { ...force, payArrearsPeriods: missed, moraleBps };

    facts.push({
      localId: nextLocalId("desertion"),
      kind: "force_desertion",
      summary: `${lost} men left ${force.name} over ${missed} unpaid pay period(s).`,
      affectedRefs: [{ kind: "force", id: force.id }],
      visibility: "polity",
      discoveryState: "polity",
      knowableInDays: 0,
      // Wages in arrears are how armies stop being yours.
      significance: 70,
    });
    notes.push(`${lost} men deserted ${force.name} for want of pay.`);
    return {
      ...force,
      payArrearsPeriods: missed,
      moraleBps,
      personnel,
      authorizedStrength: Math.max(1, personnel.reduce((sum, category) => sum + category.fit, 0)),
      history: [
        ...force.history,
        { id: input.ids.next("personnel"), atStep: input.toDay, kind: "desertion" as const, categoryId: personnel[0]?.categoryId ?? "infantry", count: lost, causeId: force.payObligationId },
      ].slice(-64),
    };
  });

  // ── Projects ──────────────────────────────────────────────────────────
  //
  // A milestone whose date has arrived completes, and pays its cost. This is
  // what makes a four-month recruitment actually produce legions rather than
  // scheduling them forever (VISION §17).
  const sponsorAccountId = (sponsor: WorldState["projects"][number]["sponsorEntityRef"]): string | undefined =>
    accounts.find((account) => account.owner.kind === sponsor.kind && account.owner.id === sponsor.id)?.id;

  /**
   * Who pays the men a public work raised. A fleet of 150 the Senate voted and
   * the treasury built stood ready with nobody undertaking to pay its crews,
   * and the Office asked the consul to see to it (R07). A power's work paid
   * from its treasury goes on being paid from it, at the scenario's own rates:
   * a warship as the Syracusan squadron's, five and a quarter a hull a month;
   * any other soldier as the legions', thirty-five a thousand. A private man's
   * work pays nobody's wages but by his own order.
   */
  const payOf = (project: WorldState["projects"][number], label: string, categoryId: string, strength: number, polityId: string): string | null => {
    const funder = project.fundingAccountId ?? sponsorAccountId(project.sponsorEntityRef);
    const account = accounts.find((candidate) => candidate.id === funder);
    if (account === undefined || account.owner.kind !== "polity" || account.owner.id !== polityId) return null;
    const amount = Math.max(1, Math.ceil(categoryId === "warship" ? strength * WARSHIP_PAY : strength * SOLDIER_PAY));
    const obligationId = input.ids.next("obligation");
    newPay.push({
      id: obligationId, kind: "army_pay", label: `Pay of ${label}`.slice(0, 120), payerAccountId: account.id, amount,
      cadenceSteps: 30, nextDueStep: input.toDay + 30, priority: 900, arrears: 0, missedPeriods: 0, active: true,
    });
    return obligationId;
  };

  /** What finished projects produced this tick, folded into the world at the end. */
  const forces: WorldState["material"]["forces"][number][] = [];
  /** Armies a completed journey put somewhere else. */
  const movedForces = new Map<string, WorldState["material"]["forces"][number]>();
  /** And the ones the road cost men or ships on the way. */
  const tolledOnTheRoad = new Map<string, WorldState["material"]["forces"][number]>();
  const structures: WorldState["structures"][number][] = [];
  const newIncome: WorldState["material"]["incomeSources"][number][] = [];
  /** Pay undertaken for forces a finished project raised on a treasury (R07). */
  const newPay: WorldState["material"]["obligations"][number][] = [];

  /**
   * The thing a finished project leaves behind.
   *
   * Everything is minted from the same id factory the rest of the burst uses,
   * so a replay produces the same fleet. A reference that has gone stale since
   * the project opened -- a commander who has died, a province lost -- produces
   * nothing rather than an invalid world; the completion fact still stands, and
   * the record shows an effort that finished into nothing, which is a truer
   * account than a fleet appearing under a dead man.
   */
  /** Agreements the tick itself opens, when a project's whole product is one. */
  let agreements = input.world.polityAgreements;
  const between = (agreement: { readonly polityId: string; readonly otherPolityId: string }, a: string, b: string): boolean =>
    (agreement.polityId === a && agreement.otherPolityId === b) || (agreement.polityId === b && agreement.otherPolityId === a);

  /** Why a project that declared a product could not deliver it, where the engine knows. */
  const unproduced = new Map<string, string>();
  /**
   * A stage that is the leave to do the work waits for the vote that gives it:
   * the Anio survey marked "secure public authorization and arrange funding"
   * done while the Senate was still gathering support (R40).
   */
  const waitsForItsVote = (project: WorldState["projects"][number], label: string): boolean => {
    if (!/\b(authori[sz]|leave|approv|sanction|vote|senate)\w*/i.test(label)) return false;
    const stems = (text: string): Set<string> => new Set(text.toLowerCase().split(/[^\p{L}]+/u).filter((word) => word.length > 3).map((word) => word.slice(0, 5)));
    const work = stems(project.label);
    return input.world.material.politicalProcedures.some((procedure) => procedure.outcome === null
      && [...stems(procedure.label)].filter((stem) => work.has(stem)).length >= Math.min(2, work.size));
  };
  /**
   * Whether the last stage of a crossing is due while the march or the sailing
   * that brings its army and fleets to the shore is still under way.
   */
  const waitsForItsLegs = (project: WorldState["projects"][number], milestones: WorldState["projects"][number]["milestones"], milestoneId: string): boolean => {
    const outcome = project.completionOutcome;
    if (outcome?.kind !== "force_move" || outcome.embarkProvinceId === undefined || outcome.forceId === null) return false;
    if (milestones.filter((milestone) => milestone.status === "pending").at(-1)?.id !== milestoneId) return false;
    const movers = new Set([outcome.forceId, ...(outcome.fleetIds ?? [])]);
    return input.world.projects.some((leg) => leg.id !== project.id && leg.status === "in_progress"
      && leg.completionOutcome?.kind === "force_move" && leg.completionOutcome.provinceId === outcome.embarkProvinceId
      && leg.completionOutcome.forceId !== null && movers.has(leg.completionOutcome.forceId));
  };
  /** The country as the levies this tick left it: its manpower rolls, drawn down. */
  let leviedWorld: WorldState | undefined;
  /**
   * Whom a force a work produced answers to: the magistrate who moved it,
   * where he holds an office that commands. The fleet voted on the consul's
   * own motion and paid from the treasury he kept finished under the man who
   * oversaw the yards, and the consul could not give it an order. The overseer
   * still commands it; the mover is the one it answers to.
   */
  const answersTo = (project: WorldState["projects"][number], polityId: string): string | null => {
    const enactedBy = input.world.enactments.find((enactment) => enactment.projectId === project.id);
    const procedure = enactedBy === undefined ? undefined : input.world.material.politicalProcedures.find((candidate) => candidate.id === enactedBy.procedureId);
    const mover = project.sponsorEntityRef.kind === "character" ? project.sponsorEntityRef.id : procedure?.sponsorCharacterId ?? null;
    if (mover === null) return null;
    const person = input.world.characters.find((character) => character.id === mover);
    if (person === undefined || !person.alive || person.polityId !== polityId) return null;
    const commanding = new Set(allOffices(input.world, input.government?.offices ?? []).filter((office) => office.authorisedActionIds.some((action) => action === "force_modify" || action === "force_create")).map((office) => office.id));
    return input.world.material.officeSeats.some((seat) => seat.holderCharacterId === mover && seat.status === "held" && commanding.has(seat.officeId)) ? mover : null;
  };
  const produceOutcome = (project: WorldState["projects"][number]): { entityId: string; summary: string } | null => {
    const outcome = project.completionOutcome;
    if (outcome === null || outcome.kind === "none") return null;

    if (outcome.kind === "force") {
      const provinceId = outcome.provinceId ?? input.world.map.provinces[0]?.id;
      // A fleet the order named nobody to command goes to the man who built
      // it, and a levy nobody said whose it was to the power that paid for it.
      // Both used to finish into nothing.
      const commanderId = outcome.commanderCharacterId ?? project.overseerCharacterId ?? null;
      const polityId = outcome.polityId ?? polityOfWork(input.world, project);
      if (provinceId === undefined || commanderId === null || polityId === null) return null;
      if (!input.world.characters.some((character) => character.id === commanderId && character.alive)) return null;
      if (!input.world.map.provinces.some((province) => province.id === provinceId)) return null;

      const id = input.ids.next("force");
      // The men come out of the country, paid for already, milestone by
      // milestone (`levies.ts`). A country with none left to give produces
      // fewer, and says so.
      const levy = raiseLevy(leviedWorld ?? input.world, { polityId, provinceId, men: Math.max(1, outcome.amount), payerAccountId: null, pays: false, atStep: input.toDay, cause: project.id, ids: input.ids });
      if (levy.men <= 0) {
        unproduced.set(project.id, levy.short ?? "No men could be found.");
        return null;
      }
      leviedWorld = levy.world;
      if (levy.short !== null) facts.push({ localId: nextLocalId("levy_short"), kind: "levy_short", summary: levy.short, affectedRefs: [{ kind: "project", id: project.id }, { kind: "province", id: provinceId }], visibility: "polity", discoveryState: "polity", knowableInDays: 0, significance: 45 });
      const strength = levy.men;
      const category = (input.warfare === undefined ? undefined : warfareWith(input.world, input.warfare))?.troopCategories.find((candidate) => candidate.id === outcome.categoryId)
        ?? { id: "infantry", label: "Infantry" };
      forces.push({
        id,
        name: outcome.label,
        polityId,
        commanderCharacterId: commanderId,
        controllerCharacterId: answersTo(project, polityId) ?? commanderId,
        locationId: provinceId,
        positionId: null,
        authorizedStrength: strength,
        personnel: [{ categoryId: category.id, label: category.label, fit: strength, unavailable: [] }],
        moraleBps: 6_000,
        cohesionBps: 5_000,
        fatigueBps: 0,
        provisionStatus: "provisioned",
        provisionedThroughStep: input.toDay + 30,
        payObligationId: payOf(project, outcome.label, category.id, strength, polityId),
        payArrearsPeriods: 0,
        history: [],
        memberCharacterIds: [],
      });
      return { entityId: id, summary: `${outcome.label} [${id}] stands ready, ${strength} ${category.id === "infantry" ? "strong" : category.label.toLowerCase()}.` };
    }

    if (outcome.kind === "force_move") {
      // A march is a project because it takes time; what it produces is an army
      // standing somewhere else. Without this a "forced march" ran its
      // milestones, reported itself complete, and left the army where it began.
      const provinceId = outcome.provinceId;
      const forceId = outcome.forceId;
      if (provinceId === null || forceId === null) return null;
      if (!input.world.map.provinces.some((province) => province.id === provinceId)) return null;
      const marching = movedForces.get(forceId) ?? input.world.material.forces.find((force) => force.id === forceId);
      if (marching === undefined) return null;
      // `force_modify` has been made to respect the map; this was the way
      // around it. A march is allowed to cross several provinces -- that is what
      // makes it a project -- but there has to be a way across them, or a
      // scheduled march put an army anywhere on the map in one step.
      if (kmBetween(input.world, marching.locationId, provinceId) === null) return null;
      // ...and over water, the ships to cross it in, still standing with it on
      // the day. The fleet sails with the army it carries.
      const passage = passageFor(input.world, marching, provinceId, input.warfare === undefined ? undefined : warfareWith(input.world, input.warfare), month);
      if (passage.by === null) {
        unproduced.set(project.id, passage.reason);
        return null;
      }
      // What the road did to them on the way: a storm on the crossing, snow
      // on the pass (`crossings.ts`).
      const road = perilsOfTheRoad(input.world, marching, passage.by === "sea" ? passage.ferry.fleets.map((carrier) => movedForces.get(carrier.id) ?? carrier) : [], provinceId, passage.by === "sea" ? passage.over : null, month, input.toDay, project.id);
      movedForces.set(forceId, { ...road.army, locationId: provinceId, positionId: null });
      for (const fleet of road.fleets) movedForces.set(fleet.id, { ...fleet, locationId: provinceId, positionId: null });
      if (road.words !== "") for (const tolled of [road.army, ...road.fleets]) tolledOnTheRoad.set(tolled.id, tolled);
      // Named, not identified. This summary is copied verbatim into the
      // Chronicle by whoever writes the project up, and a chronicler
      // reporting that an army "arrived in <province id>" is the engine's
      // bookkeeping arriving in the historian's hands.
      const arrivedAt = input.world.map.provinces.find((province) => province.id === provinceId)?.name ?? provinceId;
      // Arriving on somebody else's ground unasked is part of what arriving
      // was. See `trespassOf`.
      const trespass = trespassOf(input.world, marching, provinceId);
      const carried = passage.by === "sea" ? ` It was carried over ${describeFerry(input.world, marching, passage.ferry)}.` : "";
      return { entityId: forceId, summary: `${marching.name} [${forceId}] has arrived in ${arrivedAt} [${provinceId}].${carried}${road.words}${trespass === null ? "" : ` ${trespass.summary}`}` };
    }

    if (outcome.kind === "structure") {
      // Where it stands, when the project did not say: where its builder is,
      // or his power's capital. The Anio waterworks named no province, so the
      // work "completed" eight times and nothing ever stood -- Dentatus paid
      // for it six times over and his plan kept starting it again.
      const site = structureSite(input.world, project, outcome.provinceId, outcome.polityId);
      if (site === null) {
        unproduced.set(project.id, "Nobody could say where it was to stand.");
        return null;
      }
      const provinceId = site.provinceId;
      const id = input.ids.next("structure");
      // What it is and what it does. Every building a project ever finished
      // was "other", defending nothing and supplying nobody, so a fortress
      // raised in play was a name on the map. A kind nobody described still
      // does what that kind of building does.
      const kind = outcome.structureKind ?? "other";
      const effects = (outcome.effects?.length ?? 0) > 0 ? outcome.effects! : DEFAULT_STRUCTURE_EFFECTS[kind] ?? [];
      const placeName = input.world.map.provinces.find((province) => province.id === provinceId)?.name ?? provinceId;
      structures.push({
        id,
        kind,
        name: outcome.label,
        provinceId,
        settlementId: site.settlementId,
        ownerPolityId: site.polityId,
        garrisonCapacity: outcome.amount,
        defensiveEffectsBps: Math.min(2_000, effects.reduce((sum, effect) => sum + (effect.quantity === "defense" ? effectWorth.defenseBps(effect) : 0), 0)),
        supplyRadius: effects.reduce((most, effect) => Math.max(most, effect.quantity === "supply" ? effectWorth.supplyRadius(effect) : 0), 0),
        builtAtStep: input.toDay,
        provenanceProjectId: project.id,
        effects: [...effects],
        upkeep: outcome.upkeep ?? null,
      });
      return { entityId: id, summary: `${outcome.label} [${id}] now stands in ${placeName} [${provinceId}].` };
    }

    if (outcome.kind === "agreement") {
      // An embassy that arrives, is heard and produces nothing has not
      // happened. "A protector for Messana was secured" with nobody named as
      // the protector was a project reporting itself complete and leaving the
      // world exactly as it was.
      const withPolityId = outcome.withPolityId;
      const sponsorPolityId = project.sponsorEntityRef.kind === "polity"
        ? project.sponsorEntityRef.id
        : input.world.characters.find((character) => character.id === project.sponsorEntityRef.id)?.polityId ?? null;
      if (withPolityId === null || sponsorPolityId === null || outcome.agreementKind === null) return null;
      if (withPolityId === sponsorPolityId) return null;
      const known = new Set(input.world.map.polities.map((polity) => polity.id));
      if (!known.has(withPolityId) || !known.has(sponsorPolityId)) return null;
      if (agreementsBetween(agreements, sponsorPolityId, withPolityId).some((agreement) => agreement.kind === outcome.agreementKind)) return null;
      const id = input.ids.next("agreement");
      agreements = [
        ...agreements.map((agreement) =>
          agreement.status === "active" && agreement.kind === "war" && between(agreement, sponsorPolityId, withPolityId) && outcome.agreementKind !== "war"
            ? { ...agreement, status: "ended" as const, endedAtStep: input.toDay, endedReason: outcome.label }
            : agreement),
        {
          id,
          kind: outcome.agreementKind,
          polityId: sponsorPolityId,
          otherPolityId: withPolityId,
          terms: outcome.label,
          sinceStep: input.toDay,
          untilStep: null,
          sourceMessageId: null,
          status: "active" as const,
          endedAtStep: null,
          endedReason: null,
          visibility: "public" as const,
        },
      ];
      return { entityId: id, summary: `Between ${sponsorPolityId} and ${withPolityId} there is now ${AGREEMENT_KIND_IN_WORDS[outcome.agreementKind]}: ${outcome.label}.` };
    }

    if (outcome.kind === "transfer") {
      // What a subsidy actually is: money reaching somebody, once, when the
      // arrangement is finished. Without it, "silver and supplies for the
      // protected ally" had nowhere to land but a project that produced
      // nothing and an ally the record never named.
      const toAccountId = outcome.beneficiaryAccountId;
      const fromAccountId = project.fundingAccountId ?? sponsorAccountId(project.sponsorEntityRef) ?? null;
      if (toAccountId === null || !accounts.some((account) => account.id === toAccountId)) return null;
      // Paying yourself moves nothing, and a transaction from an account to
      // itself is one the schema forbids -- so a levy "paid into the treasury"
      // by the treasury that sponsored it wrote a world that could not be
      // loaded again, and the save was lost on the turn after.
      if (fromAccountId === toAccountId) return null;
      const available = fromAccountId === null ? outcome.amount : balanceOf(fromAccountId);
      const handed = Math.min(outcome.amount, available);
      if (handed <= 0) return null;
      if (fromAccountId !== null) credit(fromAccountId, -handed);
      credit(toAccountId, handed);
      transactions.push({
        id: input.ids.next("txn"),
        atStep: input.toDay,
        kind: "transfer",
        amount: handed,
        ...(fromAccountId === null ? {} : { sourceAccountId: fromAccountId }),
        destinationAccountId: toAccountId,
        cause: { kind: "project_milestone", id: project.id, explanation: outcome.label },
        visibility: "polity",
      });
      const shortfall = outcome.amount - handed;
      return {
        entityId: toAccountId,
        summary: shortfall > 0
          ? `${handed} of the promised ${outcome.amount} reaches ${toAccountId}; ${shortfall} could not be found.`
          : `${handed} passes to ${toAccountId}.`,
      };
    }

    const beneficiaryId = outcome.beneficiaryAccountId;
    if (beneficiaryId === null || !accounts.some((account) => account.id === beneficiaryId)) return null;
    const cadence = outcome.cadenceDays ?? 30;
    const id = input.ids.next("income");
    // No richer than a great market in the place it stands (or the owner's
    // average province, where it stands nowhere): a finished work used to pay
    // whatever the model promised when it was begun, up to ten million a period.
    const worth = incomeCeilingOf(input.world, outcome.provinceId, beneficiaryId, cadence);
    const amount = Math.min(outcome.amount, worth);
    newIncome.push({
      id,
      kind: "trade",
      label: outcome.label,
      beneficiaryAccountId: beneficiaryId,
      originKind: "polity",
      originId: beneficiaryId,
      amount,
      cadenceSteps: cadence,
      nextDueStep: input.toDay + cadence,
      collectionRateBps: 10_000,
      counterpartyPolityId: null,
      active: true,
    });
    return { entityId: id, summary: `${outcome.label} [${id}] begins returning ${amount} every ${cadence} days.` };
  };

  const projects = input.world.projects.map((project) => {
      // "proposed" waits on the vote that would start it (`enact.ts`), and
      // goes with the measure if the measure fails.
      if (project.status === "proposed") {
        const procedureId = input.world.enactments.find((enactment) => enactment.projectId === project.id)?.procedureId;
        const procedure = input.world.material.politicalProcedures.find((candidate) => candidate.id === procedureId);
        const lost = procedure !== undefined && procedure.outcome !== null && procedure.outcome !== "passed";
        return lost ? { ...project, status: "cancelled" as const } : project;
      }
      if (project.status === "completed" || project.status === "cancelled" || project.status === "failed") return project;

      let milestones = project.milestones;
      let changed = false;
      for (let guard = 0; guard < MAX_PERIODS_PER_TICK; guard += 1) {
        const dueMilestone = nextDueMilestone({ ...project, milestones }, input.toDay);
        if (dueMilestone === undefined) break;
        // A crossing arranged from a shore waits for the army and its ships to
        // be standing on it: a march held up on the road does not leave the
        // fleet to sail empty (`passagePlanFor`).
        if (waitsForItsLegs(project, milestones, dueMilestone.id) || waitsForItsVote(project, dueMilestone.label)) {
          milestones = milestones.map((milestone) => milestone.id === dueMilestone.id ? { ...milestone, requiredAtElapsedOffset: milestone.requiredAtElapsedOffset + LEG_WAIT_DAYS } : milestone);
          changed = true;
          break;
        }
        // The sponsor pays. A milestone whose sponsor cannot cover it still
        // completes -- the work was done on credit, and the shortfall is the
        // sponsor's problem to answer for.
        // The chest it was paid from, which used to be read and dropped: a
        // convoy the Republic sent to Messana was charged to its consul's purse.
        const funderId = project.fundingAccountId ?? sponsorAccountId(project.sponsorEntityRef);
        const dueAtStep = project.startedAtStep + dueMilestone.requiredAtElapsedOffset;
        if (dueMilestone.costAmount > 0) {
          // A sponsor who cannot cover it still gets the work -- but the
          // shortfall is real and has to be said. Balances floor at zero and a
          // sponsor with no account at all pays nothing, so without this the
          // money simply vanished and nobody was answerable for it.
          // Money set aside for this work is spent first (`world/money-
          // reservations.ts`); money set aside for something else is not
          // this work's to spend, and never was.
          const reservation = project.reservationId === null ? undefined
            : reservations.find((candidate) => candidate.id === project.reservationId && candidate.status === "active" && candidate.accountId === funderId);
          const fromReserve = reservation === undefined ? 0 : Math.min(reservation.remainingAmount, dueMilestone.costAmount);
          const payable = funderId === undefined ? 0 : fromReserve + Math.min(spendableOf(funderId, reservation?.id ?? null) - fromReserve, dueMilestone.costAmount - fromReserve);
          const short = Math.max(0, dueMilestone.costAmount - Math.max(0, payable));
          if (reservation !== undefined && fromReserve > 0) {
            reservations = reservations.map((candidate) => candidate.id === reservation.id ? spendFromReservation(candidate, fromReserve, input.toDay) : candidate);
          }
          // Past what the order allowed: the work goes on -- a legate may
          // spend beyond his leave -- and the man who set the limit hears of it.
          if (reservation !== undefined && dueMilestone.costAmount > fromReserve && reservation.purposeKind === "order_part") {
            facts.push({
              localId: nextLocalId("envelope"),
              kind: "envelope_breach",
              summary: `${project.label} spent past what the order allowed: ${reservation.reservedAmount} was set aside, and ${dueMilestone.label.toLowerCase()} cost ${dueMilestone.costAmount - fromReserve} more.`.slice(0, 600),
              affectedRefs: [{ kind: "project", id: project.id }, ...(funderId === undefined ? [] : [{ kind: "account" as const, id: funderId }])],
              visibility: "polity",
              discoveryState: "polity",
              significance: 40,
              knowableInDays: 0,
            });
          }
          if (funderId !== undefined && payable > 0) {
            credit(funderId, -Math.max(0, payable));
            transactions.push({
              id: input.ids.next("txn"),
              atStep: dueAtStep,
              kind: "purchase",
              amount: Math.max(0, payable),
              sourceAccountId: funderId,
              cause: { kind: "project_milestone", id: project.id, explanation: dueMilestone.label },
              visibility: "polity",
            });
          }
          if (short > 0) {
            facts.push({
              localId: nextLocalId("shortfall"),
              kind: "project_shortfall",
              summary: `${project.label} could not be paid for in full: ${short} of ${dueMilestone.costAmount} was owed and not there.`,
              affectedRefs: funderId === undefined
                ? [{ kind: "project", id: project.id }]
                : [{ kind: "project", id: project.id }, { kind: "account", id: funderId }],
              visibility: "polity",
              discoveryState: "polity",
              significance: 45,
              knowableInDays: 0,
            });
            notes.push(`${project.label} was carried on credit: ${short} could not be found.`);
          }
        }
        milestones = milestones.map((milestone) =>
          milestone.id === dueMilestone.id ? { ...milestone, status: "completed" as const, completedAtStep: input.toDay } : milestone,
        );
        changed = true;
        facts.push({
          localId: nextLocalId("milestone"),
          kind: "project_milestone",
          summary: `${project.label}: ${dueMilestone.label}.`,
          affectedRefs: [{ kind: "project", id: project.id }],
          visibility: "polity",
          discoveryState: "polity",
          knowableInDays: 0,
          significance: 20,
        });
        notes.push(`${project.label} reached a milestone: ${dueMilestone.label}.`);
      }

      if (!changed) return project;
      const finished = milestones.every((milestone) => milestone.status !== "pending");
      if (!finished) {
        // Never clear a completion date that was already set: a project that is
        // finished stays finished.
        return { ...project, milestones, status: "in_progress" as const, completedAtStep: project.completedAtStep };
      }

      // What the effort was actually for. Until this existed a completed naval
      // expansion produced no ships -- the project was marked done and the
      // world was exactly as it had been.
      const produced = produceOutcome(project);
      // An effort that declared no product makes no news of finishing.
      //
      // "The scheme for providing silver and supplies to the protected ally was
      // completed" -- with no ally named, no silver moved and nothing in the
      // world changed -- was a project whose whole content was drafting a plan,
      // reported to the ruler as an event. A completion is history when
      // something exists afterwards that did not before; otherwise it is the
      // clerk's ledger, and the Chronicle is not a ledger. The project still
      // completes; it simply does not announce itself.
      const declaredNothing = project.completionOutcome === null || project.completionOutcome.kind === "none";
      if (!declaredNothing) {
        facts.push({
          localId: nextLocalId("project"),
          kind: "project_completed",
          summary: produced === null
            // Declared a product and could not deliver it: worth knowing, and
            // not the same as having promised nothing.
            ? `${project.label} is complete, but produced nothing it was meant to.${unproduced.has(project.id) ? ` ${unproduced.get(project.id)}` : ""}`.slice(0, 600)
            : `${project.label} is complete: ${produced.summary}`.slice(0, 600),
          affectedRefs: [{ kind: "project", id: project.id }],
          visibility: "public",
          discoveryState: "public",
          knowableInDays: 0,
          // Something now exists that did not before, which is a different order
          // of event from a milestone being reached.
          significance: produced === null ? 45 : 60,
        });
      }
      notes.push(produced === null ? `${project.label} is complete.` : `${project.label} is complete: ${produced.summary}`);

      // A journey that could not be made has not been made: the army is where
      // it was, and the order that sent it is stopped, not done.
      const stranded = produced === null && project.completionOutcome?.kind === "force_move" && unproduced.has(project.id);
      return {
        ...project,
        milestones,
        status: stranded ? "failed" as const : "completed" as const,
        completedAtStep: input.toDay,
        linkedEntityIds: produced === null ? project.linkedEntityIds : [...project.linkedEntityIds, produced.entityId].slice(0, 20),
      };
  });

  /**
   * Provinces heal, or fail to.
   *
   * War damage decays, displaced people drift home, food security and order
   * recover toward their baseline -- all of which the material module could
   * already compute and nothing ever called, so a province burned in one order
   * stayed burned forever. Nothing here is affected by this tick's own work, so
   * every province takes the coarse recovery pass.
   */
  const before = new Map(input.world.material.provinceMaterial.map((material) => [material.provinceId, material]));
  const standingWorld = structures.length === 0 ? input.world : { ...input.world, structures: [...input.world.structures, ...structures] };
  const materialAdvanced = advanceProvinceMaterial(
    {
      ...input.world,
      projects,
      structures: structures.length === 0 ? input.world.structures : [...input.world.structures, ...structures],
      material: {
        ...input.world.material,
        provinceMaterial: leviedWorld?.material.provinceMaterial ?? input.world.material.provinceMaterial,
        accounts,
        reservations,
        incomeSources: newIncome.length === 0 ? incomeSources : [...incomeSources, ...newIncome],
        obligations: newPay.length === 0 ? servicedObligations : [...servicedObligations, ...newPay],
        loans,
        forces: [
          ...unpaidForces.map((force) => {
            const arrived = movedForces.get(force.id);
            const toll = tolledOnTheRoad.get(force.id);
            const tolled = toll === undefined ? force : { ...force, personnel: toll.personnel, authorizedStrength: toll.authorizedStrength, moraleBps: toll.moraleBps, fatigueBps: toll.fatigueBps, history: toll.history };
            return arrived === undefined ? tolled : { ...tolled, locationId: arrived.locationId, positionId: arrived.positionId };
          }),
          ...forces,
        ],
        transactions: transactions.slice(-500),
      },
    },
    input.toDay,
    new Set<string>(),
    // Where each province settles to, given what stands in it -- and given
    // what its government is taking out of it.
    // And, where the harvest decides what there is, food comes back slowly between harvests.
    betweenHarvests(withGovernment(withTaxUnrest(provinceTargetsFrom(standingWorld), input.world, burdens), input.world, inCharge), input.world, input.clock),
  );
  // Who has held what, written down before any term ends -- so the man whose
  // year ran out today is remembered as having held it.
  // An ally offered union and unable, or slow, to answer is answered by rule, before silence is counted (`submission.ts`).
  const recovered = settleUnionOffers(recordTenures(materialAdvanced, input.toDay), input.toDay, facts);

  // Collectors who came back short. Once a tick per power, not per payment:
  // it is the kind of thing a government hears about and has to answer for.
  for (const [polityId, tally] of shortfalls) {
    const name = input.world.map.polities.find((polity) => polity.id === polityId)?.name ?? polityId;
    facts.push({
      localId: nextLocalId("tax_short"),
      kind: "tax_shortfall",
      summary: `${name} asked more of its lands than they could bear: of ${tally.asked} due in taxes and dues, the collectors raised ${tally.raised}.`,
      affectedRefs: [{ kind: "polity", id: polityId }],
      visibility: "polity",
      discoveryState: "polity",
      knowableInDays: 0,
      significance: 45,
    });
  }

  // Recovery itself is not news. A province crossing into real hunger or real
  // disorder is: it is the kind of thing a government hears about and has to
  // answer for, and it is where VISION §6's numbers start to bite.
  //
  // One report a power per review, not one a province: with thousands of
  // provinces a bad season is a country's news. Only provinces something is
  // going on in are counted (`liveProvinceIds`); the biggest are named first
  // and the rest counted.
  const DISTRESS_BPS = 4_000;
  const NAMED_IN_DISTRESS = 4;
  const live = liveProvinceIds(recovered);
  const provinceById = new Map(recovered.map.provinces.map((province) => [province.id, province]));
  const hungry = new Map<string, ProvinceMaterial[]>();
  const disorderly = new Map<string, ProvinceMaterial[]>();
  for (const material of recovered.material.provinceMaterial) {
    const previous = before.get(material.provinceId);
    const province = provinceById.get(material.provinceId);
    // Ground nobody holds has no government to hear of its hunger or its disorder.
    if (previous === undefined || province === undefined || province.controllerPolityId === null || !live.has(material.provinceId)) continue;
    const holder = province.controllerPolityId;
    const crossed = (now: number, was: number): boolean => now < DISTRESS_BPS && was >= DISTRESS_BPS;
    if (crossed(material.foodSecurityBps, previous.foodSecurityBps)) hungry.set(holder, [...(hungry.get(holder) ?? []), material]);
    if (crossed(material.stabilityBps, previous.stabilityBps)) disorderly.set(holder, [...(disorderly.get(holder) ?? []), material]);
  }
  const reportDistress = (groups: ReadonlyMap<string, readonly ProvinceMaterial[]>, kind: string, prefix: string, phrase: (where: string) => string, significance: number): void => {
    for (const [holder, rows] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const ranked = [...rows].sort((a, b) => b.population - a.population || a.provinceId.localeCompare(b.provinceId));
      const named = ranked.slice(0, NAMED_IN_DISTRESS).map((row) => provinceById.get(row.provinceId)!.name);
      const polityName = recovered.map.polities.find((polity) => polity.id === holder)?.name;
      const rest = ranked.length - named.length;
      const where = rest > 0
        ? `${named.join(", ")} and ${rest} more of ${polityName === undefined ? "the unclaimed" : `${polityName}'s`} provinces`
        : named.length === 1 ? named[0]! : `${named.slice(0, -1).join(", ")} and ${named.at(-1)!}`;
      const summary = `${phrase(where)}.`;
      facts.push({
        localId: nextLocalId(prefix),
        kind,
        summary,
        affectedRefs: [
          ...(polityName === undefined ? [] : [{ kind: "polity" as const, id: holder }]),
          ...ranked.slice(0, 8).map((row) => ({ kind: "province" as const, id: row.provinceId })),
        ],
        visibility: "polity",
        discoveryState: "polity",
        knowableInDays: 0,
        significance: Math.min(significance + 10, significance + Math.round(Math.log2(ranked.length)) * 2),
      });
      notes.push(summary);
    }
  };
  reportDistress(hungry, "province_hunger", "hunger", (where) => `Food is running short in ${where}`, 55);
  reportDistress(disorderly, "province_unrest", "unrest", (where) => `Order is breaking down in ${where}`, 60);

  // A thread nobody has touched for half a year has run its course. Closing
  // it is bookkeeping, not history: no fact, a note only.
  const stale = recovered.storylines.filter((storyline) => storyline.phase !== "closed" && input.toDay - storyline.updatedAtStep >= STORYLINE_IDLE_DAYS);
  const storylines = stale.length === 0
    ? recovered.storylines
    : recovered.storylines.map((storyline) =>
      stale.includes(storyline) ? { ...storyline, phase: "closed" as const, closedAtStep: input.toDay, updatedAtStep: input.toDay } : storyline,
    );
  for (const storyline of stale) notes.push(`The matter of ${storyline.title} has gone quiet.`);
  // Engine paths open threads without asking; the world's cap is kept here (E24).
  const capped = sweepThreadsOverTheCap(recovered, storylines, input.toDay);
  for (const storyline of capped.closed) notes.push(`The matter of ${storyline.title} has been set aside.`);

  /**
   * Letters whose term has run out.
   *
   * Silence is an answer, and the harshest one the trust table holds. Without
   * this a power could put an ultimatum to another and simply never hear back:
   * the letter would sit in the world forever, and refusing by saying nothing
   * -- which is most of how powers actually refuse -- would cost nothing.
   */
  let polityStances = recovered.polityStances;
  const unread = (message: (typeof recovered.diplomacy)[number]): boolean => {
    if (message.toCharacterId === null || message.toCharacterId === input.playerCharacterId) return false;
    // Put to him, and the burst never got round to asking him what he said:
    // his turn is owed him, and his silence is not yet his (E06).
    if (message.putToRecipientOnDay != null) return isOwedATurn(recovered, message.toCharacterId);
    return recovered.characters.some((character) => character.id === message.toCharacterId && character.alive);
  };
  const polityName = (id: string): string => recovered.map.polities.find((polity) => polity.id === id)?.name ?? id;
  const silenced: (typeof recovered.diplomacy)[number][] = [];
  const diplomacy = recovered.diplomacy.map((message) => {
    if (message.status !== "awaiting_reply" || message.replyDueByStep === null || message.replyDueByStep > input.toDay) return message;
    // Nobody has read it yet, so nobody has chosen to say nothing. It waits
    // for its reader to be asked -- the next round, or the next burst -- and
    // lapses on the first day past its term after that. The player reads his
    // letters on his desk, so his silence is always his own.
    if (unread(message)) return message;
    // Answered in a letter of its own. Clepsina wrote to the Apulians "you
    // shall have these thirty days", as a new letter rather than a reply, and
    // their request lapsed a week later as Rome refusing them by silence. A
    // letter back to the sender's power, written after this one arrived, is
    // the answer to it -- whatever it says, it is not silence. Written after
    // it arrived: a letter crossing it on the road answers nothing.
    // Not an ultimatum: a demand is met or it is not, and a letter about
    // something else is no answer to it.
    const wroteBack = message.kind === "ultimatum" ? undefined : recovered.diplomacy.find((other) => other.id !== message.id
      && other.fromPolityId === message.toPolityId && other.toPolityId === message.fromPolityId
      && other.sentAtStep >= (message.deliveredOnDay ?? message.sentAtStep)
      && (other.inReplyToMessageId === message.id || sameNegotiation(message, other)));
    if (wroteBack !== undefined) {
      return { ...message, status: "answered" as const, answer: "countered" as const, answerText: `Answered in "${wroteBack.subject}".`.slice(0, 600), answeredAtStep: wroteBack.sentAtStep };
    }
    const ignored = { ...message, status: "answered" as const, answer: "ignored" as const, answerText: "No answer came.", answeredAtStep: input.toDay };
    if (diplomaticAnswerChangesTrust(recovered.diplomacy, ignored)) polityStances = [...applyDiplomaticAnswerToStance(polityStances, ignored, input.toDay)];
    silenced.push(message);
    // An ultimatum's threat, carried out when its term runs out unanswered.
    // A threat that waits on an attack stands on silence; it is not carried out by it.
    if ((message.onRefusal === "war" || message.onRefusal === "war_if_attacked") && threatWaitsOnAttack(message)) {
      return { ...ignored, threatStandsSince: input.toDay };
    }
    if (message.onRefusal === "war" && !atWar(agreements, message.fromPolityId, message.toPolityId)) {
      agreements = openWar(agreements, {
        id: input.ids.next("agreement"),
        polityId: message.fromPolityId,
        otherPolityId: message.toPolityId,
        terms: message.terms.slice(0, 600),
        atStep: input.toDay,
        sourceMessageId: message.id,
        reason: `${polityName(message.toPolityId)} sent no answer to "${message.subject}".`,
      });
      facts.push({
        localId: nextLocalId("threat"),
        kind: "war_declared",
        summary: `${polityName(message.fromPolityId)} made war on ${polityName(message.toPolityId)}, as "${message.subject}" had said it would if no answer came.`,
        affectedRefs: [{ kind: "polity", id: message.fromPolityId }, { kind: "polity", id: message.toPolityId }],
        visibility: "public",
        discoveryState: "public",
        knowableInDays: 0,
        significance: 70,
      });
    }
    return ignored;
  });
  // One letter sent to many is one matter, and its silences one fact. Rome's
  // call for aid went to eight allies; six said nothing, and the Chronicle
  // told four of them as four entries and never mentioned the other two.
  const circulars = new Map<string, (typeof recovered.diplomacy)[number][]>();
  for (const message of silenced) {
    const key = `${message.fromPolityId}|${message.fromCharacterId}|${message.subject}|${message.sentAtStep}`;
    circulars.set(key, [...(circulars.get(key) ?? []), message]);
  }
  for (const letters of circulars.values()) {
    const first = letters[0]!;
    const names = letters.map((message) => polityName(message.toPolityId));
    const who = names.length === 1 ? names[0]! : `${names.slice(0, -1).join(", ")} and ${names.at(-1)!}`;
    facts.push({
      localId: nextLocalId("letter"),
      kind: "diplomatic_silence",
      // Written as the act it is, not as the deadline that revealed it. "Let
      // the term run out" is a clerk noticing a date; a chronicler cannot make
      // an event of it, and tried -- an entry headlined "Roman Republic Lets
      // the Term on Messanan Protection Expire" said nothing had happened, at
      // length. Refusing by saying nothing is a refusal, and worth as much.
      summary: `${who} refused ${polityName(first.fromPolityId)} by silence on "${first.subject}", sending no answer at all.`,
      affectedRefs: [{ kind: "polity", id: first.fromPolityId }, ...letters.map((message) => ({ kind: "polity" as const, id: message.toPolityId }))],
      visibility: "polity",
      discoveryState: "polity",
      knowableInDays: 0,
      // Six allies saying nothing weighs more than one.
      significance: Math.min(70, 45 + 5 * (letters.length - 1)),
    });
    notes.push(`No answer came to ${polityName(first.fromPolityId)}'s letter on ${first.subject}${letters.length > 1 ? ` from ${who}` : ""}.`);
  }

  // A term ends the day it ends, whether or not anybody remembers it.
  //
  // `termExpiresAtStep` has been on every office seat since the character
  // system was written and nothing has ever read it, so a consulship held for
  // a year was held for ever. `deriveOfficeGrants` expires the *grant* on the
  // same date, which made it worse than useless: the man went on being the
  // consul everywhere a character is read while quietly holding none of the
  // consul's powers.
  const expiredSeats = recovered.material.officeSeats.filter(
    (seat) => seat.status === "held" && seat.termExpiresAtStep !== null && seat.termExpiresAtStep <= input.toDay,
  );
  // A successor elected ahead takes the seat the day it falls vacant, for a
  // term as long as the one that ended (`holdElections`, consuls designate).
  const designateOf = (seat: (typeof expiredSeats)[number]): string | null => {
    const id = seat.designateCharacterId ?? null;
    return id !== null && recovered.characters.some((character) => character.id === id && character.alive) ? id : null;
  };
  const officeSeats = expiredSeats.length === 0
    ? recovered.material.officeSeats
    : recovered.material.officeSeats.map((seat) => {
      if (!expiredSeats.some((expired) => expired.id === seat.id)) return seat;
      const successor = designateOf(seat);
      if (successor === null) return { ...seat, status: "vacant" as const, vacancyCause: "term_expired" as const, holderCharacterId: null, designateCharacterId: null };
      const span = seat.termStartedAtStep !== null && seat.termExpiresAtStep !== null && seat.termExpiresAtStep > seat.termStartedAtStep ? seat.termExpiresAtStep - seat.termStartedAtStep : 365;
      return { ...seat, status: "held" as const, vacancyCause: "none" as const, holderCharacterId: successor, designateCharacterId: null, termStartedAtStep: input.toDay, termExpiresAtStep: input.toDay + span };
    });
  for (const seat of expiredSeats) {
    const successor = designateOf(seat);
    if (successor === null) continue;
    const office = allOffices(recovered, input.government?.offices ?? []).find((candidate) => candidate.id === seat.officeId);
    const name = recovered.characters.find((character) => character.id === successor)?.name ?? successor;
    facts.push({
      localId: nextLocalId("term"),
      kind: "office_taken_up",
      summary: `${name} took office${office === undefined ? "" : ` as ${office.label}`}, elected the term before.`,
      affectedRefs: [{ kind: "character", id: successor }, ...(office === undefined ? [] : [{ kind: "polity" as const, id: office.polityId }])],
      visibility: "public",
      discoveryState: "public",
      knowableInDays: 0,
      significance: 35,
    });
  }
  const laidDown = new Set(expiredSeats.flatMap((seat) => (seat.holderCharacterId === null ? [] : [seat.holderCharacterId])));
  // A far power's calendar is its own people's news, not Rome's (`far-powers.ts`).
  const near = expiredSeats.length === 0 ? null : powersNearThePlayer(recovered, input.playerCharacterId);
  const officesNow = allOffices(recovered, input.government?.offices ?? []);
  for (const seat of expiredSeats) {
    if (seat.holderCharacterId === null) continue;
    const who = recovered.characters.find((character) => character.id === seat.holderCharacterId)?.name ?? seat.holderCharacterId;
    const office = officesNow.find((candidate) => candidate.id === seat.officeId);
    const reach = newsReach(near, office?.polityId);
    facts.push({
      localId: nextLocalId("term"),
      kind: "office_term_ended",
      summary: `${who} laid down his office${office === undefined ? "" : ` of ${office.label}`} at the end of its term.`,
      affectedRefs: [{ kind: "character", id: seat.holderCharacterId }, ...(office === undefined ? [] : [{ kind: "polity" as const, id: office.polityId }])],
      visibility: reach,
      discoveryState: reach,
      knowableInDays: 0,
      // A magistracy running out on the calendar is ordinary. Who holds it
      // next is the news, and the election says so (`holdElections`).
      significance: 20,
    });
  }

  // A truce with a term ends the day its term does, whether or not anybody
  // remembers it. One that ends only when somebody says so is a peace.
  const polityAgreements = expireDatedAgreements(agreements, input.toDay);
  for (const agreement of polityAgreements) {
    const before = recovered.polityAgreements.find((candidate) => candidate.id === agreement.id);
    if (before?.status === "active" && agreement.status === "ended") {
      facts.push({
        localId: nextLocalId("agreement"),
        kind: "agreement_lapsed",
        summary: `The ${AGREEMENT_KIND_IN_WORDS[agreement.kind]} between ${polityName(agreement.polityId)} and ${polityName(agreement.otherPolityId)} has run out.`,
        affectedRefs: [{ kind: "polity", id: agreement.polityId }, { kind: "polity", id: agreement.otherPolityId }],
        visibility: "public",
        discoveryState: "public",
        knowableInDays: 0,
        significance: 55,
      });
    }
  }

  // The map's picture of the fighting, recomputed from the world that is:
  // wars from the agreements that are the wars, sieges from the projects
  // prosecuting them. Battles are left alone -- they are moments, and the
  // engagement that caused one records it.
  const afterTime = projectConflictsInto({
    ...recovered,
    // Ground held with no war left under it is the holder's (`settleOrphanedOccupations`).
    map: { ...recovered.map, provinces: settleOrphanedOccupations(recovered.map.provinces, polityAgreements, input.toDay) as typeof recovered.map.provinces },
    storylines: capped.storylines,
    diplomacy,
    polityStances,
    polityAgreements,
    // Aims that say the wars that are, and not the ones that ended.
    polityOutlooks: aimsAtWar(recovered.polityOutlooks, (polityId) => warsOf(polityAgreements, polityId), polityName, input.toDay, {
      leaderOf: (polityId) => leaderOf(polityAgreements, polityId),
      ownEnemiesOf: (polityId) => polityAgreements
        .filter((agreement) => agreement.status === "active" && agreement.kind === "war" && (agreement.polityId === polityId || agreement.otherPolityId === polityId))
        .map((agreement) => (agreement.polityId === polityId ? agreement.otherPolityId : agreement.polityId)),
    }),
    material: { ...recovered.material, officeSeats },
    // The mirror on the character, which the seat cannot reach on its own.
    // A year in office teaches the office: two points of what it asked of him.
    characters: laidDown.size === 0 && !expiredSeats.some((seat) => designateOf(seat) !== null)
      ? recovered.characters
      : recovered.characters.map((character) => {
        const takesUp = expiredSeats.find((seat) => designateOf(seat) === character.id)?.officeId;
        if (!laidDown.has(character.id)) return takesUp === undefined ? character : { ...character, officeId: takesUp };
        const held = expiredSeats.find((seat) => seat.holderCharacterId === character.id)?.officeId ?? "";
        return { ...learnedInOffice(character, taughtBy(input.world, held)), officeId: takesUp ?? null };
      }),
  });

  // Last, because a man who died today should not also have his wages paid and
  // his term expired today -- and because vacating a seat after the term check
  // means a death and an expiry cannot both claim the same seat.
  // Plans laid in advance, before anything that could make one moot: a trap
  // springs on men who walked into it during this tick, and it springs before
  // they are paid, fed or reviewed.
  // What made things do this month: their keep paid, their yield banked,
  // their converts made -- or, unpaid, their falling into disuse.
  // A venture stopping, or starting again, is news to the man whose money is
  // in it -- and to his own side, whose ports it is.
  const ventures = afterTime.material.ventures.map((venture) => {
    if (!ventureState.has(venture.id)) return venture;
    const cut = ventureState.get(venture.id) ?? null;
    if (cut === venture.interruptedBy) return venture;
    const owner = afterTime.characters.find((character) => character.id === venture.ownerCharacterId);
    const why = cut === "war" ? "the war with the power at its other end" : "an enemy fleet off its port";
    facts.push({
      localId: nextLocalId("venture"),
      kind: cut === null ? "venture_resumed" : "venture_interrupted",
      summary: cut === null
        ? `${venture.title} is trading again.`
        : `${venture.title} has stopped: ${why} has closed it.`,
      affectedRefs: [
        { kind: "character", id: venture.ownerCharacterId },
        { kind: "province", id: venture.fromProvinceId },
        { kind: "province", id: venture.toProvinceId },
        ...(owner?.polityId == null ? [] : [{ kind: "polity" as const, id: owner.polityId }]),
      ],
      visibility: "polity",
      discoveryState: "polity",
      knowableInDays: 0,
      significance: 40,
    });
    return { ...venture, interruptedBy: cut };
  });
  const afterVentures = ventures.every((venture, index) => venture === afterTime.material.ventures[index])
    ? afterTime
    : { ...afterTime, material: { ...afterTime.material, ventures } };

  const mended = lapseAilments(returnTheMended(afterVentures, input.toDay), input.toDay);
  facts.push(...mended.facts);
  // Armies in the field eat, sicken and rest (`campaign.ts`) -- the besiegers
  // among them, before the siege is pressed.
  // New men drawn up, drill and seasons, a doctrine's keep, and the men in
  // the ranks -- their places, campaigns, discharges and promotions
  // (`ranks.ts`). Before the field is kept, which counts the same days.
  const ranked = keepTheRanks({ world: mended.world, toDay: input.toDay, warfare: input.warfare, ids: input.ids, playerCharacterId: input.playerCharacterId ?? null });
  facts.push(...ranked.facts);
  const fielded = keepTheField({ world: ranked.world, toDay: input.toDay, month, warfare: input.warfare === undefined ? undefined : warfareWith(ranked.world, input.warfare) });
  facts.push(...fielded.facts);
  const besieged = pressSieges(fielded.world, input.toDay, { warfare: input.warfare, ids: input.ids, playerCharacterId: input.playerCharacterId ?? null });
  facts.push(...besieged.facts);
  // Fights begun by an order go on, a round a day, until one side is beaten
  // (`engagements.ts`); enemy armies that only stand facing each other are
  // noticed, and nothing more -- after the siege, whose lines are its own.
  const fought = input.warfare === undefined
    ? { world: besieged.world, facts: [] as FactProposalDraft[], battles: [] as BattleAccount[] }
    : fightEngagements({ world: besieged.world, toDay: input.toDay, warfare: input.warfare, ids: input.ids, playerCharacterId: input.playerCharacterId ?? null });
  facts.push(...fought.facts);
  const faced = input.warfare === undefined ? { world: fought.world, facts: [] as FactProposalDraft[] } : noteWhoFaces(fought.world, input.toDay, input.warfare, input.ids);
  facts.push(...faced.facts);
  // Bread on the road arrives, or is taken; fleets off ports are kept as blockades.
  const delivered = deliverConvoys(faced.world, input.toDay, input.warfare);
  facts.push(...delivered.facts);
  const blockading = keepBlockades(delivered.world, input.toDay, input.warfare, input.ids);
  facts.push(...blockading.facts);
  const met = { world: blockading.world, battles: fought.battles };
  // The land reckoned for the month and the year; what treaties and debts
  // make happen; and misery and ambition that turn to risings and civil war --
  // before powers are reviewed, so a province full of yearning rises today.
  const land = reviewTheLand({ world: met.world, toDay: input.toDay, clock: input.clock });
  facts.push(...land.facts);
  const playerPolityId = input.playerCharacterId == null ? null : land.world.characters.find((character) => character.id === input.playerCharacterId)?.polityId ?? null;
  const treaties = keepTreaties({ world: land.world, toDay: input.toDay, ids: input.ids, playerPolityId });
  facts.push(...treaties.facts);
  const debts = settleDebts({ before: input.world, world: treaties.world });
  facts.push(...debts.facts);
  // Promises between people, settled on their day by what was done (`promises.ts`).
  const promised = keepPromises({ world: debts.world, toDay: input.toDay, playerCharacterId: input.playerCharacterId ?? null });
  facts.push(...promised.facts);
  const unrest = reviewUnrest({ world: promised.world, toDay: input.toDay, months: land.months, ids: input.ids, burdens, government: input.government, playerCharacterId: input.playerCharacterId ?? null });
  facts.push(...unrest.facts);
  // Powers with nothing left end; ground that wants its own rises for it.
  const powers = reviewPowers(unrest.world, input.toDay, input.ids, playerPolityId);
  facts.push(...powers.facts);
  const standing = settleStandingEffects({ world: powers.world, toDay: input.toDay, ids: input.ids });
  facts.push(...standing.facts);

  const plans = reviewContingencies({
    world: standing.world,
    toDay: input.toDay,
    ids: input.ids,
    ...(input.warfare === undefined ? {} : { warfare: input.warfare }),
    playerCharacterId: input.playerCharacterId ?? null,
  });

  // Plots first, and for the same reason lives are last: a man killed by one
  // should not also have his wages paid and his term expired on the day he
  // died, and a man killed by one should not then be given a life review.
  const plots = resolvePlots({
    world: plans.world,
    toDay: input.toDay,
    ids: input.ids,
    ...(input.life === undefined ? {} : { life: input.life }),
    ...(input.playerCharacterId === undefined ? {} : { playerCharacterId: input.playerCharacterId }),
  });

  const lives = input.life === undefined
    ? { world: plots.world, facts: [] as FactProposalDraft[], died: [] as readonly string[] }
    : reviewLives({
      world: plots.world,
      life: input.life,
      toDay: input.toDay,
      ids: input.ids,
      ...(input.playerCharacterId === undefined ? {} : { playerCharacterId: input.playerCharacterId }),
    });

  // Contracts whose pay was missed today, or whose term or man ran out.
  const contracts = keepContracts(lives.world, input.toDay);

  // A throne that passes by blood is filled by blood, the day it falls
  // vacant -- after lives, so a king who died today is followed today.
  const thrones = input.government === undefined
    ? { world: contracts.world, facts: [] as readonly FactProposalDraft[] }
    // Every power has a constitution from the first review on: grown from its
    // form where the scenario wrote none (silent -- it was always there).
    : keepThrones({ world: ensureConstitutions({ world: contracts.world, government: input.government, toDay: input.toDay }), government: input.government, toDay: input.toDay, ...(input.playerCharacterId === undefined ? {} : { playerCharacterId: input.playerCharacterId }) });

  // After lives, so a magistrate who died today leaves a seat the living are
  // told about today.
  const elections = input.government === undefined
    ? { world: thrones.world, facts: [] as readonly FactProposalDraft[] }
    : holdElections({
      world: thrones.world,
      government: input.government,
      toDay: input.toDay,
      ids: input.ids,
      ...(input.playerCharacterId === undefined ? {} : { playerCharacterId: input.playerCharacterId }),
    });

  // And every other question before a chamber whose day has come is counted.
  const votes = input.government === undefined
    ? { world: elections.world, facts: [] as readonly FactProposalDraft[] }
    : holdVotes({ world: elections.world, offices: input.government.offices, successionRules: input.government.successionRules, toDay: input.toDay, ids: input.ids });

  // What a year's end does to a commander's army: prorogued, kept until his
  // successor arrives, handed over -- and what he answers for, out of office.
  const tenure = input.government === undefined
    ? { world: votes.world, facts: [] as readonly FactProposalDraft[] }
    : keepCommandTenure({
      world: votes.world, government: input.government, toDay: input.toDay, ids: input.ids,
      endedTerms: expiredSeats.flatMap((seat) => (seat.holderCharacterId === null || seat.termExpiresAtStep === null ? [] : [{ characterId: seat.holderCharacterId, officeId: seat.officeId, seatId: seat.id, endedAtStep: seat.termExpiresAtStep }])),
      playerCharacterId: input.playerCharacterId ?? null,
    });

  // Once a month the world is read for its groups; and whoever could take a
  // moment to change a government is told it is there.
  const society = input.government === undefined
    ? { world: tenure.world, facts: [] as readonly FactProposalDraft[] }
    : reviewSociety({ world: tenure.world, government: input.government, warfare: input.warfare, toDay: input.toDay, ids: input.ids });
  const opened = input.government === undefined
    ? society.world
    : raiseOpenings({ world: society.world, government: input.government, toDay: input.toDay, ...(input.playerCharacterId === undefined ? {} : { playerCharacterId: input.playerCharacterId }) });

  // Departments that have finished forming take their work, and the rest
  // learn a day's worth of it.
  const kept = keepDepartments(opened, input.toDay, input.world);
  // Every open work has a man over it; a new one, or one whose man is gone, gets one.
  // Posts made and left empty are filled; then every open work gets a man over it.
  const appointed = input.government === undefined
    ? { world: kept.world, facts: [] as readonly FactProposalDraft[] }
    : fillAppointments({ world: kept.world, government: input.government, toDay: input.toDay, playerCharacterId: input.playerCharacterId ?? null });
  const overseen = assignOverseers(appointed.world, input.playerCharacterId ?? null);
  // And once a year, what age and disuse have done to everybody's gifts.
  const aged = reviewSkills(overseen, input.toDay);

  // Last: the day's armies stand where the day left them, and the open
  // country they stand in at war is theirs to hold (`occupation.ts`).
  const occupied = occupyOpenCountry(aged, input.toDay);
  return {
    world: reconcileCapitals(occupied.world),
    factProposals: [...facts, ...plans.facts, ...plots.facts, ...lives.facts, ...contracts.facts, ...thrones.facts, ...elections.facts, ...votes.facts, ...tenure.facts, ...society.facts, ...kept.facts, ...appointed.facts, ...occupied.facts],
    notes,
    died: [...plots.died, ...lives.died],
    sprungContingencies: plans.sprung,
    contingencyBattles: [...intercepted.battles, ...besieged.battles, ...met.battles, ...plans.battles],
  };
}

/**
 * The province (and, where it is his capital, the city) a finished building
 * stands in, and whose it is: what the project named, else where its sponsor
 * is, else the sponsor's (or paying treasury's) power's capital, else any
 * province that power holds.
 */
export function structureSite(
  world: WorldState,
  project: Project,
  namedProvinceId: string | null,
  namedPolityId: string | null,
): { provinceId: string; settlementId: string | null; polityId: string | null } | null {
  const exists = (id: string | null | undefined): id is string => id != null && world.map.provinces.some((province) => province.id === id);
  const sponsor = project.sponsorEntityRef;
  const person = sponsor.kind === "character" ? world.characters.find((character) => character.id === sponsor.id) : undefined;
  const payer = project.fundingAccountId == null ? undefined : world.material.accounts.find((account) => account.id === project.fundingAccountId)?.owner;
  const polityId = namedPolityId
    ?? (sponsor.kind === "polity" ? sponsor.id : null)
    ?? (payer?.kind === "polity" ? payer.id : null)
    ?? person?.polityId
    ?? null;
  const polity = polityId === null ? undefined : world.map.polities.find((candidate) => candidate.id === polityId);
  const capitalProvince = polity?.capitalSettlementId == null
    ? undefined
    : world.map.provinces.find((province) => province.settlements.some((settlement) => settlement.id === polity.capitalSettlementId));
  const provinceId = exists(namedProvinceId) ? namedProvinceId
    : exists(person?.locationProvinceId) ? person.locationProvinceId
    : capitalProvince?.id
      ?? (polityId === null ? undefined : world.map.provinces.find((province) => province.controllerPolityId === polityId)?.id)
      ?? null;
  if (provinceId === null) return null;
  const settlementId = capitalProvince !== undefined && capitalProvince.id === provinceId ? polity!.capitalSettlementId! : null;
  // A private man's building is his power's to tax and defend; the owner of
  // record is the power, as it always was for a named polity.
  return { provinceId, settlementId, polityId };
}

/**
 * How open a trading end is, in basis points: whole in peace; a third when
 * its holder is at war; a fifth when it is occupied by somebody else or under
 * blockade. What a war abroad does to a merchant who never sees it.
 */
export function routeOpenBps(world: WorldState, provinceId: string): number {
  const province = world.map.provinces.find((candidate) => candidate.id === provinceId);
  if (province === undefined || province.controllerPolityId === null) return 10_000;
  const blockaded = world.blockades.some((blockade) => blockade.provinceId === provinceId && blockade.status === "active");
  if (isOccupied(province) || blockaded) return 2_000;
  return warsOf(world.polityAgreements, province.controllerPolityId).length > 0 ? 3_500 : 10_000;
}
