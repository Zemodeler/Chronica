import {
  AGREEMENT_KIND_IN_WORDS,
  DEFAULT_STRUCTURE_EFFECTS,
  effectWorth,
  advanceProvinceMaterial,
  applyDiplomaticAnswerToStance,
  domesticRevenuePolity,
  provinceTaxCapacity,
  taxBurdens,
  agreementsBetween,
  atWar,
  expireDatedAgreements,
  hopsBetween,
  isNavalForce,
  nextDueMilestone,
  warfareWith,
  type FactProposalDraft,
  type MoneyObligation,
  type ProvinceTargets,
  type ScenarioLifeRules,
  type ScenarioWarfareRules,
  type MoneyTransaction,
  type WorldState,
  recordTenures,
} from "@chronica/shared";
import { projectConflicts } from "./conflicts";
import { trespassOf } from "./trespass";
import { provinceTargetsFrom, settleStandingEffects } from "./standing-effects";
import { reviewLives } from "./mortality";
import { resolvePlots } from "./plots";
import { reviewContingencies } from "./contingencies";
import type { BattleAccount } from "./battle";
import type { IdFactory } from "./ports";
import { holdElections, type ElectionGovernment } from "./elections";
import { keepContracts } from "./contracts";

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
  /** Battles the ambush half of a sprung plan started, for whoever writes them up. */
  readonly contingencyBattles: readonly BattleAccount[];
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

