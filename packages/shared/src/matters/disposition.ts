import type { WorldState } from "../world/world-state";
import type { Fact } from "../world/facts";
import { availableBalance } from "../world/money-reservations";
import type { MatterDisposition, WorldMatter, WorldMatterKind } from "./schema";

/**
 * Matter disposition (docs/plans/ai-world-matters-runtime.md, "Matter
 * lifecycle" -- "7. Disposition"). A matter's own status only ever changes
 * from state a validated workflow actually produced: a declared intent to
 * pay, with no resulting `MoneyTransaction`, must never read as "addressed."
 */
export interface CompletionPredicate {
  readonly kinds: readonly WorldMatterKind[];
  /**
   * `null` means "no opinion this pass" -- e.g. the matter's source no
   * longer exists, which `advanceWorldMatters`'s own cancellation path
   * already handles, so a predicate should stay silent rather than guess.
   * A non-null result reflects the CURRENT true disposition every call, even
   * if unchanged from last time; `evaluateMatterDisposition` is what decides
   * whether an unchanged result is worth appending again.
   */
  evaluate(
    world: WorldState,
    matter: WorldMatter,
    newFacts: readonly Fact[],
  ): { disposition: MatterDisposition["kind"]; evidenceFactIds: readonly string[]; note: string } | null;
}

/**
 * Transactions recorded against `cause` since `sinceStep`, plus whichever of
 * `newFacts` plausibly evidence them (a fact whose own `resourceChanges`
 * touches an account one of those transactions moved money through -- the
 * same generic, no-per-workflow-declaration link `factualEventToFact`'s
 * `deriveAffectedEntities` already establishes for reactions). When no fact
 * correlates -- always true until Phase 4 lands `collect_revenue`/
 * `pay_obligation`, since nothing emits a `FactualEvent` naming this cause
 * yet -- the transaction's own id stands in, so a disposition genuinely
 * backed by canonical ledger state is never blocked on a workflow that
 * hasn't landed.
 */
function transactionEvidence(
  world: WorldState,
  newFacts: readonly Fact[],
  cause: { readonly kind: string; readonly id: string },
  sinceStep: number,
): { readonly totalAmount: number; readonly evidenceIds: readonly string[] } {
  const transactions = world.material.transactions.filter(
    (t) => t.cause.kind === cause.kind && t.cause.id === cause.id && t.atStep >= sinceStep,
  );
  if (transactions.length === 0) return { totalAmount: 0, evidenceIds: [] };
  const totalAmount = transactions.reduce((sum, t) => sum + t.amount, 0);
  const touchedAccountIds = new Set(
    transactions.flatMap((t) => [t.sourceAccountId, t.destinationAccountId].filter((id): id is string => id !== undefined)),
  );
  const factIds = newFacts
    .filter((f) => f.resourceChanges.some((rc) => rc.accountId !== undefined && touchedAccountIds.has(rc.accountId)))
    .map((f) => f.id);
  const evidenceIds = factIds.length > 0 ? factIds : transactions.map((t) => `transaction:${t.id}`);
  return { totalAmount, evidenceIds };
}

const obligationDuePredicate: CompletionPredicate = {
  kinds: ["obligation_due"],
  evaluate(world, matter) {
    const obligation = world.material.obligations.find((o) => o.id === matter.sourceRef.id);
    if (!obligation) return null;
    const sinceStep = matter.lastReviewedStep;
    const { totalAmount, evidenceIds } = transactionEvidence(world, [], { kind: "obligation", id: obligation.id }, sinceStep);
    if (totalAmount >= obligation.amount && obligation.amount > 0) {
      return { disposition: "addressed", evidenceFactIds: evidenceIds, note: `Paid ${totalAmount} of ${obligation.amount} due.` };
    }
    if (totalAmount > 0) {
      return {
        disposition: "partially_addressed",
        evidenceFactIds: evidenceIds,
        note: `Paid ${totalAmount} of ${obligation.amount} due; ${obligation.amount - totalAmount} remains.`,
      };
    }
    const payerBalance = availableBalance(world.material, obligation.payerAccountId);
    if (payerBalance <= 0) {
      return { disposition: "blocked", evidenceFactIds: [], note: "The payer account has no available balance." };
    }
    return null;
  },
};

const incomeAssessmentPredicate: CompletionPredicate = {
  kinds: ["income_assessment"],
  evaluate(world, matter) {
    const source = world.material.incomeSources.find((s) => s.id === matter.sourceRef.id);
    if (!source) return null;
    const sinceStep = matter.lastReviewedStep;
    const { totalAmount, evidenceIds } = transactionEvidence(world, [], { kind: "scheduled_income", id: source.id }, sinceStep);
    if (totalAmount > 0) {
      return { disposition: "addressed", evidenceFactIds: evidenceIds, note: `Collected ${totalAmount} for this period.` };
    }
    return null;
  },
};

