import { DICTATE_AT, warStanding } from "../world/war-score";
import { PEACE_AT, TRUCE_AT, warWeariness } from "../world/war-weariness";
import { spanInWords } from "../authority/abroad";
import type { WorldState } from "../world/world-state";
import type { WhyCause, WhyReading } from "./why";

/**
 * How the war goes, as the viewer could judge it.
 *
 * The engine keeps a score of every war (`warStanding`): ground taken and
 * held, capitals, the men each side has left, the blood each has lost, the
 * cities under siege. It decides whether a peace is bargained for or
 * dictated. That score counts the enemy's men exactly, and the viewer cannot.
 * So the men are put back in as the viewer's own sources count them, or left
 * out where nobody has counted. Everything else in it is what anybody could
 * see: whose ground is whose, whose city is besieged, which battles were lost.
 */

export interface WarReading {
  /** "going against you". */
  readonly headline: string;
  readonly why: WhyReading;
}

export const WAR_REMEDY = "Ground taken and held, the enemy's capital, their armies broken and their cities starved turn a war. Past a point the side that is winning dictates the peace instead of bargaining for it.";

const fitOf = (force: WorldState["material"]["forces"][number]): number => force.personnel.reduce((sum, group) => sum + group.fit, 0);

/** The men term of `warStanding`, for a given count of the enemy. */
const menEdge = (ours: number, theirs: number): number => (ours + theirs === 0 ? 0 : Math.round(((ours - theirs) / (ours + theirs)) * 25));

function headlineOf(score: number): string {
  if (score >= DICTATE_AT) return "won, as good as: you could dictate the peace";
  if (score >= 20) return "going well for you";
  if (score > -20) return "in the balance";
  if (score > -DICTATE_AT) return "going against you";
  return "all but lost";
}

export function warInWords(world: WorldState, ownPolityId: string, enemyPolityId: string, estimatedEnemyMen: number | null): WarReading | null {
  const standing = warStanding(world, ownPolityId, enemyPolityId);
  if (standing.parts.length === 1 && standing.parts[0] === "not at war") return null;
  const ours = world.material.forces.filter((force) => force.polityId === ownPolityId).reduce((sum, force) => sum + fitOf(force), 0);
  const theirs = world.material.forces.filter((force) => force.polityId === enemyPolityId).reduce((sum, force) => sum + fitOf(force), 0);
  const landOf = (polityId: string): number => world.map.provinces.filter((province) => province.controllerPolityId === polityId).length;

  // The score, with the enemy's men as the viewer counts them. A total defeat
  // for want of an army is not something the viewer can know from here.
  let score = standing.score;
  if (!standing.totalDefeat && landOf(ownPolityId) > 0 && ours > 0) {
    score = score - menEdge(ours, theirs) + (estimatedEnemyMen === null ? 0 : menEdge(ours, estimatedEnemyMen));
  } else if (standing.totalDefeat && landOf(enemyPolityId) > 0) {
    // They have land left; only their army is gone, which the viewer may not know.
    score = estimatedEnemyMen === 0 ? 100 : Math.min(DICTATE_AT - 1, score);
  }
  score = Math.max(-100, Math.min(100, score));

  const causes: WhyCause[] = [];
  const since = world.elapsedStep - standing.days;
  const takenFrom = (loser: string, holder: string): number => world.map.provinces.filter((province) =>
    province.controllerPolityId === holder && province.lostBy?.polityId === loser && province.lostBy.atStep >= since).length;
  const won = takenFrom(enemyPolityId, ownPolityId);
  const lost = takenFrom(ownPolityId, enemyPolityId);
  if (won > 0) causes.push({ label: `You hold ${won === 1 ? "a province" : `${won} provinces`} taken from them`, tone: "good" });
  if (lost > 0) causes.push({ label: `They hold ${lost === 1 ? "a province" : `${lost} provinces`} taken from you`, tone: "bad" });
  if (landOf(enemyPolityId) === 0) causes.push({ label: "They hold no ground of their own", tone: "good" });
  if (landOf(ownPolityId) === 0) causes.push({ label: "You hold no ground of your own", tone: "bad" });
  if (standing.parts.includes("holds their capital")) causes.push({ label: "You hold their capital", tone: "good" });
  if (standing.parts.includes("their enemy holds its capital")) causes.push({ label: "They hold your capital", tone: "bad" });

  if (estimatedEnemyMen === null) causes.push({ label: "Their numbers are unknown to you", tone: "mid" });
  else {
    const edge = menEdge(ours, estimatedEnemyMen);
    causes.push(edge >= 3
      ? { label: "More men under arms than theirs, as far as you know", tone: "good" }
      : edge <= -3
        ? { label: "Fewer men under arms than theirs, as far as you know", tone: "bad" }
        : { label: "About as many men under arms as theirs, as far as you know", tone: "mid" });
  }
  if (standing.parts.includes("has bled them more")) causes.push({ label: "You have cost them more men than they have cost you", tone: "good" });
  if (standing.parts.includes("has bled more")) causes.push({ label: "They have cost you more men than you have cost them", tone: "bad" });
  if (standing.parts.includes("has them under siege")) causes.push({ label: "Their cities are under siege", tone: "good" });
  if (standing.parts.includes("is under siege")) causes.push({ label: "Your cities are under siege", tone: "bad" });

  const tired = warWeariness(world, ownPolityId, enemyPolityId).score;
  if (tired >= PEACE_AT) causes.push({ label: "Your city is sick of it and wants peace", tone: "bad" });
  else if (tired >= TRUCE_AT) causes.push({ label: "Your city is tiring of it", tone: "bad" });
  if (standing.days >= 60) causes.push({ label: `${spanInWords(standing.days).replace(/^./, (first) => first.toUpperCase())} of it`, tone: "mid" });

  const order = { bad: 0, good: 1, mid: 2 } as const;
  return { headline: headlineOf(score), why: { causes: causes.sort((a, b) => order[a.tone] - order[b.tone]), remedy: WAR_REMEDY } };
}
