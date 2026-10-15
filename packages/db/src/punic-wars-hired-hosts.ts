import type { ServiceContract, WorldState } from "@chronica/shared";

/**
 * Carthage's hired men are hired (docs/plans/scenario-notes-coin.md).
 *
 * The opening world paid Carthage's armies as standing obligations and nothing more, so that a company's walking out, its pay indexed to the
 * silver in the coin and the waiting rule of a company that is not paid (`mercenary-pay.ts`) could never reach them: the only hired men in a
 * live world were the ones a player hired. Carthage's army was foreign hired men: Libyans, Numidians, Iberians and Balearic slingers on the
 * Carthaginians' pay, the Sicilian garrisons Greek and Italian (Polybius 1.17, 1.67). Each of Carthage's two hired hosts is now a mercenary
 * contract (the captain's company, the treasury's pay), on the pay each had.
 *
 * Nothing here changes what is paid or what any force is: only that the pay is a hired company's, so that it has the rules of one. The fleet
 * is Carthaginian citizens' and subjects' crews and stays as it was.
 */

const HOSTS = [
  { forceId: "carthaginian-garrison", obligationId: "carthage-mercenaries", captain: "hanno-carthage", label: "The hired men of Hanno's field force, in Carthaginian pay" },
  { forceId: "carthaginian-sicilian-army", obligationId: "carthage-sicilian-hired-men", captain: "hasdrubal-son-of-hanno", label: "The hired men of Hasdrubal's army in Sicily, in Carthaginian pay" },
] as const;

export function withHiredHosts(world: WorldState): WorldState {
  const known = new Set(world.material.contracts.map((contract) => contract.id));
  const contracts: ServiceContract[] = [];
  for (const host of HOSTS) {
    const id = `contract-${host.forceId}-hired`;
    const force = world.material.forces.find((candidate) => candidate.id === host.forceId);
    const pay = world.material.obligations.find((candidate) => candidate.id === host.obligationId);
    const treasury = world.material.accounts.find((account) => account.owner.kind === "polity" && account.owner.id === "carthage");
    if (known.has(id) || force === undefined || pay === undefined || treasury === undefined) continue;
    if (!world.characters.some((character) => character.id === host.captain)) continue;
    contracts.push({
      id, role: "mercenary", label: host.label, employerAccountId: treasury.id, employeeCharacterId: host.captain, obligationId: pay.id,
      incomeSourceId: null, grantId: null, advance: 0, monthlyPay: pay.amount,
      duties: "Fight for Carthage where the strategoi send him, for the pay the treasury owes.",
      openedAtStep: 0, endsAtStep: null, forceId: force.id,
      forceWas: { polityId: force.polityId, controllerCharacterId: force.controllerCharacterId },
      provinceId: null, counterpartPolityId: null, status: "active",
    });
  }
  if (contracts.length === 0) return world;
  return { ...world, material: { ...world.material, contracts: [...world.material.contracts, ...contracts] } };
}
