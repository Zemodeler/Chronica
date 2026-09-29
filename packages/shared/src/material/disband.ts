import type { WorldState } from "../world/world-state";

/**
 * Armies that are no more -- surrendered, or yielded with their city -- taken
 * out of the world cleanly. A force was removed by filtering it out of the
 * list, and its pay chest went on belonging to a force that did not exist,
 * which the world's own validation refuses. What was in the chest goes to
 * `intoAccountId` where there is one; the chest, what it paid and was paid,
 * and who could draw on it, go with the army.
 */
export function disbandForces(world: WorldState, forceIds: ReadonlySet<string>, intoAccountId: string | null): WorldState {
  if (forceIds.size === 0) return world;
  const chests = new Set(world.material.accounts.filter((account) => account.owner.kind === "force" && forceIds.has(account.owner.id)).map((account) => account.id));
  const kept = world.material.accounts.reduce((sum, account) => sum + (chests.has(account.id) ? account.balance : 0), 0);
  return {
    ...world,
    material: {
      ...world.material,
      forces: world.material.forces.filter((force) => !forceIds.has(force.id)),
      accounts: world.material.accounts
        .filter((account) => !chests.has(account.id))
        .map((account) => (account.id === intoAccountId ? { ...account, balance: account.balance + kept } : account)),
      accountAccess: world.material.accountAccess.filter((access) => !chests.has(access.accountId)),
      obligations: world.material.obligations.filter((obligation) => !chests.has(obligation.payerAccountId) && (obligation.recipientAccountId == null || !chests.has(obligation.recipientAccountId))),
    },
    contingencies: world.contingencies.map((plan) => (plan.ambushForceId !== null && forceIds.has(plan.ambushForceId) ? { ...plan, ambushForceId: null } : plan)),
  };
}