export function runDeterministicTick(input: TickInput): TickResult {
  const facts: FactProposalDraft[] = [];
  const notes: string[] = [];
  let accounts = input.world.material.accounts;
  const transactions: MoneyTransaction[] = [...input.world.material.transactions];
  let localId = 0;

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
    if (besiegers.length > 0) blockaded.add(controller);
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

  const incomeSources = input.world.material.incomeSources.map((source) => {
    if (!source.active) return source;
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
      const owed = Math.round((source.amount * source.collectionRateBps) / 10_000);
      const received = Math.round(owed * share);
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

  for (const obligation of byPriority) {
    if (!obligation.active) continue;
    let due = obligation.nextDueStep;
    let periods = 0;
    let arrears = obligation.arrears;
    let missed = obligation.missedPeriods;
    let wentUnpaid = false;
    let remaining = obligation.remainingPeriods;

    while (due <= input.toDay && periods < MAX_PERIODS_PER_TICK && (remaining === undefined || remaining > 0)) {
      const owed = obligation.amount + arrears;
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
    if (force.payObligationId === null) return force;
    const paying = obligations.find((obligation) => obligation.id === force.payObligationId);
    if (paying === undefined || paying.missedPeriods === force.payArrearsPeriods) return force;

    const missed = paying.missedPeriods;
    const moralePeriods = input.warfare?.arrearsMoralePeriods ?? 1;
    const desertionPeriods = input.warfare?.arrearsDesertionPeriods ?? 3;
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
    const leaving = Math.round(DESERTION_RATE_PER_PERIOD * (missed - desertionPeriods + 1) * 10_000) / 10_000;
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

  /** What finished projects produced this tick, folded into the world at the end. */
  const forces: WorldState["material"]["forces"][number][] = [];
  /** Armies a completed journey put somewhere else. */
  const movedForces = new Map<string, WorldState["material"]["forces"][number]>();
  const structures: WorldState["structures"][number][] = [];
  const newIncome: WorldState["material"]["incomeSources"][number][] = [];

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

  const produceOutcome = (project: WorldState["projects"][number]): { entityId: string; summary: string } | null => {
    const outcome = project.completionOutcome;
    if (outcome === null || outcome.kind === "none") return null;

    if (outcome.kind === "force") {
      const provinceId = outcome.provinceId ?? input.world.map.provinces[0]?.id;
      const commanderId = outcome.commanderCharacterId;
      const polityId = outcome.polityId;
      if (provinceId === undefined || commanderId === null || polityId === null) return null;
      if (!input.world.characters.some((character) => character.id === commanderId && character.alive)) return null;
      if (!input.world.map.provinces.some((province) => province.id === provinceId)) return null;

      const id = input.ids.next("force");
      const strength = Math.max(1, outcome.amount);
      forces.push({
        id,
        name: outcome.label,
        polityId,
        commanderCharacterId: commanderId,
        controllerCharacterId: commanderId,
        locationId: provinceId,
        positionId: null,
        authorizedStrength: strength,
        personnel: [{ categoryId: "infantry", label: "Infantry", fit: strength, unavailable: [] }],
        moraleBps: 6_000,
        cohesionBps: 5_000,
        fatigueBps: 0,
        provisionStatus: "provisioned",
        provisionedThroughStep: input.toDay + 30,
        payObligationId: null,
        payArrearsPeriods: 0,
        history: [],
        memberCharacterIds: [],
      });
      return { entityId: id, summary: `${outcome.label} [${id}] stands ready, ${strength} strong.` };
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
      if (hopsBetween(input.world, marching.locationId, provinceId) === null) return null;
      movedForces.set(forceId, { ...marching, locationId: provinceId, positionId: null });
      // Named, not identified. This summary is copied verbatim into the
      // Chronicle by whoever writes the project up, and a chronicler
      // reporting that an army "arrived in
      // ita-72843720b81376294924159-sicily-northeast" is the engine's
      // bookkeeping arriving in the historian's hands.
      const arrivedAt = input.world.map.provinces.find((province) => province.id === provinceId)?.name ?? provinceId;
      // Arriving on somebody else's ground unasked is part of what arriving
      // was. See `trespassOf`.
      const trespass = trespassOf(input.world, marching, provinceId);
      return { entityId: forceId, summary: `${marching.name} [${forceId}] has arrived in ${arrivedAt} [${provinceId}].${trespass === null ? "" : ` ${trespass.summary}`}` };
    }

    if (outcome.kind === "structure") {
      const provinceId = outcome.provinceId;
      if (provinceId === null || !input.world.map.provinces.some((province) => province.id === provinceId)) return null;
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
        settlementId: null,
        ownerPolityId: outcome.polityId,
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
      const fromAccountId = sponsorAccountId(project.sponsorEntityRef) ?? null;
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
      if (project.status === "completed" || project.status === "cancelled" || project.status === "failed") return project;

      let milestones = project.milestones;
      let changed = false;
      for (let guard = 0; guard < MAX_PERIODS_PER_TICK; guard += 1) {
        const dueMilestone = nextDueMilestone({ ...project, milestones }, input.toDay);
        if (dueMilestone === undefined) break;
        // The sponsor pays. A milestone whose sponsor cannot cover it still
        // completes -- the work was done on credit, and the shortfall is the
        // sponsor's problem to answer for.
        const funderId = sponsorAccountId(project.sponsorEntityRef);
        const dueAtStep = project.startedAtStep + dueMilestone.requiredAtElapsedOffset;
        if (dueMilestone.costAmount > 0) {
          // A sponsor who cannot cover it still gets the work -- but the
          // shortfall is real and has to be said. Balances floor at zero and a
          // sponsor with no account at all pays nothing, so without this the
          // money simply vanished and nobody was answerable for it.
          const short = funderId === undefined
            ? dueMilestone.costAmount
            : Math.max(0, dueMilestone.costAmount - balanceOf(funderId));
          if (funderId !== undefined) {
            credit(funderId, -dueMilestone.costAmount);
            transactions.push({
              id: input.ids.next("txn"),
              atStep: dueAtStep,
              kind: "purchase",
              amount: dueMilestone.costAmount,
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
            ? `${project.label} is complete, but produced nothing it was meant to.`
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

      return {
        ...project,
        milestones,
        status: "completed" as const,
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
        accounts,
        incomeSources: newIncome.length === 0 ? incomeSources : [...incomeSources, ...newIncome],
        obligations: servicedObligations,
        loans,
        forces: [
          ...unpaidForces.map((force) => {
            const arrived = movedForces.get(force.id);
            return arrived === undefined ? force : { ...force, locationId: arrived.locationId, positionId: arrived.positionId };
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
    withTaxUnrest(provinceTargetsFrom(standingWorld), input.world, burdens),
  );
  // Who has held what, written down before any term ends -- so the man whose
  // year ran out today is remembered as having held it.
  const recovered = recordTenures(materialAdvanced, input.toDay);

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
  const DISTRESS_BPS = 4_000;
  for (const material of recovered.material.provinceMaterial) {
    const previous = before.get(material.provinceId);
    if (previous === undefined) continue;
    const crossed = (now: number, was: number): boolean => now < DISTRESS_BPS && was >= DISTRESS_BPS;
    if (crossed(material.foodSecurityBps, previous.foodSecurityBps)) {
      facts.push({
        localId: nextLocalId("hunger"),
        kind: "province_hunger",
        summary: `Food is running short in ${material.provinceId}.`,
        affectedRefs: [{ kind: "province", id: material.provinceId }],
        visibility: "polity",
        discoveryState: "polity",
        knowableInDays: 0,
        significance: 55,
      });
      notes.push(`Food is running short in ${material.provinceId}.`);
    }
    if (crossed(material.stabilityBps, previous.stabilityBps)) {
      facts.push({
        localId: nextLocalId("unrest"),
        kind: "province_unrest",
        summary: `Order is breaking down in ${material.provinceId}.`,
        affectedRefs: [{ kind: "province", id: material.provinceId }],
        visibility: "polity",
        discoveryState: "polity",
        knowableInDays: 0,
        significance: 60,
      });
      notes.push(`Order is breaking down in ${material.provinceId}.`);
    }
  }

  // A thread nobody has touched for half a year has run its course. Closing
  // it is bookkeeping, not history: no fact, a note only.
  const stale = recovered.storylines.filter((storyline) => storyline.phase !== "closed" && input.toDay - storyline.updatedAtStep >= STORYLINE_IDLE_DAYS);
  const storylines = stale.length === 0
    ? recovered.storylines
    : recovered.storylines.map((storyline) =>
      stale.includes(storyline) ? { ...storyline, phase: "closed" as const, closedAtStep: input.toDay, updatedAtStep: input.toDay } : storyline,
    );
  for (const storyline of stale) notes.push(`The matter of ${storyline.title} has gone quiet.`);

  /**
   * Letters whose term has run out.
   *
   * Silence is an answer, and the harshest one the trust table holds. Without
   * this a power could put an ultimatum to another and simply never hear back:
   * the letter would sit in the world forever, and refusing by saying nothing
   * -- which is most of how powers actually refuse -- would cost nothing.
   */
  let polityStances = recovered.polityStances;
  const polityName = (id: string): string => recovered.map.polities.find((polity) => polity.id === id)?.name ?? id;
  const diplomacy = recovered.diplomacy.map((message) => {
    if (message.status !== "awaiting_reply" || message.replyDueByStep === null || message.replyDueByStep > input.toDay) return message;
    const ignored = { ...message, status: "answered" as const, answer: "ignored" as const, answerText: "No answer came.", answeredAtStep: input.toDay };
    polityStances = [...applyDiplomaticAnswerToStance(polityStances, ignored, input.toDay)];
    facts.push({
      localId: nextLocalId("letter"),
      kind: "diplomatic_silence",
      // Written as the act it is, not as the deadline that revealed it. "Let
      // the term run out" is a clerk noticing a date; a chronicler cannot make
      // an event of it, and tried -- an entry headlined "Roman Republic Lets
      // the Term on Messanan Protection Expire" said nothing had happened, at
      // length. Refusing by saying nothing is a refusal, and worth as much.
      summary: `${polityName(message.toPolityId)} refused ${polityName(message.fromPolityId)} by silence on "${message.subject}", sending no answer at all.`,
      affectedRefs: [{ kind: "polity", id: message.fromPolityId }, { kind: "polity", id: message.toPolityId }],
      visibility: "polity",
      discoveryState: "polity",
      knowableInDays: 0,
      significance: 45,
    });
    notes.push(`No answer came to ${polityName(message.fromPolityId)}'s letter on ${message.subject}.`);
    return ignored;
  });

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
  const officeSeats = expiredSeats.length === 0
    ? recovered.material.officeSeats
    : recovered.material.officeSeats.map((seat) =>
      expiredSeats.some((expired) => expired.id === seat.id)
        ? { ...seat, status: "vacant" as const, vacancyCause: "term_expired" as const, holderCharacterId: null }
        : seat);
  const laidDown = new Set(expiredSeats.flatMap((seat) => (seat.holderCharacterId === null ? [] : [seat.holderCharacterId])));
  for (const seat of expiredSeats) {
    if (seat.holderCharacterId === null) continue;
    const who = recovered.characters.find((character) => character.id === seat.holderCharacterId)?.name ?? seat.holderCharacterId;
    facts.push({
      localId: nextLocalId("term"),
      kind: "office_term_ended",
      summary: `${who} laid down his office at the end of its term.`,
      affectedRefs: [{ kind: "character", id: seat.holderCharacterId }],
      visibility: "public",
      discoveryState: "public",
      knowableInDays: 0,
      // A magistracy changing hands on the calendar is ordinary, and worth
      // knowing: it is how a republic differs from a reign.
      significance: 45,
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
    storylines,
    diplomacy,
    polityStances,
    polityAgreements,
    material: { ...recovered.material, officeSeats },
    // The mirror on the character, which the seat cannot reach on its own.
    characters: laidDown.size === 0
      ? recovered.characters
      : recovered.characters.map((character) => (laidDown.has(character.id) ? { ...character, officeId: null } : character)),
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

  const standing = settleStandingEffects({ world: afterVentures, toDay: input.toDay, ids: input.ids });
  facts.push(...standing.facts);

  const plans = reviewContingencies({
    world: standing.world,
    toDay: input.toDay,
    ids: input.ids,
    ...(input.warfare === undefined ? {} : { warfare: input.warfare }),
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

  // After lives, so a magistrate who died today leaves a seat the living are
  // told about today.
  const elections = input.government === undefined
    ? { world: contracts.world, facts: [] as readonly FactProposalDraft[] }
    : holdElections({
      world: contracts.world,
      government: input.government,
      toDay: input.toDay,
      ids: input.ids,
      ...(input.playerCharacterId === undefined ? {} : { playerCharacterId: input.playerCharacterId }),
    });

  return {
    world: elections.world,
    factProposals: [...facts, ...plans.facts, ...plots.facts, ...lives.facts, ...contracts.facts, ...elections.facts],
    notes,
    died: [...plots.died, ...lives.died],
    sprungContingencies: plans.sprung,
    contingencyBattles: plans.battles,
  };
}
