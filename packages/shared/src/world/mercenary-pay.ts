import type { ServiceContract } from "../material-state";
import type { WorldState } from "./world-state";
import { coinageOfPolity, polityOfOwner, standardOf } from "./coinage";

/**
 * What a hired company wants of the coin it is paid in (v53+, phase E's last
 * piece).
 *
 * A mercenary serves for what his pay will buy, and he judges the coin by the
 * silver in it, not by the name on it. The sources the model is built on:
 *
 *  - Carthage struck its first coin in Sicily about 410 BCE to pay the soldiers
 *    it hired there; the Siculo-Punic tetradrachms of the "Camp" mint (Entella)
 *    kept the Attic weight because Greek and Italian mercenaries were used to
 *    being paid in Greek silver and would not take less. The mint at Carthage
 *    shipped coin across to the army (Hoover, Handbook of Coins of Sicily;
 *    Coinweek, "The Coinage of Carthage"). By the end of the Mercenary War
 *    (241-238) the treasury was striking billon, silver debased with bronze, and
 *    bronze valued above its metal.
 *  - The war itself began as a quarrel about pay in arrears. After the peace of
 *    241 Carthage owed some twenty thousand foreign soldiers their wages for
 *    Sicily, and owed Rome 1,000 talents at once and 2,200 over ten years;
 *    the soldiers who were gathered at Sicca to be paid were offered less than
 *    they had been promised, and they asked for the whole and for what the
 *    campaigns had cost them, and rose when it was refused (Polybius 1.65-68).
 *  - Rome paid the stipendium to its own citizen-soldiers in bronze and silver
 *    by its own reckoning, two obols a day to a foot soldier, twice that to a
 *    centurion, a drachma (denarius) to a horseman, less stoppages for grain,
 *    clothes and arms (Polybius 6.39); the allies' infantry drew the same
 *    ration free. Hellenistic kings paid in their own silver on the Attic
 *    standard, and a debasement is a thing the soldiery notices first.
 *
 * What the engine does with it: a mercenary's pay is indexed to the silver the
 * employer's coin held when the bargain was struck (the soldiers' demand rises
 * with the debasement at once, where prices follow it slowly), his demand
 * grows by a share of the wage for each period he has gone unpaid, and the
 * grace he gives a treasury that is late is shorter the worse the coin. A
 * company that is not paid walks away; one paid in debased coin is quicker to.
 */

/** Pay periods a hired company will wait for a late wage, paid in sound coin, before it walks. */
export const MERCENARY_GRACE_PERIODS = 2;
/** Each this much of silver deficit (basis points of the standard) costs the treasury one period of that grace. */
export const MERCENARY_DEFICIT_PER_LOST_GRACE_BPS = 1_000;
/** What a company adds to its demand for every period it has gone unpaid, in basis points of the wage: back-pay with the cost of waiting. */
export const MERCENARY_ARREARS_DEMAND_BPS = 500;
/** And the most it adds, however long the wait. */
export const MERCENARY_ARREARS_DEMAND_CAP_BPS = 5_000;

/** How far below its standard a power's coin has fallen in silver, in basis points of the standard (0 for a sound coin or none). */
export function silverDeficitBps(world: WorldState, polityId: string | null | undefined): number {
  const coinage = coinageOfPolity(world, polityId);
  const standard = standardOf(coinage);
  return coinage.silverBps >= standard ? 0 : Math.round((10_000 * (standard - coinage.silverBps)) / standard);
}

/**
 * The silver a coin's holder has lost, as the share more of the coin it takes to buy what a sound unit bought: what a soldier says when he
 * is handed a debased coin ("this is worth four in five of what you promised").
 */
export function silverShortfallBps(world: WorldState, polityId: string | null | undefined): number {
  const coinage = coinageOfPolity(world, polityId);
  return Math.max(0, Math.round((10_000 * standardOf(coinage)) / coinage.silverBps) - 10_000);
}

/** The power paying a contract: its employer's own, or the power its employer belongs to. */
export function employerPolityOf(world: WorldState, contract: Pick<ServiceContract, "employerAccountId">): string | null {
  const account = world.material.accounts.find((candidate) => candidate.id === contract.employerAccountId);
  return account === undefined ? null : polityOfOwner(world, account.owner);
}

/** The active mercenary contract, if any, that an obligation pays. */
export function mercenaryContractPaidBy(world: Pick<WorldState, "material">, obligationId: string): ServiceContract | undefined {
  return world.material.contracts.find((contract) => contract.status === "active" && contract.role === "mercenary" && contract.obligationId === obligationId);
}

/** The active mercenary contract that holds a force. */
export function mercenaryContractOfForce(world: Pick<WorldState, "material">, forceId: string): ServiceContract | undefined {
  return world.material.contracts.find((contract) => contract.status === "active" && contract.role === "mercenary" && contract.forceId === forceId);
}

/**
 * What a company asks for a month's wage, as a multiple of the wage written,
 * in basis points: the employer's coin at what it is worth in silver now
 * (`silverShortfallBps`: they will be paid what the coin was struck to be worth),
 * and the periods it has gone unpaid.
 */
export function mercenaryWageBps(world: WorldState, contract: Pick<ServiceContract, "employerAccountId">, missedPeriods: number): number {
  const coinDemand = 10_000 + silverShortfallBps(world, employerPolityOf(world, contract));
  const waiting = Math.min(MERCENARY_ARREARS_DEMAND_CAP_BPS, Math.max(0, missedPeriods) * MERCENARY_ARREARS_DEMAND_BPS);
  return Math.round((coinDemand * (10_000 + waiting)) / 10_000);
}

/** How many late periods a company waits before it walks, given the coin it is paid in: two in sound silver, none once a fifth of it has gone. */
export function mercenaryGracePeriods(world: WorldState, contract: Pick<ServiceContract, "employerAccountId">): number {
  const lost = Math.floor(silverDeficitBps(world, employerPolityOf(world, contract)) / MERCENARY_DEFICIT_PER_LOST_GRACE_BPS);
  return Math.max(0, MERCENARY_GRACE_PERIODS - lost);
}

/** How much quicker a hired company sours when its coin is debased, as a multiple of the ordinary loss of morale and men on unpaid wages. */
export function mercenaryTemper(world: WorldState, contract: Pick<ServiceContract, "employerAccountId">): number {
  return 1 + silverDeficitBps(world, employerPolityOf(world, contract)) / 5_000;
}
