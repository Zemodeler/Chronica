import type { FactProposalDraft, ServiceContract, WorldState } from "@chronica/shared";

/**
 * Service contracts over time (roles plan phase 5): a term that runs out, and
 * pay that stops coming.
 *
 * The pay itself is an ordinary obligation and the tick already pays it or
 * misses it; this only notices when it has been missed, or the term is up, and
 * ends the contract -- which hands the captain's men back to him, takes the
 * envoy's commission away, and stops the farm.
 */

/** Ends a contract and undoes what it lent: the pay, the farm, the commission, the company. */
export function endContract(world: WorldState, contract: ServiceContract, status: "ended" | "lapsed" | "broken", atStep: number): WorldState {
  return {
    ...world,
    authorityGrants: world.authorityGrants.map((grant) => (grant.id === contract.grantId && grant.revokedAtStep === null
      ? { ...grant, revokedAtStep: atStep, revocationReason: "The contract that gave it ended." }
      : grant)),
    material: {
      ...world.material,
      contracts: world.material.contracts.map((candidate) => (candidate.id === contract.id ? { ...candidate, status } : candidate)),
      obligations: world.material.obligations.map((obligation) => (obligation.id === contract.obligationId ? { ...obligation, active: false } : obligation)),
      incomeSources: world.material.incomeSources.map((source) => (source.id === contract.incomeSourceId ? { ...source, active: false } : source)),
      forces: world.material.forces.map((force) => (force.id === contract.forceId && contract.forceWas !== null
        ? { ...force, polityId: contract.forceWas.polityId, controllerCharacterId: contract.forceWas.controllerCharacterId, payObligationId: null }
        : force)),
    },
  };
}

export function keepContracts(world: WorldState, toDay: number): { world: WorldState; facts: FactProposalDraft[] } {
  const facts: FactProposalDraft[] = [];
  let next = world;
  const name = (id: string): string => world.characters.find((character) => character.id === id)?.name ?? id;
  for (const contract of world.material.contracts) {
    if (contract.status !== "active") continue;
    const employee = world.characters.find((character) => character.id === contract.employeeCharacterId);
    const pay = world.material.obligations.find((obligation) => obligation.id === contract.obligationId);
    const died = employee === undefined || !employee.alive;
    const unpaid = pay !== undefined && pay.missedPeriods > 0;
    const over = contract.endsAtStep !== null && contract.endsAtStep <= toDay;
    if (!died && !unpaid && !over) {
      if (contract.journey != null && contract.journey.arrivedAtStep === null && contract.journey.arrivesAtStep <= toDay) {
        const arrived = contract.journey.arrivesAtStep;
        next = { ...next, characters: next.characters.map((character) => character.id === employee.id ? { ...character, locationProvinceId: contract.journey!.toProvinceId } : character),
          material: { ...next.material, contracts: next.material.contracts.map((candidate) => candidate.id === contract.id ? { ...candidate, journey: { ...contract.journey!, arrivedAtStep: arrived } } : candidate) } };
        facts.push({ localId: `arrival_${contract.id}`.slice(0, 60), kind: "contract_agent_arrived", summary: `${employee.name} reached ${world.map.provinces.find((province) => province.id === contract.journey!.toProvinceId)?.name ?? contract.journey.toProvinceId} for ${contract.label}.`, affectedRefs: [{ kind: "character", id: employee.id }, { kind: "account", id: contract.employerAccountId }], visibility: contract.role === "agent" ? "private" : "polity", discoveryState: contract.role === "agent" ? "private" : "polity", knownToRefs: [{ kind: "character", id: employee.id }, ...(world.material.accounts.find((account) => account.id === contract.employerAccountId)?.owner.kind === "character" ? [{ kind: "character" as const, id: world.material.accounts.find((account) => account.id === contract.employerAccountId)!.owner.id }] : [])], knowableInDays: 0, significance: 25 });
      }
      continue;
    }
    next = endContract(next, contract, unpaid ? "lapsed" : "ended", toDay);
    const who = name(contract.employeeCharacterId);
    facts.push({
      localId: `contract_${contract.id}`.slice(0, 60),
      kind: unpaid ? "contract_lapsed" : "contract_ended",
      summary: died
        ? `${who}'s contract -- ${contract.label} -- ended with his life.`
        : unpaid
          ? contract.role === "tax_farmer"
            ? `${who} missed the rent on his tax farm, and the farm was taken back: ${contract.label}.`
            : `${who} was not paid, and his contract lapsed: ${contract.label}. He owes nobody anything now.`
          : `${who}'s term ran out: ${contract.label}.`,
      affectedRefs: [{ kind: "character", id: contract.employeeCharacterId }, { kind: "account", id: contract.employerAccountId }],
      visibility: "polity",
      discoveryState: "polity",
      knowableInDays: 0,
      significance: 25,
    });
  }
  return { world: next, facts };
}
