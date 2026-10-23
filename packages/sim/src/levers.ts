import {
  ECONOMIC_LEVER_REACH,
  chargeSkill,
  leverFactor,
  readDepartments,
  skillShare,
  type DepartmentReader,
  type WorldState,
} from "@chronica/shared";

/**
 * What the economic charges are worth, in the numbers they move (docs/plans/government.md, "H0 as built").
 *
 * Every charge is done as well as whoever holds it can do it (`readDepartments`): the officers of the department
 * that holds the lever, averaged. Five of them have a number of their own that the monthly passes read here, each a
 * multiplier near one: exactly one where nobody has been given the charge (the ruler's handling of it is the middling run,
 * `chargeSkill`) and for a man of middling skill, so a world that has set nobody to these works runs as it did before they existed:
 *
 *  - \`customs\`: what share of the duty on the month's trade reaches the chest (\`customs.ts\`): up to a fifth either way.
 *  - \`mint\`: the gain from a coin struck lighter and the cost of striking it better (\`apply-deltas.ts\`), and how much of a coin's
 *    bad name sticks to its premium (\`coinage.ts\`).
 *  - \`markets\`: how far a hub's price strays from the base price (\`markets.ts\`), and how much hoarded grain a dear market
 *    brings out.
 *  - \`credit\`: the interest the state is asked to pay on what it borrows (\`apply-deltas.ts\`, \`loan_open\`).
 *  - \`census\`: how many of the people who are there the tax roll and the muster roll count (\`material/taxation.ts\`).
 *
 * A reader is built once for a pass and handed in; these never build one for each hub or each loan.
 */

/** The reader of a world's charges, built once for a pass. */
export const chargesOf = (world: WorldState): DepartmentReader => readDepartments(world);

/** The gain from striking a coin lighter, and what striking it better costs, are scaled by this and its inverse: a good mint is worth up to a seventh either way. */
export const mintFactor = (reader: Pick<DepartmentReader, "skill" | "holding">, polityId: string): number => leverFactor(reader, polityId, "mint", ECONOMIC_LEVER_REACH.mint);

/** How much of a coin's bad name (war, arrears, a high price level) sticks to what it fetches: 1 for a middling mint, down to 0.7 for the best. */
export const coinsBadName = (reader: Pick<DepartmentReader, "skill" | "holding">, polityId: string): number =>
  1 - skillShare(chargeSkill(reader, polityId, "mint"), ECONOMIC_LEVER_REACH.mintName);

/** How far a hub's prices stray from the base price: 1 for a middling clerk of the markets, down to 0.8 for the best, up to 1.2 for the worst. */
export const priceSwing = (reader: Pick<DepartmentReader, "skill" | "holding">, polityId: string): number =>
  1 - skillShare(chargeSkill(reader, polityId, "markets"), ECONOMIC_LEVER_REACH.markets);

/** A price (in basis points of the base price) with its strays from the base scaled by `swing`. */
export const dampenedPrice = (priceBps: number, swing: number): number => (swing === 1 ? priceBps : Math.max(1, Math.round(10_000 + (priceBps - 10_000) * swing)));

/** The interest a state borrowing is asked for, in basis points: scaled by what its credit is worth, 0.85 at best and 1.15 at worst. */
export function creditRateBps(world: WorldState, reader: Pick<DepartmentReader, "skill" | "holding">, borrowerAccountId: string, interestBps: number): number {
  const owner = world.material.accounts.find((account) => account.id === borrowerAccountId)?.owner;
  if (owner?.kind !== "polity") return interestBps;
  return Math.max(0, Math.round(interestBps * (1 - skillShare(chargeSkill(reader, owner.id, "credit"), ECONOMIC_LEVER_REACH.credit))));
}
