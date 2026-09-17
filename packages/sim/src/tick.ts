import {
  nextDueMilestone,
  type FactProposal,
  type MoneyObligation,
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

  // ── Projects ──────────────────────────────────────────────────────────
  //
  // A milestone whose date has arrived completes, and pays its cost. This is
  // what makes a four-month recruitment actually produce legions rather than
  // scheduling them forever (VISION §17).
  const sponsorAccountId = (sponsor: WorldState["projects"][number]["sponsorEntityRef"]): string | undefined =>
    accounts.find((account) => account.owner.kind === sponsor.kind && account.owner.id === sponsor.id)?.id;

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
        if (dueMilestone.costAmount > 0 && funderId !== undefined) {
          credit(funderId, -dueMilestone.costAmount);
          transactions.push({
            id: input.ids.next("txn"),
            atStep: input.toDay,
            kind: "purchase",
            amount: dueMilestone.costAmount,
            sourceAccountId: funderId,
            cause: { kind: "project_milestone", id: project.id, explanation: dueMilestone.label },
            visibility: "polity",
          });
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
      if (finished) {
        facts.push({
          localId: nextLocalId("project"),
          kind: "project_completed",
          summary: `${project.label} is complete.`,
          affectedRefs: [{ kind: "project", id: project.id }],
          visibility: "public",
          discoveryState: "public",
          knowableInDays: 0,
          significance: 45,
        });
        notes.push(`${project.label} is complete.`);
      }
      return {
        ...project,
        milestones,
        status: finished ? ("completed" as const) : ("in_progress" as const),
        completedAtStep: finished ? input.toDay : null,
      };
  });

  return {
    world: {
      ...input.world,
      projects,
      material: { ...input.world.material, accounts, incomeSources, obligations, transactions: transactions.slice(-500) },
    },
    factProposals: facts,
    notes,
  };
}
