import { type ActKind, type WorldState } from "@chronica/shared";

/**
 * A man the model plays keeps his books by the rules unless he has lately kept them himself (docs/economy.md, "Who manages the economy").
 *
 * The fiscal officer of a power (`fiscal-officers.ts`) used to pass over any man the model was playing, on the ground that his books were his
 * own. But the ruler of a small power (Hiero at Syracuse, the chief of the Mamertines) is the only officer it has, and the model, asked about wars and
 * letters, never thought of the rate of the tribute: the books of Syracuse were not kept at all, and a chest that grew without end was never eased, nor a
 * deficit ever met. The books are a standing business, like the rains and the harvest, and the rules go on keeping them for him.
 *
 * What gives way is the rules, never the man. If the model has itself done something about the money of that power in the last
 * `MODEL_ACT_PRECEDENCE_DAYS` days (set the rate, the customs, the coin, borrowed, bought bread), that act is on the record in the marks the
 * competence gate keeps (`ActMark`), and nobody settles the same matter again in its season; the officer then lets it stand, and takes up his work again once the
 * season has run. An act of the officer's own, which the log of the rules keeps, is not the model's. All of the competence rules stay: he does only what
 * `mayAct` lets his office do (`fiscal-officers.ts` weighs each matter).
 */

/** How long the model's own act on the money of a power holds the rules off its books. */
export const MODEL_ACT_PRECEDENCE_DAYS = 60;
/** Days between a mark and the rules' log of the same decision, allowed for the two clocks. */
const SAME_DAY = 3;

const FISCAL_ACTS: readonly ActKind[] = ["tax_rate", "customs", "coinage", "loans", "grain"];

/** Whether the model (or anybody but the rules) has lately made a fiscal act for this power, as the marks and the log show. */
export function modelHasActedOnTheBooks(world: Pick<WorldState, "actMarks" | "statecraft">, polityId: string, today: number): boolean {
  for (const mark of world.actMarks) {
    if (mark.polityId !== polityId || !FISCAL_ACTS.includes(mark.act) || today - mark.atStep > MODEL_ACT_PRECEDENCE_DAYS || mark.atStep > today) continue;
    // The rules' own decisions are marked as well, so that nobody decides the same thing twice in a season; the log says which these are.
    const rules = world.statecraft.log.some((entry) => entry.act === "fiscal" && entry.polityId === polityId && Math.abs(entry.day - mark.atStep) <= SAME_DAY);
    if (!rules) return true;
  }
  return false;
}