const officeTermPredicate: CompletionPredicate = {
  kinds: ["office_term", "seat_vacancy"],
  evaluate(world, matter) {
    const seat = world.material.officeSeats.find((s) => s.id === matter.sourceRef.id);
    if (!seat) return null;
    const priorHolder = matter.offers.find((o) => o.role === "responsible" && o.actorRef.kind === "character")?.actorRef.id ?? null;
    const termAdvanced = seat.termExpiresAtStep !== null && seat.termExpiresAtStep > matter.nextReviewStep;
    const holderChanged = seat.status === "held" && seat.holderCharacterId !== null && seat.holderCharacterId !== priorHolder;
    if (termAdvanced || holderChanged) {
      return {
        disposition: "addressed",
        evidenceFactIds: [`office-seat:${seat.id}:term-${seat.termExpiresAtStep ?? "none"}`],
        note: holderChanged ? `The seat now has a new holder (${seat.holderCharacterId}).` : "The term was renewed or extended.",
      };
    }
    return null;
  },
};

const treatyReviewPredicate: CompletionPredicate = {
  kinds: ["treaty_review"],
  evaluate(world, matter) {
    if (matter.sourceRef.kind !== "diplomatic_message") return null;
    const message = world.diplomacy.find((m) => m.id === matter.sourceRef.id);
    if (!message) return null;
    if (message.status === "answered") {
      return {
        disposition: "addressed",
        evidenceFactIds: [`diplomatic-message:${message.id}:${message.answer ?? "answered"}`],
        note: `Answered: ${message.answer ?? "answered"}.`,
      };
    }
    return null;
  },
};

const supplyReviewPredicate: CompletionPredicate = {
  kinds: ["supply_review"],
  evaluate(world, matter) {
    const force = world.material.forces.find((f) => f.id === matter.sourceRef.id);
    if (!force) return null;
    if (force.provisionedThroughStep > matter.nextReviewStep) {
      return {
        disposition: "addressed",
        evidenceFactIds: [`force-supply:${force.id}:through-${force.provisionedThroughStep}`],
        note: `Supply extended through step ${force.provisionedThroughStep}.`,
      };
    }
    return null;
  },
};

/**
 * The 5 legacy `WorldDevelopment` kinds (`scarcity`, `reconstruction`,
 * `civic`, `war_burden`, `household`) have no completion signal anywhere in
 * current canonical state -- they were pressure generators, not matters with
 * a due date or an accept/refuse workflow response (see the design doc's
 * "Actor selection" framing vs. its "Disposition" section; these predate the
 * doc's own distinction). Deliberately NOT given a predicate here rather
 * than forcing one: they remain governed only by `advanceWorldMatters`'s
 * existing due/resolved review lifecycle, exempt from
 * `COMPLETION_PREDICATES`, until the project owner decides whether real
 * per-kind completion semantics are worth building for them.
 */
export const COMPLETION_PREDICATES: readonly CompletionPredicate[] = [
  obligationDuePredicate,
  incomeAssessmentPredicate,
  officeTermPredicate,
  supplyReviewPredicate,
  treatyReviewPredicate,
];

const predicateByKind = new Map<WorldMatterKind, CompletionPredicate>();
for (const predicate of COMPLETION_PREDICATES) {
  for (const kind of predicate.kinds) predicateByKind.set(kind, predicate);
}

function sameDisposition(a: MatterDisposition, b: { disposition: MatterDisposition["kind"]; evidenceFactIds: readonly string[]; note: string }): boolean {
  return a.kind === b.disposition && a.note === b.note && a.evidenceFactIds.length === b.evidenceFactIds.length
    && a.evidenceFactIds.every((id, i) => id === b.evidenceFactIds[i]);
}

const TERMINAL_DISPOSITIONS: ReadonlySet<MatterDisposition["kind"]> = new Set(["addressed", "cancelled"]);

/**
 * Runs the applicable predicate per matter and, where it has an opinion,
 * appends a `MatterDisposition` and updates `matter.status`
 * (`addressed`/`cancelled` are terminal; every other disposition kind keeps
 * the matter in the ordinary review cycle). Pure and idempotent: re-running
 * with identical `newFacts` against an already-recorded disposition appends
 * nothing new -- `evaluate()` reports the CURRENT true state every call, and
 * this function is what deduplicates an unchanged result against the
 * matter's own most recent disposition entry.
 */
export function evaluateMatterDisposition(world: WorldState, matters: readonly WorldMatter[], newFacts: readonly Fact[]): readonly WorldMatter[] {
  return matters.map((matter) => {
    if (TERMINAL_DISPOSITIONS.has(matter.dispositions.at(-1)?.kind as MatterDisposition["kind"])) return matter;
    const predicate = predicateByKind.get(matter.kind);
    if (!predicate) return matter;
    const result = predicate.evaluate(world, matter, newFacts);
    if (result === null) return matter;
    const last = matter.dispositions.at(-1);
    if (last !== undefined && sameDisposition(last, result)) return matter;

    const atInstant = matter.nextReviewAt;
    const disposition: MatterDisposition = {
      kind: result.disposition,
      atInstant,
      byActorRef: null,
      evidenceFactIds: [...result.evidenceFactIds].slice(0, 12),
      note: result.note.slice(0, 400),
    };
    const isTerminal = TERMINAL_DISPOSITIONS.has(result.disposition);
    return {
      ...matter,
      status: isTerminal ? (result.disposition === "addressed" ? "addressed" : "cancelled") : matter.status,
      dispositions: [...matter.dispositions, disposition].slice(-16),
      resolutionFactIds: result.disposition === "addressed"
        ? [...new Set([...matter.resolutionFactIds, ...result.evidenceFactIds])].slice(0, 12)
        : matter.resolutionFactIds,
    } satisfies WorldMatter;
  });
}
