import type { WorldState } from "@chronica/shared";

/**
 * For the tests struck on the consul's army as the opening once drew it: one legion and one ala, 8,860 men, and 65,000 a month in pay.
 *
 * The opening has two legions and two alae now (`packages/db/src/punic-wars-sicily.ts`, Polybius 6.20-26). The cases that count a siege's relief, a battle's odds or a
 * legion's pay are about their own mechanics and were calibrated on the smaller army; they take it back to that size here rather than be struck over again,
 * and the opening's own strength is tested where it is drawn (`carthage-holds-western-sicily.test.ts`).
 */
export function withTheConsularArmyOnceDrawn(world: WorldState): WorldState {
  const army = world.material.forces.find((force) => force.id === "roman-field-army");
  if (army === undefined || army.authorizedStrength < 18_000) return world;
  return {
    ...world,
    material: {
      ...world.material,
      forces: world.material.forces.map((force) => (force.id !== army.id ? force : {
        ...force,
        authorizedStrength: force.authorizedStrength / 2,
        personnel: force.personnel.map((row) => ({ ...row, fit: row.fit / 2 })),
      })),
      obligations: world.material.obligations.map((obligation) => (obligation.id === army.payObligationId ? { ...obligation, amount: obligation.amount / 2 } : obligation)),
    },
  };
}
