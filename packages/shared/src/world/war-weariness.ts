import type { WorldState } from "./world-state";
import { atWar } from "./agreements";
import { warStanding } from "./war-score";

/**
 * How tired a power is of one war, 0-100 (docs/plans/departments.md §13).
 *
 * A war between two powers the player did not command ended only if the
 * model happened to think of ending it, so wars nobody was watching went on
 * for ever. This is what a city feels about its war, read off the world: the
 * men it has lost against the men it had, its own ground held by the enemy,
 * an empty treasury and debts unpaid, a war going badly, the years of it, and
 * unrest and hunger at home.
 *
 * Past 40 a power seeks a truce; past 60 it offers peace; past 50 a peace
 * party forms at home.
 */
export interface WarWeariness {
  readonly score: number;
  readonly parts: readonly string[];
}

export const TRUCE_AT = 40;
export const PEACE_AT = 60;
export const PEACE_PARTY_AT = 50;

const fit = (force: WorldState["material"]["forces"][number]): number => force.personnel.reduce((sum, group) => sum + group.fit, 0);

export function warWeariness(world: Pick<WorldState, "map" | "material" | "polityAgreements" | "elapsedStep" | "sieges">, polityId: string, enemyId: string): WarWeariness {
  if (!atWar(world.polityAgreements, polityId, enemyId)) return { score: 0, parts: [] };
  const standing = warStanding(world, polityId, enemyId);
  const since = world.elapsedStep - standing.days;
  const parts: string[] = [];
  let score = 0;

  // The men lost, against the men it had.
  const forces = world.material.forces.filter((force) => force.polityId === polityId);
  const lost = forces.flatMap((force) => force.history).filter((event) => event.atStep >= since && (event.kind === "battle_death" || event.kind === "wounds_death" || event.kind === "desertion")).reduce((sum, event) => sum + event.count, 0);
  const have = forces.reduce((sum, force) => sum + fit(force), 0);
  if (lost > 0) {
    const bled = Math.min(30, Math.round((lost / Math.max(1, have + lost)) * 60));
    score += bled;
    if (bled >= 5) parts.push("the men it has lost");
  }

  // Its own ground in the enemy's hands.
  const taken = world.map.provinces.filter((province) => province.controllerPolityId === enemyId && province.lostBy?.polityId === polityId && province.lostBy.atStep >= since).length;
  if (taken > 0) { score += Math.min(20, taken * 5); parts.push(`${taken} of its provinces held by the enemy`); }

  // An empty chest, and what it cannot pay.
  const accounts = world.material.accounts.filter((account) => account.owner.kind === "polity" && account.owner.id === polityId);
  const ids = new Set(accounts.map((account) => account.id));
  const missed = world.material.obligations.filter((obligation) => obligation.active && ids.has(obligation.payerAccountId)).reduce((sum, obligation) => sum + obligation.missedPeriods, 0);
  const broke = accounts.some((account) => account.balance <= 0);
  const debt = Math.min(15, (broke ? 5 : 0) + missed * 2);
  if (debt > 0) { score += debt; parts.push("a treasury that cannot pay"); }

  // A war going badly.
  if (standing.score < 0) { score += Math.min(15, Math.round(-standing.score / 4)); parts.push("a war going badly"); }

  // The years of it.
  const months = Math.floor(standing.days / 30);
  if (months > 12) { score += Math.min(10, Math.floor((months - 12) / 2)); parts.push(`${Math.floor(months / 12)} years of it`); }

  // Unrest and hunger at home.
  const home = new Set(world.map.provinces.filter((province) => province.controllerPolityId === polityId).map((province) => province.id));
  const material = world.material.provinceMaterial.filter((entry) => home.has(entry.provinceId));
  if (material.length > 0) {
    const calm = material.reduce((sum, entry) => sum + entry.stabilityBps, 0) / material.length;
    const fed = material.reduce((sum, entry) => sum + entry.foodSecurityBps, 0) / material.length;
    const hardship = Math.min(10, Math.round(Math.max(0, 5_000 - calm) / 500 + Math.max(0, 5_000 - fed) / 500));
    if (hardship > 0) { score += hardship; parts.push("unrest and hunger at home"); }
  }

  return { score: Math.max(0, Math.min(100, score)), parts };
}
