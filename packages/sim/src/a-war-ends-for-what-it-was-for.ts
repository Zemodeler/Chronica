import { PEACE_AT, ownerOf, warPlanOf, warStanding, warWeariness, type PolityAgreement, type WarAim, type WorldState } from "@chronica/shared";
import { INDEMNITY_MEANS_FLOOR, meansOf, priceOf, provinceWorth, willingToGive, type PeaceClause } from "./peace";

/**
 * A war's peace is priced from what the war was for (docs/plans/war-plans.md, "War gaps closed").
 *
 * The aim of peace in a war plan (`sue_for_peace`) was a line in a dossier and nothing else; the rules made peace on the score alone, each side
 * keeping the ground it held. Now a power whose plan has the aim of peace has asked for it, and the other side hears it: where the asker has the
 * better of the war the other gives in, and where he has the worse of it the other, who is wearied of the war (three parts in five of the line
 * at which both sides are spent) or has had the asking before him a quarter of a year, grants it. The terms are what the winner went to war
 * for: the ground of the loser's that he holds and that his plan named to be taken (dearest first, as much as the loser will give up for
 * peace, `willingToGive`), and, where the war has gone well for him and there is room left in what the loser will bear, an indemnity
 * of a tenth of what the loser can pay, three years running. Ground he holds that his plan did not name stays as it is. A war whose
 * winner went to war for nothing but to keep what was his ends on what each holds.
 */

/** Days an asking for peace stands before a stronger enemy grants it for his own weariness' sake. */
const ASKED_FOR_DAYS = 120;
/** Of the weariness at which both sides are spent, the part a victor must feel to grant what a beaten side asks. */
const GRANTS_AT = 0.6;
/** The standing from which the victor may ask money besides ground. */
const INDEMNITY_FROM_SCORE = 25;

export interface PeaceFromAims {
  readonly suer: string;
  readonly victor: string;
  readonly loser: string;
  readonly clauses: PeaceClause[];
  readonly terms: string;
  readonly why: string;
}

const asksForPeace = (world: WorldState, polityId: string, enemyId: string): { readonly since: number } | null => {
  const plan = warPlanOf(world, polityId, enemyId);
  if (plan === undefined || !plan.aims.some((aim: WarAim) => aim.kind === "sue_for_peace")) return null;
  return { since: plan.aimsChangedAtStep };
};

/** The peace the plans of a war bring about, if either has the aim of it and the other will hear it. */
export function peaceFromTheAims(world: WorldState, war: PolityAgreement): PeaceFromAims | null {
  const [a, b] = [war.polityId, war.otherPolityId];
  const askA = asksForPeace(world, a, b);
  const askB = asksForPeace(world, b, a);
  if (askA === null && askB === null) return null;
  const day = world.instant.day;
  const standingA = warStanding(world, a, b);
  const standingB = warStanding(world, b, a);
  const suer = askA !== null && askB !== null ? (standingA.score <= standingB.score ? a : b) : askA !== null ? a : b;
  const other = suer === a ? b : a;
  const since = (suer === a ? askA : askB)!.since;
  const suerScore = suer === a ? standingA.score : standingB.score;
  const otherScore = suer === a ? standingB.score : standingA.score;
  // Whoever has the better of the war is the victor, and the one asked where it is even.
  const victor = suerScore > otherScore ? suer : other;
  const loser = victor === suer ? other : suer;
  const grantedByTheVictor = victor === suer || (askA !== null && askB !== null)
    || warWeariness(world, victor, loser).score >= PEACE_AT * GRANTS_AT || day - since >= ASKED_FOR_DAYS;
  if (!grantedByTheVictor) return null;

  const nameOf = (id: string): string => world.map.polities.find((polity) => polity.id === id)?.name ?? id;
  const victorsPlan = warPlanOf(world, victor, loser);
  const budget = willingToGive(world, loser, victor, undefined, undefined);
  const named = new Set((victorsPlan?.aims ?? []).filter((aim) => aim.kind === "take_province" || aim.kind === "raid").flatMap((aim) => (aim.provinceId === undefined ? [] : [aim.provinceId])));
  const ground = world.map.provinces
    .filter((province) => named.has(province.id) && province.controllerPolityId === victor && ownerOf(province) === loser)
    .sort((a1, b1) => provinceWorth(world, b1.id, loser) - provinceWorth(world, a1.id, loser) || a1.id.localeCompare(b1.id));
  const clauses: PeaceClause[] = [];
  let spent = 0;
  for (const province of ground) {
    const price = provinceWorth(world, province.id, loser);
    if (price <= 0 || spent + price > budget || clauses.length >= 12) continue;
    clauses.push({ kind: "cession", provinceId: province.id, toPolityId: victor });
    spent += price;
  }
  const victorScore = victor === a ? standingA.score : standingB.score;
  const amount = Math.round(meansOf(world, loser) * 0.1);
  if (amount > 0 && victorScore >= INDEMNITY_FROM_SCORE && (victorsPlan?.aims.length ?? 0) > 0) {
    const indemnity: PeaceClause = { kind: "indemnity", payerPolityId: loser, amount, periods: 3, cadenceDays: 365 };
    if (spent + priceOf(world, indemnity, loser) <= budget && meansOf(world, loser) >= INDEMNITY_MEANS_FLOOR / 10) clauses.push(indemnity);
  }
  const province = (id: string): string => world.map.provinces.find((candidate) => candidate.id === id)?.name ?? id;
  const said = clauses.map((clause) => clause.kind === "cession" ? `${province(clause.provinceId)} to ${nameOf(clause.toPolityId)}` : clause.kind === "indemnity" ? `${clause.amount} a year for ${clause.periods} years from ${nameOf(clause.payerPolityId)}` : "");
  const terms = clauses.length === 0
    ? `Peace between ${nameOf(victor)} and ${nameOf(loser)}, each keeping the ground it holds.`
    : `Peace between ${nameOf(victor)} and ${nameOf(loser)}, for what the war was fought for: ${said.filter((part) => part !== "").join("; ")}.`;
  const why = victor === suer ? `${nameOf(suer)} has what it went to war for, and asks for peace` : `${nameOf(suer)} asks for peace, and ${nameOf(victor)}, wearied of the war, grants it`;
  return { suer, victor, loser, clauses, terms, why };
}
