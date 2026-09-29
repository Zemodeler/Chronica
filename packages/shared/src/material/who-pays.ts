import type { WorldState } from "../world/world-state";

/**
 * Who has undertaken to pay whom, checked across the whole document.
 *
 * `payInWords` distinguishes an army in arrears from an army nobody has
 * undertaken to pay, and `runDeterministicTick` will not touch a force whose
 * `payObligationId` is null -- so a scenario that authors army pay out of a
 * treasury and never names the army it pays has switched off arrears, morale
 * loss and desertion for every force it has, quietly, while every unit test
 * still passes. The First Punic War scenario did exactly that: six standing
 * obligations, four of them army pay, and not one of eight forces pointing at
 * any of them.
 *
 * Neither rule can be a schema constraint. `payObligationId` is honestly
 * nullable -- the Campanian legion at Rhegium murdered its hosts and holds
 * the city for itself, and "nobody has undertaken to pay them" is the true
 * reading of it, not an authoring slip. What is checkable is the *shape* of
 * the mistake: an army whose own government keeps a chest and still has no
 * one answering for its wages, and an army-pay line drawn on a treasury that
 * pays no army anybody can name.
 *
 * Warnings, therefore, never errors: each has a legitimate exception, and a
 * check that cannot be overruled by an author is a check authors route
 * around.
 */

export interface PayProblem {
  readonly level: "warning";
  readonly message: string;
}

/** The obligation kinds that pay soldiers, as against magistrates or creditors. */
const PAYS_SOLDIERS: ReadonlySet<string> = new Set(["army_pay", "army_upkeep"]);

export function findPayProblems(world: WorldState): PayProblem[] {
  const problems: PayProblem[] = [];
  const { forces, obligations, accounts } = world.material;

  const treasuryPolityIds = new Set(
    accounts.filter((account) => account.owner.kind === "polity").map((account) => account.owner.id),
  );

  for (const force of forces) {
    if (force.payObligationId !== null) continue;
    if (!treasuryPolityIds.has(force.polityId)) continue;
    problems.push({
      level: "warning",
      message: `Force "${force.id}" has no pay obligation, though its own power "${force.polityId}" keeps a treasury. Nothing can put it in arrears, so it can never lose morale or men for want of pay.`,
    });
  }

  const paidForceIds = new Set(forces.map((force) => force.payObligationId).filter((id): id is string => id !== null));
  for (const obligation of obligations) {
    if (!PAYS_SOLDIERS.has(obligation.kind) || paidForceIds.has(obligation.id)) continue;
    problems.push({
      level: "warning",
      message: `Obligation "${obligation.id}" (${obligation.kind}) pays an army no force references. The money leaves the treasury and reaches nobody the simulation knows about.`,
    });
  }

  return problems;
}
