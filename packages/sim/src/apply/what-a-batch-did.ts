import { WorldStateSchema, type WorldState } from "@chronica/shared";
import type { MadeMoney } from "./context";

/** A schema issue as `applyDeltas` reports it. */
interface Issue {
  readonly path: PropertyKey[];
  readonly message: string;
}

/** Pre-existing faults already said once, so a save that carries one is not reported every batch. */
const toldAlready = new Set<string>();

/**
 * The issues of a batch's world that the world it began from did not have.
 *
 * `applyDeltas` refused a whole batch whenever the world it left would not
 * load, and blamed the batch: a plan step slipped past its limit by the tick
 * made every order after it "would have left the world invalid", and the
 * broken world was saved regardless. Only a fault the batch introduced is the
 * batch's. One it inherited is said once, here, and left for the burst's own
 * checkpoints to set right.
 */
export function newIssues(issues: readonly Issue[], before: WorldState): Issue[] {
  const was = WorldStateSchema.safeParse(before);
  if (was.success) return [...issues];
  const already = new Set(was.error.issues.map((issue) => issue.path.map(String).join(".")));
  const fresh = issues.filter((issue) => !already.has(issue.path.map(String).join(".")));
  for (const issue of was.error.issues) {
    const key = `${issue.path.map(String).join(".")}: ${issue.message}`;
    if (toldAlready.has(key)) continue;
    toldAlready.add(key);
    console.warn(`[apply] the world was already invalid before this batch, which is not blamed for it: ${key}`);
  }
  return fresh;
}

/** The money lines and obligations an act wrote: what is in the world after it and was not before. */
export function moneyMadeBetween(before: WorldState, after: WorldState): MadeMoney | undefined {
  const moved = after.material.transactions !== before.material.transactions;
  const owed = after.material.obligations !== before.material.obligations;
  if (!moved && !owed) return undefined;
  const newIds = <T extends { readonly id: string }>(was: readonly T[], now: readonly T[]): string[] => {
    const known = new Set(was.map((entry) => entry.id));
    return now.filter((entry) => !known.has(entry.id)).map((entry) => entry.id);
  };
  const made = {
    transactionIds: moved ? newIds(before.material.transactions, after.material.transactions) : [],
    obligationIds: owed ? newIds(before.material.obligations, after.material.obligations) : [],
  };
  return made.transactionIds.length === 0 && made.obligationIds.length === 0 ? undefined : made;
}
