import type { Character, RelationDimension } from "../characters/character";
import { strongestCauses } from "../characters/relationship-dimensions";
import type { TaxBurden } from "../material/taxation";

/**
 * Why a word is the word it is.
 *
 * The sheets are full of judgements: "sullen", "pressing hard", "you think
 * him distrustful". Each is the engine's summary of causes it already keeps.
 * A why note lists them in words, strongest first, marked as working for or
 * against, and ends with a fixed line saying what would change it. That line
 * is the rule the engine follows, said once here. The model never writes it.
 *
 * Only causes the engine keeps are listed. It does not record why a legion's
 * morale moved, so morale's note gives its pay, supply and the muster's own
 * account of what has changed, and nothing it would have to invent.
 */

export type WhyTone = "bad" | "mid" | "good";

export interface WhyCause {
  readonly label: string;
  readonly tone: WhyTone;
}

export interface WhyReading {
  readonly causes: readonly WhyCause[];
  /** What would change it, as the engine has it. */
  readonly remedy: string | null;
  /** The rule behind it, in `explanations.ts`, shown under the causes. */
  readonly explainedBy?: string | undefined;
}

/** The fixed rules, one per family of judgement. */
export const WHY_REMEDY = {
  morale: "Men take heart from a victory, full rations and pay made good. Left alone, the mood drifts back towards steady.",
  tax: "Asking less, holding more land, or a quieter land that bears more would ease it. Pressing on costs order in the provinces.",
  opinion: "Your view of a man moves with what he does to you, and fades as the years pass.",
} as const;

export interface MoraleInput {
  readonly moraleLabel: string;
  readonly provisionLabel: string;
  readonly payStatus: string;
  readonly changeExplanation: string;
}

const PAID = new Set(["Paid", "Paid out of what they take"]);
const FED = new Set(["provisioned", "fed", "well supplied"]);

export function moraleWhy(force: MoraleInput): WhyReading {
  const causes: WhyCause[] = [];
  causes.push({ label: PAID.has(force.payStatus) ? `${force.payStatus}` : force.payStatus, tone: PAID.has(force.payStatus) ? "good" : "bad" });
  const fed = FED.has(force.provisionLabel.toLowerCase());
  causes.push({ label: capitalise(force.provisionLabel), tone: fed ? "good" : force.provisionLabel.toLowerCase().includes("starv") ? "bad" : "mid" });
  if (!force.changeExplanation.startsWith("Nothing has changed")) causes.push({ label: force.changeExplanation.replace(/\.$/, ""), tone: "mid" });
  // The worst first: what is going wrong is what a commander reads for.
  const order: Record<WhyTone, number> = { bad: 0, mid: 1, good: 2 };
  return { causes: causes.sort((a, b) => order[a.tone] - order[b.tone]), remedy: WHY_REMEDY.morale, explainedBy: "rule:pay" };
}

/** How hard the taxes press, and on what. Ratios in words, never the sums. */
export function taxWhy(burden: TaxBurden): WhyReading {
  const ratio = burden.bearable <= 0 ? Number.POSITIVE_INFINITY : burden.asked / burden.bearable;
  const asked = !Number.isFinite(ratio) ? "Asked of lands that can give nothing"
    : ratio > 1 ? "More is asked than the land can give"
      : ratio > 0.8 ? "Nearly all the land can give is asked of it"
        : ratio > 0.5 ? "Much of what the land can give is asked of it"
          : "Well under what the land can give is asked of it";
  const causes: WhyCause[] = [{ label: asked, tone: ratio > 0.8 ? "bad" : ratio > 0.5 ? "mid" : "good" }];
  if (burden.collectedShare < 1) {
    causes.push({ label: burden.collectedShare < 0.6 ? "The collectors bring in little of it" : "The collectors fall short of it", tone: "bad" });
  }
  if (burden.stabilityShiftBps < 0) {
    causes.push({ label: burden.stabilityShiftBps <= -1_500 ? "Order in the provinces is breaking under it" : "Order in the provinces suffers for it", tone: "bad" });
  }
  return { causes, remedy: WHY_REMEDY.tax, explainedBy: "rule:tax" };
}

/**
 * Why the viewer thinks what they do of someone: their own relation's
 * strongest causes. This is the viewer's own mind, which is theirs to read.
 * What the other thinks of them is never read.
 */
export function opinionWhy(viewer: Pick<Character, "relations">, subjectId: string): WhyReading {
  const dimensions: readonly RelationDimension[] = ["affection", "trust", "respect"];
  const seen = new Set<string>();
  const causes: WhyCause[] = [];
  for (const dimension of dimensions) {
    for (const cause of strongestCauses(viewer, subjectId, dimension)) {
      if (seen.has(cause.id)) continue;
      seen.add(cause.id);
      causes.push({ label: capitalise(cause.label), tone: cause.score > 0 ? "good" : cause.score < 0 ? "bad" : "mid" });
    }
  }
  return { causes: causes.slice(0, 4), remedy: causes.length === 0 ? null : WHY_REMEDY.opinion };
}

const capitalise = (text: string): string => (text.length === 0 ? text : `${text.charAt(0).toUpperCase()}${text.slice(1)}`);
