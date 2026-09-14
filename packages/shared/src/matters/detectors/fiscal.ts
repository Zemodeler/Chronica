import { availableBalance } from "../../world/money-reservations";
import type { MatterDetector, MatterDetectorContext } from "../detector-types";
import type { DetectedMatter } from "../detector-types";
import { freshDetectedMatter } from "./shared";

// World matters, Phase 4 fiscal foundation (docs/plans/
// ai-world-matters-runtime.md, "Revenue assessment flow" / "Supply and
// logistics"-adjacent obligation handling). Each detector here sets
// `requiredAuthority` scoped to the account it concerns, so Phase 2's
// routing ladder step 1 (living characters holding a named authority) finds
// the right office-holder automatically -- these matters need no
// per-source `responsibleScopeRefs` list of their own.

/** Deterministic, replay-safe period index: advances by exactly one each time `nextDueStep` advances by `cadenceSteps`. */
function periodIndex(nextDueStep: number, cadenceSteps: number): number {
  return Math.floor(nextDueStep / Math.max(1, cadenceSteps));
}

const incomeAssessmentDetector: MatterDetector = {
  id: "fiscal.income_assessment",
  kinds: ["income_assessment"],
  detect(ctx) {
    const result: DetectedMatter[] = [];
    for (const source of ctx.world.material.incomeSources) {
      if (!source.active) continue;
      const lookahead = Math.max(1, Math.floor(source.cadenceSteps / 4));
      if (source.nextDueStep - lookahead > ctx.atStep) continue; // not yet worth surfacing
      const period = periodIndex(source.nextDueStep, source.cadenceSteps);
      const matter = freshDetectedMatter(ctx, {
        id: `income-assessment:${source.id}:period-${period}`,
        kind: "income_assessment",
        sourceRef: { kind: "income_source", id: source.id },
        summary: `"${source.label}" is ready for its next assessment (${source.amount}/period, due step ${source.nextDueStep}).`,
        intensity: source.nextDueStep <= ctx.atStep ? 45 : 25,
        provinceId: null,
        visibility: "polity",
        cadenceSteps: source.cadenceSteps,
      });
      result.push({
        ...matter,
        status: source.nextDueStep <= ctx.atStep ? "due" : "upcoming",
        dueAt: matter.createdAt,
        requiredAuthority: [{ domain: "fiscal", power: "spend", scope: { kind: "account", id: source.beneficiaryAccountId } }],
      });
    }
    return result;
  },
};

const obligationDueDetector: MatterDetector = {
  id: "fiscal.obligation_due",
  kinds: ["obligation_due"],
  detect(ctx) {
    const result: DetectedMatter[] = [];
    for (const obligation of ctx.world.material.obligations) {
      if (!obligation.active) continue;
      const lookahead = Math.max(1, Math.floor(obligation.cadenceSteps / 4));
      const dueOrSoon = obligation.nextDueStep - lookahead <= ctx.atStep;
      if (!dueOrSoon && obligation.arrears <= 0) continue;
      const period = periodIndex(obligation.nextDueStep, obligation.cadenceSteps);
      const overdue = obligation.nextDueStep <= ctx.atStep;
      const matter = freshDetectedMatter(ctx, {
        id: `obligation:${obligation.id}:period-${period}`,
        kind: "obligation_due",
        sourceRef: { kind: "obligation", id: obligation.id },
        summary: `"${obligation.label}" is due (${obligation.amount}${obligation.arrears > 0 ? `, plus ${obligation.arrears} in arrears` : ""}).`,
        intensity: Math.min(95, 40 + obligation.missedPeriods * 15),
        provinceId: null,
        visibility: "polity",
        cadenceSteps: obligation.cadenceSteps,
      });
      result.push({
        ...matter,
        status: overdue ? "overdue" : dueOrSoon ? "due" : "upcoming",
        dueAt: matter.createdAt,
        requiredAuthority: [{ domain: "fiscal", power: "spend", scope: { kind: "account", id: obligation.payerAccountId } }],
      });
    }
    return result;
  },
};

const arrearsDetector: MatterDetector = {
  id: "fiscal.arrears",
  kinds: ["obligation_due"],
  detect(ctx) {
    // A continuous-condition companion to `obligationDueDetector` (doc,
    // "Matter identity and deduplication": "some concerns are continuous
    // rather than periodic... they should resolve when the condition ends").
    // Deliberately shares the `obligation_due` kind rather than minting its
    // own -- it is the SAME concern (this obligation owes money), just
    // identified without a period suffix so it survives across periods
    // instead of resetting each time `nextDueStep` advances.
    const result: DetectedMatter[] = [];
    for (const obligation of ctx.world.material.obligations) {
      if (!obligation.active || obligation.arrears <= 0) continue;
      const matter = freshDetectedMatter(ctx, {
        id: `arrears:${obligation.id}`,
        kind: "obligation_due",
        sourceRef: { kind: "obligation", id: obligation.id },
        summary: `"${obligation.label}" carries ${obligation.arrears} in unpaid arrears across ${obligation.missedPeriods} missed period(s).`,
        intensity: Math.min(95, 50 + obligation.missedPeriods * 10),
        provinceId: null,
        visibility: "polity",
        cadenceSteps: Math.max(1, obligation.cadenceSteps),
      });
      result.push({
        ...matter,
        status: "overdue",
        dueAt: matter.createdAt,
        requiredAuthority: [{ domain: "fiscal", power: "spend", scope: { kind: "account", id: obligation.payerAccountId } }],
      });
    }
    return result;
  },
};

/** Every account's obligations due within one cadence window from now, summed. */
function nearTermObligationLoad(ctx: MatterDetectorContext, accountId: string): number {
  return ctx.world.material.obligations
    .filter((o) => o.active && o.payerAccountId === accountId)
    .filter((o) => o.nextDueStep <= ctx.atStep + Math.max(1, o.cadenceSteps))
    .reduce((sum, o) => sum + o.amount + o.arrears, 0);
}

const treasuryRiskDetector: MatterDetector = {
  id: "fiscal.treasury_risk",
  kinds: ["treasury_risk"],
  detect(ctx) {
    // Derived, not stored: doc, "a treasury becoming unable to cover
    // near-term recorded obligations" is a live computation over current
    // balance and obligation state, never a field written by some other
    // pass -- so this matter appears and disappears purely from whether
    // the comparison currently holds.
    const result: DetectedMatter[] = [];
    for (const account of ctx.world.material.accounts) {
      if (account.status !== "active") continue;
      const load = nearTermObligationLoad(ctx, account.id);
      if (load <= 0) continue;
      const available = availableBalance(ctx.world.material, account.id);
      if (available >= load) continue;
      const matter = freshDetectedMatter(ctx, {
        id: `treasury-risk:${account.id}`,
        kind: "treasury_risk",
        sourceRef: { kind: "account", id: account.id },
        summary: `Account "${account.id}" cannot cover its near-term obligations (${available} available against ${load} owed).`,
        intensity: Math.min(95, 50 + Math.round(((load - available) / Math.max(1, load)) * 45)),
        provinceId: null,
        visibility: "polity",
        cadenceSteps: 1,
      });
      result.push({
        ...matter,
        status: "overdue",
        dueAt: matter.createdAt,
        requiredAuthority: [{ domain: "fiscal", power: "spend", scope: { kind: "account", id: account.id } }],
      });
    }
    return result;
  },
};

export const fiscalMatterDetectors: readonly MatterDetector[] = [
  incomeAssessmentDetector,
  obligationDueDetector,
  arrearsDetector,
  treasuryRiskDetector,
];
