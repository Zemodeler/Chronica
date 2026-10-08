import { fitStrengthOf, warsOf, type PoliticalProcedure, type WorldState } from "@chronica/shared";

/**
 * The sea is lost, and a chamber knows it (playtest fix batch 2: the Senate rejected a fleet at every asking).
 *
 * Polybius 1.20: the Romans, who had never set foot on the sea, built a hundred and twenty ships when they saw the war could not be won without them. A
 * question to build a fleet, or to fit the boarding-bridge to it, put to a chamber whose power is at war with one that holds the sea and has no ships of its
 * own to meet it, leans toward its being carried: the war's need is a reason a bloc weighs beside what it wants. Bounded, and only for those two questions.
 */

/** What the need of the war adds to every bloc's lean on a fleet. */
export const THE_SEA_IS_LOST_LEAN = 35;

const A_FLEET = /\ba fleet of\b/iu;
const THE_BRIDGE = /\bboarding-bridge be fitted\b/iu;

const shipsOf = (world: WorldState, polityId: string): number => world.material.forces
  .filter((force) => force.polityId === polityId && force.outlaw !== true && force.personnel.some((row) => row.categoryId === "warship"))
  .reduce((sum, force) => sum + fitStrengthOf(force), 0);

/** The lean a war's need gives a question of ships, with its reason, or nothing. */
export function theSeaIsLostLean(world: WorldState, procedure: Pick<PoliticalProcedure, "label" | "institutionId">): { readonly lean: number; readonly reasons: string[] } {
  const ships = A_FLEET.test(procedure.label);
  if (!ships && !THE_BRIDGE.test(procedure.label)) return { lean: 0, reasons: [] };
  const polityId = world.material.institutions.find((institution) => institution.id === procedure.institutionId)?.polityId;
  if (polityId === undefined) return { lean: 0, reasons: [] };
  // A fleet is wanted where the enemy holds the sea; the boarding-bridge where he has a fleet to be met, whoever has the more ships.
  const holdsTheSea = warsOf(world.polityAgreements, polityId).find((enemy) => shipsOf(world, enemy) >= 40 && (!ships || shipsOf(world, enemy) > shipsOf(world, polityId)));
  if (holdsTheSea === undefined) return { lean: 0, reasons: [] };
  const name = world.map.polities.find((polity) => polity.id === holdsTheSea)?.name ?? "the enemy";
  return { lean: THE_SEA_IS_LOST_LEAN, reasons: [`${name} holds the sea, and the war cannot be won without ships (+${THE_SEA_IS_LOST_LEAN})`] };
}
