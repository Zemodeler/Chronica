import type { WorldState } from "./world-state";
import { atWar } from "./agreements";
import { warLossesOf, warStanding, type WarLossWorld } from "./war-score";

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
 *
 * Each part is bounded and named, so a reader can see what moved it: the men
 * lost up to 30, ground taken up to 20, a treasury that cannot pay up to 25,
 * a war going badly up to 15, the years of it up to 10, unrest and hunger at
 * home up to 10.
 */
export interface WarWeariness {
  readonly score: number;
  readonly parts: readonly string[];
}

export const TRUCE_AT = 40;
export const PEACE_AT = 60;
export const PEACE_PARTY_AT = 50;

/** The most an empty chest and unpaid debts can weigh. Fifteen before, counted from missed payments and not from what was owed. */
export const DEBT_WEIGHT = 25;
/** Arrears weigh their full weight once they come to a season's income with the chest counted in. */
const ARREARS_SEASON_DAYS = 90;

const fit = (force: WorldState["material"]["forces"][number]): number => force.personnel.reduce((sum, group) => sum + group.fit, 0);

export type WearinessWorld = Pick<WorldState, "map" | "material" | "polityAgreements" | "elapsedStep" | "sieges"> & { readonly campaigns?: WarLossWorld["campaigns"] };

/**
 * What a power's chest owes against what it can pay: the arrears of its
 * obligations against its balance and a season's income. 0 where nothing is
 * owed, 1 where the arrears are as much as it could find in a season.
 *
 * The treasury's part was counted from how many payments were missed, each
 * at two points and capped at fifteen, so a state whose whole army went
 * unpaid for a year weighed the same as one a month behind on a pension; and
 * the size of the arrears against what the state takes in, which is what
 * ruins it, was not read at all.
 */
export function arrearsStrainOf(world: Pick<WorldState, "material">, polityId: string): { readonly strain: number; readonly broke: boolean; readonly arrears: number; readonly canPay: number; readonly missed: number } {
  const accounts = world.material.accounts.filter((account) => account.owner.kind === "polity" && account.owner.id === polityId);
  const ids = new Set(accounts.map((account) => account.id));
  const chest = accounts.reduce((sum, account) => sum + account.balance, 0);
  const owed = world.material.obligations.filter((obligation) => obligation.active && ids.has(obligation.payerAccountId));
  const arrears = owed.reduce((sum, obligation) => sum + Math.max(0, obligation.arrears), 0);
  const missed = owed.reduce((sum, obligation) => sum + obligation.missedPeriods, 0);
  const aSeason = world.material.incomeSources.filter((income) => income.active && ids.has(income.beneficiaryAccountId))
    .reduce((sum, income) => sum + (income.amount * (income.collectionRateBps / 10_000) * ARREARS_SEASON_DAYS) / Math.max(1, income.cadenceSteps), 0);
  const canPay = Math.max(1, Math.max(0, chest) + aSeason);
  return { strain: arrears <= 0 ? 0 : Math.min(1, arrears / canPay), broke: accounts.length > 0 && chest <= 0, arrears, canPay, missed };
}

export function warWeariness(world: WearinessWorld, polityId: string, enemyId: string): WarWeariness {
  if (!atWar(world.polityAgreements, polityId, enemyId)) return { score: 0, parts: [] };
  const standing = warStanding(world, polityId, enemyId);
  const since = world.elapsedStep - standing.days;
  const parts: string[] = [];
  let score = 0;

  // The men lost to this war, against the men it has: the dead of battle and
  // of wounds, the deserters, and the dead of hunger and sickness, who were
  // not counted before and in a long war are the most of it (`warLossesOf`,
  // which keeps one war's losses from being laid to another).
  const forces = world.material.forces.filter((force) => force.polityId === polityId);
  const losses = warLossesOf(world, polityId, enemyId);
  const lost = losses.total;
  const have = forces.reduce((sum, force) => sum + fit(force), 0);
  if (lost > 0) {
    const bled = Math.min(30, Math.round((lost / Math.max(1, have + lost)) * 60));
    score += bled;
    if (bled >= 5) parts.push("the men it has lost");
    if (bled >= 5 && losses.hardship > 0 && losses.hardship >= losses.battle + losses.wounds) parts.push("hunger and sickness in the camps");
  }

  // Its own ground in the enemy's hands.
  const taken = world.map.provinces.filter((province) => province.controllerPolityId === enemyId && province.lostBy?.polityId === polityId && province.lostBy.atStep >= since).length;
  if (taken > 0) { score += Math.min(20, taken * 5); parts.push(`${taken} of its provinces held by the enemy`); }

  // An empty chest, and what it cannot pay: the arrears against what it can
  // find, with the payments missed as a floor under that.
  const strain = arrearsStrainOf(world, polityId);
  const debt = Math.min(DEBT_WEIGHT, (strain.broke ? 5 : 0) + Math.max(Math.round(strain.strain * 20), Math.min(10, strain.missed * 2)));
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
