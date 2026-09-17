import {
  advanceProvinceMaterial,
  nextDueMilestone,
  type FactProposal,
  type MoneyObligation,
  type ScenarioWarfareRules,
  type MoneyTransaction,
  type WorldState,
} from "@chronica/shared";
import type { IdFactory } from "./ports";

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
  /** The day the world is advancing to. Everything due at or before it resolves. */
  readonly toDay: number;
  readonly ids: IdFactory;
}

export interface TickResult {
  readonly world: WorldState;
  /** What the passage of time made true, ready to be materialized like any other fact. */
  readonly factProposals: readonly FactProposal[];
  /** Plain lines for the Chronicle, which would otherwise never hear about routine upkeep. */
  readonly notes: readonly string[];
}

export function runDeterministicTick(input: TickInput): TickResult {
  const facts: FactProposal[] = [];
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
  const incomeSources = input.world.material.incomeSources.map((source) => {
    if (!source.active) return source;
    let due = source.nextDueStep;
    let periods = 0;
    while (due <= input.toDay && periods < MAX_PERIODS_PER_TICK) {
      const received = Math.round((source.amount * source.collectionRateBps) / 10_000);
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

    while (due <= input.toDay && periods < MAX_PERIODS_PER_TICK) {
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
          ...(obligation.recipientAccountId === undefined ? {} : { destinationAccountId: obligation.recipientAccountId }),
          cause: { kind: "obligation", id: obligation.id, explanation: obligation.label },
          visibility: "polity",
        });
        arrears = 0;
      } else if (owed > 0) {
        arrears = owed;
        missed += 1;
        wentUnpaid = true;
      }
      due += obligation.cadenceSteps;
      periods += 1;
    }

    if (periods > 0) settled.set(obligation.id, { ...obligation, nextDueStep: due, arrears, missedPeriods: missed });
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
      movedForces.set(forceId, { ...marching, locationId: provinceId, positionId: null });
      return { entityId: forceId, summary: `${marching.name} [${forceId}] has arrived in ${provinceId}.` };
    }

    if (outcome.kind === "structure") {
      const provinceId = outcome.provinceId;
      if (provinceId === null || !input.world.map.provinces.some((province) => province.id === provinceId)) return null;
      const id = input.ids.next("structure");
      structures.push({
        id,
        kind: "other",
        name: outcome.label,
        provinceId,
        settlementId: null,
        ownerPolityId: outcome.polityId,
        garrisonCapacity: outcome.amount,
        defensiveEffectsBps: 0,
        supplyRadius: 0,
        builtAtStep: input.toDay,
        provenanceProjectId: project.id,
      });
      return { entityId: id, summary: `${outcome.label} [${id}] now stands in ${provinceId}.` };
    }

    const beneficiaryId = outcome.beneficiaryAccountId;
    if (beneficiaryId === null || !accounts.some((account) => account.id === beneficiaryId)) return null;
    const cadence = outcome.cadenceDays ?? 30;
    const id = input.ids.next("income");
    newIncome.push({
      id,
      kind: "trade",
      label: outcome.label,
      beneficiaryAccountId: beneficiaryId,
      originKind: "polity",
      originId: beneficiaryId,
      amount: outcome.amount,
      cadenceSteps: cadence,
      nextDueStep: input.toDay + cadence,
      collectionRateBps: 10_000,
      counterpartyPolityId: null,
      active: true,
    });
    return { entityId: id, summary: `${outcome.label} [${id}] begins returning ${outcome.amount} every ${cadence} days.` };
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
      facts.push({
        localId: nextLocalId("project"),
        kind: "project_completed",
        summary: produced === null ? `${project.label} is complete.` : `${project.label} is complete: ${produced.summary}`,
        affectedRefs: [{ kind: "project", id: project.id }],
        visibility: "public",
        discoveryState: "public",
        knowableInDays: 0,
        // Something now exists that did not before, which is a different order
        // of event from a milestone being reached.
        significance: produced === null ? 45 : 60,
      });
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
  const recovered = advanceProvinceMaterial(
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
  );

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

  return {
    world: recovered,
    factProposals: facts,
    notes,
  };
}
